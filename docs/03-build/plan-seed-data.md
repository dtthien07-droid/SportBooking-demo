# Kế hoạch — Seed dữ liệu cơ sở và sân

> Chờ duyệt, chưa viết code. Nguồn nghiệp vụ là [business-flow.md](../01-plan/business-flow.md); schema và quy tắc import theo [spec.md](../02-design/spec.md) mục 4 và 8.2.

## 1. Mục tiêu và phạm vi

Tạo script `infra/database/seed-facilities.js` đọc [khao-sat-san.xlsx](../../infra/data/khao-sat-san.xlsx) hoặc CSV UTF-8 xuất từ file đó, chuẩn hóa và import dữ liệu vào database phát triển `sportbooking_dev`. Script tạo một cơ sở và một sân mặc định cho mỗi dòng hợp lệ, đánh dấu dữ liệu seed, đồng thời tạo khung giờ 1 tiếng trong 14 ngày tới.

Workbook có một hàng tiêu đề và 29 dòng dữ liệu, thuộc 6 quận; phân bố đã xác nhận: cầu lông 10, bóng đá mini 8, pickleball 11. Workbook không có ảnh. Không sửa workbook gốc và không kết nối/ghi vào `sportbooking_system` vì database đó chứa dữ liệu khảo sát hiện có.

### Điều kiện tiên quyết

Trước khi chạy seed, phải chạy migration `002` tạo các bảng `facilities`, `courts` và `time_slots` với đầy đủ cột, khóa và index theo spec mục 4.1. Vì `time_slots.current_booking_id` tham chiếu `bookings` nhưng bảng `bookings` chưa được tạo ở migration này, migration `002` tạo cột đó nhưng chưa thêm foreign key; migration tạo `bookings` sẽ bổ sung foreign key sau. Migration `002` phải hoàn tất thành công trước khi chạy `seed-facilities.js`.

## 2. File dự kiến

| Thao tác | Đường dẫn | Nội dung |
|---|---|---|
| Tạo | `infra/database/seed-facilities.js` | Đọc xlsx/CSV, chuẩn hóa, validate, dry-run, import có transaction, tạo khung giờ, in báo cáo kết quả và lỗi theo dòng. |
| Có thể tạo | `infra/database/seed-data/` | Chỉ chứa bảng ánh xạ/giá trị sửa đã được duyệt nếu tách khỏi script là cần thiết; không chứa bí mật hoặc bản sao workbook. |
| Chỉ sửa khi cần | Migration trong `infra/database/migrations/` | Bổ sung `facilities.map_url`, `courts.initial_rating`, `courts.survey_price_min`, `courts.survey_price_max` nếu schema dev chưa có các cột trong spec. |
| Không sửa | `infra/data/khao-sat-san.xlsx` | File nguồn chỉ đọc. |

Dependency đọc Excel đề xuất là `exceljs`; hỗ trợ CSV xuất từ workbook bằng parser phù hợp nếu đã có trong backend/infra hoặc được duyệt thêm. Không thêm dependency hay chạy script trước khi kế hoạch được duyệt.

## 3. Mapping và chuẩn hóa

