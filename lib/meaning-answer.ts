/**
 * 실전 테스트의 뜻 판정. 화면의 즉시 판정과 서버의 재채점이 이 파일 하나를 쓴다. 순수 함수다.
 *
 * 정답 뜻은 단어장에 사람이 적은 문자열이다. 모양은 세 가지가 흔하다.
 *   - 쉼표로 여러 뜻:   "외견, 겉모습, 외관"      → 하나만 맞혀도 정답
 *   - 괄호 보충 설명:    "(자리를) 떠나다"         → 괄호 안은 적어도 되고 안 적어도 된다
 *   - 용언 어미:        "유쾌하다" ↔ "유쾌"        → 같은 말의 다른 꼴
 *   - 명사형:           "참음" ↔ "참다"           → 같은 말의 다른 꼴
 *
 * 부분 점수는 철자가 비슷한 정도(자모 이중음 Dice)로 정한다. 뜻이 같은 다른 낱말(동의어)은 알아보지 못한다 —
 * AI 를 쓰지 않는다는 규칙(CLAUDE.md 절대 규칙 8) 때문이다. 그런 답은 정답 목록에 그 낱말이 있어야 맞는다.
 */

/** 정답 */
export const MEANING_FULL = 1;
/** 부분 정답. 단어 복습에는 맞힌 것으로 치고, 끝 화면 점수에만 0.5 로 센다. */
export const MEANING_PARTIAL = 0.5;
/** 이 점수 이상이면 맞힌 것으로 쳐서 단어 주기를 내리지 않는다. */
export const MEANING_PASS_MIN = MEANING_PARTIAL;
/** 철자가 이만큼 비슷하면(오타 수준) 부분 정답. 값은 단어장의 뜻끼리 견줘 정했다. */
export const PARTIAL_SIMILARITY = 0.8;
/** 한쪽 어근이 다른 쪽 안에 들어 있을 때, 짧은 쪽이 긴 쪽의 이만큼 이상이어야 부분 정답. */
export const CONTAIN_RATIO = 0.5;

/** 한 번에 보는 입력 조각의 수. 아는 낱말을 줄줄이 적어 한 개가 걸리게 하는 것을 막는다. */
const MAX_TYPED_PARTS = 3;

