# 실전 테스트 (한자 → 읽기 타이핑) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한자 표기를 보고 읽기를 가나로 직접 쳐서 글자 단위로 채점하는 「실전 테스트」를 이틀에 한 번 홈에 띄우고, 틀린 단어를 플래시카드 SRS 로 되돌린다.

**Architecture:** 판정 · 음절 대조 · 출제 선택 · 출현 판정 · SRS 반영은 `lib/` 순수 함수로 두고 단위 테스트한다. 문항은 새 표 `typing_test_items` 에 시작할 때 N줄을 넣고 답할 때 채운다. 답은 기존 grade-outbox 로 모아 `/api/test-answers` 로 보내고, 서버가 같은 판정 함수로 다시 채점한다. 테스트 채점 행은 `reviews.test = true`(`prompt_type = 's2r'`)로 구분한다.

**Tech Stack:** Next 16.3.4 (App Router) · React 19.2.8 · `@neondatabase/serverless` HTTP 드라이버 · wanakana 5.3.1 · vitest 5 · Playwright (격리 DB `n2v_e2e`).

**Spec:** `docs/superpowers/specs/2026-10-22-typing-test-design.md` (승인됨 2026-10-22). 실행자는 이 계획과 함께 읽는다.

## Global Constraints

- N2_vocab `CLAUDE.md` 절대 규칙 1~8 전부. 특히 2 (enum `s2r|s2m|r2m` 를 늘리지 않는다 — 테스트 행은 `prompt_type='s2r'`), 3 (정답 읽기 · 뜻은 답을 내기 전까지 DOM 에 렌더하지 않는다), 6 (부분 변환 · IME 조합 가로채기 금지), 7 (`*.itest.ts` 픽스처는 `ＺＺ`).
- 로마자 `-` → `ー`. 가타카나는 히라가나로 바꿔 비교하되 **`ー` 는 보존**한다. `wanakana.toHiragana` 를 비교 경로에 쓰지 않는다 (`チューショーテキ` 가 정답이 되어 버린다).
- 채점: 한 글자라도 다르면 오답 (장음 · 요음 · 촉음 포함). 표기와 읽기가 둘 다 `だ` 로 끝나면 입력의 `だ` 는 있든 없든 정답. 「오타였음」 · 되돌리기 · 채점 뒤 정답 인정은 없다.
- 반영: 정답 → stage · next_review **그대로**, 카운터만 갱신. 오답 → `gradeSchedule(state, false, today)` (stage 1, 내일) + `last_wrong_type = 's2r'`. SRS 계산은 서버에서만.
- 문제 수 기본 **40** (설정 범위 10~100). 주기는 **이틀 고정**, 끝낸 테스트의 학습일 기준. 하루 경계 04:00 (`studyDate()`). 낼 단어 0개면 안 뜬다. 미리 보는 버튼 없음.
- 날짜는 `'YYYY-MM-DD'` 문자열. `Date` 를 스키마 · API 경계에 넣지 않는다.
- 문제마다 네트워크 왕복 없음. 서버가 `ok` 라고 답한 뒤에만 저장소에서 지운다. 탭을 닫는 순간에는 보내지 않는다 (`sendBeacon` · `keepalive` 금지).
- 친 답(`typing_test_items`)은 **공개 백업에 넣지 않는다**. `reviews` 의 테스트 정오 기록은 백업된다.
- 운영 DB 변경(`npm run db:migrate`)과 `git push` 는 사용자 승인 뒤에만. **`npm run test:db` 는 돌리지 않는다** (운영 DB 로 붙는다). DB 검증은 E2E(격리 DB) + 순수 함수 단위 테스트.
- 코드가 스키마보다 먼저 올라가도 홈 · /study · /stats · /settings 가 죽지 않는다.
- 커밋 메시지는 한국어 한 문장(「~한다/~둔다」), attribution · Co-Authored-By · 세션 URL 없음. 저장소는 공개 — 개인 정보 없음.
- 아이폰 실기기에서 확인하지 않은 동작은 「검증 완료」라고 쓰지 않고 「미확인」이라고 쓴다.
- 환경: ecc GateGuard 훅이 세션 첫 Bash · 파일별 첫 Write/Edit 을 거부할 수 있다. 요구하는 사실을 말하고 같은 호출을 다시 한다. Next 16 은 API 가 다르다 — 라우트 · 서버 액션 코드를 쓰기 전에 `node_modules/next/dist/docs/01-app/` 의 해당 문서를 본다 (`redirect` 는 `try` 밖에서 부른다).

## Review Focus

스펙이 말하지 않았지만 쓰는 사람이 부딪힐 입력 · 조건. 각 줄의 테스트는 소유 Task 에 `(Review Focus n)` 으로 달려 있다.

1. **아이폰 Safari 의 확정 Enter** (`compositionend` 뒤에 오는 `keyCode 229`) 가 제출/다음으로 처리되면 글자 하나 칠 때마다 문제가 넘어간다. 기대: 절대 제출되지 않는다. → Task 11
2. **테스트 도중 단어를 보류 · 삭제.** 기대: 남은 수에서 빠지고, 남은 것을 다 풀면 테스트가 끝나며, 홈에 「남은 N」이 고여 있지 않다. → Task 11
3. **같은 답이 다른 묶음 id 로 두 번 도착** (두 기기 · 응답 유실 뒤 재전송). 기대: 한 번만 반영된다. → Task 8
4. **스키마 반영 전 코드.** 기대: 홈 · /study · /stats · /settings(저장 포함)가 정상이고 테스트 카드만 없다. → Task 14
5. **04:00 경계.** 기대: 03:59 에 끝낸 테스트는 전날로 세고, 끝낸 지 2일이 안 됐으면 안 뜨며, 며칠을 건너뛰어도 뜨는 것은 1회분이다. → Task 3

---

## 파일 지도

| 파일 | 책임 |
|---|---|
| `lib/reading-answer.ts` (새) | 입력 → 가나 확정 · 검사 · 판정. 화면과 서버가 같이 쓴다 |
| `lib/syllable-diff.ts` (새) | 음절 분해 · 음절 단위 대조 |
| `lib/typing-test.ts` (새) | 상수 · 이력 판정 · 대상 · 가중치 · 선택 · 출현 · 요청 파서 · 카드 표시. 전부 순수 |
| `lib/typing-test-load.ts` (새) | 서버 로더 · 시작 · 읽기 주의 조회 (SQL 포함) |
| `lib/grade-apply.ts` (새) | 영수증 키 · 단어 갱신 · 리뷰 insert 공용 조각 (`/api/grades` 와 `/api/test-answers` 가 같이 쓴다) |
| `lib/actions/typing-test.ts` (새) | 「시작」 Server Action |
| `app/api/test-answers/route.ts` (새) | 테스트 답 배치. 서버 재채점 |
| `app/test/{page,TestSession,QuestionFace}.tsx`, `keys.ts` (새) | /test 화면 |
| `app/RecoveryNotice.tsx`, `app/useGradeRecovery.ts` (새) | 학습 · 테스트 화면이 같이 쓰는 미전송 채점 복구 |
| 고침 | `db/schema.sql` · `lib/{types,srs,queries,db,kana,grade-outbox,grade-client,study}.ts` · `lib/actions/settings.ts` · `app/api/grades/route.ts` · `app/{page,GradeRecovery}.tsx` · `app/study/StudySession.tsx` · `app/settings/SettingsForm.tsx` · `scripts/backup-tables.mjs` · `lib/backup.test.ts` · `.gitignore` · `e2e/{helpers,undo.spec}.ts` · `CLAUDE.md` · `README.md` · `backups/README.md` |

---

### Task 1: 답 정규화 · 판정

**Files:**
- Create: `lib/reading-answer.ts`, `lib/reading-answer.test.ts`
- Modify: `lib/kana.ts` (`fromImeRomaji` 에 `export` 를 붙인다)

**Interfaces:**
- Produces:
```ts
export function convertAnswer(input: string): string  // 미리보기용. 실패해도 문자열을 돌려준다
export type AnswerCheck = { ok: true; kana: string } | { ok: false; reason: "empty" | "not-kana" }
export function checkAnswer(input: string): AnswerCheck
export type Judgement =
  | { result: "invalid"; reason: "empty" | "not-kana" }
  | { result: "correct" | "wrong"; kana: string; compare: { typed: string; expected: string } }
export function judgeReading(input: string, word: { surface: string; reading: string }): Judgement
```
`kana` = 저장할 확정 가나. `compare` = 끝 `だ` 규칙을 적용한 뒤 실제로 비교한 두 문자열(음절 대조에 쓴다).

