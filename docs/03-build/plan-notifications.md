# Kế hoạch Module 8 — Thông báo trong app

1. Tạo migration 007 cho notifications và cập nhật runner theo pattern 003–006; chỉ chạy trên `sportbooking_test`.
2. Thêm repository/service/route API chỉ truy cập thông báo của user hiện tại, trả `no-store`.
3. Ghi thông báo trong transaction khi thanh toán xác nhận, hết hạn giữ chỗ và hủy đơn/giữ chỗ; bảo đảm rollback và idempotency.
4. Nối chuông header với unread-count và danh sách nhanh; polling 10 giây chỉ khi tab hiển thị.
5. Tạo trang `/thong-bao.html` theo bố cục mockup, có lọc, đánh dấu đọc, trạng thái tải/lỗi/rỗng và phân trang.
6. Thêm test HTTP trên database test và test Node cho trạng thái/định dạng frontend.
7. Chạy kiểm tra cú pháp, toàn bộ frontend tests và `npm test` hai lượt trên `sportbooking_test`.
8. Cập nhật roadmap/changelog; kiểm tra trình duyệt để người dùng xác nhận sau.

## Phân bổ thông báo
- Mọi ghi thông báo đi qua `backend/src/notifications/notification-events.js` trong transaction nghiệp vụ; không đổi schema hay thêm migration.
- Thanh toán thành công: PAYMENT trước, BOOKING_HOLD sau; cả hai gắn resource BOOKING.
- Hết hạn giữ chỗ: một BOOKING_HOLD, idempotent theo chuyển trạng thái.
- User hủy đơn CONFIRMED: BOOKING_HOLD; thêm PAYMENT chỉ khi số hoàn > 0. Hủy PENDING không báo.
- Hủy sự cố của Admin: helper chưa gắn API, tạo BOOKING_HOLD và PAYMENT hoàn 100%.
- MATCH/SYSTEM chưa có sự kiện; không tạo thông báo cho thất bại thanh toán hay tạo/hủy giữ chỗ.
- Tab lọc theo `category`; thứ tự mới nhất dùng `created_at DESC, id DESC`.
