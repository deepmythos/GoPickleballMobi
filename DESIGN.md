# DESIGN.md — quyết định thiết kế

## 1. Chọn stack

| Lựa chọn | Lý do |
| --- | --- |
| **Vite + TypeScript** | Build ra HTML/CSS/JS tĩnh, không backend; type-check bắt lỗi sớm; dev server nhanh. Không dùng framework UI vì app chỉ có một màn hình, một luồng dữ liệu — thêm React/Vue chỉ tăng bundle và khó kiểm soát giao diện "không giống template". |
| **Vanilla DOM render từ state** | Toàn bộ giao diện là hàm của `AppState`. Một chiều, dễ test, không có state ẩn. Đổi giờ/hướng sân/đèn chỉ tính lại cục bộ, không gọi mạng lại. |
| **Vitest** | Cùng hệ sinh thái Vite, chạy nhanh, test hàm thuần (chấm điểm, thời gian, mặt trời). |
| **Lucide (SVG icon)** | Bộ icon thật, nét mảnh 1.9px hợp nhãn thị giác, tree-shakeable nên bundle chỉ tăng ~vài KB. Không dùng emoji làm icon. |
| **Không thư viện i18n ngoài** | Chỉ 3 ngôn ngữ, cần định dạng ngày/số theo locale và đảm bảo không sót chuỗi. Một từ điển phẳng + test so khớp khoá giữa các ngôn ngữ là đủ và minh bạch. |
| **Không thư viện ngày giờ** | `Intl.DateTimeFormat` với `timeZone: "Europe/Berlin"` xử lý DST chính xác, tránh thêm phụ thuộc. Vị trí mặt trời dùng công thức NOAA thuần. |

## 2. Typography

- **Sans hệ thống** (`-apple-system`, `SF Pro Text`, …) cho toàn bộ chữ: đúng cảm giác native
  trên iPhone, không tải font ngoài, không giật khi render.
- **Monospace** (`ui-monospace`, `SF Mono`, …) cho **mọi con số đo lường**: điểm, toạ độ, nhiệt độ,
  gió, thời gian. Số dùng `font-variant-numeric: tabular-nums` để không nhảy cột khi giá trị đổi.
- Thang bậc có chủ đích: điểm 56px (display) → tiêu đề mục 17px → nhãn 14.5px → giá trị 13px →
  nhãn phụ 11–12px. Không dùng quá 5 cỡ chữ.
- Chữ hoa nhỏ (uppercase + letter-spacing) chỉ dành cho nhãn siêu ngắn (`ĐIỂM ĐIỀU KIỆN`,
  `NGƯỠNG LÝ TƯỞNG`) để tạo phân tầng mà không cần đổi font.

## 3. Palette

Lấy cảm hứng từ sân ngoài trời: nền **giấy ấm** (`#f4f1ea`) thay vì trắng tinh hay gradient
tím–indigo, mực **xanh rêu đậm** cho chữ, **xanh sân** (`#1f6b4a`) làm màu chính, **hổ phách đất**
(`#9a5a12`) cho "cân nhắc", **đỏ gạch** (`#a2352a`) cho "không nên".

- Mỗi trạng thái verdict có cặp `màu đậm + nền nhạt` riêng, dùng nhất quán cho badge, vòng điểm,
  chip đóng góp và icon yếu tố.
- Dark mode là bảng biến thể riêng (nền `#10130f`), không chỉ đảo màu: màu ngữ nghĩa được kéo sáng
  (xanh `#5fbf8d`, đỏ `#e0806f`) để giữ tương phản. Đã đo: chữ chính ~16:1, chữ phụ ~8.5:1,
  chip xanh ~6.3:1 — vượt WCAG AA.
- Tông màu chọn theo `prefers-color-scheme`, kèm lựa chọn thủ công trong Cài đặt.

## 4. Layout & tương tác

- Khung một cột, rộng tối đa 430px, căn giữa; `viewport-fit=cover` + `env(safe-area-inset-*)`
  cho tai thỏ và thanh home của iPhone.
- Header dính trên cùng luôn cho biết **đang tính cho địa điểm nào** (tên + toạ độ) và **giờ nào**
  (giờ địa phương + nhãn `UTC+02:00`).
- Thứ tự thị giác: điểm (vòng tròn lớn) → xếp loại → lập luận → điều kiện thô → giả định → nguồn.
  Người dùng nắm câu trả lời trong 2 giây đầu, rồi mới đọc chi tiết.
- Vòng điểm là SVG (không phải ảnh), màu đổi theo xếp loại; con số đặt giữa bằng HTML để kiểm soát
  font và tương phản.
- Lập luận là danh sách `<details>`: hàng gấp cho thấy yếu tố + giá trị + điểm cộng/trừ; mở ra thấy
  ngưỡng lý tưởng, trọng số tối đa và câu giải thích. Dùng `<details>` native nên bàn phím và trình
  đọc màn hình hoạt động sẵn, không cần JS.
- Mọi nút/ô nhập cao ≥ 44px (đã kiểm tra tự động ở 390px). Bảng cài đặt là bottom sheet một tay,
  có nút đóng 44px.
- Không dùng: 3 card bo tròn giống hệt nhau (thay bằng danh sách có đường phân cách và lưới số liệu),
  glassmorphism vô cớ (chỉ blur nhẹ ở header dính), gradient trang trí, hiệu ứng thừa. Chuyển động
  duy nhất có nghĩa là vòng điểm chạy tới giá trị mới, và tôn trọng `prefers-reduced-motion`.

## 5. Mô hình chấm điểm

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

## 6. Ngôn ngữ

`vi` là gốc, `de`/`en` bắt buộc đủ khoá (có unit test so khớp). Ngày/giờ/số định dạng bằng
`Intl` theo `vi-VN`/`de-DE`/`en-GB`. Lựa chọn ngôn ngữ lưu trong `localStorage`. Chuỗi verdict trong
`window.__verdict` giữ nguyên tiếng Việt theo đúng hợp đồng, còn giao diện hiển thị bản dịch.

## 7. Trạng thái & độ tin cậy

Loading có skeleton, lỗi mạng có nút thử lại, dữ liệu lấy từ cache được dán nhãn **"Dữ liệu cũ"**
kèm thời điểm lấy. Thiếu trường nào thì nêu tên trường đó và hạ `confidence`; không suy diễn giá trị.