- [ ] **Step 1: 실패하는 테스트 `lib/reading-answer.test.ts`**
```ts
expect(convertAnswer("chu-shoteki")).toBe("ちゅーしょてき");        // 로마자 - → ー
expect(convertAnswer("チューショーテキ")).toBe("ちゅーしょーてき");    // ー 보존
expect(convertAnswer("チューショーテキ")).not.toBe("ちゅうしょうてき");
expect(convertAnswer("ﾁｭｳｼｮｳﾃｷ")).toBe("ちゅうしょうてき");          // 반각
expect(convertAnswer("ＣＨＵＵ")).toBe("ちゅう");                   // 전각 대문자
expect(convertAnswer(" chuu shou ")).toBe("ちゅうしょう");          // 공백 제거
expect(convertAnswer("shinbunn")).toBe("しんぶん");                 // IME 관례 nn
expect(convertAnswer("annai")).toBe("あんない");
expect(convertAnswer("gakkou")).toBe("がっこう");
expect(convertAnswer("ヴァイオリン")).toBe("ゔぁいおりん");
for (const s of ["chu-shoteki", "チューショー", "ﾁｭｳ", "shinbunn", "desu."])
  expect(convertAnswer(convertAnswer(s))).toBe(convertAnswer(s));   // 멱등 — 서버가 kana 를 다시 판정한다

expect(checkAnswer("chuusouteki")).toEqual({ ok: true, kana: "ちゅうそうてき" });
expect(checkAnswer("  ")).toEqual({ ok: false, reason: "empty" });
for (const s of ["抽象的", "ちゅう抽", "ch", "desu."]) expect(checkAnswer(s)).toEqual({ ok: false, reason: "not-kana" });

const W = { surface: "抽象的", reading: "ちゅうしょうてき" };
expect(judgeReading("chuushouteki", W).result).toBe("correct");
expect(judgeReading("チュウショウテキ", W).result).toBe("correct");
expect(judgeReading("chuusouteki", W)).toMatchObject({ result: "wrong", kana: "ちゅうそうてき" });
expect(judgeReading("チューショーテキ", W).result).toBe("wrong");     // 장음 오류를 정답 처리하지 않는다
expect(judgeReading("ちゅしょうてき", W).result).toBe("wrong");
expect(judgeReading("", W)).toEqual({ result: "invalid", reason: "empty" });
expect(judgeReading("抽象的", W)).toEqual({ result: "invalid", reason: "not-kana" });
// 끝 だ: 표기 · 읽기가 둘 다 だ 로 끝날 때만, 입력의 だ 는 있든 없든 정답
const D = { surface: "哀れだ", reading: "あわれだ" };
expect(judgeReading("aware", D).result).toBe("correct");
expect(judgeReading("awareda", D).result).toBe("correct");
expect(judgeReading("awaredaa", D).result).toBe("wrong");
expect(judgeReading("ゆうめいだ", { surface: "有名", reading: "ゆうめい" }).result).toBe("wrong");
// 정답 쪽도 같은 변환을 거친다 (읽기가 가타카나로 저장된 단어)
expect(judgeReading("こーひー", { surface: "珈琲", reading: "コーヒー" }).result).toBe("correct");
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/reading-answer.test.ts` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현.** `convertAnswer` = NFKC → 공백(`\s`) 제거 → 소문자 → `fromImeRomaji` → wanakana `toKana` → 가타카나(ァ-ヶ)를 코드포인트 −0x60 으로 히라가나로 (`ー` 는 건드리지 않는다). `checkAnswer` 는 빈 값 → `empty`, `/^[ぁ-ゖー]+$/` 가 아니면 `not-kana`. `judgeReading` 은 `expected = convertAnswer(word.reading)` 와 비교하고, `word.surface` 와 `expected` 가 둘 다 `だ` 로 끝나면 양쪽에서 끝 `だ` 하나씩만 떼고 비교한다 (떼고 남는 길이가 0 이면 규칙을 적용하지 않는다). `toHiragana` 는 import 하지 않는다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/reading-answer.test.ts lib/kana.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋**
```bash
git add lib/reading-answer.ts lib/reading-answer.test.ts lib/kana.ts
git commit -m "실전 테스트: 입력을 가나로 확정하고 읽기를 판정하는 함수를 둔다"
```

---

### Task 2: 음절 대조

**Files:**
- Create: `lib/syllable-diff.ts`, `lib/syllable-diff.test.ts`

**Interfaces:**
- Produces:
```ts
export function toSyllables(kana: string): string[]
export type DiffBlock = { kind: "same"; text: string } | { kind: "diff"; typed: string; expected: string }
export function diffSyllables(typed: string, expected: string): DiffBlock[]
```
`diff` 블록의 한쪽이 `""` 이면 그쪽에 그 음절이 없다는 뜻(누락).

- [ ] **Step 1: 실패하는 테스트**
```ts
expect(toSyllables("ちゅうしょうてき")).toEqual(["ちゅ", "う", "しょ", "う", "て", "き"]);
expect(toSyllables("がっこう")).toEqual(["が", "っ", "こ", "う"]);   // っ 는 단독
expect(toSyllables("こーひー")).toEqual(["こ", "ー", "ひ", "ー"]);   // ー 는 단독
expect(toSyllables("しんぶん")).toEqual(["し", "ん", "ぶ", "ん"]);   // ん 은 단독
expect(diffSyllables("ちゅうそうてき", "ちゅうしょうてき")).toEqual([
  { kind: "same", text: "ちゅう" }, { kind: "diff", typed: "そ", expected: "しょ" }, { kind: "same", text: "うてき" }]);
expect(diffSyllables("がこう", "がっこう")).toEqual([
  { kind: "same", text: "が" }, { kind: "diff", typed: "", expected: "っ" }, { kind: "same", text: "こう" }]);
expect(diffSyllables("どぶつ", "どうぶつ")).toEqual([
  { kind: "same", text: "ど" }, { kind: "diff", typed: "", expected: "う" }, { kind: "same", text: "ぶつ" }]);
expect(diffSyllables("ふきゅ", "ふきゅう")).toEqual([
  { kind: "same", text: "ふきゅ" }, { kind: "diff", typed: "", expected: "う" }]);
expect(diffSyllables("かんき", "かんき")).toEqual([{ kind: "same", text: "かんき" }]);
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/syllable-diff.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.** `toSyllables`: 작은 글자 `ゃゅょぁぃぅぇぉゎゕゖ` 는 앞 글자에 붙이고(맨 앞이면 단독), `っ` · `ー` · `ん` 은 단독. `diffSyllables`: 두 음절 배열의 LCS 로 정렬하고, 연속한 비동일 구간을 `diff` 블록 하나로 묶고, 동일 구간은 `same` 으로 합친다. 동률일 때의 선택은 결정적이기만 하면 된다 (위 테스트는 정렬이 하나뿐이다). 표시 단위는 음절이라 `ちゅう[そ]うてき` 처럼 `う` 는 표시하지 않는다 — 스펙의 `[そう]` 예시보다 좁다 (`どう`/`ど` 처럼 장음 누락을 `う` 하나로 짚기 위해서다).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/syllable-diff.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋**
```bash
git add lib/syllable-diff.ts lib/syllable-diff.test.ts
git commit -m "실전 테스트: 틀린 읽기를 음절 단위로 대조하는 함수를 둔다"
```

---

### Task 3: 출제 선택 · 출현 · 이력 (순수)

**Files:**
- Create: `lib/typing-test.ts`, `lib/typing-test.test.ts`

**Interfaces:**
- Consumes: `checkAnswer` (Task 1), `isKanaOnly` · `shuffle` · `diffDays` · `addDays` · `studyDate` · `APP_TIMEZONE` · `DAY_START_HOUR` (`lib/srs.ts`)
- Produces:
```ts
export const TEST_SIZE_DEFAULT = 40, TEST_SIZE_MIN = 10, TEST_SIZE_MAX = 100;
export const TEST_INTERVAL_DAYS = 2, PASS_STREAK = 2;
export function normalizeTestSize(v: unknown): number          // 숫자 아님 → 40, 반올림 후 10~100 으로 자른다
export type TestStatus = "untested" | "retest" | "passed";
export function testStatus(history: boolean[]): TestStatus     // history = 테스트 정오, 오래된 것부터
export interface TestCandidate {
  id: string; surface: string; reading: string; study_day: string; stage: number; suspended: boolean;
  firstReviewDay: string | null;      // 첫 리뷰 로그(learn 포함)의 학습일. 로그가 없으면 null
  s2rWrong: number;                   // 플래시카드 s2r 오답 (재시도 · 연습 · 테스트 행 제외)
  history: boolean[]; lastAnsweredAt: string | null;   // ISO
}
export const CONFUSABLE: RegExp   // /[ゃゅょっ]|[おこそとのほもよろをごぞどぼぽ]う|[えけせてねへめれげぜでべぺ]い/
export function isTestEligible(c: TestCandidate, today: string): boolean
export function testWeight(c: TestCandidate, today: string): number
export function weightedOrder<T>(items: T[], weight: (t: T) => number, rand?: () => number): T[]
export function pickTestWords(cands: TestCandidate[], today: string, size: number, rand?: () => number): string[]
export interface LatestTest { testDay: string; total: number; remaining: number; lastAnsweredAt: string | null }
export type TestPhase =
  | { phase: "active"; testDay: string; remaining: number; total: number }
  | { phase: "wait"; nextDay: string } | { phase: "ready" }
