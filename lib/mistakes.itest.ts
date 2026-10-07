import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { addMistakeAction } from "./actions/mistakes";
import { fetchLastMistakeRef } from "./queries";
import { addDays, studyDate } from "./srs";

/**
 * 문항 번호(ref)에 전각 ＺＺ 를 붙여 실제 오답과 절대 겹치지 않게 한다.
 * 오답노트는 손으로 적은 기록이라 지워지면 다시 만들 수 없다. 정리 단계는 이 접두사로
 * 시작하는 행만 지우고, 실제로 적을 법한 문항 번호('12', 'Part A-3')를 픽스처로 쓰지 않는다.
 */
const P = "ＺＺ__itest__";
const TODAY = studyDate();

async function cleanup() {
  // like 는 _ 를 와일드카드로 읽는다. 접두사를 글자 그대로 비교한다.
  await db().query(`delete from mistakes where starts_with(ref, $1)`, [P]);
}

async function fixtureCount(): Promise<number> {
  const rows = (await db().query(
    `select count(*)::int as n from mistakes where starts_with(ref, $1)`,
    [P],
  )) as { n: number }[];
  return rows[0].n;
}

beforeAll(cleanup);
afterAll(cleanup);

describe("오답노트 DB 왕복", () => {
  it("저장한 값이 그대로 돌아오고 날짜는 문자열이다", async () => {
    const res = await addMistakeAction({
      source: "master1500",
      category: "개념 부족",
      ref: `${P}19`,
      question: " 去年 / 去年に ",
      chosen: "去年に",
      answer: "去年",
      why: "니를 붙이고 안 붙이는 게 쉼표 유무에 따라 다를 거라고 생각했다",
      studyDay: TODAY,
    });
    if (!res.ok) throw new Error(`저장 실패: ${res.reason}`);

    const expected = {
      source: "master1500",
      category: "개념 부족",
      ref: `${P}19`,
      question: "去年 / 去年に",
      chosen: "去年に",
      answer: "去年",
      why: "니를 붙이고 안 붙이는 게 쉼표 유무에 따라 다를 거라고 생각했다",
      study_day: TODAY,
      resolved_at: null,
    };
    expect(res.mistake).toMatchObject(expected);
    expect(res.mistake.id).toMatch(/^\d+$/);
    expect(res.mistake.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // 액션이 돌려준 값이 아니라 실제로 들어간 행을 다시 읽어 확인한다.
    const rows = await db().query(
      `select source, category, ref, question, chosen, answer, why,
              to_char(study_day, 'YYYY-MM-DD') as study_day, resolved_at
         from mistakes where id = $1::bigint`,
      [res.mistake.id],
    );
    expect(rows).toEqual([expected]);
  });

  it("빈 칸은 null 로 들어가고, 어제 푼 문제를 어제 날짜로 넣을 수 있다", async () => {
    const yesterday = addDays(TODAY, -1);
    const res = await addMistakeAction({
      source: "grammar",
      category: "회상 실패",
      ref: `${P}A-3`,
      question: "",
      why: "   ",
      studyDay: yesterday,
    });
    if (!res.ok) throw new Error(`저장 실패: ${res.reason}`);
    expect(res.mistake).toMatchObject({
      question: null,
      chosen: null,
      answer: null,
      why: null,
      study_day: yesterday,
    });
  });

  it("학습일이 없거나 형식이 틀리면 오늘로 넣는다", async () => {
    for (const studyDay of [undefined, "10/06"]) {
      const res = await addMistakeAction({
        source: "reading",
        category: "해석 실패",
        ref: `${P}day`,
        studyDay,
      });
      if (!res.ok) throw new Error(`저장 실패: ${res.reason}`);
      expect(res.mistake.study_day, String(studyDay)).toBe(TODAY);
    }
  });

  it("7종 밖의 분류와 3종 밖의 출처는 행을 만들지 않는다", async () => {
    const before = await fixtureCount();
    expect(
      await addMistakeAction({ source: "master1500", category: "기타", ref: `${P}bad` }),
    ).toEqual({ ok: false, reason: "category" });
    expect(
      await addMistakeAction({ source: "vocab", category: "개념 부족", ref: `${P}bad` }),
    ).toEqual({ ok: false, reason: "source" });
    expect(await fixtureCount()).toBe(before);
  });

  it("DB 제약도 같은 값을 막는다", async () => {
    // 액션을 거치지 않는 삽입(백업 복원 SQL 등)도 고정 값 밖으로 나가지 못해야 한다.
    await expect(
      db().query(`insert into mistakes (source, ref, category) values ('master1500', $1, '기타')`, [
        `${P}bad`,
      ]),
    ).rejects.toThrow(/mistakes_category_valid/);
    await expect(
      db().query(`insert into mistakes (source, ref, category) values ('vocab', $1, '개념 부족')`, [
        `${P}bad`,
      ]),
    ).rejects.toThrow(/mistakes_source_valid/);
  });

  it("가장 최근에 적은 출처와 문항 번호를 돌려준다", async () => {
    const res = await addMistakeAction({
      source: "reading",
      category: "단순 실수",
      ref: `${P}last`,
    });
    expect(res.ok).toBe(true);
    expect(await fetchLastMistakeRef()).toEqual({ source: "reading", ref: `${P}last` });
  });
});
