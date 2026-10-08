import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "./db";
import { newToken, tokenHash } from "./crypto";
import { allowedOrigins } from "./origins";
import { adminSessionId } from "./admin-session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function secureCookies() {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.COOKIE_SECURE === "true";
}
export const sessionCookie = () =>
  secureCookies() ? "__Host-rsvp_session" : "rsvp_session";
export const adminCookie = () =>
  secureCookies() ? "__Host-rsvp_admin" : "rsvp_admin";
export function setCookie(
  response: NextResponse,
  name: string,
  token: string,
  maxAge: number,
) {
  response.cookies.set(name, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
export function assertOrigin(request: NextRequest) {
  const configured = allowedOrigins();
  const origin = request.headers.get("origin");
  if (!configured.size)
    fail(503, "CONFIGURATION_ERROR", "המערכת עדיין לא הוגדרה לפרסום");
  if (!origin || !configured.has(origin))
    fail(403, "FORBIDDEN", "הבקשה אינה מורשית");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    fail(403, "FORBIDDEN", "הבקשה אינה מורשית");
  return origin!;
}
export async function body<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(400, "VALIDATION_ERROR", "פורמט הבקשה אינו תקין");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "VALIDATION_ERROR", "הבקשה ריקה");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader!.cancel();
      fail(413, "VALIDATION_ERROR", "הבקשה גדולה מדי");
    }
    chunks.push(value);
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail(400, "VALIDATION_ERROR", "הבקשה אינה תקינה");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return fail(400, "VALIDATION_ERROR", "בדקו את השם, הסטטוס וכמות המשתתפים");
  return parsed.data;
}
export async function rateLimit(
  request: NextRequest,
  action: string,
  max: number,
  seconds = 600,
  subject?: string,
) {
  // Vercel overwrites x-forwarded-for. Other deployments use a shared bucket rather than trusting client-supplied IPs.
  const ip = process.env.VERCEL
    ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown")
    : "shared";
  const key = tokenHash(`${action}:${subject ?? ip}`);
  const start = new Date(
    Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000,
  );
  const result = await pool().query<{ hits: number }>(
    `insert into rate_limits(key_hash,window_start,hits) values ($1,$2,1)
    on conflict(key_hash,window_start) do update set hits=rate_limits.hits+1 returning hits`,
    [key, start],
  );
  if (result.rows[0].hits > max)
    fail(429, "RATE_LIMITED", "בוצעו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות");
}
export async function getSession(request: NextRequest) {
  const token = request.cookies.get(sessionCookie())?.value;
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const result = await pool().query<{ id: string }>(
    `select id from browser_sessions where session_hash=$1 and revoked_at is null and expires_at>now()`,
    [tokenHash(token)],
  );
  return result.rows[0]?.id ?? null;
}
export async function ensureSession(request: NextRequest) {
  const existing = await getSession(request);
  if (existing) return { id: existing, token: null };
  const token = newToken();
  const result = await pool().query<{ id: string }>(
    `insert into browser_sessions(session_hash,expires_at) values ($1,now()+interval '30 days') returning id`,
    [tokenHash(token)],
  );
  return { id: result.rows[0].id, token };
}
export async function requireSession(request: NextRequest) {
  const id = await getSession(request);
  if (!id)
    return fail(
      401,
      "UNAUTHORIZED",
      "לא ניתן לזהות את האישור בדפדפן הזה. נסו את הדפדפן שבו מילאתם אותו",
    );
  return id;
}
export async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(adminCookie())?.value;
  const id = await adminSessionId(token);
  if (!id) return fail(401, "UNAUTHORIZED", "יש להיכנס מחדש למסך הניהול");
  return id;
}