export function finishedStudyDay(latest: Pick<LatestTest, "testDay" | "lastAnsweredAt">, dayStartHour?: number): string
export function testPhase(latest: LatestTest | null, today: string, dayStartHour?: number): TestPhase
export function parseTestAnswers(raw: unknown): { wordId: string; typed: string }[]
```

- [ ] **Step 1: 실패하는 테스트.** 테스트 파일 안에서 `const T = "2026-10-22"` (today), `seq(...values)` = 부를 때마다 값을 차례로 돌려주는 `rand`, 기본 후보 `cand(over = {})` = `{id:"w1", stage:3, suspended:false, surface:"違反", reading:"いはん", study_day:"2026-10-22", firstReviewDay:"2026-10-19", s2rWrong:0, history:[], lastAnsweredAt:null, ...over}` 를 정의한다.
```ts
// testStatus
expect(testStatus([])).toBe("untested");
for (const h of [[true], [false, true, true], [false, true, false, true, true]]) expect(testStatus(h)).toBe("passed");
for (const h of [[false], [false, true], [true, false], [false, true, true, false]]) expect(testStatus(h)).toBe("retest");
// normalizeTestSize
expect([normalizeTestSize(undefined), normalizeTestSize("x"), normalizeTestSize(5), normalizeTestSize(500), normalizeTestSize(39.6)]).toEqual([40, 40, 10, 100, 40]);
// isTestEligible — 기본 true, 아래는 각각 false
isTestEligible(cand({ stage: 0 })); isTestEligible(cand({ suspended: true }));
isTestEligible(cand({ surface: "きっかけ", reading: "きっかけ" }));      // 가나 전용
isTestEligible(cand({ firstReviewDay: "2026-10-22" }));                  // 그날 처음 배운 단어
isTestEligible(cand({ reading: "ＺＺよみ" }));                            // 판정 불가 읽기
isTestEligible(cand({ firstReviewDay: null }));                          // → true (로그 없음은 제외하지 않는다)
// testWeight
expect(testWeight(cand(), T)).toBe(1);
expect(testWeight(cand({ s2rWrong: 2 }), T)).toBe(3);   expect(testWeight(cand({ s2rWrong: 9 }), T)).toBe(4);
for (const r of ["がっこう", "ちゅうしょうてき", "けいざい", "せいじ"]) expect(testWeight(cand({ reading: r }), T)).toBe(2);  // 함정은 ×2 한 번
expect(testWeight(cand({ study_day: "2026-10-15" }), T)).toBe(2);   // 7일 → 1 + 7/7
expect(testWeight(cand({ study_day: "2026-08-01" }), T)).toBe(9);   // 56일에서 멈춘다
expect(testWeight(cand({ study_day: "2026-10-30" }), T)).toBe(1);   // 미래 학습일은 0일로
expect(testWeight(cand({ s2rWrong: 3, reading: "がっこう", study_day: "2026-08-01" }), T)).toBe(72);
// weightedOrder
expect(weightedOrder(["a", "b", "c", "d"], (x) => ({ a: 1, b: 3, c: 3, d: 2 })[x]!, () => 0.5)).toEqual(["b", "c", "d", "a"]); // 무거운 순, 동률은 입력 순
expect(weightedOrder(["a", "b"], (x) => (x === "a" ? 1 : 3), seq(0.01, 0.99))).toEqual(["a", "b"]);  // 가벼운 쪽이 이길 수 있다 — 위험한 것부터 줄 세우지 않는다
// pickTestWords (결과는 .sort() 로 비교 — 마지막에 shuffle 한다)
//  재시험 > 처음 보는 단어 > 통과: 후보 R(재시험) U(미출제) P(통과) 가 size 2 → R 과 U 가중 1위
//  재시험이 size 보다 많으면 lastAnsweredAt 이 오래된 것부터 (5개 중 3개 → 가장 오래된 3개)
//  전부 통과 상태면 통과가 오래된 것부터 size 개
//  자격 없는 후보(보류 · 가나 전용 · 오늘 배움)는 어떤 경우에도 안 나온다
//  후보가 size 보다 적으면 그만큼만 (짧은 테스트)
//  rand 를 () => 0.5 로 고정하면 처음 보는 단어 자리는 가중치 큰 순으로 채워진다
// testPhase / finishedStudyDay  (Review Focus 5)
expect(testPhase(null, T)).toEqual({ phase: "ready" });
expect(testPhase({ testDay: "2026-10-21", total: 40, remaining: 3, lastAnsweredAt: null }, T)).toEqual({ phase: "active", testDay: "2026-10-21", remaining: 3, total: 40 });
const done = (at: string | null, day = "2026-10-20") => ({ testDay: day, total: 40, remaining: 0, lastAnsweredAt: at });
expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-10-21")).toEqual({ phase: "wait", nextDay: "2026-10-22" });
expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-10-22")).toEqual({ phase: "ready" });
expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-11-30")).toEqual({ phase: "ready" });  // 몇 번을 건너뛰어도 1회분
expect(finishedStudyDay(done("2026-10-20T18:59:00Z"))).toBe("2026-10-20");   // KST 10-21 03:59 → 전날
expect(finishedStudyDay(done("2026-10-20T19:00:00Z"))).toBe("2026-10-21");   // KST 04:00 → 그날
expect(testPhase(done("2026-10-20T18:59:00Z"), "2026-10-22")).toEqual({ phase: "ready" });   // 03:59 에 끝냈으면 이틀 지난 것
expect(testPhase(done("2026-10-20T19:00:00Z"), "2026-10-22")).toEqual({ phase: "wait", nextDay: "2026-10-23" });
expect(finishedStudyDay(done(null, "2026-10-20"))).toBe("2026-10-20");        // 답이 하나도 없이 끝났으면 test_day
// parseTestAnswers
//  배열이 아니면 [] · wordId 가 문자열이고 10자 이상 · typed 가 비지 않은 64자 이하 문자열일 때만 · 200건까지 · 같은 wordId 는 첫 건만
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/typing-test.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.**
  - `testStatus`: 기록이 없으면 `untested`; 오답이 한 번도 없으면 `passed`; 마지막 오답 뒤 연속 정답이 `PASS_STREAK` 미만이면 `retest`, 이상이면 `passed`.
  - `testWeight` = `(1 + min(s2rWrong, 3)) × (CONFUSABLE.test(reading) ? 2 : 1) × (1 + min(max(diffDays(today, study_day), 0), 56) / 7)`.
  - `weightedOrder`: Efraimidis–Spirakis. 항목마다 `rand()` 를 입력 순서대로 한 번씩 불러 `key = Math.log(1 - rand()) / weight` 를 구하고 key 큰 순으로 안정 정렬한다.
  - `pickTestWords`: 자격 있는 후보만 → ① `retest` (lastAnsweredAt 오름차순) ② `untested` (`weightedOrder`) ③ `passed` (lastAnsweredAt 오름차순) 를 이어 붙여 `slice(0, size)` → `shuffle(…, rand)` → id 배열.
  - `finishedStudyDay` = `studyDate(new Date(lastAnsweredAt ?? …), APP_TIMEZONE, dayStartHour)`, 답이 없으면 `testDay`. `testPhase`: `latest` 없음 → `ready`; `remaining > 0` → `active`; 아니면 `diffDays(today, finishedDay) >= TEST_INTERVAL_DAYS` → `ready`, 아니면 `wait`(`nextDay = addDays(finishedDay, 2)`).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/typing-test.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋**
```bash
git add lib/typing-test.ts lib/typing-test.test.ts
git commit -m "실전 테스트: 출제 선택과 출현 판정을 순수 함수로 둔다"
```

---

### Task 4: SRS 반영 — `planTestGrades` · 같은 날 겹침 가드

**Files:**
- Modify: `lib/srs.ts` (`GradePlanItem.log`, `planGrades`, 새 `planTestGrades`), `lib/srs.test.ts`

**Interfaces:**
- Consumes: `gradeCounters` · `gradeSchedule` (같은 파일)
- Produces:
```ts
// GradePlanItem.log 에 test?: boolean 을 더한다 (planGrades 가 만드는 항목은 test 를 쓰지 않는다)
export function planGrades(states, grades, today, practice = false, testWrongToday: ReadonlySet<string> = new Set()): GradePlanItem[]
export function planTestGrades(states: Map<string, SrsState>, answers: { wordId: string; correct: boolean }[], today: string): GradePlanItem[]
```

- [ ] **Step 1: 실패하는 테스트** (`lib/srs.test.ts` 에 이어 붙인다. 기존 120개는 그대로 통과해야 한다)
```ts
// planTestGrades — 상태 {stage:3, correct_count:5, wrong_count:1, streak:2, last_wrong_type:null}
//  정답: counters {correct_count:6, wrong_count:1, streak:3, last_wrong_type:null}, schedule null,
//        log {promptType:"s2r", correct:true, retry:false, practice:false, test:true}
//  오답: counters {correct_count:5, wrong_count:2, streak:0, last_wrong_type:"s2r"},
//        schedule {stage:1, next_review: addDays(TODAY, 1)}, log.correct false, log.test true
//  states 에 없는 단어는 건너뛴다
// planGrades 가드 (testWrongToday = new Set(["w1"]))
//  비연습 · kind "s2r" · correct true · w1 → counters null, schedule null, log 는 남는다 (correct true, practice false)
//  w2 (집합 밖) 는 평소대로 counters · schedule 이 생긴다
//  practice=true 에서는 집합에 있어도 counters 가 갱신된다 (가드는 비연습 SRS 에만)
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/srs.test.ts` / Expected: 새 테스트만 FAIL
- [ ] **Step 3: 구현.** `planGrades` 의 `learn` · `retry` 분기 조건에 `(!practice && testWrongToday.has(g.wordId))` 를 더해 로그만 남기게 한다 (`states` 는 건드리지 않는다). `planTestGrades` 는 정답이면 `counters = gradeCounters(state, "s2r", true)` · `schedule = null`, 오답이면 `gradeCounters(state, "s2r", false)` · `gradeSchedule(state, false, today)`, `log = {promptType:"s2r", correct, retry:false, practice:false, test:true}`. `planGrades` 처럼 `states` 를 갱신한다.
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전체 PASS (기존 120 + 새 테스트)
- [ ] **Step 5: 커밋**
```bash
git add lib/srs.ts lib/srs.test.ts
git commit -m "실전 테스트: 테스트 채점의 SRS 반영과 같은 날 겹침 가드를 둔다"
```

---

### Task 5: 스키마 · 스키마 없음 판별 · 통계 제외 · 백업 가드 → 격리 DB 에만 반영

