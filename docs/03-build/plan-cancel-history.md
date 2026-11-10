# Kế hoạch — Lịch sử đặt sân, chi tiết đơn, hủy và hoàn tiền

> Trạng thái: Các quyết định ở mục 7 đã được chốt. Phạm vi triển khai hiện tại chỉ là backend Phần A (Module 7), các bước 1–5 trong mục 5; không triển khai giao diện hoặc Phần B.
> Thứ tự triển khai: Module 7 trước, Module 6 sau; mỗi module có một commit riêng.

## 1. Nguồn và phạm vi

- Nguồn nghiệp vụ: `docs/01-plan/business-flow.md` mục 4.1, 4.5, 6.2, 6.3 và quy tắc 13.
- Nguồn thiết kế: `docs/02-design/spec.md` bảng `bookings`/`payments` ở mục 4, mục 5.2, mục 6 và mục 9.
- Roadmap: `docs/04-product/roadmap.md`, module 6 và 7.
- Hiện trạng được đối chiếu: `backend/src/bookings/`, `backend/src/app.js`, `backend/src/server.js`, `backend/tests/bookings.integration.test.js`, migration 003–005; `frontend/booking/`, `frontend/shared/header.js`, `frontend/dat-san-thanh-cong.html` và các trang đặt/thanh toán/vé.
- Không sửa `docs/01-plan/phieu-yeu-cau.md`. Không truy cập, migrate, ghi hoặc chạy test trên database `sportbooking_system`.

### Hiện trạng liên quan

- Booking đã có các trạng thái nội bộ cần dùng. `GET /bookings/:id` hiện cho chủ đơn hoặc Admin đọc, trả `410` với booking hết hạn; chưa có API danh sách booking.
- `POST /bookings/:id/cancel` hiện chỉ hủy `PENDING`; repository chỉ giải phóng slot `LOCKED`. Chưa có tính hoàn tiền, `cancelled_by` hoặc `cancellation_reason`.
- Migration 003 đã có `cancelled_at`; migration 004 đã có `payments.refunded_amount`, `refunded_at` và trạng thái `REFUNDED`; migration 005 đã dùng cho `payment_attempts` và `booking_tickets`. Vì vậy phần schema mới (nếu cần) phải dùng số 006, không sửa migration đã chạy.
- Server đang chạy job hết hạn giữ chỗ mỗi phút; chưa có job chuyển booking sang `COMPLETED`.
- Frontend đã có `bookings-api.js`, trang vé xác nhận và QR dùng lại được. Menu dùng chung còn “Lịch sử đặt sân — Sắp có”; trang vé còn nút lịch sử, tìm đối và tải PDF đang disabled.

## 2. Phần A — Module 7: Lịch sử đặt sân và chi tiết đơn

### 2.1 API và quyền truy cập

1. Thêm `GET /api/v1/bookings?mine=true` trước route tạo URL động nếu cần; yêu cầu đăng nhập. Tài khoản hiện tại lấy từ session, không nhận `user_id` từ query.
2. Hỗ trợ lọc `status`, `page`, `page_size`; tái sử dụng quy ước phân trang hiện có: mặc định trang 1, 10 dòng/trang, tối đa 50. Trả danh sách cùng `pagination` (`page`, `page_size`, `total`, `total_pages`).
3. Danh sách chỉ chứa booking của user đang đăng nhập; truy vấn lọc theo `user_id` ngay tại database. Mỗi dòng đủ dữ liệu để hiện mã đơn, cơ sở/sân, khung giờ, trạng thái, `paid_amount`, `refunded_amount` và thao tác.
4. Bổ sung/điều chỉnh `GET /api/v1/bookings/{id}` để chi tiết gồm các slot, payment, tiền đã trả/hoàn, deadline giữ chỗ và trạng thái hiển thị. Chỉ chủ đơn được đọc; user khác nhận `404`, không tiết lộ booking tồn tại. Admin dùng API riêng ở module 10.
5. Booking `EXPIRED` hoặc `PENDING` đã quá hạn vẫn phải đọc được để xem lý do hết hạn và đặt lại; không dùng `410` để chặn trang chi tiết lịch sử. Nếu job chưa cập nhật bản ghi, API trình bày trạng thái hết hạn theo deadline mà không để giao diện tiếp tục thanh toán.
6. API cung cấp trạng thái hiển thị tách khỏi trạng thái DB:
   - `PENDING` còn hạn → **Chờ thanh toán**; hết hạn → **Đã hết hạn**.
   - `CONFIRMED` trước giờ bắt đầu khung đầu → **Sắp tới**; `bắt đầu khung đầu <= now < kết thúc khung cuối` → **Đang trong trận**; `now >= kết thúc khung cuối` → **Hoàn thành**.
   - `COMPLETED` → **Hoàn thành**; `CANCELLED` → **Đã hủy**.
   - Trạng thái lấy theo giờ UTC+7/`Asia/Ho_Chi_Minh`; UI luôn có chữ, màu chỉ hỗ trợ nhận biết.
