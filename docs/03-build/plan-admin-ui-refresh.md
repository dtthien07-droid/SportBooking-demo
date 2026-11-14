# Kế hoạch chỉnh giao diện trang Quản trị

## Phạm vi

- Dùng duy nhất `docs/02-design/mockups/danh-sach-dat-san-admin.html` làm nguồn giao diện.
- Chỉ chỉnh `frontend/quan-tri.html`, `frontend/admin/admin.css`, phần dựng DOM trong `frontend/admin/admin-page.js` và test liên quan.
- Không đổi backend, API, `admin-state.js`, `admin-api.js`, điều hướng vai trò, hay các trang frontend khác.
- Giữ popup hủy do sự cố hiện tại làm ngoại lệ đã được người dùng chấp thuận vì mockup không có popup; giữ nguyên markup hiện tại và toàn bộ hành vi.
- Sau khi hoàn tất, cập nhật `docs/04-product/roadmap.md` và `docs/04-product/changelog.md` theo yêu cầu.

## Các bước

1. Chuyển phần khung giao diện trong mockup sang `quan-tri.html`, giữ cấu trúc và class của mockup; thay header bằng header dùng chung; thay dữ liệu tĩnh bằng vùng dữ liệu/template; bỏ script và dữ liệu mẫu tĩnh.
2. Sửa nội dung mẫu mâu thuẫn với `business-flow.md` và loại biểu tượng dạng chữ, dùng SVG từ `frontend/shared/icons.js` hoặc SVG nội tuyến đơn giản.
3. Chuyển style riêng mockup vào `admin.css` chỉ khi cần để giữ nguyên giao diện; giới hạn thay đổi style vào trang Quản trị.
4. Chỉnh phần render trong `admin-page.js` để clone template hàng, điền bằng `textContent`/`setAttribute`, hỗ trợ sáu trạng thái và giữ nguyên tìm kiếm, tab/đếm, phân trang, phân quyền, banner và xử lý popup.
5. Thêm test Node.js cho class mockup, không có script/localStorage mẫu, render an toàn, icon và sáu trạng thái.
6. Chạy `node --check`, từng test trong `frontend/tests`, và `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`; xem trình duyệt nếu có công cụ. Nếu chưa kiểm tra trình duyệt, ghi “Chờ người dùng xác nhận”.
7. Cập nhật roadmap/changelog, đối chiếu `git status` với trạng thái ban đầu để bảo đảm không phát sinh thay đổi ngoài phạm vi.

## Chờ duyệt

Chưa sửa code. Chỉ bắt đầu sau khi người dùng duyệt kế hoạch này.
