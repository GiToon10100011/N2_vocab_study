-- N2 단어 학습 앱 스키마
-- Neon SQL Editor 에 그대로 붙여넣어 실행한다. 멱등(idempotent)하게 작성했다.

create table if not exists words (
  id              uuid primary key default gen_random_uuid(),
  -- 표기. 한자 없는 단어(ちゃんと)와 送り仮名(取り組む) 때문에 'kanji'가 아니라 'surface'
  surface         text        not null,
  reading         text        not null,   -- 히라가나
  meaning_ko      text        not null,
  note            text,                   -- 선택 메모. 저장만 하고 출제에 쓰지 않는다
  created_at      timestamptz not null default now(),

  -- SRS
  stage           smallint    not null default 0,             -- 0~7, LADDER 인덱스
  next_review     date        not null default current_date,
  last_reviewed   timestamptz,
  correct_count   integer     not null default 0,
  wrong_count     integer     not null default 0,
  streak          integer     not null default 0,             -- 연속 정답, 취약 판정용
  last_wrong_type text,                                       -- 's2r'|'s2m'|'r2m'|null
  suspended       boolean     not null default false,

  constraint words_stage_range check (stage between 0 and 7),
  constraint words_last_wrong_type_valid
    check (last_wrong_type is null or last_wrong_type in ('s2r', 's2m', 'r2m'))
);

-- 학습일: 이 단어가 "몇 일차 단어"인지. 등록일(created_at)과 분리되어 있어야
-- 어제 공부한 단어를 오늘 어제 날짜로 넣을 수 있다. 복습 스케줄과는 무관한 정리용 축이다.
alter table words add column if not exists study_day date;
update words set study_day = (created_at at time zone 'Asia/Seoul')::date where study_day is null;
alter table words alter column study_day set default current_date;
alter table words alter column study_day set not null;

create unique index if not exists words_uniq     on words (surface, reading);
create index        if not exists words_study_day on words (study_day);
create index        if not exists words_due      on words (next_review) where suspended = false;
create index        if not exists words_reading  on words (reading);
create index        if not exists words_created  on words (created_at);
-- 통합 검색은 ILIKE 3개 OR 로 충분하다 (1만 행 이하에서 전문검색 인덱스는 과잉)

create table if not exists reviews (
  id               bigserial   primary key,
  word_id          uuid        not null references words(id) on delete cascade,
  reviewed_at      timestamptz not null default now(),
  prompt_type      text        not null,   -- 's2r'|'s2m'|'r2m'|'learn'
  correct          boolean     not null,
  in_session_retry boolean     not null default false,

  constraint reviews_prompt_type_valid
    check (prompt_type in ('s2r', 's2m', 'r2m', 'learn'))
);

create index if not exists reviews_at   on reviews (reviewed_at);
create index if not exists reviews_word on reviews (word_id);
