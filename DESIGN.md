# DESIGN.md — quyết định thiết kế

## 1. Chọn stack

| Lựa chọn | Lý do |
| --- | --- |
| **Vite + TypeScript** | Build ra HTML/CSS/JS tĩnh, không backend; type-check bắt lỗi sớm; dev server nhanh. Không dùng framework UI vì app chỉ có một màn hình, một luồng dữ liệu — thêm React/Vue chỉ tăng bundle và khó kiểm soát giao diện "không giống template". |
| **Vanilla DOM render từ state** | Toàn bộ giao diện là hàm của `AppState`. Một chiều, dễ test, không có state ẩn. Đổi giờ/hướng sân/đèn chỉ tính lại cục bộ, không gọi mạng lại. |
| **Vitest** | Cùng hệ sinh thái Vite, chạy nhanh, test hàm thuần (chấm điểm, thời gian, mặt trời) và test token CSS bằng `readFileSync`. |
| **Lucide (SVG icon)** | Bộ icon thật, nét mảnh 1.9px hợp nhãn thị giác, tree-shakeable nên bundle chỉ tăng ~vài KB. Không dùng emoji làm icon. |
| **Không thư viện i18n ngoài** | Chỉ 3 ngôn ngữ, cần định dạng ngày/số theo locale và đảm bảo không sót chuỗi. Một từ điển phẳng + test so khớp khoá giữa các ngôn ngữ là đủ và minh bạch. |
| **Không thư viện ngày giờ** | `Intl.DateTimeFormat` với `timeZone: "Europe/Berlin"` xử lý DST chính xác, tránh thêm phụ thuộc. Vị trí mặt trời dùng công thức NOAA thuần. |

## 2. Hệ design token (`src/styles.css`)

Mọi giá trị thị giác đi qua custom property trong `:root` (light) và hai đường dark
(`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` và `:root[data-theme="dark"]`).
Ngoài ba khối khai báo đó, `styles.css` không còn literal màu, `font-size` lẻ hay
`padding`/`margin`/`gap` ngoài thang 4px (có test `src/design-tokens.test.mjs` canh).

### Thang chữ — 8 bậc

| Token | Giá trị | Dùng cho |
| --- | --- | --- |
| `--fs-display` | `56px` | Điểm 0–100 trong vòng |
| `--fs-2xl` | `22px` | Tiêu đề bottom sheet |
| `--fs-xl` | `19px` | Tiêu đề mục, badge dải kết luận |
| `--fs-lg` | `16px` | Chữ nội dung chính, ô nhập |
| `--fs-md` | `15px` | Nhãn yếu tố, nhãn nút, số tác động |
| `--fs-sm` | `13px` | Phụ đề mục, banner, meta |
| `--fs-xs` | `12px` | Nhãn phụ, giá trị yếu tố, hint |
| `--fs-2xs` | `11px` | Nhãn in hoa (uppercase) rất ngắn |

Kèm `--lh-tight: 1.2`, `--lh-normal: 1.5`, `--tracking-caps: 0.05em`. Các cỡ lẻ cũ
(14.5 / 13.5 / 12.5 / 11.5px) đã gom về bậc gần nhất; thang mới **đúng 8 bậc**, thay cho câu
"tối đa 5 cỡ chữ" ở bản trước.

