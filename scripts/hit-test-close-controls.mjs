// Hit-test + tap-through probe cho MỌI nút đóng (X) của GoPickleballMobi.
//
// Vì sao có script này: trên iPhone, nút X ở góc trên bên phải của sheet KHÔNG phản hồi
// trong khi "Kéo xuống để đóng" vẫn chạy. Đọc JS không trả lời được câu hỏi "vì sao" —
// phải ĐO trên DOM thật: đặt ngón tay vào giữa điều khiển rồi hỏi
// `document.elementFromPoint(cx, cy)` trả về phần tử nào, lớp nào đang ăn cú chạm, và
// cú chạm đó có tới được `onclick` của nút hay không.
//
// Script này chạy trên bản ĐÃ BUILD (dist/) bằng chrome-headless-shell qua CDP thô,
// không phụ thuộc package ngoài (Node ≥ 22 có `WebSocket` toàn cục).
//
// Cách dùng:
//   node scripts/hit-test-close-controls.mjs [--dist dist] [--out <dir>]
// Biến môi trường: CHROME_BIN (mặc định: tìm chrome-headless-shell của playwright).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const WIDTH = 390;
const HEIGHT = 844;
const SCALE = 3;
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/opt/hermes/.playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  const out = { dist: "dist", out: "/tmp/gpm-hit-test", jitter: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") out.dist = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--jitter") out.jitter = Number(argv[++i]);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("không tìm thấy chrome-headless-shell (đặt CHROME_BIN)");
}

function serveStatic(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = join(root, decodeURIComponent(url.pathname));
    if (path.endsWith("/")) path = join(path, "index.html");
    if (!existsSync(path)) path = join(root, "index.html");
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function httpJson(url, method = "GET") {
  const res = await fetch(url, { method });
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const slot = this.pending.get(msg.id);
      if (slot) {
        this.pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
        else slot.resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = (this.seq += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async js(expr) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(() => { ${expr} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`JS lỗi: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
    }
    return result.result.value;
  }

  async waitFor(expr, timeoutMs = 10000, label = expr) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.js(`return !!(${expr});`)) return true;
      if (Date.now() > deadline) throw new Error(`hết thời gian chờ: ${label}`);
      await sleep(120);
    }
  }

  async screenshot(path, clip = null) {
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      // Clip tính theo toạ độ TÀI LIỆU và bị kẹp trong khung nhìn hiện tại → phải là
      // false, nếu không Chromium render cả trang ở trạng thái chưa cuộn (thanh sticky
      // nằm ở vị trí dòng chảy) và clip sẽ chụp nhầm nội dung.
      captureBeyondViewport: false,
      ...(clip ? { clip: { ...clip, scale: clip.scale ?? SCALE } } : {}),
    });
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    return path;
  }

  /** Các loại sự kiện đã gắn vào phần tử (chứng minh nút CÓ handler click). */
  async listenersOf(selector) {
    const handle = await this.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    if (!handle.result || !handle.result.objectId) return [];
    const found = await this.send("DOMDebugger.getEventListeners", { objectId: handle.result.objectId });
    await this.send("Runtime.releaseObject", { objectId: handle.result.objectId }).catch(() => undefined);
    return (found.listeners ?? []).map((l) => l.type).sort();
  }

  /** Cú chạm THẬT: touchStart → vài touchMove (ngón tay luôn xê dịch) → touchEnd. */
  async tap(x, y, jitter = 4) {
    const pt = (dx = 0, dy = 0) => [{ x, y: y + dy, radiusX: 12, radiusY: 12, force: 1, id: 1 }];
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(), modifiers: 0 });
    await sleep(40);
    await this.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(0, jitter) });
    await sleep(40);
    await this.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(0, -Math.floor(jitter / 2)) });
    await sleep(40);
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async clickCentre(selector, jitter = 6) {
    const box = await this.js(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    `);
    if (!box) throw new Error(`không thấy ${selector}`);
    await this.tap(box.x, box.y, jitter);
    return box;
  }
}

/** Trả về thông tin hit-test cho một selector: elementFromPoint + lớp + pointer-events. */
const HIT_PROBE = (selector) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { selector: ${JSON.stringify(selector)}, missing: true };
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hitNode = document.elementFromPoint(cx, cy);
  const cs = getComputedStyle(el);
  const hitStyle = hitNode ? getComputedStyle(hitNode) : null;
  const chain = [];
  for (let n = hitNode; n && n !== document.body; n = n.parentElement) {
    chain.push(n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).join(".") : ""));
  }
  const descendants = [];
  for (let n = hitNode; n && n !== el.parentElement; n = n.parentElement) descendants.push(n);
  return {
    selector: ${JSON.stringify(selector)},
    tag: el.tagName.toLowerCase(),
    box: { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) },
    sizeOk: r.width >= 44 && r.height >= 44,
    control: { pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position, touchAction: cs.touchAction },
    elementFromPoint: hitNode
      ? hitNode.tagName.toLowerCase() + (hitNode.className && typeof hitNode.className === "string" ? "." + hitNode.className.trim().split(/\\s+/).join(".") : "")
      : null,
    hitChain: chain,
    hitIsControlOrDescendant: hitNode ? el.contains(hitNode) : false,
    hit: hitStyle ? { pointerEvents: hitStyle.pointerEvents, zIndex: hitStyle.zIndex } : null,
  };
