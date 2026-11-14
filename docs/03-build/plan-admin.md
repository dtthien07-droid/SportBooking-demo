# Kế hoạch Module 10 — Admin: Dashboard và booking ngoại lệ

**Trạng thái: Đã duyệt**

## Hiện trạng

- Đã có vai trò `ADMIN`, role được đưa vào session và trả về từ API xác thực; đã có middleware xác thực session và seed admin.
- Chưa có API hoặc trang giao diện Admin. Các route hiện tại được mount trong `backend/src/app.js`; bookings và notifications đã có repository/service/route riêng.
- Booking hiện có quy trình hủy trong transaction: khóa đơn, payment và slot; cập nhật trạng thái/hoàn tiền; nhả slot. Hàm cập nhật hủy đang gán `cancelled_by = USER`.
- `backend/src/notifications/notification-events.js` đã có `notifyIncidentCancellation(connection, booking, refundedAmount)`, tạo thông báo booking và payment qua cùng transaction connection; hiện chưa được gọi từ service hủy.
- Đã có `requireAuth`, nhưng chưa có middleware kiểm tra riêng role `ADMIN`.
- Không có mockup admin trong `docs/02-design/mockups/`. Chỉ có design system và mockup các trang user. Vì vậy trang admin sẽ được dựng mới theo token và component hiện có trong `sportbooking-design-system.css`, không chép một mockup admin có sẵn.

## Phạm vi

- Thêm API liệt kê booking cho Admin, hủy booking do sự cố và dashboard.
- Tạo trang `/admin-bookings.html` với khối dashboard 4 thẻ số liệu ở đầu trang, danh sách booking và hộp xác nhận hủy sự cố; thêm điều hướng sau đăng nhập và chặn truy cập theo role.
- Không triển khai quản lý user/cơ sở/sân/khung giờ hoặc xuất Excel trong kế hoạch này.

## 10A — Backend và kiểm thử

1. Thêm middleware kiểm tra `request.auth.user.role === 'ADMIN'` sau `requireAuth`; gắn vào mọi route dưới `/api/v1/admin`. Session hợp lệ có role thường phải nhận `403`, không thay đổi dữ liệu.
2. Tạo router/service/repository admin theo cấu trúc backend hiện tại và mount tiền tố `/api/v1/admin`.
3. `GET /api/v1/admin/bookings`
   - Bộ lọc `status` theo trạng thái booking; tìm chuỗi mã đơn bằng `q`; phân trang `page`/`page_size`, giới hạn và chuẩn hóa theo convention hiện có.
   - Trả danh sách booking kèm thông tin chủ đơn cần cho vận hành (đề xuất: tên, email, số điện thoại), trạng thái, mã đơn, số tiền đã trả/hoàn và thông tin sân/khung giờ.
   - Trả metadata phân trang; validate status, từ khóa và số trang, lỗi theo JSON error format hiện tại.
4. `POST /api/v1/admin/bookings/{id}/incident-cancellation`
   - Nhận `cancellation_reason` bắt buộc, trim và validate độ dài không quá 500 ký tự; không nhận số tiền hoàn hoặc trạng thái từ client.
   - Chỉ chấp nhận `CONFIRMED` (kể cả đang diễn ra) và `PENDING`. Trong một transaction: khóa booking/payment/slot để chống race; ghi `CANCELLED`, `cancelled_by = ADMIN`, lý do và thời điểm; với `CONFIRMED`, hoàn 100% `paid_amount` (lưu `refunded_amount`/trạng thái payment theo schema hiện có); với `PENDING`, số hoàn là 0; nhả slot.
   - Tạo notification cùng transaction connection: `CONFIRMED` dùng `notifyIncidentCancellation` để báo hủy và hoàn tiền; `PENDING` chỉ tạo một thông báo “đơn đã bị hủy do sự cố”, không tạo thông báo hoàn tiền.
   - Hủy lặp, đơn đã kết thúc/đã hủy hoặc không còn hợp lệ trả `409`; lỗi giữa chừng rollback cả booking, payment, slot và thông báo.
   - Điều chỉnh hàm repository cập nhật hủy để nhận actor được kiểm soát nội bộ hoặc bổ sung hàm phù hợp, không làm thay đổi hành vi hủy hiện có của user.
