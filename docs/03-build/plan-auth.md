# Kế hoạch — Đăng ký, đăng nhập, phân quyền, hồ sơ

> Phạm vi: roadmap module 1 (`FR-01`, `FR-03`). Kế hoạch đã được duyệt; chưa triển khai code. Nguồn nghiệp vụ là [business-flow.md](../01-plan/business-flow.md), thiết kế là [spec.md](../02-design/spec.md).

## 1. Framework đã được duyệt

**Framework: Express 5.** Framework HTTP gọn, phổ biến và phù hợp với REST API của đồ án; middleware xác thực/phân quyền tường minh, dễ tiếp cận và bảo trì. Frontend vẫn là HTML/CSS/JavaScript thuần, MySQL chỉ được truy cập từ backend.

Backend dùng `mysql2/promise` để truy vấn MariaDB, `bcrypt` với 12 rounds để băm/so mật khẩu và thư viện kiểm thử Node.js.

Máy chủ database thực tế là MariaDB 10.4 trong XAMPP; driver `mysql2` dùng được với MariaDB. Migration phải tương thích MariaDB 10.4: `DATETIME(3)` được hỗ trợ; JSON có thể lưu bằng `LONGTEXT` kèm kiểm tra hợp lệ; `CHECK` được thực thi từ phiên bản 10.2.1.

## 2. Cấu trúc thư mục dự kiến

Các đường dẫn dưới đây là cấu trúc triển khai dự kiến. Giữ mỗi phần trong đúng folder trách nhiệm; không tạo package/config mới tại root, ngoại trừ `.gitignore` được phép theo luật dự án.

```text
backend/
  package.json
  .env.example
  src/
    app.js
    config/
      database.js
      environment.js
    middleware/
      require-auth.js
      require-role.js
      error-handler.js
    shared/
      async-handler.js
      api-error.js
    routes/
      health.routes.js
    auth/
      routes/
        auth.routes.js
        profile.routes.js
      controllers/
        auth.controller.js
        profile.controller.js
      services/
        auth.service.js
        session.service.js
        profile.service.js
      repositories/
        user.repository.js
        session.repository.js
      validation/
        auth.validation.js
        profile.validation.js
  tests/
    auth/
      auth.test.js
      profile.test.js
      authorization.test.js
    health.test.js
infra/
  database/
    migrations/
      001-create-auth-tables.sql
    seed-admin.js
frontend/
  auth/
    login.html
    register.html
    auth.css
    auth.js
  profile/
    profile.html
    profile.js
  services/
    auth-service.js
  shared/
    api-client.js
.gitignore
```

`backend/README.md` và `frontend/README.md` đã được đọc; backend phụ trách API/validation/nghiệp vụ, frontend phụ trách giao diện/routing và gọi API qua `services/`. `infra/README.md` xác định database/migration thuộc `infra/`. Các file `README.md` hiện có không nằm trong danh sách sửa.

### Phục vụ frontend

Backend dùng `express.static` để phục vụ thư mục `frontend/`, đặt frontend và API cùng origin. Vì vậy không cần cấu hình CORS; cookie session `SameSite=Lax` hoạt động cùng origin. Trong môi trường phát triển, chạy frontend và API cùng lúc bằng một lệnh `npm start` từ thư mục `backend/`.

## 3. Danh sách file tạo/sửa dự kiến

