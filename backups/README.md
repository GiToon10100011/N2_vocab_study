# 백업

`.github/workflows/backup.yml` 이 매일 05:00 KST 에 Neon 을 덤프해서 이 폴더에 커밋한다.
데이터가 바뀌지 않은 날은 커밋하지 않는다.

- `words.csv` — 단어 전체. **SRS 진도(stage, next_review, 정답/오답 카운트)가 여기 들어있다.**
- `reviews.csv` — 채점 로그 전체 (통계 복원용)
- `mistakes.csv` — 오답노트 전체. **손으로 적은 기록이라 다시 만들 수 없다.**
- `meta.json` — 마지막 백업 시각과 행 수

## 복원

특정 날짜로 되돌리려면 그 시점의 파일을 꺼내서 넣으면 된다.

```bash
git log --oneline -- backups/words.csv          # 날짜별 스냅샷 목록
git show <커밋>:backups/words.csv > restore.csv  # 그날 상태 꺼내기
```

`words.csv` 는 `id` 를 포함하므로 그대로 `insert ... on conflict (id) do update` 로 복원된다.
단어만이라면 설정 화면의 「복원 모드」 체크박스 + CSV 업로드가 더 빠르다.

### `mistakes.csv`

설정 화면에는 오답노트 복원 UI 가 없다. `reviews.csv` 와 같이 SQL 로 넣는다.

```sql
insert into mistakes (id, source, ref, question, chosen, answer, why, category,
                      created_at, study_day, resolved_at)
values (...)
on conflict (id) do update set source = excluded.source, ...;

-- id 를 직접 넣었으므로 시퀀스를 최대 id 뒤로 밀어 둔다.
-- 안 하면 앱에서 다음 건을 저장할 때 중복 키로 죽는다.
select setval('mistakes_id_seq', (select coalesce(max(id), 1) from mistakes));
```

### 주의 — 마지막 줄이 LF 로 끝나는 스냅샷

`scripts/backup.mjs` 를 고치기 전의 CSV 는 **마지막 줄만 LF 로 끝나서** 파서가 그 개행을
마지막 칸의 값으로 읽는다(`study_day = "2026-09-22\n"`). 그대로 복원하면 마지막 한 행의
날짜가 조용히 틀어진다. 2026-10-06 스냅샷까지는 전부 이 상태다.

```bash
git show <커밋>:backups/words.csv | tail -c 2 | xxd   # 0d0a 면 정상, 끝이 0a 뿐이면 해당
```

`/api/import` 는 칸마다 공백을 다듬으므로 설정 화면으로 복원하면 문제가 없다.
SQL 로 직접 넣을 때는 마지막 줄의 마지막 칸을 확인해라.
