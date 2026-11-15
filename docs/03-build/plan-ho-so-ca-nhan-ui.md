# Kế hoạch làm mới giao diện hồ sơ cá nhân

## Phạm vi

Chỉ cập nhật giao diện tại `frontend/profile/profile.html` và CSS/JS riêng của trang nếu thật sự cần. Giữ nguyên API, validation, thông báo, điều hướng, phân quyền, header chung, polling và hành vi form. Không sửa backend hoặc mockup.

## Ánh xạ mockup sang chức năng hiện tại

| Khối mockup | Ánh xạ dự kiến |
|---|---|
| Header, chuông thông báo, đăng xuất | Giữ header dùng chung hiện tại; không sao chép JavaScript mockup hoặc sửa `shared/header.js`. |
| Tiêu đề/trạng thái trang | Giữ nút quay lại, tiêu đề hồ sơ và vùng thông báo/loading/error hiện tại. |
| Thẻ hồ sơ tóm tắt | Chỉ hiển thị tên, SĐT, email và vai trò lấy từ hồ sơ API; kết xuất bằng `textContent`. |
| Menu tài khoản | Liên kết hồ sơ/lịch sử/thông báo dùng các trang hiện có; mục đổi mật khẩu dẫn tới form hiện hữu. |
| Thống kê nhanh, ngày tham gia, hạng/điểm, tỷ lệ có mặt, CLB, sở thích và tự động ghép | Ẩn vì API trang hồ sơ hiện không cung cấp dữ liệu/chức năng tương ứng; không dùng giá trị mẫu của mockup. |
| Thẻ thông tin tài khoản | Giữ form hiện có và toàn bộ `id`, `name`, `data-*`; email chỉ đọc, các trường được lưu giữ nguyên giá trị/API hiện tại. |
| Card thể thao và khu vực ưa thích | Chỉ giữ giới tính/trình độ được API hỗ trợ; ẩn môn thể thao, ngày sinh, địa bàn và các số liệu không có trong API. |
| Modal đổi mật khẩu | Không lấy modal/JS giả lập từ mockup; giữ form đổi mật khẩu hiện tại, API và validation hiện tại, bố trí thành card phù hợp giao diện mới. |
| Footer | Giữ nội dung footer hiện tại, không sao chép địa chỉ/hotline mẫu. |

## Tệp và kiểm tra

- Cập nhật `frontend/profile/profile.html`, thêm `frontend/profile/profile.css` và `frontend/profile/profile-view.js` chỉ để trình bày dữ liệu từ hồ sơ API qua `textContent`.
- Bổ sung kiểm tra fidelity và `frontend/tests/profile-page.test.js`; không thêm class ngoại lệ cho hồ sơ.
- Baseline fidelity trước khi đổi markup: **FAIL** (thiếu 23 lớp bắt buộc và khối sidebar). Sau thay đổi: fidelity **PASS**.
- Kiểm tra frontend: 34/34 file test riêng lẻ đạt với `APP_ENV=test`, `DB_NAME=sportbooking_test`; các file JS thay đổi qua `node --check`.
- Trình duyệt với API giả: desktop/mobile không tràn ngang, trạng thái loading/lỗi ẩn sau khi tải, icon SVG và focus bàn phím hiện. API thật: **Chờ người dùng xác nhận**.

**Trạng thái:** Đã duyệt và triển khai; không sửa backend hoặc mockup.
