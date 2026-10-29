// Cloudflare Pages Function — 스캔(AI 인식) 프록시.
// 키는 Cloudflare 환경변수(Secret)에 보관: GEMINI_API_KEY(절약 모드), ANTHROPIC_API_KEY(정확 모드·대체용)
// 앱은 항상 Claude 형식으로 요청하고, Gemini 모델이면 여기서 변환해 같은 형식(content:[{type:'text',text}])으로 돌려준다.
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

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return J(405, { error: 'Method not allowed' });
  let b; try { b = await request.json(); } catch (e) { return J(400, { error: '잘못된 요청' }); }
  if (!b || !Array.isArray(b.messages)) return J(400, { error: 'messages가 필요합니다.' });
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
