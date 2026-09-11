import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, SESSION_DAYS, checkPassword, createToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!(await checkPassword(password))) redirect("/login?e=1");

  const jar = await cookies();
  jar.set(COOKIE_NAME, await createToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const failed = (await searchParams).e === "1";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold tracking-tight">N2 단어</h1>
      <p className="mt-2 text-sm text-muted">기기당 한 번만 입력하면 됩니다.</p>

      <form action={login} className="mt-8 flex flex-col gap-3">
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          placeholder="비밀번호"
          className="rounded-lg border border-border bg-surface px-4 py-3 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-3 text-base font-semibold text-accent-fg"
        >
          들어가기
        </button>
        {failed && (
          <p className="text-sm text-danger">비밀번호가 맞지 않습니다.</p>
        )}
      </form>
    </main>
  );
}
