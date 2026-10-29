# Cloudflare 로 배포하기 (Workers + 정적 파일)

앱 화면(`index.html` 등)과 서버 기능(`functions/api/*`)이 한 저장소에 있고, GitHub `main` 에 push 하면 Cloudflare 가 자동으로 배포한다. 무료, 카드 등록 불필요.

## 구조
- `wrangler.jsonc` — 이름, 정적 파일 위치, KV 저장소(`NOAH_KV`), 예약 실행(복습 알림, 매시 7분) 설정
- `worker/index.js` — `/api/*` 요청을 `functions/api/*.js` 로 보내는 진입점
- `.assetsignore` — 앱 화면으로 내보내지 않을 파일
- `legacy-netlify/` — 이전 Netlify 용 코드(더 이상 쓰지 않음)

## 처음 한 번 하는 설정
1. Cloudflare 가입 → **Workers & Pages → Create application → Continue with GitHub** → 저장소 `noahnote`
2. 프로젝트 이름 `noahnote`, Build command 비움, Deploy command `npx wrangler deploy` (기본값) → **Deploy**
3. 배포가 끝나면 **Workers & Pages → noahnote → Settings → Variables and secrets** 에서 `ANTHROPIC_API_KEY`(Secret, 필수), `GEMINI_API_KEY`(Secret, 선택) 추가 후 저장
   (KV 저장소는 첫 배포 때 자동으로 만들어져 연결된다)

## 무료 한도
- Workers KV: 하루 쓰기 1,000번 · 읽기 100,000번. 동기화는 저장할 때마다 1번(첨부 사진은 사진당 1번) 쓴다.
- Workers 요청당 CPU 10ms. 그래서 동기화는 큰 JSON 을 파싱하지 않고 앞부분만 검사한다.
- 하루 요청 100,000번 (앱 화면 같은 정적 파일 요청은 포함되지 않음).

## 로컬 시험
`npx wrangler dev` → http://localhost:8787 (KV 는 로컬에 가짜로 만들어진다)
