// Cloudflare Pages Function — 스터디/학원 그룹: 닉네임과 학습 횟수 통계만 저장한다(문제·노트 내용은 저장하지 않음).
//  POST /api/group {action:'create'|'join'|'report'|'leave'|'kick'}
//  GET  /api/group?action=board&code=..        → 멤버 순위표
//  GET  /api/group?action=admin&code=..&ph=..  → 관리자 상세(진도 대시보드)
// 멤버마다 키 하나(g:코드:m:아이디)를 쓰고, 순위표에 필요한 요약은 KV 메타데이터에 같이 넣어 목록 한 번으로 읽는다.
import { store, j, mapLimit } from '../_lib/kv.js';

const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n, set) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => set[b % set.length]).join('');
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const cleanNick = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 12);
const num = (v, max = 100000) => Math.max(0, Math.min(max, Math.round(+v || 0)));
const validCode = (c) => /^[A-Z2-9]{6}$/.test(c || '');
const MAX_MEMBERS = 100;

// 순위표용 요약(메타데이터는 1KB 제한이라 짧게)
const summary = (m) => { const s = m.stats || {}; return { n: m.nick, d: s.day || '', t: s.today || 0, w: s.weekTotal || 0, s: s.streak || 0, m: s.mastered || 0 }; };
const idOf = (key) => key.slice(key.lastIndexOf(':') + 1);

// [{id, sum}] — 목록 한 번(메타데이터 포함)
async function members(s, code) {
  const ks = await s.list(`g:${code}:m:`);
  return ks.map((k) => ({ id: idOf(k.key), sum: k.metadata || {} }));
}

export async function onRequest({ request, env }) {
  const s = store(env, 'group');
  const u = new URL(request.url);
  if (request.method === 'GET') {
    const code = (u.searchParams.get('code') || '').toUpperCase(), action = u.searchParams.get('action');
    if (!validCode(code)) return j({ error: 'bad code' }, 400);
    const meta = await s.get(`g:${code}:meta`, 'json');
    if (!meta) return j({ error: 'not found' }, 404);
    if (action === 'board') {
      const me = u.searchParams.get('me') || '';
      if (!/^[a-f0-9]{16}$/.test(me)) return j({ error: 'not a member' }, 403);
      const mine = await s.get(`g:${code}:m:${me}`, 'json');           // 방금 저장한 내 정보는 목록보다 먼저 보이므로 직접 읽는다
      if (!mine) return j({ error: 'not a member' }, 403);
      const list = (await members(s, code)).filter((m) => m.id !== me);
      list.push({ id: me, sum: summary(mine) });
      return j({ name: meta.name, kind: meta.kind, members: list.map((m) => ({ id: m.id === me ? m.id : undefined, me: m.id === me, nick: m.sum.n || '', last: m.sum.d || '', today: m.sum.t || 0, week: m.sum.w || 0, streak: m.sum.s || 0, mastered: m.sum.m || 0 })) });
    }
    if (action === 'admin') {
      if (!meta.ph || u.searchParams.get('ph') !== meta.ph) return j({ error: 'forbidden' }, 403);
      const ids = (await members(s, code)).map((m) => m.id);
      const all = (await mapLimit(ids, 25, (id) => s.get(`g:${code}:m:${id}`, 'json'))).filter(Boolean);
      return j({ name: meta.name, kind: meta.kind, members: all.map((m) => ({ id: m.id, nick: m.nick, joined: m.joined, ...m.stats, days: m.days || {} })) });
    }
    return j({ error: 'bad action' }, 400);
  }
  if (request.method !== 'POST') return j({ error: 'method' }, 405);
  let b; try { b = await request.json(); } catch (e) { return j({ error: 'bad json' }, 400); }
  b = b || {};
  const nick = cleanNick(b.nick);

  if (b.action === 'create') {
    const name = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 24);
    if (!name || !nick) return j({ error: '이름과 닉네임을 입력하세요' }, 400);
    const kind = b.kind === 'class' ? 'class' : 'study';
    if (kind === 'class' && !/^[a-f0-9]{64}$/.test(b.ph || '')) return j({ error: '관리자 암호가 필요해요' }, 400);
    let code = ''; for (let i = 0; i < 8; i++) { code = rnd(6, CODE_CH); if (!(await s.get(`g:${code}:meta`))) break; }
    await s.setJSON(`g:${code}:meta`, { name, kind, ph: kind === 'class' ? b.ph : '', created: Date.now() });
    const id = hex(8), m = { id, nick, joined: Date.now(), stats: {}, days: {} };
    await s.setJSON(`g:${code}:m:${id}`, m, summary(m));
    return j({ code, id, name, kind });
  }
  const code = String(b.code || '').toUpperCase();
  if (!validCode(code)) return j({ error: '그룹 코드가 올바르지 않아요' }, 400);
  const meta = await s.get(`g:${code}:meta`, 'json');
  if (!meta) return j({ error: '그룹을 찾을 수 없어요' }, 404);

  if (b.action === 'join') {
    if (!nick) return j({ error: '닉네임을 입력하세요' }, 400);
    const list = await members(s, code);
    if (list.length >= MAX_MEMBERS) return j({ error: '그룹 정원(100명)이 가득 찼어요' }, 409);
    let n2 = nick, k = 2; while (list.some((m) => m.sum.n === n2)) n2 = nick.slice(0, 10) + k++;
    const id = hex(8), m = { id, nick: n2, joined: Date.now(), stats: {}, days: {} };
    await s.setJSON(`g:${code}:m:${id}`, m, summary(m));
    return j({ id, nick: n2, name: meta.name, kind: meta.kind });
  }
  const id = String(b.id || '');
  if (!/^[a-f0-9]{16}$/.test(id)) return j({ error: 'bad id' }, 400);
  const key = `g:${code}:m:${id}`, mem = await s.get(key, 'json');
  if (b.action === 'kick') {
    if (!meta.ph || b.ph !== meta.ph) return j({ error: 'forbidden' }, 403);
    await s.delete(key); return j({ ok: true });
  }
  if (!mem) return j({ error: 'not a member' }, 404);
  if (b.action === 'leave') { await s.delete(key); return j({ ok: true }); }
  if (b.action === 'report') {
    const st = b.stats || {}, day = String(st.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return j({ error: 'bad day' }, 400);
    mem.stats = { day, today: num(st.today), todayCorrect: num(st.todayCorrect), weekTotal: num(st.weekTotal), weekCorrect: num(st.weekCorrect), streak: num(st.streak, 3650), mastered: num(st.mastered), total: num(st.total), due: num(st.due), updated: Date.now() };
    const days = mem.days || {};
    if (st.recent && typeof st.recent === 'object') {
      for (const [d, v] of Object.entries(st.recent).slice(0, 14)) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days[d] = { done: num(v && v.done), correct: num(v && v.correct) };
    }
    const keep = Object.keys(days).sort().slice(-21); mem.days = Object.fromEntries(keep.map((d) => [d, days[d]]));
    await s.setJSON(key, mem, summary(mem)); return j({ ok: true });
  }
  return j({ error: 'bad action' }, 400);
}
