// Netlify Function (v2) — 기기 간 동기화. 암호의 해시를 키로 백업 JSON을 Netlify Blobs에 저장한다.
import { getStore } from '@netlify/blobs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

export default async (req) => {
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!/^[a-f0-9]{64}$/.test(k)) return j({ error: 'bad key' }, 400);
  const store = getStore('noah-sync');
  if (req.method === 'GET') {
    const v = await store.get(k);
    return v ? new Response(v, { status: 200, headers: H }) : j({ error: 'not found' }, 404);
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > 5600000) return j({ error: 'too large' }, 413);
    let o; try { o = JSON.parse(text); } catch (e) { return j({ error: 'bad json' }, 400); }
    if (!o || o.app !== 'noah-note' || !o.subjects) return j({ error: 'bad data' }, 400);
    await store.set(k, text);
    return j({ ok: true });
  }
  return j({ error: 'method' }, 405);
};

export const config = { path: '/api/sync' };
