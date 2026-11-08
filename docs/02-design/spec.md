# Đặc tả thiết kế — SportBooking

> Tài liệu thiết kế dựa trên [business-flow.md](../01-plan/business-flow.md), là nguồn sự thật nghiệp vụ. Khi có khác biệt, ưu tiên business-flow. Dữ liệu trong [phiếu yêu cầu](../01-plan/phieu-yeu-cau.md) chỉ được tham chiếu, không chỉnh sửa.

## Mục lục

- [1. Công nghệ và kiến trúc](#1-công-nghệ-và-kiến-trúc)
- [2. Trang và điều hướng](#2-trang-và-điều-hướng)
- [3. Thiết kế giao diện](#3-thiết-kế-giao-diện)
- [4. Mô hình dữ liệu MariaDB 10.4](#4-mô-hình-dữ-liệu-mariadb-104)
- [5. API](#5-api)
- [6. Tác vụ nền và cập nhật trạng thái](#6-tác-vụ-nền-và-cập-nhật-trạng-thái)
- [7. Chống đặt trùng và xử lý đồng thời](#7-chống-đặt-trùng-và-xử-lý-đồng-thời)
- [8. Dữ liệu khởi tạo và import khảo sát](#8-dữ-liệu-khởi-tạo-và-import-khảo-sát)
- [9. Tiêu chí nghiệm thu](#9-tiêu-chí-nghiệm-thu)
- [10. Giả định và câu hỏi mở](#10-giả-định-và-câu-hỏi-mở)

## 1. Công nghệ và kiến trúc

| Thành phần | Công nghệ / quy định |
|---|---|
| Backend | Node.js; cung cấp API và xử lý nghiệp vụ. Framework Node.js chưa được chốt. |
| Frontend | HTML, CSS và JavaScript thuần, không dùng framework. |
| Database | Máy chủ thực tế là MariaDB 10.4 trong XAMPP; driver `mysql2` dùng được. `sportbooking_system` là database chứa dữ liệu khảo sát, không dùng cho phát triển/kiểm thử; dùng `sportbooking_dev` và `sportbooking_test`. Migration phải tương thích MariaDB 10.4: hỗ trợ `DATETIME(3)`, có thể lưu JSON bằng `LONGTEXT` kèm kiểm tra hợp lệ, và `CHECK` được thực thi từ MariaDB 10.2.1. |
| Realtime | Polling tối đa mỗi 5 giây cho lịch khung giờ, trạng thái đơn, tìm đối và số thông báo chưa đọc. |
| Giao tiếp | Frontend chỉ gọi backend qua API HTTP/JSON. Frontend không chứa thông tin kết nối hoặc truy vấn database. |
| Truy cập dữ liệu | Chỉ backend kết nối MariaDB; mọi quyền sở hữu, vai trò, trạng thái và thời hạn được kiểm tra lại ở server trước khi ghi. |
| Múi giờ | Múi giờ nghiệp vụ là `Asia/Ho_Chi_Minh` (UTC+7). Cách lưu và chuyển đổi thời điểm được nêu tại [10. Giả định và câu hỏi mở](#10-giả-định-và-câu-hỏi-mở). |

```text
Browser (HTML/CSS/JS) -- HTTP/JSON --> Backend Node.js -- MariaDB 10.4 --> sportbooking_dev / sportbooking_test
```

## 2. Trang và điều hướng

Frontend được phục vụ tại gốc `/`; `GET /` chuyển tới `/dang-nhap.html`. URL của các trang xác thực là `/dang-nhap.html` và `/dang-ky.html`; hồ sơ là `/profile/profile.html`. Các trang có điều hướng **Quay lại**, ngoại trừ Đăng nhập và Đăng ký. Nút quay lại ưu tiên lịch sử trình duyệt; nếu không có trang trước phù hợp thì dùng đích dự phòng trong bảng. Khi hết phiên, trang yêu cầu đăng nhập và trở lại trang trước sau khi đăng nhập thành công. Các trang dữ liệu đều có trạng thái đang tải, lỗi có thể thử lại, và trống có hướng dẫn hành động tiếp theo.

### 2.1 Menu User

| Trang | Thành phần chính | Loading / lỗi / trống | Quay lại |
|---|---|---|---|
| Trang chủ | Hero ảnh sân; ô tìm nhanh môn, quận/huyện, ngày, giờ; sân nổi bật; nút **Đặt sân ghép đối ngay**; điều hướng user. | Skeleton hero/card; lỗi tải có nút thử lại; không có sân nổi bật thì hiện lời mời tìm sân. | Lịch sử trình duyệt; dự phòng trang chủ. |
| Tìm sân | Bộ lọc môn, quận/huyện từ địa chỉ cơ sở, ngày/giờ; danh sách card sân; phân trang hoặc tải thêm. | Skeleton card; lỗi bộ lọc có thử lại; không có kết quả nêu rõ điều kiện lọc và nút xóa lọc. | Trang trước; dự phòng trang chủ. |
| Chi tiết sân và lịch khung giờ | Ảnh, tên/môn, địa chỉ, giờ mở cửa, hotline, giá, tiện ích, bản đồ, nội quy/chính sách hủy, đánh giá; lưới khung giờ; chọn một hay nhiều khung liên tiếp. Chỉ cầu lông và pickleball có lựa chọn đơn/đôi. | Khung giờ đang tải được vô hiệu hóa; lỗi tải lịch có thử lại; ngày không có khung khả dụng giải thích trạng thái và cho chọn ngày khác. | Trang tìm sân với bộ lọc trước đó; dự phòng tìm sân. |
| Xác nhận đặt sân | Tóm tắt sân/khung giờ/giá; thông tin user; lựa chọn trả 50% hoặc toàn bộ; bật/tắt tìm đối; kiểu tìm ngẫu nhiên/theo tiêu chí; tiêu chí và lời nhắn khi phù hợp. | Lỗi xác minh giá/khung giờ yêu cầu tải lại; nếu có đơn `PENDING`, cho tiếp tục đơn đó hoặc hủy trước khi tạo đơn mới. | Chi tiết sân, giữ lại ngày và lựa chọn khung giờ còn hợp lệ. |
| Thanh toán giả lập | Số tiền, phần còn phải trả tại sân nếu có, chọn chuyển khoản/MoMo/ATM nội địa/thẻ quốc tế; nút **Thành công** và **Thất bại**; đồng hồ giữ chỗ. | Hiển thị trạng thái đang xử lý; lỗi API cho thử lại khi lock còn hạn; hết hạn chuyển về chi tiết đơn đã hết hạn, không cho thanh toán tiếp. | Trang xác nhận đặt sân hoặc chi tiết đơn; dự phòng lịch sử đặt sân. |
| Đặt sân thành công / vé QR | Mã đơn, một vé QR cho toàn đơn, sân/khung giờ, hotline, bản đồ, tiền đã trả/còn phải trả tại sân; khu vực radar nếu có tìm đối. | Tải chi tiết/QR; lỗi tải có thể thử lại từ lịch sử; không áp dụng trạng thái trống. | Chi tiết đơn; dự phòng lịch sử đặt sân. |
| Kết quả ghép đối (B) | Hồ sơ đối thủ/đại diện, lời nhắn, sân/khung giờ, mã `SPB-MATCH-xxxx`, mức đóng góp bằng 1/2 giá sân, nhắc có mặt trước 10 phút. | Trong khi ghép hiển thị radar/đếm ngược; lỗi thao tác nêu nguyên nhân; nếu đã có người ghép thì báo rõ và tải lại lịch. | Chi tiết sân/lịch trước đó; dự phòng lịch sử đặt sân. |
| Lịch sử đặt sân | Danh sách đơn của user; lọc trạng thái; tiền đã trả/hoàn; trạng thái ghép; mở chi tiết, tiếp tục `PENDING`, hủy khi đủ điều kiện, đánh giá đơn đã hoàn thành, đặt lại. | Skeleton danh sách; lỗi có thử lại; chưa có đơn thì hướng dẫn tìm sân. | Trang trước; dự phòng trang chủ. |
| Chi tiết đơn | Thông tin sân, toàn bộ khung giờ, mã đơn/vé, thanh toán/hoàn, tìm đối; hành động phụ thuộc trạng thái và quyền. | Loading theo đơn; lỗi hoặc không tìm thấy thông báo rõ; không hiển thị thao tác hủy cho đơn không đủ điều kiện. | Lịch sử; dự phòng lịch sử đặt sân. |
| Thông báo | Chuông/số chưa đọc; popup xem nhanh với “x phút trước”; danh sách phân loại Tất cả, Lịch đặt sân & Giữ chỗ, Tìm đối & Ghép kèo, Thanh toán & Hoàn cọc, Hệ thống; đánh dấu đã đọc/xem chi tiết. | Loading danh sách; lỗi có thử lại; trống báo chưa có thông báo. | Trang trước; dự phòng trang chủ. |
| Hồ sơ | URL `/profile/profile.html`; tên, email, SĐT duy nhất, giới tính và trình độ nếu có; sửa hồ sơ, đổi mật khẩu, đăng xuất. | Loading hồ sơ; lỗi có thử lại; trường không tải không được âm thầm ghi đè. | Trang trước; dự phòng trang chủ. |
| Tin tức thể thao (tùy chọn) | Danh sách tin từ RSS, tiêu đề, nguồn, thời điểm và liên kết bài gốc. | Loading; lỗi nguồn RSS có thể thử lại; trống thông báo chưa có bài. Nguồn RSS chốt khi triển khai tính năng tùy chọn. | Trang trước; dự phòng trang chủ. |
| Đăng nhập / đăng ký | URL lần lượt `/dang-nhap.html` và `/dang-ky.html`; email + mật khẩu; đăng ký gồm thông tin hồ sơ và ô đồng ý với Điều khoản sử dụng cùng Chính sách bảo mật. Ô chỉ được bật sau khi người dùng mở và cuộn hết cả hai văn bản. Logo về trang đăng nhập. | Hai trang văn bản pháp lý công khai, xem không cần đăng nhập; footer chung trên mọi trang có liên kết đến cả hai trang. Lỗi xác thực/validation hiển thị cạnh trường và thông báo; loading khóa nút gửi; chỉ đăng ký thành công khi đã đồng ý; trang đăng ký thành công quay về đăng nhập theo nghiệp vụ. | Không hiển thị nút Quay lại. |
| Điều khoản sử dụng / Chính sách bảo mật | Hai trang văn bản pháp lý công khai, không yêu cầu đăng nhập. | Footer chung trên mọi trang liên kết đến cả hai trang. | Trang trước; dự phòng trang chủ. |

### URL trang frontend

| Trang | URL | Tham số |
|---|---|---|
| Chi tiết sân và lịch khung giờ | `/chi-tiet-san.html?id={facilityId}&date={YYYY-MM-DD}` | `id` là ID cơ sở bắt buộc; `date` là ngày đang chọn. `court` lưu sân con đang chọn và `returnTo` giữ URL bộ lọc tìm sân khi quay lại. |

### 2.2 Menu Admin

| Trang | Thành phần chính | Loading / lỗi / trống | Quay lại |
|---|---|---|---|
| Dashboard | Số lượt đặt, doanh thu thực thu (đã thu trừ hoàn), tỷ lệ lấp sân, tỷ lệ hoàn thành/hủy, đơn mới, yêu cầu tìm đối chờ, sân đặt nhiều; lọc hôm nay/7 ngày/30 ngày. Không có chỉ số “bùng cọc”. | Skeleton chỉ số; lỗi có thử lại; không có dữ liệu hiển thị 0 và giải thích. | Trang quản trị trước; dự phòng Dashboard. |
| Quản lý người dùng | Tìm tên/email; xem hồ sơ, khóa/mở khóa tài khoản; không cho admin tự khóa tài khoản đang đăng nhập. | Loading bảng; lỗi có thử lại; không có kết quả hiển thị trạng thái trống. | Trang quản trị trước; dự phòng Dashboard. |
| Quản lý cơ sở, sân, khung giờ và giá | CRUD cơ sở/sân; thông tin liên hệ, tiện ích, bản đồ, nội quy, ảnh; tạo khung một tiếng; cấu hình giờ vàng 17:00–21:00 giá cao hơn; không xóa sân có booking hiệu lực. | Loading bảng/form; lỗi validation hiển thị rõ; danh sách trống có nút tạo dữ liệu. | Trang quản trị trước; dự phòng Dashboard. |
| Booking ngoại lệ | Tìm booking; admin chủ động hủy khi sân gặp sự cố, kể cả trong trận; xác nhận hoàn 100% số đã trả và gửi thông báo. Không có thao tác chỉnh tay tiền hoàn khác. | Loading; lỗi nêu booking không còn hợp lệ; không có booking cần xử lý thì hiển thị trạng thái trống. | Trang quản trị trước; dự phòng Dashboard. |

Menu User và Admin chỉ hiện theo vai trò, nhưng ẩn menu không thay thế kiểm tra quyền trên API.

## 3. Thiết kế giao diện

### 3.1 Ngôn ngữ hình ảnh và hệ thống thiết kế

- **Màu:** giao diện xác thực dùng xanh `#006b2c`/`#00873a`, cam `#9d4300`/`#fd761a`, bề mặt `#f9f9ff`, `#f1f3ff` và `#ffffff`; viền và trạng thái lấy từ token trong [sportbooking-design-system.css](./mockups/sportbooking-design-system.css). Không thay bằng bảng màu khác.
- **Typography:** Be Vietnam Pro cho nội dung và tiêu đề; Inter cho số liệu và nhãn phù hợp. Tiêu đề đậm, phân cấp rõ ràng.
- **Trang đăng nhập/đăng ký:** màn hình desktop chia hai cột theo tỷ lệ gần 7:5, form bên trái và khối giới thiệu bên phải. Form đăng ký đặt Họ tên/Email trước, tiếp theo Số điện thoại/Mật khẩu và Nhập lại mật khẩu; ô nhập có icon, nút gửi dùng style nút chính. Khối giới thiệu dùng số liệu 29 cơ sở tại 6 quận cùng ba thẻ tính năng.
- **Responsive:** ở viewport 390px, chuyển thành một cột, giữ form trước và đưa khối giới thiệu xuống dưới; không tràn ngang hoặc che nội dung.
- **Trạng thái và chuyển động:** giữ bo góc, bóng đổ, focus-visible, hover, lỗi và disabled theo design system; nút submit bị khóa và thông báo loading trong lúc gửi. Tôn trọng `prefers-reduced-motion`.
- **Hero:** ảnh sân lớn, bo góc, phủ gradient xanh đậm để chữ dễ đọc; ô tìm nhanh môn, quận/huyện, ngày, giờ nổi trên hero.
- **Card sân:** ảnh lớn, điểm sao, giá “từ”, nhãn môn; hover nâng nhẹ và bóng đổ tăng vừa phải, không làm bố cục dịch chuyển bất ngờ.
- **Khung giờ:** lưới dễ đọc và có chữ/icon đi kèm màu: trống viền xanh; đang giữ chỗ nền vàng sọc và không chọn được; đã đặt xám; **Xin ghép** lime; giờ vàng 17:00–21:00 có icon tia chớp; giờ đã qua bị khóa.
- **Giữ chỗ:** đồng hồ đếm ngược 10 phút; đổi sang cảnh báo khi còn dưới 2 phút. Không dựa vào đồng hồ giao diện để quyết định thời hạn.
- **Tìm đối:** radar quét kèm đếm ngược chu kỳ hiện tại; nêu trạng thái `SEARCHING`/`WAITING_RELAX` và thời điểm kết thúc, có hành động theo đúng trạng thái.
- **Vé QR:** trình bày như vé thể thao, có đường răng cưa, mã đơn, QR, hotline và bản đồ. Một đơn có đúng một vé QR dù có nhiều khung giờ. QR chứa mã đơn để xuất trình; hệ thống không quét QR và không có check-in.
- **Chip trạng thái:** Sắp tới xanh; Đang trong trận cam; Hoàn thành xám xanh; Đã hủy đỏ nhạt. Trạng thái động phải luôn có nhãn chữ, không chỉ dựa vào màu.
- **Hình khối/chuyển động:** bo góc 16–24px; bóng đổ nhẹ; chuyển trang/hover 150–250ms; responsive mobile; tôn trọng `prefers-reduced-motion`.
- Thành phần focus, hover, disabled, lỗi và thành công phải có trạng thái nhìn thấy được; không chỉ truyền đạt ý nghĩa bằng màu.

### 3.2 Biến CSS dùng chung

`frontend/app.css` dùng design system làm nền. Các giá trị dưới đây trích đúng token đang dùng; style riêng cho giao diện xác thực chỉ bố cục và ghép component từ các token này, không tạo bảng màu thay thế.

```css
:root {
  --sb-primary: #006b2c;
  --sb-primary-container: #00873a;
  --sb-secondary: #9d4300;
  --sb-secondary-container: #fd761a;
  --sb-surface: #f9f9ff;
  --sb-surface-container-low: #f1f3ff;
  --sb-surface-container-lowest: #ffffff;
  --sb-on-surface: #141b2b;
  --sb-border-default: #e5e7eb;
  --sb-error: #ba1a1a;
  --sb-font-main: 'Be Vietnam Pro', system-ui, -apple-system, sans-serif;
  --sb-font-mono: 'Inter', ui-monospace, SFMono-Regular, monospace;
  --sb-radius-md: 12px;
  --sb-radius-xl: 20px;
  --sb-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.06);
  --sb-transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

## 4. Mô hình dữ liệu MariaDB 10.4

Các bảng dưới đây là mô hình đích đề xuất; bảng/cột đang có trong `sportbooking_system` cần được đối chiếu trước khi migration/import. Dùng InnoDB, `utf8mb4`, khóa ngoại cho quan hệ; số tiền VND lưu số nguyên `DECIMAL(12,0)`. Tên enum trong database dùng giá trị tiếng Anh ổn định, giao diện ánh xạ sang nhãn tiếng Việt.

Do `time_slots.current_booking_id` tham chiếu `bookings.id`, migration tạo bảng `time_slots` ban đầu chỉ tạo cột này, chưa thêm foreign key. Foreign key được thêm trong migration tạo bảng `bookings`, sau khi cả hai bảng đã tồn tại.

### 4.1 Bảng và cột

| Bảng | Cột, kiểu và ràng buộc |
|---|---|
| `users` | `id BIGINT UNSIGNED PK`; `full_name VARCHAR(120) NOT NULL`; `email VARCHAR(254) NOT NULL UNIQUE`; `password_hash VARCHAR(255) NOT NULL`; `phone VARCHAR(20) NULL UNIQUE`; `gender ENUM('MALE','FEMALE','OTHER') NULL`; `skill_level ENUM('BEGINNER','INTERMEDIATE','GOOD') NULL`; `role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER'`; `account_status ENUM('ACTIVE','ADMIN_LOCKED') NOT NULL DEFAULT 'ACTIVE'`; `failed_login_count TINYINT UNSIGNED NOT NULL DEFAULT 0`; `login_locked_until DATETIME(3) NULL`; `terms_accepted_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(role, account_status)`. Khóa tạm do sai mật khẩu tách khỏi `account_status`. |
| `user_sessions` | `id BIGINT UNSIGNED PK`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `token_hash CHAR(64) NOT NULL UNIQUE`; `expires_at DATETIME(3) NOT NULL`; `revoked_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`. Index: `(user_id, expires_at)`. Chỉ lưu hash session/token, không lưu token thô. |
| `facilities` | `id BIGINT UNSIGNED PK`; `name VARCHAR(160) NOT NULL`; `address VARCHAR(500) NOT NULL`; `district VARCHAR(120) NOT NULL`; `opening_time TIME NULL`; `closing_time TIME NULL`; `hotline VARCHAR(30) NULL`; `latitude DECIMAL(10,7) NULL`; `longitude DECIMAL(10,7) NULL`; `map_url VARCHAR(1000) NULL`; `description TEXT NULL`; `amenities LONGTEXT NULL`; `rules TEXT NULL`; `cancellation_policy TEXT NULL`; `image_url VARCHAR(1000) NULL`; `is_active BOOLEAN NOT NULL DEFAULT TRUE`; `is_seed BOOLEAN NOT NULL DEFAULT FALSE`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(district, is_active)`, `(is_active, name)`. `amenities` lưu JSON array dạng văn bản và phải được xác thực bằng `JSON_VALID`. Khu vực lọc lấy từ `district` đã tách/chuẩn hóa từ địa chỉ cơ sở. |
| `courts` | `id BIGINT UNSIGNED PK`; `facility_id BIGINT UNSIGNED NOT NULL FK -> facilities.id`; `name VARCHAR(120) NOT NULL`; `sport_type ENUM('FOOTBALL_MINI','BADMINTON','PICKLEBALL') NOT NULL`; `price_normal DECIMAL(12,0) NOT NULL`; `price_peak DECIMAL(12,0) NOT NULL`; `survey_price_min DECIMAL(12,0) NULL`; `survey_price_max DECIMAL(12,0) NULL`; `initial_rating DECIMAL(2,1) NULL`; `description TEXT NULL`; `is_active BOOLEAN NOT NULL DEFAULT TRUE`; `is_seed BOOLEAN NOT NULL DEFAULT FALSE`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(sport_type, is_active)`, `(facility_id, is_active)`. `initial_rating` nhận giá trị 1.0–5.0; giá khảo sát tối thiểu/tối đa được lưu riêng, không dùng thay `price_normal`/`price_peak`. Mỗi cơ sở có ít nhất một sân; dữ liệu khởi tạo có một sân mặc định/cơ sở. |
| `time_slots` | `id BIGINT UNSIGNED PK`; `court_id BIGINT UNSIGNED NOT NULL FK -> courts.id`; `service_date DATE NOT NULL`; `starts_at TIME NOT NULL`; `ends_at TIME NOT NULL`; `price DECIMAL(12,0) NOT NULL`; `status ENUM('AVAILABLE','LOCKED','BOOKED') NOT NULL DEFAULT 'AVAILABLE'`; `current_booking_id BIGINT UNSIGNED NULL`; `lock_expires_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Migration tạo `time_slots` ban đầu chưa tạo FK cho `current_booking_id`; migration tạo `bookings` bổ sung FK này sau khi bảng `bookings` tồn tại. `UNIQUE(court_id, service_date, starts_at)` ngăn tạo trùng định danh khung; index `(service_date, status, court_id)` và `(current_booking_id)`. Khung một tiếng; giờ vàng 17:00–21:00 có giá cấu hình cao hơn. `LOCKED` quá hạn được xem là trống theo thời điểm hiện tại, không chờ tác vụ nền. |
| `bookings` | `id BIGINT UNSIGNED PK`; `booking_code VARCHAR(40) NOT NULL UNIQUE`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `status ENUM('PENDING','CONFIRMED','COMPLETED','EXPIRED','CANCELLED') NOT NULL`; `total_amount DECIMAL(12,0) NOT NULL`; `match_preference JSON NULL`; `cancelled_by ENUM('USER','ADMIN') NULL`; `cancellation_reason VARCHAR(500) NULL`; `confirmed_at DATETIME(3) NULL`; `cancelled_at DATETIME(3) NULL`; `lock_expires_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index `(user_id, status, created_at)`, `(status, lock_expires_at)`. `match_preference` lưu `{mode, gender, skill, format, message}` trước khi xác nhận; NULL nghĩa là không bật tìm đối. JSON được backend xác thực; với `CRITERIA`, các giá trị giới tính/trình độ theo enum ở `match_requests`; `format` chỉ là `SINGLES`/`DOUBLES` cho `BADMINTON`/`PICKLEBALL`. Tìm đối cần khung đầu cách hiện tại ít nhất 30 phút. Khi booking được xác nhận, module tìm đối tạo `match_requests`; bước chuyển này ngoài phạm vi tạo hold. Mỗi user tối đa một `PENDING`, kiểm soát bằng transaction/khóa user ở mục 7; MariaDB 10.4 không hỗ trợ partial unique index trực tiếp cho điều kiện này. Thông tin tiền và lựa chọn thanh toán đọc qua `payments`. |
| `booking_slots` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL FK -> bookings.id`; `time_slot_id BIGINT UNSIGNED NOT NULL FK -> time_slots.id`; `price_at_booking DECIMAL(12,0) NOT NULL`; `created_at DATETIME(3) NOT NULL`. `UNIQUE(booking_id, time_slot_id)`; index `(time_slot_id, booking_id)`. Giữ lịch sử các khung và giá snapshot; ràng buộc khả dụng hiện tại nằm ở `time_slots` và được khóa trong transaction. |
| `booking_tickets` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `qr_code VARCHAR(80) NOT NULL UNIQUE`; `created_at DATETIME(3) NOT NULL`. Một ticket cho một booking. Mã QR có dạng `QR-` + chuỗi ngẫu nhiên, QR chứa mã đơn để nhân viên đối chiếu; không có API check-in/quét QR. |
| `payments` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `status ENUM('PENDING','PAID','REFUNDED') NOT NULL`; `amount_due DECIMAL(12,0) NOT NULL`; `paid_amount DECIMAL(12,0) NOT NULL DEFAULT 0`; `refunded_amount DECIMAL(12,0) NOT NULL DEFAULT 0`; `payment_option ENUM('DEPOSIT_50','FULL') NOT NULL`; `paid_at DATETIME(3) NULL`; `refunded_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index `(status, updated_at)`. Tạo một payment `PENDING` trong cùng transaction tạo booking `PENDING`; `amount_due` bằng cọc hoặc toàn bộ theo `payment_option`. Với `DEPOSIT_50`, cọc là `CEILING(total_amount / 2)` VND và tiền thu tại sân là `total_amount - cọc`; với `FULL`, tiền thu tại sân bằng 0. Backend trả các khoản này trong booking response. Hoàn 0đ giữ `PAID`; có hoàn tiền thì `REFUNDED`, kể cả hoàn một phần. |
| `payment_attempts` | `id BIGINT UNSIGNED PK`; `payment_id BIGINT UNSIGNED NOT NULL FK -> payments.id`; `attempt_no INT UNSIGNED NOT NULL`; `method ENUM('BANK_TRANSFER','MOMO','DOMESTIC_ATM','INTERNATIONAL_CARD') NOT NULL`; `amount DECIMAL(12,0) NOT NULL`; `result ENUM('PROCESSING','SUCCEEDED','FAILED') NOT NULL`; `provider_reference VARCHAR(100) NULL`; `created_at DATETIME(3) NOT NULL`; `completed_at DATETIME(3) NULL`. `UNIQUE(payment_id, attempt_no)`; index `(payment_id, created_at)`. Ghi mọi lần thử kể cả thất bại, không giới hạn số lần trong thời hạn giữ chỗ. |
| `match_requests` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `owner_user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `status ENUM('SEARCHING','WAITING_RELAX','MATCHED','CANCELLED','EXPIRED') NOT NULL`; `search_mode ENUM('RANDOM','CRITERIA') NOT NULL`; `gender_criterion ENUM('ANY','MALE','FEMALE') NULL`; `skill_criterion ENUM('BEGINNER','INTERMEDIATE','GOOD') NULL`; `format ENUM('SINGLES','DOUBLES') NULL`; `message VARCHAR(1000) NULL`; `participant_kind ENUM('INDIVIDUAL','TEAM_REP') NULL`; `matched_user_id BIGINT UNSIGNED NULL FK -> users.id`; `match_code VARCHAR(40) NULL UNIQUE`; `contribution_amount DECIMAL(12,0) NULL`; `relaxation_count TINYINT UNSIGNED NOT NULL DEFAULT 0`; `cycle_no TINYINT UNSIGNED NOT NULL DEFAULT 1`; `cycle_started_at DATETIME(3) NOT NULL`; `cycle_expires_at DATETIME(3) NOT NULL`; `relax_decision_expires_at DATETIME(3) NULL`; `matched_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index `(status, cycle_expires_at)`, `(status, relax_decision_expires_at)`, `(owner_user_id, status)`. `relaxation_count` chỉ nhận 0 hoặc 1; `booking_id UNIQUE` bảo đảm tối đa một yêu cầu/đơn. Đội được đại diện bởi một user, không lưu/quản lý thành viên hoặc cách chia tiền. |
| `notifications` | `id BIGINT UNSIGNED PK`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `recipient_role ENUM('USER','ADMIN') NOT NULL`; `category ENUM('BOOKING_HOLD','MATCH','PAYMENT','SYSTEM') NOT NULL`; `title VARCHAR(180) NOT NULL`; `body TEXT NOT NULL`; `resource_type VARCHAR(40) NULL`; `resource_id BIGINT UNSIGNED NULL`; `read_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`. Index `(user_id, read_at, created_at)`, `(recipient_role, read_at, created_at)`. |
| `reviews` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `court_id BIGINT UNSIGNED NOT NULL FK -> courts.id`; `rating TINYINT UNSIGNED NOT NULL`; `comment TEXT NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. `CHECK(rating BETWEEN 1 AND 5)`; index `(court_id, created_at)`, `(user_id, created_at)`. Backend chỉ cho chủ booking đã `COMPLETED` đánh giá một lần. |

### 4.2 Quan hệ và bất biến dữ liệu

- Một `facility` có nhiều `courts`; một `court` có nhiều `time_slots`.
- Một `booking` thuộc một `user`, bao gồm một hoặc nhiều `booking_slots` liền kề cùng sân/ngày và có tối đa một `match_request`, một `payment`, một `booking_ticket` và một `review`.
- Một `payment` có nhiều `payment_attempts`; các lần thử thất bại vẫn được lưu.
- Một `match_request` ghép tối đa một user đại diện B; tiền đóng góp là một nửa giá sân, không phải khoản thu/chi qua `payments`.
- Mã booking, mã QR và mã ghép có unique index riêng. Mã booking theo dạng `SPB-YYYYMMDD-xxxxxx`, mã QR theo dạng `QR-` + chuỗi ngẫu nhiên, mã ghép theo dạng `SPB-MATCH-xxxx`. Mã booking và mã QR khác tiền tố nên không giao nhau.
- `time_slots` có định danh unique `(court_id, service_date, starts_at)`. Lịch sử `booking_slots` không bị xóa khi khung giờ được giải phóng; trạng thái hiện tại của khung nằm ở `time_slots`.

## 5. API

Các route dưới đây là hợp đồng HTTP/JSON đề xuất, dùng tiền tố `/api/v1`. Output thành công là JSON; lỗi có dạng `{ "error": { "code": "...", "message": "...", "details": {} } }`. Backend xác thực session, vai trò, quyền sở hữu và trạng thái tài nguyên trước mọi thao tác ghi. Không nhận `user_id`, tổng tiền, quyền admin hay trạng thái cuối cùng từ frontend làm dữ liệu đáng tin cậy.

### 5.1 Xác thực và hồ sơ

| API | Vai trò | Input | Output thành công | Lỗi chính |
|---|---|---|---|---|
| `POST /auth/register` | Public | Họ tên, email, mật khẩu, SĐT, `termsAccepted` bắt buộc là `true` | `201`, hồ sơ mới không gồm hash mật khẩu; ghi `terms_accepted_at` | `400` dữ liệu sai hoặc thiếu/không chấp nhận `termsAccepted`; `409` email/SĐT trùng |
| `POST /auth/login` | Public | Email, mật khẩu | `200`, user/role và phiên 8 giờ | `400` thiếu/sai định dạng; `401` thông tin không hợp lệ; `403` admin khóa; `423` đang tạm khóa do sai mật khẩu |
| `POST /auth/logout` | User/Admin | Phiên hiện tại | `204` | `401` chưa xác thực |
| `GET /auth/me` | User/Admin | Không | Hồ sơ và vai trò hiện tại | `401` phiên hết hạn |
| `PATCH /users/me` | User/Admin | Trường hồ sơ được phép sửa | Hồ sơ cập nhật | `400` dữ liệu sai; `401`; `409` SĐT trùng |
| `PATCH /users/me/password` | User/Admin | Mật khẩu hiện tại và mật khẩu mới | `204` | `400` mật khẩu mới không đạt; `401` mật khẩu hiện tại sai |

### 5.2 Sân, lịch và đặt sân

| API | Vai trò | Input | Output thành công | Lỗi chính |
|---|---|---|---|---|
| `GET /facilities` | User/Admin | Bộ lọc môn, quận/huyện, ngày/giờ, trang | Danh sách cơ sở/sân, giá từ, điểm đánh giá | `400` bộ lọc sai; `401` chưa đăng nhập |
| `GET /facilities/{id}` | User/Admin | ID cơ sở | Thông tin cơ sở, sân, giá, tiện ích, nội quy, bản đồ, đánh giá | `401` chưa đăng nhập; `404` không tồn tại/không công khai |
| `GET /courts/{id}/time-slots` | User/Admin | Ngày | Danh sách khung giờ và trạng thái khả dụng tại thời điểm phản hồi | `400` ngày sai; `401` chưa đăng nhập; `404` sân không tồn tại |
| `POST /bookings` | User | `{ "slot_ids": [id, ...], "payment_option": "DEPOSIT_50" hoặc "FULL", "match_preference": null hoặc {"mode":"RANDOM" hoặc "CRITERIA", "gender":"ANY"/"MALE"/"FEMALE"/null, "skill":"BEGINNER"/"INTERMEDIATE"/"GOOD"/null, "format":"SINGLES"/"DOUBLES"/null, "message":string/null} }`; `match_preference` tùy chọn, mặc định NULL | `201`, booking `PENDING`, tổng/giá snapshot, payment `PENDING`, `payment_option`, `deposit_amount`, `amount_due_at_venue`, preference, `lock_expires_at`; booking, payment và khóa slot cùng transaction. Cọc = `CEILING(total_amount / 2)` VND. | `400` payload/enum sai, slot không liền, format không hỗ trợ, hoặc tìm đối khi khung đầu còn dưới 30 phút (`MATCH_PREFERENCE_TOO_LATE`)/format sai môn (`MATCH_FORMAT_NOT_SUPPORTED`); `401`; `403`; `404`; `409` slot bận, user đã có `PENDING`, thời gian/giá thay đổi |
| `GET /bookings?mine=true` | User | Lọc trạng thái/trang | Danh sách đơn của user hiện tại | `401` |
| `GET /bookings/{id}` | Chủ đơn/Admin | Không | Chi tiết đơn gồm payment (`status`, `payment_option`, `amount_due`, `paid_amount`, `refunded_amount`), `deposit_amount`, `amount_due_at_venue`, `match_preference`, ticket/match nếu đã tồn tại và trạng thái hiển thị | `401`; `403` không phải chủ/admin; `404` |
| `POST /bookings/{id}/cancel` | Chủ đơn/Admin theo luồng ngoại lệ | Lý do; với Admin phải là lý do sự cố | Đơn `CANCELLED`, `refunded_amount`, thông báo đã tạo | `400` không hợp lệ; `401`; `403`; `404`; `409` đơn đã hủy/hết hạn hoặc không hợp lệ để hủy |

### 5.3 Thanh toán giả lập

| API | Vai trò | Input | Output thành công | Lỗi chính |
|---|---|---|---|---|
| `POST /bookings/{id}/payment-attempts` | Chủ đơn | Phương thức hiển thị và kết quả mô phỏng `SUCCESS`/`FAILURE` | Attempt đã lưu; nếu thành công payment `PAID`, booking `CONFIRMED`; nếu thất bại booking vẫn `PENDING` | `400` input sai; `401`; `403`; `404`; `409` booking không còn `PENDING`; `410` lock hết hạn |
| `GET /bookings/{id}/payments` | Chủ đơn/Admin | Không | Payment và lịch sử attempts của đơn | `401`; `403`; `404` |

Endpoint giả lập không gọi ngân hàng/ví thật. Kết quả mô phỏng được lưu thành `payment_attempts`, không cho frontend tự cập nhật trạng thái `PAID`.

### 5.4 Ghép đối, thông báo và đánh giá

| API | Vai trò | Input | Output thành công | Lỗi chính |
|---|---|---|---|---|
| `GET /match-requests` | User | Court/slot hoặc ngày, trạng thái đang tìm | Danh sách nhãn **Xin ghép** đang hiệu lực, không lộ dữ liệu riêng không cần thiết | `400`; `401` nếu yêu cầu đăng nhập |
| `POST /match-requests/{id}/join` | User B | Thể loại cá nhân/đội đại diện và lời nhắn nếu được phép | `200`, mã trận, thông tin sân/khung giờ và mức đóng góp | `400` không khớp tiêu chí; `401`; `403` chủ A tự ghép; `404`; `409` đã có người ghép hoặc B có booking xung đột; `410` yêu cầu hết hạn |
| `POST /bookings/{id}/match-requests` | Chủ đơn A | Kiểu tìm và tiêu chí | `201`, yêu cầu `SEARCHING`, deadline chu kỳ | `400` tiêu chí sai; `401`; `403`; `404`; `409` đơn chưa xác nhận/đã có yêu cầu; `410` không còn đủ thời gian |
| `POST /match-requests/{id}/relax` | Chủ đơn A | Xác nhận nới lỏng | Yêu cầu chuyển sang chu kỳ thứ hai `SEARCHING`, deadline mới | `400`; `401`; `403`; `404`; `409` đã nới lỏng; `410` không còn thời gian/đã hết `WAITING_RELAX` |
| `POST /match-requests/{id}/cancel` | Chủ đơn A | Không | Yêu cầu `CANCELLED`; booking vẫn giữ nguyên | `401`; `403`; `404`; `409` yêu cầu đã kết thúc |
| `GET /notifications` | User/Admin | Loại, trang | Danh sách thuộc user/role hiện tại và thời gian tương đối | `401` |
| `GET /notifications/unread-count` | User/Admin | Không | `{ "count": n }` | `401` |
| `PATCH /notifications/{id}/read` | Chủ thông báo/Admin recipient | Không | Thông báo đã đọc | `401`; `403`; `404` |
| `POST /bookings/{id}/reviews` | Chủ đơn | Điểm 1–5, nhận xét tùy chọn | `201`, đánh giá và điểm tổng hợp sân | `400`; `401`; `403`; `404`; `409` đơn chưa hoàn thành/đã đánh giá |

### 5.5 API Admin và mã lỗi chung

| API | Vai trò | Input | Output thành công | Lỗi chính |
|---|---|---|---|---|
| `GET /admin/dashboard` | Admin | Khoảng thời gian | Chỉ số theo nghiệp vụ đã chốt | `401`; `403` |
| `GET /admin/users`, `PATCH /admin/users/{id}/lock`, `PATCH /admin/users/{id}/unlock` | Admin | Bộ lọc hoặc thao tác khóa/mở | Danh sách/ trạng thái user | `400`; `401`; `403`; `404`; `409` tự khóa |
| `POST/PATCH /admin/facilities`, `/admin/courts`, `/admin/time-slots` | Admin | Trường được phép của đối tượng tương ứng | Bản ghi đã tạo/cập nhật | `400`; `401`; `403`; `404`; `409` trùng khung/đang có booking |
| `POST /admin/bookings/{id}/incident-cancellation` | Admin | Lý do sự cố bắt buộc | Booking hủy; hoàn 100% tức thời; thông báo khách | `400`; `401`; `403`; `404`; `409` trạng thái đã kết thúc hoặc thao tác lặp |
| `GET /health` | Public/monitoring | Không | Trạng thái dịch vụ, không tiết lộ secret/chi tiết kết nối | `503` nếu dịch vụ không sẵn sàng |

| HTTP | Dùng khi |
|---|---|
| `400 Bad Request` | Thiếu/sai định dạng, sai quy tắc trường đầu vào. |
| `401 Unauthorized` | Chưa đăng nhập, thông tin đăng nhập sai hoặc phiên không hợp lệ. |
| `403 Forbidden` | Đã đăng nhập nhưng sai vai trò/quyền sở hữu. |
| `404 Not Found` | Tài nguyên không tồn tại hoặc không được phép tiết lộ sự tồn tại. |
| `409 Conflict` | Xung đột trạng thái, đặt trùng, dữ liệu thay đổi đồng thời hoặc vi phạm unique. |
| `410 Gone` | Tài nguyên đã hết hạn theo thời hạn nghiệp vụ, ví dụ lock/thời gian ghép. |
| `423 Locked` | Tài khoản tạm khóa đăng nhập do nhập sai mật khẩu quá số lần cho phép. |

## 6. Tác vụ nền và cập nhật trạng thái

| Tác vụ | Tần suất / điều kiện | Xử lý |
|---|---|---|
| Dọn giữ chỗ | Mỗi phút | Tìm booking `PENDING` đã quá `lock_expires_at`; trong transaction chuyển booking thành `EXPIRED`, xóa quyền giữ hiện tại, đưa time slot về `AVAILABLE` và tạo thông báo. |
| Tạo khung giờ tương lai | Khi server khởi động và mỗi giờ; mặc định bật ở development, tắt ở test | Tác vụ không chặn server khởi động; bảo đảm cơ sở và sân đang hoạt động có khung một tiếng cho SLOT_DAYS_AHEAD ngày tính từ hôm nay theo Asia/Ho_Chi_Minh. Mặc định 14; hợp lệ 1–60; giá trị sai dùng 14 và ghi cảnh báo. Chỉ chèn khung còn thiếu, giữ nguyên khung đã có và lấy giá từ price_normal/price_peak theo giờ vàng 17:00–21:00. |
| Hết hạn tìm đối | Quét deadline đến hạn | Mỗi chu kỳ có hạn `min(thời điểm bắt đầu chu kỳ + 10 phút, giờ bắt đầu khung đầu tiên - 10 phút)` theo [business-flow.md quy tắc 7](../01-plan/business-flow.md#7-quy-tắc-nghiệp-vụ). `SEARCHING` hết chu kỳ đầu chuyển `WAITING_RELAX`, đặt hạn quyết định 10 phút và báo A; hết chu kỳ thứ hai chuyển `EXPIRED`. `WAITING_RELAX` hết hạn quyết định hoặc không còn thời gian cho chu kỳ mới chuyển `EXPIRED`. |
| Hoàn tất đơn | Sau giờ kết thúc khung cuối | Chỉ cập nhật booking `CONFIRMED` thành `COMPLETED`. **Sắp tới** và **Đang trong trận** được tính động theo giờ UTC+7; không ghi hai trạng thái này vào database. |
| Polling | Tối đa 5 giây | Backend cung cấp dữ liệu mới cho lịch khung giờ, đơn, tìm đối và số chưa đọc. Trình duyệt hủy polling khi trang rời/ẩn phù hợp và không dùng dữ liệu poll làm căn cứ cho thao tác ghi. |

Tất cả tác vụ có thể chạy lặp an toàn: chỉ chuyển trạng thái nếu bản ghi còn ở trạng thái nguồn hợp lệ, không gửi thông báo trùng khi chạy lại. Các yêu cầu ghi từ UI/API đều đọc và kiểm tra lại trạng thái, giá, quyền sở hữu và deadline tại server.

## 7. Chống đặt trùng và xử lý đồng thời

1. Dùng MariaDB 10.4 InnoDB transaction cho tạo booking và khóa khung. Khóa các hàng `time_slots` theo ID tăng dần (`SELECT ... FOR UPDATE`) để giảm deadlock.
2. Trong cùng transaction: khóa user và kiểm tra chưa có booking `PENDING`; kiểm tra đủ slot tồn tại, cùng sân/ngày, liên tiếp, bắt đầu cách hiện tại ít nhất 15 phút; xác nhận mọi slot đang `AVAILABLE` hoặc lock cũ đã hết hạn; tính lại giá từ cấu hình hiện thời; ghi booking + snapshot `booking_slots`; cập nhật các slot sang `LOCKED` với cùng `current_booking_id` và `lock_expires_at` = thời điểm xác nhận + 10 phút. Chỉ commit khi tất cả thành công; nếu một bước lỗi rollback toàn bộ.
3. Unique `(court_id, service_date, starts_at)` chặn khung giờ bị tạo trùng trong lịch cấu hình. Hàng slot được khóa và cập nhật có điều kiện chặn hai booking cùng chiếm một slot; lịch sử `booking_slots` không bị xóa để giữ đối soát.
4. Truy vấn lịch coi slot `LOCKED` chỉ đang giữ nếu `lock_expires_at > NOW_UTC`; lock hết hạn được xem là trống ngay cả khi tác vụ nền chưa chạy. Khi đặt lại, server giải phóng lock cũ trong transaction trước khi gán booking mới.
5. Xác nhận thanh toán thành công chỉ hợp lệ nếu booking còn `PENDING` và lock chưa hết hạn; thao tác cập nhật payment, attempt, booking và toàn bộ slot phải nguyên tử. Thất bại ghi attempt riêng, không đổi trạng thái booking/lock.
6. Ghép đối dùng transaction/khóa hàng `match_requests`; chỉ một request B đầu tiên có thể chuyển `SEARCHING` sang `MATCHED`. Request sau nhận `409` và nội dung tương ứng **đã có người ghép**. Kiểm tra tiêu chí, booking B và khung giờ ngay trước commit.
7. Không tin trạng thái, giá, vai trò hoặc quyền sở hữu gửi từ frontend. Mọi lần ghi, kể cả qua tác vụ nền, kiểm tra trạng thái nguồn và thời hạn tại server.

## 8. Dữ liệu khởi tạo và import khảo sát

### 8.1 Tài khoản Admin

- Tài khoản khởi tạo có email `admin@sportbooking.com`, vai trò `ADMIN`.
- Hash bcrypt lấy từ biến môi trường `ADMIN_PASSWORD_HASH`; không ghi mật khẩu gốc hoặc hash thật vào spec, source code hay repository.
- Chỉ commit `.env.example` với giá trị placeholder cho biến môi trường; `.env` thật phải được loại khỏi Git. Tạo seed admin theo cách có thể chạy lặp mà không tạo tài khoản trùng.

### 8.2 Dữ liệu khảo sát cơ sở/sân

Nguồn dữ liệu ban đầu là [khao-sat-san.xlsx](../../infra/data/khao-sat-san.xlsx): 29 cơ sở tại 6 quận Hà Nội, phân bố **cầu lông 10, bóng đá mini 8, pickleball 11**. Mỗi dòng cơ sở tạo một sân mặc định, tổng 29 sân. Cầu lông và pickleball hỗ trợ đơn/đôi; bóng đá mini không có lựa chọn đơn/đôi. Workbook không có cột ảnh; không tự tạo URL ảnh.

#### Ánh xạ workbook sang bảng

| Cột Excel | Header trong workbook | Cột đích | Chuẩn hóa |
|---|---|---|---|
| A | `Cụm sân / Khu vực` | `facilities.district` | Điền xuống giá trị quận/huyện liền trước ở các dòng trống trong cùng nhóm; trim khoảng trắng. Ưu tiên cột A; nếu địa chỉ lệch thì ghi cảnh báo theo dòng, không tự sửa quận. |
| B | `Tên môn` | `courts.sport_type` | Dòng trống thuộc nhóm môn hiện hành được điền theo nhãn nhóm; ánh xạ các biến thể “Sân bóng/bóng đá mini” → `FOOTBALL_MINI`, “cầu lông” → `BADMINTON`, “pickleball” → `PICKLEBALL`; giá trị không nhận diện phải báo lỗi, không đoán. |
| C | `Tên sân` | `facilities.name`, `courts.name` | Gộp ký tự xuống dòng thành khoảng trắng, trim và giữ nguyên tên khảo sát cho cơ sở và sân mặc định. |
| D | `Địa chỉ chi tiết` | `facilities.address` | Giữ địa chỉ đầy đủ sau khi trim; chỉ dùng để đối chiếu và cảnh báo lệch quận so với cột A. |
| E | `Link map` | `facilities.map_url` | Dùng nguyên URL hợp lệ đã sửa trong workbook; nếu vẫn không phải URL thì lưu `NULL`, ghi cảnh báo theo dòng. Frontend tạo link tìm kiếm Google Maps từ địa chỉ khi hiển thị. |
| F | `Số điện thoại liên hệ` | `facilities.hotline` | Lưu chuỗi chữ số, bỏ dấu chấm và khoảng trắng. Chuỗi toàn số dài 9 hoặc 10 chữ số thì thêm `0` đầu; ô trống lưu `NULL`. |
| G | `Giờ mở cửa / đóng cửa` | `facilities.opening_time`, `facilities.closing_time` | Chuẩn hóa separator, dấu chấm và mẫu giờ (`5h00–22h30`, “đến”, dấu gạch nối). “Cả ngày”/“Mở cửa cả ngày” thành `00:00:00`–`24:00:00`; giờ đóng `00:00` hoặc `24:00` là hết ngày cùng ngày. Làm tròn giờ mở lên và giờ đóng xuống giờ nguyên. `24:00` được lưu dưới dạng `TIME '24:00:00'`, không đổi thành `00:00` ngày hôm sau. |
| H | `Tiện ích` | `facilities.amenities` | Tách mục phân cách bằng `/`, dấu phẩy hoặc chấm phẩy; trim, bỏ mục trùng và lưu JSON array. Ô trống lưu mảng rỗng, không tự suy đoán tiện ích. |
| I | `rate đgia` | `courts.initial_rating` | Dùng nguyên giá trị đã sửa trong workbook nếu là số từ 1.0 đến 5.0. Giá trị còn sai định dạng/ngoài miền để `NULL`, ghi cảnh báo đúng dòng; kỳ vọng không có cảnh báo. |
| J | Cột giá (không có header) | `courts.survey_price_min`, `courts.survey_price_max`, `price_normal`, `price_peak` | Chuẩn hóa ký hiệu VNĐ, `k`/`nghìn`, dấu phân cách và khoảng giá; thiếu `/giờ` vẫn hiểu là giá theo giờ. Giá nhỏ nhất là `price_normal`, lớn nhất là `price_peak`; nếu chỉ một mức thì `price_peak = price_normal × 1,3`. Không dùng hằng số giá theo môn. Giá không phân tích được phải báo lỗi và không tự đoán. |
| Không có | Ảnh | `facilities.image_url` | Chưa có ảnh theo môn; lưu `NULL`, frontend hiển thị nền gradient và icon theo môn cho tới khi có ảnh thật. |

#### Quy tắc import và mặc định

1. Đọc `.xlsx` hoặc CSV UTF-8 xuất từ workbook; kiểm tra header, số dòng dữ liệu, kiểu và giá trị bắt buộc trước khi ghi.
2. Chuẩn hóa theo bảng ánh xạ; báo cáo lỗi theo dòng cho giá/giờ/rating/map không hợp lệ và cảnh báo nếu quận cột A khác địa chỉ. Không đoán dữ liệu; rating và map đã được sửa trong workbook nên kỳ vọng 0 cảnh báo ở hai trường này.
3. Giờ hoạt động lấy từ khảo sát; cơ sở nhập theo khảo sát có `facilities.is_seed = FALSE`, gồm cả “Cả ngày”/“Mở cửa cả ngày” mở `00:00`, đóng `24:00`. `24:00` không rollover sang ngày sau. Giờ mở lẻ làm tròn lên giờ nguyên, giờ đóng lẻ làm tròn xuống. UI hiển thị “Mở cửa 24/24”. Khung một tiếng được tạo từ giờ mở đến giờ đóng trong SLOT_DAYS_AHEAD ngày (mặc định 14, hợp lệ 1–60); cơ sở 24/24 có 24 khung/ngày. Seed và tác vụ nền dùng chung logic tạo slot. Tác vụ nền chạy lúc server khởi động rồi mỗi giờ, mặc định bật ở development và tắt ở test; chỉ bù slot thiếu cho cơ sở/sân đang hoạt động, không cập nhật slot đã có. Giá vận hành lấy từ cột J theo `price_normal`/`price_peak`, không dùng hằng số theo môn.
4. Import lặp lại không tạo trùng và không ghi đè dữ liệu do admin đã sửa. Định danh khớp seed dùng khóa chuẩn hóa từ quận + tên + địa chỉ cho cơ sở, và `facility_id + court.name` cho sân; các xung đột không thể phân định phải dừng để rà soát.
5. Tạo khung một tiếng cho SLOT_DAYS_AHEAD ngày tới (mặc định 14, hợp lệ 1–60) từ giờ mở cửa đã làm tròn lên tới giờ đóng đã làm tròn xuống; chỉ chèn khung còn thiếu theo `UNIQUE(court_id, service_date, starts_at)`, không cập nhật khung đã tồn tại. `TIME '24:00:00'` là cuối ngày; không chuyển thành nửa đêm ngày kế tiếp.
6. Sau import, xác nhận đúng 29 cơ sở, 6 quận, 29 sân và phân bố môn cầu lông 10, bóng đá mini 8, pickleball 11; sai lệch phải báo và dừng, không sửa số liệu để khớp.

Database `sportbooking_system` giữ dữ liệu khảo sát hiện có và không phải mục tiêu chạy seed phát triển. Ảnh theo môn chưa có; giao diện tạm dùng gradient và icon.

## 9. Tiêu chí nghiệm thu

| Cho | Khi | Thì |
|---|---|---|
| Hai user cùng xem một khung giờ còn trống | Cả hai gần như đồng thời xác nhận đặt | Chỉ một transaction giữ thành công; user còn lại nhận lỗi xung đột và lịch tải lại trạng thái mới nhất; không có booking/lock một phần. |
| Một slot đang `LOCKED` và `lock_expires_at` còn ở tương lai | User khác xem lịch và thử đặt | Lịch hiển thị **Đang được giữ chỗ**, không thể chọn/đặt; server từ chối nếu gửi API trực tiếp. |
| Một slot có `LOCKED` nhưng `lock_expires_at` đã qua, job dọn chưa chạy | User khác tải lịch và đặt | Lịch xem slot là trống; transaction giải phóng lock cũ và cho phép đúng một booking mới; booking cũ hết hạn được dọn không ảnh hưởng booking mới. |
| Booking `PENDING` còn lock | User chọn thanh toán thất bại | Payment attempt `FAILED` được lưu; booking vẫn `PENDING`, slot vẫn giữ đến deadline; cho thử lại không giới hạn số lần khi còn hạn. |
| User hủy đơn `CONFIRMED` trước giờ bắt đầu khung đầu tiên từ 24 giờ trở lên | Xác nhận hủy | Đơn `CANCELLED`; hoàn tức thời 100% số đã trả, ghi `refunded_amount`, giải phóng slot và gửi thông báo. |
| User hủy đơn `CONFIRMED` từ 6 giờ đến dưới 24 giờ trước giờ bắt đầu khung đầu tiên | Xác nhận hủy | Đơn `CANCELLED`; hoàn tức thời 50% số đã trả, ghi số tiền thực tế; không tạo hoàn cho phần chưa thanh toán. |
| User hủy đơn dưới 6 giờ trước giờ bắt đầu khung đầu tiên | Xác nhận hủy | Đơn `CANCELLED`; hoàn `0`, payment vẫn `PAID`, `refunded_amount = 0`; giải phóng slot và thông báo. |
| Tài khoản nhập sai mật khẩu liên tiếp 5 lần | Gửi lần đăng nhập sai thứ năm rồi thử đăng nhập trong 15 phút | Tạm khóa đăng nhập và trả `423`; sau 15 phút tự mở khóa đăng nhập, không đổi trạng thái khóa do Admin. |
| User đã có một booking `PENDING` | Gửi yêu cầu tạo booking thứ hai | Không tạo booking mới; server trả `409` và cho tiếp tục đơn đang giữ hoặc hủy đơn cũ trước. |
| A đã có booking `CONFIRMED`, bật tìm đối; B đủ điều kiện cùng sân/khung giờ | Hai B bấm ghép đồng thời | Một B được ghép thành công; yêu cầu `MATCHED`, có mã `SPB-MATCH-xxxx`, nhãn **Xin ghép** biến mất; B còn lại nhận `409`/thông báo đã có người ghép. |
| Yêu cầu theo tiêu chí và B không khớp giới tính, trình độ hoặc thể thức | B thử ghép | Server từ chối, nêu điều kiện không khớp; yêu cầu vẫn `SEARCHING`. |
| Chu kỳ đầu hết hạn, chưa ghép và còn đủ thời gian cho chu kỳ mới | A đồng ý nới lỏng trong `WAITING_RELAX` | Bỏ điều kiện giới tính/trình độ; mở chu kỳ hai theo công thức deadline; `relaxation_count = 1`; không có lần nới lỏng thứ hai. |
| Hết thời gian quyết định hoặc không còn thời gian trước mốc bắt đầu - 10 phút cho chu kỳ mới | A mở màn tìm đối | Yêu cầu `EXPIRED`; nút nới lỏng không hiển thị/không thực hiện được; booking A vẫn hiệu lực. |
| Booking đang trong trận và có sự cố vận hành | Admin xác nhận hủy sự cố | Booking `CANCELLED`; hoàn 100% số đã trả tức thời, ghi `refunded_amount`, giải phóng khung giờ và thông báo user. |
| User gọi API chỉ dành cho Admin | Gửi yêu cầu bằng phiên user hợp lệ | Backend từ chối với `403`; không thay đổi dữ liệu. |

## 10. Giả định và câu hỏi mở

### Giả định (GD)

| Mã | Giả định cần xác nhận trước khi triển khai |
|---|---|
| GD-01 | API dùng REST, JSON và tiền tố `/api/v1`; tên endpoint trong tài liệu là hợp đồng đề xuất, chưa phải route hiện có. |
| GD-02 | Tài khoản dùng session phía server, cookie bảo vệ và thời hạn 8 giờ theo business-flow; cấu hình cookie/chi tiết lưu session cần chốt khi chọn framework/deploy. |
| GD-03 | Mô hình bảng tại mục 4 là schema đích đề xuất, chưa thay thế schema MariaDB đang có; cần migration tương thích sau khi kiểm kê database. |
| GD-04 | Dùng `DATETIME(3)` chuẩn hóa UTC cho thời điểm sự kiện và deadline; ngày/giờ khung chơi lưu theo giờ địa phương Hà Nội (`service_date`, `starts_at`, `ends_at`) rồi ghép với `Asia/Ho_Chi_Minh` khi tính trạng thái. |
| GD-05 | Mã đơn có dạng `SPB-YYYYMMDD-xxxxxx`; mã QR có dạng `QR-` + chuỗi ngẫu nhiên. Hai loại mã khác tiền tố nên không giao nhau; QR chứa mã đơn để nhân viên đối chiếu. |
| GD-06 | Các trường thông tin cơ sở/sân trong bảng đích là mô hình đề xuất tối thiểu; cần đối chiếu dữ liệu khảo sát thực tế để tránh làm mất cột/dữ liệu nguồn. |
| GD-07 | Giá lấy từ workbook: mức nhỏ nhất là `price_normal`, mức lớn nhất là `price_peak`; nếu chỉ có một mức thì `price_peak = price_normal × 1,3`. Giá thiếu `/giờ` vẫn tính theo giờ; không dùng hằng số giá theo môn. |

### Câu hỏi mở

1. Cần đối chiếu từ nguồn khảo sát gốc những dòng rating đã bị Excel chuyển thành serial ngày hoặc `*****`; nếu không khôi phục được thì để `initial_rating` là `NULL` hay cung cấp giá trị xác nhận theo từng dòng?
2. Xác nhận cơ chế đăng nhập lưu phiên 8 giờ bằng cookie/session phía server hay phương án khác.
3. Xác nhận framework Node.js; nguồn RSS sẽ chốt khi triển khai phần tin tức tùy chọn.
4. Xác nhận bộ tiện ích mặc định theo từng môn và nguồn ảnh dùng cho một ảnh mỗi cơ sở.
