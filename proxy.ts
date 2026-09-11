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
  // /login 과 정적 자산만 열어둔다. 나머지(서버 액션 POST 포함)는 전부 쿠키를 요구한다.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