### Nhịp khoảng cách — lưới 4px

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` ·
`--space-5: 20px` · `--space-6: 24px` · `--space-7: 32px` · `--space-8: 40px`.
`--gutter: var(--space-4)` (16px) cho lề ngang của khung app.

### Bán kính

`--radius-xs: 8px` · `--radius-sm: 10px` · `--radius-md: 16px` · `--radius-lg: 22px` ·
`--radius-pill: 999px`. Các `999px`/`16px`/`10px` rải rác đã được thay hết.

### Độ nổi (elevation)

| Token | Light | Dark | Dùng cho |
| --- | --- | --- | --- |
| `--elev-1` | `0 1px 0 rgba(23,26,23,.04), 0 1px 2px rgba(23,26,23,.06)` | `0 1px 0 rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.4)` | Hàng yếu tố đang mở, segment đang chọn |
| `--elev-2` | `0 1px 0 rgba(23,26,23,.04), 0 18px 36px -28px rgba(23,26,23,.5)` | `0 1px 0 rgba(0,0,0,.3), 0 24px 45px -30px rgba(0,0,0,.9)` | App bar, action bar (dính, nổi trên nội dung) |
| `--elev-3` | `0 24px 64px -24px rgba(23,26,23,.55)` | `0 24px 64px -24px rgba(0,0,0,.9)` | Bottom sheet (modal trên backdrop) |

`--shadow` đơn lẻ đã bị bỏ. Sheet là lớp modal trên cùng nên dùng `--elev-3`; app bar/action bar
là thanh dính nổi vừa nên dùng `--elev-2`.

### Màu ngữ nghĩa

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#f4f1ea` | `#10130f` |
| `--surface` | `#fffdf8` | `#1a201b` |
| `--surface-2` | `#ece8de` | `#232a23` |
| `--text` | `#171a17` | `#eceee8` |
| `--muted` | `#565d53` | `#a9b1a5` |
| `--faint` | `#687065` | `#8a9287` |
| `--border` | `#ded9cd` | `#313a31` |
| `--border-strong` | `#c7c1b2` | `#465046` |
| `--good` / `--good-soft` | `#1f6b4a` / `#dcefe3` | `#5fbf8d` / `#17301f` |
| `--maybe` / `--maybe-soft` | `#90530f` / `#f6e7d0` | `#e0a24a` / `#33260f` |
| `--bad` / `--bad-soft` | `#a2352a` / `#f5ddd8` | `#e0806f` / `#3a1d18` |
| `--info` / `--info-soft` | `#2f5d7c` / `#ddeaf3` | `#79b0d4` / `#16262f` |
| `--backdrop` | `rgba(10,12,10,.45)` | `rgba(0,0,0,.6)` |
| `--on-good` | `#ffffff` | `#06170e` |
| `--knob` | `#ffffff` | `#f4f1ea` |

Nền **giấy ấm**, mực **xanh rêu**, **xanh sân** (`--good`), **hổ phách đất** (`--maybe`),
**đỏ gạch** (`--bad`). Không gradient trang trí, không neon, không tím. Giữ đúng bảng màu bản
trước, chỉ tinh chỉnh cho đủ tương phản.

Cả hai theme khai `color-scheme` (`light` / `dark`) để control và scrollbar hệ thống khớp.

**Tương phản đo bằng công thức WCAG** (`(L1+0.05)/(L2+0.05)`), tất cả ≥ 4.5:1:

| Cặp | Light | Dark |
| --- | --- | --- |
| `--text` trên `--bg` | 15.56 | 16.01 |
| `--text` trên `--surface` | 17.26 | 14.18 |
| `--muted` trên `--bg` | 6.03 | 8.48 |
| `--muted` trên `--surface` | 6.69 | 7.52 |
| `--faint` trên `--bg` | 4.55 | 5.83 |
| `--faint` trên `--surface` | 5.05 | 5.17 |
| `--good` trên `--good-soft` | 5.37 | 6.30 |
| `--maybe` trên `--maybe-soft` | 5.03 | 6.62 |
| `--bad` trên `--bad-soft` | 5.27 | 5.47 |
| `--info` trên `--info-soft` | 5.76 | 6.64 |
| `--on-good` trên `--good` | 6.44 | 8.20 |

Thanh tác động là đồ hoạ (không phải chữ) nhưng vẫn vượt 5:1 ở cả hai theme.

### Chuyển động

`--dur-fast: 120ms` · `--dur-base: 200ms` · `--dur-slow: 320ms`;
`--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)` · `--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)`.

## 3. Typography

- **Sans hệ thống** (`-apple-system`, `SF Pro Text`, …) cho toàn bộ chữ: đúng cảm giác native
  trên iPhone, không tải font ngoài, không giật khi render.
- **Monospace** (`ui-monospace`, `SF Mono`, …) cho **mọi con số đo lường**: điểm, toạ độ, nhiệt độ,
  gió, thời gian. Số dùng `font-variant-numeric: tabular-nums` để không nhảy cột khi giá trị đổi.
- Thang bậc có chủ đích (8 bậc ở mục 2): điểm 56px (display) → tiêu đề mục 19px → nhãn 15px →
  giá trị 12px → nhãn phụ 11–12px.
- Chữ hoa nhỏ (uppercase + `--tracking-caps`) chỉ dành cho nhãn siêu ngắn (`ĐIỂM ĐIỀU KIỆN`,
  `NGƯỠNG LÝ TƯỞNG`) để tạo phân tầng mà không cần đổi font.

## 4. Layout & phân cấp màn hình kết luận

- Khung một cột, rộng tối đa 430px, căn giữa; `viewport-fit=cover` + `env(safe-area-inset-*)`
  cho tai thỏ và thanh home của iPhone.