| Workbook | Cột đích | Quy tắc |
|---|---|---|
| A `Cụm sân / Khu vực` | `facilities.district` | Điền xuống quận của nhóm khi ô rỗng; trim/chuẩn hóa cách viết quận. |
| B `Tên môn` | `courts.sport_type` | Các ô rỗng thuộc nhóm hiện hành kế thừa môn của nhóm; chuẩn hóa về `BADMINTON`, `FOOTBALL_MINI`, `PICKLEBALL`. Nhãn không nhận diện báo lỗi, không đoán. |
| C `Tên sân` | `facilities.name`, `courts.name` | Trim khoảng trắng, kiểm tra rỗng; dùng làm tên cơ sở. Tên sân mặc định của mỗi cơ sở là `Sân 1`. |
| D `Địa chỉ chi tiết` | `facilities.address` | Giữ địa chỉ đầy đủ; so khớp quận đã fill-down, báo nếu mâu thuẫn. |
| E `Link map` | `facilities.map_url` | Link đã được sửa trong workbook; lưu URL hợp lệ. Ô trống lưu `NULL`. |
| F `Số điện thoại liên hệ` | `facilities.hotline` | Số điện thoại đã được sửa trong workbook; lưu dưới dạng chuỗi để giữ số 0 đầu. |
| G `Giờ mở cửa / đóng cửa` | `facilities.opening_time`, `facilities.closing_time` | Chuẩn hóa dấu phân cách, khoảng trắng, `đến`, `HH:mm`; `Cả ngày`/`24:00` xử lý theo quy ước giờ đã chốt trong spec. Giá trị không phân tích được đưa vào báo cáo. |
| H `Tiện ích` | `facilities.amenities` | Tách các mục theo `/`, dấu phẩy/chấm phẩy, trim và loại mục trùng; lưu JSON array. Ô trống dùng tiện ích mặc định theo môn và đánh dấu seed. |
| I `rate đgia` | `courts.initial_rating` | Các điểm rating bị lỗi đã được người dùng gõ lại thủ công trong workbook; nhập số hợp lệ 1.0–5.0. Ô trống lưu `NULL`. |
| J cột giá không có header | `courts.survey_price_min`, `courts.survey_price_max`, `courts.price_normal`, `courts.price_peak` | Bỏ ký hiệu tiền tệ/đơn vị theo giờ; parse khoảng giá, chuẩn hóa `k`/`nghìn`/VNĐ thành đồng. Gán giá nhỏ nhất vào `price_normal`, giá lớn nhất vào `price_peak`. Nếu chỉ có một mức giá thì `price_normal` bằng mức đó và `price_peak = price_normal × 1,3`. |
| Không có cột ảnh | `facilities.image_url` | Lưu `NULL`. |

Các giá trị mặc định còn áp dụng theo spec mục 8.2: giờ mở cửa 06:00–22:00 nếu thực sự thiếu; tiện ích mặc định theo môn; chính sách hủy theo business-flow mục 4.1; cột ảnh để trống (`image_url = NULL`). Khi khoảng giá khảo sát có hai mức, dùng số nhỏ làm `price_normal` và số lớn làm `price_peak`; nếu chỉ có một mức thì `price_normal` bằng mức đó và `price_peak = price_normal × 1,3`.

## 4. Tính lặp an toàn và bảo vệ dữ liệu admin

1. Dùng khóa nhận diện xác định từ dữ liệu đã chuẩn hóa: quận + tên + địa chỉ cho cơ sở; ID cơ sở + tên sân cho sân. Trước khi insert, tìm seed đã tồn tại theo khóa này để tái sử dụng; phát hiện nhiều kết quả khớp thì dừng và báo xung đột.
2. Script chạy trong transaction theo batch hợp lý; lỗi kiểm tra dữ liệu bắt buộc hoặc lỗi DB sẽ rollback batch đang xử lý và báo rõ dòng/cột.
3. Bản ghi mới có dữ liệu seed/default đánh dấu `is_seed = TRUE`. Không cập nhật trường của bản ghi `is_seed = FALSE`; đó là bản ghi admin đã chỉnh sửa. Với `is_seed = TRUE`, chỉ cập nhật trường do nguồn quản lý theo quy tắc được duyệt, không xóa dữ liệu không còn trong file.
4. Chạy lần hai không tạo thêm cơ sở/sân/khung; không thay dữ liệu admin đã chỉnh; unique `(court_id, service_date, starts_at)` là lớp bảo vệ cuối cho khung giờ.
5. Hỗ trợ `--dry-run`: phân tích, chuẩn hóa và hiển thị tổng hợp/ lỗi nhưng không ghi DB. Import thật chỉ chạy sau khi dry-run đạt kiểm tra dữ liệu.
6. Ghi log kết quả tổng hợp (số dòng đọc/skip/lỗi, insert/reuse, seed/default, khung giờ tạo/bỏ qua), không log credentials.