7. Job hoàn tất chỉ cập nhật `CONFIRMED` khi `now >= kết thúc khung cuối`; nhãn hiển thị **Đang trong trận** dùng `bắt đầu khung đầu <= now < kết thúc khung cuối`. Job và nhãn hiển thị phải gọi cùng một hàm điều kiện trạng thái dùng UTC+7, để tại đúng giờ kết thúc cả hai xác định **Hoàn thành**. Chạy lặp an toàn bằng điều kiện cập nhật trạng thái nguồn `CONFIRMED`, không đụng `CANCELLED`, `EXPIRED` hay booking khác.
8. URL trang dự kiến: `/lich-su-dat-san.html` và `/chi-tiet-don-dat-san.html?booking_id=...`.

### 2.2 Giao diện

- Tạo trang lịch sử có bộ lọc trạng thái, phân trang, tiền đã trả/hoàn và liên kết chi tiết.
- Tạo trang chi tiết có thông tin sân, giờ, mã đơn, trạng thái, thanh toán/hoàn tiền và các thao tác theo trạng thái.
- `PENDING` còn hạn: hiện “Tiếp tục thanh toán” và đồng hồ theo deadline máy chủ; tuyệt đối không render vé QR hoặc stepper 3 tick trên trang chi tiết.
- `EXPIRED`: hiện thông báo đã hết hạn và nút “Đặt lại”, dẫn tới trang chi tiết cơ sở/sân/ngày liên quan để user tự chọn khung còn trống; không đặt lại tự động.
- Booking đã xác nhận: có thể mở lại trang vé hiện có theo `booking_id` để xem QR; không tạo ticket/QR mới.
- Trạng thái trên trang đang mở được làm mới theo nhịp polling 5 giây; dừng hoặc giảm hoạt động khi trang bị ẩn/rời đi. Không dùng trạng thái giao diện làm căn cứ cho thao tác ghi.

### 2.3 Các nút “Sắp có” hiện tại

| Vị trí | Module 7 xử lý | Lý do |
|---|---|---|
| Menu dùng chung: “Lịch sử đặt sân — Sắp có” | Bỏ nhãn “Sắp có”, chuyển thành liên kết tới trang lịch sử | Thuộc trực tiếp FR-09 |
| Menu dùng chung: “Tin tức thể thao — Sắp có” | Giữ nguyên | Tin tức RSS là hạng mục tùy chọn, ngoài module 7 |
| Trang vé: “Xem lịch sử đặt sân — Sắp có” | Bỏ disabled, chuyển thành liên kết tới trang lịch sử | Thuộc trực tiếp FR-09 |
| Trang vé: “Tìm đối — Sắp có” | Giữ nguyên | Ghép/tìm đối thuộc module 11; module này không làm nghiệp vụ tìm đối |
| Trang vé: “Tải vé PDF — Sắp có” | Giữ nguyên | Không thuộc FR-09; không tạo chức năng PDF trong module 7 |

