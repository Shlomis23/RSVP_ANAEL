import { config } from "dotenv";
import { Client } from "pg";
config({ path: ".env.local", quiet: true });
const connection = new URL(process.env.DATABASE_URL_UNPOOLED ?? "");
connection.searchParams.delete("sslmode");
connection.searchParams.delete("channel_binding");
const db = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: true },
});
await db.connect();
const retention = Number(process.env.RETENTION_DAYS);
const apply = process.argv.includes("--apply");
try {
  const event = (
    await db.query("select id,event_date from events where slug=$1", [
      process.env.EVENT_SLUG ?? "anael",
    ])
  ).rows[0];
  if (!event) throw new Error("Event not found");
  const purge =
    Number.isInteger(retention) &&
    retention >= 1 &&
    Date.now() > new Date(event.event_date).getTime() + retention * 86400000;
  const expiredSessions = (
    await db.query(
      "select count(*)::int as total from browser_sessions where expires_at<now() or revoked_at is not null",
    )
  ).rows[0].total;
  const personalRecords = (
    await db.query(
      "select count(*)::int as total from rsvps where event_id=$1",
      [event.id],
    )
  ).rows[0].total;
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      expiredBrowserSessions: expiredSessions,
      purgePersonalData: purge,
      personalRecordsToDelete: purge ? personalRecords : 0,
    }),
  );
  if (!apply) process.exitCode = 0;
  else {
    await db.query("BEGIN");
    await db.query(
      "delete from browser_sessions where expires_at<now() or revoked_at is not null",
    );
    await db.query(
      "delete from admin_sessions where expires_at<now() or revoked_at is not null",
    );
    await db.query(
      "delete from rsvp_recovery_tokens where expires_at<now() or revoked_at is not null",
    );
    await db.query(
      "delete from rate_limits where window_start<now()-interval '1 day'",
    );
    if (purge) {
      await db.query("delete from duplicate_decisions where event_id=$1", [
        event.id,
      ]);
      await db.query("delete from admin_audit where event_id=$1", [event.id]);
      await db.query("delete from rsvps where event_id=$1", [event.id]);
    }
    await db.query("COMMIT");
  }
} catch (error) {
  if (apply) await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
