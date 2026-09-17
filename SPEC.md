# SPEC.md — Hiến pháp của repo GoPickleballMobi

> File này là **tiêu chí nghiệm thu**, không phải gợi ý. Worker chỉ được nạp ~2000 ký tự đầu vào prompt;
> phần còn lại phải tự đọc. Thứ quan trọng nhất nằm ở đầu. Đổi file này = đổi cách làm việc của mọi worker
> trong repo — sửa có chủ đích, có commit rõ ràng.

## 0. Ràng buộc bắt buộc (đọc trước khi viết 1 dòng code)

- **Lệnh kiểm chứng duy nhất (Quality Gate):** `NODE_OPTIONS=--max-old-space-size=1024 npm ci && npm test && npm run build`
- **Không bịa dữ liệu.** Mọi giá trị hiển thị phải đến từ response API hoặc tính toán tất định trong `src/`.
- **Không chốt cứng chuỗi hiển thị** ngoài từ điển i18n (`src/i18n/{vi,de,en}.ts`) — cả 3 ngôn ngữ phải đủ.
- **Không thêm backend, không thêm framework UI, không đổi luật tính điểm mà không cập nhật test.**
- **Giao diện phải "sạch" như app iPhone thật:** không màu mè, không kiểu "AI slop" (thẻ gradient chung chung).

## 1. Repo này là gì

**GoPickleballMobi** — web app mobile-first (PWA) trả lời một câu duy nhất: *"Lúc này có nên ra sân pickleball
ở sân này không?"*. Người dùng mở app trên iPhone, thấy **điểm 0–100**, **danh sách lập luận theo từng yếu tố**,
và **các cổng an toàn (safety gates)**. Sân mặc định: Pickleball-Plätze, Offenthaler Straße, Dietzenbach
(`49.9960846, 8.7605459`, múi giờ `Europe/Berlin`). Người dùng đổi được vị trí/giờ mục tiêu; mọi thứ còn lại
là tất định và kiểm chứng được.

Ba dải kết luận (bands) là hợp đồng cố định: `Nên đi` (điểm ≥ 70) · `Cân nhắc` (40–69) · `Không nên` (< 40).
App còn phơi hợp đồng máy đọc `window.__verdict` (`score`, `verdict`, `localTime`, `utcOffsetMinutes`,
`location`, `factors[]`, `dataSource`, `error`, `confidence`, `missing`, `gates`, `stale`) — giữ nguyên shape này.

## 2. Ngăn xếp & lệnh chuẩn

- Ngôn ngữ / framework: **TypeScript + Vite**, không framework UI (DOM thuần do `src/ui/render.ts` dựng).
- Cài đặt phụ thuộc: `NODE_OPTIONS=--max-old-space-size=1024 npm ci`
- **Lệnh kiểm chứng bắt buộc (Quality Gate mặc định):** `NODE_OPTIONS=--max-old-space-size=1024 npm ci && npm test && npm run build`
- Kiểm thử: `npm test` (Vitest, `src/**/*.test.ts`, environment `node`).
- Build tĩnh ra `dist/`: `npm run build` = `tsc --noEmit && vite build` (base `./` để chạy được từ mọi đường dẫn tĩnh).
- Chạy thử: `npm run dev` · xem bản build: `npm run preview`.
- Node ≥ 18. Không thêm dependency mới nếu chưa hỏi.

## 3. Chuẩn code (chỉ ghi thứ KHÁC chuẩn thông thường)

- Cấu trúc thư mục: `src/scoring.ts` (luật điểm + `classify`), `src/sun.ts` (vị trí mặt trời), `src/time.ts`
  (múi giờ `Europe/Berlin`, `ceilToHour`, `formatLocalISO`, offset), `src/api.ts` (Open-Meteo forecast/air/geocoding),
  `src/cache.ts` (đọc gần nhất, cờ `stale`), `src/evaluate.ts` (ghép thành `Evaluation`), `src/types.ts`,
  `src/i18n/*`, `src/ui/{render,state,icons}.ts`, `src/main.ts` (điều phối + `window.__verdict`).
