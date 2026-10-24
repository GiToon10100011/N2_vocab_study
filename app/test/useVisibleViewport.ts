"use client";

import { useEffect, useState } from "react";

export interface VisibleViewport {
  /** 지금 보이는 높이. 키보드가 열리면 그만큼 줄어든다. */
  height: number;
  /** 보이는 영역이 레이아웃 위쪽에서 얼마나 내려와 있는가. 사파리가 입력칸을 보이려고 화면을 밀면 0 이 아니다. */
  top: number;
  /** 화면 키보드가 열려 있는가. */
  keyboard: boolean;
}

/** 이보다 많이 가려지면 키보드가 열린 것으로 본다. 사파리 주소창이 접히고 펴지는 정도는 키보드가 아니다. */
const KEYBOARD_MIN = 150;

/**
 * 지금 보이는 영역. 아이폰 사파리는 키보드가 올라와도 레이아웃 높이(dvh)를 줄이지 않고 보이는 영역(visualViewport)만
 * 줄인다(interactive-widget 도 지원하지 않는다). 풀이 화면을 이 높이에 맞춰 그려야 입력칸이 키보드 바로 위에 붙는다.
 * 서버 렌더와 첫 그림에서는 null 이고, 그때는 CSS 의 100dvh 로 그린다.
 */
export function useVisibleViewport(): VisibleViewport | null {
  const [viewport, setViewport] = useState<VisibleViewport | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const layout = document.documentElement.clientHeight;
      setViewport({ height: vv.height, top: vv.offsetTop, keyboard: layout - vv.height > KEYBOARD_MIN });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return viewport;
}
