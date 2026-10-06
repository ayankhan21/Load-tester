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

export const env = {
  port: getNumber("PORT", 3000),
  dbHost: process.env.DB_HOST ?? "localhost",
  dbPort: getNumber("DB_PORT", 5432),
  dbName: process.env.DB_NAME ?? "social",
  dbUser: process.env.DB_USER ?? "postgres",
  dbPassword: process.env.DB_PASSWORD ?? "postgres",
  dbPoolMin: getNumber("DB_POOL_MIN", 2),
  dbPoolMax: getNumber("DB_POOL_MAX", 20),
};
