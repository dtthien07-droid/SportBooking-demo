# Kế hoạch — Module 2: Cơ sở, sân và lịch khung giờ

> Trạng thái: đã duyệt; triển khai Cụm A (migration + seed). Phạm vi theo [business-flow.md](../01-plan/business-flow.md) và [spec.md](../02-design/spec.md). Chỉ áp dụng lên `sportbooking_dev` và `sportbooking_test`; tuyệt đối không dùng `sportbooking_system`.

## 1. Phạm vi và số liệu đã xác minh

Workbook [khao-sat-san.xlsx](../../infra/data/khao-sat-san.xlsx) có 29 dòng dữ liệu: 29 cơ sở tại 6 quận Hà Nội; cầu lông 10, bóng đá mini 8, pickleball 11. Mỗi cơ sở khởi tạo một sân mặc định, tổng 29 sân. Các số liệu này hiện đã đúng trong business-flow mục 10.19 và spec mục 8.2, nên kế hoạch giữ nguyên nội dung đó.

Hai mockup [trangchu-user.html](../02-design/mockups/trangchu-user.html) và [tim-san.html](../02-design/mockups/tim-san.html) chỉ được đọc, không sửa. Trang chủ cần dữ liệu thẻ cơ sở/sân nổi bật: tên, môn, địa chỉ/khu vực, điểm đánh giá, giá, ảnh; trang tìm sân cần thêm bộ lọc môn, quận, từ khóa, ngày/khung giờ, tiện ích, danh sách kết quả và phân trang. Giữ các tên trường tương thích với markup cũ khi có thể (`name`, `sport`/`sport_name`, `district`/`area`, `address`, `rating`, `price`/`price_min`, `opening_time`/`open_time`, `closing_time`/`close_time`, `amenities`, `map_url`/`map_link`, `image_url`).

## 2. Ánh xạ workbook và chuẩn hóa

| Cột Excel | Cột đích | Quy tắc |
|---|---|---|
| A — Cụm sân / Khu vực | `facilities.district` | Điền xuống quận ở dòng đầu nhóm; trim khoảng trắng, chuẩn hóa tên. Ưu tiên cột A; nếu địa chỉ lệch thì ghi cảnh báo seed theo đúng dòng, không tự sửa quận. |
| B — Tên môn | `courts.sport_type` | Điền xuống nhãn môn của nhóm; chuẩn hóa hoa/thường và khoảng trắng. `Sân bóng`/các biến thể tương ứng → `FOOTBALL_MINI`; cầu lông → `BADMINTON`; pickleball → `PICKLEBALL`. Giá trị không nhận diện thì dừng để rà soát. |
| C — Tên sân | `facilities.name`, `courts.name` | Chuẩn hóa khoảng trắng và ký tự xuống dòng; dùng tên khảo sát cho cơ sở và sân mặc định. |
| D — Địa chỉ chi tiết | `facilities.address` | Giữ nguyên địa chỉ đã trim; đối chiếu quận chỉ để ghi cảnh báo, không thay cột A. |
| E — Link map | `facilities.map_url` | Dùng nguyên URL hợp lệ đã sửa trong workbook; nếu vẫn không phải URL thì lưu `NULL`, ghi cảnh báo đúng dòng. Frontend tạo URL tìm kiếm Google Maps từ địa chỉ khi hiển thị. |
| F — Số điện thoại liên hệ | `facilities.hotline` | Lưu chuỗi chữ số; bỏ dấu chấm và khoảng trắng. Chuỗi toàn số dài 9 hoặc 10 chữ số thì thêm `0` đầu; ô trống lưu `NULL`. |
| G — Giờ mở cửa / đóng cửa | `facilities.opening_time`, `facilities.closing_time` | Chuẩn hóa các cách ghi giờ. “Cả ngày”/“Mở cửa cả ngày” thành `00:00:00`–`24:00:00`; đóng `00:00` hoặc `24:00` là `24:00` cùng ngày. Làm tròn giờ mở lên và giờ đóng xuống giờ tròn; `24:00` không đổi thành `00:00` ngày hôm sau. |
| H — Tiện ích | `facilities.amenities` | Tách danh sách, trim, bỏ mục trùng và lưu JSON array. Ô trống lưu mảng rỗng, không tự suy đoán tiện ích. |
| I — rate đgia | `courts.initial_rating` | Dùng nguyên giá trị rating hợp lệ trong workbook. Nếu không nằm trong 1.0–5.0 hoặc sai định dạng thì để `NULL`, ghi cảnh báo đúng dòng; kỳ vọng 0 cảnh báo. |
| J — Giá (không có header) | `courts.survey_price_min`, `courts.survey_price_max`, `price_normal`, `price_peak` | Chuẩn hóa VNĐ, `k`/`nghìn`, dấu phân cách và khoảng giá. Giá thiếu `/giờ` vẫn hiểu là giá theo giờ. Mức nhỏ nhất là `price_normal`, lớn nhất là `price_peak`; chỉ một mức thì `price_peak = price_normal × 1,3`. Không dùng hằng số giá theo môn. |
| Không có | `facilities.image_url` | Chưa có ảnh theo môn: để `NULL`; frontend hiển thị nền gradient và icon theo môn cho tới khi có ảnh thật. |

