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
| `/add` | 단어 추가. Enter 로 칸 이동 → 저장 → 첫 칸 복귀. 학습일을 지난 날짜로 지정할 수 있다 |
| `/api/export?format=csv` | CSV 백업 (엑셀 호환, BOM 포함) |
| `/api/export?format=json` | JSON 백업 (리뷰 로그 포함) |

## 학습 세션 단축키

```
Space / Enter   정답 보기 (학습 카드에서는 다음)
1 또는 J        알았음
2 또는 F        몰랐음
U               직전 채점 되돌리기 (서버 전송 전까지)
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

## 두 가지 학습 모드

```
오늘의 복습 주기 (SRS)        일차 / 주차 연습 퀴즈
────────────────────         ────────────────────
하루 한 번, 오늘 걸린 것만     아무 때나, 몇 번이든
알았음/몰랐음이 사다리에 반영   DB 에 아무것도 쓰지 않음
신규 단어는 학습 카드부터      순서가 매번 섞임
```

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
npm test             # 순수 로직 테스트 31개 (SRS 전이표·유형 분포·큐·연습큐·카드 누출)
npm run test:db      # 실제 Neon DB 왕복 테스트 8개
npm run typecheck    # tsc --noEmit
npm run db:migrate   # 스키마 적용 (멱등)
npm run db:seed      # 예시 단어 10개 넣기 (-- --clear 로 제거)
npm run icons        # PWA 아이콘 재생성
npm run build        # 프로덕션 빌드
```

핵심 로직은 전부 `lib/srs.ts` 의 순수 함수에 있고, SRS 계산은 **서버에서만** 한다
(`app/api/grades/route.ts`). 클라이언트는 `{wordId, kind, correct}` 만 보낸다.

## 백업

Neon 무료 플랜은 시점 복구 보존 기간이 짧다. **주 1회 홈 화면 하단의 CSV/JSON 백업을 눌러
파일을 받아두는 것을 습관으로 삼는다.** CSV 는 앞 3열(`surface,reading,meaning_ko`)만 떼면
Anki/Quizlet 으로도 그대로 들어간다.

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

- 단어 목록 화면 (검색 / 필터 / 인라인 수정 / 삭제)
- CSV import, 여러 단어 붙여넣기 일괄 등록
- 통계 화면 (오늘 / 이번 주 / 전체, 유형별 정답률)
- 설정 화면 (일일 상한, 출제 비율, 하루 시작 시각)
- 세션 중 `E` 키로 단어 수정
- 오프라인 학습 (지금 서비스 워커는 정적 자산만 캐시한다)
