# 오답노트(/mistakes) + 설정 확장 — 구현 계획

작성 2026-09-22 (N2_Orchestration ORCHESTRATOR) / **착수 예정 2026-10-05**

그 사이 오답은 Obsidian 노트에 쌓인다. 앱이 생기면 옮긴다.

---

## 0. 기능 추가 기준(CLAUDE.md 규칙 8) 검토

> 학습 효과를 직접 올리지 않는 기능은 추가하지 않는다.
> 제외: 소셜, 다중 사용자, AI, 게임화, 애니메이션, 복잡한 통계, 덱/태그, TTS

* **오답노트는 학습 효과에 직접 기여한다.** 오답 → 분류 → 재출제 루프가
  N2_Orchestration 쪽에서 이미 돌아가고 있고, 지금은 그 입력이 텍스트다.
* **「덱/태그」와 혼동하지 말 것.** `category`는 사용자가 자유롭게 만드는 태그가 아니라
  **고정된 7종 분류**다. 값이 늘지 않는다. enum으로 고정한다.
* 통계는 **분류별 건수까지만.** 그래프·추세선은 만들지 않는다.

---

## 1. `/mistakes` — 오답 입력·조회

### 테이블

```sql
create table if not exists mistakes (
  id          bigserial primary key,
  source      text not null,          -- 'master1500' | 'grammar' | 'reading'
  ref         text,                   -- 문항 번호. '12', 'Part A-3' 등 자유
  question    text,                   -- 선택지 또는 문제 요약
  chosen      text,                   -- 고른 답
  answer      text,                   -- 정답
  why         text,                   -- 왜 틀렸다고 생각하는지
  category    text not null,          -- 7종
  created_at  timestamptz not null default now(),
  study_day   date not null default current_date,
  resolved_at timestamptz,            -- 재확인에서 맞히면 채움

  constraint mistakes_source_valid
    check (source in ('master1500','grammar','reading')),
  constraint mistakes_category_valid
    check (category in ('개념 부족','접속 실수','활용 실수','문법 구별 실패',
                        '해석 실패','회상 실패','단순 실수'))
);
create index if not exists mistakes_day      on mistakes (study_day);
create index if not exists mistakes_category on mistakes (category);
create index if not exists mistakes_open     on mistakes (created_at desc) where resolved_at is null;
```

`study_day`를 `created_at`과 분리하는 이유는 `words` 테이블과 같다 —
어제 푼 문제를 오늘 입력할 수 있어야 한다.

### 페이지

```text
/mistakes         목록 + 분류 필터 + 미해결 필터
/mistakes/new     입력 폼
```

**입력 폼이 이 기능의 전부다.** 빠르게 치고 빠질 수 있어야 한다.

* `category`는 **드롭다운**. 7종 고정. 이걸 만드는 가장 큰 이유가 이것이다 —
  분류표를 따로 열어보지 않아도 되게 한다.
* 각 분류 옆에 한 줄 설명을 띄운다 (「규칙을 몰랐다/반대로 알았다」 식).
  경계 판단이 어려운 것이 실제 문제다.
* `source`·`ref`는 직전 입력값을 기억한다. 한 세션에 여러 건을 연달아 넣는다.
* **Enter 체인**을 유지한다. `words` 입력과 같은 방식.

### 목록

* 기본은 **미해결만**. 해결된 것은 접는다.
* 분류별 건수를 상단에 표시 (7개 숫자). 그 이상 통계는 넣지 않는다.
* 「재확인에서 맞혔다」 버튼 → `resolved_at` 채움.

---

## 2. 설정 확장

### 2-A. undo 인터벌 — 요청받은 것

현재 구조 (`app/study/StudySession.tsx`):

```js
const FLUSH_AT = 5;          // 5장 모이면 전송
const IDLE_FLUSH_MS = 5000;  // 5초 손 멈추면 전송
```

**전송되면 undo가 끊긴다.** 둘 중 먼저 오는 쪽에 걸린다.

```sql
alter table settings add column if not exists undo_seconds smallint not null default 5;
-- 0 = 상시 (세션 종료 시에만 전송)
constraint settings_undo check (undo_seconds between 0 and 300)
```

**주의 — `IDLE_FLUSH_MS`만 늘리면 안 된다.** `FLUSH_AT = 5`가 그대로면
빠르게 풀 때 5장마다 여전히 끊긴다. 둘을 함께 다뤄야 한다.

상시 모드(0)의 위험: 전송을 무한정 미루면 **앱이 죽을 때 채점이 날아간다.**
`sendBeacon`/`keepalive`가 있어도 완전하지 않다. 두 가지 안이 있다.

