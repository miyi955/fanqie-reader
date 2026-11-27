// 生成应用图标（ICO，内嵌 PNG）
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// 番茄红底 + 白色书页/文字线条，简洁、缩小后仍可辨识
function svg(size) {
  const s = size;
  const u = s / 32;            // 以 32 为设计基准
  const r = Math.round(7 * u); // 圆角
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#c0392b"/>
  <g fill="#ffffff">
    <rect x="9" y="9" width="14" height="2.6" rx="1.3"/>
    <rect x="9" y="14.2" width="14" height="2.6" rx="1.3"/>
    <rect x="9" y="19.4" width="8.5" height="2.6" rx="1.3"/>
  </g>
  <path d="M22 18.5l4.6 4.6-2.2 2.2-4.6-4.6z" fill="#ffffff" opacity=".95"/>
</svg>`.replace('rx="7"', `rx="${r}"`);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const s of sizes) {
  const buf = await sharp(Buffer.from(svg(s))).png().toBuffer();
  pngs.push({ size: s, buf });
}

// ICO 容器：ICONDIR + ICONDIRENTRY*n + PNG 数据
const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type = icon
header.writeUInt16LE(count, 4);  // count

const entries = [];
let offset = 6 + count * 16;
for (const p of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);   // width (0 = 256)
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);   // height
  e.writeUInt8(0, 2);                            // palette
  e.writeUInt8(0, 3);                            // reserved
  e.writeUInt16LE(1, 4);                         // color planes
  e.writeUInt16LE(32, 6);                        // bpp
  e.writeUInt32LE(p.buf.length, 8);              // size
  e.writeUInt32LE(offset, 12);                   // offset
  offset += p.buf.length;
  entries.push(e);
}

const ico = Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
await writeFile(join(OUT, 'icon.ico'), ico);

// 同时留一份 256 png，供其它用途
await writeFile(join(OUT, 'icon.png'), pngs[pngs.length - 1].buf);

console.log('icon.ico', ico.length, 'bytes, sizes:', sizes.join('/'));