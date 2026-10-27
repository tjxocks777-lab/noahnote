// Netlify Function — 스캔(AI 인식) 프록시. API 키는 Netlify 환경변수 ANTHROPIC_API_KEY에 보관한다.
const ALLOWED = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
exports.handler = async (event) => {
  const H = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Method not allowed' }) };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: H, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되어 있지 않습니다.' }) };
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: H, body: JSON.stringify({ error: '잘못된 요청' }) }; }
  if (!Array.isArray(b.messages)) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'messages가 필요합니다.' }) };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ALLOWED.includes(b.model) ? b.model : 'claude-haiku-4-5-20251001', max_tokens: Math.min(+b.max_tokens || 1000, 4000), messages: b.messages })
    });
    return { statusCode: r.status, headers: H, body: await r.text() };
  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: String(err) }) };
  }
};