5. `GET /api/v1/admin/dashboard`
   - Nhận `period=today|7d|30d`; trả 4 số liệu: đơn mới, doanh thu thực thu (đã thu trừ hoàn), đơn đã hủy và đơn hoàn thành.
   - Các số lượng booking tính theo `created_at` trong kỳ. Doanh thu trong kỳ tính tiền đã thu theo `paid_at` trừ tiền hoàn theo `refunded_at`; không dùng tổng giá booking thay thế.
   - Không triển khai tỷ lệ lấp sân, sân đặt nhiều hoặc chỉ số tìm đối.
6. Giữ lỗi theo cấu trúc `{ error: { code, message, details } }`; các phản hồi riêng tư đặt `Cache-Control: no-store`.

### Kiểm thử 10A

- User thường gọi từng API Admin nhận `403`; Admin hợp lệ gọi được; chưa đăng nhập nhận `401`.
- User thường gọi `POST /api/v1/admin/bookings/{id}/incident-cancellation` nhận `403`; xác minh booking, payment, slot và notification không thay đổi.
- Lọc trạng thái/mã đơn, phân trang, validate truy vấn và thông tin chủ đơn trong kết quả.
- Lý do thiếu/rỗng/quá dài bị từ chối; booking `CONFIRMED` được hủy với actor `ADMIN`, kể cả đang diễn ra, hoàn đúng toàn bộ số đã trả, nhả các slot và tạo thông báo trong transaction.
- Booking `PENDING` được hủy, hoàn 0 và chỉ tạo một thông báo “đơn đã bị hủy do sự cố”, không tạo thông báo hoàn tiền.
- `COMPLETED`, `EXPIRED`, `CANCELLED`, hủy lặp và cập nhật cạnh tranh bị từ chối `409`; lỗi khi ghi notification hoặc payment không để lại cập nhật một phần.
- Dashboard trả đủ 4 số liệu theo `today`, `7d`, `30d`, dùng đúng mốc `created_at`/`paid_at`/`refunded_at` và trả số 0 khi không có dữ liệu.
- Chạy test backend hiện hành cùng test mới liên quan; xác nhận các test hủy của user vẫn giữ nguyên.

## 10B — Giao diện

1. Tạo trang `/admin-bookings.html` theo HTML/CSS/JS thuần và cách gọi API hiện có; dùng token trong `sportbooking-design-system.css` (màu, typography, spacing, radius, shadow, trạng thái và focus), không tạo bảng màu riêng.
2. Đặt khối dashboard 4 thẻ số liệu ở đầu `/admin-bookings.html`, có chọn kỳ `today`, `7d`, `30d`; không tạo trang dashboard riêng.
3. Trang Quản trị đơn gồm tìm mã đơn, lọc trạng thái, phân trang, trạng thái loading/lỗi/rỗng và danh sách booking với thông tin chủ đơn, sân/khung giờ, thanh toán/hoàn tiền.
4. Chỉ hiển thị thao tác hủy sự cố với booking có thể xử lý. Hộp xác nhận nêu rõ lý do bắt buộc và khoản hoàn theo trạng thái booking; khóa gửi trong lúc xử lý, hiển thị lỗi `409` để tải lại dữ liệu, và cập nhật danh sách khi thành công.
5. Sau đăng nhập, điều hướng `ADMIN` đến `/admin-bookings.html`; `USER` tiếp tục đến `/trangchu-user.html`. Khi vào trang admin, kiểm tra session qua `/api/v1/auth/me`; user thường được đưa về trang user kèm thông báo không đủ quyền, chưa đăng nhập được chuyển đến đăng nhập.
6. Kiểm tra role phía frontend chỉ phục vụ điều hướng/UX. Mọi API Admin vẫn bắt buộc `requireAuth` và middleware `ADMIN`; không dựa vào menu, URL hay role do trình duyệt gửi. Không chặn request tới file tĩnh `/admin-bookings.html` ở server.

## Chia cụm và commit

- **10A — Backend và test:** middleware role, API, transaction, kiểm thử. Một commit riêng.
- **10B — Giao diện:** trang Quản trị đơn, hộp xác nhận, điều hướng và guard role. Một commit riêng, thực hiện sau khi 10A sẵn sàng.