### 2.4 Kiểm thử Module 7

- API: chỉ thấy booking của chính user; user khác lấy chi tiết nhận `404`; lọc trạng thái và phân trang chính xác, không lộ dữ liệu qua số đếm.
- Trạng thái: kiểm tra nhãn **Sắp tới** tại `now < bắt đầu`, **Đang trong trận** tại `now = bắt đầu` và đến trước kết thúc, **Hoàn thành** tại `now = kết thúc`; `PENDING`/`EXPIRED` hiển thị riêng; kiểm tra job không ghi `COMPLETED` trước kết thúc và chạy lặp không đổi kết quả. Job và nhãn dùng chung một hàm điều kiện.
- UI: `PENDING` còn hạn có countdown/nút thanh toán nhưng không QR/stepper; `EXPIRED` có báo hết hạn/đặt lại; `CONFIRMED` mở lại đúng QR hiện có; lọc và chuyển trang giữ đúng dữ liệu.

## 3. Phần B — Module 6: Hủy và hoàn tiền

### 3.1 API và chính sách

1. Mở rộng đúng route `POST /api/v1/bookings/{id}/cancel` hiện có; không tạo route hủy booking khác.
2. Thêm `GET /api/v1/bookings/{id}/cancel-preview` để trả thông tin sân/khung giờ, tiền đã trả và số tiền hoàn dự kiến cho popup; route chỉ đọc, không đổi trạng thái hay ghi khoản hoàn.
3. Mốc chính sách là thời điểm xác nhận hủy trừ giờ bắt đầu khung đầu tiên, quy đổi UTC+7:

   | Thời gian còn tới khung đầu | Hoàn trên `paid_amount` | Ranh giới |
   |---|---:|---|
   | `>= 24:00:00` | 100% | Đúng 24 giờ thuộc bậc 100% |
   | `>= 06:00:00` và `< 24:00:00` | 50% | Đúng 6 giờ thuộc bậc 50% |
   | `< 06:00:00` | 0% | Dưới 6 giờ không hoàn |

   `PENDING` chưa thanh toán không phát sinh hoàn. Phần tiền hoàn luôn tính trên `paid_amount`, không tính trên tổng đơn hoặc `amount_due`.
4. `POST` nhận `cancellation_reason` tùy chọn; server tự lấy user, booking, payment, slot và trạng thái từ DB. User không phải chủ booking nhận `404`.
5. Trong một transaction InnoDB duy nhất, khóa dòng theo thứ tự cố định: booking, payment, rồi các slot theo `id` tăng dần; xác thực lại chủ đơn/trạng thái/thời gian, rồi:
   - cập nhật booking thành `CANCELLED`, `cancelled_by='USER'`, `cancelled_at`, `cancellation_reason`;
   - giải phóng các slot thuộc booking về `AVAILABLE` (cả slot `LOCKED` của PENDING và `BOOKED` của CONFIRMED, chỉ khi còn gắn với booking đó);
   - với payment `PAID`, ghi `refunded_amount`/`refunded_at` và đổi `status` thành `REFUNDED` nếu hoàn lớn hơn 0; hoàn 0 giữ `PAID` và `refunded_amount=0`;
   - với payment chưa trả, không tạo hoàn, không đổi thành `REFUNDED`.
6. Số hoàn 50% được làm tròn xuống đến đồng (`FLOOR(paid_amount / 2)`); test Phần B phải có số tiền lẻ để xác nhận quy tắc.
7. Hủy lặp hoặc hai request đồng thời: request sau nhận `409`; không cập nhật/hoàn lần hai. Booking `CANCELLED`, `EXPIRED`, `COMPLETED`, booking đang trong trận và booking đã bắt đầu đều nhận `409`. Việc job chưa kịp ghi `COMPLETED` không được làm cho booking đã qua giờ kết thúc đủ điều kiện hủy.
8. Nếu `PENDING` đã quá `lock_expires_at` nhưng job dọn chưa chạy, coi đơn là hết hạn, giải phóng/đánh dấu hết hạn theo cơ chế hiện có và từ chối hủy bằng `409`; không biến booking hết hạn thành booking user hủy.