const SEPARATOR = /[,，、;；/／]/;
const SEPARATORS = /[,，、;；/／]/g;
const OPEN = /[(（]/;
const CLOSE = /[)）]/;
const PAREN = /[(（][^()（）]*[)）]/g;
const PAREN_CHARS = /[()（）]/g;
/** 비교에서 무시하는 글자: 공백과 문장부호 */
const IGNORED = /[\s·・‧.。…~〜!?"'“”‘’\-–—]/g;
/**
 * 글자에 붙지 못하고 홀로 남은 자모(관ㅁ찰 의 ㅁ). 자판에서 잘못 누른 것이라 비교에서 뺀다.
 * NFKC 가 호환 자모(ㅁ)를 첫가끝 자모로 바꾸고 붙을 수 있는 것은 글자로 묶으므로, 그 뒤에 남은 것만 지운다.
 */
const STRAY_JAMO = /[ᄀ-ᇿㄱ-ㆎꥠ-꥿ힰ-퟿]/g;
/** 용언 어미. 긴 것부터 하나만 뗀다. */
const ENDINGS = ["하다", "되다", "이다", "다"];
/** 명사형 어미(참음 · 달리기 · 관찰하기). 긴 것부터 하나만 뗀다. ㅁ 받침 명사형(기쁨 · 성실함)은 dropFinalM 이 본다. */
const NOUN_ENDINGS = ["하기", "되기", "기", "음"];
/** ㅁ 받침을 뗀 뒤 남는 가벼운 어간(성실하 · 관찰되 · 학생이). */
const LIGHT_STEMS = ["하", "되", "이"];

/** 괄호 밖의 구분자로만 나눈다. "(자리를, 직장을) 떠나다" 의 쉼표는 나누지 않는다. */
function splitOutsideParens(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (OPEN.test(ch)) depth += 1;
    else if (CLOSE.test(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && SEPARATOR.test(ch)) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** 비교용으로 다듬는다: 호환 문자 통일, 소문자, 공백 · 문장부호 · 홀로 남은 자모 제거. */
function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(IGNORED, "").replace(STRAY_JAMO, "");
}

/** 괄호 기호와 괄호 안의 구분자까지 걷어 한 덩어리로 다듬는다: "(자리를, 직장을) 떠나다" → "자리를직장을떠나다". */
function unwrap(s: string): string {
  return norm(s.replace(PAREN_CHARS, "").replace(SEPARATORS, ""));
}

/** 정답 뜻이 받아들이는 꼴 하나. loose 가 아니면 정확히 같을 때(어미 차이 포함)만 인정한다. */
interface Form {
  text: string;
  /** 부분 점수의 기준이 되는 꼴인가 */
  loose: boolean;
}

/**
 * 정답 뜻의 항목 하나가 받아들이는 꼴. 괄호가 있으면 「괄호 안을 뺀 것」과 「괄호 안을 풀어 넣은 것」 둘이다.
 * 부분 점수는 괄호를 뺀 꼴로만 계산한다 — 괄호 안의 보충 설명(자리를)만 적어서 점수를 받지 못하게 한다.
 * 항목이 통째로 괄호면 뺄 꼴이 없으니 풀어 넣은 꼴이 기준이 된다.
 */
function itemForms(item: string): Form[] {
  const core = norm(item.replace(PAREN, ""));
  const inline = unwrap(item);
  const out: Form[] = [];
  if (core) out.push({ text: core, loose: true });
  if (inline && inline !== core) out.push({ text: inline, loose: core === "" });
  return out;
}

function formsOf(meaning: string): Form[] {
  return splitOutsideParens(meaning).flatMap(itemForms);
}

/** 정답 뜻이 받아들이는 모든 꼴(다듬은 문자열). 쉼표 목록의 어느 것이든 된다. */
export function expectedForms(meaning: string): string[] {
  return [...new Set(formsOf(meaning).map((f) => f.text))];
}

/** 용언 어미를 하나 뗀다. 떼고 남는 것이 없으면 떼지 않는다. */
function stem(s: string): string {
  for (const e of ENDINGS) {
    if (s.length > e.length && s.endsWith(e)) return s.slice(0, -e.length);
  }
  return s;
}

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const FINAL_COUNT = 28;
const FINAL_L = 8; // ㄹ
const FINAL_LM = 10; // ㄻ
const FINAL_M = 16; // ㅁ

/** 마지막 글자의 ㅁ 받침을 뗀다(잠 → 자, 기쁨 → 기쁘, 삶 → 살). ㅁ 받침이 아니면 null. */
function dropFinalM(s: string): string | null {
  const code = s.charCodeAt(s.length - 1);
  if (code < SYLLABLE_FIRST || code > SYLLABLE_LAST) return null;
  const final = (code - SYLLABLE_FIRST) % FINAL_COUNT;
  if (final !== FINAL_M && final !== FINAL_LM) return null;
  const next = code - final + (final === FINAL_LM ? FINAL_L : 0);
  return s.slice(0, -1) + String.fromCharCode(next);
}

/**
 * 어근 후보와 그것을 얻은 꼴. 맨 낱말(bare)은 어미를 떼지 않은 것이다.
 * 한 글자짜리 낱말의 ㅁ 받침(봄 · 밤 · 힘)은 명사형인지 알 수 없어 bare 로 둔다.
 */
type RootKind = "bare" | "verb" | "noun";
interface Root {
  text: string;
  kind: RootKind;
}

function rootsOf(s: string): Root[] {
  const out: Root[] = [{ text: s, kind: "bare" }];
  const add = (text: string, kind: RootKind) => {
    if (text && text !== s) out.push({ text, kind });
  };
  add(stem(s), "verb");
  const noun = NOUN_ENDINGS.find((e) => s.length > e.length && s.endsWith(e));
  if (noun) add(s.slice(0, -noun.length), "noun");
  const m = dropFinalM(s);
  if (m) {
    const kind = s.length >= 2 ? "noun" : "bare";
    add(m, kind);
    const light = LIGHT_STEMS.find((e) => m.length > e.length && m.endsWith(e));
    if (light) add(m.slice(0, -light.length), kind);
  }
  return out;
}

/**
 * 같은 말의 다른 꼴인가: 어미를 떼고 남은 어근이 같다(유쾌 / 유쾌하다, 참음 / 참다, 기쁨 / 기쁘다).
 * 어근이 두 글자 이상이거나 한쪽이 명사형이면 정답이다. 한 글자 어근이 맨 낱말과 겹치거나(줄 / 줄다)
 * 용언 어미끼리만 다르면(쌓다 / 쌓이다) 우연이거나 뜻이 갈릴 수 있어 부분 점수만 준다.
 */
function sameWordScore(t: string, e: Form): number {
  let best = 0;
  for (const a of rootsOf(t)) {
    for (const b of rootsOf(e.text)) {
      if (a.text !== b.text) continue;
      const nounVerb = a.kind !== "bare" && b.kind !== "bare" && (a.kind === "noun" || b.kind === "noun");
      if (a.text.length >= 2 || nounVerb) return MEANING_FULL;
      if (e.loose) best = MEANING_PARTIAL;
    }
  }
  return best;
}

/** 한글을 자모로 풀어 이중음(두 글자씩)을 센다. 받침 없는 글자의 초성 ㅇ(U+110B)은 소리가 없으니 뺀다. */
function jamoBigrams(s: string): Map<string, number> {
  const jamo = s.normalize("NFD").replace(/ᄋ/g, "");
  const grams = new Map<string, number>();
  for (let i = 0; i + 1 < jamo.length; i++) {
    const g = jamo.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** 0~1. 자모 이중음이 얼마나 겹치는가(Dice). */
export function similarity(a: string, b: string): number {
  const x = jamoBigrams(a);
  const y = jamoBigrams(b);
  let total = 0;
  for (const n of x.values()) total += n;
  for (const n of y.values()) total += n;
  if (total === 0) return 0;
  let shared = 0;
  for (const [g, n] of x) shared += Math.min(n, y.get(g) ?? 0);
  return (2 * shared) / total;
}

/**
 * 두 어근이 가까운가. 어미(-하다 · -되다 · -다)를 떼고 잰다 — 어미가 같다는 이유만으로
 * 「해당하다」와 「당황하다」가 비슷해지지 않게 한다. 어근이 한 글자면 믿을 수 없어 가깝지 않다고 본다.
 *   - 한쪽이 다른 쪽 안에 들어 있고 길이가 절반 이상이다:  모습 ⊂ 겉모습, 역할 ⊂ 역할을맡다
 *   - 철자가 아주 비슷하다(Dice ≥ PARTIAL_SIMILARITY):     오타 수준
 * 철자가 어중간하게 비슷한 것(고충 ~ 보충)은 뜻이 가깝다는 근거가 못 되어 뺀다.
 */
export function rootsClose(a: string, b: string): boolean {
  const sa = stem(a);
  const sb = stem(b);
  if (sa.length < 2 || sb.length < 2) return false;
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (long.includes(short) && short.length / long.length >= CONTAIN_RATIO) return true;
  return similarity(sa, sb) >= PARTIAL_SIMILARITY;
}

/** 입력 한 조각 t 와 정답 꼴 e 의 점수. */
function scoreOne(t: string, e: Form): number {
  if (t === e.text) return MEANING_FULL;
  const same = sameWordScore(t, e);
  if (same > 0) return same;
  // 한 글자끼리의 유사도는 믿을 수 없다. 철자가 같거나 어근이 같을 때만 인정한다(위).
  if (t.length < 2 || e.text.length < 2) return 0;
  return e.loose && rootsClose(t, e.text) ? MEANING_PARTIAL : 0;
}

export type MeaningJudgement =
  | { result: "invalid" }
  | { result: "correct" | "partial" | "wrong"; credit: 0 | 0.5 | 1; typed: string };

/**
 * 뜻 판정. 입력도 쉼표로 여러 조각을 쓸 수 있고, 가장 잘 맞는 조각의 점수를 받는다(앞의 세 조각까지).
 * 정답 목록의 항목 하나와 맞으면 정답이다. 비교할 글자가 하나도 남지 않으면 판정하지 않는다(invalid).
 *
 * typed 는 저장할 입력(앞뒤 공백을 걷은 것)이다.
 */
export function judgeMeaning(input: string, meaning: string): MeaningJudgement {
  const typed = input.trim();
  const parts = splitOutsideParens(typed)
    .map(unwrap)
    .filter((p) => p.length > 0)
    .slice(0, MAX_TYPED_PARTS);
  if (parts.length === 0) return { result: "invalid" };

  const forms = formsOf(meaning);
  let best = 0;
  for (const p of parts) {
    for (const e of forms) best = Math.max(best, scoreOne(p, e));
  }
  const credit = best === MEANING_FULL ? 1 : best === MEANING_PARTIAL ? 0.5 : 0;
  return { result: credit === 1 ? "correct" : credit === 0.5 ? "partial" : "wrong", credit, typed };
}

/**
 * 「이것도 정답」: 친 뜻을 정답 뜻 목록 끝에 쉼표로 더한 문자열. 단어장에 그대로 남는다(플래시카드 뜻에도 보인다).
 * 동의어(침 / 바늘)는 철자로 알아볼 수 없어서 사용자가 직접 정답으로 치는 길이다. 읽기에는 이 길이 없다.
 * 이미 정답으로 판정되면 그대로 돌려준다 — 두 번 눌리거나 같은 답이 다시 와도 두 번 붙지 않는다.
 * 판정할 수 없는 입력이면 null. 홀로 남은 자모와 겹친 공백은 걷고 붙인다.
 */
export function withAcceptedMeaning(meaning: string, typed: string): string | null {
  const j = judgeMeaning(typed, meaning);
  if (j.result === "invalid") return null;
  if (j.credit === MEANING_FULL) return meaning;
  const add = typed.normalize("NFKC").replace(STRAY_JAMO, "").replace(/\s+/g, " ").trim();
  return `${meaning.trim()}, ${add}`;
}

/** 이 점수를 단어 복습에서 맞힌 것으로 치는가. 뜻을 묻지 않은 옛 답(null)은 읽기만 본다. */
export function meaningPassed(credit: number | null | undefined): boolean {
  return credit === null || credit === undefined || credit >= MEANING_PASS_MIN;
}
