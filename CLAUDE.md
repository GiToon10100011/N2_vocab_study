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
lib/mistakes.ts    오답노트 고정 값(출처 3종 · 분류 7종)과 입력 검증. 순수 함수
lib/study-ranges.ts  풀이 범위(그날 푼 문항의 시작·끝 번호) 검증과 칸에 먼저 채울 값. 순수 함수
lib/grade-outbox.ts  되돌리기 창과 미전송 채점 보관. 저장소·전송을 받아 쓰므로 그대로 테스트한다
lib/grade-client.ts  위 규칙에 localStorage 와 fetch 를 붙이는 브라우저 쪽 연결부. 전송을 한 줄로 세우고,
                     학습 화면이 큐를 새로 받아야 하는지 정한다
lib/reading-answer.ts  실전 테스트의 답 판정. 입력을 가나로 확정하고(ー 보존) 한 글자라도 다르면 오답.
                       화면과 서버가 이 파일 하나를 쓴다. 순수 함수
lib/syllable-diff.ts   틀린 읽기를 음절 단위로 대조한다. 순수 함수
lib/typing-test.ts     실전 테스트 규칙: 이력(재시험·통과) · 출제 대상 · 위험도 가중 선택 · 출현 판정. 순수 함수
lib/typing-test-load.ts  위 규칙에 DB 를 붙인 서버 쪽 조회·시작·읽기 주의 조회. 스키마가 없으면 「없음」으로 답한다
lib/grade-apply.ts 영수증 열쇠 · 단어 갱신 · 리뷰 insert 공용 조각. /api/grades 와 /api/test-answers 가 같이 쓴다
lib/actions/       Server Action ("use server")
app/api/grades/    채점 배치. 클라이언트가 fetch 로 보내고 응답의 ok 를 확인한다(Route Handler).
                   같은 묶음은 한 번만 반영한다
app/api/test-answers/  실전 테스트 답 배치. 정오를 믿지 않고 서버가 다시 채점한다. 스키마가 없으면 503
app/study/         세션 화면. CardFace 는 테스트를 위해 분리되어 있다
app/test/          실전 테스트 화면. QuestionFace 는 표시 전용이라 누출 테스트가 있다
app/RecoveryNotice.tsx, app/useGradeRecovery.ts  학습·테스트 화면이 같이 쓰는 미전송 채점 복구
app/mistakes/new/  오답 입력 폼과 풀이 범위 입력. 목록(/mistakes)은 아직 없다 — PLAN-mistakes.md 3단계
app/manifest.ts    PWA 매니페스트. 아이콘은 scripts/make-icons.mjs 가 생성한다
public/sw.js       서비스 워커. 정적 자산만 캐시한다
proxy.ts           비밀번호 게이트 (Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다)
                   PWA 자산은 matcher 에서 제외되어 있어야 한다
