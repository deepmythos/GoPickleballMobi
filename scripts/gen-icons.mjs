// Sinh PNG thật từ các SVG tối giản trong public/icons.
// Chỉ dùng node:fs / node:path / node:zlib / node:url — không dependency.
// Bộ đọc SVG chỉ hiểu <rect> và <circle> với fill="#rrggbb" (không transform/gradient/opacity/stroke).
// Rasterize bằng supersampling 4x4 mỗi pixel. Kết quả tất định (chạy 2 lần ra byte y hệt).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ICONS_DIR = resolve(ROOT, "public", "icons");
const PUBLIC_DIR = resolve(ROOT, "public");

const VIEWBOX = 512;
const SAMPLES = 4; // 4x4 mỗi pixel

/* ------------------------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------- PNG */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function ihdr(width, height, colorType) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = colorType; // 2 = RGB, 6 = RGBA
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return data;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// pixels: Uint8ClampedArray RGBA (size*size*4). colorType 2 bỏ kênh alpha.
function encodePng(width, height, colorType, pixels) {
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = pixels[i];
      raw[o++] = pixels[i + 1];
      raw[o++] = pixels[i + 2];
      if (channels === 4) raw[o++] = pixels[i + 3];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr(width, height, colorType)),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------------- SVG read */

function parseHexFill(value) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value ?? "");
  if (!m) throw new Error(`Unsupported fill: ${value}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function parseSvg(text) {
  const shapes = [];
  const tagRe = /<(rect|circle)\b([^>]*?)\/?>/g;
  let tagMatch;
  while ((tagMatch = tagRe.exec(text)) !== null) {
    const tag = tagMatch[1];
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRe.exec(tagMatch[2])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    const fill = parseHexFill(attrs.fill);
    if (tag === "rect") {
      shapes.push({
        kind: "rect",
        x: Number(attrs.x ?? 0),
        y: Number(attrs.y ?? 0),
        w: Number(attrs.width),
        h: Number(attrs.height),
        rx: attrs.rx ? Number(attrs.rx) : 0,
        fill,
      });
    } else {
      shapes.push({
        kind: "circle",
        cx: Number(attrs.cx),
        cy: Number(attrs.cy),
        r: Number(attrs.r),
        fill,
      });
    }
  }
  if (shapes.length === 0) throw new Error("No <rect>/<circle> shapes found in SVG");
  return shapes;
}

function insideRect(shape, x, y) {
  if (x < shape.x || x > shape.x + shape.w || y < shape.y || y > shape.y + shape.h) {
    return false;
  }
  const rx = Math.min(shape.rx, shape.w / 2, shape.h / 2);
  if (rx <= 0) return true;
  const qx = Math.min(Math.max(x, shape.x + rx), shape.x + shape.w - rx);
  const qy = Math.min(Math.max(y, shape.y + rx), shape.y + shape.h - rx);
  const dx = x - qx;
  const dy = y - qy;
  return dx * dx + dy * dy <= rx * rx;
}

function insideShape(shape, x, y) {
  if (shape.kind === "rect") return insideRect(shape, x, y);
  const dx = x - shape.cx;
  const dy = y - shape.cy;
  return dx * dx + dy * dy <= shape.r * shape.r;
}

/* ------------------------------------------------------------ rasterizer */

function rasterize(shapes, size) {
  const scale = VIEWBOX / size;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const totalSamples = SAMPLES * SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          let color = null;
          for (const shape of shapes) {
            if (insideShape(shape, x, y)) color = shape.fill;
          }
          if (color !== null) {
            covered++;
            sumR += color.r;
            sumG += color.g;
            sumB += color.b;
          }
        }
      }

      const i = (py * size + px) * 4;
      if (covered > 0) {
        pixels[i] = Math.round(sumR / covered);
        pixels[i + 1] = Math.round(sumG / covered);
        pixels[i + 2] = Math.round(sumB / covered);
        pixels[i + 3] = Math.round((covered / totalSamples) * 255);
      }
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ main */

const written = [];

function render(svgFile, outFile, size, colorType) {
  const svg = readFileSync(svgFile, "utf8");
  const shapes = parseSvg(svg);
  const pixels = rasterize(shapes, size);
  const png = encodePng(size, size, colorType, pixels);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, png);
  written.push(resolve(outFile));
}

render(resolve(ICONS_DIR, "icon.svg"), resolve(ICONS_DIR, "icon-192.png"), 192, 6);
render(resolve(ICONS_DIR, "icon.svg"), resolve(ICONS_DIR, "icon-512.png"), 512, 6);
render(resolve(ICONS_DIR, "icon-maskable.svg"), resolve(ICONS_DIR, "icon-maskable-512.png"), 512, 6);
render(resolve(ICONS_DIR, "icon-maskable.svg"), resolve(PUBLIC_DIR, "apple-touch-icon.png"), 180, 2);

for (const file of written) {
  console.log(`wrote ${file}`);
}
