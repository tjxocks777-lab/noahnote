// 서버 동기화 API 회귀 테스트 — functions/api/sync.js 를 가짜 KV 위에서 그대로 돌린다.
//
// 지키려는 것: 두 기기가 거의 동시에 올려도 나중 것이 앞 것을 조용히 덮어쓰지 않는 것 (expect= 조건부 저장).
//
// 돌리기: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/sync.js';
import { makeKV, envWith, body, url, KEY } from './fake-kv.mjs';

const call = (kv, method, qs, payload) =>
  onRequest({ request: new Request(url(qs), payload === undefined ? { method } : { method, body: payload }), env: envWith(kv) });

/* ───────────── 입력 검사 ───────────── */

test('키 모양이 틀리면 400', async () => {
  const kv = makeKV();
  for (const bad of ['', 'short', 'Z'.repeat(64), 'a'.repeat(63)]) {
    const r = await call(kv, 'GET', 'k=' + bad);
    assert.equal(r.status, 400, `키 "${bad.slice(0, 10)}" 는 거부돼야 한다`);
  }
});

test('없는 키를 받으면 404', async () => {
  assert.equal((await call(makeKV(), 'GET', 'k=' + KEY)).status, 404);
});

test('noah-note 데이터가 아니면 400 (남의 데이터로 덮어쓰기 방지)', async () => {
  const kv = makeKV();
  for (const bad of ['{"hello":1}', '', 'not json', JSON.stringify({ app: 'other', subjects: {} })]) {
    assert.equal((await call(kv, 'PUT', 'k=' + KEY, bad)).status, 400);
  }
});

test('subjects 가 없으면 400', async () => {
  assert.equal((await call(makeKV(), 'PUT', 'k=' + KEY, JSON.stringify({ app: 'noah-note', savedAt: '1' })).then(r => r.status)), 400);
});

test('너무 크면 413', async () => {
  const big = '{"app":"noah-note","savedAt":"1","subjects":{}}' + ' '.repeat(5600001);
  assert.equal((await call(makeKV(), 'PUT', 'k=' + KEY, big)).status, 413);
});

test('알 수 없는 메서드는 405', async () => {
  assert.equal((await call(makeKV(), 'DELETE', 'k=' + KEY)).status, 405);
});

/* ───────────── 저장과 읽기 ───────────── */

test('올린 내용을 그대로 돌려준다', async () => {
  const kv = makeKV();
  const payload = body('100', { TOEIC: { questions: [{ id: 'q1' }] } });
  assert.equal((await call(kv, 'PUT', 'k=' + KEY, payload)).status, 200);
  const got = await (await call(kv, 'GET', 'k=' + KEY)).text();
  assert.equal(got, payload);
});

test('meta 는 본문 없이 savedAt 만 준다', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('12345'));
  const m = await (await call(kv, 'GET', `k=${KEY}&meta=1`)).json();
  assert.equal(m.savedAt, '12345');
});

/* ───────────── 조건부 저장 (되돌아감 방지의 핵심) ───────────── */

test('서버가 기대한 버전일 때만 저장한다', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('100'));
  assert.equal((await call(kv, 'PUT', `k=${KEY}&expect=100`, body('200'))).status, 200);
  assert.equal((await call(kv, 'GET', `k=${KEY}&meta=1`)).status, 200);
});

test('그 사이 다른 기기가 올렸으면 409 로 막는다', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('100'));

  // 폰과 PC 가 둘 다 savedAt=100 을 기준으로 들고 있다
  const phone = call(kv, 'PUT', `k=${KEY}&expect=100`, body('200', { T: { questions: [{ id: 'phone' }] } }));
  assert.equal((await phone).status, 200);

  const pc = await call(kv, 'PUT', `k=${KEY}&expect=100`, body('300', { T: { questions: [{ id: 'pc' }] } }));
  assert.equal(pc.status, 409, 'PC 가 폰의 내용을 덮어쓰면 안 된다');
  assert.equal((await pc.json()).savedAt, '200', '409 는 지금 서버 버전을 알려줘야 한다');

  // 폰이 올린 내용이 서버에 그대로 남아 있어야 한다
  assert.ok((await (await call(kv, 'GET', 'k=' + KEY)).text()).includes('phone'));
});

test("expect='' 는 서버가 비어 있을 때만 저장한다", async () => {
  const kv = makeKV();
  assert.equal((await call(kv, 'PUT', `k=${KEY}&expect=`, body('100'))).status, 200);
  assert.equal((await call(kv, 'PUT', `k=${KEY}&expect=`, body('200'))).status, 409, '이미 있으면 막아야 한다');
});

test('expect 없이 올리면 조건 없이 저장된다 (옛 동작 유지)', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('100'));
  assert.equal((await call(kv, 'PUT', 'k=' + KEY, body('200'))).status, 200);
});

/* ───────────── 첨부 사진 ───────────── */

test('첨부는 따로 저장되고 본문 검사를 받지 않는다', async () => {
  const kv = makeKV();
  const data = 'data:image/png;base64,AAAA';
  assert.equal((await call(kv, 'PUT', `k=${KEY}&att=img1`, data)).status, 200);
  assert.equal(await (await call(kv, 'GET', `k=${KEY}&att=img1`)).text(), data);
});

test('첨부 id 모양이 틀리면 400', async () => {
  const kv = makeKV();
  for (const bad of ['a/b', 'x'.repeat(81), '사진']) {
    assert.equal((await call(kv, 'PUT', `k=${KEY}&att=${encodeURIComponent(bad)}`, 'x')).status, 400, `att=${bad}`);
  }
});

test('첨부는 본문과 다른 자리에 저장된다 (서로 덮어쓰지 않음)', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('100'));
  await call(kv, 'PUT', `k=${KEY}&att=img1`, 'IMG');
  assert.ok((await (await call(kv, 'GET', 'k=' + KEY)).text()).includes('noah-note'), '본문이 첨부에 덮이면 안 된다');
});

/* ───────────── 저장소 분리 ───────────── */

test('다른 암호(키)는 서로의 데이터를 볼 수 없다', async () => {
  const kv = makeKV();
  const other = 'b'.repeat(64);
  await call(kv, 'PUT', 'k=' + KEY, body('100'));
  assert.equal((await call(kv, 'GET', 'k=' + other)).status, 404);
});

test('KV 키에 저장소 이름이 붙어 다른 기능과 섞이지 않는다', async () => {
  const kv = makeKV();
  await call(kv, 'PUT', 'k=' + KEY, body('100'));
  assert.ok([...kv._map.keys()].every(k => k.startsWith('sync:')), 'sync: 접두어가 있어야 한다');
});
