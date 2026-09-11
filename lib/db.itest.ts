import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  fetchHomophoneCounts,
  fetchPeriodStats,
  fetchQueueCandidates,
  fetchTodayCounts,
  fetchWordsBySurface,
  insertWord,
} from "./queries";
import { buildQueue, studyDate, addDays, studyDayStart } from "./srs";
import { POST as gradesPOST } from "@/app/api/grades/route";
import { GET as exportGET } from "@/app/api/export/route";

const MARK = "__itest__";
const TODAY = studyDate();

/**
 * 표기에 전각 ＺＺ 를 붙여 실제 어휘와 절대 겹치지 않게 한다.
 * 이 테스트는 사용자의 진짜 학습 데이터를 읽지도 지우지도 않아야 한다.
 */
const P = "ＺＺ";
const FIXTURES = [
  { surface: `${P}環境`, reading: `${P}かんきょう`, meaning_ko: "환경" },
  { surface: `${P}改善`, reading: `${P}かいぜん`, meaning_ko: "개선" },
  { surface: `${P}以外`, reading: `${P}いがい`, meaning_ko: "이외" },
  { surface: `${P}意外`, reading: `${P}いがい`, meaning_ko: "의외" }, // 동음 충돌 쌍
  { surface: `${P}ちゃんと`, reading: `${P}ちゃんと`, meaning_ko: "제대로" }, // 가나 전용
];

async function cleanup() {
  await db().query(`delete from words where note = $1`, [MARK]);
}

const ids: string[] = [];
let statsBefore = { newCount: 0, reviewCount: 0, correctCount: 0, accuracy: null as number | null };

beforeAll(async () => {
  await cleanup();
  for (const f of FIXTURES) {
    const res = await insertWord({ ...f, note: MARK, study_day: TODAY });
    expect(res.merged).toBe(false);
    ids.push(res.word.id);
  }
});

afterAll(cleanup);