**Files:**
- Modify: `db/schema.sql`, `lib/db.ts`, `lib/queries.ts` (`fetchTypeStats` · `fetchPeriodStats`), `scripts/backup-tables.mjs`(주석), `lib/backup.test.ts`, `.gitignore`, `backups/README.md`, `e2e/helpers.ts` (`resetDb`)
- Create: `lib/db.test.ts`

**Interfaces:**
- Produces: `export function pgCode(err: unknown): string | undefined` · `export function isMissingSchema(err: unknown): boolean` (`42P01` 또는 `42703`) — `lib/db.ts`

- [ ] **Step 1: 실패하는 테스트**
```ts
// lib/db.test.ts
expect(pgCode({ code: "42P01" })).toBe("42P01"); expect(pgCode(null)).toBeUndefined(); expect(pgCode("x")).toBeUndefined();
expect(isMissingSchema({ code: "42P01" })).toBe(true); expect(isMissingSchema({ code: "42703" })).toBe(true);
expect(isMissingSchema({ code: "23505" })).toBe(false); expect(isMissingSchema(new Error("x"))).toBe(false);
// lib/backup.test.ts 에 추가 — study_ranges 항목과 같은 모양
//  BACKUP_TABLES 에 "typing_test_items" 가 없고 "reviews" 는 있다 (테스트 정오는 reviews.test 로 백업된다)
//  .gitignore 에 "backups/typing_test_items.csv" 가 있다
//  backup.yml 에 "typing_test_items" 가 없다
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/db.test.ts lib/backup.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.**
  - `db/schema.sql` 끝에 이 문장들을 둔다 (문장은 `;` 로 나뉘므로 주석 안에 `;` 를 쓰지 않는다):
```sql
alter table reviews add column if not exists test boolean not null default false;

create table if not exists typing_test_items (
  test_day    date        not null,
  word_id     uuid        not null references words(id) on delete cascade,
  typed       text,
  correct     boolean,
  answered_at timestamptz,
  primary key (test_day, word_id),
  constraint typing_test_items_answered
    check ((answered_at is null) = (typed is null) and (answered_at is null) = (correct is null))
);
create index if not exists typing_test_items_word on typing_test_items (word_id, answered_at);

alter table settings add column if not exists test_size smallint not null default 40
  constraint settings_test_size check (test_size between 10 and 100);
```
  주석에는 이유를 적는다: `test` = 실전 테스트로 낸 채점(`prompt_type` 은 `s2r`), `typing_test_items` = 테스트 문항과 친 답(**백업하지 않는다**), 안 푼 문항 = `answered_at is null`.
  - `lib/queries.ts`: 두 통계 쿼리의 `from reviews` 에 별칭 `r` 을 달고 `and (to_jsonb(r) ->> 'test') is distinct from 'true'` 를 더한다 (`fetchPeriodStats` 는 서브쿼리 둘 다). 컬럼 이름으로 읽지 않는 이유(열이 없는 DB 에서도 동작)를 한 줄 적는다.
  - `.gitignore` 에 `backups/typing_test_items.csv`, `scripts/backup-tables.mjs` 주석에 한 줄(친 답은 공개 저장소에 올리지 않는다), `backups/README.md` 에 「`reviews.csv` 에 `test` 열이 있다 / `typing_test_items` 는 백업하지 않는다」.
  - `e2e/helpers.ts` `resetDb` 의 `truncate` 목록에 `typing_test_items` 를 더한다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/db.test.ts lib/backup.test.ts && npm run typecheck` / Expected: PASS
- [ ] **Step 5: 격리 DB 에만 스키마 반영** (운영 아님 — `[운영]` 라벨은 주소를 바꿔 넣어서 찍히는 것이다)
```bash
E2E_URL=$(node -e 'const s=require("fs").readFileSync(".env.local","utf8");const m=s.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);process.stdout.write(m[1].replace(/\/neondb(\?|$)/,"/n2v_e2e$1"))')
case "$E2E_URL" in *"/n2v_e2e"*) DATABASE_URL="$E2E_URL" node scripts/migrate.mjs ;; *) echo "격리 DB 주소가 아니다 — 중단"; exit 1 ;; esac
```
  Expected: 출력 `tables:` 줄에 `typing_test_items`. 한 번 더 돌려도 오류 없음(멱등). `npm run db:migrate` 는 **돌리지 않는다.**
- [ ] **Step 6: 커밋**
```bash
git add db/schema.sql lib/db.ts lib/db.test.ts lib/queries.ts scripts/backup-tables.mjs lib/backup.test.ts .gitignore backups/README.md e2e/helpers.ts
git commit -m "실전 테스트: 테스트 문항 표와 테스트 표시 열을 스키마에 두고 통계에서 뺀다"
```

---

### Task 6: 「실전 테스트 문제 수」 설정

**Files:**
- Modify: `lib/types.ts` (`AppSettings.testSize`), `lib/queries.ts` (`fetchSettings` · `saveSettings`), `lib/actions/settings.ts`, `app/settings/SettingsForm.tsx`

**Interfaces:**
- Consumes: `normalizeTestSize` (Task 3), `isMissingSchema` (Task 5)
- Produces: `AppSettings.testSize: number` (기본 40) — Task 8 · 11 이 쓴다

- [ ] **Step 1: 동작 정하기.** `fetchSettings` 는 `coalesce((to_jsonb(s) ->> 'test_size')::int, 40) as test_size` 로 읽고(열이 없어도 안 죽는다) `normalizeTestSize` 를 거친다. `saveSettings` 의 기존 upsert 는 그대로 두고, 그 뒤에 `update settings set test_size = $1 where id = 1` 을 따로 보내 `isMissingSchema` 오류는 삼킨다 (스키마보다 코드가 먼저 올라간 동안 /settings 저장이 죽지 않게). `saveSettingsAction` 은 `testSize: normalizeTestSize(input.testSize)`.
- [ ] **Step 2: `SettingsForm` 에 「실전 테스트」 섹션** — 라벨 「실전 테스트 문제 수」, `type="number"` `min=10` `max=100`, 도움말 「이틀에 한 번 뜨는 한자 → 읽기 타이핑 테스트. 한 번에 20분을 넘기지 않게 조정하세요」. 기본값은 `reviewLimit` 칸과 같은 방식(`Number(e.target.value)`)으로 다룬다.
- [ ] **Step 3: 컴파일이 알려 주는 곳 고치기** — Run: `npm run typecheck` / Expected: `AppSettings` 를 직접 만드는 곳(`fetchSettings` 의 기본값 등)만 오류. 모두 `testSize` 를 채운다.
- [ ] **Step 4: 검증** — Run: `npm test && npm run typecheck && npx eslint .` / Expected: PASS. (화면 동작은 Task 11 E2E 에서 확인한다.)
- [ ] **Step 5: 커밋**
```bash
git add lib/types.ts lib/queries.ts lib/actions/settings.ts app/settings/SettingsForm.tsx
git commit -m "설정: 실전 테스트 문제 수를 고를 수 있게 한다"
```

---

### Task 7: 채점 반영 공용화 + `/api/grades` 같은 날 가드

**Files:**
- Create: `lib/grade-apply.ts`, `lib/grade-apply.test.ts`
- Modify: `app/api/grades/route.ts`, `lib/queries.ts` (`fetchTestWrongToday`)

**Interfaces:**
- Consumes: `GradePlanItem` (`lib/srs.ts`), `isMissingSchema` · `pgCode` (Task 5), `studyDayStart` · `addDays` · `APP_TIMEZONE`
- Produces:
```ts
type Sql = ReturnType<typeof db>; type Query = ReturnType<Sql["query"]>
export const BATCH_ID: RegExp; export const RECEIPT_DAYS = 180
export function receiptKey(batchId: unknown, payload: unknown): string | null   // `${batchId}:${sha256(JSON.stringify(payload)).slice(0,32)}`
export function receiptQueries(sql: Sql, key: string): Query[]                    // grade_batches insert + 180일 정리
export function wordUpdateQueries(sql: Sql, plan: GradePlanItem[]): Query[]       // counters 없으면 건너뜀, schedule 있으면 stage 포함
export function reviewInsertQuery(sql: Sql, plan: GradePlanItem[], opts?: { test?: boolean }): Query
// lib/queries.ts
export async function fetchTestWrongToday(ids: string[], today: string, dayStartHour: number): Promise<Set<string>>
```

