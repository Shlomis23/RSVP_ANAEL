import { NextRequest } from "next/server";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { newToken, passwordMatches, tokenHash } from "@/lib/crypto";
import {
  createInput,
  idInput,
  nameSimilarity,
  normalizeName,
  rsvpInput,
  updateInput,
} from "@/lib/validation";
import { attendanceLabels, invitation, type Rsvp } from "@/lib/event";
import {
  ApiError,
  adminCookie,
  assertOrigin,
  body,
  ensureSession,
  fail,
  getSession,
  json,
  rateLimit,
  requireAdmin,
  requireSession,
  sessionCookie,
  setCookie,
} from "@/lib/security";
import {
  archiveRsvp,
  audit,
  claimRsvp,
  columns,
  createRsvp,
  currentEvent,
  ownedRsvp,
  rotateRecovery,
  updateRsvp,
} from "@/lib/rsvps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const recoveryUrl = (token: string | null, request: NextRequest) =>
  token ? `${assertOrigin(request)}/edit#token=${token}` : null;
const rowId = (value: string) => {
  if (!idInput.safeParse(value).success)
    fail(404, "NOT_FOUND", "האישור לא נמצא");
  return value;
};

function filters(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const status = request.nextUrl.searchParams.get("status") ?? "";
  const page = Math.max(
    1,
    Math.min(100000, Number(request.nextUrl.searchParams.get("page")) || 1),
  );
  if (status && !["yes", "no", "maybe"].includes(status))
    fail(400, "VALIDATION_ERROR", "סינון לא תקין");
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  return { q: `%${escaped}%`, status, page: Math.floor(page) };
}

