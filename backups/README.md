# 백업

`.github/workflows/backup.yml` 이 매일 05:00 KST 에 Neon 을 덤프해서 이 폴더에 커밋한다.
데이터가 바뀌지 않은 날은 커밋하지 않는다.

- `words.csv` — 단어 전체. **SRS 진도(stage, next_review, 정답/오답 카운트)가 여기 들어있다.**
- `reviews.csv` — 채점 로그 전체 (통계 복원용)
- `meta.json` — 마지막 백업 시각과 행 수

## 오답 기록(`mistakes`)은 백업하지 않는다

빠뜨린 것이 아니라 **의도적으로** 뺐다. 이 저장소는 공개이고 이 폴더는 그대로 커밋되는데,
오답 기록에는 교재 문항 내용과 개인 메모가 들어가기 때문이다.
그래서 오답 기록은 DB 에만 있고 자동 백업이 없다. 이 점을 알고 감수한 결정이다.

다시 넣지 말 것. 세 군데에서 막고 있다.

- `scripts/backup-tables.mjs` 의 대상 목록에 `mistakes` 가 없다
- `.gitignore` 에 `backups/mistakes.csv` 가 있다
- `lib/backup.test.ts` 가 위 둘을 고정한다

백업이 필요해지면 이 폴더가 아니라 공개되지 않는 곳으로 내보내는 길을 따로 만든다.

## 복원

특정 날짜로 되돌리려면 그 시점의 파일을 꺼내서 넣으면 된다.

```bash
git log --oneline -- backups/words.csv          # 날짜별 스냅샷 목록
git show <커밋>:backups/words.csv > restore.csv  # 그날 상태 꺼내기
```

`words.csv` 는 `id` 를 포함하므로 그대로 `insert ... on conflict (id) do update` 로 복원된다.
단어만이라면 설정 화면의 「복원 모드」 체크박스 + CSV 업로드가 더 빠르다.

### 주의 — 마지막 줄이 LF 로 끝나는 스냅샷

`scripts/backup.mjs` 를 고치기 전의 CSV 는 **마지막 줄만 LF 로 끝나서** 파서가 그 개행을
마지막 칸의 값으로 읽는다(`study_day = "2026-09-22\n"`). 그대로 복원하면 마지막 한 행의
날짜가 조용히 틀어진다. 2026-10-06 스냅샷까지는 전부 이 상태다.

```bash
git show <커밋>:backups/words.csv | tail -c 2 | xxd   # 0d0a 면 정상, 끝이 0a 뿐이면 해당
```

`/api/import` 는 칸마다 공백을 다듬으므로 설정 화면으로 복원하면 문제가 없다.
SQL 로 직접 넣을 때는 마지막 줄의 마지막 칸을 확인해라.