### Dữ liệu cần rà soát trước khi seed

- Cột A/B có ô trống theo nhóm; tên quận có khoảng trắng thừa và tên môn không đồng nhất chữ hoa/thường.
- Tên `Pickleball Arena Tây Hồ` có xuống dòng; phải gộp khoảng trắng nhưng giữ nguyên chữ.
- SĐT 9/10 chữ số được thêm `0` đầu sau khi chuyển thành chữ số; số trống giữ `NULL`.
- “Cả ngày”/“Mở cửa cả ngày” dùng giờ 24/24; giờ lẻ được làm tròn về khung nguyên giờ theo hướng đã duyệt.
- Cột J có nhiều cách viết; giá một mức được nhân 1,3 cho giờ vàng và thiếu `/giờ` vẫn tính theo giờ.
- Rating và map trong workbook đã được sửa; seed dùng nguyên giá trị, chỉ cảnh báo nếu còn không hợp lệ và liệt kê đúng dòng.
- Nếu địa chỉ mâu thuẫn với quận cột A thì giữ quận cột A và báo cảnh báo, không tự sửa.

## 3. Migration `002`

Tạo migration trong `infra/database/migrations/` theo schema spec mục 4.1:

- `facilities`: `id`, `name`, `address`, `district`, `opening_time`, `closing_time`, `hotline`, `latitude`, `longitude`, `map_url`, `description`, `amenities`, `rules`, `cancellation_policy`, `image_url`, `is_active`, `is_seed`, `created_at`, `updated_at`; `amenities` là JSON array trong `LONGTEXT` có xác thực JSON. Index `(district, is_active)` và `(is_active, name)`.
- `courts`: `id`, `facility_id`, `name`, `sport_type`, `price_normal`, `price_peak`, `survey_price_min`, `survey_price_max`, `initial_rating`, `description`, `is_active`, `is_seed`, `created_at`, `updated_at`; rating hợp lệ 1.0–5.0. Index `(sport_type, is_active)` và `(facility_id, is_active)`.
- `time_slots`: `id`, `court_id`, `service_date`, `starts_at`, `ends_at`, `price`, `status` (`AVAILABLE`/`LOCKED`/`BOOKED`), `current_booking_id`, `lock_expires_at`, `created_at`, `updated_at`; unique `(court_id, service_date, starts_at)`, index `(service_date, status, court_id)` và `(current_booking_id)`.

Migration phụ thuộc migration auth `001`; `time_slots.current_booking_id` chưa tạo FK tới `bookings` nếu bảng đó chưa tồn tại, theo spec. Thêm guard allowlist tên DB chỉ gồm `sportbooking_dev` và `sportbooking_test`; từ chối mọi DB khác trước khi chạy migration. Kiểm tra schema trên cả hai DB, không kết nối hoặc sửa `sportbooking_system`.

