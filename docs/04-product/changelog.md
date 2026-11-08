# 2026-11-08

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