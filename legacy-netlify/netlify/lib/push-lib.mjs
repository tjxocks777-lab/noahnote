// 복습 알림(웹 푸시) 공용 코드. VAPID 키는 처음 한 번 자동으로 만들어 Netlify Blobs에 보관한다(환경변수 불필요).
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export const pushStore = () => getStore('noah-push');

export async function vapid() {
  const s = pushStore();
  let v = await s.get('vapid', { type: 'json' });
  if (!v || !v.publicKey) { v = webpush.generateVAPIDKeys(); await s.setJSON('vapid', v); }
  webpush.setVapidDetails('https://noahnote.netlify.app', v.publicKey, v.privateKey);
  return v;
}

export async function sendTo(rec, payload) {
  await vapid();
  return webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 3600 });
}

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

export async function runDue(nowMs = Date.now()) {
  const s = pushStore();
  const { blobs } = await s.list({ prefix: 'sub:' });
  let sent = 0, skipped = 0, removed = 0;
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: 'json' });
    if (!rec || !rec.sub) continue;
    const lp = localParts(nowMs, rec.tz);
    if (lp.hour !== rec.hour) continue;
    if (rec.day === lp.day && (rec.studied || rec.due === 0)) { skipped++; continue; }   // 오늘 이미 했거나 할 게 없으면 보내지 않음
    try { await sendTo(rec, messageFor(rec.day === lp.day ? rec : { due: null })); sent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { await s.delete(b.key); removed++; } }
  }
  return { sent, skipped, removed };
}