async function dispatch(request: NextRequest, context: Context) {
  const path = (await context.params).path;
  const method = request.method;
  if (["POST", "PATCH", "DELETE"].includes(method)) assertOrigin(request);

  if (path.join("/") === "event" && method === "GET") {
    const event = await currentEvent();
    return json({
      ...invitation,
      title: event.title,
      eventDate: event.event_date,
      locationName: event.location_name,
      registrationClosesAt: event.registration_closes_at,
      open:
        event.is_active &&
        (!event.registration_closes_at ||
          event.registration_closes_at.getTime() > Date.now()),
    });
  }
  if (path.join("/") === "session" && method === "POST") {
    await rateLimit(request, "session", 120);
    const session = await ensureSession(request);
    const response = json({ ready: true });
    if (session.token)
      setCookie(response, sessionCookie(), session.token, 30 * 86400);
    return response;
  }
  if (path.join("/") === "rsvps/mine" && method === "GET") {
    const session = await getSession(request);
    if (!session) return json({ rsvps: [] });
    const event = await currentEvent();
    const result = await pool().query(
      `select r.id,r.full_name,r.attendance from rsvps r join session_rsvps sr on sr.rsvp_id=r.id
      where sr.session_id=$1 and r.event_id=$2 and r.archived_at is null order by r.created_at`,
      [session, event.id],
    );
    return json({ rsvps: result.rows });
  }
  if (path.join("/") === "rsvps" && method === "POST") {
    const session = await requireSession(request);
    await rateLimit(request, "create", 30, 600, session);
    await rateLimit(request, "create-global", 300);
    const result = await createRsvp(session, await body(request, createInput));
    return json(
      {
        ...result,
        recoveryToken: undefined,
        recoveryUrl: recoveryUrl(result.recoveryToken, request),
      },
      result.replayed ? 200 : 201,
    );
  }
  if (path.join("/") === "rsvps/claim" && method === "POST") {
    await rateLimit(request, "claim", 30);
    const input = await body(
      request,
      z.object({ token: z.string().regex(/^[\w-]{43}$/) }),
    );
    const session = await ensureSession(request);
    const rsvp = await claimRsvp(session.id, input.token);
    const response = json({ rsvp });
    if (session.token)
      setCookie(response, sessionCookie(), session.token, 30 * 86400);
    return response;
  }
  if (path[0] === "rsvps" && path.length >= 2) {
    const id = rowId(path[1]);
    const session = await requireSession(request);
    if (path.length === 2 && method === "GET")
      return json({ rsvp: await ownedRsvp(session, id) });
    if (path.length === 2 && method === "PATCH") {
      await rateLimit(request, "update", 60, 600, session);
      return json({
        rsvp: await updateRsvp(session, id, await body(request, updateInput)),
      });
    }
    if (path[2] === "recovery" && path.length === 3 && method === "POST") {
      await rateLimit(request, "recovery", 10, 600, session);
      return json({
        recoveryUrl: recoveryUrl(await rotateRecovery(session, id), request),
      });
    }
  }

  if (path.join("/") === "admin/login" && method === "POST") {
    await rateLimit(request, "login", 10);
    const input = await body(
      request,
      z.object({ password: z.string().min(1).max(200) }),
    );
    const credential = process.env.ADMIN_PASSWORD_HASH;
    if (!credential)
      return fail(503, "CONFIGURATION_ERROR", "יש להגדיר סיסמת ניהול בשרת");
    if (!passwordMatches(input.password, credential))
      return fail(401, "UNAUTHORIZED", "הסיסמה אינה נכונה");
    const token = newToken();
    await pool().query(
      "insert into admin_sessions(session_hash,credential_version,expires_at) values($1,$2,now()+interval '8 hours')",
      [tokenHash(token), tokenHash(credential)],
    );
    const response = json({ ok: true });
    setCookie(response, adminCookie(), token, 8 * 3600);
    return response;
  }
  if (path[0] === "admin") {
    const admin = await requireAdmin(request);
    const event = await currentEvent();
    if (["POST", "PATCH", "DELETE"].includes(method))
      await rateLimit(request, "admin-write", 300, 600, admin);
    if (path.join("/") === "admin/logout" && method === "POST") {
      await pool().query(
        "update admin_sessions set revoked_at=now() where id=$1",
        [admin],
      );
      const response = json({ ok: true });
      setCookie(response, adminCookie(), "", 0);
      return response;
    }
    if (path.join("/") === "admin/event" && method === "PATCH") {
      const input = await body(
        request,
        z.object({
          isActive: z.boolean(),
          registrationClosesAt: z.iso.datetime({ offset: true }).nullable(),
        }),
      );
      const auditId = await transaction(async (client) => {
        await client.query(
          "update events set is_active=$1,registration_closes_at=$2 where id=$3",
          [input.isActive, input.registrationClosesAt, event.id],
        );
        return audit(client, event.id, "registration_settings", null, input);
      });
      return json({ ok: true, auditId });
    }
    if (path.join("/") === "admin/rsvps" && method === "GET") {
      const f = filters(request);
      const where =
        "event_id=$1 and archived_at is null and full_name ilike $2 and ($3='' or attendance=$3)";
      const [rows, count, stats] = await Promise.all([
        pool().query(
          `select ${columns} from rsvps where ${where} order by created_at desc,id limit 50 offset $4`,
          [event.id, f.q, f.status, (f.page - 1) * 50],
        ),
        pool().query(
          `select count(*)::int as total from rsvps where ${where}`,
          [event.id, f.q, f.status],
        ),
        pool().query(
          `select count(*)::int as responses,coalesce(sum(guest_count) filter(where attendance='yes'),0)::int as guests,
          count(*) filter(where attendance='yes')::int as yes,count(*) filter(where attendance='no')::int as no,
          count(*) filter(where attendance='maybe')::int as maybe from rsvps where event_id=$1 and archived_at is null`,
          [event.id],
        ),
      ]);
      return json({
        rsvps: rows.rows,
        total: count.rows[0].total,
        page: f.page,
        pageSize: 50,
        stats: stats.rows[0],
        event: {
          isActive: event.is_active,
          registrationClosesAt: event.registration_closes_at,
        },
      });
    }
    if (path.join("/") === "admin/rsvps" && method === "POST") {
      const input = await body(request, rsvpInput);
      const rsvp = await transaction(async (client) => {
        const result = await client.query<Rsvp>(
          `insert into rsvps(event_id,full_name,normalized_name,attendance,guest_count,source) values($1,$2,$3,$4,$5,'admin') returning ${columns}`,
          [
            event.id,
            input.fullName,
            normalizeName(input.fullName),
            input.attendance,
            input.guestCount,
          ],
        );
        await audit(client, event.id, "create", result.rows[0].id, {
          after: result.rows[0],
        });
        return result.rows[0];
      });
      return json({ rsvp }, 201);
    }
    if (
      path[1] === "rsvps" &&
      path.length === 3 &&
      ["PATCH", "DELETE"].includes(method)
    ) {
      const id = rowId(path[2]);
      const input =
        method === "PATCH"
          ? await body(request, updateInput)
          : await body(
              request,
              z.object({
                expectedVersion: z.number().int().positive(),
                confirmed: z.literal(true),
              }),
            );
      const rsvp = await transaction(async (client) => {
        const existing = await client.query<Rsvp>(
          `select ${columns} from rsvps where id=$1 and event_id=$2 and archived_at is null for update`,
          [id, event.id],
        );
        if (!existing.rows[0]) return fail(404, "NOT_FOUND", "האישור לא נמצא");
        if (existing.rows[0].version !== input.expectedVersion)
          return fail(409, "VERSION_CONFLICT", "האישור השתנה. רעננו את הרשימה");
        if ("fullName" in input) {
          const result = await client.query<Rsvp>(
            `update rsvps set full_name=$1,normalized_name=$2,attendance=$3,guest_count=$4 where id=$5 returning ${columns}`,
            [
              input.fullName,
              normalizeName(input.fullName),
              input.attendance,
              input.guestCount,
              id,
            ],
          );
          await audit(client, event.id, "update", id, {
            before: existing.rows[0],
            after: result.rows[0],
          });
          return result.rows[0];
        }
        await archiveRsvp(client, id);
        await audit(client, event.id, "archive", id, {
          before: existing.rows[0],
        });
        return null;
      });
      return json({ rsvp, ok: true });
    }
    if (path.join("/") === "admin/duplicates" && method === "GET") {
      const records = await pool().query<Rsvp & { normalized_name: string }>(
        `select ${columns},normalized_name from rsvps where event_id=$1 and archived_at is null order by id limit 2001`,
        [event.id],
      );
      if (records.rows.length > 2000)
        fail(422, "TOO_MANY_RECORDS", "סקירת דמיון מוגבלת ל־2,000 אישורים");
      const decisions = await pool().query(
        "select first_id,second_id,first_version,second_version from duplicate_decisions where event_id=$1 and decision='not_duplicate'",
        [event.id],
      );
      const ignored = new Set(
        decisions.rows.map(
          (r) =>
            `${r.first_id}:${r.second_id}:${r.first_version}:${r.second_version}`,
        ),
      );
      const pairs: { first: Rsvp; second: Rsvp; score: number }[] = [];
      for (let i = 0; i < records.rows.length; i++)
        for (let j = i + 1; j < records.rows.length; j++) {
          const a = records.rows[i],
            b = records.rows[j];
          if (ignored.has(`${a.id}:${b.id}:${a.version}:${b.version}`))
            continue;
          if (
            Math.abs(a.normalized_name.length - b.normalized_name.length) >
            Math.max(a.normalized_name.length, b.normalized_name.length) * 0.18
          )
            continue;
          const score = nameSimilarity(a.normalized_name, b.normalized_name);
          if (score >= 0.85) pairs.push({ first: a, second: b, score });
        }
      pairs.sort((a, b) => b.score - a.score);
      return json({ pairs: pairs.slice(0, 100), total: pairs.length });
    }
    if (path.join("/") === "admin/duplicates" && method === "POST") {
      const input = await body(
        request,
        z.object({
          firstId: z.uuid(),
          secondId: z.uuid(),
          firstVersion: z.number().int().positive(),
          secondVersion: z.number().int().positive(),
          decision: z.enum(["not_duplicate", "merge"]),
          winnerId: z.uuid().optional(),
          confirmed: z.literal(true),
        }),
      );
      if (input.firstId === input.secondId)
        fail(400, "VALIDATION_ERROR", "יש לבחור שני אישורים שונים");
      await transaction(async (client) => {
        const ids = [input.firstId, input.secondId].sort();
        const records = await client.query<Rsvp>(
          `select ${columns} from rsvps where id=any($1::uuid[]) and event_id=$2 and archived_at is null order by id for update`,
          [ids, event.id],
        );
        if (records.rows.length !== 2)
          fail(404, "NOT_FOUND", "אחד האישורים אינו זמין");
        const first = records.rows.find((r) => r.id === input.firstId)!;
        const second = records.rows.find((r) => r.id === input.secondId)!;
        if (
          first.version !== input.firstVersion ||
          second.version !== input.secondVersion
        )
          fail(409, "VERSION_CONFLICT", "האישורים השתנו. רעננו את הרשימה");
        if (input.decision === "merge") {
          if (!input.winnerId || !ids.includes(input.winnerId))
            fail(400, "VALIDATION_ERROR", "בחרו אישור לשמירה");
          const loser = ids.find((id) => id !== input.winnerId)!;
          await archiveRsvp(client, loser);
          await audit(client, event.id, "merge", input.winnerId!, {
            winnerId: input.winnerId,
            archivedId: loser,
            before: [first, second],
            countsAdded: false,
          });
        } else
          await audit(client, event.id, "not_duplicate", first.id, {
            firstId: first.id,
            secondId: second.id,
            before: [first, second],
          });
        await client.query(
          `insert into duplicate_decisions(event_id,first_id,second_id,decision,first_version,second_version)
          values($1,$2,$3,$4,$5,$6) on conflict(event_id,first_id,second_id) do update set decision=excluded.decision,first_version=excluded.first_version,second_version=excluded.second_version,created_at=now()`,
          [
            event.id,
            ids[0],
            ids[1],
            input.decision === "merge" ? "merged" : "not_duplicate",
            records.rows[0].version,
            records.rows[1].version,
          ],
        );
      });
      return json({ ok: true });
    }
    if (path.join("/") === "admin/export" && method === "GET") {
      const { default: ExcelJS } = await import("exceljs");
      const f = filters(request);
      const result = await pool().query<Rsvp>(
        `select ${columns} from rsvps where event_id=$1 and archived_at is null and full_name ilike $2 and ($3='' or attendance=$3) order by created_at desc,id limit 10001`,
        [event.id, f.q, f.status],
      );
      if (result.rows.length > 10000)
        fail(
          422,
          "EXPORT_LIMIT",
          "צמצמו את הסינון לפני ייצוא מעל 10,000 אישורים",
        );
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("אישורי הגעה", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
      });
      sheet.columns = [
        { header: "שם מלא", key: "name", width: 30 },
        { header: "סטטוס", key: "status", width: 18 },
        { header: "מספר מגיעים", key: "count", width: 18 },
        { header: "מקור", key: "source", width: 15 },
        { header: "נוצר בתאריך", key: "created", width: 25 },
        { header: "עודכן בתאריך", key: "updated", width: 25 },
      ];
      const date = (v: string) =>
        new Intl.DateTimeFormat("he-IL", {
          timeZone: "Asia/Jerusalem",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(v));
      for (const r of result.rows)
        sheet.addRow({
          name: r.full_name,
          status: attendanceLabels[r.attendance],
          count: r.guest_count,
          source: r.source === "guest" ? "אורח" : "מנהלת",
          created: date(r.created_at),
          updated: date(r.updated_at),
        });
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF935A68" },
      };
      const summary = workbook.addWorksheet("סיכום", {
        views: [{ rightToLeft: true }],
      });
      summary.columns = [
        { header: "מדד", width: 30 },
        { header: "כמות", width: 18 },
      ];
      summary.addRows([
        ["מספר אישורים בייצוא", result.rows.length],
        [
          "סך משתתפים מגיעים",
          result.rows.reduce((sum, r) => sum + r.guest_count, 0),
        ],
        ["לא מגיעים", result.rows.filter((r) => r.attendance === "no").length],
        ["מתלבטים", result.rows.filter((r) => r.attendance === "maybe").length],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": "attachment; filename=anael-rsvp.xlsx",
          "Cache-Control": "no-store",
        },
      });
    }
    if (path.join("/") === "admin/audit" && method === "GET") {
      const rows = await pool().query(
        `select a.id,a.action,a.rsvp_id,a.details,a.created_at,
            r.full_name as current_name,f.full_name as first_current_name,s.full_name as second_current_name
           from (select * from admin_audit where event_id=$1 order by created_at desc,id desc limit 100) a
           left join rsvps r on r.id=a.rsvp_id and r.event_id=a.event_id
           left join rsvps f on f.id::text=a.details->>'firstId' and f.event_id=a.event_id
           left join rsvps s on s.id::text=a.details->>'secondId' and s.event_id=a.event_id
           order by a.created_at desc,a.id desc`,
        [event.id],
      );
      return json({ entries: rows.rows });
    }
  }
  return fail(404, "NOT_FOUND", "הנתיב לא נמצא");
}
async function handle(request: NextRequest, context: Context) {
  try {
    return await dispatch(request, context);
  } catch (error) {
    if (error instanceof ApiError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    // Never log request bodies, database URLs, passwords or recovery/session tokens.
    console.error("RSVP request failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "לא הצלחנו להשלים את הפעולה. נסו שוב",
        },
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