| Thao tác | File | Mục đích |
|---|---|---|
| Tạo | `backend/package.json` | Khởi tạo package backend sau khi framework được duyệt; khai báo scripts chạy server/test và dependencies tối thiểu. |
| Tạo | `backend/.env.example` | Khai báo tên biến cấu hình và placeholder, không chứa credentials thật. |
| Tạo | `backend/src/app.js` | Tạo ứng dụng Express 5, gắn route, middleware dùng chung và cấu hình cookie. |
| Tạo | `backend/src/config/` | Cấu hình database và kiểm tra biến môi trường. |
| Tạo | `backend/src/middleware/` | Middleware dùng chung để xác thực, kiểm tra role và xử lý lỗi. |
| Tạo | `backend/src/shared/` | Tiện ích/lỗi dùng chung cho API, không chứa logic riêng của module auth. |
| Tạo | `backend/src/routes/health.routes.js` | Endpoint public `GET /health` ở gốc, không có tiền tố `/api/v1`. |
| Tạo | `backend/src/auth/routes/auth.routes.js`, `backend/src/auth/routes/profile.routes.js` | Route đăng ký/đăng nhập/đăng xuất/me và hồ sơ/đổi mật khẩu. |
| Tạo | Các file controller/service/repository/validation trong `backend/src/auth/` | Tách HTTP, nghiệp vụ, truy vấn auth/profile và validation; code riêng module auth nằm dưới `src/auth/`. |
| Tạo | `infra/database/migrations/001-create-auth-tables.sql` | Tạo `users` và `user_sessions` với PK, FK, unique, index và kiểu dữ liệu theo mục 5. |
| Tạo | `infra/database/seed-admin.js` | Tạo admin mặc định theo `.env`; chạy lặp không tạo trùng và không ghi đè tài khoản đã có. |
| Tạo | Các file trong `backend/tests/auth/` và `backend/tests/health.test.js` | Unit/integration tests cho auth, profile, quyền và health. |
| Tạo | Các trang/script/CSS trong `frontend/auth/`, `frontend/profile/`, `frontend/services/`, `frontend/shared/` | Form đăng nhập/đăng ký, trang hồ sơ, gọi API và hiển thị loading/lỗi/thành công; không truy cập DB. |
| Tạo hoặc sửa | `.gitignore` tại root | Bỏ qua mọi `.env` thật, `node_modules/`, log và kết quả test; không loại trừ `backend/.env.example`. Root `.gitignore` hiện chưa thấy trong workspace. |
| Không sửa | `docs/01-plan/business-flow.md`, `docs/02-design/spec.md`, README hiện có | Chỉ tham chiếu làm nguồn sự thật; ngoài phạm vi module implementation. |

## 4. API trong phạm vi

