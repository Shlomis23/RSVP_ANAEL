import "server-only";
import { pool } from "./db";
import { tokenHash } from "./crypto";

export async function adminSessionId(token: string | undefined) {
  const credential = process.env.ADMIN_PASSWORD_HASH;
  if (!token || !/^[\w-]{43}$/.test(token) || !credential) return null;
  const result = await pool().query<{ id: string }>(
    `select id from admin_sessions where session_hash=$1 and credential_version=$2
     and revoked_at is null and expires_at>now()`,
    [tokenHash(token), tokenHash(credential)],
  );
  return result.rows[0]?.id ?? null;
}
