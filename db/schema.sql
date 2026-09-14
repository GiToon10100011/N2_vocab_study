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

-- 연습 퀴즈에서 나온 채점인지. 연습은 복습 주기(stage/next_review)를 바꾸지 않지만
-- 오답 기록(wrong_count/streak)에는 반영되므로 통계에서 구분할 수 있어야 한다.
alter table reviews add column if not exists practice boolean not null default false;

create index if not exists reviews_at   on reviews (reviewed_at);
create index if not exists reviews_word on reviews (word_id);
create index if not exists reviews_wrong on reviews (word_id, reviewed_at desc) where correct = false;

-- 설정. 1인용이므로 항상 id = 1 한 행만 쓴다.
create table if not exists settings (
  id              smallint primary key default 1,
  new_limit       integer  not null default 30,
  review_limit    integer  not null default 150,
  weight_s2r      integer  not null default 60,
  weight_s2m      integer  not null default 25,
  weight_r2m      integer  not null default 15,
  day_start_hour  smallint not null default 4,

  constraint settings_single_row check (id = 1),
  constraint settings_limits check (new_limit between 0 and 200 and review_limit between 10 and 1000),
  constraint settings_weights check (weight_s2r >= 0 and weight_s2m >= 0 and weight_r2m >= 0
                                     and weight_s2r + weight_s2m + weight_r2m > 0),
  constraint settings_day_start check (day_start_hour between 0 and 12)
);

-- 마지막 백업 시각. 백업이 조용히 멈추는 것을 앱에서 알아채기 위한 심장박동이다.
-- 실제로 GitHub Actions 가 3일간 실패하는 동안 앱에서는 아무 표시도 없었다.
alter table settings add column if not exists last_backup_at timestamptz;

insert into settings (id) values (1) on conflict (id) do nothing;
