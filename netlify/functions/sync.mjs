// Netlify Function (v2) — 기기 간 자동 동기화. 암호의 해시를 키로 데이터를 Netlify Blobs에 저장한다.
//  GET  ?k=KEY            → 데이터 JSON      GET ?k=KEY&meta=1 → {savedAt}
//  PUT  ?k=KEY            → 데이터 저장       PUT/GET ?k=KEY&att=ID → 첨부 사진(dataURL 텍스트)
import { getStore } from '@netlify/blobs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

export default async (req) => {
  const u = new URL(req.url);
  const k = u.searchParams.get('k') || '';
  if (!/^[a-f0-9]{64}$/.test(k)) return j({ error: 'bad key' }, 400);
  const att = u.searchParams.get('att');
  if (att !== null && !/^[\w-]{1,80}$/.test(att)) return j({ error: 'bad att id' }, 400);
  const store = getStore('noah-sync');
  const key = att ? `${k}:a:${att}` : k;

  if (req.method === 'GET') {
    if (!att && u.searchParams.get('meta')) {
      const m = await store.getMetadata(k);
      return m ? j({ savedAt: (m.metadata || {}).savedAt || '' }) : j({ error: 'not found' }, 404);
    }
    const v = await store.get(key);
    return v ? new Response(v, { status: 200, headers: att ? { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } : H }) : j({ error: 'not found' }, 404);
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > 5600000) return j({ error: 'too large' }, 413);
    if (att) { await store.set(key, text); return j({ ok: true }); }
    let o; try { o = JSON.parse(text); } catch (e) { return j({ error: 'bad json' }, 400); }
    if (!o || o.app !== 'noah-note' || !o.subjects) return j({ error: 'bad data' }, 400);
    await store.set(key, text, { metadata: { savedAt: String(o.savedAt || '') } });
    return j({ ok: true });
  }
  return j({ error: 'method' }, 405);
};

export const config = { path: '/api/sync' };