## Quyết định đã chốt

1. Dashboard có 4 số liệu: đơn mới, doanh thu thực thu (đã thu trừ hoàn), đơn đã hủy và đơn hoàn thành; chọn khoảng `today`, `7d`, `30d`. Không làm tỷ lệ lấp sân, sân đặt nhiều hoặc tìm đối.
2. Số đơn tính theo `created_at`; doanh thu tính tiền đã thu theo `paid_at` trừ tiền hoàn theo `refunded_at` trong kỳ.
3. Hủy sự cố áp dụng cho `CONFIRMED` (kể cả đang diễn ra) và `PENDING`; không cho `COMPLETED`, `EXPIRED`, `CANCELLED`. `PENDING` hoàn 0, chỉ tạo một thông báo “đơn đã bị hủy do sự cố”, không tạo thông báo hoàn tiền.
4. Không chặn file tĩnh `/admin-bookings.html` ở server; dùng guard frontend và trả `403` trên mọi API Admin cho user thường.
5. Khối dashboard 4 thẻ số liệu nằm đầu `/admin-bookings.html`; không tạo trang dashboard riêng.

Chưa viết code. Chờ bạn duyệt trước khi bắt đầu triển khai.

## Hoàn thiện module 10

Thực hiện theo yêu cầu đã duyệt trong phiên 2026-11-13; chỉ sửa code backend/frontend và một migration 008.

### Đã hoàn tất trong phiên

- GĐ0 nền tảng: migration `008-create-admin-audit-logs.sql`; runner giới hạn database cho phép; audit giao dịch hủy sự cố và khóa/mở khóa user; weak ETag/304 cho GET booking, dashboard, users; dùng chung admin shell/polling; đổi ADMIN_HOME và mở rộng allowlist trang.
- GĐ1 tổng quan: dashboard API hỗ trợ `range` và tương thích `period`; khoảng UTC+7, KPI, trạng thái, doanh thu theo ngày, tỷ lệ lấp, top sân, đơn mới; giao diện SVG nội tuyến và polling.
- GĐ2 người dùng: API lọc/phân trang không trả trường nhạy cảm; khóa/mở trong transaction, thu hồi phiên, chống tự khóa và cập nhật đồng thời; giao diện bảng, draft/applied, hộp xác nhận và polling.
- GĐ3 cơ sở/sân: API danh sách/chi tiết/tạo/sửa, khóa cập nhật lạc hậu, chặn ngừng hoạt động/đổi môn khi còn đơn hiệu lực, audit cùng transaction; trang quản trị có lọc, form cơ sở và danh sách/form sân.
- GĐ4 khung giờ/giá: dùng lại slot generator hiện có; tạo tối đa 31 ngày idempotent; cập nhật giá chỉ cho khung `AVAILABLE`; trang lưới trạng thái có chữ, xem trước số khung và polling.
- GĐ5 đơn đặt sân: polling cập nhật bảng, tab counts và KPI tại chỗ; giữ bộ lọc/trang/scroll, tô nổi đơn mới trong 5 giây; thao tác admin làm mới ngay.
- GĐ6 kiểm thử: frontend 28 file đạt; backend `npm test` đạt 75/75 hai lượt với `sportbooking_test`; quét scope/icon/DOM đạt; `node --check` đã chạy.
- Migration đã áp dụng/xác minh chỉ trên `sportbooking_test`.
- HTTP integration GĐ0–4 và frontend test tập trung đạt; kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**.

### Còn phải làm

- Xác nhận trực quan các trang bằng trình duyệt: **Chờ người dùng xác nhận**.
- Mockup người dùng và khung giờ trong thư mục nguồn hiện rỗng; dashboard/cơ sở dùng giao diện hiện có, chưa chép nguyên nội dung mockup. Trang cài đặt không triển khai.
- Xuất dữ liệu, bộ lọc nâng cao và nội dung ngoài nghiệp vụ đã bỏ hoặc vô hiệu; cần đối chiếu trực quan lần cuối.
- Trước khi phát hành, chỉ chạy `node ../infra/database/migrate-bookings.js --database sportbooking_dev` khi được phép; không chạy vào `sportbooking_system`.
