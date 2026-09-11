/**
 * PWA 아이콘 생성. 외부 이미지 라이브러리 없이 zlib 만으로 PNG 를 직접 쓴다.
 * 글자는 폰트 대신 SDF(캡슐/호)로 그려서 어떤 크기에서도 매끈하게 나온다.
 *   npm run icons
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [0x21, 0x5c, 0x40]; // 진한 녹색
const FG = [0xf4, 0xf7, 0xf2]; // 밝은 회백색

/* ---------------- SDF 도형 ---------------- */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 선분(두께 r)까지의 거리 */
function capsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** 중심 (cx,cy), 반지름 rad, 각도 a0~a1(라디안) 인 호. 두께 r */
function arc(px, py, cx, cy, rad, a0, a1, r) {
  let a = Math.atan2(py - cy, px - cx);
  while (a < a0) a += Math.PI * 2;
  if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - rad) - r;
  const p0 = [cx + rad * Math.cos(a0), cy + rad * Math.sin(a0)];
  const p1 = [cx + rad * Math.cos(a1), cy + rad * Math.sin(a1)];
  return Math.min(Math.hypot(px - p0[0], py - p0[1]), Math.hypot(px - p1[0], py - p1[1])) - r;
}

function roundedRect(px, py, cx, cy, hw, hh, rad) {
  const dx = Math.abs(px - cx) - (hw - rad);
  const dy = Math.abs(py - cy) - (hh - rad);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rad;
}

/** "N2" 를 단위 좌표계(0~1)에 그렸을 때의 거리장 */
function markSdf(x, y) {
  const t = 0.040; // 획 두께(반지름)
  const TOP = 0.315;
  const BASE = 0.695;

  // N — 왼쪽 세로 / 대각선 / 오른쪽 세로
  const nL = capsule(x, y, 0.215, TOP, 0.215, BASE, t);
  const nD = capsule(x, y, 0.215, TOP, 0.435, BASE, t);
  const nR = capsule(x, y, 0.435, TOP, 0.435, BASE, t);

  // 2 — 위쪽 열린 호 / 대각선 / 아래 가로
  const cx = 0.665;
  const rad = 0.115;
  const cy = TOP + rad + t; // 호의 꼭대기를 N 의 윗선에 맞춘다
  const a0 = Math.PI * 1.05;
  const a1 = Math.PI * 2.15;
  const endX = cx + rad * Math.cos(a1);
  const endY = cy + rad * Math.sin(a1);
  const aTop = arc(x, y, cx, cy, rad, a0, a1, t);
  const aDiag = capsule(x, y, endX, endY, 0.555, BASE, t);
  const aBase = capsule(x, y, 0.555, BASE, 0.800, BASE, t);

  return Math.min(nL, nD, nR, aTop, aDiag, aBase);
}

/* ---------------- 래스터라이즈 ---------------- */

function render(size, { padding = 0, rounded = true }) {
  const SS = 3; // 3x3 슈퍼샘플링
  const px = Buffer.alloc(size * size * 4);
  const inset = padding;
  const scale = 1 - inset * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const bgD = rounded ? roundedRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) : -1;
          if (bgD <= 0) bgHits++;
          // 마크는 안쪽 영역에 맞춰 축소
          const mu = (u - 0.5) / scale + 0.5;
          const mv = (v - 0.5) / scale + 0.5;
          if (markSdf(mu, mv) <= 0 && bgD <= 0) fgHits++;
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      const fgA = fgHits / total;
      const i = (y * size + x) * 4;
      // 배경 위에 전경을 알파 합성
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(BG[c] * (1 - fgA) + FG[c] * fgA);
      }
      px[i + 3] = Math.round(255 * bgA);
    }
  }
  return px;
}

/* ---------------- PNG 인코딩 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- 출력 ---------------- */

mkdirSync("public", { recursive: true });
const targets = [
  ["public/icon-192.png", 192, { padding: 0.0 }],
  ["public/icon-512.png", 512, { padding: 0.0 }],
  // maskable 은 기기가 바깥을 잘라내므로 안전 영역(중앙 80%)에 맞춰 여백을 준다
  ["public/icon-maskable-512.png", 512, { padding: 0.12 }],
  // iOS 는 자체적으로 모서리를 깎으므로 사각형으로 낸다
  ["public/apple-touch-icon.png", 180, { padding: 0.04, rounded: false }],
];

for (const [path, size, opts] of targets) {
  const png = encodePng(size, render(size, opts));
  writeFileSync(path, png);
  console.log(`  ${path}  ${size}x${size}  ${(png.length / 1024).toFixed(1)}KB`);
}
