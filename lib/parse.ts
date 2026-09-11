import { isAllKana, normalizeReading } from "./kana";

export interface ParsedRow {
  surface: string;
  reading: string;
  meaning_ko: string;
  /** 원본 줄. 미리보기에서 어디가 문제인지 보여주기 위해 들고 다닌다. */
  raw: string;
  error: string | null;
}

/**
 * 붙여넣기 파서.
 * 구분자: 탭 / 2칸 이상 공백 / 콤마 / 슬래시.
 * 괄호 표기(協力(きょうりょく) 협력)도 받는다.
 */
export function parsePasted(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];

  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (raw.length === 0) continue;

    let fields = splitBracketForm(raw) ?? splitDelimited(raw);
    fields = fields.map((f) => f.trim()).filter((f) => f.length > 0);

    if (fields.length >= 3) {
      const [surface, reading, ...rest] = fields;
      out.push(finish(surface, reading, rest.join(", "), raw));
    } else if (fields.length === 2) {
      const [a, b] = fields;
      // 첫 칸이 전부 가나면 표기 자체가 가나인 단어로 본다(きっかけ / 계기).
      if (isAllKana(a)) out.push(finish(a, a, b, raw));
      else out.push({ surface: a, reading: "", meaning_ko: b, raw, error: "읽기가 없습니다" });
    } else {
      out.push({ surface: raw, reading: "", meaning_ko: "", raw, error: "칸을 나눌 수 없습니다" });
    }
  }
  return out;
}

function splitDelimited(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  if (/\s\/\s/.test(line)) return line.split(/\s*\/\s*/);
  if (/ {2,}|　/.test(line)) return line.split(/ {2,}|　+/);
  return line.split(/\s+/);
}

/** 協力(きょうりょく) 협력 / 維持[いじ] 유지 */
function splitBracketForm(line: string): string[] | null {
  const m = /^(\S+?)[（([［]([^）)\]］]+)[）)\]］]\s*(.*)$/.exec(line);
  return m ? [m[1], m[2], m[3]] : null;
}

function finish(surface: string, reading: string, meaning: string, raw: string): ParsedRow {
  const s = surface.trim();
  // 표기가 가나뿐이면 읽기는 표기와 같다. 추정하지 않는다.
  const r = isAllKana(s) ? s : normalizeReading(reading);
  const m = meaning.trim();

  let error: string | null = null;
  if (!s) error = "표기가 없습니다";
  else if (!r) error = "읽기가 없습니다";
  else if (!m) error = "뜻이 없습니다";
  else if (!isAllKana(r)) error = `읽기가 가나가 아닙니다: ${r}`;

  return { surface: s, reading: r, meaning_ko: m, raw, error };
}
