import { libsqlDb, serveMapMetered, period } from '@/lib/db';

// GET /api/maps/:site  — the METERED hot path for the hosted route.
// Requires X-Webnav-Key. Validates the key, enforces the monthly quota, records
// one usage row, and returns the map pack { node, states }. Map SKELETON ONLY —
// never credentials.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { site: string } }) {
  const key = req.headers.get('x-webnav-key');
  const ts = Date.now();
  const result = await serveMapMetered(libsqlDb(), key, params.site, ts, period(ts));
  if (result.status === 200) {
    return Response.json(result.pack, { status: 200, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ error: result.error }, { status: result.status });
}