### 3.2 Giao diện

- Nút “Hủy” xuất hiện ở lịch sử và chi tiết chỉ khi booking còn đủ điều kiện; không hiện cho booking đang trong trận/đã hoàn thành, đã hủy hoặc hết hạn.
- Popup xác nhận hiển thị cơ sở/sân, ngày và giờ, lý do tùy chọn, số tiền đã trả và khoản hoàn dự kiến từ API preview. Chỉ gửi POST sau thao tác xác nhận rõ ràng.
- Server tính lại khoản hoàn trong POST hủy. Nếu số hoàn hiện tính khác số đã hiển thị trong popup, POST trả `409` kèm số tiền hoàn mới; giao diện tải lại preview để người dùng xác nhận lại.
- Sau thành công, tải lại dữ liệu từ API để cập nhật trạng thái, tiền hoàn và thao tác; xử lý `409` bằng thông báo trạng thái mới và tải lại.

### 3.3 Kiểm thử Module 6

- Ba bậc hoàn và hai ranh giới bắt buộc: đúng 24 giờ, đúng 6 giờ; thêm trường hợp ngay dưới các ngưỡng để tránh sai toán tử. Với số `paid_amount` lẻ ở bậc 50%, xác nhận hoàn `FLOOR(paid_amount / 2)`.
- Preview không còn khớp số tiền tại lúc POST: trả `409` kèm số hoàn mới, không hủy/ghi hoàn cho đến khi user xác nhận lại.
- Hủy `PENDING` chưa thanh toán không hoàn; hủy hai lần/đồng thời chỉ có một kết quả thành công; user khác nhận `404`; booking đang trong trận, `COMPLETED`, `CANCELLED`, `EXPIRED` nhận `409`.
- Kiểm tra nguyên tử: booking, payment, slot cùng rollback khi có lỗi; slot `BOOKED` của booking bị hủy được nhả; payment hoàn 0 vẫn `PAID`; request lặp không hoàn hai lần.
- Preview không ghi dữ liệu và hiển thị đúng số tiền theo chính sách.

## 4. Phần C — Ngoài phạm vi

- Không gửi thông báo (module 8).
- Không triển khai hủy yêu cầu tìm đối. Chỉ để điểm tích hợp/call site cho module 11; không gọi một luồng hủy tìm đối chưa tồn tại và không ghi bảng `match_requests` trong module này.
- Không làm đánh giá (module 9), Admin hủy sự cố (module 10), tải vé PDF hoặc nghiệp vụ tìm đối.
- Không tự sửa roadmap/changelog trong giai đoạn lập kế hoạch. Sau khi từng module hoàn tất và được kiểm thử, cập nhật trạng thái module tương ứng cùng changelog theo quy trình dự án.

## 5. Danh sách file dự kiến và thứ tự thực hiện

### Commit triển khai 1 — Module 7

