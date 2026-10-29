// Netlify Function (v2) — 복습 알림 구독 관리
//  GET  /api/push?key=1                      → {key: 공개키}
//  POST /api/push {action:'sub'|'seen'|'off'|'test', id, ...}
import { pushStore, vapid, sendTo } from '../lib/push-lib.mjs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: H });

export default async (req) => {
  const u = new URL(req.url);
  if (req.method === 'GET') {
    if (u.searchParams.get('key')) return j({ key: (await vapid()).publicKey });
    return j({ error: 'bad request' }, 400);
  }
  if (req.method !== 'POST') return j({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return j({ error: 'bad json' }, 400); }
  if (!b || !/^[\w-]{8,64}$/.test(b.id || '')) return j({ error: 'bad id' }, 400);
  const s = pushStore(), key = 'sub:' + b.id;
  const old = await s.get(key, { type: 'json' });

  if (b.action === 'sub') {
    const sub = b.sub;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return j({ error: 'bad sub' }, 400);
    const hour = Math.max(0, Math.min(23, parseInt(b.hour, 10) || 0));
    const tz = Math.max(-840, Math.min(840, parseInt(b.tz, 10) || 0));
    await s.setJSON(key, { sub, hour, tz, day: (old && old.day) || '', studied: !!(old && old.studied), due: old ? old.due : null, updated: Date.now() });
    return j({ ok: true });
  }
  if (!old) return j({ error: 'not found' }, 404);
  if (b.action === 'seen') {
    old.day = String(b.day || '').slice(0, 10); old.studied = !!b.studied; old.due = Number.isFinite(+b.due) ? +b.due : null; old.updated = Date.now();
    await s.setJSON(key, old); return j({ ok: true });
  }
  if (b.action === 'off') { await s.delete(key); return j({ ok: true }); }
  if (b.action === 'test') {
    try { await sendTo(old, { title: 'NOAH NOTE', body: '알림이 잘 와요! 이 시간에 복습 알림을 보내드릴게요.', url: './' }); return j({ ok: true }); }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await s.delete(key); return j({ error: 'send failed' }, 502); }
  }
  return j({ error: 'bad action' }, 400);
};

export const config = { path: '/api/push' };
