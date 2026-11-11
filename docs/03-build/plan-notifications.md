# Kế hoạch Module 8 — Thông báo trong app

1. Tạo migration 007 cho notifications và cập nhật runner theo pattern 003–006; chỉ chạy trên `sportbooking_test`.
2. Thêm repository/service/route API chỉ truy cập thông báo của user hiện tại, trả `no-store`.
3. Ghi thông báo trong transaction khi thanh toán xác nhận, hết hạn giữ chỗ và hủy đơn/giữ chỗ; bảo đảm rollback và idempotency.
4. Nối chuông header với unread-count và danh sách nhanh; polling 10 giây chỉ khi tab hiển thị.
5. Tạo trang `/thong-bao.html` theo bố cục mockup, có lọc, đánh dấu đọc, trạng thái tải/lỗi/rỗng và phân trang.
6. Thêm test HTTP trên database test và test Node cho trạng thái/định dạng frontend.
7. Chạy kiểm tra cú pháp, toàn bộ frontend tests và `npm test` hai lượt trên `sportbooking_test`.
8. Cập nhật roadmap/changelog; kiểm tra trình duyệt để người dùng xác nhận sau.
