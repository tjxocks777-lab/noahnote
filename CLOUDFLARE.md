# Cloudflare Pages 로 배포하기

이 앱은 화면(`index.html`)과 서버 기능(`functions/api/*`)이 한 저장소에 들어 있고, Cloudflare Pages 가 push 할 때마다 자동으로 배포한다. (무료, 카드 등록 불필요)

## 한 번만 하는 설정
1. Cloudflare 가입 → **Workers & Pages → Create → Pages → Connect to Git** → GitHub 저장소 `noahnote` 선택
2. 설정: Production branch `main` / Framework preset `None` / Build command 비움 / Build output directory `/`
3. **Storage & databases → KV → Create** 로 네임스페이스(이름 `noahnote`) 만들기
4. Pages 프로젝트 → **Settings → Bindings → Add → KV namespace** → 변수 이름 `NOAH_KV`, 위에서 만든 네임스페이스 선택
5. Pages 프로젝트 → **Settings → Variables and secrets** 에 `ANTHROPIC_API_KEY`(필수, Secret), `GEMINI_API_KEY`(선택, Secret) 추가
6. **Deployments → Retry deployment** 로 한 번 더 배포 (바인딩·변수는 다음 배포부터 적용됨)

## 복습 알림(푸시)
Cloudflare Pages 에는 예약 실행이 없어서 `.github/workflows/push-cron.yml` 이 한 시간에 한 번 `/api/push-run` 을 불러 준다.
프로젝트 이름이 `noahnote` 가 아니면 저장소 Settings → Secrets and variables → Actions → Variables 에 `PUSH_RUN_URL`(예: `https://내프로젝트.pages.dev/api/push-run`)을 넣는다.

## 무료 한도 (Workers KV)
하루 쓰기 1,000번 · 읽기 100,000번. 동기화는 저장할 때마다 1번(첨부 사진은 사진당 1번) 쓴다.