- [ ] **Step 1: 실패하는 테스트.** 리팩터링 **전에** 고정한 값(기존 `route.ts` 의 `receiptKey` 와 같은 계산으로 구했다):
```ts
const G = [{ wordId: "w-0123456789", kind: "s2r", correct: true, retry: false },
           { wordId: "w-9876543210", kind: "learn", correct: false, retry: true }];
const payload = (practice: boolean) => [practice, G.map((g) => [g.wordId, g.kind, g.correct, g.retry])];
expect(receiptKey("batch-abc123", payload(false))).toBe("batch-abc123:b0dce3a40c0fa4d4e70c6349982ef3dc");  // 배포 순간 재전송 묶음이 두 번 반영되지 않게
expect(receiptKey("batch-abc123", payload(true))).toBe("batch-abc123:180317579b0eb1721444e4fb73296725");
for (const bad of ["short", "has space xx", 12345, undefined, "x".repeat(81)]) expect(receiptKey(bad, payload(false))).toBeNull();
expect(receiptKey("batch-abc123", ["test", "2026-10-22", [["w-0123456789", "ちゅう"]]])).not.toBe(receiptKey("batch-abc123", payload(false)));
// reviewInsertQuery — 가짜 sql({ query(text, params) } 기록)로
//  opts 없음: 텍스트에 "(word_id, prompt_type, correct, in_session_retry, practice)" , 항목당 5개 파라미터 (기존과 같다)
//  { test: true }: 열에 test 가 추가되고 항목당 6개, 마지막 값이 true
// wordUpdateQueries: counters 가 null 인 항목은 문장을 만들지 않는다 · schedule 있으면 stage/next_review/last_reviewed 포함 · 없으면 카운터만
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/grade-apply.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현.** `route.ts` 에서 `receiptKey` · 영수증 insert/cleanup · 단어 update 두 갈래 · 리뷰 insert 를 **문장 그대로** 옮긴다 (공백까지). `route.ts` 는 payload 로 `[practice, grades.map(g => [g.wordId, g.kind, g.correct, g.retry])]` 를 넘기고, 로컬 `pgCode` 는 `lib/db.ts` 것으로 바꾼다. `fetchTestWrongToday`: `select word_id from typing_test_items where word_id = any($1::uuid[]) and correct = false and answered_at >= $2::timestamptz and answered_at < $3::timestamptz` (경계는 `studyDayStart(today, APP_TIMEZONE, dayStartHour)` 와 `studyDayStart(addDays(today, 1), …)` 의 ISO). `isMissingSchema` 면 빈 집합. `route.ts` 는 `getSettingsAndToday()` 에서 `settings` 도 받아 비연습일 때만 이 집합을 `planGrades` 5번째 인자로 넘긴다.
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck && npx eslint .` / Expected: PASS
- [ ] **Step 5: 회귀 확인 (`/api/grades` 를 건드렸다)** — Run: `npx playwright test e2e/undo.spec.ts e2e/flows.spec.ts` (빌드 포함 수 분) / Expected: 전부 PASS. 특히 「응답을 받지 못한 전송」(영수증 중복)이 통과해야 한다.
- [ ] **Step 6: 커밋**
```bash
git add lib/grade-apply.ts lib/grade-apply.test.ts app/api/grades/route.ts lib/queries.ts
git commit -m "채점 반영 조각을 따로 빼고, 그날 테스트에서 틀린 단어의 카드 채점은 주기에 반영하지 않는다"
```

---

### Task 8: 서버 로더 · `/api/test-answers` · 시작 액션

**Files:**
- Create: `lib/typing-test-load.ts`, `app/api/test-answers/route.ts`, `lib/actions/typing-test.ts`, `e2e/typing-test.spec.ts`
- Modify: `lib/types.ts` (`TestQuestion` · `TestAnswered`), `e2e/helpers.ts` (`daysAgo`, `seedTestable`)

**Interfaces:**
- Consumes: Task 1 `judgeReading` · Task 3 전부 · Task 4 `planTestGrades` · Task 5 `isMissingSchema` · Task 6 `settings.testSize` · Task 7 `grade-apply`
- Produces:
```ts
// lib/types.ts
export interface TestQuestion { wordId: string; surface: string; reading: string; meaning_ko: string }
export interface TestAnswered extends TestQuestion { typed: string; correct: boolean }
// lib/typing-test-load.ts (서버 전용)
export type TestOverview =
  | { kind: "hidden" } | { kind: "wait"; nextDay: string } | { kind: "due"; count: number }
  | { kind: "active"; testDay: string; remaining: number; total: number }
export async function loadTestOverview(today: string, s: Pick<AppSettings, "testSize" | "dayStartHour">): Promise<TestOverview>
export async function loadTestSession(testDay: string): Promise<{ testDay: string; questions: TestQuestion[]; answered: TestAnswered[] }>
export async function startTypingTest(today: string, s: Pick<AppSettings, "testSize" | "dayStartHour">): Promise<"started" | "not-due">
// lib/actions/typing-test.ts
export async function startTypingTestAction(): Promise<void>   // 시작 → redirect("/test")
// e2e/helpers.ts
export function daysAgo(n: number): string                     // 학습일 'YYYY-MM-DD' (04:00 경계, Asia/Seoul)
export async function seedTestable(rows: { surface: string; reading: string; meaning: string }[]): Promise<void>
```

- [ ] **Step 1: 서버 로직을 이렇게 만든다** (테스트가 정하지 않는 순서 · 쿼리 모양)
  - `loadTestOverview`: ① 최신 테스트 한 건 — `typing_test_items i join words w` 에서 `test_day = (select max(test_day) …)` 로 `total`, `remaining`(`answered_at is null and w.suspended = false and w.surface <> w.reading`), `last_answered_at`(`to_char(max(answered_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`) ② `testPhase` ③ `ready` 일 때만 후보 조회 → `isTestEligible` 개수 → 0 이면 `hidden`, 아니면 `due{count: min(testSize, 개수)}`. `isMissingSchema` 면 `hidden`, 그 밖의 오류는 던진다.
  - 후보 조회 (words 한 번): `words w left join (select word_id, min(reviewed_at) first_at, count(*) filter (where prompt_type='s2r' and not correct and not in_session_retry and not practice and not test) s2r_wrong from reviews group by word_id) r` + `left join (select word_id, string_agg(case when correct then '1' else '0' end, '' order by answered_at) history, max(answered_at) last_at from typing_test_items where answered_at is not null group by word_id) h`, `where w.suspended = false and w.stage > 0 and w.surface <> w.reading`. `firstReviewDay` = `to_char(((r.first_at at time zone $1::text) - make_interval(hours => $2::int))::date, 'YYYY-MM-DD')` (`$1 = APP_TIMEZONE`, `$2 = dayStartHour`). 날짜 · 시각은 문자열로 받는다.
  - `startTypingTest`: `loadTestOverview` 가 `due` 가 아니면 `"not-due"`. 맞으면 후보 → `pickTestWords(…, testSize)` → 한 문장 `insert into typing_test_items (test_day, word_id) select $1::date, unnest($2::uuid[]) where not exists (select 1 from typing_test_items where test_day = $1::date)` (두 번 눌러도 한 번).
  - `loadTestSession`: `typing_test_items join words` 에서 안 푼 것 중 `suspended = false and surface <> reading` → `questions` (매번 `shuffle`), 푼 것 → `answered`.
  - `/api/test-answers` `POST` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`): 본문 `{ batchId, testDay(YYYY-MM-DD), answers: [{wordId, typed}] }` → `parseTestAnswers`. ① 영수증 키 = `receiptKey(batchId, ["test", testDay, answers.map(a => [a.wordId, a.typed])])` — 있으면 조회, 이미 있으면 `{ok:true, applied:0, duplicate:true}`. ② **안 푼 문항만 조회** (`test_day = $1 and word_id = any($2) and answered_at is null`) 해서 답을 거른다 — 다른 묶음 id 로 같은 답이 와도 한 번만. ③ 단어 행(`surface, reading` + SRS 상태)을 읽어 **클라이언트의 정오를 믿지 않고** `judgeReading(typed, word)` 로 다시 채점 (`invalid` 는 건너뛴다) ④ `planTestGrades(states, …, today)` ⑤ 한 `sql.transaction`: 영수증 insert(+cleanup) → 문항 update (`set typed, correct, answered_at = now() where test_day = $1 and word_id = $2 and answered_at is null`) → `wordUpdateQueries` → `reviewInsertQuery(…, {test: true})`. `23505` → duplicate ok. **스키마 오류(`isMissingSchema`)는 `503 {ok:false}`** — `ok:true` 로 답하면 클라이언트가 답을 지운다.
  - `startTypingTestAction`: `getSettingsAndToday()` → `startTypingTest` → `redirect("/test")` (`try` 밖).
- [ ] **Step 2: `e2e/helpers.ts`** — `daysAgo(n)` (다른 스펙의 `TODAY` 와 같은 계산에서 n일 뺀 것). `seedTestable(rows)`: `seed(rows, daysAgo(10))` 후 `update words set stage = 3, next_review = current_date + 30 where note = MARK`, `insert into reviews (word_id, prompt_type, correct, reviewed_at) select id, 'learn', true, now() - interval '3 days' from words where note = MARK` (오늘 처음 배운 단어가 아니게). 문항은 테스트에서 SQL 로 직접 넣는다.
- [ ] **Step 3: 실패하는 E2E `e2e/typing-test.spec.ts` (API 수준)** — `beforeEach`: `authenticate` + `resetDb`, `afterAll(resetDb)`. 단어 `抽象的/ちゅうしょうてき` · `環境/かんきょう` 를 `seedTestable` 하고 두 단어로 `typing_test_items(test_day = 오늘)` 를 SQL 로 넣는다.
```ts
// (a) POST /api/test-answers {batchId:"zz-batch-0001", testDay, answers:[{wordId:抽象的, typed:"ちゅうそうてき"},{wordId:環境, typed:"かんきょう"}]}
//     → {ok:true, applied:2}. 抽象的: stage 1 · next_review 내일 · wrong_count 1 · last_wrong_type "s2r".
//       環境: stage 3 · next_review 그대로 · correct_count 1.
//       reviews: test=true 2행, prompt_type "s2r", practice=false. items: typed · correct · answered_at 채워짐
// (b) (Review Focus 3) 같은 답을 다른 batchId("zz-batch-0002")로 다시 → {ok:true, applied:0}, reviews 행 수 · correct_count 그대로
//     같은 batchId 로 또 → {ok:true, applied:0, duplicate:true}
// (c) typed 가 한자("抽象的") 인 답은 반영되지 않고 그 문항은 안 푼 채로 남는다 (applied 0)
// (d) 서버 재채점: 抽象的 에 "ちゅーしょーてき" → 오답으로 저장
// (e) (a) 직후 POST /api/grades {grades:[{wordId:抽象的, kind:"s2r", correct:true, retry:false}]} → stage 1 · next_review 내일 · wrong_count 그대로, reviews 에 test=false 행 1개 추가
// (f) 쿠키 없는 요청은 307 → /login
```
- [ ] **Step 4: 실패 확인** — Run: `npx playwright test e2e/typing-test.spec.ts` / Expected: FAIL (`/api/test-answers` 404)
- [ ] **Step 5: 구현 후 통과 확인** — Run: `npm run typecheck && npx eslint . && npx playwright test e2e/typing-test.spec.ts` / Expected: PASS
- [ ] **Step 6: 커밋**
```bash
git add lib/typing-test-load.ts app/api/test-answers/route.ts lib/actions/typing-test.ts lib/types.ts e2e/helpers.ts e2e/typing-test.spec.ts
git commit -m "실전 테스트: 문항 시작과 답 반영을 서버에 두고 같은 답은 한 번만 반영한다"
```

---

### Task 9: 테스트 묶음을 outbox · client 로 보낸다

**Files:**
- Modify: `lib/types.ts` (`GradeInput.typed?: string`), `lib/grade-outbox.ts`, `lib/grade-client.ts`, `lib/grade-outbox.test.ts`

**Interfaces:**
- Produces:
```ts
// lib/grade-outbox.ts
export interface OutboxBatch { id: string; practice: boolean; test?: string; grades: GradeInput[] }   // test = test_day
export type SendGrades = (batch: { id: string; practice: boolean; test?: string; grades: GradeInput[] }) => Promise<boolean>
export function requestFor(batch: { id: string; practice: boolean; test?: string; grades: GradeInput[] }): { url: string; body: unknown }
// UndoBufferOptions 에 test?: string 을 더한다. lib/grade-client.ts:
export function createUndoBuffer(o: { undoSeconds: number; practice: boolean; test?: string; onClose: () => void }): UndoBuffer
```

- [ ] **Step 1: 실패하는 테스트** (`lib/grade-outbox.test.ts` 에 추가 — 기존 테스트는 그대로 통과해야 한다)
```ts
// readOutbox: test 가 "2026-10-22" 모양이면 보존, 그 밖(숫자 · 다른 문자열)은 버린다
// deliverOutbox: send 에 batch.test 가 그대로 전달된다. test 가 없는 묶음은 send 인자에 test 키가 없다
// same(): typed 가 다르면 다른 채점이다 — 보내는 사이 typed 가 바뀐 항목은 보낸 것으로 치지 않아 지우지 않는다
// UndoBuffer({ undoSeconds: 0, practice: false, test: "2026-10-22" }): add() 하면 저장소 묶음에 test 가 들어 있고 타이머로는 안 보낸다
//   close() 하면 test 가 있는 묶음을 send 로 보낸다
expect(requestFor({ id: "b1xxxxxx", practice: false, grades: [g1] })).toEqual({ url: "/api/grades", body: { grades: [g1], practice: false, batchId: "b1xxxxxx" } });
expect(requestFor({ id: "b1xxxxxx", practice: false, test: "2026-10-22", grades: [{ ...g1, typed: "ちゅう" }, { ...g2 }] })).toEqual({
  url: "/api/test-answers", body: { batchId: "b1xxxxxx", testDay: "2026-10-22", answers: [{ wordId: g1.wordId, typed: "ちゅう" }, { wordId: g2.wordId, typed: "" }] } });
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/grade-outbox.test.ts` / Expected: 새 테스트만 FAIL
- [ ] **Step 3: 구현.** `readOutbox` 는 `test` 를 모양 검사 후 보존. `same()` 에 `typed` 를 더한다. `deliverOutbox` 는 `test` 가 있을 때만 `send` 인자에 넣는다. `UndoBuffer.mirror()` 도 `test` 가 있을 때만 묶음에 넣는다. `requestFor` 는 순수 함수로 `grade-outbox.ts` 에 두고(브라우저 API 없음), `grade-client.ts` 의 `send` 는 `requestFor` 로 `{url, body}` 를 얻어 `fetch` 한다 (타임아웃 · `ok === true` 판정은 그대로). `createUndoBuffer` 는 `test` 를 통과시킨다.
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck && npx eslint .` / Expected: PASS
- [ ] **Step 5: 커밋**
```bash
git add lib/types.ts lib/grade-outbox.ts lib/grade-client.ts lib/grade-outbox.test.ts
git commit -m "채점 보관소가 테스트 답 묶음도 같은 규칙으로 보내게 한다"
```