## 5. Tạo khung giờ

- Tạo khung liền nhau 1 tiếng theo giờ hoạt động 06:00–22:00 cho 14 ngày tính từ ngày chạy seed, theo ngày địa phương `Asia/Ho_Chi_Minh`.
- Chỉ thêm slot chưa có; không ghi đè slot đã tồn tại, giá đã snapshot hoặc dữ liệu do admin/booking quản lý.
- Slot mới lấy giá theo `courts.price_normal` hoặc `courts.price_peak` cho giờ vàng 17:00–21:00; giá snapshot ghi vào `time_slots.price`.
- Các slot đã qua tại ngày chạy vẫn không được đặt theo quy tắc nghiệp vụ; nếu chỉ sinh giờ tương lai thì bỏ qua giờ bắt đầu đã qua. Quy tắc này cần được thực hiện nhất quán với lịch khả dụng.

## 6. Chạy thử và kiểm chứng

Chỉ chạy thử sau khi user duyệt kế hoạch và dry-run không còn lỗi dữ liệu bắt buộc.

1. Kiểm tra cấu hình kết nối trước khi ghi: `DB_NAME` phải đúng `sportbooking_dev`; nếu khác, đặc biệt là `sportbooking_system`, từ chối khởi chạy. Không dùng database sản xuất/khảo sát làm mục tiêu.
2. Chạy migration cần thiết trên `sportbooking_dev` sau khi xác nhận trạng thái schema và backup phù hợp; không tự chạy migration lên database khác.
3. Chạy `--dry-run` trên xlsx, kiểm tra số dòng hợp lệ/lỗi và báo cáo chuẩn hóa; sửa dữ liệu nguồn/correction theo xác nhận, không âm thầm bỏ dòng.
4. Chạy import lần đầu vào `sportbooking_dev`; kiểm tra tổng 29 cơ sở, 6 quận, 29 sân; phân bố 10 cầu lông, 8 bóng đá mini, 11 pickleball; `is_seed` đúng và `image_url IS NULL`.
5. Kiểm tra giờ mở/đóng, hotline dạng chuỗi giữ số 0 đầu, map URL hoặc `NULL`, tiện ích JSON, rating đã được sửa hợp lệ hoặc `NULL` khi ô trống, giá khảo sát min/max, `price_normal`/`price_peak` theo quy tắc giá.
6. Kiểm tra có khung 1 tiếng cho 14 ngày và giá đúng theo giá thường/giờ vàng đã cấu hình; không tạo slot trùng, không tạo slot ngoài giờ hoạt động.
7. Chạy script lần hai; số cơ sở/sân không tăng, không có khung trùng và mọi trường admin đã sửa vẫn giữ nguyên.
8. Thử cấu hình `DB_NAME` khác `sportbooking_dev` để xác nhận script từ chối ghi; không thử bằng cách trỏ tới hoặc sửa dữ liệu `sportbooking_system`.

## 7. Các quyết định đã chốt

- Giá thường lấy số nhỏ trong khoảng giá khảo sát; giá giờ vàng lấy số lớn. Nếu chỉ có một giá, giá giờ vàng bằng giá đó × 1,3.
- Rating lỗi đã được người dùng gõ lại thủ công trong workbook; ô trống lưu `NULL`.
- Số điện thoại và link map đã được sửa trong workbook; `map_url` trống lưu `NULL`.
- Ảnh không có trong workbook và luôn để `image_url = NULL`.
- Cột `Tên sân` dùng làm tên cơ sở; sân mặc định của mỗi cơ sở có tên `Sân 1`.

Chưa tạo script, migration, dữ liệu correction hoặc thay đổi nào ngoài các tài liệu được yêu cầu. Chờ user duyệt kế hoạch trước khi code.
