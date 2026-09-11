"use client";

import { useMemo, useState } from "react";
import { bulkAddWordsAction } from "@/lib/actions/words";
import { parsePasted, type ParsedRow } from "@/lib/parse";

const SAMPLE = `環境\tかんきょう\t환경
改善,かいぜん,개선
協力(きょうりょく) 협력
きっかけ\t계기`;

export function PasteForm({
  studyDay,
  onDone,
}: {
  studyDay: string;
  onDone: (added: number) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const parsed = useMemo(() => rows ?? [], [rows]);
  const valid = parsed.filter((r) => !r.error);
  const broken = parsed.filter((r) => r.error);

  function preview() {
    setResult(null);
    setRows(parsePasted(text));
  }

  async function commit() {
    if (busy || valid.length === 0) return;
    setBusy(true);
    const res = await bulkAddWordsAction(
      valid.map((r) => ({
        surface: r.surface,
        reading: r.reading,
        meaning_ko: r.meaning_ko,
      })),
      studyDay,
    );
    setBusy(false);
    setResult(
      `${res.added}개 추가` +
        (res.merged > 0 ? ` · ${res.merged}개는 이미 있어 뜻만 갱신` : "") +
        (res.failed > 0 ? ` · ${res.failed}개 실패` : ""),
    );
    setText("");
    setRows(null);
    onDone(res.added + res.merged);
  }

  function edit(i: number, key: keyof ParsedRow, value: string) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = { ...next[i], [key]: value };
      // 고치면 오류 표시를 다시 계산한다
      const reparsed = parsePasted(`${row.surface}\t${row.reading}\t${row.meaning_ko}`)[0];
      next[i] = { ...row, error: reparsed?.error ?? "칸을 나눌 수 없습니다" };
      return next;
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={SAMPLE}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm outline-none focus:border-accent"
      />
      <p className="text-xs text-muted">
        한 줄에 한 단어 · 탭 / 쉼표 / 슬래시 / 2칸 이상 공백으로 나눕니다. 읽기는 로마자로 써도
        됩니다. 표기가 가나뿐이면 읽기를 생략할 수 있습니다.
      </p>

      <div className="flex gap-3">
        <button
          onClick={preview}
          disabled={text.trim().length === 0}
          className="rounded-xl border border-border bg-surface px-5 py-3 font-semibold disabled:opacity-50"
        >
          미리보기
        </button>
        {valid.length > 0 && (
          <button
            onClick={() => void commit()}
            disabled={busy}
            className="flex-1 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? "저장 중…" : `${valid.length}개 저장`}
          </button>
        )}
      </div>

      {result && <p className="text-sm text-accent">{result}</p>}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-normal">표기</th>
                <th className="px-3 py-2 text-left font-normal">읽기</th>
                <th className="px-3 py-2 text-left font-normal">뜻</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className={r.error ? "bg-warn-bg" : undefined}>
                  <td className="px-2 py-1">
                    <input
                      value={r.surface}
                      onChange={(e) => edit(i, "surface", e.target.value)}
                      lang="ja"
                      className="w-full bg-transparent px-1 py-1 text-base outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={r.reading}
                      onChange={(e) => edit(i, "reading", e.target.value)}
                      lang="ja"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="w-full bg-transparent px-1 py-1 text-base outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={r.meaning_ko}
                      onChange={(e) => edit(i, "meaning_ko", e.target.value)}
                      lang="ko"
                      className="w-full bg-transparent px-1 py-1 outline-none"
                    />
                    {r.error && <span className="text-xs text-warn">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {broken.length > 0 && (
        <p className="text-xs text-warn">
          {broken.length}개 줄은 아직 저장되지 않습니다. 위 표에서 고치면 바로 반영됩니다.
        </p>
      )}
    </div>
  );
}
