# Kế hoạch — Module 4: Đặt sân, giữ chỗ và chống đặt trùng

> Trạng thái: Kế hoạch đã được duyệt; Giai đoạn 4.B (Migration 003) đã áp dụng và xác minh trên `sportbooking_test` và `sportbooking_dev`.
> Quyết định đã chốt: enum có đủ 5 trạng thái; tên deadline `lock_expires_at`; bảng chi tiết `booking_slots`; route tạo `POST /api/v1/bookings`; route hủy `POST /api/v1/bookings/:id/cancel`; trang `/dat-san.html`; chỉ bắt đầu hold khi xác nhận đặt sân; scheduler mỗi 60 giây; chưa ghi notifications; giá snapshot lấy từ `time_slots.price` trong transaction.

## 1. Nguồn và phạm vi

- Tuân thủ `docs/01-plan/business-flow.md` là nguồn sự thật nghiệp vụ; đối chiếu `docs/02-design/spec.md` mục 4, 5.2, 6.1–6.2, 6 (tác vụ nền) và 7 (xử lý đồng thời).
- Module roadmap số 4: giữ chỗ 10 phút, mỗi user tối đa một booking `PENDING`, một booking gồm một hoặc nhiều slot liên tiếp cùng sân/ngày.
- Không xử lý thanh toán, vé QR, ghép đối, hoàn tiền, lịch sử booking hoặc hủy booking `CONFIRMED` ngoài phạm vi API giữ chỗ này.
- Dùng MariaDB 10.4/InnoDB, UTC cho timestamp lưu DB và UTC+7 cho thời gian nghiệp vụ hiển thị. Không dùng trạng thái giao diện làm căn cứ ghi dữ liệu.

## 2. Migration 003 — cấu trúc dữ liệu đề xuất

### 2.1 `bookings`

| Cột | Kiểu / ràng buộc đề xuất | Mục đích |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK, auto increment | ID nội bộ |
| `booking_code` | `VARCHAR(40) NOT NULL UNIQUE` | Mã đặt chỗ duy nhất, sinh phía backend |
| `user_id` | `BIGINT UNSIGNED NOT NULL`, FK → `users.id` | Chủ booking |
| `status` | `ENUM('PENDING','CONFIRMED','CANCELLED','EXPIRED','COMPLETED') NOT NULL` | Trạng thái nội bộ; bao gồm `COMPLETED` từ migration 003 |
| `total_amount` | `DECIMAL(12,0) NOT NULL` | Tổng giá snapshot của booking, VND |
| `lock_expires_at` | `DATETIME(3) NULL` | Deadline giữ chỗ; booking mới `PENDING` đặt bằng giờ DB + 10 phút |
| `cancelled_at` | `DATETIME(3) NULL` | Thời điểm chủ động hủy |
| `created_at`, `updated_at` | `DATETIME(3) NOT NULL` | Audit |

Index đề xuất: `(user_id, status, created_at)` và `(status, lock_expires_at)` để tìm booking của user và quét booking đến hạn. MariaDB 10.4 không hỗ trợ partial unique index cho “một `PENDING` mỗi user”; bảo đảm bằng cách khóa dòng `users` rồi kiểm tra booking `PENDING` trong cùng transaction. Mã booking tạo bằng nguồn ngẫu nhiên đủ mạnh, không chứa thông tin cá nhân; retry khi gặp xung đột unique.

### 2.2 `booking_slots`

| Cột | Kiểu / ràng buộc đề xuất | Mục đích |
|---|---|---|
| `id` | `BIGINT UNSIGNED` PK, auto increment | ID chi tiết |
| `booking_id` | `BIGINT UNSIGNED NOT NULL`, FK → `bookings.id` | Booking chứa slot |
| `time_slot_id` | `BIGINT UNSIGNED NOT NULL`, FK → `time_slots.id` | Slot được giữ/đặt |
| `court_id` | `BIGINT UNSIGNED NOT NULL`, FK → `courts.id` | Snapshot/đối chiếu sân; phải khớp sân của slot |
| `price_at_booking` | `DECIMAL(12,0) NOT NULL` | Giá slot tại lúc giữ chỗ |
| `created_at` | `DATETIME(3) NOT NULL` | Audit |

Ràng buộc: `UNIQUE(booking_id, time_slot_id)`, index `(time_slot_id, booking_id)` và FK InnoDB. Kiểm tra nhất quán `court_id` với `time_slots.court_id` trong transaction; không cho client gửi giá. Slot chi tiết không bị xóa khi booking hết/hủy để giữ lịch sử và giá đã chốt.

### 2.3 `time_slots` và thời hạn

