# Kế hoạch thêm thanh điều hướng trái cho trang Quản trị

## Mục tiêu

Thêm thanh điều hướng dọc bên trái theo ảnh người dùng gửi, không tạo đường dẫn giả cho các chức năng chưa được triển khai.

## Phạm vi đã chốt

- Hiển thị đủ sáu mục theo thứ tự trong ảnh: Tổng quan, Quản lý sân, Khung giờ & giá, Danh sách đặt sân, Quản lý người dùng, Cài đặt hệ thống.
- Tổng quan và Danh sách đặt sân là liên kết nội trang tới các khối hiện có.
- Quản lý sân, Khung giờ & giá, Quản lý người dùng và Cài đặt hệ thống không có trang/chức năng hiện tại; hiển thị vô hiệu hóa kèm nhãn “Sắp có”, không gắn `href`.
- Bố cục desktop dùng thanh dọc bên trái; trên màn hình hẹp, chuyển thành dải điều hướng ngang có thể cuộn để giữ nội dung sử dụng được.
- Không đổi backend, API, phân quyền/header dùng chung, trạng thái bộ lọc hay luồng hủy sự cố.

## File dự kiến

- `frontend/quan-tri.html`: thêm markup điều hướng, icon SVG và neo nội trang cho Tổng quan/Danh sách đặt sân.
- `frontend/admin/admin.css`: kiểu thanh bên, mục được chọn, trạng thái “Sắp có” và bố cục responsive.
- `frontend/admin/admin-page.js`: đồng bộ mục đang chọn khi người dùng điều hướng giữa các khối; không thêm lệnh gọi API.
- `frontend/tests/admin-module.test.js`: kiểm tra thứ tự mục, neo nội trang hoạt động, mục chưa triển khai không có đích giả và giữ bố cục responsive.
- `docs/04-product/roadmap.md`, `docs/04-product/changelog.md`: ghi nhận thay đổi sau khi hoàn tất.

## Kiểm tra

- Chạy `node --check frontend/admin/admin-page.js`.
- Chạy test liên quan trong `frontend/tests`.
- Nếu không xác minh giao diện bằng trình duyệt, ghi “Chờ người dùng xác nhận”.

## Trạng thái

Đã duyệt; triển khai xong. Test Quản trị đạt 19/19, `node --check frontend/admin/admin-page.js` đạt. Chưa xác minh hình ảnh trên trình duyệt do cần phiên ADMIN; ghi nhận: “Chờ người dùng xác nhận”.
