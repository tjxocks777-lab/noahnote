// Cloudflare Pages Function — 복습 알림 구독 관리
//  GET  /api/push?key=1                      → {key: 공개키}
//  POST /api/push {action:'sub'|'seen'|'off'|'test', id, ...}
import { j } from '../_lib/kv.js';
import { pushStore, vapid, sendTo, subMeta, okEndpoint } from '../_lib/push-lib.js';

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  if (request.method === 'GET') {
    if (u.searchParams.get('key')) return j({ key: (await vapid(env)).publicKey });
    return j({ error: 'bad request' }, 400);
  }
  if (request.method !== 'POST') return j({ error: 'method' }, 405);
  let b; try { b = await request.json(); } catch (e) { return j({ error: 'bad json' }, 400); }
  if (!b || !/^[\w-]{8,64}$/.test(b.id || '')) return j({ error: 'bad id' }, 400);
  const s = pushStore(env), key = 'sub:' + b.id;
  const old = await s.get(key, 'json');

  if (b.action === 'sub') {
    const sub = b.sub;
    if (!sub || typeof sub.endpoint !== 'string' || !okEndpoint(sub.endpoint) || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return j({ error: 'bad sub' }, 400);
    const hour = Math.max(0, Math.min(23, parseInt(b.hour, 10) || 0));
    const tz = Math.max(-840, Math.min(840, parseInt(b.tz, 10) || 0));
    const rec = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, hour, tz, day: (old && old.day) || '', studied: !!(old && old.studied), due: old ? old.due : null, sentAt: (old && old.sentAt) || 0, updated: Date.now() };
    await s.setJSON(key, rec, subMeta(rec));
    return j({ ok: true });
  }
  if (!old) return j({ error: 'not found' }, 404);
  if (b.action === 'seen') {
    const day = String(b.day || '').slice(0, 10), studied = !!b.studied, due = Number.isFinite(+b.due) ? +b.due : null;
    // 바뀐 게 없으면 저장하지 않는다 (KV 는 하루 쓰기 횟수에 한도가 있다)
    if (old.day === day && !!old.studied === studied && old.due === due) return j({ ok: true });
    old.day = day; old.studied = studied; old.due = due; old.updated = Date.now();
    await s.setJSON(key, old, subMeta(old)); return j({ ok: true });
  }
  if (b.action === 'off') { await s.delete(key); return j({ ok: true }); }
  if (b.action === 'test') {
    try { await sendTo(env, old, { title: 'NOAH NOTE', body: '알림이 잘 와요! 이 시간에 복습 알림을 보내드릴게요.', url: './' }, u.origin); return j({ ok: true }); }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await s.delete(key); return j({ error: 'send failed' }, 502); }
  }
  return j({ error: 'bad action' }, 400);
}
