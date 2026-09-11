# 백업

`.github/workflows/backup.yml` 이 매일 05:00 KST 에 Neon 을 덤프해서 이 폴더에 커밋한다.
데이터가 바뀌지 않은 날은 커밋하지 않는다.

- `words.csv` — 단어 전체. **SRS 진도(stage, next_review, 정답/오답 카운트)가 여기 들어있다.**
- `reviews.csv` — 채점 로그 전체 (통계 복원용)
- `meta.json` — 마지막 백업 시각과 행 수

## 복원

특정 날짜로 되돌리려면 그 시점의 파일을 꺼내서 넣으면 된다.

```bash
git log --oneline -- backups/words.csv          # 날짜별 스냅샷 목록
git show <커밋>:backups/words.csv > restore.csv  # 그날 상태 꺼내기
```

`words.csv` 는 `id` 를 포함하므로 그대로 `insert ... on conflict (id) do update` 로 복원된다.