- App bar dính trên cùng luôn cho biết **đang tính cho địa điểm nào** (tên + toạ độ) và **giờ nào**
  (giờ địa phương + nhãn `UTC+02:00`).
- **Điểm 0–100 là mỏ neo thị giác**: phần tử lớn nhất màn hình (`--fs-display` 56px, mono,
  `tabular-nums`). Vòng điểm giữ SVG; màu vòng đổi theo dải (`--good` / `--maybe` / `--bad`),
  con số đặt giữa bằng HTML để kiểm soát font và tương phản.
- **Badge dải kết luận** (`Nên đi` / `Cân nhắc` / `Không nên`) nằm sát điểm, là phần tử **đậm/đọc
  nhanh thứ hai** (`--fs-xl` 19px, `font-weight: 700`, màu đậm trên nền nhạt tương ứng).
- **Danh sách yếu tố quét nhanh được**: mỗi hàng gấp (`<details>` chưa mở) cao ~58px (≤ 64px),
  một lưới 4 cột thẳng hàng: icon yếu tố · tên yếu tố · giá trị kèm đơn vị · mức tác động.
  Giá trị và số tác động canh phải, dùng `tabular-nums` nên không nhảy khi số đổi.
- **Giải thích sâu vẫn nằm sau một lần chạm**: mở `<details>` giữ nguyên thông tin cũ (câu giải
  thích, ngưỡng lý tưởng, trọng số tối đa, đóng góp) — chỉ trình bày lại bằng token, không bỏ bớt,
  không thêm câu chữ rỗng.
- Sắp xếp theo `|impact|` giảm dần; **cổng an toàn (gates)** hiển thị ngay trên danh sách.
- Thứ tự thị giác: điểm → dải → cổng an toàn → lập luận → điều kiện thô → giả định → nguồn.
- Không dùng: 3 card bo tròn giống hệt nhau, glassmorphism vô cớ (chỉ blur nhẹ ở header dính),
  gradient trang trí, hiệu ứng thừa, căn giữa mọi thứ.
- Mọi nút/ô nhập cao ≥ 44px (có test tự động ở 390px). Bottom sheet mở một tay, nút đóng 44px.

## 5. Mã hoá tác động

- Hàm thuần `src/ui/impact.ts` → `impactBar(impact, maxWeight)` trả `{ side, widthPct }`:
  `widthPct = clamp(|impact| / maxWeight × 100, 0, 100)`, làm tròn 1 chữ số; `impact === 0` →
  `side: "none"`, `maxWeight <= 0` → `widthPct: 0` (vẫn giữ dấu).
- Mỗi hàng yếu tố vẽ **thanh mảnh 3px**, `width: X%` với X là giá trị THẬT tính từ dữ liệu, màu
  `--good` / `--bad` / `--faint`. Không dùng biểu đồ nhiều màu.
- Kèm **số điểm có dấu** (`+3,2` / `−1,5`) bằng mono, `tabular-nums`. Icon mũi tên cũ đã bỏ vì
  thanh + dấu số đã đọc được chiều tác động.

## 6. Theme & không nháy khi tải

- Bộ chọn `Theo máy / Sáng / Tối` nằm trong bottom sheet (khoá i18n `theme.title`, `theme.system`,
  `theme.light`, `theme.dark`), giữ nguyên vị trí.
- Logic thuần tách ra `src/ui/theme.ts`: `THEME_STORAGE_KEY`, `ThemeChoice`, `isThemeChoice`,
  `resolveTheme`, `themeAttribute`. `src/ui/state.ts` re-export `ThemeChoice` để không phá import cũ;
  `src/main.ts` dùng lại module này. Khoá localStorage giữ nguyên
  `pickleball-go-nogo.theme.v1` — đổi khoá là mất lựa chọn của người dùng đang cài.
- **Chống nháy:** một `<script>` inline rất ngắn trong `<head>` của `index.html`, chạy TRƯỚC
  `<script type="module">`, đọc cùng khoá và set `document.documentElement.dataset.theme` trước
  lần vẽ đầu tiên (bọc `try/catch`; giá trị lạ/None → không set gì = theo máy). Chuỗi khoá trong
  inline script trùng khít `THEME_STORAGE_KEY` (có test canh).

## 7. Chuyển động

- Khi có kết quả **lần đầu**, khối điểm và từng hàng yếu tố vào bằng `opacity` + `transform`
  (`translateY`) qua keyframe `reveal-up`; **không** animate `height`/`top`/`left`/`margin`, và
  đã bỏ hẳn `transition: stroke-dashoffset` ở `.ring-progress`.