Các endpoint theo [spec mục 5.1](../02-design/spec.md#51-xác-thực-và-hồ-sơ), có tiền tố `/api/v1` ngoại trừ `GET /health` đặt ở gốc. Tất cả kiểm tra quyền và dữ liệu ở server; không trả `password_hash`, token thô hoặc thông tin bí mật.

| API | Hành vi cần triển khai |
|---|---|
| `POST /api/v1/auth/register` | Public. Nhận họ tên, email, mật khẩu, SĐT và xác nhận điều khoản; validate mật khẩu tối thiểu 8 ký tự, email/SĐT; tạo tài khoản `USER` mặc định; trả `201` với hồ sơ không nhạy cảm. Điều khoản cố định: “Tôi đồng ý sử dụng SportBooking đúng mục đích đặt sân, cung cấp thông tin chính xác, và tuân thủ nội quy, chính sách hủy của từng cơ sở.” Lỗi: `400` dữ liệu sai, `409` email hoặc SĐT trùng. |
| `POST /api/v1/auth/login` | Public. Nhận email/mật khẩu; kiểm tra trạng thái admin lock và khóa tạm do sai mật khẩu; nếu thành công tạo phiên 8 giờ, trả user/role. Lỗi: `400`, `401`, `403` nếu admin khóa, `423` nếu đang tạm khóa do sai mật khẩu. |
| `POST /api/v1/auth/logout` | User/Admin. Thu hồi phiên phía server và xóa cookie; trả `204`. Chưa xác thực trả `401`. |
| `GET /api/v1/auth/me` | User/Admin. Trả hồ sơ và vai trò theo phiên hiện tại; không nhận user ID từ client làm căn cứ quyền. Phiên hết hạn trả `401`. |
| `PATCH /api/v1/users/me` | User/Admin. Chỉ cập nhật trường hồ sơ được phép; SĐT phải unique; lỗi `400`, `401`, `409`. |
| `PATCH /api/v1/users/me/password` | User/Admin. Xác minh mật khẩu hiện tại, validate mật khẩu mới tối thiểu 8 ký tự, lưu hash mới; lỗi `400` hoặc `401`. |
| `GET /health` | Public tại gốc, không có `/api/v1`. Trả trạng thái service; không trả secret, thông tin kết nối hoặc chi tiết nội bộ. Trả `503` nếu service không sẵn sàng theo quy ước spec. |

**Phân quyền:** đăng ký không nhận/không cho chọn `role`; tài khoản tự đăng ký luôn là `USER`. Middleware kiểm tra session và vai trò ở server. API Admin không thuộc triển khai đầy đủ module này nhưng phải bị từ chối đối với user thường (`403`). Admin không được tự khóa tài khoản đang đăng nhập. Khóa do Admin được tách biệt với khóa tạm thời do đăng nhập sai.

Đăng ký thành công điều hướng về đăng nhập; đăng nhập thành công điều hướng `USER` tới Trang chủ và `ADMIN` tới Dashboard. Hồ sơ chỉ đọc/sửa chính mình. Form và API phải dùng đúng đoạn điều khoản cố định đã duyệt; không thay đổi hoặc tự diễn giải nội dung.

## 5. Database

Tạo hai bảng theo [spec mục 4.1](../02-design/spec.md#41-bảng-và-cột). Migration phải dùng InnoDB, `utf8mb4`, chạy có kiểm soát và không làm mất dữ liệu sẵn có.

### `users`

- `id BIGINT UNSIGNED` — PK.
- `full_name VARCHAR(120) NOT NULL`.
- `email VARCHAR(254) NOT NULL UNIQUE`.
- `password_hash VARCHAR(255) NOT NULL` — chỉ lưu bcrypt hash.
- `phone VARCHAR(20) NULL UNIQUE`.
- `gender ENUM('MALE','FEMALE','OTHER') NULL`.
- `skill_level ENUM('BEGINNER','INTERMEDIATE','GOOD') NULL`.
- `role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER'`.
- `account_status ENUM('ACTIVE','ADMIN_LOCKED') NOT NULL DEFAULT 'ACTIVE'`.
- `failed_login_count TINYINT UNSIGNED NOT NULL DEFAULT 0`.
- `login_locked_until DATETIME(3) NULL`.
- `terms_accepted_at DATETIME(3) NULL`.
- `created_at`, `updated_at DATETIME(3) NOT NULL`.
- Index `(role, account_status)`.

### `user_sessions`

- `id BIGINT UNSIGNED` — PK.
- `user_id BIGINT UNSIGNED NOT NULL` — FK tới `users.id`.
- `token_hash CHAR(64) NOT NULL UNIQUE` — hash SHA-256 của session token, token thô không lưu vào DB.
- `expires_at DATETIME(3) NOT NULL`.
- `revoked_at DATETIME(3) NULL`.
- `created_at DATETIME(3) NOT NULL`.
- Index `(user_id, expires_at)`.

## 6. Mật khẩu, đăng nhập sai và phiên 8 giờ

### Mật khẩu

1. Khi đăng ký/đổi mật khẩu, kiểm tra yêu cầu tối thiểu 8 ký tự ở server; giao diện chỉ hỗ trợ, không thay thế validation server.
2. Băm mật khẩu bằng bcrypt; chỉ lưu hash ở `users.password_hash`, không log mật khẩu/hash và không trả hash qua API.
3. Khi đăng nhập, dùng bcrypt compare với hash đã lưu; không so sánh mật khẩu dạng rõ.
4. Cấu hình bcrypt rounds bằng biến môi trường `BCRYPT_ROUNDS=12`, theo giá trị đã duyệt.

### Giới hạn đăng nhập sai

1. Mỗi lần xác thực thất bại liên tiếp, tăng `failed_login_count` trong thao tác cập nhật nguyên tử ở server.
2. Đến lần sai thứ 5, đặt `login_locked_until` = thời điểm hiện tại + 15 phút; từ chối đăng nhập trong thời gian này với HTTP `423`.
3. Khi hết 15 phút, lần đăng nhập kế tiếp tự xóa thời hạn khóa và reset bộ đếm trước khi xác thực tiếp. Đăng nhập thành công cũng reset `failed_login_count` và `login_locked_until`.
4. `account_status = ADMIN_LOCKED` là trạng thái riêng; tài khoản bị admin khóa nhận `403` kể cả khi đã hết khóa tạm. Không tự thay đổi trạng thái khóa Admin theo thời gian.
5. Không tiết lộ trong phản hồi đăng nhập rằng email không tồn tại hay mật khẩu sai; cả hai dùng phản hồi `401` thống nhất, ngoại trừ trạng thái khóa đã được xác định.

### Phiên

1. Khi login thành công, sinh token ngẫu nhiên mật mã đủ mạnh (đề xuất 32 bytes), gửi token trong cookie `HttpOnly`, `SameSite=Lax`, và `Secure` trong môi trường HTTPS.
2. Lưu SHA-256 token vào `user_sessions.token_hash`, cùng `user_id`, `created_at`, `expires_at` bằng thời điểm tạo + 8 giờ. Không lưu token thô ở database/localStorage.
3. Mỗi API cần đăng nhập đọc cookie, hash token, tìm session chưa thu hồi và chưa hết hạn, rồi nạp user/role từ DB. Quyền sở hữu/role được kiểm tra ở server.
4. Logout đặt `revoked_at`, xóa cookie ở response; session hết hạn bị từ chối `401`. Không gia hạn trượt; user quay lại sau khi hết hạn phải đăng nhập lại.
5. Cấu hình timezone nhất quán theo spec (`DATETIME(3)` lưu UTC; business time UTC+7). Kiểm tra thời hạn bằng thời gian server, không tin client.

## 7. Endpoint `/health`

- `GET /health` xác nhận tiến trình backend đang phục vụ request.
- Response khỏe: `200`, ví dụ `{ "status": "ok" }`.
- Nếu thiết kế health check bao gồm DB, chỉ trả `503` khi dependency cần thiết không sẵn sàng; response không nêu host, username, password, stack trace hoặc schema nội bộ.
- Không yêu cầu đăng nhập; không dùng endpoint này để lộ cấu hình môi trường.

## 8. Cấu hình môi trường và `.gitignore`

Tạo `backend/.env.example` với placeholder, không ghi credentials thật:

```dotenv
APP_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=sportbooking_dev
DB_NAME_TEST=sportbooking_test
DB_USER=sportbooking_app
DB_PASSWORD=
BCRYPT_ROUNDS=12
SESSION_COOKIE_NAME=sportbooking_session
SESSION_TTL_HOURS=8
COOKIE_SECURE=false
ADMIN_PASSWORD_HASH=
```

`sportbooking_system` chứa dữ liệu khảo sát và tuyệt đối không dùng làm database phát triển/test cho module này. Chạy ứng dụng phát triển với `DB_NAME=sportbooking_dev`; test phải đặt `APP_ENV=test` và dùng `DB_NAME=sportbooking_test`. Tài khoản ứng dụng là `DB_USER=sportbooking_app`, không dùng `root`.

`ADMIN_PASSWORD_HASH` chỉ dùng khi cần seed tài khoản `admin@sportbooking.com` theo spec; hash được tạo bên ngoài luồng đăng ký và lấy từ `.env`, không ghi password/hash thật vào tài liệu hoặc source. `COOKIE_SECURE=false` chỉ dành cho local HTTP; production phải dùng HTTPS và bật Secure cookie.

Tạo/cập nhật `.gitignore` ở root (ngoại lệ được phép) để bỏ qua `**/.env`, `**/node_modules/`, log và output test. Không dùng pattern loại `.env.example`; kiểm tra `git status` trước khi kết thúc để bảo đảm `.env` thật không bị track.

## 9. Test cần viết

### Backend unit/integration

- Tạo database test riêng trước khi chạy test: kết nối MySQL bằng tài khoản phát triển được cấp, rồi chạy `CREATE DATABASE sportbooking_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` (có thể dùng `CREATE DATABASE IF NOT EXISTS` cho môi trường test dùng lại). Không chạy lệnh này trên `sportbooking_system`.
- Mọi lệnh test phải chạy với `APP_ENV=test`, `DB_NAME=sportbooking_test` và cấu hình kết nối test riêng. Trước khi mở kết nối hoặc chạy migration, test runner kiểm tra `APP_ENV === 'test'` và từ chối chạy nếu `DB_NAME` không kết thúc bằng `_test`; không được fallback sang `sportbooking_dev` hoặc `sportbooking_system`.
- Đăng ký hợp lệ: user tạo với role `USER`; response không có hash; hash bcrypt verify được.
- Đăng ký từ chối mật khẩu dưới 8 ký tự, email sai định dạng, thiếu trường/điều khoản.
- Email trùng hoặc SĐT trùng nhận `409`; không tạo bản ghi thứ hai.
- Đăng nhập đúng tạo phiên 8 giờ; cookie có `HttpOnly`, `SameSite`, `Secure` theo môi trường; DB chỉ lưu token hash.
- Đăng nhập sai trả `401`; kiểm tra count tăng liên tiếp; lần sai thứ 5 kích hoạt khóa 15 phút và phản hồi kế tiếp trong thời gian khóa trả `423`.
- Sau 15 phút, trạng thái tự mở ở lần request tiếp theo; đăng nhập thành công reset bộ đếm. Không cần chờ đồng hồ thật: dùng clock giả lập trong test.
- User bị `ADMIN_LOCKED` nhận `403`; hết khóa tạm không làm mở khóa Admin.
- Logout thu hồi session và xóa cookie; dùng lại token đã thu hồi trả `401`.
- Session hết hạn sau 8 giờ trả `401`; không có gia hạn trượt.
- `GET /auth/me` không nhận danh tính từ input; profile chỉ xem/sửa user hiện tại.
- Cập nhật SĐT trùng trả `409`; cập nhật profile không thể đổi role/account status.
- Đổi mật khẩu xác minh mật khẩu hiện tại; hash mới dùng được, mật khẩu cũ không còn xác thực.
- API Admin trả `403` cho phiên `USER`; truy cập không phiên trả `401`.
- `/health` trả trạng thái không chứa biến môi trường, credentials, stack trace hoặc chi tiết nội bộ.

### Frontend smoke/behavior

- Form đăng ký/đăng nhập gọi đúng API qua `services/`, hiển thị loading và lỗi `400/401/403/423/409`.
- Đăng ký thành công đưa user về đăng nhập; login thành công điều hướng đúng theo role.
- Hồ sơ hiển thị và cập nhật đúng dữ liệu trả về; logout quay về đăng nhập.
- Thử mở route Admin bằng user thường không cấp quyền chỉ nhờ ẩn menu; backend vẫn phải trả `403`.

Test tích hợp DB chỉ chạy trên database test riêng đã tạo theo hướng dẫn trên; không chạy migration/test phá hoại trên dữ liệu khảo sát hay DB dùng chung.

## 10. Thứ tự thực hiện

1. Express 5, điều khoản đăng ký và bcrypt rounds 12 đã được duyệt. Trước khi code, kiểm kê cấu trúc hiện tại và trạng thái Git; xác nhận không có thay đổi người dùng bị ghi đè.
2. Tạo `backend/package.json`, scripts, cấu hình môi trường và `.gitignore`; cài dependency đã được duyệt.
3. Tạo database test riêng `sportbooking_test` bằng MySQL với charset/collation `utf8mb4`; xác nhận cấu hình test không trỏ tới `sportbooking_system`.
4. Viết migration `users`/`user_sessions`, áp dụng vào database test, kiểm tra PK/FK/unique/index và rollback; tạo lớp kết nối/repository với guard từ chối chạy test khi `APP_ENV !== 'test'` hoặc `DB_NAME` không kết thúc bằng `_test`.
5. Viết helper bcrypt (12 rounds), đăng ký/login với xử lý trùng email/SĐT, bộ đếm lỗi và khóa 15 phút; tạo `infra/database/seed-admin.js` dùng `ADMIN_PASSWORD_HASH`, chạy lặp không tạo trùng và không ghi đè tài khoản đã tồn tại.
6. Viết session service/cookie, middleware xác thực, logout, `/auth/me`; kiểm tra hết hạn/thu hồi và role.
7. Viết profile API, bảo đảm chỉ chủ hồ sơ sửa được và không thể tự đổi role/trạng thái tài khoản.
8. Viết `/health` và error handler chuẩn JSON; xác nhận không lộ chi tiết nhạy cảm.
9. Viết test backend theo mục 9, sau đó chạy test chỉ trên DB test và sửa lỗi thuộc phạm vi module.
10. Tạo form đăng nhập/đăng ký, profile và API client thuần JS; bổ sung hai trang tĩnh Điều khoản sử dụng và Chính sách bảo mật, footer chung có liên kết đến hai trang trên mọi trang, cơ chế chỉ bật ô đồng ý sau khi người dùng mở và cuộn hết cả hai văn bản; kiểm tra trạng thái loading/lỗi/thành công và điều hướng. Bổ sung test backend xác nhận đăng ký thiếu `termsAccepted` bị từ chối với `400`.
11. Chạy smoke test, rà `.gitignore`/`git status`, xác nhận không có `.env` hoặc secret bị track.
12. Sau khi module hoàn tất và được xác nhận, cập nhật roadmap/changelog theo quy trình dự án.

## 11. Quyết định đã duyệt và trạng thái

- Framework backend: **Express 5**.
- Đăng ký chỉ thành công khi người dùng đã mở và cuộn hết Điều khoản sử dụng và Chính sách bảo mật rồi đánh dấu đồng ý; hai văn bản là trang công khai, liên kết ở footer chung trên mọi trang.
- bcrypt rounds: **12**.
- Code dùng chung (`app.js`, `config/`, `middleware/`, `shared/`) nằm trong `backend/src/`; code riêng auth nằm trong `backend/src/auth/`.
- `GET /health` đặt ở gốc, không có tiền tố `/api/v1`.

Kế hoạch đã được duyệt; thay đổi này chỉ cập nhật tài liệu. Chưa tạo/sửa code, migration, `.gitignore`, `.env.example` hay package manifest.
