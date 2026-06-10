import { libsqlDb } from '@/lib/db';

// GET /api/maps — public, unmetered list of available shared site maps.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // talks to Turso at request time; never prerender

export async function GET() {
  const sites = await libsqlDb().listMaps();
  return Response.json({ sites });
}
