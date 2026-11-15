# Kế hoạch: Xuất báo cáo Excel cho các trang quản trị còn lại

## Mục tiêu và phạm vi

1. Xóa riêng dòng chân thẻ “Xu hướng đặt sân & Tỷ lệ lấp đầy” đang hiển thị doanh thu và “Theo dữ liệu API”; giữ số lớn, biểu đồ, trạng thái trống và dàn khoảng đáy gọn hơn.
2. Thêm các báo cáo Excel cho Tổng quan, Người dùng, Cơ sở & Sân, Khung giờ & Giá; chuyển xuất Đơn đặt sân hiện có sang dùng chung một module backend và một module frontend, không đổi hành vi hiện tại.
3. Chỉ sửa code, test, tài liệu roadmap/changelog có liên quan trực tiếp. Không đổi bố cục/màu/chữ khác, polling 5 giây, phân quyền, schema, dependencies hoặc các tên hàm/tham số đang được test; không commit.

## Nguồn và hiện trạng đã kiểm tra

- Đã đọc `docs/01-plan/business-flow.md`, `docs/02-design/spec.md` cùng README của các thư mục backend, frontend và docs. Dashboard phải thể hiện doanh thu thuần; dashboard lọc hôm nay/7 ngày/30 ngày; mọi quyền vẫn được kiểm tra ở API.
- Hiện có luồng xuất Đơn đặt sân, escape công thức, audit trong transaction, giới hạn 5.000 dòng, tên file theo giờ Việt Nam và tải file bằng fetch/blob. Luồng này sẽ được chuyển sang helper chung nhưng vẫn giữ nguyên kết quả và tên hàm public đang được test.
- Bộ lọc hiện có: user `q/status`; cơ sở `q/district/is_active`; khung giờ nhận `from/to`, trang có sẵn cách xác định ngày, tuần bắt đầu thứ Hai và tháng lịch.
- Đã kiểm tra metadata chỉ đọc trên `sportbooking_dev`: các bảng/cột hiện cần dùng đã tồn tại trong `users`, `facilities`, `courts`, `time_slots`, `bookings`, `booking_slots`, `payments` và `admin_audit_logs`. Không có thao tác ghi lên database này; không cần migration.
- Worktree đang có nhiều thay đổi chưa commit, gồm cả backend/frontend quản trị và export Đơn đặt sân. Giữ nguyên, không restore/stash; khi triển khai chỉ tích hợp phần thuộc phạm vi bên dưới.

## Triển khai dự kiến

### Backend

- Mở rộng module xuất hiện có thành module dùng chung cho workbook, worksheet/tiêu đề, escape ô văn bản, định dạng ngày/giờ/tiền, tên file và giới hạn dòng; giữ tương thích với xuất Đơn đặt sân.
- Mở rộng truy vấn/repository và service quản trị để tái sử dụng kết quả `getDashboard` khi lập báo cáo Tổng quan; áp dụng đúng bộ lọc hiện có cho Users và Facilities; xây dữ liệu theo sân và khoảng ngày cho Time Slots.
- Thêm bốn route export cố định, đăng ký trước route có `:id`, cùng middleware `requireAuth`/`requireAdmin`; dùng tham số SQL `?`, trả XLSX với `Content-Disposition` có filename trong dấu ngoặc kép.
- Mỗi báo cáo có các sheet/cột tiếng Việt, hàng đầu in đậm và cố định, độ rộng phù hợp; dữ liệu ngày `DD/MM/YYYY`, giờ theo `Asia/Ho_Chi_Minh`, tiền dạng số có đơn vị `đ`, nhãn trạng thái dùng nhãn chung. Giới hạn 5.000 dòng mỗi sheet; khung giờ tối đa 31 ngày; lỗi validation trả 400 tiếng Việt.
- Ghi một audit `EXPORT_DASHBOARD`, `EXPORT_USERS`, `EXPORT_FACILITIES` hoặc `EXPORT_TIME_SLOTS` trong transaction/cơ chế tương đương luồng export hiện hành. Chỉ lưu bộ lọc và số dòng, không lưu dữ liệu cá nhân.
- Không chọn cột mật khẩu/hash/token/phiên trong dữ liệu xuất; kiểm tra nội dung workbook bằng ExcelJS.

### Frontend

- Tạo `frontend/admin/export-download.js` làm helper chung cho đọc filename từ `Content-Disposition`, tải blob, trạng thái nút và thông báo lỗi. Mã 401 hướng tới đăng nhập; lỗi 400 quá nhiều dòng và lỗi mạng hiển thị tiếng Việt cụ thể trong vùng `role="status"`/`role="alert"`.
- Chuyển nút xuất Đơn đặt sân sang helper chung, không thay đổi bộ lọc, tên file hoặc hành vi tải; bật nút ở Dashboard/Cơ sở và thêm nút ở Người dùng/Khung giờ & Giá tại nhóm nút hiện có.
- Với Khung giờ & Giá, truyền đúng court đang chọn và khoảng ngày của chế độ ngày/tuần/tháng hiện hành.
- Xóa footer yêu cầu khỏi biểu đồ Tổng quan và cập nhật các test liên quan; không thay đổi trạng thái trống hay nội dung ngoài mục tiêu.
- Cập nhật test frontend để xác nhận không còn “Sắp có” trên các nút export liên quan, không còn “Theo dữ liệu API” ở biểu đồ, không dùng `innerHTML` với dữ liệu API và kiểm thử helper thuần.

## Kiểm thử và nghiệm thu

- Thêm/điều chỉnh kiểm thử HTTP thật trên `sportbooking_test`: 401/403/200, MIME và filename, lọc dữ liệu, đối chiếu dashboard, escape công thức, quá giới hạn, audit, rà toàn bộ ô không có bí mật; giữ test export booking cũ.
- Chạy test frontend liên quan riêng lẻ; `node --check` cho JavaScript đã sửa; sau đó chạy `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test` hai lần liên tiếp.
- Trước khi kết luận, kiểm tra lại chỉ đọc metadata tất cả bảng/cột thực sự được dùng trên `sportbooking_dev`; không ghi dữ liệu thật vào dev.
- Cập nhật `docs/04-product/roadmap.md` và `docs/04-product/changelog.md` khi hoàn tất tính năng. Phần chưa xem trực tiếp trên trình duyệt sẽ được báo “Chờ người dùng xác nhận”.

## Chờ duyệt

Chưa sửa code. Chỉ bắt đầu triển khai sau khi chủ dự án duyệt kế hoạch này.