- Mỗi phần tử chạy `--dur-base` (200ms, ≤ 220ms). So le hàng yếu tố bằng
  `animation-delay: calc(var(--reveal-index) * 24ms)` với chỉ số `min(index, 8)`; tổng tối đa
  ~200 + 8×24 = 392ms (≤ ~450ms).
- Cờ `revealed` module-level trong `render.ts` đảm bảo chỉ chạy ở lần render đầu tiên của một kết
  quả; mở sheet / mở details / đổi giờ không phát lại.
- Spin của nút refresh giữ nguyên; theme đổi được ease nhẹ bằng `--dur-slow` + `--ease-in-out`.
- `@media (prefers-reduced-motion: reduce)` tắt `animation` cho `.reveal` (khối điểm + danh sách
  yếu tố), `.factor`, `.ring-progress`, `.spin`, `.skeleton`, sheet/backdrop và tắt mọi `transition`;
  trạng thái cuối (`opacity: 1; transform: none`) áp ngay, không để sót opacity 0.

## 8. Ngoại lệ với quy tắc token

Không còn ngoại lệ về **màu**, **font-size** hay **padding/margin/gap** — test
`src/design-tokens.test.mjs` canh cả ba. Các giá trị px còn lại là **kích thước/định vị**, không
thuộc ba nhóm trên và cố ý giữ thô vì gắn với hợp đồng cứng:

- Vùng chạm `44×44px`, chiều cao tối thiểu `44px`/`46px`, `min-height: 56px` của hàng yếu tố và
  toggle — ràng buộc Apple HIG, test `pwa.test.mjs` canh.
- Kích thước vòng điểm/skeleton (`206px`), đường kính nét SVG (`stroke-width: 10`), bề dày thanh
  tác động (`3px`), track (`52px`).
- `border-radius: 50%` cho hình tròn thật (nút đóng, knob, chấm bullet) — `--radius-pill` là cho
  viên thuốc, `50%` mới đúng hình tròn.
- `max-width: 430px`, `min-width: 56px`, `top/right/left` định vị, `letter-spacing` tiêu đề.

## 9. Mô hình chấm điểm

- **Gốc 50**, mỗi yếu tố một `impact` có dấu (dương = có lợi, âm = bất lợi). Vì `score = clamp(50 + Σ
  impact)` nên **Σ impact luôn bằng `score − 50`**: con số và lời giải thích không bao giờ lệch nhau.
- Hàm `piecewise` tuyến tính, có ngưỡng và trọng số rõ cho từng yếu tố; cùng input cho cùng output
  (hàm thuần, đã test).
- Ngoài tổng điểm còn có **cổng an toàn** (trời tối không đèn, mưa ≥ 2.5 mm/h, gió giật ≥ 60 km/h,
  nóng ≥ 35 °C, lạnh ≤ −5 °C, mưa 24 h ≥ 12 mm) giới hạn điểm tối đa. Khi cổng kích hoạt, một factor
  `playability` ghi lại đúng số điểm bị lấy đi, nên tổng vẫn khớp. Lý do: có điều kiện mà mọi yếu tố
  khác đẹp cũng vô nghĩa (trời tối thì không thấy bóng), cộng tuyến tính thuần không diễn tả được.
- Vị trí mặt trời tự tính (NOAA) để suy luận chói: phạt khi mặt trời **thấp và gần trục dọc sân**
  (`courtBearing`), giảm nhẹ khi nhiều mây.
- Mưa 24 h trước = tổng `precipitation` của 24 giờ liền trước mốc chọn (lấy thêm `past_days=2`),
  dùng làm proxy cho "sân còn ướt"; nếu thiếu giờ thì ghi rõ là thiếu.
- Ngưỡng xếp loại giữ nguyên đề bài: `≥70`, `40–69`, `<40`.

## 10. Ngôn ngữ

`vi` là gốc, `de`/`en` bắt buộc đủ khoá (có unit test so khớp). Ngày/giờ/số định dạng bằng
`Intl` theo `vi-VN`/`de-DE`/`en-GB`. Lựa chọn ngôn ngữ lưu trong `localStorage`. Chuỗi verdict trong
`window.__verdict` giữ nguyên tiếng Việt theo đúng hợp đồng, còn giao diện hiển thị bản dịch.

## 11. Trạng thái & độ tin cậy

Loading có skeleton, lỗi mạng có nút thử lại, dữ liệu lấy từ cache được dán nhãn **"Dữ liệu cũ"**
kèm thời điểm lấy. Thiếu trường nào thì nêu tên trường đó và hạ `confidence`; không suy diễn giá trị.