| Thứ tự | File | Thay đổi |
|---:|---|---|
| 1 | `backend/src/bookings/bookings.repository.js` | Truy vấn danh sách theo user/filter/page, lấy đủ payment/slot; truy vấn và cập nhật trạng thái hoàn tất có điều kiện |
| 2 | `backend/src/bookings/bookings.service.js` | Validate bộ lọc/phân trang, dựng trạng thái hiển thị UTC+7, trả chi tiết hết hạn để xem lịch sử, thêm thao tác job hoàn tất |
| 3 | `backend/src/bookings/bookings.routes.js` | Thêm GET danh sách trước `/:id`, giữ xác thực bắt buộc |
| 4 | `backend/src/server.js` | Gọi job hoàn tất cùng chu kỳ nền hiện có; giữ chạy lặp an toàn và log lỗi riêng |
| 5 | `backend/tests/bookings.integration.test.js` và test phù hợp trong `backend/tests/` | Bổ sung kiểm thử API, quyền sở hữu, lọc/phân trang, trạng thái và job |
| 6 | `frontend/booking/bookings-api.js` | Bổ sung hàm đọc lịch sử, lọc/phân trang nếu cần; giữ xử lý lỗi/401 hiện có |
| 7 | `frontend/lich-su-dat-san.html` (mới) | Trang lịch sử và bộ lọc |
| 8 | `frontend/chi-tiet-don-dat-san.html` (mới) | Trang chi tiết và thao tác theo trạng thái |
| 9 | `frontend/booking/booking-history-page.js` (mới), `frontend/booking/booking-detail-page.js` (mới) | Tải API, render trạng thái/tiền/thao tác; mở lại vé qua trang vé hiện có |
| 10 | `frontend/booking/booking.css` | Style có scope cho lịch sử, chi tiết, trạng thái màu kèm chữ, responsive và popup dùng chung nếu cần |
| 11 | `frontend/shared/header.js` | Chuyển mục lịch sử từ disabled sang link, giữ Tin tức thể thao “Sắp có” |
| 12 | `frontend/dat-san-thanh-cong.html` | Kích hoạt nút lịch sử; giữ Tìm đối và Tải vé PDF “Sắp có” |
| 13 | `frontend/tests/booking-history.test.js` (mới) và test phù hợp | Kiểm tra hành vi lọc, trạng thái, action; không render QR/stepper cho PENDING |

Kiểm thử đạt trước khi tạo commit riêng cho Module 7, ví dụ `feat(bookings): add booking history and details`.

### Commit triển khai 2 — Module 6

| Thứ tự | File | Thay đổi |
|---:|---|---|
| 1 | `infra/database/migrations/006-add-booking-cancellation-details.sql` (mới) | Bổ sung `cancelled_by` và `cancellation_reason`; không tạo lại `cancelled_at` hoặc payment fields đã có |
| 2 | `infra/database/migrate-bookings.js` | Nhận diện migration 006 đã áp dụng/áp dụng dở, áp dụng và xác minh schema; chỉ chạy với database đích được cho phép |
| 3 | `backend/src/bookings/cancellation-policy.js` (mới) | Hàm tính bậc hoàn thuần, nhận thời điểm hiện tại và mốc khung đầu theo UTC+7 |
| 4 | `backend/src/bookings/bookings.repository.js` | Khóa và cập nhật booking/payment/slot trong cùng transaction; đọc dữ liệu preview |
| 5 | `backend/src/bookings/bookings.service.js` | Thêm preview, mở rộng cancel PENDING/CONFIRMED, ownership, 409, tính hoàn và chống hoàn lặp |
| 6 | `backend/src/bookings/bookings.routes.js` | Thêm GET `/:id/cancel-preview`; tiếp tục dùng POST `/:id/cancel` hiện tại |
| 7 | `backend/tests/cancellation-policy.test.js` (mới), `backend/tests/bookings.integration.test.js` | Kiểm tra ranh giới chính sách, quyền, trạng thái, atomicity và lặp |
| 8 | `frontend/booking/bookings-api.js` | Thêm hàm cancel-preview và truyền lý do tùy chọn tới POST hủy |
| 9 | `frontend/booking/cancellation-dialog.js` (mới) | Dùng chung popup preview/xác nhận ở trang lịch sử và chi tiết |
| 10 | `frontend/booking/booking-history-page.js`, `frontend/booking/booking-detail-page.js`, `frontend/booking/booking.css` | Hiện/ẩn nút Hủy theo dữ liệu server, mở popup và cập nhật sau hủy |
| 11 | `frontend/tests/booking-cancellation.test.js` (mới) | Kiểm tra preview, xác nhận, lỗi 409 và trạng thái nút |

