import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import Fastify from "fastify";
import { env } from "./config/env";
import { pool, replicaReadPool } from "./db/pool";
import { healthRoutes } from "./routes/health";
import { postsRoutes } from "./routes/posts";
import { usersRoutes } from "./routes/users";

function createApp() {
  const app = Fastify({
    logger: false,
  });

  app.setErrorHandler((error: any, request, reply) => {
    const statusCode =
      typeof error?.statusCode === "number" ? error.statusCode : 500;
    const message =
      typeof error?.message === "string"
        ? error.message
        : "Internal Server Error";

    if (statusCode >= 500) {
      console.error(`[server] ${request.method} ${request.url}:`, error);
    }

    reply.status(statusCode).send({
      error: message,
    });
  });

  app.register(healthRoutes);
  app.register(postsRoutes);
  app.register(usersRoutes);

  return app;
}

async function start(port: number, readReplicaMode = false): Promise<void> {
  const app = createApp();
  try {
    await pool.query("SELECT 1");
    console.log("Primary database connection successful.");

    if (readReplicaMode) {
      if (!replicaReadPool) {
        throw new Error(
          "Read-replica mode requires READ_REPLICA_ENABLED=true.",
        );
      }

      const replicaState = await replicaReadPool.query(
        "SELECT pg_is_in_recovery() AS is_replica",
      );
      if (replicaState.rows[0]?.is_replica !== true) {
        throw new Error("Configured read database is not in recovery mode.");
      }
      console.log("Read replica connection successful and in recovery mode.");
      console.log(
        `Pool split: primary=${env.dbPoolPrimaryMax}, replica=${env.dbPoolReplicaMax}; feed reads=${env.primaryReadPercent}% primary / ${100 - env.primaryReadPercent}% replica; cache TTL=${env.feedCacheTtlMs}ms.`,
      );
    }

    await app.listen({
      port,
      host: "0.0.0.0",
    });

    console.log(`Server listening on http://0.0.0.0:${port}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

function splitLimit(total: number, index: number, count: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}

function startCluster(): void {
  const defaultWorkers = Math.max(
    1,
    Math.min(4, availableParallelism(), env.dbPoolMax),
  );
  const workerCount = Number(process.env.CLUSTER_WORKERS ?? defaultWorkers);

  if (
    !Number.isInteger(workerCount) ||
    workerCount < 1 ||
    workerCount > env.dbPoolMax
  ) {
    throw new Error(
      `CLUSTER_WORKERS must be an integer between 1 and DB_POOL_MAX (${env.dbPoolMax}).`,
    );
  }

  for (let index = 0; index < workerCount; index += 1) {
    const workerPoolMax = splitLimit(env.dbPoolMax, index, workerCount);
    const workerPoolMin = Math.min(
      workerPoolMax,
      splitLimit(env.dbPoolMin, index, workerCount),
    );

    cluster.fork({
      ...process.env,
      DB_POOL_MIN: String(workerPoolMin),
      DB_POOL_MAX: String(workerPoolMax),
    });
  }

  cluster.on("exit", (worker, code, signal) => {
    console.error(
      `Cluster worker ${worker.process.pid} exited (code=${code}, signal=${signal}).`,
    );
  });

  console.log(
    `Cluster mode listening on http://0.0.0.0:${env.clusterPort} with ${workerCount} workers; total DB pool max=${env.dbPoolMax}.`,
  );
}

const clusterMode = process.argv.includes("--cluster");
const readReplicaMode = process.argv.includes("--read-replica");

if (clusterMode && readReplicaMode) {
  throw new Error(
    "Cluster mode and read-replica mode are separate test modes.",
  );
} else if (readReplicaMode) {
  void start(env.replicaTestPort, true);
} else if (clusterMode && cluster.isPrimary) {
  startCluster();
} else {
  void start(clusterMode ? env.clusterPort : env.port);
}