`;

/** Cú chạm MÔ PHỎNG ở tầng DOM: touchstart → touchmove (ngón tay xê dịch vài px) → touchend.
 *  `dispatchEvent` trả false khi `preventDefault()` được gọi — đây là phép ĐO cơ chế nuốt cú chạm. */
const TOUCH_SEQUENCE = (selector, drift) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { selector: ${JSON.stringify(selector)}, missing: true };
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const target = document.elementFromPoint(x, y);
  const touch = (ty) => new Touch({ identifier: 1, target, clientX: x, clientY: y + ty,
    pageX: x, pageY: y + ty, screenX: x, screenY: y + ty, radiusX: 12, radiusY: 12, force: 1 });
  const mk = (type, ty, points) => new TouchEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    touches: points, targetTouches: points, changedTouches: points,
  });
  window.__probe.preventDefault = [];
  const down = target.dispatchEvent(mk("touchstart", 0, [touch(0)]));
  const move = target.dispatchEvent(mk("touchmove", ${JSON.stringify(drift)}, [touch(${JSON.stringify(drift)})]));
  const up = target.dispatchEvent(mk("touchend", ${JSON.stringify(drift)}, []));
  return {
    selector: ${JSON.stringify(selector)},
    driftPx: ${JSON.stringify(drift)},
    target: target.tagName.toLowerCase() + (typeof target.className === "string" && target.className ? "." + target.className.trim().split(/\\s+/).join(".") : ""),
    touchstartDelivered: down,
    touchmoveDelivered: move,
    touchendDelivered: up,
    preventDefaultCalls: window.__probe.preventDefault,
  };
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = resolve(args.dist);
  if (!existsSync(join(dist, "index.html"))) throw new Error(`không có bản build ở ${dist}`);
  mkdirSync(args.out, { recursive: true });

  const server = await serveStatic(dist);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  const profile = join(args.out, "profile");
  mkdirSync(profile, { recursive: true });

  const chrome = spawn(findChrome(), [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let chromeStderr = "";
  chrome.stderr.on("data", (chunk) => { chromeStderr += chunk.toString(); });

  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(100);
  if (!existsSync(portFile)) throw new Error(`chrome không mở cổng gỡ lỗi:\n${chromeStderr.slice(-800)}`);
  const debugPort = readFileSync(portFile, "utf8").split("\n")[0].trim();

  const target = await httpJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, "PUT");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.addEventListener("open", done, { once: true });
    ws.addEventListener("error", () => fail(new Error("không mở được WebSocket CDP")), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

  const report = { url, viewport: `${WIDTH}x${HEIGHT}`, dist, steps: [], hits: [], taps: [], touchSequences: [], scrollStates: [] };

  // Bộ đếm để CHỨNG MINH cơ chế "nuốt cú chạm": cử chỉ kéo của sheet gọi
  // `preventDefault()` ở `touchmove`, và điều đó huỷ luôn `click` của nút đang bấm.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__probe = { preventDefault: [], touchstart: 0, touchmove: 0, click: [] };
      const realPD = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function () {
        if (window.__probe && this && this.type) window.__probe.preventDefault.push(this.type);
        return realPD.apply(this, arguments);
      };
      document.addEventListener("touchstart", () => { window.__probe.touchstart += 1; }, true);
      document.addEventListener("touchmove", () => { window.__probe.touchmove += 1; }, true);
      document.addEventListener("click", (event) => {
        const t = event.target;
        const name = t && t.tagName ? t.tagName.toLowerCase() + (typeof t.className === "string" && t.className ? "." + t.className.trim().split(/\\s+/).join(".") : "") : String(t);
        window.__probe.click.push(name);
      }, true);
    `,
  });

  await cdp.send("Page.navigate", { url });
  await cdp.waitFor("document.querySelector('.infobar')", 15000, "thanh trên render");
  await sleep(1200);

  // ---- bước 1: hit-test mọi nút đóng, mỗi nút trong sheet của nó ----
  const cases = [
    { name: "sheet Thông số — .sheet-close", open: ".actionbar-adjust", control: ".sheet-close" },
  ];

  // Khối Địa điểm giờ là khối gấp INLINE (không còn sheet): selector `.infobar-loc` cũ đã
  // bị card trước xoá nên case sheet cho location fail ngay case đầu. Đo thẳng vào
  // <summary> của details[data-collapse=location] và khẳng định chính details đó mở ra,
  // KHÔNG có .sheet-backdrop nào xuất hiện.
  {
    const inlineDetails = "details[data-collapse=location]";
    const inlineSummary = "details[data-collapse=location] > summary";
    await cdp.js(`
      const back = document.querySelector('.sheet-backdrop');
      if (back) { back.click(); }
      const details = document.querySelector('${inlineDetails}');
      if (details) details.removeAttribute('open');
      return true;
    `);
    await sleep(300);
    await cdp.clickCentre(inlineSummary);
    await sleep(400);
    const inline = await cdp.js(`
      const details = document.querySelector('${inlineDetails}');
      const summary = details ? details.querySelector(':scope > summary') : null;
      const body = details ? details.querySelector('.collapse-body.infobar-body') : null;
      return {
        selector: '${inlineDetails}',
        control: '${inlineSummary}',
        open: !!(details && details.hasAttribute('open')),
        ariaExpanded: summary ? summary.getAttribute('aria-expanded') : null,
        bodyInPage: !!(body && body.isConnected),
        sheetBackdrop: !!document.querySelector('.sheet-backdrop'),
      };
    `);
    inline.name = "khối Địa điểm inline — summary";
    report.hits.push(inline);
    if (!inline.open || inline.ariaExpanded !== "true" || !inline.bodyInPage || inline.sheetBackdrop) {
      throw new Error(`case inline Địa điểm thất bại: ${JSON.stringify(inline)}`);
    }
  }

  for (const item of cases) {
    await cdp.js(`
      const back = document.querySelector('.sheet-backdrop');
      if (back) { back.click(); }
      return true;
    `);
    await sleep(300);
    await cdp.clickCentre(item.open);
    await cdp.waitFor("document.querySelector('.sheet-backdrop')", 8000, `${item.name}: sheet mở`);
    await sleep(400);
    const hit = await cdp.js(HIT_PROBE(item.control));
    hit.name = item.name;
    hit.clickListeners = await cdp.listenersOf(item.control);
    report.hits.push(hit);

    // cú chạm THẬT vào giữa điều khiển: sheet có đóng không?
    const before = await cdp.js("return !!document.querySelector('.sheet-backdrop');");
    await cdp.js("window.__probe.preventDefault = []; window.__probe.click = []; window.__probe.touchmove = 0; return true;");
    await cdp.clickCentre(item.control, args.jitter);
    await sleep(500);
    const after = await cdp.js("return !!document.querySelector('.sheet-backdrop');");
    const probe = await cdp.js("return { preventDefault: window.__probe.preventDefault, touchstart: window.__probe.touchstart, touchmove: window.__probe.touchmove, clicks: window.__probe.click };");
    report.taps.push({
      name: item.name,
      control: item.control,
      sheetOpenBefore: before,
      sheetOpenAfter: after,
      closed: before && !after,
      preventDefaultCalls: probe.preventDefault,
      touchstartEvents: probe.touchstart,
      touchmoveEvents: probe.touchmove,
      clickTargets: probe.clicks,
    });
    await cdp.js("const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); return true;");
    await sleep(250);

    // ---- cơ chế: cú chạm bắt đầu TRÊN nút đóng rồi xê dịch xuống vài px ----
    await cdp.clickCentre(item.open);
    await cdp.waitFor("document.querySelector('.sheet-backdrop')", 8000, `${item.name}: mở lại để đo cơ chế`);
    await sleep(300);
    const sequence = await cdp.js(TOUCH_SEQUENCE(item.control, args.jitter));
    sequence.name = item.name;
    report.touchSequences.push(sequence);
    await cdp.js("const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); return true;");
    await sleep(250);
  }

  // ---- bước 2: ảnh thanh trên (sáng/tối, ở đầu trang và khi đã cuộn) ----
  const shots = [];
  // Clip của CDP tính theo toạ độ TÀI LIỆU, nên phải cộng `scrollY` — nếu không, ở trạng
  // thái đã cuộn clip sẽ nằm ngoài khung nhìn và ảnh trả về trống.
  const barClip = () => cdp.js(`
    const r = document.querySelector('.infobar').getBoundingClientRect();
    return { x: 0, y: window.scrollY + r.top, width: ${WIDTH}, height: Math.ceil(r.height) };
  `);
  const scrollState = () => cdp.js(`
    const bar = document.querySelector('.infobar').getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.infobar'));
    return { windowScrollY: Math.round(window.scrollY), barTop: Math.round(bar.top),
             barBottom: Math.round(bar.bottom), position: cs.position, top: cs.top,
             scrollHeight: document.scrollingElement.scrollHeight,
             innerHeight: window.innerHeight, stickyAtTop: Math.abs(bar.top) < 2 };
  `);

  for (const theme of ["light", "dark"]) {
    await cdp.js(`window.localStorage.setItem("pickleball-go-nogo.theme.v1", ${JSON.stringify(theme)});`);
    await cdp.send("Page.reload");
    await cdp.waitFor("document.querySelector('.infobar')", 15000, `render lại (${theme})`);
    await sleep(1200);
    await cdp.js("window.scrollTo(0, 0); return true;");
    await sleep(200);
    const restScroll = await scrollState();
    shots.push(await cdp.screenshot(join(args.out, `infobar-${theme}-rest.png`), await barClip()));
    shots.push(await cdp.screenshot(join(args.out, `viewport-${theme}-rest.png`)));
    await cdp.js("window.scrollTo(0, 900); return true;");
    await sleep(500);
    const afterScroll = await scrollState();
    shots.push(await cdp.screenshot(join(args.out, `infobar-${theme}-scrolled.png`), await barClip()));
    shots.push(await cdp.screenshot(join(args.out, `viewport-${theme}-scrolled.png`)));
    report.scrollStates.push({ theme, rest: restScroll, scrolled: afterScroll });
    // Chữ trong thanh có bị làm nhạt không? (opacity/filter/mix-blend-mode + chuỗi tổ tiên)
    const text = await cdp.js(`
      const probe = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true };
        const own = getComputedStyle(el);
        const chain = [];
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const cs = getComputedStyle(n);
          chain.push({
            node: n.tagName.toLowerCase() + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\\s+/).join(".") : ""),
            opacity: cs.opacity, filter: cs.filter, mixBlendMode: cs.mixBlendMode,
            backdropFilter: cs.backdropFilter, background: cs.backgroundColor, zIndex: cs.zIndex,
          });
        }
        return { sel, text: el.textContent, color: own.color, opacity: own.opacity, chain };
      };
      return { name: probe('.infobar-loc-name'), time: probe('.infobar-time-value'), coords: probe('.infobar-coords') };
    `);
    const bg = await cdp.js(`
      const cs = getComputedStyle(document.querySelector('.infobar'));
      return { background: cs.backgroundColor, backdropFilter: cs.backdropFilter,
               webkitBackdropFilter: cs.webkitBackdropFilter, boxShadow: cs.boxShadow,
               borderBottom: cs.borderBottomColor + " " + cs.borderBottomWidth,
               theme: document.documentElement.getAttribute('data-theme') };
    `);
    report.steps.push({ theme, barComputed: bg, clip: barClip, text });
  }
  report.screenshots = shots;

  console.log(JSON.stringify(report, null, 2));

  ws.close();
  chrome.kill("SIGKILL");
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("LỖI:", err.message);
  process.exit(1);
});
