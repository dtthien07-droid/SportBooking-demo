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