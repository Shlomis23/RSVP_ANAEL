import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";
config({ path: ".env.local", quiet: true });
const connection = new URL(
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
);
if (connection.hostname.includes("-pooler"))
  throw new Error("Migrations require DATABASE_URL_UNPOOLED");
connection.searchParams.delete("sslmode");
connection.searchParams.delete("channel_binding");
const client = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: true },
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("select pg_advisory_xact_lock(74832919)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  for (const file of (await readdir("db/migrations"))
    .filter((v) => v.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("select name from schema_migrations where name=$1", [
          file,
        ])
      ).rowCount
    )
      continue;
    await client.query(await readFile(`db/migrations/${file}`, "utf8"));
    await client.query("insert into schema_migrations(name) values ($1)", [
      file,
    ]);
    console.log(`Applied ${file}`);
  }
  await client.query(
    `insert into events(slug,title,event_date,location_name) values ('anael','חוגגים את אנאל','2026-10-18T19:30:00+03:00','אולם אצולת העמק, עפולה') on conflict(slug) do nothing`,
  );
  await client.query("COMMIT");
  console.log("Migrations complete; invitation event is ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