- Dùng `time_slots.status`: `AVAILABLE` → `LOCKED` khi hold thành công; `LOCKED` → `BOOKED` khi luồng thanh toán xác nhận booking; `LOCKED` → `AVAILABLE` khi user hủy giữ hoặc booking hết hạn.
- Lưu booking đang chiếm slot qua `current_booking_id` (FK → `bookings.id`) và dùng `time_slots.lock_expires_at` làm deadline duy nhất, đồng bộ với `bookings.lock_expires_at`. Khi giải phóng, chỉ cập nhật slot nếu `status='LOCKED'` và `current_booking_id` đúng booking cần giải phóng; đặt về `AVAILABLE`, xóa `current_booking_id` và deadline.
- Đọc lịch coi lock hết hạn là trống theo deadline ngay cả khi tác vụ nền chưa chạy. Tác vụ nền chỉ dọn trạng thái vật lý và phát sự kiện/thông báo; không phải điều kiện để slot trở nên khả dụng.
- Tên cột deadline đã chốt theo spec hiện hành: `bookings.lock_expires_at` và `time_slots.lock_expires_at`; không tạo thêm `expires_at` hoặc `locked_until`.

## 3. API và xử lý nghiệp vụ

Tất cả route nằm dưới `/api/v1/bookings`, dùng `requireAuth`; User chỉ thao tác booking thuộc mình. Backend lấy user ID từ session, không tin `user_id`, tổng tiền, giá hay trạng thái do client gửi.

### 3.1 Tạo giữ chỗ — `POST /api/v1/bookings`

- Input tối thiểu: `{ "slot_ids": [ ... ] }`. Danh sách phải tồn tại, không rỗng, ID hợp lệ/không trùng. Có thể bổ sung `court_id`/`service_date` để phát hiện lựa chọn sai sớm, nhưng server vẫn suy ra và xác minh từ DB.
- Kiểm tra đăng nhập, tài khoản còn hoạt động, định dạng đầu vào, quyền user, số slot, slot tồn tại/active, cùng sân/ngày, liên tiếp đúng từng giờ, còn cách giờ hiện tại ít nhất 15 phút và trạng thái `AVAILABLE` hoặc lock cũ đã hết hạn.
- Trong một transaction InnoDB:
  1. Khóa dòng user bằng `SELECT ... FOR UPDATE`; từ chối `409` nếu user đã có booking `PENDING` còn hiệu lực.
  2. Đọc/khóa tất cả slot theo `id` tăng dần bằng `SELECT ... FOR UPDATE`; xác minh đủ số slot trả về, cùng sân/ngày và liền kề.
  3. Đối với lock cũ đã hết hạn, giải phóng booking/slot cũ theo điều kiện trạng thái và deadline; chỉ nhận slot đang `AVAILABLE` hoặc lock đã hết hạn.
  4. Tính tổng giá bằng `time_slots.price` đã khóa trong transaction; ghi `bookings` trạng thái `PENDING`, `booking_code`, `total_amount`, deadline hiện tại + 10 phút và các dòng `booking_slots` kèm giá snapshot.
  5. Cập nhật tất cả slot trong cùng transaction sang `LOCKED`, cùng booking ID và cùng deadline. Kiểm tra affected rows khớp đầy đủ; thiếu bất kỳ slot nào thì rollback toàn bộ.
  6. Commit rồi trả `201` với `booking_id`, `booking_code`, `status`, `total_amount`, `lock_expires_at`, `remaining_seconds: 600` và chi tiết sân/ngày/slot cần render.
- Kết quả: `400` payload sai/slot không liền; `401` chưa đăng nhập; `403` user không có quyền; `404` resource không tồn tại; `409` slot bận, booking PENDING đã có hoặc dữ liệu thay đổi đồng thời; `410` deadline đã hết trước khi thao tác hoàn tất.
- Không retry transaction tùy tiện sau lỗi logic. Có thể retry deadlock có giới hạn nếu thao tác được thực hiện lại an toàn; sau retry vẫn không được trả thành công nếu điều kiện không còn đúng.

### 3.2 Đọc booking — `GET /api/v1/bookings/:id`

- Xác thực session; truy vấn booking cùng `booking_slots`, court/time-slot snapshot và deadline.
- Chỉ chủ booking hoặc Admin được xem; cân nhắc trả `404` cho booking không thuộc quyền để không tiết lộ tài nguyên.
- Với booking `PENDING`, so deadline theo giờ DB. Nếu hết hạn, phản hồi trạng thái hết hạn/`410` theo quy ước API, không trả booking còn hiệu lực giả; việc giải phóng vật lý được xử lý trong transaction/tác vụ hết hạn.
- Không gia hạn deadline khi đọc lại booking. Trả `lock_expires_at` dạng ISO UTC và thời gian còn lại được tính từ deadline server để UI đồng bộ lại.

### 3.3 Hủy giữ chỗ — `POST /api/v1/bookings/:id/cancel`

