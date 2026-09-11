import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardFace, type SessionCard } from "./CardFace";
import type { CardKind } from "@/lib/types";

function card(kind: CardKind): SessionCard {
  return {
    key: "k",
    kind,
    weak: false,
    word: {
      id: "w1",
      surface: "環境",
      reading: "かんきょう",
      meaning_ko: "환경",
      stage: 3,
      wrong_count: 0,
    },
  };
}

describe("카드 누출 방지", () => {
  it("한자 -> 읽기 카드는 공개 전에 읽기도 뜻도 DOM 에 넣지 않는다", () => {
    const html = renderToStaticMarkup(<CardFace card={card("s2r")} revealed={false} />);
    expect(html).toContain("環境");
    expect(html).not.toContain("환경");
    expect(html).not.toContain("かんきょう");
  });

  it("한자 -> 뜻 카드는 공개 전에 뜻을 DOM 에 넣지 않는다", () => {
    const html = renderToStaticMarkup(<CardFace card={card("s2m")} revealed={false} />);
    expect(html).toContain("環境");
    expect(html).not.toContain("환경");
  });

  it("읽기 -> 뜻 카드는 공개 전에 한자도 뜻도 DOM 에 넣지 않는다", () => {
    const html = renderToStaticMarkup(<CardFace card={card("r2m")} revealed={false} />);
    expect(html).toContain("かんきょう");
    expect(html).not.toContain("환경");
    expect(html).not.toContain("環境");
  });

  it("공개 후에는 세 유형 모두 읽기와 뜻이 함께 보인다", () => {
    for (const kind of ["s2r", "s2m", "r2m"] as CardKind[]) {
      const html = renderToStaticMarkup(<CardFace card={card(kind)} revealed />);
      expect(html).toContain("환경");
      expect(html).toContain("かんきょう");
      expect(html).toContain("環境");
    }
  });

  it("학습 카드는 처음부터 세 면을 모두 보여준다", () => {
    const html = renderToStaticMarkup(<CardFace card={card("learn")} revealed={false} />);
    expect(html).toContain("環境");
    expect(html).toContain("かんきょう");
    expect(html).toContain("환경");
  });
});

describe("가나 전용 단어", () => {
  function kanaCard(kind: CardKind): SessionCard {
    return {
      key: "k",
      kind,
      weak: false,
      word: {
        id: "w2",
        surface: "きっかけ",
        reading: "きっかけ",
        meaning_ko: "계기",
        stage: 0,
        wrong_count: 0,
      },
    };
  }

  it("학습 카드에서 같은 글자를 두 번 보여주지 않는다", () => {
    const html = renderToStaticMarkup(<CardFace card={kanaCard("learn")} revealed={false} />);
    expect(html.split("きっかけ")).toHaveLength(2); // 1회만 등장
    expect(html).toContain("계기");
  });

  it("표기 -> 뜻 카드도 공개 후 표기를 한 번만 보여준다", () => {
    const html = renderToStaticMarkup(<CardFace card={kanaCard("s2m")} revealed />);
    expect(html.split("きっかけ")).toHaveLength(2);
    expect(html).toContain("계기");
  });

  it("공개 전에는 뜻이 DOM 에 없다", () => {
    const html = renderToStaticMarkup(<CardFace card={kanaCard("s2m")} revealed={false} />);
    expect(html).not.toContain("계기");
  });
});
