import Fastify from "fastify";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { healthRoutes } from "./routes/health";
import { postsRoutes } from "./routes/posts";
import { usersRoutes } from "./routes/users";

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

async function start(): Promise<void> {
  try {
    await pool.query("SELECT 1");
    console.log("Database connection successful.");

    await app.listen({
      port: env.port,
      host: "0.0.0.0",
    });

    console.log(`Server listening on http://0.0.0.0:${env.port}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