- Chỉ chủ booking hủy booking `PENDING`; xác minh trạng thái và khóa booking/slot trong transaction, chuyển booking `CANCELLED`, giải phóng toàn bộ slot còn thuộc booking và xóa deadline.
- Lặp hủy không được giải phóng slot đã được booking khác chiếm; trả lỗi trạng thái `409` nếu booking đã kết thúc/đã đổi trạng thái.
- Thành công trả `200` với trạng thái hủy hoặc `204`; chốt response shape cùng convention API hiện tại.
- Route `POST` đã chốt theo spec mục 5.2; trong phạm vi Module 4 chỉ hủy booking `PENDING`.

### 3.4 Giải phóng booking hết hạn

- Tác vụ backend mỗi phút chọn booking `PENDING` có deadline `<= UTC_TIMESTAMP(3)`; xử lý theo lô và khóa booking trước, sau đó khóa slot theo ID tăng dần.
- Trong transaction, cập nhật booking thành `EXPIRED` có điều kiện `status='PENDING' AND lock_expires_at <= now`; giải phóng đúng slot có `current_booking_id` bằng booking đó và `status='LOCKED'`.
- Tác vụ idempotent: chạy lặp không đổi booking khác trạng thái và không nhả slot mới. Tạm thời không ghi bảng `notifications`; khi giải phóng thành công ghi log `[Booking Expiry Job] Released booking <id>`.
- Khởi chạy `setInterval` mỗi 60 giây; cleanup phải idempotent và lỗi một lượt không làm dừng các lượt sau.
- Tạo giữ chỗ mới cũng phải tự nhận biết và giải phóng lock cũ đã quá hạn ngay trong transaction; lịch đọc trả lock quá hạn như trống kể cả khi scheduler chưa chạy.

## 4. Frontend và điều hướng

- Từ `/chi-tiet-san.html`, nút “Tiếp tục” chỉ hoạt động khi có lựa chọn slot liền kề hợp lệ. Điều hướng sang `/dat-san.html`, chuyển các ID slot và context tối thiểu; frontend không gửi giá làm giá trị tin cậy.
- Trang `/dat-san.html` hiển thị thông tin xác nhận; chỉ gọi `POST /api/v1/bookings` khi user bấm “Xác nhận đặt sân”. Không tạo hold ở trang chi tiết hoặc khi mới mở trang xác nhận.
- Sau phản hồi tạo hold thành công, hiển thị đồng hồ `10:00` dạng `mm:ss`, cảnh báo khi còn dưới 2 phút; render deadline từ server, cập nhật nhịp 1 giây và đồng bộ lại qua `GET` khi tải lại/đưa tab về foreground. Không gia hạn khi reload.
- Khi countdown đến `00:00`, khóa thao tác thanh toán/tiếp tục và báo hold hết hạn; frontend không tự giải phóng hoặc kết luận slot trống. Backend deadline là nguồn sự thật; lỗi mạng/thời gian client lệch phải gọi lại API.
- Khi user chủ động hủy, gọi API hủy đã duyệt; chỉ điều hướng về lịch sau phản hồi thành công. Nếu hết hạn/booking đã đổi trạng thái, hiển thị thông báo và tải lại trạng thái từ server.
- Trạng thái loading, lỗi có thử lại, hết hạn, xung đột và hết phiên phải hiển thị rõ. Không lưu token, mật khẩu hay giá/booking có thẩm quyền trong Web Storage.

## 5. Chia giai đoạn triển khai sau khi duyệt

| Giai đoạn | Phạm vi | Điều kiện hoàn tất |
|---|---|---|
| 4.A — Chốt contract | Duyệt tên bảng/cột, route, response, scheduler và hình thức trang xác nhận | Cập nhật plan/spec liên quan nếu cần; chưa code trước khi duyệt |
| 4.B — Migration 003 | Tạo `bookings`, `booking_slots`, index/FK/constraint; thêm FK từ `time_slots` về booking sau khi bảng tồn tại | Migration chạy được trên DB test được phép; kiểm tra schema/rollback theo quy trình dự án |
| 4.C — Backend domain/API | Repository, service, routes, validate input, session auth, quyền sở hữu, transaction/locking, hold/read/cancel, tác vụ hết hạn và đồng bộ API time-slots | Kiểm thử tích hợp trên DB test; không có partial lock khi rollback |
| 4.D — Transaction/concurrency test | Các race-condition và expire/cancel, idempotency scheduler, một PENDING/user | Tất cả test đạt, xác nhận hai request đồng thời không chiếm cùng slot |
| 4.E — Frontend | Trang xác nhận, nối API, countdown server deadline, hủy và xử lý 401/409/410 | Smoke test luồng tạo giữ, reload tiếp tục, hủy, timeout và slot trên lịch |
| 4.F — Hoàn tất | Cập nhật roadmap/changelog sau test; hướng dẫn chạy migration/test | Chỉ ghi “Xong” phần đã chạy thử; phần cần duyệt giao diện ghi “Chờ người dùng xác nhận” |

