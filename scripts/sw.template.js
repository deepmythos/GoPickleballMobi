// Service worker nguồn cho GoPickleballMobi.
// Hai placeholder (phiên bản cache + danh sách tiền cache) được plugin trong vite.config.ts thay khi build.
// Không tự skipWaiting: bản mới chỉ kích hoạt khi người dùng bấm nút "Tải lại".

const CACHE = "pickleball-go-nogo-shell-__CACHE_VERSION__";
const PRECACHE = __PRECACHE__;
const API_HOSTS = ["api.open-meteo.com", "air-quality-api.open-meteo.com", "geocoding-api.open-meteo.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // LƯU Ý SỐNG CÒN — tại sao KHÔNG dùng cache.addAll(PRECACHE):
      // Server tĩnh trả MỌI response kèm header "Vary: Origin". Lúc install, precache tải asset
      // bằng request KHÔNG có header Origin, nhưng trang tải asset qua <script crossorigin> /
      // <link crossorigin> (chế độ CORS, CÓ Origin). Với Vary: Origin, caches.match(request)
      // mặc định KHÔNG khớp (cache miss) -> rơi xuống network -> offline thì ERR_FAILED, màn hình trắng.
      // Vì vậy phải GHI cache với header Vary đã bị bỏ để hit bất kể request có Origin hay không;
      // điều này đặc biệt cần cho iPhone Safari (engine chưa chắc hỗ trợ ignoreVary).
      for (const entry of PRECACHE) {
        const res = await fetch(entry, { cache: "reload" });
        if (!res.ok) throw new Error("precache thất bại: " + entry);
        const headers = new Headers(res.headers);
        headers.delete("vary");
        await cache.put(
          new Request(new URL(entry, self.location).href),
          new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers }),
        );
      }
    }),
  );
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
  // Mọi lần tra cache đều phải { ignoreVary: true } vì asset được tải ở chế độ CORS (có Origin)
  // trong khi precache ghi không có Origin; thiếu ignoreVary sẽ cache miss và hỏng khi offline.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            const headers = new Headers(copy.headers);
            // Bỏ "Vary: Origin" trước khi cache (cùng lý do như precache trong install):
            // request crossorigin có Origin còn request ghi cache thì không -> Vary gây cache miss.
            headers.delete("vary");
            copy
              .blob()
              .then((blob) =>
                caches.open(CACHE).then((cache) =>
                  cache.put(
                    request,
                    new Response(blob, { status: copy.status, statusText: copy.statusText, headers }),
                  ),
                ),
              )
              .catch(() => {});
          }
          return response;
        })
        .catch((error) => {
          if (request.mode === "navigate") {
            return caches.match("./index.html", { ignoreVary: true }).then((fallback) => {
              if (fallback) return fallback;
              throw error;
            });
          }
          throw error;
        });
    }),
  );
});
