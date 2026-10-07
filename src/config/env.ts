import "dotenv/config";

function getNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return parsed;
}

const dbPoolMax = getNumber("DB_POOL_MAX", 20);

export const env = {
  port: getNumber("PORT", 3000),
  dbHost: process.env.DB_HOST ?? "localhost",
  dbPort: getNumber("DB_PORT", 5432),
  dbName: process.env.DB_NAME ?? "social",
  dbUser: process.env.DB_USER ?? "postgres",
  dbPassword: process.env.DB_PASSWORD ?? "postgres",
  dbPoolMin: getNumber("DB_POOL_MIN", 2),
  dbPoolMax,
  clusterPort: getNumber("CLUSTER_PORT", 3001),
  replicaTestPort: getNumber("REPLICA_TEST_PORT", 3002),
  readReplicaEnabled:
    process.env.READ_REPLICA_ENABLED === "true" ||
    process.argv.includes("--read-replica"),
  readReplicaHost: process.env.READ_REPLICA_HOST ?? "127.0.0.1",
  readReplicaPort: getNumber("READ_REPLICA_PORT", 5434),
  readReplicaUser: process.env.REPLICATION_USER ?? "social_replica",
  dbPoolPrimaryMax: getNumber(
    "DB_POOL_PRIMARY_MAX",
    dbPoolMax - Math.round(dbPoolMax * 0.6),
  ),
  dbPoolReplicaMax: getNumber(
    "DB_POOL_REPLICA_MAX",
    Math.round(dbPoolMax * 0.6),
  ),
  primaryReadPercent: getNumber("PRIMARY_READ_PERCENT", 30),
  feedCacheTtlMs: process.argv.includes("--no-cache")
    ? 0
    : getNumber("FEED_CACHE_TTL_MS", 10_000),
};
