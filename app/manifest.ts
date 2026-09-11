import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "N2 단어",
    short_name: "N2 단어",
    description: "JLPT N2 한자 읽기 중심 단어 학습",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbfa",
    theme_color: "#215c40",
    lang: "ko",
    dir: "ltr",
    categories: ["education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "오늘의 학습", url: "/study" },
      { name: "단어 추가", url: "/add" },
    ],
  };
}