describe("실제 DB 왕복", () => {
  it("날짜 컬럼이 문자열로 돌아온다 (드라이버 파싱에 의존하지 않는다)", async () => {
    const words = await fetchQueueCandidates(TODAY);
    const mine = words.filter((w) => ids.includes(w.id));
    expect(mine).toHaveLength(FIXTURES.length);
    for (const w of mine) {
      expect(w.next_review).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(w.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(w.stage).toBe(0);
      expect(typeof w.suspended).toBe("boolean");
    }
  });

  it("같은 표기·읽기를 다시 넣으면 행이 늘지 않고 뜻만 갱신된다", async () => {
    const before = (await db().query(
      `select count(*)::int as n from words where surface = $1 and reading = $2`,
      [`${P}環境`, `${P}かんきょう`],
    )) as { n: number }[];

    const again = await insertWord({
      surface: `${P}環境`,
      reading: `${P}かんきょう`,
      meaning_ko: "환경·상황",
      note: MARK,
      study_day: TODAY,
    });
    expect(again.merged).toBe(true);
    expect(again.word.meaning_ko).toBe("환경·상황");
    expect(again.word.id).toBe(ids[0]); // 같은 행

    const after = (await db().query(
      `select count(*)::int as n from words where surface = $1 and reading = $2`,
      [`${P}環境`, `${P}かんきょう`],
    )) as { n: number }[];
    expect(after[0].n).toBe(before[0].n); // 행이 늘지 않았다

    const found = await fetchWordsBySurface(`${P}環境`);
    expect(found[0].meaning_ko).toBe("환경·상황");
  });

  it("표기가 같아도 읽기가 다르면 별개 단어로 들어간다", async () => {
    const a = await insertWord({
      surface: `${P}上手`, reading: `${P}じょうず`, meaning_ko: "능숙함", note: MARK, study_day: TODAY,
    });
    const b = await insertWord({
      surface: `${P}上手`, reading: `${P}うわて`, meaning_ko: "위쪽/우위", note: MARK, study_day: TODAY,
    });
    expect(a.merged).toBe(false);
    expect(b.merged).toBe(false);
    expect(a.word.id).not.toBe(b.word.id);
  });

  it("동음 충돌을 감지한다", async () => {
    const counts = await fetchHomophoneCounts();
    expect(counts[`${P}いがい`]).toBe(2);
    expect(counts[`${P}かんきょう`]).toBeUndefined();
  });

  it("큐가 생성되고 신규 첫 퀴즈는 한자 -> 읽기다", async () => {
    const [words, readingCounts] = await Promise.all([
      fetchQueueCandidates(TODAY),
      fetchHomophoneCounts(),
    ]);
    const cards = buildQueue({
      words: words.filter((w) => ids.includes(w.id)),
      today: TODAY,
      readingCounts,
    });
    expect(cards.filter((c) => c.kind === "learn")).toHaveLength(FIXTURES.length);

    const kana = cards.find((c) => c.word.surface === `${P}ちゃんと` && c.kind !== "learn");
    expect(kana?.kind).toBe("s2m"); // 가나 전용은 표기 -> 뜻

    const kanji = cards.find((c) => c.word.surface === `${P}環境` && c.kind !== "learn");
    expect(kanji?.kind).toBe("s2r");
  });

  it("채점 API 가 SRS 와 리뷰 로그를 함께 갱신한다", async () => {
    statsBefore = await fetchPeriodStats(studyDayStart(TODAY).toISOString());
    const [ok, ng] = [ids[0], ids[1]];
    const req = new Request("http://localhost/api/grades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grades: [
          { wordId: ok, kind: "learn", correct: true, retry: false },
          { wordId: ok, kind: "s2r", correct: true, retry: false },
          { wordId: ng, kind: "s2r", correct: false, retry: false },
          { wordId: ng, kind: "s2r", correct: true, retry: true },
        ],
      }),
    });
    const res = await gradesPOST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: 4 });

    const rows = (await db().query(
      `select id, stage, to_char(next_review,'YYYY-MM-DD') as next_review,
              correct_count, wrong_count, streak, last_wrong_type
         from words where id = any($1::uuid[])`,
      [[ok, ng]],
    )) as Record<string, unknown>[];

    const a = rows.find((r) => r.id === ok)!;
    expect(a.stage).toBe(1);
    expect(a.next_review).toBe(addDays(TODAY, 1));
    expect(a.correct_count).toBe(1);
    expect(a.streak).toBe(1);

    const b = rows.find((r) => r.id === ng)!;
    expect(b.stage).toBe(1); // 몰랐음 -> 1 고정
    expect(b.next_review).toBe(addDays(TODAY, 1));
    expect(b.wrong_count).toBe(1);
    expect(b.streak).toBe(0);
    expect(b.last_wrong_type).toBe("s2r");
    expect(b.correct_count).toBe(0); // 세션 내 재시도 성공은 반영되지 않는다

    const logs = (await db().query(
      `select prompt_type, correct, in_session_retry from reviews where word_id = any($1::uuid[])`,
      [[ok, ng]],
    )) as Record<string, unknown>[];
    expect(logs).toHaveLength(4);
    expect(logs.filter((l) => l.in_session_retry === true)).toHaveLength(1);
    expect(logs.filter((l) => l.prompt_type === "learn")).toHaveLength(1);
  });

  it("오늘 카운트와 기간 통계가 나온다", async () => {
    const counts = await fetchTodayCounts(TODAY);
    expect(counts.totalWords).toBeGreaterThanOrEqual(FIXTURES.length);
    expect(counts.newCount).toBeGreaterThanOrEqual(3);

    // 기존 데이터가 섞여 있어도 되도록 증분으로 본다.
    const after = await fetchPeriodStats(studyDayStart(TODAY).toISOString());
    expect(after.reviewCount - statsBefore.reviewCount).toBe(2); // learn 과 재시도는 제외
    expect(after.correctCount - statsBefore.correctCount).toBe(1);
  });

  it("CSV / JSON export 가 전 필드를 담는다", async () => {
    const csvRes = await exportGET(new Request("http://localhost/api/export?format=csv"));
    // Response.text() 는 선행 BOM 을 떼어내므로 바이트로 확인해야 한다.
    const bytes = new Uint8Array(await csvRes.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // 엑셀용 BOM
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    expect(csv.split("\n")[0]).toContain("surface,reading,meaning_ko,study_day,note,stage");
    expect(csv).toContain(`${P}かんきょう`);
    expect(csv).toContain(`${P}ちゃんと`);
    expect(csvRes.headers.get("content-disposition")).toContain(".csv");

    const jsonRes = await exportGET(new Request("http://localhost/api/export?format=json"));
    const data = (await jsonRes.json()) as { version: number; words: unknown[]; reviews: unknown[] };
    expect(data.version).toBe(1);
    expect(data.words.length).toBeGreaterThanOrEqual(FIXTURES.length);
    expect(data.reviews.length).toBeGreaterThanOrEqual(4);
  });
});
