import { spawnSync } from "node:child_process";
import { pool } from "../src/db/pool";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with code ${result.status ?? "unknown"}.`,
    );
  }
}

async function main(): Promise<void> {
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  run(process.execPath, ["--import", "tsx", "./scripts/init-db.ts"]);

  const result = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM users) AS "hasUsers", EXISTS (SELECT 1 FROM posts) AS "hasPosts"',
  );
  const { hasUsers, hasPosts } = result.rows[0] as {
    hasUsers: boolean;
    hasPosts: boolean;
  };
  await pool.end();

  if (hasUsers && hasPosts) {
    console.log("Existing data found; skipping demo seed.");
    return;
  }

  console.log("No demo data found; seeding the default dataset.");
  run(process.execPath, ["--import", "tsx", "./scripts/seed.ts"]);
}

main().catch(async (error: unknown) => {
  console.error("Setup failed:", error);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