```

## 변경 시 주의

- **새 단어에 기본 상한을 두지 않는다**(`new_limit = 0`). 그날 등록한 단어가 그날 세션에
  나오지 않으면 사용자는 "누락됐다"고 느낀다. 기획서의 "하루 30개"는 사용 예측이지 제약이 아니었다.
- **SRS 계산은 서버에서만 한다.** 클라이언트는 `{wordId, kind, correct, retry}` 만 보낸다.
  전이 규칙을 클라이언트에 복제하지 말 것.
- **세션 중 네트워크 왕복을 늘리지 말 것.** 큐는 시작할 때 한 번만 받고, 채점은 되돌리기 창이
  닫힐 때 모아 보낸다.
- **되돌릴 수 있는 채점은 서버로 보내지 않는다.** 창은 마지막 채점·되돌리기 뒤 `undo_seconds` 초 동안
  손을 멈추면 닫힌다(0 = 상시, 세션이 끝나거나 나갈 때). **카드 수로 끊지 말 것** — 예전의
  「5장 모이면 전송」이 빠르게 넘길 때 되돌리기를 끊었다. 서버에서 채점을 취소하는 API 는 만들지 않는다.
- **채점은 서버가 `ok` 라고 답한 뒤에만 저장소에서 지운다.** 그 전에는 localStorage 에 있고 다음 진입 때
  먼저 보낸다. **탭을 닫는 순간에 보내지 말 것**(`sendBeacon`·`keepalive`). 도착을 확인할 수 없는
  전송은 보냈다고 치면 잃고, 남겨 두면 두 번 반영된다. 같은 이유로 전송은 한 번에 하나만 돈다.
- **같은 채점 묶음은 서버가 한 번만 반영한다.** 서버가 반영했는데 응답이 닿기 전에 앱이 닫히면 그 묶음은
  저장소에 남아 다시 간다. 클라이언트는 묶음 id 를 같이 보내고, 서버는 「묶음 id + 그 요청에 담긴 채점
  내용의 해시」를 `grade_batches` 에 **채점 반영과 같은 트랜잭션에서** 적는다. 이미 있으면 반영하지 않고
  `ok` 로 답한다. **기록과 반영을 따로 하지 말 것** — 반영이 실패한 묶음이 「이미 받았다」로 건너뛰어져
  채점이 사라진다. **id 만 열쇠로 쓰지도 말 것** — 큰 묶음은 나눠서 오고, 다음 조각이 버려진다.
  id 없이 온 요청(예전 화면)은 그대로 반영한다. `grade_batches` 도 백업하지 않는다.
- 학습 화면은 미전송 채점이 남아 있으면 그것부터 보내고 **큐를 새로 받는다**. 받은 큐는 그 채점이
  반영되기 전에 만들어진 것이라, 그대로 시작하면 이미 푼 카드를 다시 풀고 두 번 반영된다.
- `fetchSettings` 는 `undo_seconds` 를 `to_jsonb` 로 읽는다. 모든 화면이 거치는 조회라, 컬럼이 없는 DB 에
  코드가 먼저 올라가도 앱 전체가 죽지 않게 하려는 것이다. 컬럼 이름으로 바꾸지 말 것.
- 날짜는 전부 `'YYYY-MM-DD'` 문자열로 다룬다. `Date` 객체를 스키마나 API 경계에 넣지 않는다.
- 하루 경계는 04:00(`APP_TIMEZONE`). `studyDate()` 를 쓰고 `new Date()` 로 날짜를 만들지 않는다.
- `lib/srs.ts` 를 고쳤으면 `npm test` 가 반드시 통과해야 한다.

- **스키마를 바꾸면 `npm run db:migrate -- --all`** 로 돌린다. E2E 는 별도 데이터베이스
  (`n2v_e2e`)를 쓰므로 한쪽만 갱신하면 브라우저 테스트가 통째로 깨진다.
  이 명령은 항상 운영 DB 부터 적용한다. 운영 반영 전에 격리 DB 에만 먼저 올리려면
  `DATABASE_URL` 을 격리 DB 주소로 바꿔 `node scripts/migrate.mjs` 를 직접 돌린다.
- **오답노트(`mistakes`)의 분류 7종은 늘리지 않는다.** 덱/태그가 아니라 고정 값이다.
  분류 옆 한 줄 설명의 원본은 Obsidian 「오답 분류 기준」 표다. `lib/mistakes.ts` 에서 문구를
  지어내지 말고, 값을 바꾸면 `db/schema.sql` 의 CHECK 와 함께 바꾼다(단위 테스트가 대조한다).
- `mistakes` 통합 테스트 픽스처는 `ref` 가 `ＺＺ__itest__` 로 시작한다(규칙 7과 같은 이유).
  손으로 적은 기록이라 정리 단계가 실제 행을 지우면 되살릴 수 없다.
- **오답의 선택지는 `mistakes.question` 에 한 줄에 하나씩 넣는다**(`joinChoices` / `splitChoices`).
  개수는 문항마다 다르고 0개일 수 있어 칸을 따로 두지 않았다. 이 형식 이전의 행은 선택지를 한 줄에
  다 적었고 항목 하나로 읽힌다. **나눠서 고쳐 쓰지 말 것.**
- **오답 기록(`mistakes`)은 의도적으로 백업하지 않는다.** 빠뜨린 것이 아니다. 저장소가 공개이고
  `backups/` 가 그대로 커밋되는데, 오답 기록에는 교재 문항 내용과 개인 메모가 들어가기 때문이다.
  `scripts/backup-tables.mjs` 에 `mistakes` 를 넣지 말고 `.gitignore` 의 `backups/mistakes.csv` 도
  지우지 말 것(`lib/backup.test.ts` 가 막는다). 오답 기록은 DB 에만 있고 자동 백업이 없다.
  **풀이 범위(`study_ranges`)도 같은 이유로 백업하지 않는다.**
- **풀이 범위는 교재·학습일마다 한 줄이다.** `study_ranges` 의 기본 키가 `(source, study_day)` 이고
  같은 날 다시 저장하면 덮어쓴다(오타 수정). 오답이 0건인 날에도 어디까지 풀었는지 남기려는 표다.
  범위 안의 오답 수는 표에 두지 않는다. 읽기 전용 뷰 `study_range_summary` 가 `mistakes` 에서 세고,
  문항 번호가 숫자뿐인 오답만 범위와 견준다. 앱은 이 뷰를 쓰지 않는다.
- `study_ranges` 통합 테스트 픽스처는 **학습일이 1900년**이다. 열쇠가 (교재, 학습일)이고 교재는
  3종 고정이라 실제 기록과 겹치지 않게 할 수 있는 것이 날짜뿐이다(규칙 7과 같은 이유).
  학습일을 생략한 저장은 통합 테스트에서 부르지 말 것 — 오늘 날짜로 들어가 실제 줄을 덮어쓴다.
- `fetchRecentStudyRanges` 는 표가 없는 DB 에서 null 을 주고, 그때 화면은 범위 칸만 감춘다.
  스키마보다 코드가 먼저 올라가도 쓰고 있는 오답 입력 화면이 죽지 않게 하려는 것이다.
- **오답 입력 화면의 저장 버튼은 하나다**(「범위 저장」 버튼은 없다). 오답과 범위 중 무엇을 저장할지는
  `planFormSave` 가 정한다. 따로 두었을 때는 범위가 한 번도 저장되지 않은 채 오답만 쌓였다.
  **오답을 저장한 뒤 무엇을 남길지는 `keptAfterSave` 가 정한다.** 문항 번호는 늘 남는다. 마스터1500 은 선택지 ·
  이유 · 분류도 남기고 고른 답과 정답만 비운다(사용자 요청). 문법 · 독해는 번호만 남긴다.
  **오답 칸이 비었는지는 `isBlankMistake(input, kept)` 로 본다.** 남겨 둔 칸을 내용으로 세면 「오답 없는 날 범위만
  저장」 길이 막히고, 다시 누른 저장이 같은 오답을 또 넣는다. 남겨 둔 값 그대로이고 분류도 그대로(또는 빈칸)면 비었다.
  비었는데 범위로 보낼 것도 없으면 저장하지 않는다 — 마스터1500 은 남은 칸만으로 검증을 통과하므로 따로 막는다.
  두 쪽은 따로 실패하고 따로 보인다 — 오답이 저장되지 않으면 범위도 보내지 않고,
  범위가 틀려도 오답은 저장한다. 이미 저장된 같은 범위는 다시 보내지 않는다.

### 실전 테스트 (한자 → 읽기 타이핑)

이틀에 한 번, 매일 SRS 와 따로 뜬다. 설계: `docs/superpowers/specs/2026-10-22-typing-test-design.md`.

- **테스트 채점 행은 `reviews.test = true`, `prompt_type = 's2r'` 다.** 유형 enum 을 늘리지 않는다(규칙 2).
  홈 · `/stats` 의 복습 수와 정답률은 `to_jsonb(r) ->> 'test'` 로 이 행을 뺀다. 열 이름으로 읽지 않는
  이유는 `undo_seconds` 와 같다 — 열이 없는 DB 에 코드가 먼저 올라가도 화면이 죽지 않게 하려는 것이다.
- **판정은 `judgeReading` 하나이고 서버가 다시 채점한다.** 클라이언트는 정오가 아니라 확정한 가나(`typed`)만
  보낸다. 가타카나는 히라가나로 바꿔 비교하되 **`ー` 는 보존한다** — `wanakana.toHiragana` 를 비교에 쓰면
  `チューショーテキ` 가 정답이 된다. 표기와 읽기가 둘 다 `だ` 로 끝나면 입력의 `だ` 는 있든 없든 정답이다.
  「오타였음」 · 되돌리기 · 채점 뒤 정답 인정은 만들지 않는다(자기 판정 구멍).
- **테스트 정답은 stage 를 올리지 않고, 오답은 「몰랐음」처럼 stage 1 · 내일로 내린다**(`planTestGrades`).
  오답의 `last_wrong_type` 은 `'s2r'` 이라 다음 플래시카드가 읽기를 묻는다. 같은 날 테스트에서 틀린 단어의
  카드 채점은 `planGrades` 의 `testWrongToday` 가드가 로그만 남긴다 — 테스트 전에 열어 둔 세션이 주기를
  다시 올리는 것을 막는다.
- **`typing_test_items` 는 친 답이 들어 있어 백업하지 않는다**(`lib/backup.test.ts` 가 막는다). 테스트 정오는
  `reviews`(test 열)로 백업된다. 안 푼 문항 = `answered_at is null`.
- **같은 답은 한 번만 반영한다.** 같은 묶음은 영수증(`grade_batches`)이, 다른 묶음 id 로 온 같은 답은
  「안 푼 문항에만 반영」이 막는다. 두 요청이 **동시에** 오면 둘 다 문항을 열린 것으로 읽으므로, 트랜잭션 안에서
  문항이 실제로 바뀐 개수를 세어 어긋나면 0 으로 나눠(22012) 전체를 취소하고 409 로 답한다 — 클라이언트는 묶음을
  지우지 않고 다시 보내며, 그때는 이미 풀린 문항을 건너뛴다. 이 문장을 빼면 단어당 반영이 여러 번 일어난다
  (`e2e/typing-test.spec.ts` 의 동시 요청 테스트가 잡는다). `receiptKey` 의 입력 모양을 바꾸지 말 것 — 배포 순간
  재전송된 묶음이 두 번 반영된다(`lib/grade-apply.test.ts` 가 값을 고정한다).
- **`/api/grades` 는 `typed` 가 붙은 항목을 반영하지 않는다.** `typed` 는 테스트 답에만 있다. 옛 화면이나 롤백된
  화면은 저장소의 `test` 표시를 버리고 테스트 답을 카드 채점 쪽으로 보내는데, 반영하면 맞힌 단어의 단계가
  오르고 서버 재채점을 건너뛴다. 버려도 그 문항은 안 푼 채로 남아 다시 나온다.
- **날이 바뀐 미완료 테스트는 이어서 본다**(항상 1회분). 끝낸 날 = 마지막 답의 학습일, 다음 테스트는
  거기서 이틀 뒤. 하루 경계 04:00 은 `studyDate()` 가 맡는다.
- **스키마가 없는 DB 에서 홈 · `/study` · `/stats` · `/settings` 는 죽지 않는다.** 새 기능만 빠진다
  (`isMissingSchema`). `/api/test-answers` 는 503 으로 답해 클라이언트가 답을 지우지 않게 한다.
  `e2e/typing-test.spec.ts` 의 「스키마보다 코드가 먼저 올라간 DB」 가 표 · 열 이름을 바꿔 이를 지킨다.
- IME 확정 Enter(`isComposing` · `keyCode 229`)는 제출이 아니다(`app/test/keys.ts`). 입력칸은 친 그대로
  두고 가나 변환은 미리보기 줄에만 보여 준다(규칙 6). 그래서 아이폰 플릭 입력은 확정 → 제출 → 다음으로
  Enter 가 3번이다. 확정은 OS 키보드의 몫이고, 제출과 다음 사이는 판정(정답 읽기 · 뜻 · 대조)을 읽는 자리다.
- **실전 테스트 풀이 화면은 보이는 영역(`visualViewport`)에 맞춰 고정하고, 입력칸을 그 맨 아래(키보드 바로 위)에
  붙인다**(`app/test/useVisibleViewport.ts`). 아이폰은 키보드가 올라와도 `dvh` 를 줄이지 않아서(`interactive-widget` 도
  지원하지 않는다) `dvh` 기준으로 그리면 아래쪽이 키보드 밑에 깔리고, 사파리가 페이지를 밀어 올려 문제가 화면 밖으로 나간다.
  문제 칸은 「읽기 · 표기 · 뜻」 세 줄 자리를, 판정 줄은 두 줄 자리를 늘 잡아 둔다 — 판정이 나오거나 다음 문제로 넘어가도
  표기와 입력칸이 움직이지 않고 화면에 스크롤이 없다. 키보드가 열리면 표기를 가운데보다 아래(위아래 빈칸 2:1,
  `app/globals.css` 의 `.test-stage[data-keyboard]`)에 둔다. 입력칸 테두리의 초록 · 붉은색은 판정에만 쓴다.
  `e2e/typing-test.spec.ts` 「키보드가 열린 화면」 이 `visualViewport` 를 흉내 내 지킨다(키보드 위 400pt 는 흉내 낸 값이다).
  이 배치는 아이폰 실기기에서 확인했다(2026-10-25).

## 검증

```bash
npm test          # 225개 (SRS 전이표, 유형 분포, 큐, 읽기 변환, 파서, 카드 누출, 오답 검증 · 저장 뒤 남기는 칸, 백업 대상, 되돌리기 창, 채점 복구, 풀이 범위,
                  #       저장 버튼 규칙, 실전 테스트: 답 판정 · 음절 대조 · 출제 선택 · 출현 · 문제 누출 · IME Enter · 영수증 열쇠)
npm run test:db   # 34개 (실제 Neon 왕복) — 운영 DB 로 붙는다. 실전 테스트는 이 명령으로 검증하지 않았다
npm run test:e2e  # 58개 (브라우저, 격리 DB)
npm run typecheck
npx eslint .
npm run build
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
