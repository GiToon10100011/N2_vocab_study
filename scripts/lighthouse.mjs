/**
 * Lighthouse 측정. 인증 쿠키를 달아 실제 화면을 잰다.
 *   node --env-file=.env.local scripts/lighthouse.mjs <baseUrl>
 */
import { createHmac } from "node:crypto";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const base = process.argv[2] || "http://localhost:3210";
const exp = String(Date.now() + 86_400_000);
const sig = createHmac("sha256", process.env.SESSION_SECRET).update(exp).digest("base64url");
const cookie = `n2v_session=${exp}.${sig}`;

const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });

const PAGES = ["/", "/study", "/words", "/add"];
const rows = [];

for (const path of PAGES) {
  const { lhr } = await lighthouse(
    base + path,
    { port: chrome.port, output: "json", logLevel: "error" },
    {
      extends: "lighthouse:default",
      settings: {
        extraHeaders: { Cookie: cookie },
        formFactor: "desktop",
        screenEmulation: { disabled: true },
        throttlingMethod: "simulate",
      },
    },
  );

  const cat = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
  const audit = (k) => lhr.audits[k]?.numericValue ?? 0;
  rows.push({
    path,
    성능: cat("performance"),
    접근성: cat("accessibility"),
    권장사항: cat("best-practices"),
    FCP: Math.round(audit("first-contentful-paint")),
    LCP: Math.round(audit("largest-contentful-paint")),
    TBT: Math.round(audit("total-blocking-time")),
    CLS: Number(audit("cumulative-layout-shift").toFixed(3)),
  });
}

await chrome.kill();

console.log("\n=== Lighthouse (desktop) ===");
console.table(rows);
console.log("FCP/LCP/TBT 는 ms, CLS 는 누적 레이아웃 이동량");

const bad = rows.filter((r) => r.성능 < 80 || r.접근성 < 90);
if (bad.length > 0) {
  console.log("\n기준 미달:", bad.map((b) => b.path).join(", "));
}