- Giữ các module tất định **thuần**: `scoring` / `sun` / `time` không đọc clock, không gọi mạng, không đọc DOM.
- Mỗi luật điểm/yếu tố mới ⇒ **thêm test tương ứng** trong `src/scoring.test.ts` (hoặc file test cùng module).
- Đặt tên: file/thư mục `kebab-case` hoặc tên module ngắn (`scoring`, `sun`); hàm `camelCase`; type `PascalCase`;
  key i18n `nhóm.tên` (`verdict.go`, `footer.timezone`).
- Ngôn ngữ giao diện (i18n): **vi (mặc định) · de · en** — đủ key ở cả 3 từ điển, không fallback chuỗi thô.
- Định dạng ngày/giờ/tiền tệ: giờ luôn theo `Europe/Berlin` qua `src/time.ts` (`Intl` với `timeZone`),
  không tự cộng trừ offset bằng tay; số theo locale của ngôn ngữ đang chọn.
- TypeScript `strict`, `noUnusedLocals`, `noUnusedParameters` — không dùng `any` để lách.

## 4. Tài sản & giao diện (chuẩn UX của chủ dự án — BẮT BUỘC)

- **Cảm giác:** phải như **app iPhone thật (native)**, chuyên nghiệp, sống động, hấp dẫn; thao tác **một tay** dễ dàng.
- **Không** màu mè ("không màu mè") và **không** được trông như "AI slop": cấm kiểu thẻ gradient chung chung,
  cấm emoji trang trí, cấm bố cục mẫu "hero + 3 card".
- Viewport tham chiếu **390×844**; tôn trọng **safe-area insets** (`env(safe-area-inset-*)`) trên tai thỏ và home bar.
- Vùng chạm **≥ 44×44 px**; chữ tối thiểu 15–16 px cho nội dung chính.
- **Toàn màn hình thật, standalone** (không còn chrome Safari) khi thêm vào màn hình chính iPhone (manifest + `display: standalone`).
- **Sáng + tối** đầy đủ (theo `prefers-color-scheme`, có nút chọn theme); màu phải đủ tương phản ở cả hai chế độ.
- Icon: tra **tên chính xác qua Iconify API** (Lucide / Phosphor / Tabler) — không đoán tên, không vẽ tay SVG lệch bộ.
- Illustration: unDraw / Storyset. Ảnh: Unsplash / Pexels. Không bịa asset.
- Font, bảng màu, khoảng cách: bám `DESIGN.md` ở gốc repo; thay đổi design token phải sửa `DESIGN.md` cùng commit.

## 5. Điều cấm ở repo này

- Không thêm backend / server API / database / hàm serverless — app chỉ tĩnh + gọi API công khai.
- Không đổi luật tính điểm, ngưỡng band, hay ý nghĩa yếu tố mà **không** cập nhật test tương ứng.
- Không chốt cứng chuỗi hiển thị ngoài `src/i18n/{vi,de,en}.ts` (kể cả aria-label, title, nút, thông báo lỗi).
- Không render giá trị mà không API nào hoặc phép tính nào sinh ra (số mẫu, "dữ liệu demo", placeholder bịa).
- Không thêm thư viện ngoài khi chưa hỏi; không đổi `package.json` ngoài phạm vi card.
- Không copy `prompt.md` của rig cũ vào repo này; không sửa `/opt/data/fleet/scripts/*` từ trong repo.

## 6. Định nghĩa "XONG" (ngoài test xanh)

- `npm test && npm run build` **xanh** trên bản clone sạch (đúng lệnh ở mục 0), `dist/` sinh ra được.
- Cài được lên màn hình chính iPhone và chạy **standalone**; **build marker trong app khớp bundle đang phục vụ**
  (marker hiển thị/`window`-exposed phải đổi theo bản build, không được là hằng số đứng yên qua các bản).
- Ba dải `Nên đi` / `Cân nhắc` / `Không nên` render đúng **kèm danh sách lập luận** theo yếu tố và các cổng an toàn.
- `vi` / `de` / `en` đủ key, đổi ngôn ngữ không lộ chuỗi tiếng Việt hay tiếng Anh sót lại.
- Không có giá trị nào trên UI mà không truy được về response API hoặc phép tính trong `src/`.
- Đã soi ở **390×844** cả chế độ sáng và tối, đúng "không màu mè" và không "AI slop" (mục 4).
