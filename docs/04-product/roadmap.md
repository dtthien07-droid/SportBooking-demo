# Roadmap — SportBooking

Nguồn: [docs/01-plan/business-flow.md](../01-plan/business-flow.md). Cập nhật trạng thái sau mỗi tính năng xong.

Trạng thái: Chưa làm / Đang làm / Xong

| # | Module | Mã | Nhóm | Trạng thái | Ghi chú |
|---|---|---|---|---|---|
| 1 | Đăng ký, đăng nhập, phân quyền, hồ sơ | FR-01, FR-03 | Cốt lõi | Đang làm | Đã triển khai: migration 001 (users, user_sessions), kết nối MySQL có guard, repository, đăng ký/đăng nhập, bcrypt, khóa 15 phút sau 5 lần sai, seed-admin; các bước 6–8 có route HTTP, phiên/cookie 8 giờ, hồ sơ, đổi mật khẩu và /health. Xong: test tích hợp trên sportbooking_test và toàn bộ npm test đạt 9/9; test tự dọn dữ liệu. Còn: express.static, frontend đăng nhập/đăng ký |
| 1b | Migration 002 + seed 29 cơ sở và khung giờ | FR-04 | Cốt lõi | Chưa làm | Cần migration 002 (facilities, courts, time_slots) và seed-facilities.js; xem plan-seed-data.md |
| 2 | Admin quản lý cơ sở, sân, khung giờ, giá | FR-04 | Cốt lõi | Chưa làm | Dữ liệu mẫu; cần cách sinh khung giờ hằng ngày vì seed chỉ sinh 14 ngày |
| 3 | Tìm kiếm và xem chi tiết sân | FR-05 | Cốt lõi | Chưa làm | |
| 4 | Đặt sân, giữ chỗ 10 phút, chống đặt trùng | FR-06, FR-12 | Cốt lõi | Chưa làm | Phần khó nhất, có test (chi tiết bên dưới) |
| 5 | Thanh toán giả lập, vé QR | FR-07 | Cốt lõi | Chưa làm | |
| 6 | Hủy và hoàn tiền | FR-08 | Cốt lõi | Chưa làm | |
| 7 | Lịch sử đặt sân | FR-09 | Cốt lõi | Chưa làm | |
| 8 | Thông báo trong app | FR-17 | Cốt lõi | Chưa làm | |
| 9 | Đánh giá sân | FR-18 | Nâng cao | Chưa làm | |
| 10 | Admin: dashboard, quản lý user, booking ngoại lệ | FR-10, FR-11, FR-19 | Cốt lõi | Chưa làm | |
| 11 | Tìm đối, ghép, nới lỏng | FR-13–15 | Nâng cao | Chưa làm | |
| 12 | Realtime (polling 5 giây) | FR-16 | Nâng cao | Chưa làm | |
| 13 | Quên mật khẩu, tin tức RSS, email, xuất Excel | | Tùy chọn | Chưa làm | Làm sau cùng |

## Module 4: Đặt sân, giữ chỗ, chống đặt trùng (FR-06, FR-12)

Nguồn: [business-flow.md mục 3 (bước 4-6, 10), 6.1, 6.2, quy tắc 1-4](../01-plan/business-flow.md).  
Trạng thái chung: **Chưa làm**

| # | Việc | Trạng thái |
|---|---|---|
| 4.1 | Chọn một hoặc nhiều khung giờ liền kề, cùng sân, cùng ngày | Chưa làm |
| 4.2 | Khóa giờ đã qua và giờ bắt đầu cách hiện tại dưới 15 phút | Chưa làm |
| 4.3 | Màn hình xác nhận: tổng giá, chọn cọc 50% hoặc toàn bộ, bật/tắt tìm đối | Chưa làm |
| 4.4 | Tạo đơn `PENDING` và khóa nguyên tử tất cả khung giờ (`lock_expires_at` = +10 phút) | Chưa làm |
| 4.5 | Chống đặt trùng bằng transaction và ràng buộc duy nhất | Chưa làm |
| 4.6 | Mỗi user tối đa một đơn `PENDING`; cho tiếp tục hoặc hủy đơn cũ | Chưa làm |
| 4.7 | Lịch trống coi lock quá hạn là trống; hiển thị "Đang được giữ chỗ" cho người khác | Chưa làm |
| 4.8 | Tác vụ nền mỗi phút: `PENDING` hết hạn thành `EXPIRED`, trả khung `AVAILABLE`, gửi thông báo. Ghi chú: gửi thông báo cần bảng `notifications` (module 8); làm trước thì tạo bảng đó trước | Chưa làm |
| 4.9 | Quay lại tiếp tục đơn `PENDING` còn hạn, không gia hạn lock | Chưa làm |
| 4.10 | Test: đặt hợp lệ, đặt trùng bị từ chối, giờ đã qua, thiếu dữ liệu, lock hết hạn thì lịch trống | Chưa làm |