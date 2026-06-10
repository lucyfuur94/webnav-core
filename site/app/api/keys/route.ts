import { libsqlDb } from '@/lib/db';
import { randomBytes } from 'node:crypto';

// POST /api/keys — issue a FREE-tier API key. Body: { email?: string }.
// No PII required; email is optional (recovery/notices only). Returns the key
// once — the user pastes it into `webnav login <key>`.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function newKey(): string {
  return 'wn_live_' + randomBytes(18).toString('base64url');
}

export async function POST(req: Request) {
  let email: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.email === 'string' && body.email.includes('@')) email = body.email;
  } catch { /* empty body is fine */ }

  const key = newKey();
  await libsqlDb().putKey(key, 'free', email, Date.now());
  return Response.json({ key, tier: 'free' }, { status: 201 });
}
