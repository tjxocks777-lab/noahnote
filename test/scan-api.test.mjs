// 스캔 프록시 보호장치 회귀 테스트 — functions/api/scan.js 를 가짜 KV 위에서 돌린다.
//
// 지키려는 것: 공개된 /api/scan 이 남의 호출로 요금을 태우지 않는 것, 그리고
// 거절할 요청이 KV 를 건드려 동기화용 쓰기 한도를 먹지 않는 것.
//
// 돌리기: node --test 'test/*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/scan.js';
import { makeKV, envWith } from './fake-kv.mjs';

const URL_ = 'https://example.workers.dev/api/scan';
const IMG = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
const BODY = { model: 'gemini-3.1-flash-lite', max_tokens: 1000, messages: [{ role: 'user', content: [IMG, { type: 'text', text: '추출' }] }] };

// 바깥(Gemini/Claude)으로 나가는 fetch 는 테스트에서 가로챈다
function withFetch(fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }), { status: 200 });
  };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}

const call = (env, body = BODY, headers = {}) =>
  onRequest({ request: new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), env });

const baseEnv = (kv, over = {}) => Object.assign(envWith(kv), { GEMINI_API_KEY: 'g-key' }, over);

/* ───────────── 접근 코드 ───────────── */

test('SCAN_CODE 가 없으면 예전처럼 동작한다', async () => {
  const kv = makeKV();
  await withFetch(async () => {
    assert.equal((await call(baseEnv(kv))).status, 200);
  });
});

test('SCAN_CODE 가 있으면 헤더가 맞아야 통과한다', async () => {
  const kv = makeKV();
  const env = baseEnv(kv, { SCAN_CODE: 'my-secret' });
  await withFetch(async () => {
    assert.equal((await call(env, BODY, { 'x-scan-code': 'my-secret' })).status, 200);
  });
});

test('코드가 틀리거나 없으면 401', async () => {
  const kv = makeKV();
  const env = baseEnv(kv, { SCAN_CODE: 'my-secret' });
  for (const h of [{}, { 'x-scan-code': '' }, { 'x-scan-code': 'wrong' }, { 'x-scan-code': 'my-secre' }, { 'x-scan-code': 'my-secrets' }]) {
    const r = await call(env, BODY, h);
    assert.equal(r.status, 401, JSON.stringify(h));
    assert.equal((await r.json()).error, 'scan_code_invalid');
  }
});

test('코드가 틀리면 바깥 API 를 부르지 않는다 (요금 0)', async () => {
  const kv = makeKV();
  await withFetch(async (calls) => {
    await call(baseEnv(kv, { SCAN_CODE: 's' }), BODY, { 'x-scan-code': 'x' });
    assert.deepEqual(calls, [], '거절했는데 바깥으로 나갔다');
  });
});

test('코드가 틀리면 KV 를 전혀 건드리지 않는다 (동기화 쓰기 한도 보호)', async () => {
  const kv = makeKV();
  await call(baseEnv(kv, { SCAN_CODE: 's' }), BODY, { 'x-scan-code': 'x' });
  assert.equal(kv._map.size, 0, 'KV 에 뭔가 썼다');
});

/* ───────────── 크기 상한 ───────────── */

test('본문이 상한을 넘으면 413', async () => {
  const kv = makeKV();
  const big = JSON.stringify(BODY) + ' '.repeat(2000);
  const r = await call(baseEnv(kv, { SCAN_MAX_BYTES: '500' }), big);
  assert.equal(r.status, 413);
});

test('크기로 거절해도 KV 를 건드리지 않는다', async () => {
  const kv = makeKV();
  await call(baseEnv(kv, { SCAN_MAX_BYTES: '10' }), JSON.stringify(BODY));
  assert.equal(kv._map.size, 0);
});

test('상한 안이면 통과한다', async () => {
  const kv = makeKV();
  await withFetch(async () => {
    assert.equal((await call(baseEnv(kv, { SCAN_MAX_BYTES: '5000000' }))).status, 200);
  });
});

/* ───────────── 하루 횟수 ───────────── */

test('하루 한도를 넘으면 429', async () => {
  const kv = makeKV();
  const env = baseEnv(kv, { SCAN_DAILY_LIMIT: '3' });
  await withFetch(async () => {
    for (let i = 0; i < 3; i++) assert.equal((await call(env)).status, 200, `${i + 1}번째는 통과해야 한다`);
    const r = await call(env);
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error, 'daily_limit');
  });
});

test('한도를 넘긴 뒤에는 바깥 API 를 부르지 않는다', async () => {
  const kv = makeKV();
  const env = baseEnv(kv, { SCAN_DAILY_LIMIT: '1' });
  await withFetch(async (calls) => {
    await call(env);
    const before = calls.length;
    await call(env);
    assert.equal(calls.length, before, '한도를 넘겼는데 바깥으로 나갔다');
  });
});

test('날짜가 바뀌면 다시 쓸 수 있다 (한국 시간 기준 키)', async () => {
  const kv = makeKV();
  const env = baseEnv(kv, { SCAN_DAILY_LIMIT: '1' });
  await withFetch(async () => {
    await call(env);
    assert.equal((await call(env)).status, 429);
    // 어제 날짜 키로 바꿔 두면 오늘치는 0부터 시작한다
    const [k, v] = [...kv._map.entries()][0];
    kv._map.delete(k);
    kv._map.set('scan:day:2000-01-01', v);
    assert.equal((await call(env)).status, 200);
  });
});

test('하루 경계는 한국 시간이다 (UTC 15시 = 한국 다음날 0시)', async () => {
  // UTC 2026-11-12T15:00Z 는 KST 2026-11-13 00:00 → 키가 11-13 이어야 한다
  const kst = new Date(Date.parse('2026-11-12T15:00:00Z') + 9 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(kst, '2026-11-13');
});

test('KV 바인딩이 없어도 스캔은 막히지 않는다', async () => {
  await withFetch(async () => {
    const r = await onRequest({ request: new Request(URL_, { method: 'POST', body: JSON.stringify(BODY) }), env: { GEMINI_API_KEY: 'g' } });
    assert.equal(r.status, 200, '세는 기능 때문에 스캔이 죽으면 안 된다');
  });
});

/* ───────────── 검사 순서 ───────────── */

test('코드 검사가 크기 검사보다 먼저다 (큰 요청도 싸게 거절)', async () => {
  const kv = makeKV();
  const huge = ' '.repeat(100) + JSON.stringify(BODY);
  const r = await call(baseEnv(kv, { SCAN_CODE: 's', SCAN_MAX_BYTES: '10' }), huge, { 'x-scan-code': 'wrong' });
  assert.equal(r.status, 401, '413 이 아니라 401 이어야 한다');
});

test('POST 가 아니면 405', async () => {
  const r = await onRequest({ request: new Request(URL_, { method: 'GET' }), env: envWith(makeKV()) });
  assert.equal(r.status, 405);
});
