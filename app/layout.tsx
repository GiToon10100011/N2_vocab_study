import type { Metadata, Viewport } from "next";
import { RegisterSW } from "./RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "N2 단어",
  description: "JLPT N2 한자 읽기 중심 단어 학습",
  applicationName: "N2 단어",
  appleWebApp: {
    capable: true,
    title: "N2 단어",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다. 한자를 크게 보려는 사용자를 가로막을 이유가 없고,
  // maximum-scale 제한은 접근성 검사에서도 실패한다.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#131313" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* App Router 에서는 head 에 직접 넣는 것이 맞다. 이 규칙은 pages/_document 용이다. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap"
        />
      </head>
      <body className="min-h-full">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
