// Cloudflare Pages Function — 기기 간 자동 동기화. 암호의 해시를 키로 데이터를 KV에 저장한다.
//  GET  ?k=KEY            → 데이터 JSON      GET ?k=KEY&meta=1 → {savedAt}
//  PUT  ?k=KEY            → 데이터 저장       PUT/GET ?k=KEY&att=ID → 첨부 사진(dataURL 텍스트)
//  PUT  ?k=KEY&expect=V   → 서버의 저장본이 V 일 때만 저장(아니면 409). 다른 기기가 그 사이 올린 내용을 덮어쓰지 않게 함. V='' 는 '서버가 비어 있을 때만'
// 무료 플랜은 요청당 CPU 10ms 라서 큰 JSON 을 통째로 파싱하지 않고 앞부분만 검사한다.
import { store, j, H } from '../_lib/kv.js';

const TEXT_H = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' };

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  const k = u.searchParams.get('k') || '';
  if (!/^[a-f0-9]{64}$/.test(k)) return j({ error: 'bad key' }, 400);
  const att = u.searchParams.get('att');
  if (att !== null && !/^[\w-]{1,80}$/.test(att)) return j({ error: 'bad att id' }, 400);
  const s = store(env, 'sync');
  const key = att ? `${k}:a:${att}` : k;

  if (request.method === 'GET') {
    if (!att && u.searchParams.get('meta')) {
      const m = await s.meta(k);
      return m ? j({ savedAt: m.savedAt || '' }) : j({ error: 'not found' }, 404);
    }
    const v = await s.get(key, 'stream');
    return v ? new Response(v, { status: 200, headers: att ? TEXT_H : H }) : j({ error: 'not found' }, 404);
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > 5600000) return j({ error: 'too large' }, 413);
    if (att) { await s.set(key, text); return j({ ok: true }); }
    const head = text.slice(0, 400);
    if (!/^\s*\{\s*"app"\s*:\s*"noah-note"/.test(head) || !/"subjects"\s*:/.test(head)) return j({ error: 'bad data' }, 400);
    const m = head.match(/"savedAt"\s*:\s*(?:"([^"]*)"|(\d+))/);
    const savedAt = m ? (m[1] !== undefined ? m[1] : m[2]) : '';
    const expect = u.searchParams.get('expect');
    if (expect !== null) {
      const m = await s.meta(k);
      const cur = m ? String(m.savedAt || '') : '';
      if (cur !== expect) return j({ error: 'conflict', savedAt: cur }, 409);
    }
    await s.set(key, text, { savedAt: String(savedAt).slice(0, 64) });
    return j({ ok: true });
  }
  return j({ error: 'method' }, 405);
}
