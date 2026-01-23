import pg from "pg";

const { Pool } = pg;

let _pool;

export function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }
  _pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : undefined,
  });
  return _pool;
}

