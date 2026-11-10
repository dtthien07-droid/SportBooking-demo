# Kế hoạch: Thanh toán giả lập và vé QR

Trạng thái: **Đã duyệt**  
Phạm vi: FR-07; vé QR sau thanh toán. Hủy/hoàn tiền FR-08 được ghi nhận ở phần phụ thuộc và quyết định cần chốt; chưa triển khai trong kế hoạch này trừ khi được xác nhận.

## 1. Hiện trạng và phần còn thiếu

### Đã có

- Migration `infra/database/migrations/003-create-booking-tables.sql` tạo `bookings`, `booking_slots`, các khóa ngoại và lịch sử giá slot. `bookings` đã có `PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `COMPLETED`, `booking_code`, `total_amount`, `lock_expires_at`.
- Migration `004-add-booking-match-preference-and-payments.sql` thêm `match_preference` và `payments`. Mỗi booking có một payment `PENDING`; payment có `amount_due`, `paid_amount`, `refunded_amount`, `payment_option`, thời điểm trả/hoàn.
- `POST /api/v1/bookings` tạo booking, payment, booking_slots và khóa slot trong một transaction; hỗ trợ đặt cọc 50% hoặc trả đủ. `GET /api/v1/bookings/:id` đọc chi tiết booking/payment, `POST /:id/cancel` hiện chỉ hủy booking `PENDING`.
- `backend/src/bookings/bookings.repository.js` có helper transaction và khóa hàng InnoDB; `bookings.service.js` kiểm tra trạng thái/thời hạn, và tự hết hạn lock trả 410 trong luồng hủy.
- Trang mockup có sẵn: `docs/02-design/mockups/dat-san-thanh-cong.html` (vé/QR), `chi-tiet-don-dat-san.html`, `lich-su-dat-san.html`. Frontend đang có trang xác nhận giữ chỗ và API booking; chưa có giao diện thanh toán hoặc vé nối backend.

### Còn thiếu

- Chưa có bảng lưu từng payment attempt; không thể lưu attempt thất bại/thử lại hay truy vấn lịch sử thanh toán.
- Chưa có bảng vé; booking response hiện không thể trả vé đã phát hành.
- Chưa có route/service/repository cho thanh toán hoặc payments; chưa có điều kiện atomically cập nhật payment, booking và slots khi thanh toán thành công.
- Chưa có kiểm tra chủ booking riêng cho thanh toán, idempotency/thanh toán lặp hay xử lý 410 từ thao tác thanh toán.
- Chưa có trang thanh toán giả lập, trang vé và test tích hợp cho luồng thanh toán.
- Quy tắc hủy/hoàn tiền trong business-flow rộng hơn API hủy hiện tại. Cần quyết định có gộp triển khai FR-08 vào đợt này hay để kế hoạch riêng; không tự mở rộng phạm vi.

## 2. Migration 005 — `payment_attempts`, `booking_tickets`

Tạo `infra/database/migrations/005-create-payment-attempts-and-booking-tickets.sql` sau khi kiểm tra schema đã chạy migration 004.

- `payment_attempts`: `id BIGINT UNSIGNED AUTO_INCREMENT`; `payment_id BIGINT UNSIGNED NOT NULL`; `attempt_no INT UNSIGNED NOT NULL`; `method ENUM('BANK_TRANSFER','MOMO','DOMESTIC_ATM','INTERNATIONAL_CARD') NOT NULL`; `amount DECIMAL(12,0) NOT NULL`; `result ENUM('PROCESSING','SUCCEEDED','FAILED') NOT NULL`; `provider_reference VARCHAR(100) NULL`; `created_at DATETIME(3) NOT NULL`; `completed_at DATETIME(3) NULL`; PK, `UNIQUE(payment_id, attempt_no)`, index `(payment_id, created_at)`, FK tới `payments(id)` với `ON DELETE RESTRICT`.
- `booking_tickets`: `id BIGINT UNSIGNED AUTO_INCREMENT`; `booking_id BIGINT UNSIGNED NOT NULL`; `qr_code VARCHAR(80) NOT NULL`; `created_at DATETIME(3) NOT NULL`; PK, `UNIQUE(booking_id)`, `UNIQUE(qr_code)`, FK tới `bookings(id)` với `ON DELETE RESTRICT`.
- Cả hai dùng InnoDB, `utf8mb4`, collation thống nhất schema hiện tại, `DATETIME(3)` và `DECIMAL(12,0)` để tương thích MariaDB 10.4. Tránh cú pháp chỉ có ở phiên bản MySQL mới; không dựa vào partial index hoặc việc `CHECK` được cưỡng chế. Các luật phụ thuộc trạng thái được xác thực ở backend và khóa hàng trong transaction.
- Theo dõi migration trong `infra/database/migrate-bookings.js` theo kiểu kiểm tra đủ/thiếu/áp dụng một phần đang dùng cho migration 003/004; từ chối trạng thái nửa áp dụng, xác minh engine, bảng và FK sau khi chạy. Không chạy migration trên database thật trong giai đoạn kế hoạch.
- Số `attempt_no` được cấp tuần tự theo payment trong transaction, khóa hàng payment trước khi đọc số kế tiếp/insert, bảo đảm unique khi request đồng thời.

## 3. Hợp đồng API và quy tắc nghiệp vụ

Base path: `/api/v1`; dùng session hiện tại, lỗi theo cấu trúc chuẩn `{error:{code,message,details}}`.

### `POST /bookings/{id}/payment-attempts`

Request đề xuất: `{ "method": "BANK_TRANSFER|MOMO|DOMESTIC_ATM|INTERNATIONAL_CARD", "simulation_result": "SUCCESS|FAILURE" }`. Server tự lấy `amount_due` và chủ thể từ DB; không nhận amount, payment status, booking status hay user ID từ client.

- Xác thực user đăng nhập; booking không tồn tại trả 404; người không phải chủ đơn nhận cùng cách xử lý **403/404** như `GET /bookings/:id` hiện có. Chỉ chủ đơn được thanh toán, Admin không có quyền thay mặt chủ đơn ở route này.
- Trong transaction InnoDB khóa booking, payment, rồi các slot của booking theo ID tăng dần; kiểm tra booking còn `PENDING` và `lock_expires_at > UTC_TIMESTAMP(3)`. Khi lock hết hạn, không ghi attempt; trong cùng transaction chuyển booking `EXPIRED`, giải phóng slot còn `LOCKED`, commit rồi trả **410**. Nếu task hết hạn đã chạy trước thì vẫn trả 410.
- Với `FAILURE`: ghi attempt `FAILED` và `completed_at`; payment vẫn `PENDING`, booking vẫn `PENDING`, slots vẫn `LOCKED`; cho thử không giới hạn đến deadline. Response trả attempt và trạng thái hiện tại.
- Với `SUCCESS`: attempt được ghi `SUCCEEDED`; trong **cùng transaction**, payment chuyển `PAID`, `paid_amount = amount_due`, `paid_at`; booking chuyển `CONFIRMED`, slot của booking chuyển `BOOKED` và bỏ lock deadline. Chỉ commit khi mọi cập nhật thành công; lỗi rollback toàn bộ.
- Request sau khi booking đã `CONFIRMED`/payment `PAID` không tạo thêm attempt, không phát vé thứ hai, trả **409** `BOOKING_NOT_PENDING` hoặc mã lỗi tương ứng. Khóa booking và ràng buộc unique của ticket bảo vệ hai request SUCCESS đồng thời.
- Response thành công/thất bại nên có `attempt` (id, attempt_no, method, amount, result, created_at/completed_at), `payment` (status, amount_due, paid_amount), `booking` (id, booking_code, status, lock_expires_at), và với SUCCESS có `ticket`.

### `GET /bookings/{id}/payments` và vé

- Chủ booking hoặc Admin có thể đọc payment và attempts theo spec mục 5.3; user khác nhận 403 (hoặc 404 nếu quy tắc chống dò tài nguyên áp dụng thống nhất với `GET /bookings/:id` — cần chốt bên dưới).
- Response gồm payment, attempts theo `attempt_no` tăng dần, cùng vé duy nhất nếu đã được phát. GET chỉ đọc; không tạo payment/attempt/ticket.
- Admin được đọc payment/attempts qua route này. Phân biệt 403/404 cho người không phải chủ đơn theo cùng cách xử lý của `GET /bookings/:id` hiện có.
- Vé được tạo trong transaction SUCCESS duy nhất. `qr_code` lưu chuỗi nhận diện vé dạng `QR-` + chuỗi ngẫu nhiên mật mã, duy nhất và khác `booking_code`; dữ liệu encode/hiển thị QR chứa mã đơn để nhân viên đối chiếu. Mỗi booking có đúng một vé dù có nhiều slot.
- Database chỉ lưu `qr_code` dạng `QR-<random>`. Client render ma trận QR từ `booking_code` bằng thư viện được đặt trong `frontend/assets/`; không gọi dịch vụ QR bên ngoài.
- Không thêm API quét QR, xác minh tại cổng hay check-in. Vé chỉ là bằng chứng đặt sân và hiển thị mã QR.

## 4. Cụm triển khai sau khi được duyệt

1. **Migration:** migration 005, cập nhật runner/kiểm tra schema MariaDB 10.4, không đụng migration đã phát hành.
2. **API:** repository/service/routes cho attempt và đọc payments/ticket; xác thực sở hữu, transaction, timeout, trạng thái lỗi, chống lặp.
3. **Test tích hợp:** SUCCESS (payment PAID + booking CONFIRMED + tất cả slot BOOKED + đúng một vé); FAILURE rồi retry SUCCESS; lock hết hạn trả 410/slot được thả và không tạo attempt; user khác thanh toán nhận 403/404 theo cách xử lý của `GET /bookings/:id`; thanh toán lặp sau SUCCESS trả 409, không tạo attempt/ticket dư hoặc cập nhật trạng thái lần nữa; tác vụ dọn hết hạn không đụng booking `CONFIRMED` và slot `BOOKED`.
4. **Giao diện:** trang thanh toán lấy riêng phần Bước 2 của mockup `xac-nhan-dat-san.html`, giữ bố cục/class/style và dùng dữ liệu booking, payment, facility, user từ API. Nút xác nhận mặc định chỉ gửi `SUCCESS`; liên kết `FAILURE` chỉ xuất hiện với URL `?demo=1`. QR chuyển khoản được vẽ cục bộ từ `SPORTBOOKING|<booking_code>|<amount_due>`, không phải VietQR và không dùng dịch vụ ngoài. Trang vé theo `dat-san-thanh-cong.html` với QR vé, mã đơn, toàn bộ slot, hotline/map và số tiền đã trả/còn thu tại sân. Phần tìm đối trên vé ẩn hoặc hiển thị **Sắp có** vì thuộc module riêng.

## 5. Quyết định đã chốt

1. FR-08 hủy/hoàn tiền thuộc module 6 và có plan riêng; phạm vi plan này là FR-07 và vé QR.
2. Nếu lock hết hạn, không ghi payment attempt; trong transaction chuyển booking sang `EXPIRED`, nhả slot rồi trả 410.
3. Admin được đọc `GET /bookings/{id}/payments`.
4. Thanh toán lặp sau SUCCESS trả 409.
5. Database lưu `qr_code` dạng `QR-<random>`; ma trận QR vé được render phía client từ `booking_code` bằng thư viện trong `frontend/assets/`, không dùng dịch vụ ngoài. QR chuyển khoản là mã nội bộ riêng, chứa `SPORTBOOKING|<booking_code>|<amount_due>` và không phải VietQR.
6. Với người không phải chủ đơn, route thanh toán và route đọc payments áp dụng cùng cách xử lý 403/404 như `GET /bookings/:id` hiện có.
7. Test tác vụ dọn hết hạn phải xác nhận không tác động booking `CONFIRMED` hoặc slot `BOOKED`.
8. Trang vé ẩn phần tìm đối hoặc hiển thị **Sắp có**; thông báo thanh toán thuộc module 8.
9. Nút xác nhận thanh toán gửi `SUCCESS`. Chỉ liên kết nhỏ khi URL có `?demo=1` mới gửi `FAILURE`; đây vẫn là mô phỏng, không phải cổng thanh toán thật.

## 6. Cập nhật triển khai giao diện

- `frontend/thanh-toan.html` lấy bố cục Bước 2, gồm lưu ý giữ chỗ, bốn phương thức, quy định và cột tóm tắt; không còn các nút chọn kết quả SUCCESS/FAILURE trên giao diện thường.
- `frontend/booking/payment-page.js` tải booking/payments, facility và user; chỉ hiển thị dữ liệu API, dùng ảnh mặc định theo môn khi thiếu/lỗi ảnh, che số điện thoại và gửi request theo phương thức đã chọn.
- `frontend/booking/payment-data.js` dựng payload attempt và chuỗi QR chuyển khoản; `frontend/tests/payment-data.test.js` kiểm tra SUCCESS, FAILURE và chuỗi QR.
- Tạo booking thành công chuyển thẳng sang trang thanh toán. Banner giữ chỗ dùng chung ẩn trên trang đặt sân và thanh toán; hộp đơn PENDING chỉ hiện khi đã có đơn được xác nhận từ API.
- Thanh bước dùng chung được hiển thị trên cả `dat-san.html`, `thanh-toan.html` và `dat-san-thanh-cong.html`; kiểm tra trực quan: **Chờ người dùng xác nhận**.
- `node --check` JavaScript frontend đạt; `node --test` các test frontend đạt 26/26; `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test` đạt 34/34.
- Smoke test luồng trên trình duyệt: **Chờ người dùng xác nhận**.

## Tham chiếu

- [Business flow](../01-plan/business-flow.md): mục 3 bước 7–8, mục 4.1, mục 5, mục 6.1–6.3, mục 7.
- [Spec](../02-design/spec.md): mục 4, 5.3, 6–7.
- [Roadmap](../04-product/roadmap.md): module 5 thanh toán/vé và module 6 hủy/hoàn.