Sau khi test đạt, tạo commit riêng cho Module 6, ví dụ `feat(bookings): add cancellation and refunds`. Không gộp hai module trong một commit.

### Quy tắc kiểm thử database

- Chỉ chạy integration test với cấu hình kiểm thử đã xác minh `APP_ENV=test`, `DB_NAME=sportbooking_test`; không dùng `sportbooking_system` kể cả đọc, migrate, seed, cleanup hay chạy test.
- Nếu không xác minh được database đích an toàn, chỉ chạy unit/frontend tests không kết nối database và ghi rõ phần integration test chưa chạy.
- Không chạy migration trên môi trường dùng chung trước khi kiểm tra đích kết nối; xác minh schema migration 006 trước/sau trên database kiểm thử được chỉ định.

## 6. Cách kiểm tra bằng mắt

1. Đăng nhập bằng user A, mở menu và vào “Lịch sử đặt sân”; xác nhận bộ lọc, phân trang, nhãn trạng thái có chữ, tiền đã trả/hoàn và các thao tác phù hợp.
2. Mở từng chi tiết: đơn PENDING còn hạn có countdown/nút “Tiếp tục thanh toán” nhưng không có QR/stepper; đơn EXPIRED có thông báo và “Đặt lại”; đơn CONFIRMED mở lại vé QR đúng booking.
3. Đăng nhập bằng user B và thử URL chi tiết của A: giao diện chỉ hiện không tìm thấy, không lộ thông tin đơn.
4. Kiểm tra menu lịch sử và nút lịch sử trên vé đã hoạt động; Tin tức thể thao, Tìm đối và Tải vé PDF vẫn hiện “Sắp có”.
5. Với đơn đủ điều kiện hủy, đối chiếu popup sân/giờ/lý do tùy chọn/số hoàn; xác nhận hủy rồi kiểm tra trạng thái, slot và số tiền trên lịch sử/chi tiết. Thử lại hủy và xác nhận `409` không phát sinh hoàn lần hai.
6. Không yêu cầu gửi thông báo, tìm đối, đánh giá, Admin hủy sự cố hoặc tải PDF trong smoke test của hai module này.

## 7. Câu hỏi còn mở

1. **Đã chốt:** API user `GET /bookings/{id}` chỉ cho chủ đơn; người khác nhận `404`. Admin có API riêng ở module 10.
2. **Đã chốt:** hoàn 50% làm tròn xuống đến đồng; test số tiền lẻ thuộc Phần B.
3. **Đã chốt:** dùng khoảng nửa mở `bắt đầu <= now < kết thúc` cho **Đang trong trận** và `now >= kết thúc` cho **Hoàn thành**; nhãn và job dùng cùng hàm điều kiện.
4. **Đã chốt:** URL `/lich-su-dat-san.html` và `/chi-tiet-don-dat-san.html?booking_id=...`.
5. **Đã chốt cho Phần B:** POST tính lại tiền hoàn, trả `409` kèm số mới nếu popup cũ; transaction khóa booking, payment, rồi slot theo ID tăng dần.

## Bổ sung Module 7 — Số liệu tóm tắt và lọc lịch sử

Phạm vi bổ sung đã được duyệt: API chỉ đọc `GET /api/v1/bookings/summary` trả số liệu theo user hiện tại, tổng thanh toán ròng và số đơn theo nhãn hiển thị; danh sách lịch sử hỗ trợ tìm theo mã/cơ sở và lọc môn. API danh sách/chi tiết trả thêm các trường chỉ đọc cần cho UI; mã đơn mới dùng định dạng `SPB-YYYYMMDD-xxxxxx` theo UTC+7, giữ nguyên mã hiện có. Frontend nối các thẻ/tabs, tìm kiếm debounce, bộ lọc môn và thông tin đặt/chi tiết sân. Không thay đổi luồng giữ chỗ, đặt sân hay thanh toán.

Kiểm thử hoàn tất: frontend 67/67, backend trên `sportbooking_test` 43/43; syntax check đạt. Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**.
