import fs from 'node:fs';
import zlib from 'node:zlib';

// ---- PNG 编码（RGBA，无依赖）----
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}
function writePng(size, getPixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// ---- 图标绘制：深蓝渐变底 + 青色时钟环 + 时针分针 + 白色小鱼 ----
function drawIcon(x, y, size) {
  const nx = x / size, ny = y / size;
  const t = (nx + ny) / 2;
  const r = Math.round(10 + (20 - 10) * t);
  const g = Math.round(26 + (69 - 26) * t);
  const b = Math.round(38 + (94 - 38) * t);
  let col = [r, g, b, 255];
  const cx = 0.5 * size, cy = 0.49 * size;
  // 时钟环
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - 0.29 * size) < 0.028 * size) return [159, 232, 255, 255];
  // 时针（12 点）分针（3 点）
  if (distToSeg(x, y, cx, cy, cx, cy - 0.235 * size) < 0.024 * size) return [159, 232, 255, 255];
  if (distToSeg(x, y, cx, cy, cx + 0.235 * size, cy) < 0.024 * size) return [159, 232, 255, 255];
  // 白色小鱼：椭圆身体 + 三角尾
  const fx = 0.29 * size, fy = 0.75 * size;
  const dx = x - fx, dy = y - fy;
  const cos = Math.cos(0.3), sin = Math.sin(0.3);
  const ex = dx * cos + dy * sin, ey = -dx * sin + dy * cos;
  if ((ex * ex) / (0.1 * size * 0.1 * size) + (ey * ey) / (0.052 * size * 0.052 * size) < 1) return [255, 255, 255, 225];
  if (pointInTri(x, y, 0.205 * size, 0.75 * size, 0.12 * size, 0.69 * size, 0.12 * size, 0.81 * size)) return [255, 255, 255, 225];
  return col;
}

fs.mkdirSync('public/icons', { recursive: true });
for (const size of [512, 192]) {
  fs.writeFileSync(`public/icons/icon-${size}.png`, writePng(size, (x, y) => drawIcon(x, y, size)));
  console.log(`icon-${size}.png written`);
}