| 안 | 방식 | 비용 |
|---|---|---|
| **A** | 상시 모드에서도 서버에는 보내되, 스냅샷을 유지하고 **채점 취소 API**를 만든다 | API 추가. `reviews` 삭제 + `words` 되돌리기 |
| **B** | 전송을 미루되 **localStorage에 pending을 계속 백업**한다. 앱이 죽으면 다음 진입 시 복구 | 이미 `loadFailed()`가 비슷한 일을 한다 |

**B를 먼저 검토하라.** 기존 실패 큐 구조를 재사용할 수 있고 서버 변경이 없다.
A는 되돌리기가 진짜 필요할 때만 한다 — SRS 상태를 거꾸로 돌리는 것은 위험하다.

### 2-B. 추가 제안 — 우선순위순

**높음**

| 설정 | 컬럼 | 근거 |
|---|---|---|
| **답 공개 지연** | `reveal_delay_ms` (0=없음) | 공개 버튼을 N초간 비활성화. 회상 시간을 강제한다. N2_Orchestration §25의 「덮고 → 직접 회상」을 앱이 강제하는 것. **지금은 바로 눌러버릴 수 있다** |
| **세션 카드 수 상한** | `session_limit` (0=제한 없음) | 복습 150건이 한 번에 나오면 부담이다. 50장씩 끊는다. 실측상 세션이 30~40분 걸린다 |

**중간**

| 설정 | 컬럼 | 근거 |
|---|---|---|
| 취약 단어 우선 | `weak_first` boolean | `isPriority`가 이미 있으나 조정 불가. wrong_count 높은 것을 앞으로 |
| 유형 고정 | `force_kind` (null=가중치대로) | 「오늘은 s2r만」. 약한 유형 집중 훈련. 실측상 s2m 오답률이 높았다 |
| 복습 먼저 | `review_first` boolean | 지금은 신규와 섞인다. 복습을 끝내고 신규로 가는 옵션 |

**넣지 않는다**

* practice 모드 기본값 — 헷갈릴 여지만 만든다
* 통계 표시 토글 — 규칙 8의 「복잡한 통계」
* 테마/폰트 — 학습 효과와 무관

---

## 3. 작업 순서

```text
1. mistakes 테이블 + 마이그레이션        db:migrate -- --all (E2E DB도 함께)
2. /mistakes/new 입력 폼                 이것만 있어도 쓸 수 있다
3. /mistakes 목록 + 필터
4. settings.undo_seconds + StudySession 반영   ← B안 먼저
5. reveal_delay_ms
6. session_limit
7. 나머지는 쓰면서 판단
```

**2번까지가 최소 동작 단위다.** 거기서 멈춰도 된다.

## 4. 주의 (CLAUDE.md에서)

* 스키마를 바꾸면 `npm run db:migrate -- --all`. E2E DB(`n2v_e2e`)도 갱신해야 한다
* `lib/srs.ts`를 건드렸으면 `npm test`가 통과해야 한다
* 날짜는 `'YYYY-MM-DD'` 문자열. `Date` 객체를 스키마·API 경계에 넣지 않는다
* 통합 테스트 픽스처는 전각 `ＺＺ` 네임스페이스

---

## 5. 운용 방식 — 병렬

사용자가 직접 코딩하지 않는다. **cmux 멀티 페인 오케스트레이션**으로 돌린다.

```text
ORCHESTRATOR (N2_Orchestration 워크스페이스)
        │  지시 전송
        ▼
n2-kanji-srs-app 세션 (N2 단어 프로젝트 워크스페이스, workspace:2)
        │  구현
        ▼
사용자는 그 동안 **공부한다**
```

따라서 **10/05 학습 슬롯 2시간을 개발이 잠식하지 않는다.**

다만 사용자 확인이 필요한 지점이 있다. 이때만 짧게 끊는다.

```text
1. 스키마 확정 — mistakes 테이블 컬럼·enum 값
2. db:migrate 실행 전 — 프로덕션 DB를 건드린다. 반드시 승인받는다
3. 최소 동작 단위(입력 폼) 완성 후 — 실제로 써 보고 판단
4. undo 상시 모드 방식 — A안(취소 API) vs B안(localStorage) 선택
```

**2번은 특히 중요하다.** `--all` 로 E2E DB(`n2v_e2e`)도 함께 갱신해야 하고,
한쪽만 하면 브라우저 테스트가 통째로 깨진다 (CLAUDE.md).
