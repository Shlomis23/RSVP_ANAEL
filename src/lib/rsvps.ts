import type { Pool, PoolClient } from "pg";
import { pool, transaction } from "./db";
import { fail } from "./security";
import { tokenHash } from "./crypto";
import { normalizeName } from "./validation";
import type { Attendance, Rsvp } from "./event";

type Input = { fullName: string; attendance: Attendance; guestCount: number };
export const columns =
  "id,full_name,attendance,guest_count,version,source,created_at,updated_at";
export async function currentEvent(client: Pool | PoolClient = pool()) {
  const result = await client.query(
    `select id,slug,title,event_date,location_name,registration_closes_at,is_active from events where slug=$1`,
    [process.env.EVENT_SLUG ?? "anael"],
  );
  if (!result.rows[0]) return fail(404, "NOT_FOUND", "האירוע לא נמצא");
  return result.rows[0] as {
    id: string;
    slug: string;
    title: string;
    event_date: Date;
    location_name: string;
    registration_closes_at: Date | null;
    is_active: boolean;
  };
}
export async function assertOpen(client: PoolClient) {
  const event = await currentEvent(client);
  if (
    !event.is_active ||
    (event.registration_closes_at &&
      event.registration_closes_at.getTime() <= Date.now())
  ) {
    fail(403, "REGISTRATION_CLOSED", "ההרשמה לאירוע נסגרה");
  }
  return event;
}
export async function ownedRsvp(
  session: string,
  id: string,
  client: Pool | PoolClient = pool(),
) {
  const event = await currentEvent(client);
  const result = await client.query<Rsvp>(
    `select ${columns
      .split(",")
      .map((c) => `r.${c}`)
      .join(",")} from rsvps r
    join session_rsvps sr on sr.rsvp_id=r.id join browser_sessions bs on bs.id=sr.session_id
    where r.id=$1 and sr.session_id=$2 and r.event_id=$3 and r.archived_at is null
    and bs.revoked_at is null and bs.expires_at>now()`,
    [id, session, event.id],
  );
  if (!result.rows[0])
    return fail(
      404,
      "NOT_FOUND",
      "האישור אינו זמין. נסו שוב מאותו דפדפן שבו מילאתם אותו",
    );
  return result.rows[0];
}
export async function createRsvp(
  session: string,
  input: Input & { requestKey: string },
) {
  return transaction(async (client) => {
    const event = await assertOpen(client);
    // Serialize retries even if the first HTTP response was lost.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${event.id}:${input.requestKey}`,
    ]);
    const previous = await client.query<{ id: string }>(
      "select id from rsvps where event_id=$1 and request_key=$2",
      [event.id, input.requestKey],
    );
    if (previous.rows[0])
      return {
        rsvp: await ownedRsvp(session, previous.rows[0].id, client),
        replayed: true,
      };
    const validSession = await client.query(
      "select id from browser_sessions where id=$1 and revoked_at is null and expires_at>now() for update",
      [session],
    );
    if (!validSession.rowCount) fail(401, "UNAUTHORIZED", "ההרשאה פגה");
    const existing = await client.query(
      `select r.id from rsvps r join session_rsvps sr on sr.rsvp_id=r.id where sr.session_id=$1 and r.event_id=$2 and r.archived_at is null limit 1`,
      [session, event.id],
    );
    if (existing.rowCount)
      fail(
        409,
        "EXISTING_RSVP",
        "כבר קיים אישור בדפדפן הזה. יש לערוך את האישור הקיים",
      );
    const result = await client.query<Rsvp>(
      `insert into rsvps(event_id,full_name,normalized_name,attendance,guest_count,request_key)
      values($1,$2,$3,$4,$5,$6) returning ${columns}`,
      [
        event.id,
        input.fullName,
        normalizeName(input.fullName),
        input.attendance,
        input.guestCount,
        input.requestKey,
      ],
    );
    const rsvp = result.rows[0];
    await client.query(
      "insert into session_rsvps(session_id,rsvp_id) values($1,$2)",
      [session, rsvp.id],
    );
    return { rsvp, replayed: false };
  });
}
export async function updateRsvp(
  session: string,
  id: string,
  input: Input & { expectedVersion: number },
) {
  return transaction(async (client) => {
    await assertOpen(client);
    await ownedRsvp(session, id, client);
    const result = await client.query<Rsvp>(
      `update rsvps set full_name=$1,normalized_name=$2,attendance=$3,guest_count=$4
      where id=$5 and version=$6 and archived_at is null returning ${columns}`,
      [
        input.fullName,
        normalizeName(input.fullName),
        input.attendance,
        input.guestCount,
        id,
        input.expectedVersion,
      ],
    );
    if (!result.rows[0])
      return fail(
        409,
        "VERSION_CONFLICT",
        "האישור השתנה בינתיים. טענו אותו מחדש לפני עדכון",
      );
    return result.rows[0];
  });
}
export async function claimRsvp(session: string, token: string) {
  return transaction(async (client) => {
    const event = await currentEvent(client);
    const result = await client.query<{ rsvp_id: string }>(
      `select rt.rsvp_id from rsvp_recovery_tokens rt join rsvps r on r.id=rt.rsvp_id
      where rt.token_hash=$1 and rt.revoked_at is null and rt.expires_at>now() and r.archived_at is null and r.event_id=$2 for update of r,rt`,
      [tokenHash(token), event.id],
    );
    if (!result.rows[0])
      return fail(
        401,
        "INVALID_EDIT_TOKEN",
        "קישור השחזור אינו תקף או שפג תוקפו",
      );
    await client.query(
      "insert into session_rsvps(session_id,rsvp_id) values($1,$2) on conflict do nothing",
      [session, result.rows[0].rsvp_id],
    );
    return ownedRsvp(session, result.rows[0].rsvp_id, client);
  });
}
export async function audit(
  client: PoolClient,
  event: string,
  action: string,
  id: string | null,
  details: unknown,
) {
  const result = await client.query<{ id: string }>(
    "insert into admin_audit(event_id,action,rsvp_id,details) values($1,$2,$3,$4) returning id",
    [event, action, id, JSON.stringify(details)],
  );
  return result.rows[0].id;
}
export async function archiveRsvp(client: PoolClient, id: string) {
  await client.query("update rsvps set archived_at=now() where id=$1", [id]);
  await client.query("delete from session_rsvps where rsvp_id=$1", [id]);
  await client.query(
    "update rsvp_recovery_tokens set revoked_at=now() where rsvp_id=$1",
    [id],
  );
}