---

### Task 10: 미전송 채점 복구를 학습 · 테스트 화면이 같이 쓰게 뺀다 (동작 변화 없음)

**Files:**
- Create: `app/RecoveryNotice.tsx`, `app/useGradeRecovery.ts`
- Modify: `app/study/StudySession.tsx`

**Interfaces:**
- Produces:
```ts
// app/RecoveryNotice.tsx — StudySession.tsx 에 있던 컴포넌트를 그대로 옮기고 export
export function RecoveryNotice(p: { failed: number | null; onRetry: () => void; onSkip: () => void }): JSX.Element
// app/useGradeRecovery.ts
export function useGradeRecovery(): {
  recovery: "none" | "sending" | "failed"; unsent: number
  blockedRef: React.RefObject<boolean>        // true 인 동안 화면은 입력을 무시한다
  recover: () => Promise<void>; skip: () => void   // skip = 「그대로 시작」
}
```

- [ ] **Step 1: 옮기기.** `StudySession.tsx` 의 `recovery`/`unsent`/`blockedRef` 상태, `recover` 콜백, 마운트 시 `recoveryPending()` 검사 effect, `RecoveryNotice` 컴포넌트를 위 두 파일로 **문장 그대로** 옮기고 `StudySession` 이 훅과 컴포넌트를 쓰게 한다. 문구 · 순서 · `window.location.reload()` 조건을 바꾸지 않는다.
- [ ] **Step 2: 회귀 확인** — Run: `npm run typecheck && npx eslint . && npx playwright test e2e/undo.spec.ts` / Expected: PASS — 「채점 복구」 세 테스트와 「응답을 받지 못한 전송」이 수정 없이 통과해야 한다. 하나라도 깨지면 옮기는 과정의 실수다.
- [ ] **Step 3: 커밋**
```bash
git add app/RecoveryNotice.tsx app/useGradeRecovery.ts app/study/StudySession.tsx
git commit -m "미전송 채점 복구를 학습 화면 밖으로 빼서 테스트 화면도 쓸 수 있게 한다"
```

---

### Task 11: /test 화면 · 홈 카드 · 설정 E2E

**Files:**
- Create: `app/test/page.tsx`, `app/test/TestSession.tsx`, `app/test/QuestionFace.tsx`, `app/test/QuestionFace.test.tsx`, `app/test/keys.ts`, `app/test/keys.test.ts`
- Modify: `app/page.tsx`, `app/GradeRecovery.tsx`, `e2e/typing-test.spec.ts`, `e2e/flows.spec.ts` (쿠키 없는 경로 목록에 `/test` 만 더한다)

**Interfaces:**
- Consumes: Task 1 `convertAnswer` · `judgeReading`, Task 2 `diffSyllables` · `DiffBlock`, Task 8 `loadTestOverview` · `loadTestSession` · `startTypingTestAction`, Task 9 `createUndoBuffer` · `releaseUndoBuffer`, Task 10 훅 · `RecoveryNotice`
- Produces:
```ts
// app/test/keys.ts — 제출 · 다음으로 칠 Enter 인가. IME 확정 Enter 는 아니다
export function isSubmitKey(e: { key: string; isComposing: boolean; keyCode: number; repeat: boolean }, composing: boolean): boolean
// app/test/QuestionFace.tsx — 표시 전용
export type Verdict = { correct: boolean; typed: string; expected: string; blocks: DiffBlock[] } | null
export function QuestionFace(p: { question: TestQuestion; verdict: Verdict }): JSX.Element
```

