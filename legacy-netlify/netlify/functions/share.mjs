// Netlify Function (v2) — 문제집 공유 링크. 문제(텍스트)와 노트(글)만 저장하고 사진·필기는 제외한다.
//  POST /api/share {title, items:[...], notes:[...]} → {id}      GET /api/share?id=XXXXXXXX → 문제집
import { getStore } from '@netlify/blobs';

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: H });
const CH = 'abcdefghjkmnpqrstuvwxyz23456789';
const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => CH[b % CH.length]).join('');
const t = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async (req) => {
  const s = getStore('noah-share');
  const u = new URL(req.url);
  if (req.method === 'GET') {
    const id = u.searchParams.get('id') || '';
    if (!/^[a-z2-9]{8}$/.test(id)) return j({ error: 'bad id' }, 400);
    const v = await s.get(id, { type: 'json' });
    return v ? j(v) : j({ error: 'not found' }, 404);
  }
  if (req.method !== 'POST') return j({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return j({ error: 'bad json' }, 400); }
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 600).map((q) => ({
    part: t(q.part, 60), question: t(q.question, 600), answer: t(q.answer, 300), explanation: t(q.explanation, 600),
    choices: q.choices && q.choices.A ? { A: t(q.choices.A, 200), B: t(q.choices.B, 200), C: t(q.choices.C, 200), D: t(q.choices.D, 200) } : null,
  })).filter((q) => q.question && q.answer);
  const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, 30).map((n) => ({ part: t(n.part, 60), title: t(n.title, 80), content: t(n.content, 8000) })).filter((n) => n.title);
  if (!items.length && !notes.length) return j({ error: '공유할 내용이 없어요' }, 400);
  let id = ''; for (let i = 0; i < 8; i++) { id = rnd(8); if (!(await s.get(id))) break; }
  await s.setJSON(id, { title: t(b.title, 40) || '문제집', items, notes, created: Date.now() });
  return j({ id });
};

export const config = { path: '/api/share' };
