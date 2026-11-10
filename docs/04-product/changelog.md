# 2026-11-09 — Module 7: Tóm tắt và lọc lịch sử đặt sân

- Thêm API chỉ đọc `/api/v1/bookings/summary` với số liệu và tổng thanh toán ròng chỉ thuộc user hiện tại; danh sách hỗ trợ tìm kiếm và lọc môn.
- Bổ sung các trường chỉ đọc cho API danh sách/chi tiết và định dạng mã mới `SPB-YYYYMMDD-xxxxxx` theo UTC+7; không đổi mã đơn hiện tại hay luồng đặt/giữ chỗ/thanh toán.
- Nối số liệu, tabs, tìm kiếm, lọc môn và thông tin đặt/chi tiết vào frontend; thêm điều hướng quay lại an toàn.
- Frontend tests: 67/67; `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 43/43; `node --check`: đạt. Kiểm tra trình duyệt: Chờ người dùng xác nhận.

# 2026-11-09 - Shared booking stepper

- Extracted the three-step booking progress UI into a shared component used by booking, payment, and ticket pages; step 1 is reachable from payment only while its hold remains active.
- Added step-state tests; frontend tests: 26/26. Visual browser confirmation: waiting for user confirmation.

# 2026-11-09 - Payment page follows booking step 2

- Rebuilt `thanh-toan.html` from the payment/hold section of the approved booking mockup; removed the normal-flow result buttons and static sample amounts.
- Payment confirmation now sends `SUCCESS`; the failure link is available only with `?demo=1`. Local transfer QR encodes `SPORTBOOKING|<booking_code>|<amount_due>` and is explicitly not VietQR.
- Creating a hold now navigates directly to payment. The shared pending banner is hidden on booking and payment pages; empty/expired holds no longer show an active-hold timer.
- `node --check` changed frontend JavaScript passed; frontend tests: 13/13; `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 34/34.
- Browser smoke test: waiting for user confirmation.

# 2026-11-09 - Shared pending-hold banner and encoding guard

- Added a shared pending-hold banner with server-based countdown, continue-payment and cancel actions; hidden on the payment page.
- Extended `GET /api/v1/bookings/pending` with `id`, facility/court, date, time ranges and remaining seconds.
- Restored the pending-booking Vietnamese message and added a UTF-8/no-BOM source scan.
- `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 34/34 passed.

# 2026-11-09 - Existing pending booking handling

- Added pending booking details to the 409 response and an authenticated `GET /api/v1/bookings/pending` endpoint.
- Expired PENDING bookings are marked EXPIRED and their locked slots released in the same transaction that attempts the next booking.
- Added continue/cancel actions and a remaining-time display on the booking page; cancellation retries the requested booking.
- `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 33/33 passed.

# 2026-11-09 ? Payment and ticket UI

- Added payment and QR ticket pages based on the existing mockups, wired to the booking/payment APIs, and enabled the booking-page CTA.
- Ticket QR is generated locally from the booking code; no external QR service is used.
- JavaScript syntax checks and local QR SVG generation passed. Browser smoke testing was not run; backend 33/33 result is user-reported.

# 2026-11-09 — Thanh toán giả lập và vé QR (FR-07)

- Thêm migration 005 cho `payment_attempts` và `booking_tickets`, cùng kiểm tra trạng thái migration trong runner.
- Thêm API tạo payment attempt giả lập và đọc payment history/ticket; SUCCESS cập nhật payment, booking, slots và tạo vé trong một transaction; FAILURE giữ booking chờ thanh toán.
- Thêm test tích hợp cho SUCCESS, FAILURE/retry, hết hạn, quyền sở hữu, thanh toán lặp cạnh tranh, expiry job và quyền Admin đọc payments.
- Chưa đánh dấu hoàn tất: migration chưa áp dụng/xác minh được vì MariaDB localhost:3306 không hoạt động; `npm test` bị sandbox chặn tiến trình con (`spawn EPERM`). Syntax check đạt và test unit slot-generator chạy trực tiếp đạt 3/3. Không kết nối hay thay đổi `sportbooking_dev` hoặc `sportbooking_system`.

# 2026-11-08

## 2026-11-08 — Tự sinh khung giờ

- Tách logic sinh slot dùng chung cho seed và job nền; seed và server đọc SLOT_DAYS_AHEAD (mặc định 14, hợp lệ 1–60). Job chạy lúc khởi động và mỗi giờ ở development, chỉ chèn slot thiếu cho sân/cơ sở đang hoạt động; test mặc định tắt.
- Kiểm thử tích hợp trên sportbooking_test: slot còn thiếu, chạy lặp, bảo toàn LOCKED/BOOKED, bỏ sân tắt, 24:00 và qua tháng.
- `node --check` các JavaScript liên quan đạt; `npm test` với APP_ENV=test, DB_NAME=sportbooking_test đạt 26/26.
- Nạp dotenv rõ ràng tại entrypoint, log cấu hình và kết quả từng lượt; startup trên sportbooking_dev đã bù 914 slot tới 2026-11-23. Thêm test log thành công/lỗi; `npm test` đạt 27/27.

