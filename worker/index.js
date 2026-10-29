// Cloudflare Worker 진입점. 정적 파일(앱 화면)은 Cloudflare 가 직접 내주고, /api/* 요청만 이 코드로 들어온다.
// 각 기능은 functions/api/*.js 의 핸들러를 그대로 쓴다.
import { onRequest as sync } from '../functions/api/sync.js';
import { onRequest as scan } from '../functions/api/scan.js';
import { onRequest as share } from '../functions/api/share.js';
import { onRequest as group } from '../functions/api/group.js';
import { onRequest as push } from '../functions/api/push.js';
import { onRequest as pushRun } from '../functions/api/push-run.js';
import { j } from '../functions/_lib/kv.js';
import { runDue } from '../functions/_lib/push-lib.js';

const ROUTES = { '/api/sync': sync, '/api/scan': scan, '/api/share': share, '/api/group': group, '/api/push': push, '/api/push-run': pushRun };

export default {
  async fetch(request, env, ctx) {
    const h = ROUTES[new URL(request.url).pathname];
    if (!h) return env.ASSETS.fetch(request);
    try { return await h({ request, env, ctx }); }
    catch (e) { return j({ error: String((e && e.message) || e) }, 500); }
  },
  // 매 시간 7분: 알림 시각이 된 사용자에게 복습 알림을 보낸다 (wrangler.jsonc 의 triggers.crons)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDue(env, event.scheduledTime || Date.now(), ''));
  },
};
