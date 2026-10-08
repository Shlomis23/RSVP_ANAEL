import "server-only";
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const globalDb = globalThis as typeof globalThis & { rsvpPool?: Pool };
export function pool() {
  if (!globalDb.rsvpPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    const connection = new URL(url);
    connection.searchParams.delete("sslmode");
    connection.searchParams.delete("channel_binding");
    globalDb.rsvpPool = new Pool({
      connectionString: connection.toString(),
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    attachDatabasePool(globalDb.rsvpPool);
  }
  return globalDb.rsvpPool;
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
