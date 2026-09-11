/**
 * 비밀번호 게이트 하나. 회원가입/프로필/재설정은 없다.
 * Edge 런타임(middleware)에서도 돌아가야 하므로 node:crypto 대신 Web Crypto 만 쓴다.
 */

export const COOKIE_NAME = "n2v_session";
export const SESSION_DAYS = 365;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

/** 길이가 같을 때 내용 비교 시간이 값에 따라 달라지지 않게 한다. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET 이 설정되지 않았습니다.");
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  return `${exp}.${await hmac(exp, secret)}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(exp, secret));
}

/** 비밀번호는 다이제스트끼리 비교해 길이까지 숨긴다. */
export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret) return false;
  const [a, b] = await Promise.all([hmac(input, secret), hmac(expected, secret)]);
  return timingSafeEqual(a, b);
}
