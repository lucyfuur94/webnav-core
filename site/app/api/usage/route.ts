import { libsqlDb, period } from '@/lib/db';
import { quotaFor } from '@/lib/pricing';

// GET /api/usage — current period usage + quota for the calling key (X-Webnav-Key).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = req.headers.get('x-webnav-key');
  if (!key) return Response.json({ error: 'missing API key' }, { status: 401 });
  const db = libsqlDb();
  const row = await db.getKey(key);
  if (!row) return Response.json({ error: 'invalid API key' }, { status: 401 });
  const per = period(Date.now());
  const used = await db.usageCount(key, per);
  return Response.json({ tier: row.tier, period: per, used, limit: quotaFor(row.tier) });
}
