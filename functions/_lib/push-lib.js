// 복습 알림(웹 푸시) 공용 코드. VAPID 키는 처음 한 번 자동으로 만들어 KV에 보관한다(환경변수 불필요).
import { store } from './kv.js';
import { generateVapid, sendWebPush } from './webpush.js';

export const pushStore = (env) => store(env, 'push');

// 푸시 서비스(브라우저 회사 서버) 주소만 허용 — 임의 주소로 요청이 나가지 않게 한다
export const okEndpoint = (ep) => {
  try { const u = new URL(ep); return u.protocol === 'https:' && /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/.test(u.hostname); }
  catch (_) { return false; }
};

export async function vapid(env) {
  const s = pushStore(env);
  let v = await s.get('vapid', 'json');
  if (!v || !v.publicKey) { v = await generateVapid(); await s.setJSON('vapid', v); }
  return v;
}

export const subjectFor = (env, origin) => env.VAPID_SUBJECT || origin || 'https://noahnote.pages.dev';

export async function sendTo(env, rec, payload, origin) {
  return sendWebPush(rec.sub, payload, await vapid(env), subjectFor(env, origin));
}

// 목록에서 쓰는 요약(KV 메타데이터): 알림 시각과 시차
export const subMeta = (rec) => ({ h: rec.hour, z: rec.tz });

// 사용자의 현지 시각(분 단위 시차 tz 적용)
export function localParts(nowMs, tzMin) {
  const d = new Date(nowMs + (tzMin || 0) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return { hour: d.getUTCHours(), day: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` };
}

export function messageFor(rec) {
  const due = rec.due;
  return {
    title: 'NOAH NOTE',
    body: due > 0 ? `오늘 복습할 문제가 ${due}개 남았어요. 5분만 해볼까요?` : '오늘 복습 잊지 않으셨죠? 가볍게 한 번 열어보세요.',
    url: './'
  };
}

// 알림 시각이 된 사용자에게 보낸다. 같은 시간에 여러 번 불려도 중복으로 보내지 않는다(50분 안에 보낸 적 있으면 건너뜀).
export async function runDue(env, nowMs = Date.now(), origin = '') {
  const s = pushStore(env);
  const keys = (await s.list('sub:')).filter((k) => k.metadata && lpHourMatch(nowMs, k.metadata));
  let sent = 0, skipped = 0, removed = 0;
  for (const k of keys) {
    const rec = await s.get(k.key, 'json');
    if (!rec || !rec.sub) continue;
    const lp = localParts(nowMs, rec.tz);
    if (lp.hour !== rec.hour) continue;
    if (rec.sentAt && nowMs - rec.sentAt < 50 * 60000) { skipped++; continue; }
    if (rec.day === lp.day && (rec.studied || rec.due === 0)) { skipped++; continue; }   // 오늘 이미 했거나 할 게 없으면 보내지 않음
    try {
      await sendTo(env, rec, messageFor(rec.day === lp.day ? rec : { due: null }), origin); sent++;
      rec.sentAt = nowMs; await s.setJSON(k.key, rec, subMeta(rec));
    } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { await s.delete(k.key); removed++; } }
  }
  return { sent, skipped, removed };
}
const lpHourMatch = (nowMs, m) => localParts(nowMs, m.z).hour === m.h;
