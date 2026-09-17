# spec.md — Pickleball Go/No-Go

## 0. Mục tiêu
Web app mobile-first (iPhone Safari, viewport tham chiếu 390×844, có `safe-area-inset`) trả lời:
**có nên đi đánh pickleball ở một địa điểm, vào một giờ cụ thể hay không**, kèm điểm 0–100 và
lập luận giải thích.

## 1. Địa điểm
- Mặc định: `Pickleball-Plätze, Offenthaler Straße, Dietzenbach` — `lat 49.9960846`, `lon 8.7605459`.
- Người dùng đổi được địa điểm (nhập toạ độ trực tiếp **hoặc** tìm theo tên qua geocoding).
- Lưu lựa chọn gần nhất để lần sau mở lại vẫn còn (localStorage hoặc tương đương).
- Hiển thị tên địa điểm + toạ độ đang dùng, để người dùng luôn biết app đang tính cho chỗ nào.

## 2. Thời gian
- Chọn **ngày + giờ** (mặc định: bây giờ, làm tròn lên giờ kế tiếp).
- Toàn bộ tính toán theo múi giờ `Europe/Berlin`, **có xử lý DST** (giờ mùa hè/mùa đông).
- Hiển thị giờ địa phương rõ ràng, kèm nhãn offset (ví dụ `18:00 (UTC+02:00)`).

## 3. Nguồn dữ liệu (bắt buộc dùng đúng các base URL sau)
App phải đọc 3 base URL từ cấu hình, có thể ghi đè bằng query param để kiểm thử:

| Cấu hình | Query param | Mặc định |
|---|---|---|
| `forecastBase` | `?forecastBase=` | `https://api.open-meteo.com` |
| `airQualityBase` | `?airQualityBase=` | `https://air-quality-api.open-meteo.com` |
| `geocodingBase` | `?geocodingBase=` | `https://geocoding-api.open-meteo.com` |

Gọi đúng path:
- `GET {forecastBase}/v1/forecast?latitude&longitude&hourly=…&daily=…&timezone=Europe%2FBerlin&forecast_days=…`
- `GET {airQualityBase}/v1/air-quality?latitude&longitude&hourly=pm2_5,pm10,european_aqi&timezone=Europe%2FBerlin`
- `GET {geocodingBase}/v1/search?name=…&count=5&language=…`

Các biến hourly bắt buộc phải dùng: `temperature_2m`, `apparent_temperature`, `relative_humidity_2m`,
`dew_point_2m`, `precipitation`, `precipitation_probability`, `rain`, `weather_code`, `cloud_cover`,
`visibility`, `wind_speed_10m`, `wind_gusts_10m`, `uv_index`, `is_day`.
Daily bắt buộc: `sunrise`, `sunset`. Air quality bắt buộc: `pm2_5`, `european_aqi`.

Ngoài ra app phải tự tính **vị trí mặt trời** (độ cao + phương vị) cho toạ độ và thời điểm đã chọn
(công thức thiên văn, không cần API) để lập luận về chói nắng / bóng nắng.

## 4. Điểm số 0–100
- Điểm là **hàm tất định** của dữ liệu đầu vào (cùng input → cùng điểm).
- Mỗi yếu tố phải có: giá trị đầu vào, ngưỡng, trọng số, và **mức đóng góp âm/dương** hiển thị được cho người dùng.
- Bắt buộc phải xét ít nhất: mưa hiện tại; xác suất mưa; **mưa trong 24 giờ trước** (suy ra sân còn ướt);
  gió và **gió giật**; nhiệt độ cảm nhận (`apparent_temperature`); UV; độ mây / độ chói; tầm nhìn;
  `european_aqi`; và góc mặt trời so với **hướng sân do người dùng chọn** (mặc định: sân hướng Bắc–Nam,
  người dùng đổi được).
- Xếp loại theo đúng ngưỡng sau (không được tự đổi):
  - `>= 70` → `"Nên đi"`
  - `40–69` → `"Cân nhắc"`
  - `< 40` → `"Không nên"`
