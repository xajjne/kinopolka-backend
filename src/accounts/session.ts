import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
export const cookieName = 'filmets_session';
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function sessionHash(cookie?: string) {
  const token = cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? tokenHash(token) : null;
}
export async function sessionUser(db: DataSource, cookie?: string) {
  const hash = sessionHash(cookie);
  if (!hash) return null;
  const rows = await db.query<
    { id: number; nickname: string; admin: boolean }[]
  >(
    'SELECT a.id,a.nickname,a.is_admin AS admin FROM accounts a JOIN account_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT a.suspended',
    [hash],
  );
  return rows[0] ?? null;
}
export async function personalExclusions(db: DataSource, cookie?: string) {
  const user = await sessionUser(db, cookie);
  if (!user) return [];
  const rows = await db.query<{ title_id: number }[]>(
    "SELECT title_id FROM shelf_entries WHERE account_id=$1 AND (status <> 'planned' OR favorite OR rating IS NOT NULL)",
    [user.id],
  );
  return rows.map((r) => r.title_id);
}
