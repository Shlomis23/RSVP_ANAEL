import { config } from "dotenv";
import { request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import ExcelJS from "exceljs";
import { Client } from "pg";
import { tokenHash, newToken } from "../src/lib/crypto";
config({ path: ".env.local", quiet: true });
config({ path: "work/.env.tests", quiet: true });
if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production")
  throw new Error("Integration tests require a development branch");
const origin = process.env.APP_ORIGIN!;
const prefix = `בדיקה ${randomUUID().slice(0, 8)}`;
const connection = new URL(process.env.DATABASE_URL_UNPOOLED!);
connection.searchParams.delete("sslmode");
connection.searchParams.delete("channel_binding");
const db = new Client({
  connectionString: connection.toString(),
  ssl: { rejectUnauthorized: true },
});
await db.connect();
const contexts: APIRequestContext[] = [];
const created: string[] = [];
const settingsAuditIds: string[] = [];
const originalEvent = (
  await db.query(
    "select is_active,registration_closes_at from events where slug='anael'",
  )
).rows[0];
async function context() {
  const c = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  contexts.push(c);
  return c;
}
async function call(
  c: APIRequestContext,
  path: string,
  method = "GET",
  data?: unknown,
  expected = 200,
) {
  const result = await c.fetch(`/api/${path}`, { method, data });
  assert.equal(
    result.status(),
    expected,
    `${method} ${path}: unexpected status ${result.status()}`,
  );
  return result;
}
const make = (name: string, count = 4) => ({
  fullName: `${prefix} ${name}`,
  attendance: "yes",
  guestCount: count,
  requestKey: randomUUID(),
});
try {
  const guest = await context();
  const other = await context();
  const admin = await context();
  await call(other, "admin/rsvps", "GET", undefined, 401);
  await call(other, "admin/export", "GET", undefined, 401);
  const malicious = await context();
  const csrf = await malicious.post("/api/session", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(csrf.status(), 403);
  await call(guest, "session", "POST");
  const input = make("ראשון");
  const first = await (await call(guest, "rsvps", "POST", input, 201)).json();
  created.push(first.rsvp.id);
  assert.ok(first.recoveryUrl.includes("#token="));
  assert.equal(first.rsvp.guest_count, 4);
  const retry = await Promise.all(
    [0, 1, 2].map(
      async () => await (await call(guest, "rsvps", "POST", input)).json(),
    ),
  );
  for (const replay of retry) {
    assert.equal(replay.rsvp.id, first.rsvp.id);
    assert.equal(replay.recoveryUrl, null);
  }
  const count = await db.query(
    "select count(*)::int as count from rsvps where id=$1",
    [first.rsvp.id],
  );
  assert.equal(count.rows[0].count, 1);
  console.log("PASS atomic creation and concurrent idempotent retries");
  await call(other, `rsvps/${first.rsvp.id}`, "GET", undefined, 401);
  await call(other, "session", "POST");
  await call(other, `rsvps/${first.rsvp.id}`, "GET", undefined, 404);
  const second = await (
    await call(guest, "rsvps", "POST", make("שני", 3), 201)
  ).json();
  created.push(second.rsvp.id);
  const mine = (await (await call(guest, "rsvps/mine")).json()).rsvps;
  assert.equal(mine.length, 2);
  await call(guest, `rsvps/${first.rsvp.id}`, "PATCH", {
    ...input,
    guestCount: 2,
    expectedVersion: 1,
  });
  const firstLoaded = (
    await (await call(guest, `rsvps/${first.rsvp.id}`)).json()
  ).rsvp;
  assert.equal(firstLoaded.guest_count, 2);
  assert.equal(firstLoaded.version, 2);
  const secondLoaded = (
    await (await call(guest, `rsvps/${second.rsvp.id}`)).json()
  ).rsvp;
  assert.equal(secondLoaded.guest_count, 3);
  const concurrent = await Promise.all(
    [1, 2].map((count) =>
      guest.patch(`/api/rsvps/${first.rsvp.id}`, {
        data: { ...input, guestCount: count, expectedVersion: 2 },
      }),
    ),
  );
  assert.deepEqual(concurrent.map((r) => r.status()).sort(), [200, 409]);
  const updated = (await (await call(guest, `rsvps/${first.rsvp.id}`)).json())
    .rsvp;
  await call(guest, `rsvps/${first.rsvp.id}`, "PATCH", {
    ...input,
    attendance: "no",
    guestCount: 4,
    expectedVersion: updated.version,
  });
  assert.equal(
    (await (await call(guest, `rsvps/${first.rsvp.id}`)).json()).rsvp
      .guest_count,
    0,
  );
  console.log(
    "PASS ownership, multiple approvals, version conflicts and no/maybe counts",
  );
  const token = new URL(first.recoveryUrl).hash.slice("#token=".length);
  await call(other, "rsvps/claim", "POST", { token });
  assert.equal(
    (await (await call(other, `rsvps/${first.rsvp.id}`)).json()).rsvp.id,
    first.rsvp.id,
  );
  await call(other, "rsvps/claim", "POST", { token: newToken() }, 401);
  const rotated = await (
    await call(guest, `rsvps/${first.rsvp.id}/recovery`, "POST")
  ).json();
  assert.ok(rotated.recoveryUrl);
  await call(other, "rsvps/claim", "POST", { token }, 401);
  console.log(
    "PASS recovery on a new device and immediate recovery-token revocation",
  );
  await call(admin, "admin/login", "POST", {
    password: process.env.TEST_ADMIN_PASSWORD,
  });
  const manual = await (
    await call(
      admin,
      "admin/rsvps",
      "POST",
      { fullName: input.fullName, attendance: "yes", guestCount: 7 },
      201,
    )
  ).json();
  created.push(manual.rsvp.id);
  const listing = await (
    await call(admin, `admin/rsvps?q=${encodeURIComponent(prefix)}`)
  ).json();
  assert.equal(listing.total, 3);
  assert.ok(listing.stats.guests >= 10);
  const duplicates = await (await call(admin, "admin/duplicates")).json();
  const pair = duplicates.pairs.find(
    (p: { first: R; second: R }) =>
      [p.first.id, p.second.id].includes(first.rsvp.id) &&
      [p.first.id, p.second.id].includes(manual.rsvp.id),
  );
  assert.ok(pair);
  await call(admin, "admin/duplicates", "POST", {
    firstId: pair.first.id,
    secondId: pair.second.id,
    firstVersion: pair.first.version,
    secondVersion: pair.second.version,
    decision: "not_duplicate",
    confirmed: true,
  });
  const ignored = await (await call(admin, "admin/duplicates")).json();
  assert.ok(
    !ignored.pairs.some(
      (p: { first: R; second: R }) =>
        p.first.id === pair.first.id && p.second.id === pair.second.id,
    ),
  );
  await call(admin, "admin/duplicates", "POST", {
    firstId: pair.first.id,
    secondId: pair.second.id,
    firstVersion: pair.first.version,
    secondVersion: pair.second.version,
    decision: "merge",
    winnerId: manual.rsvp.id,
    confirmed: true,
  });
  await call(guest, `rsvps/${first.rsvp.id}`, "GET", undefined, 404);
  const winner = (
    await db.query("select guest_count from rsvps where id=$1", [
      manual.rsvp.id,
    ])
  ).rows[0];
  assert.equal(winner.guest_count, 7);
  const exported = await call(
    admin,
    `admin/export?q=${encodeURIComponent(prefix)}`,
  );
  const book = new ExcelJS.Workbook();
  const bytes = new Uint8Array(await exported.body());
  await book.xlsx.load(bytes.buffer);
  assert.equal(book.worksheets[0].rowCount, 3);
  assert.equal(book.worksheets[0].views[0].rightToLeft, true);
  const headers = book.worksheets[0].getRow(1).values;
  assert.ok(!JSON.stringify(headers).includes("token"));
  assert.equal(book.worksheets[1].getCell("B3").value, 10);
  const audit = await (await call(admin, "admin/audit")).json();
  assert.ok(
    audit.entries.some((r: { action: string }) => r.action === "merge"),
  );
  console.log(
    "PASS administrator CRUD, duplicate decisions/merge, audit and real XLSX export",
  );
  settingsAuditIds.push(
    (
      await (
        await call(admin, "admin/event", "PATCH", {
          isActive: false,
          registrationClosesAt: null,
        })
      ).json()
    ).auditId,
  );
  await call(guest, "rsvps", "POST", make("סגור"), 403);
  await call(
    guest,
    `rsvps/${second.rsvp.id}`,
    "PATCH",
    { ...make("שני"), expectedVersion: 1 },
    403,
  );
  settingsAuditIds.push(
    (
      await (
        await call(admin, "admin/event", "PATCH", {
          isActive: true,
          registrationClosesAt: new Date(Date.now() - 60000).toISOString(),
        })
      ).json()
    ).auditId,
  );
  await call(guest, "rsvps", "POST", make("פג"), 403);
  settingsAuditIds.push(
    (
      await (
        await call(admin, "admin/event", "PATCH", {
          isActive: true,
          registrationClosesAt: null,
        })
      ).json()
    ).auditId,
  );
  await call(admin, "admin/logout", "POST");
  await call(admin, "admin/rsvps", "GET", undefined, 401);
  console.log("PASS registration closure, deadline and logout revocation");
  const sessionState = await guest.storageState();
  const guestToken = sessionState.cookies.find((c) =>
    c.name.endsWith("rsvp_session"),
  )!.value;
  await db.query(
    "update browser_sessions set revoked_at=now() where session_hash=$1",
    [tokenHash(guestToken)],
  );
  await call(guest, `rsvps/${second.rsvp.id}`, "GET", undefined, 401);
  const rls = await db.query(
    "select relname,relrowsecurity from pg_class where relname=any($1)",
    [
      [
        "events",
        "rsvps",
        "browser_sessions",
        "session_rsvps",
        "rsvp_recovery_tokens",
        "admin_sessions",
      ],
    ],
  );
  assert.equal(rls.rowCount, 6);
  assert.ok(rls.rows.every((r) => r.relrowsecurity));
  const access = await db.query(
    "select grantee from information_schema.table_privileges where table_name='rsvps' and grantee='PUBLIC'",
  );
  assert.equal(access.rowCount, 0);
  const stored = await db.query(
    "select token_hash from rsvp_recovery_tokens where rsvp_id=$1",
    [second.rsvp.id],
  );
  assert.ok(stored.rows.every((r) => /^[a-f0-9]{64}$/.test(r.token_hash)));
  console.log(
    "PASS session revocation, RLS, public grant denial and hashed secrets",
  );
} finally {
  await db.query(
    "update events set is_active=$1,registration_closes_at=$2 where slug='anael'",
    [originalEvent.is_active, originalEvent.registration_closes_at],
  );
  await db.query(
    "delete from duplicate_decisions where first_id=any($1::uuid[]) or second_id=any($1::uuid[])",
    [created],
  );
  await db.query(
    "delete from admin_audit where rsvp_id=any($1::uuid[]) or id=any($2::uuid[])",
    [created, settingsAuditIds],
  );
  await db.query("delete from rsvps where id=any($1::uuid[])", [created]);
  for (const c of contexts) {
    const state = await c.storageState();
    for (const cookie of state.cookies) {
      if (cookie.name.endsWith("rsvp_session"))
        await db.query("delete from browser_sessions where session_hash=$1", [
          tokenHash(cookie.value),
        ]);
      if (cookie.name.endsWith("rsvp_admin"))
        await db.query("delete from admin_sessions where session_hash=$1", [
          tokenHash(cookie.value),
        ]);
    }
    await c.dispose();
  }
  await db.end();
}
type R = { id: string; version: number };