## Tài liệu
- Chốt business-flow, spec, plan-auth, plan-seed-data, roadmap.
- Cập nhật số liệu khảo sát thành cầu lông 10, bóng đá mini 8, pickleball 11 (tổng 29, 6 quận).
- Thêm cột facilities.map_url, courts.initial_rating, survey_price_min/max; ánh xạ cột Excel và danh sách lỗi dữ liệu cần chuẩn hóa.
- API xem sân yêu cầu đăng nhập; công thức hạn chu kỳ tìm đối; ghi chú MariaDB 10.4 (XAMPP); quy ước tài khoản DB sportbooking_app, DB_NAME dev/test.

## Backend
- Khởi tạo backend: package.json (express, mysql2, dotenv, bcrypt), .env.example, .gitignore.
- src/config/database.js: guard từ chối root, sportbooking_system, DB test không kết thúc bằng _test.
- Migration 001 tạo users và user_sessions (infra/database/migrations).
- user.repository.js, session.repository.js: truy vấn tham số hóa, token phiên chỉ lưu hash.
- password.helper.js (bcrypt), auth.service.js: đăng ký, đăng nhập, khóa 15 phút sau 5 lần sai (khóa admin tách riêng).
- infra/database/seed-admin.js: chạy lặp không ghi đè admin, dùng ADMIN_PASSWORD_HASH.

## Kiểm thử
- backend/tests/auth-step5.test.js: 7 test đạt (bcrypt, đăng ký, trùng email/SĐT, khóa 5 lần sai, seed admin).

## Hạ tầng
- Tạo sportbooking_dev, sportbooking_test, tài khoản sportbooking_app chỉ có quyền trên hai database này; chạy migration 001 vào sportbooking_test.

# 2026-11-08 — Kiểm thử tích hợp xác thực (bước 9)

- Bổ sung test tích hợp HTTP trên `sportbooking_test`, có guard bắt buộc `APP_ENV=test` và `DB_NAME=sportbooking_test`; kiểm thử đăng ký, đăng nhập, khóa sau 5 lần sai, cookie/phiên, hồ sơ, đổi mật khẩu và giới hạn quyền.
- **Xong:** `npm test` chạy với cấu hình test, 9/9 test đạt; dữ liệu test được dọn sau khi chạy.
- Sửa binding tham số cho các trường hồ sơ không được gửi để PATCH một phần hoạt động đúng với MySQL.

# 2026-11-08 — Frontend xác thực và hồ sơ (bước 10–11)

- Bổ sung ba trang HTML đăng nhập, đăng ký và hồ sơ; dùng CSS/JS chung, Be Vietnam Pro, design tokens, trạng thái loading/lỗi, hiển thị lỗi cạnh trường, responsive và `prefers-reduced-motion`.
- Kết nối đúng các route auth/profile hiện có bằng `fetch` cùng origin và cookie phiên; không lưu mật khẩu/token trong Web Storage. Thêm `express.static` để phục vụ `frontend/` trong cùng origin.
- **Xong bước 10:** kiểm tra cú pháp JavaScript; 8/8 test auth không cần DB đạt; Express mock phục vụ đủ ba trang và hai asset; browser xác nhận xử lý 401, layout viewport 390px và điều hướng hết phiên về login kèm `returnTo`.
- **Chờ người dùng xác nhận:** smoke test thủ công bước 11 với database/cấu hình chạy thực tế (đăng ký, admin, khóa sau 5 lần sai, hồ sơ, đổi mật khẩu, đăng xuất).
- `npm test` chạy 8 test đạt; test tích hợp dừng ở guard do môi trường hiện tại không đặt `APP_ENV=test` và `DB_NAME=sportbooking_test`, trước khi kết nối database.

# 2026-11-08 — Giao diện auth theo mockup đã deploy

