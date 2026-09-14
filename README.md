# N2 단어

JLPT N2 준비용 개인 단어 학습 웹앱. **한자를 봤을 때 읽기와 뜻이 떠오르는 능력**만 훈련한다.
한자 쓰기 문제와 "한국어 뜻 → 일본어" 역추론 문제 유형은 설정으로 끄는 것이 아니라 아예 구현되어 있지 않다.

기획서: `~/.claude/plans/spicy-sparking-pillow.md`

## 최초 설정

1. **Neon 프로젝트 생성** — [console.neon.tech](https://console.neon.tech) 에서 프로젝트를 만들고
   Connection Details 에서 **Pooled connection** 문자열을 복사한다(호스트에 `-pooler` 가 들어간 쪽).

2. **환경변수** — `.env.local` 에서 두 곳을 채운다. (`SESSION_SECRET` 은 이미 생성되어 있다)

   ```
   DATABASE_URL="postgresql://...-pooler....neon.tech/neondb?sslmode=require"
   APP_PASSWORD="원하는-비밀번호"
   ```

3. **스키마 적용**

   ```bash
   npm run db:migrate     # db/schema.sql 을 적용한다. 몇 번 돌려도 안전하다
   ```

4. **실행**

   ```bash
   npm run dev        # http://localhost:3000
   ```

   첫 화면에서 비밀번호를 한 번 입력하면 그 기기에서는 1년간 유지된다.

## 배포 (Vercel)

```bash
npx vercel            # 프로젝트 연결
```

Vercel 대시보드에서 `DATABASE_URL` · `APP_PASSWORD` · `SESSION_SECRET` · `APP_TIMEZONE` 을
Environment Variables 에 넣는다. `.env.local` 의 값을 그대로 쓰면 된다.

## 화면

| 경로 | 하는 일 |
|---|---|
| `/` | 오늘의 복습 주기 + 일차/주차별 연습 퀴즈 목록 |
| `/study` | SRS 학습 세션. 키보드만으로 끝난다 |
| `/study?from=&to=` | 그 기간 단어만 뽑은 **연습 퀴즈**. 순서가 매번 섞이고 복습 주기에 반영되지 않는다 |
| `/add` | 단어 추가(한 개씩 / 여러 개 붙여넣기). 학습일을 지난 날짜로 지정할 수 있다 |
| `/words` | 단어 목록 · 검색 · 오답노트/취약/보류 필터 · 인라인 수정 · 삭제 |
| `/study?filter=wrong` | 오답노트 연습 퀴즈 (`weak` 는 취약 단어) |
| `/stats` | 오늘 / 최근 7일 / 전체 + 유형별 정답률 |
| `/settings` | 하루 분량 · 출제 비율 · 하루 시작 시각 · CSV 가져오기 |
| `/api/export?format=csv` | CSV 백업 (엑셀 호환, BOM 포함) |
| `/api/export?format=json` | JSON 백업 (리뷰 로그 포함) |

## 학습 세션 단축키

```
Space / Enter   정답 보기 (학습 카드에서는 다음)
1 또는 J        알았음
2 또는 F        몰랐음
U               직전 채점 되돌리기 (서버 전송 전까지)
E               이 단어 수정 (오타를 세션 흐름 끊지 않고 고친다)
S               이 단어 보류 (큐에서 빼기)
```

## 문제 유형

| 유형 | 문제 | 비중 |
|---|---|---|
| `s2r` | 한자 → 읽기 (뜻은 정답에서 함께 공개) | 60% |
| `s2m` | 한자 → 뜻 | 25% |
| `r2m` | 읽기 → 뜻 | 15% |

예외 규칙: 가나 전용 단어(`ちゃんと`)는 항상 표기→뜻으로만, 읽기가 겹치는 단어(`以外`/`意外`)는
읽기→뜻을 출제하지 않는다. 신규 단어의 첫 퀴즈는 항상 한자→읽기이고, 틀린 유형은 다음 복습에서
강제로 다시 나온다.

## 읽기 입력

읽기 칸은 **로마자로 치면 칸을 떠날 때 통째로 가나로 바뀐다** (`fukyuu` → `ふきゅう`).
변환 결과를 입력 중에 미리 보여주고, 가나가 아닌 문자가 남아 있으면 저장을 막는다.

부분 변환(IMEMode)과 IME 조합 가로채기를 쓰지 않는 이유: 타이핑 도중 상태가 그대로 저장되어
`ふきゅう` 가 `ふきゅ` 로 잘려 들어간 적이 있다. **틀린 읽기는 없는 것보다 나쁘다** —
잘못된 읽기를 계속 외우게 되기 때문이다.

표기가 가나뿐인 단어(`きっかけ`, `バランス`)는 읽기를 추정하지 않고 **표기와 같게 확정**한다.
이런 단어는 읽기 문제가 성립하지 않으므로 항상 뜻 문제로만 출제되고, 카드에도 같은 글자를
두 번 보여주지 않는다.

## 두 가지 학습 모드

```
오늘의 복습 주기 (SRS)        연습 퀴즈 (일차 / 주차 / 오답노트)
────────────────────         ──────────────────────────────
하루 한 번, 오늘 걸린 것만     아무 때나, 몇 번이든
복습 주기(stage/next_review)   복습 주기는 건드리지 않음
를 사다리대로 갱신             오답 기록에는 반영 (오답노트)
신규 단어는 학습 카드부터      순서가 매번 섞임
```

연습에서 틀려도 다음 복습일은 바뀌지 않지만, 오답 횟수와 연속 정답은 갱신된다.
"연습에서 계속 틀리는 단어"는 실제로 약한 단어이므로 오답노트에 올라와야 하기 때문이다.

**학습일(`study_day`)** 은 등록일과 분리되어 있다. 어제 공부한 단어를 오늘 넣더라도
`/add` 상단에서 날짜를 어제로 두면 `1일차 / 2일차 ...` 그룹이 제대로 잡힌다.
N주차는 가장 이른 학습일을 기준으로 7일 단위로 자동 계산된다.

## SRS

```
간격 사다리(일)   0(당일) → 1 → 3 → 7 → 14 → 30 → 60 → 120

알았음   사다리 한 칸 위로
몰랐음   stage 1 고정(= 내일) + 같은 세션에서 5장 뒤 재출제
         단, 세션 안에서의 재시도 성공으로는 단계가 올라가지 않는다
```

하루 상한은 신규 30 / 복습 150. 하루 경계는 04:00(`APP_TIMEZONE` 기준)이라 새벽 공부도 전날로 집계된다.

## 개발

```bash
npm run dev          # 개발 서버
npm test             # 순수 로직 59개 (SRS·읽기 변환·파서·카드 누출)
npm run test:db      # 실제 Neon 왕복 12개 (ＺＺ 네임스페이스, 자동 정리)
npm run test:e2e     # 브라우저 E2E 15개 (격리 DB n2v_e2e 에서 실행)
npm run test:load    # 부하 테스트 (Neon 브랜치 필요 — 아래 참고)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # 스키마 적용 (멱등) · -- --all 로 E2E DB 까지
npm run db:seed      # 예시 단어 10개 넣기 (-- --clear 로 제거)
npm run icons        # PWA 아이콘 재생성
npm run build        # 프로덕션 빌드
```

핵심 로직은 전부 `lib/srs.ts` 의 순수 함수에 있고, SRS 계산은 **서버에서만** 한다
(`app/api/grades/route.ts`). 클라이언트는 `{wordId, kind, correct}` 만 보낸다.

## 백업

Neon 무료 플랜은 시점 복구 보존 기간이 짧아서 **자동 백업을 걸어뒀다.**

`.github/workflows/backup.yml` 이 매일 05:00 KST 에 DB 를 덤프해 `backups/` 에 커밋한다.
백업이 성공하면 `settings.last_backup_at` 에 시각을 남기고, 2일 넘게 갱신되지 않으면
홈 화면에 경고 배너가 뜬다. 실제로 Actions 가 3일간 실패하는 동안 앱에는 아무 표시가 없었다.
데이터가 바뀌지 않은 날은 커밋하지 않으므로 히스토리가 그대로 "공부한 날"의 목록이 된다.
아무 날짜로나 되돌릴 수 있다 — 복원 방법은 `backups/README.md` 참고.

```bash
npm run backup        # 로컬에서 수동 덤프 (backups/ 갱신)
```

홈 화면 하단의 CSV/JSON 버튼은 그대로 남아 있다. 지금 당장 파일이 필요할 때 쓴다.
CSV 는 앞 3열(`surface,reading,meaning_ko`)만 떼면 Anki/Quizlet 으로도 그대로 들어간다.

> 이 저장소는 공개다. `backups/` 의 단어 목록과 학습 기록도 함께 공개된다.
> 비공개로 바꾸려면 `gh repo edit --visibility private` 하면 된다(설정 변경은 불필요).

## 테스트 격리

세션 테스트는 키를 눌러 카드를 **실제로 채점**한다. 운영 DB 에서 돌리면 큐에 섞여 들어온
진짜 단어의 복습 주기가 바뀐다. 그래서 계층별로 대상을 분리했다.

| 명령 | 대상 | 정리 |
|---|---|---|
| `npm test` | 없음 (순수 함수) | — |
| `npm run test:db` | 운영 DB | 전각 `ＺＺ` 네임스페이스만 쓰고 자동 삭제 |
| `npm run test:e2e` | 별도 DB `n2v_e2e` | 매 테스트 전 truncate |
| `npm run test:load` | Neon 브랜치 | 브랜치째 삭제 |

부하 테스트는 브랜치를 먼저 만들어야 한다.

```bash
neon branches create --project-id <id> --name loadtest
neon connection-string loadtest --project-id <id> --database-name neondb --pooled > /tmp/loadtest_url
npm run test:load
neon branches delete loadtest --project-id <id>
```

## 측정 결과

단어 1만 개(Neon 브랜치, 로컬에서 us-east-2 접속 — 왕복 지연 약 210ms 포함):

```
큐 후보 조회      454ms      큐 구성(순수함수)   5ms / 210장
오늘 카운트       629ms      전체 목록          662ms
학습일 그룹       226ms      텍스트 검색        233ms
CSV export      1,476ms      export 크기        3.1MB
```

브라우저 측정(단어 2,000개):

```
카드 전환        2.8ms      20장 넘기는 동안 조회 요청 0건
/study 응답       63KB
```

**세션 중 네트워크 왕복이 없다는 설계 전제가 실제로 검증됐다.** 카드 전환에 나가는 요청은
5장짜리 채점 배치뿐이다.

Lighthouse(desktop): 접근성 100 · 권장사항 100 · 성능 66~72.
성능 점수는 로컬 측정이라 이 머신에서 Neon 까지의 왕복이 쿼리마다 붙는다.
운영은 Vercel iad1 과 Neon us-east-2 가 같은 지역이라 그대로 재현되지 않는다.

## PWA

홈 화면에 설치할 수 있다. 브라우저 주소창의 설치 버튼(데스크톱) 또는
공유 → 홈 화면에 추가(iOS)로 넣으면 주소창 없이 앱처럼 열린다.

- 매니페스트: `app/manifest.ts` → `/manifest.webmanifest`
- 아이콘: `scripts/make-icons.mjs` 가 외부 라이브러리 없이 PNG 를 직접 생성한다
- 서비스 워커: `public/sw.js` — 불변 정적 자산만 캐시하고 페이지·API 는 항상 네트워크로 보낸다
  (학습 데이터는 서버가 단일 출처여야 하므로 응답을 캐시하지 않는다)
- `proxy.ts` 의 matcher 에서 `sw.js` / `manifest.webmanifest` / 아이콘을 인증에서 제외한다.
  이걸 빼먹으면 서비스 워커 등록과 설치 배너가 동작하지 않는다.

## 아직 없는 것 (다음 단계)

- 오프라인 학습 (지금 서비스 워커는 정적 자산만 캐시한다)
- 사전 자동완성 (읽기를 직접 입력하지 않아도 되게)
