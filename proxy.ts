import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const ok = await verifyToken(req.cookies.get(COOKIE_NAME)?.value);
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // /login 과 정적 자산, PWA 자산만 열어둔다. 나머지(서버 액션 POST 포함)는 전부 쿠키를 요구한다.
  // sw.js / manifest 가 막히면 서비스 워커 등록과 설치 배너가 동작하지 않는다.
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch-icon).*)",
  ],
};
