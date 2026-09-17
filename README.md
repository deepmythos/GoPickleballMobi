# Pickleball Go/No-Go

Web app mobile-first (iPhone, viewport tham chiếu 390×844) trả lời câu hỏi:
**có nên ra sân pickleball ở địa điểm này, vào giờ này không?** — kèm điểm 0–100 và
chuỗi lập luận giải thích từng yếu tố.

Địa điểm mặc định: **Pickleball-Plätze, Offenthaler Straße, Dietzenbach**
(`49.9960846, 8.7605459`, múi giờ `Europe/Berlin`).

## Chạy nhanh

```bash
npm ci          # cài đúng theo package-lock.json
npm run dev     # dev server (Vite)
npm test        # chạy unit test (Vitest), không cần mạng
npm run build   # type-check + build tĩnh vào dist/
npm run preview # xem thử bản build tại http://localhost:4173
```

Bản build trong `dist/` là **HTML/CSS/JS tĩnh**, không cần backend riêng. Có thể phục vụ bằng
bất kỳ static server nào, ví dụ:

```bash
npx serve dist
```

Dữ liệu được gọi trực tiếp từ trình duyệt tới Open-Meteo (các API này bật CORS), nên không cần
proxy. Nếu deploy dưới một sub-path, `base: "./"` trong `vite.config.ts` đã xử lý đường dẫn tương đối.

## Icon

Bộ icon PWA được sinh tất định từ SVG nguồn bằng script nội bộ (không thêm dependency):

```bash
npm run icons
```

Script `scripts/gen-icons.mjs` đọc `public/icons/icon.svg` và `public/icons/icon-maskable.svg`, rasterize
với supersampling 4×4 rồi ghi PNG thật: `public/icons/icon-192.png`, `public/icons/icon-512.png`,
`public/icons/icon-maskable-512.png` và `public/apple-touch-icon.png`. Chạy nhiều lần cho kết quả byte y hệt.

## Build marker

Mỗi bản build mang một marker nhận diện chính bản đang được phục vụ:

- `id` = `git rev-parse --short=12 HEAD`, cộng hậu tố `-dirty` **chỉ khi** có thay đổi chưa commit
  trên **file đã được theo dõi** (`git status --porcelain --untracked-files=no`). File không được
  theo dõi (`.vercel/`, cache, rác của container CI) **không** tính là bẩn — chúng không nằm trong
  bundle, nên bản deploy sạch không được tự nhận là `-dirty`.
- Không có git (hoặc git lỗi) → marker là `dev`.
- Marker xuất hiện ở `dist/build.json`, `window.__build`, dòng build trong sheet cài đặt, và trong
  tên cache của service worker (`pickleball-go-nogo-shell-<id>`), nên mỗi bản mới có cache mới.

## Kiến trúc

```
index.html            # shell, mount #app
src/
  main.ts             # đọc query param, state, fetch, ghi window.__verdict, wiring sự kiện
  api.ts              # gọi Open-Meteo forecast / air-quality / geocoding
  evaluate.ts         # ghép dữ liệu API + mặt trời + chấm điểm -> Evaluation
  scoring.ts          # hàm chấm điểm tất định 0–100 + factors + "cổng" an toàn
  sun.ts              # vị trí mặt trời (NOAA) và góc so với trục sân
  time.ts             # xử lý Europe/Berlin + DST bằng Intl
  cache.ts            # localStorage: lựa chọn gần nhất + bản dữ liệu gần nhất
  i18n/               # từ điển vi (gốc), de, en + định dạng ngày/số
  ui/
    state.ts          # kiểu AppState / Actions
    render.ts         # render toàn bộ DOM từ state
    icons.ts          # bộ icon Lucide
  styles.css          # design tokens, light + dark, layout mobile-first
```

Luồng dữ liệu một chiều: `main.ts` giữ state → `render.ts` dựng DOM → người dùng tương tác
→ action cập nhật state → render lại. `evaluate.ts` là hàm thuần khiết trên dữ liệu đã tải,
nên đổi giờ/hướng sân/đèn chỉ cần tính lại, không cần gọi mạng lại.