- [ ] **Step 1: 실패하는 단위 테스트**
```ts
// keys.test.ts  (Review Focus 1)
const k = (o = {}) => ({ key: "Enter", isComposing: false, keyCode: 13, repeat: false, ...o });
expect(isSubmitKey(k(), false)).toBe(true);
expect(isSubmitKey(k({ isComposing: true }), false)).toBe(false);   // 조합 중
expect(isSubmitKey(k(), true)).toBe(false);                        // 조합 플래그
expect(isSubmitKey(k({ keyCode: 229 }), false)).toBe(false);       // Safari: compositionend 뒤의 확정 Enter
expect(isSubmitKey(k({ repeat: true }), false)).toBe(false);       // 꾹 누름으로 피드백을 건너뛰지 않는다
expect(isSubmitKey(k({ key: "a" }), false)).toBe(false);
// QuestionFace.test.tsx — renderToStaticMarkup, CardFace.test.tsx 와 같은 모양 (규칙 3)
//  verdict null: "抽象的" 는 있고, 읽기 "ちゅうしょうてき" 와 뜻 "추상적" 은 HTML 에 없다
//  verdict 정답: 읽기와 뜻이 보인다
//  verdict 오답: 읽기 · 뜻 · 내가 친 답이 보이고, diff 블록의 typed("そ")/expected("しょ") 가 둘 다 표시된다. 누락(typed "")은 자리표시(＿)로 보인다
```
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run app/test` / Expected: FAIL
- [ ] **Step 3: 화면 구현.** 정해 둔 것만 적는다.
  - `page.tsx` (서버, `force-dynamic`): `getSettingsAndToday` → `loadTestOverview`(오류는 `SetupNotice`). `active` → `loadTestSession` → `<TestSession>`. `due` → 「{count}문제」와 `<form action={startTypingTestAction}>` 의 「시작」 버튼 (GET 렌더에서 만들지 않는다 — Link prefetch 로 생길 수 있다). `wait` → 「다음 실전 테스트는 {nextDay} 부터입니다」(시작 버튼 없음). `hidden` → 「지금 낼 수 있는 단어가 없습니다」. 모두 「홈으로」 링크.
  - `TestSession.tsx` (클라이언트): 마운트 시 `useGradeRecovery`(진행 중 블록은 `blockedRef`, 안내는 `RecoveryNotice`). `createUndoBuffer({undoSeconds: 0, practice: false, test: testDay, onClose: () => {}})`, 언마운트 시 `releaseUndoBuffer`. 입력칸 **하나**를 문제 사이에 언마운트 · 블러하지 않는다 (iOS 키보드가 내려가지 않게; 피드백 단계에서는 `readOnly`). 속성: `lang="ja"` `autoCapitalize="none"` `autoCorrect="off"` `autoComplete="off"` `spellCheck={false}` `aria-label="읽기"`. 조합 플래그는 `onCompositionStart/End` 의 ref, 키 처리는 `isSubmitKey`. 입력칸은 **친 그대로** 두고 바로 아래 줄에 `→ {convertAnswer(input)}` 미리보기(`data-testid="reading-preview"`) — 입력칸 내용을 바꿔 쓰지 않는다 (규칙 6).
  - 제출: `judgeReading(input, question)`. `invalid` → 「가나로 다시 입력」 안내를 띄우고 같은 문제에 머문다 (빈 입력은 아무것도 하지 않는다). 아니면 `Verdict` 를 보여 주고(`data-testid="verdict"`) `buffer.add({wordId, kind: "s2r", correct, retry: false, typed: judgement.kana})`. 틀린 단어를 같은 테스트 안에서 다시 묻지 않는다. 다음은 Enter 또는 버튼. 답 10개마다 `void buffer.close()`. 마지막 문제 뒤 `void buffer.close()` 후 끝 화면.
  - 끝 화면: 「{전체}문제 중 {맞힌 수}개」(이어서 푼 경우 `answered` 까지 합친 전체), 틀린 단어 목록(표기 · 읽기 · 뜻 · 내가 친 답과 음절 대조), 「홈으로」. 되돌리기 · 오타 인정 버튼은 없다. 「나가기」는 `await buffer.close()` 뒤 `router.push("/")`.
  - 표기에 `data-testid="question-surface"`, 진행은 「n / 전체」.
  - 홈 `app/page.tsx`: `Promise.all` 에 `loadTestOverview(today, settings)` 를 더하고, `due` → 「실전 테스트 · {count}문제」, `active` → 「실전 테스트 · 남은 {remaining}문제」 카드(`/test` 링크, 오답노트 카드와 같은 모양)를 `BackupWarning` 아래에 둔다. 나머지 종류는 카드 없음.
  - `GradeRecovery.tsx`: `/login` 과 `/study*` 외에 `/test` 도 건너뛴다 (`pathname === "/test" || pathname.startsWith("/test/")`).
- [ ] **Step 4: 단위 테스트 통과** — Run: `npx vitest run app/test && npm run typecheck && npx eslint .` / Expected: PASS
- [ ] **Step 5: E2E 추가** (`e2e/typing-test.spec.ts`, `seedTestable` 로 `抽象的` · `環境` · `協力` 세 단어, 설정 `test_size` 는 10 이하로 두면 문제는 3개)
```ts
// 처음엔 홈에 「실전 테스트」 카드 → 클릭 → /test 에서 「시작」 → question-surface 가 보이고 main.innerText 에 읽기 · 뜻이 없다 (규칙 3)
// 抽象的 에 "chuusouteki" 입력 → reading-preview 에 ちゅうそうてき → Enter(제출) → verdict 에 틀림 · 정답 ちゅうしょうてき · 뜻 · 대조 [そ]/[しょ] → Enter(다음)
// 나머지 둘은 정답 → 끝 화면 「3문제 중 2개」
// DB: 抽象的 stage 1 · 내일 · last_wrong_type "s2r", 정답 단어는 stage · next_review 그대로 · correct_count 1,
//     reviews test=true 3행(s2r, practice false), items.typed("抽象的") = ちゅうそうてき
// 홈: 카드가 없다. 그리고 「최근 7일」 복습 수에 테스트 행이 들어가지 않는다 (0) — 통계 제외 확인
// items.answered_at 를 2일 당기면 홈에 카드가 다시 뜬다 (due)
// 중간에 나가기: 한 문제 풀고 「나가기」 → 홈 「남은 2문제」 → 이어서 → 끝 화면은 「3문제 중 …」 (전체)
// 한자 섞인 입력 "抽象的" 제출 → 「가나로 다시 입력」, 같은 문제에 머물고 DB 에 반영 없음
// 도중 보류 (Review Focus 2): 시작 후 한 문제 풀고, 아직 안 푼 단어 하나를 SQL 로 suspended=true → 새로고침 → 남은 수가 줄어 있다 →
//     나머지를 풀면 끝 화면 → 홈에 카드도 「남은 N」도 없다
// 설정: /settings 에서 「실전 테스트 문제 수」를 10 으로 저장 → settings.test_size 10
// 게이트: flows.spec 의 쿠키 없는 경로 목록에 "/test" 추가 → 307 → /login
```
- [ ] **Step 6: 통과 확인** — Run: `npx playwright test e2e/typing-test.spec.ts e2e/flows.spec.ts` / Expected: PASS
- [ ] **Step 7: 커밋**
```bash
git add app/test app/page.tsx app/GradeRecovery.tsx e2e/typing-test.spec.ts e2e/flows.spec.ts
git commit -m "실전 테스트 화면과 홈 카드를 둔다"
```

---

### Task 12: 「읽기 주의」 배지

**Files:**
- Modify: `lib/types.ts` (`QueueCard.caution?: boolean`), `lib/typing-test.ts` (`markCaution`), `lib/typing-test.test.ts`, `lib/typing-test-load.ts` (`readingCautionIds`), `lib/study.ts`, `app/study/StudySession.tsx`, `e2e/typing-test.spec.ts`
- 건드리지 않는다: `app/study/CardFace.tsx` (규칙 3 테스트에 영향이 없게)

**Interfaces:**
- Produces:
```ts
// lib/typing-test.ts
export function markCaution<T extends { word: { id: string } }>(cards: T[], ids: ReadonlySet<string>): (T & { caution?: boolean })[]
// lib/typing-test-load.ts
export async function readingCautionIds(): Promise<Set<string>>   // testStatus === "retest" 인 단어 id. 스키마 없으면 빈 집합
```

- [ ] **Step 1: 실패하는 테스트** — `markCaution([{word:{id:"a"}},{word:{id:"b"}}], new Set(["a"]))` → 첫 카드만 `caution: true`, 둘째는 `caution` 키가 없고, 입력 배열은 바뀌지 않는다. Run: `npx vitest run lib/typing-test.test.ts` / Expected: FAIL
- [ ] **Step 2: 구현.** `readingCautionIds`: 오답이 있었던 단어의 답을 `select word_id, string_agg(case when correct then '1' else '0' end, '' order by answered_at) from typing_test_items where answered_at is not null and word_id in (select word_id from typing_test_items where correct = false) group by word_id` 로 받아 `testStatus` 가 `retest` 인 id 만 (`isMissingSchema` → 빈 집합). `lib/study.ts` 의 세 로더(`loadTodayQueue` · `loadPracticeQueue` · `loadFlagPracticeQueue`)가 이 조회를 기존 `Promise.all` 에 병렬로 넣고 `markCaution` 으로 카드에 붙인다. `StudySession` 헤더의 `★` 옆에 `card.caution && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">읽기 주의</span>`.
- [ ] **Step 3: E2E 추가**
```ts
// 단어 A: items 이력 [오답] · B: [오답, 정답] → 둘 다 /study 헤더에 「읽기 주의」. C: [오답, 정답, 정답] → 배지 없음
// A 를 오늘 due (next_review = current_date, last_wrong_type = 's2r') 로 두면 /study 에서 A 는 「읽기는?」 (s2r) 로 나온다 — 테스트 오답 다음 날 플래시카드가 s2r 로 나오는 의도된 동작
```
- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck && npx eslint . && npx playwright test e2e/typing-test.spec.ts` / Expected: PASS (`CardFace.test.tsx` 5+3개 포함)
- [ ] **Step 5: 커밋**
```bash
git add lib/types.ts lib/typing-test.ts lib/typing-test.test.ts lib/typing-test-load.ts lib/study.ts app/study/StudySession.tsx e2e/typing-test.spec.ts
git commit -m "테스트에서 틀린 단어는 플래시카드에 읽기 주의를 표시한다"
```

---

### Task 13: 플래시카드 세션의 되돌리기를 Backspace 로도 한다 (사용자 추가 요청 — 타이핑 테스트가 다 끝난 뒤)

범위는 `StudySession` 하나(복습 · 연습 퀴즈 모두). 실전 테스트(`/test`)에는 되돌리기가 없고 거기서 Backspace 는 입력칸을 지우는 키다 — 건드리지 않는다. 되돌리기 창 · `UndoBuffer.undo()` 규칙은 그대로이고 키만 하나 더한다.

**Files:**
- Modify: `app/study/StudySession.tsx` (키 리스너 · 「되돌리기」 버튼 문구), `e2e/undo.spec.ts`, `README.md` (「학습 세션 단축키」)

**Interfaces:**
- Consumes: 기존 `handlers.current.undo` (= `onUndo`). 새로 만드는 함수는 없다.

- [ ] **Step 1: 실패하는 E2E** (`e2e/undo.spec.ts` 에 「Backspace 로 되돌리기」 describe 를 더한다. `seedDue(4)` → `/study`, 설정은 기본 5초)
```ts
// 두 장을 채점해 「3 / 4」 → Backspace → 「2 / 4」 → Backspace → 「1 / 4」. 더 되돌릴 것이 없을 때 한 번 더 눌러도 「1 / 4」 그대로이고 오류가 없다
// 꾹 누름: 세 장을 채점해 「4 / 4」 → page.keyboard.down("Backspace") 를 세 번(두 번째부터 repeat) → up → 「3 / 4」 (한 장만 되돌아간다)
// 입력칸에서는 되돌리지 않는다: 한 장 채점해 「2 / 4」 → "e" 로 수정 창을 열고 표기 칸에서 Backspace → 칸의 글자는 지워지지만 「2 / 4」 그대로
// 되돌리기 버튼 문구가 Backspace 를 알려 준다 (getByRole("button", { name: /되돌리기.*Backspace/ }))
```
- [ ] **Step 2: 실패 확인** — Run: `npx playwright test e2e/undo.spec.ts -g "Backspace"` / Expected: FAIL
- [ ] **Step 3: 구현.** `StudySession` 키 리스너의 `switch (e.key)` 에 `case "Backspace":` 를 더한다 — `e.preventDefault()` 를 먼저 부르고 `e.repeat` 가 아닐 때만 `handlers.current.undo()` (꾹 눌러서 여러 장이 한꺼번에 되돌아가지 않게). 입력칸 · 텍스트영역 포커스일 때 리스너가 일찍 빠지는 기존 분기(`blockedRef` 와 함께)를 그대로 쓰므로 수정 창에서 글자를 지우는 Backspace 는 영향이 없다. 버튼 문구는 「되돌리기 (U · Backspace)」. README 단축키 절에 한 줄.
- [ ] **Step 4: 통과 확인** — Run: `npm run typecheck && npx eslint . && npx playwright test e2e/undo.spec.ts` / Expected: PASS (기존 되돌리기 · 채점 복구 테스트 포함)
- [ ] **Step 5: 커밋**
```bash
git add app/study/StudySession.tsx e2e/undo.spec.ts README.md
git commit -m "복습 화면: Backspace 로도 되돌릴 수 있게 한다"
```

---

### Task 14: 스키마 없는 DB 회귀 E2E · 문서 · 전체 검증 → 운영 반영 전에 멈춘다

**Files:**
- Modify: `e2e/typing-test.spec.ts`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: 회귀 E2E (Review Focus 4)** — 격리 DB 에서 `typing_test_items` → `typing_test_items_off`, `reviews.test` → `test_off`, `settings.test_size` → `test_size_off` 로 이름을 바꾼 채 `try { … } finally { 원래 이름으로 되돌린다 }`. 그 안에서:
```ts
// 홈 · /study · /stats · /settings 가 모두 200 이고 오류 안내(SetupNotice)가 없다
// 홈에 「실전 테스트」 카드가 없다. /test 는 「지금 낼 수 있는 단어가 없습니다」
// /settings 에서 다른 값(예: 복습 상한)을 바꿔 저장해도 「저장했습니다.」 가 나온다
// /study 에서 카드 하나를 채점해 나가면 /api/grades 가 반영된다 (reviews 1행)
// POST /api/test-answers 는 503 {ok:false} — 클라이언트가 답을 지우지 않는다
```
  되돌리기가 실패하면 이후 모든 E2E 가 깨지므로, `finally` 안의 DDL 오류는 삼키지 말고 그대로 던진다.
- [ ] **Step 2: `CLAUDE.md` 갱신** — 「구조」에 새 파일(`lib/reading-answer.ts` · `syllable-diff.ts` · `typing-test.ts` · `typing-test-load.ts` · `grade-apply.ts`, `app/test/`, `app/api/test-answers/`)을 한 줄씩. 「변경 시 주의」에 이 사실들을 불릿으로: ① 테스트 채점 행은 `reviews.test = true` · `prompt_type = 's2r'` (enum 을 늘리지 않는다), 통계 쿼리는 `to_jsonb(r) ->> 'test'` 로 제외 (열이 없는 DB 에서도 동작) ② `typing_test_items` 는 친 답이라 **백업하지 않는다** (`lib/backup.test.ts` 가 막는다) ③ 판정은 `judgeReading` 하나이고 서버가 다시 채점한다. 가타카나 `ー` 는 보존하며 `toHiragana` 를 비교에 쓰지 않는다 ④ 테스트 정답은 stage 를 올리지 않고 오답은 stage 1 · 내일로 내린다. 그날 테스트에서 틀린 단어의 카드 채점은 `planGrades` 의 `testWrongToday` 가드가 로그만 남긴다 ⑤ 안 푼 문항 = `answered_at is null`, 같은 답은 영수증 + 안 푼 문항 조회로 한 번만 반영 ⑥ 날 바뀐 미완료 테스트는 이어서 본다 (끝낸 날 = 마지막 답의 학습일, 항상 1회분). 「검증」의 개수는 Step 3 의 **실제 출력**으로 고친다.
- [ ] **Step 3: 전체 검증 — 출력을 그대로 보고한다**
```bash
npm test && npm run typecheck && npx eslint . && npm run build
npm run test:e2e        # 격리 DB. 수 분. 10분 넘게 안 끝나면 코드보다 기기 절전(pmset 로그)부터 본다
```
  Expected: 전부 PASS. `npm run test:db` 는 돌리지 않는다.
- [ ] **Step 4: README** — 「화면」 절에 `/test` 한 줄, 「SRS」 절에 테스트 반영 규칙(정답은 주기 유지 · 오답은 stage 1)과 설정의 문제 수를 짧게. 내용은 CLAUDE.md 와 같은 사실만 쓴다.
- [ ] **Step 5: 커밋**
```bash
git add e2e/typing-test.spec.ts CLAUDE.md README.md
git commit -m "실전 테스트: 스키마 없는 DB 회귀 테스트와 문서를 둔다"
```
- [ ] **Step 6: 멈추고 보고한다.** push · 운영 반영은 하지 않는다. 보고에 넣는다: ① 명령별 통과 수 ② 커밋 목록 ③ **사용자 승인이 필요한 것** — `npm run db:migrate -- --all` (운영 스키마; tables 줄에 `typing_test_items` 확인), `git push` ④ **미확인**: 아이폰 실기기(플릭 입력 · 확정 Enter 비제출 · 로마자 미리보기 · 자동 수정/대문자 꺼짐 · 다음 문제로 넘어갈 때 키보드 유지) ⑤ 「N2_Orchestration 에 `reviews.test` 열이 생겼으니 SRS 복습 집계에 `and not test` 를 더해야 한다고 ORCHESTRATOR 에 전해 달라」는 한 줄 (그쪽 파일은 직접 고치지 않는다).

---

## 범위 밖 (손대지 않는다)

- 혼동 유형 통계 (데이터만 남긴다: `typing_test_items.typed`)
- `ちりょう` 의 표기에 한자(治療)가 빠진 것 — 앱에서 사용자가 고친다
- `db/schema.sql` 의 words 대상 옛 3문장(UPDATE 1 · ALTER 2)이 migrate 마다 다시 도는 문제 — 사용자 결정 대기
- **읽기는 알지만 뜻을 모르는 단어.** s2r 카드는 「발음을 묻는 문제」라서 뜻을 몰라도 「알았음」을 누르게 되고, 그런 단어가 꽤 있다는 사용자 관찰(구현 중 받은 추가 의견). 이 테스트는 읽기만 채점하고(스펙 §2 비목표, 절대 규칙 2) 답을 낸 뒤 뜻을 보여 주는 데까지만 한다. 뜻 확인을 더할지는 사용자 결정이다 — 더한다면 「자기 판정 구멍」(스펙 §2 안티목표)을 다시 열지 않는 방식이어야 한다.

## 이 계획이 새로 정한 것 (사용자가 뒤집을 수 있다)

- 음절 대조는 음절 단위라 `ちゅう[そ]うてき ↔ ちゅう[しょ]うてき` 로 표시한다 (스펙 예시의 `[そう]` 보다 좁다).
- 피드백 단계에서 Enter 를 꾹 누르면(`repeat`) 다음 문제로 넘어가지 않는다.
- 안 푼 문항의 표식은 `typed is null` 이 아니라 `answered_at is null` 이고, 세 열이 함께 비도록 CHECK 를 건다.
- `saveSettings` 는 `test_size` 를 따로 갱신하고 열이 없으면 건너뛴다 (스키마보다 코드가 먼저 올라가도 /settings 저장이 죽지 않게).
- Task 10 의 복구 훅 추출 — 학습 화면의 코드를 건드리는 순수 이동이다. 반대하면 `TestSession` 에 복사해 쓴다.
- Task 13 의 Backspace 되돌리기는 꾹 누르면 한 장만 되돌리고(`repeat` 무시), 입력칸 포커스 중에는 동작하지 않는다. 버튼 문구는 「되돌리기 (U · Backspace)」.