## 4. Seed `infra/database/seed-facilities.js`

1. Đọc trực tiếp workbook; kiểm tra sheet/header, đúng 29 dòng, loại môn và các trường bắt buộc. Chuẩn hóa trước khi ghi; nếu phát hiện dữ liệu không thể phân giải thì báo rõ dòng/cột và dừng phần ghi tương ứng.
2. Tạo/đối chiếu cơ sở bằng khóa chuẩn hóa quận + tên + địa chỉ; tạo sân bằng facility + tên. Chạy lặp không tạo trùng, không ghi đè dữ liệu admin đã sửa. Dữ liệu cơ sở theo khảo sát có `is_seed = FALSE`; sân mặc định do seed tạo có `is_seed = TRUE`; sửa bởi admin chuyển sân về `is_seed = FALSE`.
3. Mỗi cơ sở có một sân mặc định; chọn giá từ cột J theo quy tắc mục 2, `initial_rating` chỉ khi hợp lệ. Để `image_url` là `NULL`; frontend dùng gradient và icon theo môn.
4. Tạo khung một tiếng từ giờ mở đã làm tròn lên tới giờ đóng đã làm tròn xuống cho 14 ngày theo UTC+7; giờ vàng 17:00–21:00. Cơ sở 24/24 tạo đủ 24 khung/ngày, gồm khung kết thúc `24:00`. Chỉ chèn khung chưa có, không sửa khung đã tồn tại.
5. In tổng kết và cảnh báo: số cơ sở, sân, khung giờ tạo/bỏ qua, dữ liệu cần rà soát và xác nhận seed không trỏ tới `sportbooking_system`.

## 5. API

Theo spec mục 5.2, triển khai:

| Endpoint | Hành vi |
|---|---|
| `GET /api/v1/facilities?sport=&district=&q=&page=&page_size=` | Lọc môn, quận đã chuẩn hóa, từ khóa trên tên/địa chỉ; phân trang và trả tổng số/kết quả. Trường output giữ các tên cũ cần cho hai mockup hoặc chuẩn hóa ở một adapter dùng chung. |
| `GET /api/v1/facilities/:id` | Trả cơ sở, sân mặc định, giờ hoạt động, giá, đánh giá, tiện ích, bản đồ và ảnh. |
| `GET /api/v1/courts/:id/time-slots?date=` | Trả khung trong ngày và trạng thái hiệu lực tại thời điểm phản hồi. `LOCKED` có `lock_expires_at` đã qua phải được coi là trống ngay, không chờ tác vụ dọn. Khung đã qua hoặc bắt đầu cách hiện tại dưới 15 phút phải không chọn được; backend cũng kiểm tra quy tắc này khi đặt. |

Giữ chuẩn lỗi/ủy quyền theo spec. Không cho giao diện quyết định quyền hoặc trạng thái. Khung giờ dùng UTC+7; phản hồi lịch cần thể hiện rõ trạng thái và khả năng chọn để UI không hiểu nhầm khung trống nhưng đã quá giờ.

## 6. Frontend

- Tạo `frontend/trangchu-user.html` và `frontend/tim-san.html`, giữ nguyên tên, HTML/CSS, layout, font và icon của mockup; không sửa hai file trong `docs/02-design/mockups/`.
- Bỏ JavaScript cũ gồm dữ liệu fallback, `localStorage`/`sessionStorage`, API cũ, URL localhost và điều hướng tới trang chưa triển khai; nối API mới. Không sửa backend ngoài phạm vi API module.
- Chưa có ảnh thật theo môn; dùng nền gradient + icon theo môn, không thêm ảnh ngoài phạm vi.
- Đặt đích sau đăng nhập user thành `/trangchu-user.html` trong hằng `USER_HOME` hoặc điểm điều hướng tương đương; hiện chưa tìm thấy hằng `USER_HOME` trong frontend.
- Link nội bộ dùng URL từ gốc; trang chưa được triển khai để `href="#"`, không gọi tới route cũ không tồn tại.
- Giữ nguyên chữ mockup, không tự sửa nội dung. Lệch thấy được so với quy tắc trình độ trong business-flow: `Trình: Văn phòng` và `DUPR 2.5 - 3.5`; không thấy các chữ `Tennis`, `VIP`, `Gold`, `Diamond`, mã giảm giá trong hai mockup này. Ghi nhận để người dùng quyết định, không tự thay.