## Nguồn dữ liệu & query param

Ba base URL đọc từ cấu hình và ghi đè được bằng query param (dùng cho kiểm thử):

| Cấu hình          | Query param        | Mặc định                                |
| ----------------- | ------------------ | --------------------------------------- |
| `forecastBase`    | `?forecastBase=`   | `https://api.open-meteo.com`            |
| `airQualityBase`  | `?airQualityBase=` | `https://air-quality-api.open-meteo.com` |
| `geocodingBase`   | `?geocodingBase=`  | `https://geocoding-api.open-meteo.com`  |

Các param khác: `lat`, `lon`, `name`, `at` (`YYYY-MM-DDTHH:mm`), `lang` (`vi|de|en`),
`courtBearing` (0–359), `now` (`YYYY-MM-DDTHH:mm`, tuỳ chọn), `lights` (`1|0`, tuỳ chọn).
Khi có `now`, app dùng nó làm "hiện tại" cho các kiểm tra tương đối; `at` vẫn được tính
miễn là API trả dữ liệu cho mốc đó.

Hourly bắt buộc: `temperature_2m, apparent_temperature, relative_humidity_2m, dew_point_2m,
precipitation, precipitation_probability, rain, weather_code, cloud_cover, visibility,
wind_speed_10m, wind_gusts_10m, uv_index, is_day`. Daily: `sunrise, sunset`.
Air quality: `pm2_5, pm10, european_aqi`. App cũng thêm `past_days=2` để lấy
lượng mưa 24 giờ trước.

## Hợp đồng máy đọc được

Sau khi tính xong (hoặc khi lỗi mạng), app gán `window.__verdict`:

```json
{
  "score": 0,
  "verdict": "Nên đi | Cân nhắc | Không nên",
  "localTime": "YYYY-MM-DDTHH:mm",
  "utcOffsetMinutes": 120,
  "location": { "lat": 0, "lon": 0, "name": "..." },
  "factors": [{ "id": "wind_gust", "value": 14, "unit": "km/h", "impact": -6 }],
  "dataSource": { "forecastBase": "...", "fetchedAt": "ISO-8601" }
}
```

Khi lỗi và không có cache: `score: null`, `verdict: null` và có `error`.
App còn kèm `confidence`, `missing`, `gates`, `stale` để phục vụ chẩn đoán.

## Quy tắc chấm điểm (tóm tắt)

Điểm gốc trung tính là **50**. Mỗi yếu tố cộng/trừ điểm; tổng các `impact` luôn bằng
`score − 50`, nên con số hiển thị luôn khớp với chuỗi lập luận. Các điều kiện không thể chơi
được (trời tối không đèn, mưa rất to, gió giật bão, nắng nóng/rét đậm cực đoan, sân ngập nước)
là các "cổng an toàn" giới hạn điểm, được ghi lại bằng factor `playability`.
Xếp loại cố định: `>= 70` → **Nên đi**, `40–69` → **Cân nhắc**, `< 40` → **Không nên**.
Chi tiết công thức và lý do ở [`DESIGN.md`](./DESIGN.md).

## Không bịa số

App chỉ hiển thị giá trị lấy từ response API hoặc tính từ chúng (vị trí mặt trời, tổng mưa 24 h).
Khi thiếu trường, yếu tố bị bỏ khỏi danh sách chấm, tên trường thiếu hiện trong banner
"Thiếu dữ liệu" và độ tin cậy bị hạ. Không có giá trị mặc định nào được tự điền.

## Kiểm thử

`npm test` chạy Unit test cho: hàm chấm điểm (gồm biên mưa to + gió giật, nắng gắt UV cao,
trời tối, sân ướt sau mưa, thời tiết lý tưởng, thiếu dữ liệu), xử lý múi giờ/DST,
vị trí mặt trời và tính đầy đủ của 3 từ điển i18n.