## 6. Danh sách test cần viết

### Validation và luồng thành công

- Chưa đăng nhập nhận `401`; user thường được phép tạo hold; role/quyền sai bị từ chối.
- Thiếu `slot_ids`, sai kiểu ID, mảng rỗng, ID trùng, ID không tồn tại hoặc slot thuộc sân không hoạt động bị từ chối đúng mã.
- Một slot hợp lệ và nhiều slot liền kề cùng court/date tạo đúng một booking `PENDING`; tổng tiền bằng tổng giá server; detail lưu snapshot từng slot; deadline đúng 10 phút theo giờ DB; tất cả slot chuyển `LOCKED` nguyên tử.
- Slot không liền kề, khác sân/ngày, đã qua hoặc bắt đầu dưới 15 phút bị từ chối; giá client giả mạo bị bỏ qua.
- User đã có booking `PENDING` không thể tạo hold khác; đọc lại booking không gia hạn deadline.
- User khác không đọc/hủy booking; resource không tồn tại trả đúng contract đã chốt.

### Race-condition và rollback

- Hai request đồng thời, hai user khác nhau, cùng giữ một slot: đúng một request thành công; request còn lại `409`; không có booking/detail dở dang.
- Hai request đồng thời cùng user nhưng dùng hai dải slot khác nhau: tối đa một booking `PENDING`.
- Hai request giao nhau một phần trên dải nhiều slot: chỉ một transaction thành công; không có subset slot bị giữ từ transaction thất bại.
- Tranh chấp giữa hold mới và job giải phóng booking hết hạn: slot chỉ thuộc tối đa một booking tại mọi thời điểm.
- Ép lỗi khi insert detail/update slot giữa transaction: rollback booking, details và toàn bộ cập nhật slot.
- Deadlock/retry (nếu được triển khai): retry hữu hạn, không duplicate booking/details hoặc giữ slot không đầy đủ.

### Hủy, hết hạn và tính lặp an toàn

- Hủy `PENDING` giải phóng ngay toàn bộ slot; hủy lặp hoặc booking không còn PENDING không nhả slot thuộc booking khác.
- Deadline chưa tới không bị expire; deadline vừa đến/quá hạn chuyển `PENDING` → `EXPIRED`, slot `LOCKED` → `AVAILABLE`, thông báo tạo một lần.
- Chạy job hết hạn lặp nhiều lần không đổi kết quả, không tạo thông báo trùng.
- Đọc lịch trước khi scheduler chạy vẫn coi lock hết hạn là trống; request giữ mới có thể tái sử dụng slot và đồng thời dọn tham chiếu booking cũ an toàn.
- API đọc booking sau deadline không cho tiếp tục thao tác giữ/thanh toán; reload countdown dùng deadline server, khi `00:00` khóa hành động và tải lại trạng thái.
- Hủy và expire xảy ra đồng thời: chỉ một chuyển trạng thái hợp lệ thắng; slot được giải phóng đúng một lần.

## 7. Các quyết định kỹ thuật đã chốt

1. Enum trạng thái gồm `PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `COMPLETED`; deadline `lock_expires_at`; bảng chi tiết `booking_slots`.
2. Tạo booking qua `POST /api/v1/bookings`, hủy qua `POST /api/v1/bookings/:id/cancel`; trang frontend `/dat-san.html`.
3. Hold chỉ bắt đầu khi user nhấn “Xác nhận đặt sân”; scheduler chạy `setInterval` 60 giây, chưa ghi notifications và log `[Booking Expiry Job] Released booking <id>` sau giải phóng thành công.
4. Giá snapshot lấy từ `time_slots.price` đã khóa trong transaction; không nhận giá từ client.

## 8. Kết quả Giai đoạn 4.B

- Tạo `bookings` và `booking_slots`, thêm FK `time_slots.current_booking_id` → `bookings.id` trên cả `sportbooking_test` và `sportbooking_dev`.
- Xác minh hai bảng mới dùng InnoDB; đủ 5 trạng thái booking; các cột deadline, mã/giá và đủ 5 FK đúng đích.
- Runner `migrate-bookings.js` đã được kiểm tra cú pháp. Không thể dùng `sportbooking_app` để thực thi vì tài khoản DB hiện chỉ có `USAGE`; migration được áp dụng qua kết nối quản trị DB đã chọn đích chính xác. Không thay đổi grants.
- Không chạy migration trên hoặc truy vấn ghi vào `sportbooking_system`.
