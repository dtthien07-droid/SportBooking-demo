# Kế hoạch — Giao diện đăng nhập và đăng ký

> Phạm vi giao diện và điều hướng cho hai trang auth. Nguồn nghiệp vụ là [business-flow.md](../01-plan/business-flow.md); thiết kế và URL cập nhật theo [spec.md](../02-design/spec.md). Mockup chỉ đọc.

## 1. Phạm vi thực hiện

1. Tạo `frontend/dang-nhap.html` và `frontend/dang-ky.html` bằng cách giữ nguyên cấu trúc HTML, class, nội dung, và cấu hình Tailwind CDN từ mockup tương ứng. Chỉ đổi phần đăng nhập sang nhãn `Email`, `type="email"` và placeholder `email@vidu.com`; thêm các thuộc tính cần thiết để nối form.
2. Loại bỏ script, handler inline và luồng lưu phiên/chuyển trang/API cũ trong markup mới. Dùng `/shared/app.js`, `data-form`, `data-submit`, các trường `name`, thông báo và vùng lỗi theo mẫu auth hiện có; gọi `POST /api/v1/auth/login` và `POST /api/v1/auth/register`.
3. Dùng đúng các URL gốc `/dang-nhap.html`, `/dang-ky.html`, `/trangchu-user.html`, `/dieu-khoan-su-dung.html`, `/chinh-sach-bao-mat.html`; trang đích chưa tồn tại thì để `href="#"`. Chỉnh điều hướng thành công của form dùng cùng URL mới.
4. Trong trang đăng ký, đặt Điều khoản sử dụng và Chính sách bảo mật từ `terms-and-privacy.md` vào bố cục cũ; chỉ bật ô đồng ý sau khi người dùng mở và cuộn đến cuối cả hai văn bản, theo business-flow.
5. Lưu ảnh mockup vào `frontend/assets/images/` và dùng đường dẫn `/assets/images/...`. Kiểm tra ảnh hiện có trước để tránh ghi đè thay đổi chưa commit.
6. Chỉ đổi redirect `GET /` trong `backend/src/app.js` sang `/dang-nhap.html`; sửa mô tả và bảng URL liên quan trong `docs/02-design/spec.md`.
7. Cập nhật mục roadmap/changelog liên quan sau khi kiểm tra và giữ nguyên các thay đổi đang có trong hai tài liệu này.

## 2. File dự kiến

| Thao tác | File | Mục đích |
|---|---|---|
| Tạo | `frontend/dang-nhap.html` | Trang đăng nhập theo mockup, nối API mới. |
| Tạo | `frontend/dang-ky.html` | Trang đăng ký theo mockup, nối API và bổ sung nội dung pháp lý. |
| Sửa | `frontend/shared/app.js` | Chặn gửi form đến khi đọc đủ hai văn bản; dùng URL mới cho các điều hướng auth. |
| Sửa | `backend/src/app.js` | Chỉ đổi URL redirect của `GET /`. |
| Sửa | `docs/02-design/spec.md` | Đồng bộ URL và redirect. |
| Sửa | `docs/04-product/roadmap.md`, `docs/04-product/changelog.md` | Ghi nhận hoàn tất phạm vi giao diện sau kiểm thử. |
| Tạo nếu ảnh hiện có không khớp nguồn | `frontend/assets/images/...` | Ảnh cục bộ được trang sử dụng thay cho URL ảnh ngoài. |

Không sửa `docs/02-design/mockups/`, backend API, database `sportbooking_system`, hoặc các trang frontend khác.

## 3. Kiểm thử và nghiệm thu

- Chạy `npm test` trong `backend/`; xác nhận cấu hình kiểm thử không kết nối `sportbooking_system`.
- Chạy ứng dụng tại `http://localhost:3000/`; xác nhận `/` chuyển tới `/dang-nhap.html`, hai trang mới hiển thị đúng, tài nguyên CSS/icon/font/ảnh tải được, link nội bộ dùng URL đã chốt, và form gửi đúng endpoint.
- Xác nhận email không nhận số điện thoại; đăng ký không thể gửi trước khi đọc hết cả hai văn bản; lỗi validation/API hiển thị tại vùng thông báo/trường tương ứng.
- Liệt kê trong báo cáo cuối các nội dung ở mockup lệch business-flow: Tennis, VIP/Gold/Diamond, mã giảm giá, 15.000+, 50+, 256-bit, Ghi nhớ đăng nhập, Quên mật khẩu, và “3 giây”.
