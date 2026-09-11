/**
 * 첫 실행 때 화면을 확인해보기 위한 예시 단어.
 *   npm run db:seed          넣기
 *   npm run db:seed -- --clear   전부 지우기 (note = '__seed__' 인 행만)
 *
 * 세 가지 카드 유형과 예외 규칙(동음 충돌 / 가나 전용 / 送り仮名)이 모두 나오도록 골랐다.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const MARK = "__seed__";

const WORDS = [
  ["環境", "かんきょう", "환경"],
  ["改善", "かいぜん", "개선"],
  ["違反", "いはん", "위반"],
  ["協力", "きょうりょく", "협력"],
  ["影響", "えいきょう", "영향"],
  ["増加", "ぞうか", "증가"],
  ["以外", "いがい", "이외"], // 以外 / 意外 = 동음 충돌 -> 읽기→뜻 출제 제외
  ["意外", "いがい", "의외"],
  ["取り組む", "とりくむ", "몰두하다 / 대처하다"], // 送り仮名
  ["ちゃんと", "ちゃんと", "제대로 / 확실히"], // 가나 전용 -> 표기→뜻 고정
];

if (process.argv.includes("--clear")) {
  const del = await sql.query(`delete from words where note = $1 returning id`, [MARK]);
  console.log(`지웠습니다: ${del.length}개`);
} else {
  for (const [surface, reading, meaning_ko] of WORDS) {
    await sql.query(
      `insert into words (surface, reading, meaning_ko, note)
       values ($1, $2, $3, $4)
       on conflict (surface, reading) do update
          set meaning_ko = excluded.meaning_ko`,
      [surface, reading, meaning_ko, MARK],
    );
  }
  const n = await sql.query(`select count(*)::int as n from words`);
  console.log(`넣었습니다: ${WORDS.length}개 (전체 ${n[0].n}개)`);
}
