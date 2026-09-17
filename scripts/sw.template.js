// Service worker nguồn cho GoPickleballMobi.
// Hai placeholder (phiên bản cache + danh sách tiền cache) được plugin trong vite.config.ts thay khi build.
// Không tự skipWaiting: bản mới chỉ kích hoạt khi người dùng bấm nút "Tải lại".

const CACHE = "pickleball-go-nogo-shell-__CACHE_VERSION__";
const PRECACHE = __PRECACHE__;
const API_HOSTS = ["api.open-meteo.com", "air-quality-api.open-meteo.com", "geocoding-api.open-meteo.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Payload API: network-first, tuyệt đối không fallback cache. Payload cũ trả về
  // im lặng sẽ bị hiểu là số liệu mới; khi offline request lỗi và app tự hiển thị bản lưu có dán nhãn.
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(request));
    return;
  }

  // Khác origin -> để trình duyệt tự xử lý.
  if (url.origin !== self.location.origin) return;

  // Cùng origin -> cache-first cho app shell.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch((error) => {
          if (request.mode === "navigate") {
            return caches.match("./index.html").then((fallback) => {
              if (fallback) return fallback;
              throw error;
            });
          }
          throw error;
        });
    }),
  );
});
