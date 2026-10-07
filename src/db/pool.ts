import { Pool } from "pg";
import { env } from "../config/env";

if (env.readReplicaEnabled) {
  if (env.dbPoolPrimaryMax + env.dbPoolReplicaMax !== env.dbPoolMax) {
    throw new Error(
      `Replica pool limits must add up to DB_POOL_MAX (${env.dbPoolMax}).`,
    );
  }
  if (env.primaryReadPercent < 0 || env.primaryReadPercent > 100) {
    throw new Error("PRIMARY_READ_PERCENT must be between 0 and 100.");
  }
}

export const pool = new Pool({
  host: env.dbHost,
  port: env.dbPort,
  database: env.dbName,
  user: env.dbUser,
  password: env.dbPassword,
  min: env.dbPoolMin,
  max: env.readReplicaEnabled ? env.dbPoolPrimaryMax : env.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const replicaReadPool = env.readReplicaEnabled
  ? new Pool({
      host: env.readReplicaHost,
      port: env.readReplicaPort,
      database: env.dbName,
      user: env.dbUser,
      password: env.dbPassword,
      min: 0,
      max: env.dbPoolReplicaMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : undefined;

pool.on("error", (error) => {
  console.error("Unexpected primary PostgreSQL pool error:", error);
});

replicaReadPool?.on("error", (error) => {
  console.error("Unexpected replica PostgreSQL pool error:", error);
});

let feedReadSequence = 0;

export function getFeedReadPool(): {
  pool: Pool;
  source: "primary" | "replica";
} {
  if (!replicaReadPool) {
    return { pool, source: "primary" };
  }

  const routeToPrimary = feedReadSequence++ % 100 < env.primaryReadPercent;
  return routeToPrimary
    ? { pool, source: "primary" }
    : { pool: replicaReadPool, source: "replica" };
}

export async function closeDatabasePools(): Promise<void> {
  await Promise.all([pool.end(), replicaReadPool?.end()]);
}

export async function ensureDatabaseReady(): Promise<void> {
  await pool.query("SELECT 1");
}