- **Không được bịa số.** Nếu thiếu dữ liệu thì phải nói rõ thiếu gì và hạ độ tin cậy, không được tự điền.

## 5. Lập luận
- App phải hiển thị chuỗi lập luận người đọc hiểu được: yếu tố nào kéo điểm lên, yếu tố nào kéo xuống,
  mức ảnh hưởng bao nhiêu. Không phải dump số thô.
- Nếu đưa ra giả định (ví dụ "không có dữ liệu đèn sân → coi như trời tối là không đánh được"),
  phải nói rõ giả định đó.

## 6. Ngôn ngữ (i18n)
- 3 ngôn ngữ: `vi` (mặc định), `de`, `en`.
- Đổi ngay trong app, nhớ lựa chọn. Toàn bộ chuỗi UI phải dịch, không sót chuỗi tiếng Anh khi đang ở `vi`.
- Ngày/giờ/số định dạng theo locale tương ứng.

## 7. Trạng thái
- Loading (skeleton hoặc tương đương), lỗi mạng (có thử lại), không có dữ liệu (nói rõ, không bịa),
  dữ liệu cũ nếu có cache (phải ghi rõ là dữ liệu cũ).
- Mất mạng / API lỗi không được làm trắng màn hình.

## 8. Hợp đồng máy đọc được (bắt buộc, dùng để kiểm thử)
App phải nhận các query param: `lat`, `lon`, `at` (`YYYY-MM-DDTHH:mm`), `lang`, `courtBearing`
(0–359), `now` (`YYYY-MM-DDTHH:mm`, tuỳ chọn), `forecastBase`, `airQualityBase`, `geocodingBase`.

- Khi có `now`, app phải dùng nó làm "thời điểm hiện tại" cho mọi kiểm tra phạm vi/tương đối
  (ví dụ giới hạn dự báo, "hôm nay/ngày mai"), và **vẫn phải tính cho thời điểm `at`** miễn là API
  có trả dữ liệu cho mốc đó — không được từ chối chỉ vì `at` xa `now`.
- Khi không có `now`, dùng thời gian hệ thống.

Sau khi tính xong, app phải gán vào `window.__verdict` một object:

```json
{
  "score": 0-100,
  "verdict": "Nên đi" | "Cân nhắc" | "Không nên",
  "localTime": "YYYY-MM-DDTHH:mm",
  "utcOffsetMinutes": 120,
  "location": { "lat": 49.9960846, "lon": 8.7605459, "name": "..." },
  "factors": [ { "id": "wind_gust", "value": 14, "unit": "km/h", "impact": -6 } ],
  "dataSource": { "forecastBase": "...", "fetchedAt": "ISO-8601" }
}
```

`factors` phải có `id` ổn định bằng tiếng Anh, `value`, `unit`, `impact` (số, âm = kéo điểm xuống).
Không được đổi tên khoá này. Gán `window.__verdict` cả khi lỗi mạng, với `score: null` và trường `error`.

## 9. Test
- Unit test cho hàm tính điểm: tối thiểu **6 case**, gồm cả biên (mưa to + gió giật; nắng gắt UV cao;
  trời tối; sân ướt sau mưa; thời tiết lý tưởng; thiếu dữ liệu).
- `npm test` phải chạy được và pass.

## 10. Chất lượng giao diện (định hướng, sẽ được chấm)
- Mobile-first thật: nhìn và dùng tốt ở 390×844, dùng được bằng một ngón tay, nút bấm ≥ 44px.
- Có light + dark mode, tương phản đạt WCAG AA.
- Typography có chủ đích (thang bậc rõ), nhịp spacing nhất quán, palette có lý do.
- Icon dùng bộ icon thật (Lucide / Phosphor / Tabler…), **không emoji làm icon**.
- Không dùng: gradient tím–indigo mặc định của template, glassmorphism vô cớ, 3 card bo tròn giống hệt nhau,
  copy kiểu "Elevate your game", lorem ipsum, hiệu ứng chỉ để cho đẹp.
- Có `DESIGN.md` giải thích lựa chọn; lựa chọn phải nhất quán với code.
