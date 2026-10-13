import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { insertWord } from "./queries";
import { studyDate } from "./srs";
import { POST as gradesPOST } from "@/app/api/grades/route";

/**
 * 같은 채점 묶음이 두 번 와도 한 번만 반영되는지 본다.
 * 단어 표기에 전각 ＺＺ 를 붙이고(규칙 7) 묶음 id 에도 접두사를 붙여, 정리 단계가 이 테스트가
 * 만든 것만 지우게 한다.
 */
const MARK = "__itest_grades__";
const P = "ＺＺ";
const BATCH = "zz-itest-";
const TODAY = studyDate();
const INT_MAX = 2147483647;

async function cleanup() {
  await db().query(`delete from words where note = $1`, [MARK]);
  await db().query(`delete from grade_batches where starts_with(id, $1)`, [BATCH]);
}

const KANA = ["あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ"];
let made = 0;

/** 채점할 단어 하나. stage 0 에서 시작한다. */
async function word(): Promise<string> {
  const k = KANA[made++];
  const res = await insertWord({
    surface: `${P}重複${k}`,
    reading: `${P}ちょうふく${k}`,
    meaning_ko: "중복",
    note: MARK,
    study_day: TODAY,
  });
  return res.word.id;
}

function post(body: unknown) {
  return gradesPOST(
    new Request("http://localhost/api/grades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function state(id: string) {
  const w = (await db().query(
    `select stage, correct_count, wrong_count from words where id = $1::uuid`,
    [id],
  )) as Record<string, number>[];
  const r = (await db().query(`select count(*)::int as n from reviews where word_id = $1::uuid`, [
    id,
  ])) as { n: number }[];
  return { ...w[0], reviews: r[0].n };
}

async function receipts(batchId: string): Promise<number> {
  const rows = (await db().query(
    `select count(*)::int as n from grade_batches where starts_with(id, $1)`,
    [`${batchId}:`],
  )) as { n: number }[];
  return rows[0].n;
}

const correct = (wordId: string) => ({ wordId, kind: "s2r", correct: true, retry: false });
const wrong = (wordId: string) => ({ wordId, kind: "s2r", correct: false, retry: false });

beforeAll(cleanup);
afterAll(cleanup);

describe("같은 채점 묶음은 한 번만 반영한다", () => {
  it("같은 묶음을 두 번 보내면 words 와 reviews 가 한 번만 바뀐다", async () => {
    const id = await word();
    const body = {
      batchId: `${BATCH}twice`,
      grades: [{ wordId: id, kind: "learn", correct: true, retry: false }, correct(id)],
    };

    const first = await post(body);
    expect(await first.json()).toEqual({ ok: true, applied: 2 });
    const after = await state(id);
    expect(after).toEqual({ stage: 1, correct_count: 1, wrong_count: 0, reviews: 2 });

    // 클라이언트가 응답을 받지 못해 같은 묶음을 다시 보냈다.
    const second = await post(body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, applied: 0, duplicate: true });
    expect(await state(id)).toEqual(after); // 두 번 반영되면 stage 2, reviews 4 가 된다
    expect(await receipts(body.batchId)).toBe(1);
  });

  it("묶음 id 가 같아도 내용이 다르면 따로 반영한다 (나눠 보낸 큰 묶음의 다음 조각)", async () => {
    const [a, b] = [await word(), await word()];
    const batchId = `${BATCH}chunks`;

    expect(await (await post({ batchId, grades: [correct(a)] })).json()).toEqual({
      ok: true,
      applied: 1,
    });
    // id 만 보고 건너뛰면 이 채점이 사라진다.
    expect(await (await post({ batchId, grades: [correct(b)] })).json()).toEqual({
      ok: true,
      applied: 1,
    });
    expect(await state(b)).toMatchObject({ correct_count: 1, reviews: 1 });
    expect(await receipts(batchId)).toBe(2);
  });

  it("연습과 실제 복습은 내용이 같아도 다른 요청이다", async () => {
    const id = await word();
    const batchId = `${BATCH}practice`;
    expect(await (await post({ batchId, practice: true, grades: [wrong(id)] })).json()).toEqual({
      ok: true,
      applied: 1,
    });
    expect(await (await post({ batchId, grades: [wrong(id)] })).json()).toEqual({
      ok: true,
      applied: 1,
    });
    expect(await state(id)).toMatchObject({ wrong_count: 2, reviews: 2 });
  });

  it("묶음 id 없이 온 요청은 예전처럼 올 때마다 반영한다", async () => {
    const id = await word();
    for (let i = 0; i < 2; i++) {
      expect(await (await post({ grades: [wrong(id)] })).json()).toEqual({ ok: true, applied: 1 });
    }
    expect(await state(id)).toMatchObject({ wrong_count: 2, reviews: 2 });

    // 받아 줄 수 없는 모양의 id 도 없는 것으로 다룬다.
    expect(await (await post({ batchId: "x", grades: [wrong(id)] })).json()).toEqual({
      ok: true,
      applied: 1,
    });
    expect(await state(id)).toMatchObject({ wrong_count: 3, reviews: 3 });
  });

  it("반영이 실패하면 기록도 남지 않고, 다시 보내면 반영된다", async () => {
    const id = await word();
    const body = { batchId: `${BATCH}fail`, grades: [wrong(id)] };
    // 오답 수를 하나 올리는 순간 정수 범위를 넘게 해서 반영 도중에 실패시킨다.
    await db().query(`update words set wrong_count = $1 where id = $2::uuid`, [INT_MAX, id]);

    await expect(post(body)).rejects.toThrow();
    expect(await state(id)).toMatchObject({ wrong_count: INT_MAX, reviews: 0 });
    // 「이미 받았다」는 기록이 남았다면 아래의 재전송이 건너뛰어져 채점이 사라진다.
    expect(await receipts(body.batchId)).toBe(0);

    await db().query(`update words set wrong_count = 0 where id = $1::uuid`, [id]);
    expect(await (await post(body)).json()).toEqual({ ok: true, applied: 1 });
    expect(await state(id)).toMatchObject({ wrong_count: 1, reviews: 1 });
    expect(await receipts(body.batchId)).toBe(1);
  });

  it("같은 요청이 겹쳐 들어와도 한 번만 반영한다", async () => {
    const id = await word();
    const body = { batchId: `${BATCH}race`, grades: [correct(id)] };

    const answers = await Promise.all([post(body), post(body)].map(async (r) => (await r).json()));
    expect(answers.every((a) => a.ok === true)).toBe(true);
    expect(answers.map((a) => a.applied).sort()).toEqual([0, 1]);
    expect(await state(id)).toMatchObject({ correct_count: 1, reviews: 1 });
    expect(await receipts(body.batchId)).toBe(1);
  });

  it("기본 키가 겹치면 드라이버가 23505 를 준다 (겹쳐 들어온 요청을 알아보는 근거)", async () => {
    const id = `${BATCH}pk`;
    await db().query(`insert into grade_batches (id) values ($1)`, [id]);
    await expect(
      db().transaction([db().query(`insert into grade_batches (id) values ($1)`, [id])]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("오래된 기록은 다음 반영 때 함께 지운다", async () => {
    const id = await word();
    await db().query(
      `insert into grade_batches (id, applied_at) values
         ($1, now() - interval '200 days'), ($2, now() - interval '100 days')`,
      [`${BATCH}old:x`, `${BATCH}recent:x`],
    );

    await post({ batchId: `${BATCH}sweep`, grades: [correct(id)] });
    expect(await receipts(`${BATCH}old`)).toBe(0);
    expect(await receipts(`${BATCH}recent`)).toBe(1);
  });
});