## 7. Kiểm thử và nghiệm thu

- Migration 002 chạy được trên `sportbooking_dev` và `sportbooking_test`; guard từ chối `sportbooking_system`.
- Chạy seed hai lần: vẫn đúng 29 cơ sở/29 sân, không trùng; đếm môn lần lượt 10 cầu lông, 8 bóng đá mini, 11 pickleball và có 6 quận.
- API lọc từng môn/quận/từ khóa và phân trang trả đúng tổng số và dữ liệu; chi tiết cơ sở và lịch đúng sân/ngày.
- `LOCKED` quá hạn được trả như trống; giờ đã qua và giờ bắt đầu cách hiện tại dưới 15 phút bị khóa/không chọn được.
- Kiểm tra lỗi dữ liệu đầu vào (môn/giá/giờ không phân giải), trạng thái loading/lỗi/rỗng, liên kết nội bộ và trình duyệt ở desktop/mobile.

## 8. Thứ tự thực hiện sau khi duyệt

1. **Cụm A — Migration + seed:** tạo migration 002, chạy trên dev/test; viết seed idempotent và kiểm tra số liệu.
2. **Cụm B — API + test:** triển khai ba endpoint, lọc/phân trang, trạng thái hiệu lực của khung giờ; chạy test seed, filter, lock hết hạn và giờ không hợp lệ.
3. **Cụm C — Frontend:** sao chép hai mockup sang `frontend/`, gỡ JavaScript cũ, nối API, sửa đích sau đăng nhập; kiểm thử UI/API và giữ nguyên nội dung.

## Quyết định đã duyệt

1. Giá nhỏ nhất là `price_normal`, lớn nhất là `price_peak`; một mức thì `price_peak = price_normal × 1,3`. Giá thiếu `/giờ` vẫn tính theo giờ; không dùng hằng số giá theo môn.
2. Hotline lưu chuỗi số; chuỗi 9 hoặc 10 chữ số được thêm `0` đầu, bỏ dấu chấm/khoảng trắng thừa; ô trống là `NULL`.
3. Giờ cơ sở lấy từ khảo sát nên `facilities.is_seed = FALSE`, gồm cả “Cả ngày”/“Mở cửa cả ngày” (24/24: `00:00:00`–`24:00:00`). Giờ đóng `00:00`/`24:00` là hết ngày cùng ngày. Làm tròn giờ mở lên, giờ đóng xuống giờ nguyên; sinh slot 1 tiếng từ giờ mở đến giờ đóng, đủ 24 slot/ngày với 24/24. Mọi xử lý thời gian giữ giá trị `24:00`, không chuyển thành `00:00` ngày sau; UI hiển thị “Mở cửa 24/24”.
4. Rating và map trong Excel đã được sửa; seed dùng nguyên giá trị, chỉ cảnh báo giá trị còn sai và ghi đúng dòng (kỳ vọng 0 cảnh báo cho hai trường). Map không hợp lệ lưu `NULL`; frontend dựng link Google Maps tìm kiếm theo địa chỉ.
5. Quận lấy từ cột A; địa chỉ lệch thì ghi cảnh báo seed theo dòng, không sửa dữ liệu quận.
6. Chưa có ảnh theo môn; frontend dùng gradient và icon, người dùng sẽ thay ảnh thật sau.
7. Nội dung lệch business-flow trong hai mockup chỉ liệt kê báo cáo, không tự sửa (gồm `Trình: Văn phòng`, `DUPR 2.5 - 3.5`).
