import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/pool";

async function main(): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");

  await pool.query(schemaSql);
  console.log("Database schema initialized.");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize database schema:", error);
    process.exit(1);
  });
