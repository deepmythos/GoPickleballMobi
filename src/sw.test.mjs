import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(here, "..", "scripts", "sw.template.js");
const SOURCE = readFileSync(TEMPLATE, "utf8")
  .replaceAll("__CACHE_VERSION__", "test")
  .replaceAll("__PRECACHE__", "[]");

/**
 * Nạp service worker THẬT trong sandbox stub. Chạy đúng handler `fetch` như trình duyệt gọi,
 * không chỉ grep chuỗi trong file.
 */
function loadServiceWorker({ cacheHit = true } = {}) {
  const handlers = {};
  const matchCalls = [];
  const fetchCalls = [];
  const putCalls = [];
  const cached = new Response("cached-shell", { status: 200 });
  const self = {
    location: { origin: "https://app.test" },
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
  };
  const caches = {
    match(request, options) {
      matchCalls.push({ request, options });
      return Promise.resolve(cacheHit ? cached : undefined);
    },
    open() {
      return Promise.resolve({
        put(request, response) {
          putCalls.push({ request, response });
          return Promise.resolve();
        },
      });
    },
    keys() {
      return Promise.resolve([]);
    },
    delete() {
      return Promise.resolve(true);
    },
  };
  const fetch = (request, options) => {
    fetchCalls.push({ request, options });
    return Promise.resolve(new Response("network", { status: 200 }));
  };
  runInNewContext(SOURCE, { self, caches, fetch, Headers, Request, Response, URL });
  return { handlers, matchCalls, fetchCalls, putCalls, cached };
}

/** Event stub tối thiểu của FetchEvent. */
function fetchEvent(request) {
  let respondWithPromise;
  return {
    request,
    respondWith(promise) {
      respondWithPromise = promise;
    },
    get promise() {
      return respondWithPromise;
    },
  };
}

describe("service worker — payload cùng origin không được rơi vào cache shell", () => {
  it("CASE 1: payload cùng origin (destination rỗng) đi thẳng ra network, không tra cache", () => {
    const { handlers, matchCalls, fetchCalls, putCalls } = loadServiceWorker();
    const request = {
      method: "GET",
      url: "https://app.test/v1/forecast?latitude=1",
      destination: "",
      mode: "cors",
    };
    const event = fetchEvent(request);
    handlers.fetch(event);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].request).toBe(request);
    expect(matchCalls).toHaveLength(0);
    expect(putCalls).toHaveLength(0);
  });

  it("CASE 2: app shell tĩnh (navigate/document) vẫn cache-first với ignoreVary", async () => {
    const { handlers, matchCalls, fetchCalls, cached } = loadServiceWorker();
    const request = {
      method: "GET",
      url: "https://app.test/index.html",
      destination: "document",
      mode: "navigate",
    };
    const event = fetchEvent(request);
    handlers.fetch(event);
    await expect(event.promise).resolves.toBe(cached);
    expect(matchCalls).toHaveLength(1);
    expect(matchCalls[0].options).toEqual({ ignoreVary: true });
    expect(fetchCalls).toHaveLength(0);
  });

  it("CASE 3: cache miss cho app shell tĩnh vẫn ghi lại vào cache (đường GHI thật sự)", async () => {
    const { handlers, matchCalls, fetchCalls, putCalls } = loadServiceWorker({ cacheHit: false });
    const request = {
      method: "GET",
      url: "https://app.test/index.html",
      destination: "document",
      mode: "navigate",
    };
    const event = fetchEvent(request);
    handlers.fetch(event);
    await event.promise;
    // Đường ghi cache là fire-and-forget (blob -> caches.open -> put), cần nhường microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(matchCalls).toHaveLength(1);
    expect(matchCalls[0].options).toEqual({ ignoreVary: true });
    expect(fetchCalls).toHaveLength(1);
    expect(putCalls).toHaveLength(1);
  });
});
