// Cloudflare Pages Function — 스캔(AI 인식) 프록시.
// 키는 Cloudflare 환경변수(Secret)에 보관: GEMINI_API_KEY(절약 모드), ANTHROPIC_API_KEY(정확 모드·대체용)
// 앱은 항상 Claude 형식으로 요청하고, Gemini 모델이면 여기서 변환해 같은 형식(content:[{type:'text',text}])으로 돌려준다.
//
// 이 주소는 공개돼 있고 호출할 때마다 요금이 나가므로 3중으로 막는다. 싼 검사부터 하는 순서가 중요하다 —
// 거절할 요청이 KV 를 건드리면 하루 쓰기 1,000번(무료 한도)을 태워서 같은 KV 를 쓰는 동기화까지 멈춘다.
//   1) SCAN_CODE   — 설정해 두면 x-scan-code 헤더가 맞아야 통과. 메모리 검사라 KV 를 안 쓴다.
//   2) SCAN_MAX_BYTES — 본문 크기 상한(기본 6MB). 호출 1번의 최대 비용에 천장을 씌운다.
//   3) SCAN_DAILY_LIMIT — 하루 횟수(기본 30). 여기서 처음 KV 를 쓴다.
import { store } from '../_lib/kv.js';

const DEFAULT_MAX_BYTES = 6000000;
const DEFAULT_DAILY_LIMIT = 30;

// 하루 경계는 한국 시간 기준 (Worker 는 UTC 로 돈다)
function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 길이 정보를 덜 흘리도록 자리수를 맞춰 비교한다
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CLAUDE = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
const GEMINI = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const FALLBACK = 'claude-haiku-4-5-20251001';

const J = (status, obj) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function callClaude(model, b, key) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: Math.min(+b.max_tokens || 1000, 4000), messages: b.messages })
  });
  return J(r.status, await r.text());
}

function toGeminiParts(messages) {
  const parts = [];
  for (const m of messages) {
    const c = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
    for (const p of c) {
      if (p.type === 'image' && p.source && p.source.data) parts.push({ inline_data: { mime_type: p.source.media_type || 'image/jpeg', data: p.source.data } });
      else if (p.type === 'text') parts.push({ text: p.text });
    }
  }
  return parts;
}

async function callGemini(model, b, key) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const gen = { maxOutputTokens: Math.min(+b.max_tokens || 1000, 4000), temperature: 0.1, responseMimeType: 'application/json' };
  const send = (cfg) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: toGeminiParts(b.messages) }], generationConfig: cfg })
  });
  // 생각(thinking) 토큰은 출력 요금으로 청구되므로 최소로 줄여 본다. 모델이 이 옵션을 거부하면(400) 옵션 없이 다시 시도.
  let r = await send(Object.assign({}, gen, { thinkingConfig: { thinkingLevel: 'minimal' } }));
  if (r.status === 400) r = await send(gen);
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch (e) {}
  if (!r.ok || !d) return { ok: false, status: r.status, message: (d && d.error && d.error.message) || raw.slice(0, 200) };
  const cand = (d.candidates || [])[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n') : '';
  if (!text) return { ok: false, status: 502, message: 'Gemini가 빈 응답을 보냈어요' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') };
  return { ok: true, body: { content: [{ type: 'text', text }], usage: d.usageMetadata || null, model } };
}

// 하루 횟수 세기. 넘으면 { over: true } 를 돌려준다. KV 가 없거나 실패하면 스캔을 막지 않는다(세는 것 때문에 기능이 죽지 않게).
async function bumpDaily(env, limit) {
  let s;
  try { s = store(env, 'scan'); } catch (_) { return { ok: true, skipped: true }; }
  const key = 'day:' + kstDay();
  try {
    const cur = parseInt(await s.get(key), 10) || 0;
    if (cur >= limit) return { ok: false, used: cur };
    // KV 는 바로 반영되지 않아서 거의 동시에 들어온 요청은 같은 값을 읽을 수 있다. 한도를 조금 넘길 수 있는 무른 상한이다.
    await s.set(key, String(cur + 1), { day: kstDay() });
    return { ok: true, used: cur + 1 };
  } catch (_) {
    return { ok: true, skipped: true };
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return J(405, { error: 'Method not allowed' });

  // 1) 접근 코드 — 설정돼 있을 때만 검사한다 (없으면 예전처럼 동작)
  const code = env.SCAN_CODE;
  if (code && !sameSecret(request.headers.get('x-scan-code') || '', String(code))) {
    return J(401, { error: 'scan_code_invalid', message: '스캔 접근 코드가 맞지 않아요. 설정 > 스캔 정확도 / 비용에서 코드를 확인하세요.' });
  }

  // 2) 본문 크기 — 파싱하기 전에 막는다
  const maxBytes = parseInt(env.SCAN_MAX_BYTES, 10) || DEFAULT_MAX_BYTES;
  let text; try { text = await request.text(); } catch (e) { return J(400, { error: '잘못된 요청' }); }
  if (text.length > maxBytes) return J(413, { error: 'too_large', message: '사진이 너무 커요. 더 작게 찍거나 한 번에 한 장씩 올려주세요.' });

  let b; try { b = JSON.parse(text); } catch (e) { return J(400, { error: '잘못된 요청' }); }
  if (!b || !Array.isArray(b.messages)) return J(400, { error: 'messages가 필요합니다.' });

  // 3) 하루 횟수 — 여기서 처음 KV 를 쓴다
  const limit = parseInt(env.SCAN_DAILY_LIMIT, 10) || DEFAULT_DAILY_LIMIT;
  const day = await bumpDaily(env, limit);
  if (!day.ok) return J(429, { error: 'daily_limit', message: `오늘 스캔을 ${limit}번 다 썼어요. 내일 다시 쓸 수 있어요.` });
  const gKey = env.GEMINI_API_KEY, aKey = env.ANTHROPIC_API_KEY;
  const want = (CLAUDE.includes(b.model) || GEMINI.includes(b.model)) ? b.model : FALLBACK;
  try {
    if (GEMINI.includes(want)) {
      if (gKey) {
        const g = await callGemini(want, b, gKey);
        if (g.ok) return J(200, g.body);
        if (!aKey) return J(g.status || 500, { error: g.message });
        // Gemini가 실패하면 Claude로 대신 처리해서 스캔이 끊기지 않게 한다
        return await callClaude(FALLBACK, b, aKey);
      }
      if (aKey) return await callClaude(FALLBACK, b, aKey);   // Gemini 키가 아직 없으면 Claude로 대체
      return J(500, { error: 'GEMINI_API_KEY가 설정되어 있지 않습니다.' });
    }
    if (!aKey) return J(500, { error: 'ANTHROPIC_API_KEY가 설정되어 있지 않습니다.' });
    return await callClaude(want, b, aKey);
  } catch (err) {
    return J(500, { error: String(err) });
  }
}
