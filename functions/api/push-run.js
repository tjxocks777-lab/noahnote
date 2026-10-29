// 매 시간 GitHub Actions 가 불러 주는 주소: 알림 시각이 된 사용자 중 오늘 아직 복습하지 않은 사람에게 알림을 보낸다.
// (Cloudflare Pages 에는 예약 실행이 없어서 바깥에서 한 시간마다 불러 준다. 같은 시간에 여러 번 불려도 중복으로 보내지 않는다.)
// 환경변수 CRON_TOKEN 을 설정하면 ?token= 이 같을 때만 실행한다(선택).
import { j } from '../_lib/kv.js';
import { runDue } from '../_lib/push-lib.js';

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  if (env.CRON_TOKEN && u.searchParams.get('token') !== env.CRON_TOKEN) return j({ error: 'forbidden' }, 403);
  if (request.method !== 'GET' && request.method !== 'POST') return j({ error: 'method' }, 405);
  return j(await runDue(env, Date.now(), u.origin));
}
