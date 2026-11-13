// Cloudflare Worker 진입점. 정적 파일(앱 화면)은 Cloudflare 가 직접 내주고, /api/* 요청만 이 코드로 들어온다.
// 각 기능은 functions/api/*.js 의 핸들러를 그대로 쓴다.
import { onRequest as sync } from '../functions/api/sync.js';
import { onRequest as scan } from '../functions/api/scan.js';
import { onRequest as group } from '../functions/api/group.js';
import { onRequest as push } from '../functions/api/push.js';
import { onRequest as pushRun } from '../functions/api/push-run.js';
import { j } from '../functions/_lib/kv.js';
import { runDue } from '../functions/_lib/push-lib.js';

const ROUTES = { '/api/sync': sync, '/api/scan': scan, '/api/group': group, '/api/push': push, '/api/push-run': pushRun };

/* 앱 화면(/ 과 /index.html)은 캐시에 남으면 배포해도 옛 화면이 계속 나온다.
   _headers 는 요청 경로로 매칭돼서 "/" 에는 규칙이 안 붙었고, 실제로 그 문제가 났다.
   여기서 직접 no-store 를 붙여 두면 경로와 상관없이 항상 최신이 나간다.
   (wrangler.jsonc 의 run_worker_first 에 "/" 와 "/index.html" 이 함께 들어가야 이 코드로 들어온다) */
const SHELL = new Set(['/', '/index.html']);

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const h = ROUTES[path];
    if (!h) {
      const res = await env.ASSETS.fetch(request);
      if (!SHELL.has(path)) return res;
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'no-store, must-revalidate');
      return out;
    }
    try { return await h({ request, env, ctx }); }
    catch (e) { return j({ error: String((e && e.message) || e) }, 500); }
  },
  // 매 시간 7분: 알림 시각이 된 사용자에게 복습 알림을 보낸다 (wrangler.jsonc 의 triggers.crons)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDue(env, event.scheduledTime || Date.now(), ''));
  },
};