- Tạo `frontend/dang-nhap.html` và `frontend/dang-ky.html` từ markup mockup; giữ class và Tailwind CDN, bỏ script đăng nhập/đăng ký cũ, dùng `/shared/app.js` và API `/api/v1/auth/*`.
- Đăng nhập chỉ nhận email; đăng ký nhúng Điều khoản sử dụng và Chính sách bảo mật, chỉ bật ô đồng ý sau khi mở và cuộn đến cuối cả hai văn bản.
- Dùng ảnh login có sẵn tại `frontend/assets/images/sportbooking-login-courts.jpg` (đã đối chiếu trùng nguồn mockup); đổi `GET /` sang `/dang-nhap.html` và đồng bộ URL trong spec.
- Kiểm tra redirect và tài nguyên static bằng HTTP; browser xác nhận form gửi đúng payload (API được mock), email type/placeholder, legal-read gate, và không tràn ngang ở viewport 390px.
- `node --test tests/auth-step5.test.js tests/auth-step6-8.test.js`: 8/8 đạt. `npm test`: 8 test đạt; test tích hợp dừng ở guard do môi trường hiện tại không đặt `APP_ENV=test` và `DB_NAME=sportbooking_test`, trước khi kết nối database.

# 2026-11-08 — Trang chủ user và tìm sân

- Tạo `frontend/trangchu-user.html` và `frontend/tim-san.html` từ markup mockup; giữ Tailwind CDN và bố cục, loại bỏ script/dữ liệu sân, giá, thông báo, kèo và số liệu giả.
- Nối trang chủ và tìm sân tới `GET /api/v1/facilities` qua `frontend/shared/facilities-api.js`, dùng đúng query/response fields, `credentials: 'same-origin'`, textContent, loading/error/retry/empty states và chuyển 401 tới login.
- Tìm sân hỗ trợ môn, quận, từ khóa và phân trang; ngày/khung giờ/tiện ích để disabled do API không hỗ trợ. Đăng nhập thành công chuyển tới `/trangchu-user.html`.
- Kiểm tra JS syntax và 14 test auth/facility seed đạt. Browser với API giả xác nhận render sân, query filter/pagination, redirect 401 và redirect login thành công.
- Máy chủ đang chạy tại `http://localhost:3000` phục vụ trang nhưng `GET /api/v1/facilities` trả 404; chưa xác nhận dữ liệu thật qua runtime này. Không sửa backend/API.

# 2026-11-08 — Module 3 frontend: Chi tiết sân và lưới khung giờ

- Tạo `frontend/chi-tiet-san.html` từ mockup chi tiết sân; bỏ JavaScript cũ và dữ liệu sân/đánh giá/bản đồ/giá giả. Ảnh mặc định là hình minh họa theo môn; ảnh, chính sách, tiện ích, bản đồ và giá lấy từ response API.
- Nối trang với `GET /api/v1/facilities/:id` và `GET /api/v1/courts/:id/time-slots?date=...`; giữ `id`, `date`, sân con và URL tìm kiếm trên query string. Thẻ sân trên trang chủ/tìm sân mở chi tiết đúng facility ID.
- Lưới hiển thị toàn bộ slot API trả về, dùng `is_selectable`/trạng thái server, nhãn giờ vàng, tổng giờ/giá tạm tính; chọn liền kề và CTA không gọi API ghi.
- **Xong:** `node --check` các JavaScript thay đổi; test lựa chọn slot liền kề/không liền kề/bỏ đầu-giữa-cuối đạt 4/4; `npm test` backend với `APP_ENV=test`, `DB_NAME=sportbooking_test` đạt 16/16.
- **Chờ người dùng xác nhận:** smoke test thực tế tại `http://localhost:3000/`; API facilities của runtime hiện tại trả 404. Không chạy migration/seed; không sửa backend, API, `sportbooking_system` hoặc mockup.

# 2026-11-08 — Module 4: API giữ chỗ và frontend xác nhận

- Thêm API tạo/đọc/hủy booking với transaction, khóa dòng user/slot, snapshot giá và job giải phóng booking hết hạn; thêm integration tests cho hold, xung đột, concurrency, hủy và expiry.
- Nối lựa chọn slot liền kề sang `/dat-san.html`; trang xác nhận hiển thị thông tin server, gọi API khi xác nhận, đồng bộ booking khi tải lại, đếm ngược và hỗ trợ hủy.
- Browser smoke test với API giả xác nhận hiển thị tổng tiền, tạo hold và đồng hồ `10:00`, hủy giữ chỗ, tải lại đơn còn hạn, chuyển login với 401 và thông báo 409.
- `npm test` chạy với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 14/17 đạt; 3 integration test không thể kết nối do `sportbooking_app` bị từ chối quyền vào `sportbooking_test`. Chưa chạy GRANT vì môi trường hiện không có kết nối quản trị DB được cấu hình.
- **Chờ xác nhận:** cấp quyền DB test bằng tài khoản quản trị cục bộ rồi chạy lại `npm test` để xác nhận integration thật; không sử dụng `sportbooking_system` và không sửa mockups.
