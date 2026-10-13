import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { saveStudyRangeAction } from "./actions/study-ranges";
import { fetchRecentStudyRanges } from "./queries";

/**
 * 픽스처는 1900년 날짜만 쓴다. 이 표의 열쇠는 (교재, 학습일)이고 교재는 3종으로 고정이라,
 * 실제 기록과 절대 겹치지 않게 할 수 있는 것은 날짜뿐이다. 정리 단계는 1901년 이전 행만 지운다.
 * 같은 이유로 학습일을 생략한 저장은 여기서 부르지 않는다. 오늘 날짜로 들어가 실제 줄을 덮어쓴다.
 */
const DAY = "1900-01-02";
const BEFORE = "1901-01-01";

async function cleanup() {
  await db().query(`delete from study_ranges where study_day < $1::date`, [BEFORE]);
}

async function fixtures() {
  return (await db().query(
    `select source, to_char(study_day, 'YYYY-MM-DD') as study_day, from_no, to_no
       from study_ranges where study_day < $1::date order by study_day, source`,
    [BEFORE],
  )) as Record<string, unknown>[];
}

beforeAll(cleanup);
afterAll(cleanup);

describe("풀이 범위 DB 왕복", () => {
  it("저장한 범위가 그대로 돌아오고, 같은 교재·같은 날 다시 저장하면 한 줄을 덮어쓴다", async () => {
    const first = await saveStudyRangeAction({
      source: "master1500",
      from: "11",
      to: "20",
      studyDay: DAY,
    });
    expect(first).toEqual({
      ok: true,
      range: { source: "master1500", study_day: DAY, from_no: 11, to_no: 20 },
    });

    const again = await saveStudyRangeAction({
      source: "master1500",
      from: "11",
      to: "21",
      studyDay: DAY,
    });
    expect(again).toMatchObject({ ok: true, range: { from_no: 11, to_no: 21 } });
    expect(await fixtures()).toEqual([
      { source: "master1500", study_day: DAY, from_no: 11, to_no: 21 },
    ]);
  });

  it("교재가 다르면 같은 날에도 따로 남는다", async () => {
    await saveStudyRangeAction({ source: "grammar", from: "3", to: "7", studyDay: DAY });
    expect(await fixtures()).toEqual([
      { source: "grammar", study_day: DAY, from_no: 3, to_no: 7 },
      { source: "master1500", study_day: DAY, from_no: 11, to_no: 21 },
    ]);
  });

  it("틀린 입력은 저장하지 않는다", async () => {
    const before = await fixtures();
    expect(
      await saveStudyRangeAction({ source: "reading", from: "9", to: "2", studyDay: DAY }),
    ).toEqual({ ok: false, reason: "order" });
    expect(
      await saveStudyRangeAction({ source: "reading", from: "", to: "2", studyDay: DAY }),
    ).toEqual({ ok: false, reason: "number" });
    expect(await fixtures()).toEqual(before);
  });

  it("DB 가 거꾸로 된 범위와 3종 밖의 교재를 거부한다", async () => {
    await expect(
      db().query(
        `insert into study_ranges (source, study_day, from_no, to_no)
         values ('reading', $1::date, 9, 2)`,
        [DAY],
      ),
    ).rejects.toThrow(/study_ranges_numbers/);
    await expect(
      db().query(
        `insert into study_ranges (source, study_day, from_no, to_no)
         values ('vocab', $1::date, 1, 2)`,
        [DAY],
      ),
    ).rejects.toThrow(/study_ranges_source_valid/);
  });

  it("오답이 없는 범위도 읽기 전용 뷰에 0건으로 나온다", async () => {
    const rows = await db().query(
      `select source, solved, mistakes, mistake_refs from study_range_summary
        where study_day = $1::date order by source`,
      [DAY],
    );
    expect(rows).toEqual([
      { source: "grammar", solved: 5, mistakes: 0, mistake_refs: [] },
      { source: "master1500", solved: 11, mistakes: 0, mistake_refs: [] },
    ]);
  });

  it("최근 범위 조회는 날짜를 문자열로 준다", async () => {
    const rows = await fetchRecentStudyRanges();
    expect(rows).not.toBeNull();
    for (const r of rows!) expect(r.study_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
