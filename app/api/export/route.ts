import Papa from "papaparse";
import { fetchAllWords, fetchReviewLogsSince } from "@/lib/queries";
import { studyDate } from "@/lib/srs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV 열 순서는 import 쪽과 반드시 같아야 한다. 앞 3열만 있어도 신규 등록이 된다. */
const CSV_COLUMNS = [
  "surface",
  "reading",
  "meaning_ko",
  "study_day",
  "note",
  "stage",
  "next_review",
  "last_reviewed",
  "correct_count",
  "wrong_count",
  "streak",
  "last_wrong_type",
  "suspended",
  "created_at",
] as const;

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const stamp = studyDate();
  const words = await fetchAllWords();

  if (format === "json") {
    const reviews = await fetchReviewLogsSince("1970-01-01T00:00:00Z");
    const body = JSON.stringify(
      { version: 1, exported_at: new Date().toISOString(), words, reviews },
      null,
      2,
    );
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="n2-vocab-${stamp}.json"`,
      },
    });
  }

  const rows = words.map((w) => ({
    surface: w.surface,
    reading: w.reading,
    meaning_ko: w.meaning_ko,
    study_day: w.study_day,
    note: w.note ?? "",
    stage: w.stage,
    next_review: w.next_review,
    last_reviewed: w.last_reviewed ?? "",
    correct_count: w.correct_count,
    wrong_count: w.wrong_count,
    streak: w.streak,
    last_wrong_type: w.last_wrong_type ?? "",
    suspended: w.suspended,
    created_at: w.created_at,
  }));

  // 단어가 없어도 헤더는 남긴다. 빈 백업 파일이 import 템플릿으로도 쓰인다.
  const table =
    rows.length > 0
      ? Papa.unparse(rows, { columns: [...CSV_COLUMNS] })
      : CSV_COLUMNS.join(",");
  // 엑셀에서 한글/일본어가 깨지지 않도록 BOM 을 붙인다.
  const csv = "\uFEFF" + table;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="n2-vocab-${stamp}.csv"`,
    },
  });
}
