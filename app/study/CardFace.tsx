"use client";

import type { QueueCard } from "@/lib/types";

export type SessionCard = QueueCard & { retry?: boolean };

/* ------------------------------------------------------------------ *
 * 카드 앞/뒷면
 *
 * 중요: 한자 -> 읽기 카드에서 한국어 뜻은 정답 공개 전까지 DOM 에 넣지 않는다.
 * 숨기는 게 아니라 렌더하지 않는 것이다(브라우저 찾기/개발자도구 누출 방지).
 * ------------------------------------------------------------------ */

export function CardFace({ card, revealed }: { card: SessionCard; revealed: boolean }) {
  const w = card.word;
  // 가나만으로 쓰는 단어(きっかけ, バランス)는 표기와 읽기가 같다.
  // 같은 글자를 두 번 보여줘도 정보가 늘지 않으므로 한 줄만 낸다.
  const kanaOnly = w.surface === w.reading;

  if (card.kind === "learn") {
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="jp-xl" lang="ja">
          {w.surface}
        </div>
        {!kanaOnly && (
          <div className="jp-lg text-fg" lang="ja">
            {w.reading}
          </div>
        )}
        <div className="text-2xl text-muted">{w.meaning_ko}</div>
      </div>
    );
  }

  if (card.kind === "s2r") {
    if (!revealed) {
      return (
        <div className="flex flex-col items-center gap-8">
          <div className="jp-xl no-select" lang="ja">
            {w.surface}
          </div>
          <p className="text-base text-muted">읽기는?</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-6">
        <ruby className="jp-xl" lang="ja">
          {w.surface}
          <rt>{w.reading}</rt>
        </ruby>
        <div className="text-2xl text-muted">{w.meaning_ko}</div>
      </div>
    );
  }

  if (card.kind === "s2m") {
    if (!revealed) {
      return (
        <div className="flex flex-col items-center gap-8">
          <div className="jp-xl no-select" lang="ja">
            {w.surface}
          </div>
          <p className="text-base text-muted">뜻은?</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="text-3xl font-semibold">{w.meaning_ko}</div>
        {!kanaOnly && (
          <div className="jp-md text-muted" lang="ja">
            {w.reading}
          </div>
        )}
        <div className="jp-lg" lang="ja">
          {w.surface}
        </div>
      </div>
    );
  }

  // r2m — 읽기 -> 뜻. 공개 화면에서 한자를 가장 크게 보여주는 것이 이 유형의 목적이다.
  if (!revealed) {
    return (
      <div className="flex flex-col items-center gap-8">
        <div className="jp-lg no-select" lang="ja">
          {w.reading}
        </div>
        <p className="text-base text-muted">뜻은?</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="text-3xl font-semibold">{w.meaning_ko}</div>
      <div className="jp-xl" lang="ja">
        {w.surface}
      </div>
      <div className="jp-md text-muted" lang="ja">
        {w.reading}
      </div>
    </div>
  );
}
