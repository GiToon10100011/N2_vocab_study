# N2 단어 — 작업 지침

JLPT N2 준비용 개인 단어 학습 앱. 상세 기획서: `~/.claude/plans/spicy-sparking-pillow.md`

## 절대 규칙 (기능 추가보다 우선한다)

1. **한자 쓰기 문제를 만들지 않는다.** 필기 능력은 목표가 아니다.
2. **뜻 → 한자 / 뜻 → 읽기 유형을 만들지 않는다.** 역추론은 학습 효과를 떨어뜨린다.
   카드 유형은 `s2r | s2m | r2m` 3개가 전부이고, 이 enum을 늘리지 않는다.
3. **한자 → 읽기 카드에서 뜻은 공개 전까지 DOM 에 렌더하지 않는다.**
   `visibility`/`opacity` 로 숨기는 것이 아니다. `app/study/CardFace.test.tsx` 가 이를 검증한다.
4. **한 세션에 같은 단어는 한 번만 출제한다**(세션 내 재시도만 예외).
   같은 이유로 `(surface, reading)` unique 인덱스를 유지한다 — 중복 행이 생기면 한 단어에
   SRS 스케줄이 2개 생겨 복습량이 조용히 두 배가 되고, 두 행이 한 세션에 같이 나오면
   앞 카드가 뒤 카드의 정답이 된다. 단 **저장을 실패시키지는 않는다**: 충돌하면 뜻만 갱신하고
   진도는 그대로 두어 입력 흐름(Enter 체인)을 끊지 않는다.
5. **연습 퀴즈는 복습 주기를 건드리지 않는다.** `planGrades(..., practice = true)` 는
   `schedule` 을 null 로 두고 `counters` 만 낸다. 단, 오답 기록(wrong_count/streak)은
   갱신한다 — 연습에서 계속 틀리는 단어는 오답노트에 올라와야 하기 때문이다.
6. **읽기는 추정하지 않는다.** 부분 변환(IMEMode)과 IME 조합 가로채기를 쓰지 말 것.
   `ふきゅう` 가 `ふきゅ` 로 잘려 저장된 적이 있다. `normalizeReading()` 으로 칸을 떠날 때
   통째로 변환하고, 가나가 아니면 저장을 막는다. 표기가 가나뿐이면 읽기 = 표기로 확정한다.
7. **통합 테스트(`*.itest.ts`)는 실제 어휘를 픽스처로 쓰지 않는다.** 전각 `ＺＺ` 네임스페이스를
   쓴다. 예전에 `環境` 을 픽스처로 썼다가 정리 단계에서 실제 단어 행을 지운 적이 있다.
8. 학습 효과를 직접 올리지 않는 기능은 추가하지 않는다.
   제외 목록: 소셜, 다중 사용자, AI, 게임화, 애니메이션, 복잡한 통계, 덱/태그, TTS.

## 구조

```
lib/srs.ts         간격 사다리 · 전이 규칙 · 유형 추첨 · 큐 구성. 전부 순수 함수
lib/queries.ts     SQL. date/timestamptz 는 to_char 로 문자열 고정해서 받는다
lib/kana.ts        읽기 확정 변환. 부분 변환 금지
lib/parse.ts       붙여넣기 파서
lib/settings.ts    설정 + 하루 경계 기준 오늘 날짜
lib/actions/       Server Action ("use server")
app/api/grades/    채점 배치. keepalive fetch 를 쓰려고 Route Handler 로 뒀다
app/study/         세션 화면. CardFace 는 테스트를 위해 분리되어 있다
app/manifest.ts    PWA 매니페스트. 아이콘은 scripts/make-icons.mjs 가 생성한다
public/sw.js       서비스 워커. 정적 자산만 캐시한다
proxy.ts           비밀번호 게이트 (Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다)
                   PWA 자산은 matcher 에서 제외되어 있어야 한다
```

## 변경 시 주의

- **SRS 계산은 서버에서만 한다.** 클라이언트는 `{wordId, kind, correct, retry}` 만 보낸다.
  전이 규칙을 클라이언트에 복제하지 말 것.
- **세션 중 네트워크 왕복을 늘리지 말 것.** 큐는 시작할 때 한 번만 받고, 채점은 5장씩 모아 보낸다.
- 날짜는 전부 `'YYYY-MM-DD'` 문자열로 다룬다. `Date` 객체를 스키마나 API 경계에 넣지 않는다.
- 하루 경계는 04:00(`APP_TIMEZONE`). `studyDate()` 를 쓰고 `new Date()` 로 날짜를 만들지 않는다.
- `lib/srs.ts` 를 고쳤으면 `npm test` 가 반드시 통과해야 한다.

## 검증

```bash
npm test          # 50개 (SRS 전이표, 유형 분포, 큐, 읽기 변환, 파서, 카드 누출)
npm run test:db   # 12개 (실제 Neon 왕복)
npm run typecheck
npx eslint .
npm run build
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
