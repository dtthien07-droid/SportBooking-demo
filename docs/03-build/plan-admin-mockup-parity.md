# Kế hoạch khớp giao diện Admin theo mockup

## Mục tiêu

Khôi phục phần main content của bốn trang Admin theo đúng DOM, thứ bậc HTML, class, lưới, thẻ, bảng, form và responsive layout của mockup tương ứng. Thay dữ liệu mẫu bằng dữ liệu API hiện có mà không đổi bố cục theo dữ liệu.

## Nguồn giao diện bắt buộc

- `docs/02-design/mockups/dashboard.html` → `frontend/quan-tri-tong-quan.html`
- `docs/02-design/mockups/quan-ly-nguoi-dung.html` → `frontend/quan-tri-nguoi-dung.html`
- `docs/02-design/mockups/Quan-ly-san.html` → `frontend/quan-tri-san.html`
- `docs/02-design/mockups/quan-ly-khung-gio-gia.html` → `frontend/quan-tri-khung-gio-gia.html`

Chỉ đọc và sao chép main content từ các mockup trên; không lấy header/sidebar từ mockup. Giữ `frontend/quan-tri.html` làm chuẩn shell và dùng chung `frontend/admin/admin-shell.js`.

## Phạm vi

- Thay main content trong bốn trang đích bằng main content đúng cấu trúc mockup, giữ nguyên các hook cần thiết để dữ liệu/API và thao tác nghiệp vụ hiện có tiếp tục hoạt động.
- Chỉ dùng API/frontend đã có. Không sửa backend, database, migration, API contract hoặc test backend.
- Chỉnh các file JS/CSS trong `frontend/admin/` khi cần để bind dữ liệu thật, tránh chèn “Sắp có” vào dữ liệu thật, giới hạn nội dung dài và giữ layout khi render/loading/rỗng/lỗi.
- Không sửa `quan-tri.html` hoặc `admin-shell.js` nếu shell dùng chung hiện tại đáp ứng được yêu cầu.
- Cập nhật test frontend liên quan và `docs/04-product/roadmap.md`, `docs/04-product/changelog.md` khi hoàn tất.

## Quy tắc dữ liệu và chức năng

- Giữ nguyên class thiết kế và cấu trúc mockup; không tạo layout thay thế hoặc đổi thứ tự/cột để khớp dữ liệu.
- Dữ liệu API phải được đặt trong đúng vị trí tương ứng của mockup; tên, email, cơ sở, sân, hotline, địa chỉ và nội dung dữ liệu thật không chứa badge “Sắp có”.
- Chỉ giữ nhãn “Sắp có”/vô hiệu hóa cho chức năng ngoài business-flow; thao tác thuộc nghiệp vụ hiện có tiếp tục hoạt động.
- Với chuỗi dài, giới hạn nội dung trong ô theo cách không thay đổi cấu trúc/cột của mockup (ellipsis/overflow/line-clamp phù hợp).
- Không hiển thị số liệu giả như dữ liệu thật; trạng thái thiếu dữ liệu, lỗi và loading phải rõ ràng mà không làm vỡ layout.

## Các bước thực hiện

1. Đối chiếu từng cặp nguồn/đích và xác định các data hooks cần bảo toàn trước khi chỉnh.
2. Thay lần lượt main content bốn trang bằng cấu trúc/class từ mockup tương ứng; giữ nguyên shell dùng chung theo `quan-tri.html`.
3. Chỉnh binding trong các script trang Admin để lấp dữ liệu thật vào đúng vị trí, loại badge khỏi dữ liệu, và giữ chức năng nghiệp vụ đang có.
4. Chỉ bổ sung CSS frontend giới hạn trong Admin khi cần để dữ liệu dài, bảng, nút hoặc trạng thái không làm vỡ layout mockup; không thay đổi design system hay cấu trúc mockup.
5. Cập nhật/viết test frontend tập trung cho các regression do thay đổi: shell chung, binding dữ liệu, không gắn nhãn “Sắp có” vào dữ liệu thật, và trạng thái/chuỗi dài không làm thay đổi markup bố cục.
6. Chạy test frontend liên quan và kiểm tra cú pháp các script đã đổi; mở từng trang bằng trình duyệt ở kích thước desktop/mobile và so sánh trực quan với mockup.
7. Ghi nhận từng cặp đối chiếu, các thành phần vô hiệu hóa và khác biệt chỉ do dữ liệu thật; cập nhật roadmap/changelog. Không kết thúc nếu còn lỗi layout nhìn thấy được.

## Kiểm tra dự kiến

- `node --test` cho các test frontend Admin liên quan (xác định selector chính xác sau khi xem manifest/test hiện có).
- `node --check` cho từng script Admin được thay đổi.
- Đối chiếu trình duyệt thủ công từng cặp mockup/đích, gồm kích thước màn hình rộng và hẹp; lưu screenshot nếu công cụ trình duyệt hỗ trợ.
- Xác nhận không phát sinh thay đổi trong `backend/`, `infra/`, API hoặc test backend.

## Chờ duyệt

Chưa sửa code. Bắt đầu triển khai sau khi người dùng duyệt kế hoạch.
