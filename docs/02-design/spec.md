# Đặc tả thiết kế — SportBooking

> Tài liệu thiết kế dựa trên [business-flow.md](../01-plan/business-flow.md), là nguồn sự thật nghiệp vụ. Khi có khác biệt, ưu tiên business-flow. Dữ liệu trong [phiếu yêu cầu](../01-plan/phieu-yeu-cau.md) chỉ được tham chiếu, không chỉnh sửa.

## Mục lục

- [1. Công nghệ và kiến trúc](#1-công-nghệ-và-kiến-trúc)
- [2. Trang và điều hướng](#2-trang-và-điều-hướng)
- [3. Thiết kế giao diện](#3-thiết-kế-giao-diện)
- [4. Mô hình dữ liệu MySQL](#4-mô-hình-dữ-liệu-mysql)
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
| Database | MySQL, database/schema `sportbooking_system`. |
| Realtime | Polling tối đa mỗi 5 giây cho lịch khung giờ, trạng thái đơn, tìm đối và số thông báo chưa đọc. |
| Giao tiếp | Frontend chỉ gọi backend qua API HTTP/JSON. Frontend không chứa thông tin kết nối hoặc truy vấn database. |
| Truy cập dữ liệu | Chỉ backend kết nối MySQL; mọi quyền sở hữu, vai trò, trạng thái và thời hạn được kiểm tra lại ở server trước khi ghi. |
| Múi giờ | Múi giờ nghiệp vụ là `Asia/Ho_Chi_Minh` (UTC+7). Cách lưu và chuyển đổi thời điểm được nêu tại [10. Giả định và câu hỏi mở](#10-giả-định-và-câu-hỏi-mở). |

```text
Browser (HTML/CSS/JS) -- HTTP/JSON --> Backend Node.js -- MySQL --> sportbooking_system
```

## 2. Trang và điều hướng

Mọi trang có điều hướng **Quay lại**. Nút quay lại ưu tiên lịch sử trình duyệt; nếu không có trang trước phù hợp thì dùng đích dự phòng trong bảng. Khi hết phiên, trang yêu cầu đăng nhập và trở lại trang trước sau khi đăng nhập thành công. Các trang dữ liệu đều có trạng thái đang tải, lỗi có thể thử lại, và trống có hướng dẫn hành động tiếp theo.

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
| Hồ sơ | Tên, email, SĐT duy nhất, giới tính và trình độ nếu có; sửa hồ sơ, đổi mật khẩu, đăng xuất; điều khoản đăng ký là nội dung cố định. | Loading hồ sơ; lỗi có thử lại; trường không tải không được âm thầm ghi đè. | Trang trước; dự phòng trang chủ. |
| Tin tức thể thao (tùy chọn) | Danh sách tin từ RSS, tiêu đề, nguồn, thời điểm và liên kết bài gốc. | Loading; lỗi nguồn RSS có thể thử lại; trống thông báo chưa có bài. Nguồn RSS chốt khi triển khai tính năng tùy chọn. | Trang trước; dự phòng trang chủ. |
| Đăng nhập / đăng ký | Email + mật khẩu; đăng ký gồm thông tin hồ sơ và xác nhận đoạn điều khoản cố định. | Lỗi xác thực/validation hiển thị cạnh trường và thông báo; loading khóa nút gửi; trang đăng ký thành công quay về đăng nhập theo nghiệp vụ. | Trang trước; dự phòng trang chủ hoặc đăng nhập tương ứng. |

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

- **Màu chủ đạo:** xanh đậm `#1B5E20`, xanh `#2E7D32`, xanh sáng `#4CAF50`; nền kem `#F6F8F4`, không dùng trắng thuần làm nền trang.
- **Điểm nhấn:** lime `#C6F432` cho CTA **Đặt sân ghép đối ngay** và nhãn **Xin ghép**. Chữ phụ dùng xám nhạt nhưng phải giữ đủ tương phản với nền.
- **Chữ:** Be Vietnam Pro hoặc Plus Jakarta Sans, có đủ dấu tiếng Việt; tiêu đề lớn, đậm, phân cấp rõ ràng.
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

Các giá trị dùng làm design tokens; có thể bổ sung theo nhu cầu component nhưng không đổi các màu nghiệp vụ đã chốt.

```css
:root {
  color-scheme: light;
  --color-green-900: #1B5E20;
  --color-green-800: #2E7D32;
  --color-green-500: #4CAF50;
  --color-lime: #C6F432;
  --color-cream: #F6F8F4;
  --color-surface: #EEF2EB;
  --color-text: #18321B;
  --color-text-muted: #68756A;
  --color-border: #DCE5D8;
  --color-warning: #F2C94C;
  --color-error: #B84242;
  --color-match: #C6F432;

  --radius-card: 16px;
  --radius-panel: 24px;
  --radius-pill: 999px;

  --shadow-card: 0 8px 24px rgb(27 94 32 / 8%);
  --shadow-raised: 0 14px 32px rgb(27 94 32 / 14%);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --motion-fast: 150ms;
  --motion-normal: 220ms;
  --content-max: 1200px;
}
```

## 4. Mô hình dữ liệu MySQL

Các bảng dưới đây là mô hình đích đề xuất; bảng/cột đang có trong `sportbooking_system` cần được đối chiếu trước khi migration/import. Dùng InnoDB, `utf8mb4`, khóa ngoại cho quan hệ; số tiền VND lưu số nguyên `DECIMAL(12,0)`. Tên enum trong database dùng giá trị tiếng Anh ổn định, giao diện ánh xạ sang nhãn tiếng Việt.

Do `time_slots.current_booking_id` tham chiếu `bookings.id`, migration tạo bảng `time_slots` ban đầu chỉ tạo cột này, chưa thêm foreign key. Foreign key được thêm trong migration tạo bảng `bookings`, sau khi cả hai bảng đã tồn tại.

### 4.1 Bảng và cột

| Bảng | Cột, kiểu và ràng buộc |
|---|---|
| `users` | `id BIGINT UNSIGNED PK`; `full_name VARCHAR(120) NOT NULL`; `email VARCHAR(254) NOT NULL UNIQUE`; `password_hash VARCHAR(255) NOT NULL`; `phone VARCHAR(20) NULL UNIQUE`; `gender ENUM('MALE','FEMALE','OTHER') NULL`; `skill_level ENUM('BEGINNER','INTERMEDIATE','GOOD') NULL`; `role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER'`; `account_status ENUM('ACTIVE','ADMIN_LOCKED') NOT NULL DEFAULT 'ACTIVE'`; `failed_login_count TINYINT UNSIGNED NOT NULL DEFAULT 0`; `login_locked_until DATETIME(3) NULL`; `terms_accepted_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(role, account_status)`. Khóa tạm do sai mật khẩu tách khỏi `account_status`. |
| `user_sessions` | `id BIGINT UNSIGNED PK`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `token_hash CHAR(64) NOT NULL UNIQUE`; `expires_at DATETIME(3) NOT NULL`; `revoked_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`. Index: `(user_id, expires_at)`. Chỉ lưu hash session/token, không lưu token thô. |
| `facilities` | `id BIGINT UNSIGNED PK`; `name VARCHAR(160) NOT NULL`; `address VARCHAR(500) NOT NULL`; `district VARCHAR(120) NOT NULL`; `opening_time TIME NULL`; `closing_time TIME NULL`; `hotline VARCHAR(30) NULL`; `latitude DECIMAL(10,7) NULL`; `longitude DECIMAL(10,7) NULL`; `map_url VARCHAR(1000) NULL`; `description TEXT NULL`; `amenities JSON NULL`; `rules TEXT NULL`; `cancellation_policy TEXT NULL`; `image_url VARCHAR(1000) NULL`; `is_active BOOLEAN NOT NULL DEFAULT TRUE`; `is_seed BOOLEAN NOT NULL DEFAULT FALSE`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(district, is_active)`, `(is_active, name)`. Khu vực lọc lấy từ `district` đã tách/chuẩn hóa từ địa chỉ cơ sở. |
| `courts` | `id BIGINT UNSIGNED PK`; `facility_id BIGINT UNSIGNED NOT NULL FK -> facilities.id`; `name VARCHAR(120) NOT NULL`; `sport_type ENUM('FOOTBALL_MINI','BADMINTON','PICKLEBALL') NOT NULL`; `price_normal DECIMAL(12,0) NOT NULL`; `price_peak DECIMAL(12,0) NOT NULL`; `survey_price_min DECIMAL(12,0) NULL`; `survey_price_max DECIMAL(12,0) NULL`; `initial_rating DECIMAL(2,1) NULL`; `description TEXT NULL`; `is_active BOOLEAN NOT NULL DEFAULT TRUE`; `is_seed BOOLEAN NOT NULL DEFAULT FALSE`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index: `(sport_type, is_active)`, `(facility_id, is_active)`. `initial_rating` nhận giá trị 1.0–5.0; giá khảo sát tối thiểu/tối đa được lưu riêng, không dùng thay `price_normal`/`price_peak`. Mỗi cơ sở có ít nhất một sân; dữ liệu khởi tạo có một sân mặc định/cơ sở. |
| `time_slots` | `id BIGINT UNSIGNED PK`; `court_id BIGINT UNSIGNED NOT NULL FK -> courts.id`; `service_date DATE NOT NULL`; `starts_at TIME NOT NULL`; `ends_at TIME NOT NULL`; `price DECIMAL(12,0) NOT NULL`; `status ENUM('AVAILABLE','LOCKED','BOOKED') NOT NULL DEFAULT 'AVAILABLE'`; `current_booking_id BIGINT UNSIGNED NULL FK -> bookings.id`; `lock_expires_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. `UNIQUE(court_id, service_date, starts_at)` ngăn tạo trùng định danh khung; index `(service_date, status, court_id)` và `(current_booking_id)`. Khung một tiếng; giờ vàng 17:00–21:00 có giá cấu hình cao hơn. `LOCKED` quá hạn được xem là trống theo thời điểm hiện tại, không chờ tác vụ nền. |
| `bookings` | `id BIGINT UNSIGNED PK`; `booking_code VARCHAR(40) NOT NULL UNIQUE`; `user_id BIGINT UNSIGNED NOT NULL FK -> users.id`; `status ENUM('PENDING','CONFIRMED','COMPLETED','EXPIRED','CANCELLED') NOT NULL`; `total_amount DECIMAL(12,0) NOT NULL`; `cancelled_by ENUM('USER','ADMIN') NULL`; `cancellation_reason VARCHAR(500) NULL`; `confirmed_at DATETIME(3) NULL`; `cancelled_at DATETIME(3) NULL`; `lock_expires_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index `(user_id, status, created_at)`, `(status, lock_expires_at)`. Mỗi user tối đa một `PENDING`, kiểm soát bằng transaction/khóa user ở mục 7; MySQL không có partial unique index trực tiếp cho điều kiện này. Thông tin số tiền đã trả và lựa chọn thanh toán được đọc qua `payments`. |
| `booking_slots` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL FK -> bookings.id`; `time_slot_id BIGINT UNSIGNED NOT NULL FK -> time_slots.id`; `price_at_booking DECIMAL(12,0) NOT NULL`; `created_at DATETIME(3) NOT NULL`. `UNIQUE(booking_id, time_slot_id)`; index `(time_slot_id, booking_id)`. Giữ lịch sử các khung và giá snapshot; ràng buộc khả dụng hiện tại nằm ở `time_slots` và được khóa trong transaction. |
| `booking_tickets` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `qr_code VARCHAR(80) NOT NULL UNIQUE`; `created_at DATETIME(3) NOT NULL`. Một ticket cho một booking. Mã QR có dạng `QR-` + chuỗi ngẫu nhiên, QR chứa mã đơn để nhân viên đối chiếu; không có API check-in/quét QR. |
| `payments` | `id BIGINT UNSIGNED PK`; `booking_id BIGINT UNSIGNED NOT NULL UNIQUE FK -> bookings.id`; `status ENUM('PENDING','PAID','REFUNDED') NOT NULL`; `amount_due DECIMAL(12,0) NOT NULL`; `paid_amount DECIMAL(12,0) NOT NULL DEFAULT 0`; `refunded_amount DECIMAL(12,0) NOT NULL DEFAULT 0`; `payment_option ENUM('DEPOSIT_50','FULL') NOT NULL`; `paid_at DATETIME(3) NULL`; `refunded_at DATETIME(3) NULL`; `created_at DATETIME(3) NOT NULL`; `updated_at DATETIME(3) NOT NULL`. Index `(status, updated_at)`. Hoàn 0đ giữ `PAID`; có hoàn tiền thì `REFUNDED`, kể cả hoàn một phần. |
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
| `POST /auth/register` | Public | Họ tên, email, mật khẩu, SĐT, đồng ý điều khoản | `201`, hồ sơ mới không gồm hash mật khẩu | `400` dữ liệu sai; `409` email/SĐT trùng |
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
| `POST /bookings` | User | Court ID, ngày, danh sách slot ID, lựa chọn thanh toán, lựa chọn/tiêu chí tìm đối | `201`, booking `PENDING`, giá snapshot, `lock_expires_at` | `400` dữ liệu/khung không liền; `401`; `403` không đủ quyền; `404`; `409` slot bận, user đã có `PENDING`, thời gian/giá thay đổi |
| `GET /bookings?mine=true` | User | Lọc trạng thái/trang | Danh sách đơn của user hiện tại | `401` |
| `GET /bookings/{id}` | Chủ đơn/Admin | Không | Chi tiết đơn, payment, ticket, match và trạng thái hiển thị | `401`; `403` không phải chủ/admin; `404` |
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
| Hết hạn tìm đối | Quét deadline đến hạn | Mỗi chu kỳ có hạn `min(thời điểm bắt đầu chu kỳ + 10 phút, giờ bắt đầu khung đầu tiên - 10 phút)` theo [business-flow.md quy tắc 7](../01-plan/business-flow.md#7-quy-tắc-nghiệp-vụ). `SEARCHING` hết chu kỳ đầu chuyển `WAITING_RELAX`, đặt hạn quyết định 10 phút và báo A; hết chu kỳ thứ hai chuyển `EXPIRED`. `WAITING_RELAX` hết hạn quyết định hoặc không còn thời gian cho chu kỳ mới chuyển `EXPIRED`. |
| Hoàn tất đơn | Sau giờ kết thúc khung cuối | Chỉ cập nhật booking `CONFIRMED` thành `COMPLETED`. **Sắp tới** và **Đang trong trận** được tính động theo giờ UTC+7; không ghi hai trạng thái này vào database. |
| Polling | Tối đa 5 giây | Backend cung cấp dữ liệu mới cho lịch khung giờ, đơn, tìm đối và số chưa đọc. Trình duyệt hủy polling khi trang rời/ẩn phù hợp và không dùng dữ liệu poll làm căn cứ cho thao tác ghi. |

Tất cả tác vụ có thể chạy lặp an toàn: chỉ chuyển trạng thái nếu bản ghi còn ở trạng thái nguồn hợp lệ, không gửi thông báo trùng khi chạy lại. Các yêu cầu ghi từ UI/API đều đọc và kiểm tra lại trạng thái, giá, quyền sở hữu và deadline tại server.

## 7. Chống đặt trùng và xử lý đồng thời

1. Dùng MySQL InnoDB transaction cho tạo booking và khóa khung. Khóa các hàng `time_slots` theo ID tăng dần (`SELECT ... FOR UPDATE`) để giảm deadlock.
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
| A | `Cụm sân / Khu vực` | `facilities.district` | Điền xuống giá trị quận/huyện liền trước ở các dòng trống trong cùng nhóm; chuẩn hóa khoảng trắng và tên quận thống nhất. |
| B | `Tên môn` | `courts.sport_type` | Dòng trống thuộc nhóm môn hiện hành được điền theo nhãn nhóm; ánh xạ các biến thể “Sân bóng/bóng đá mini” → `FOOTBALL_MINI`, “cầu lông” → `BADMINTON`, “pickleball” → `PICKLEBALL`; giá trị không nhận diện phải báo lỗi, không đoán. |
| C | `Tên sân` | `facilities.name`, `courts.name` | Chuẩn hóa khoảng trắng; dùng tên đã khảo sát cho cơ sở và sân mặc định. |
| D | `Địa chỉ chi tiết` | `facilities.address`, `facilities.district` | Giữ địa chỉ đầy đủ; đối chiếu/tách quận với cột A đã điền xuống. Nếu không khớp thì đánh dấu cần rà soát, không âm thầm ghi đè quận. |
| E | `Link map` | `facilities.map_url` | Giữ URL hợp lệ. Nội dung không phải URL hoặc URL lỗi cần xác minh; không tự biến tên địa điểm thành URL. |
| F | `Số điện thoại liên hệ` | `facilities.hotline` | Chuyển số dạng scientific notation về chuỗi chữ số, giữ số 0 đầu theo định dạng SĐT Việt Nam; kiểm tra độ dài/prefix và rà soát các số bị mất độ chính xác do kiểu số Excel. Lưu dưới dạng chuỗi, không kiểu số. |
| G | `Giờ mở cửa / đóng cửa` | `facilities.opening_time`, `facilities.closing_time` | Chuẩn hóa separator, khoảng trắng và mẫu giờ (`HH:mm–HH:mm`, “đến”, dấu gạch nối). Chuẩn hóa “Cả ngày”/`24:00` theo quy ước giờ vận hành đã xác nhận; giá trị không phân giải được đưa vào báo cáo lỗi, không tự thay bằng mặc định. |
| H | `Tiện ích` | `facilities.amenities` | Tách các mục phân cách bằng `/`, dấu phẩy hoặc dấu chấm phẩy, trim và loại mục trùng; chuyển thành JSON array. Ô trống áp dụng tiện ích mặc định theo môn và đánh dấu `is_seed`. |
| I | `rate đgia` | `courts.initial_rating` | Điểm hợp lệ phải là số từ 1.0 đến 5.0. Nếu Excel đã chuyển điểm thành ngày/serial ngày hoặc dấu `*****`, không thể suy ngược đáng tin cậy; đối chiếu nguồn khảo sát để khôi phục điểm, nếu chưa xác minh thì để `NULL` và ghi cảnh báo, không tự quy đổi serial thành sao. |
| J | Cột giá (không có header) | `courts.survey_price_min`, `courts.survey_price_max` | Loại đơn vị/ký tự tiền tệ và `/giờ`, nhận dạng khoảng giá; tách số nhỏ nhất/lớn nhất, chuẩn hóa `k`/`nghìn` và VNĐ về đồng. Nếu chỉ có một mức thì lưu min=max; không phân tích được thì báo lỗi để rà soát. Đây là giá khảo sát, không thay giá vận hành `price_normal`/`price_peak`. |
| Không có | Ảnh | `facilities.image_url` | Workbook không cung cấp ảnh; để `NULL` cho tới khi có nguồn ảnh hợp lệ. |

#### Quy tắc import và mặc định

1. Đọc `.xlsx` hoặc CSV UTF-8 xuất từ workbook; kiểm tra header, số dòng dữ liệu, kiểu và giá trị bắt buộc trước khi ghi.
2. Chuẩn hóa dữ liệu theo bảng ánh xạ; xuất báo cáo các dòng cần xác minh (đặc biệt điện thoại mất độ chính xác, map không phải URL, giờ không phân tích được, rating bị chuyển thành date/serial, giá không tách được). Không đoán dữ liệu nguồn; yêu cầu xác nhận/correction trước khi import các giá trị bắt buộc sai hoặc thiếu.
3. Với dữ liệu thiếu được phép mặc định, đặt giờ mở cửa 06:00–22:00, giá thường theo môn lấy từ hằng số trong script, giờ vàng 17:00–21:00 bằng giá thường × 1,3, tiện ích mặc định theo môn, chính sách hủy theo [business-flow mục 4.1](../01-plan/business-flow.md#41-hủy-đơn-và-hoàn-tiền-fr-08-uc-08), quận/huyện tách từ địa chỉ và một ảnh cho mỗi cơ sở khi đã có tài nguyên ảnh. Các bản ghi có trường mặc định được đánh dấu `is_seed = TRUE`; sửa dữ liệu bởi admin phải chuyển `is_seed = FALSE`.
4. Import lặp lại không tạo trùng và không ghi đè dữ liệu do admin đã sửa. Định danh khớp seed dùng khóa chuẩn hóa từ quận + tên + địa chỉ cho cơ sở, và `facility_id + court.name` cho sân; các xung đột không thể phân định phải dừng để rà soát.
5. Tạo khung một tiếng cho 14 ngày tới trong thời gian mở cửa 06:00–22:00; chỉ chèn khung còn thiếu theo `UNIQUE(court_id, service_date, starts_at)`, không cập nhật khung đã tồn tại. Giá lấy từ cấu hình giá vận hành của sân.
6. Sau import, xác nhận đúng 29 cơ sở, 6 quận, 29 sân và phân bố môn cầu lông 10, bóng đá mini 8, pickleball 11; sai lệch phải báo và dừng, không sửa số liệu để khớp.

Giá thường cụ thể theo từng môn, quy ước khôi phục rating đã bị Excel chuyển thành ngày/serial, và nguồn ảnh chưa có trong workbook; cần xác nhận trước khi seed các giá trị đó. Database `sportbooking_system` giữ dữ liệu khảo sát hiện có và không phải mục tiêu chạy seed phát triển.

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
| GD-03 | Mô hình bảng tại mục 4 là schema đích đề xuất, chưa thay thế schema MySQL đang có; cần migration tương thích sau khi kiểm kê database. |
| GD-04 | Dùng `DATETIME(3)` chuẩn hóa UTC cho thời điểm sự kiện và deadline; ngày/giờ khung chơi lưu theo giờ địa phương Hà Nội (`service_date`, `starts_at`, `ends_at`) rồi ghép với `Asia/Ho_Chi_Minh` khi tính trạng thái. |
| GD-05 | Mã đơn có dạng `SPB-YYYYMMDD-xxxxxx`; mã QR có dạng `QR-` + chuỗi ngẫu nhiên. Hai loại mã khác tiền tố nên không giao nhau; QR chứa mã đơn để nhân viên đối chiếu. |
| GD-06 | Các trường thông tin cơ sở/sân trong bảng đích là mô hình đề xuất tối thiểu; cần đối chiếu dữ liệu khảo sát thực tế để tránh làm mất cột/dữ liệu nguồn. |
| GD-07 | Giá thường của từng môn được khai báo thành hằng số trong script seed; số cụ thể chờ user xác nhận. |

### Câu hỏi mở

1. Cần đối chiếu từ nguồn khảo sát gốc những dòng rating đã bị Excel chuyển thành serial ngày hoặc `*****`; nếu không khôi phục được thì để `initial_rating` là `NULL` hay cung cấp giá trị xác nhận theo từng dòng?
2. Xác nhận cơ chế đăng nhập lưu phiên 8 giờ bằng cookie/session phía server hay phương án khác.
3. Xác nhận framework Node.js; nguồn RSS sẽ chốt khi triển khai phần tin tức tùy chọn.
4. Xác nhận bộ tiện ích mặc định theo từng môn và nguồn ảnh dùng cho một ảnh mỗi cơ sở.