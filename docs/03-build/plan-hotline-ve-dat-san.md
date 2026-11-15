# Kế hoạch: đồng bộ hotline hỗ trợ và trạng thái vé

## Hiện trạng đã xác minh

- Vé được tạo khi thanh toán thành công trong `backend/src/bookings/bookings.service.js` và lưu vào bảng `booking_tickets` với trường `qr_code`; bảng không có trường trạng thái vé riêng.
- Booking `59` có ticket trong DB, nhưng booking là `CANCELLED`, payment là `REFUNDED` và `refunded_amount` là `50000`. Vé vì vậy tồn tại nhưng phải được trình bày là vô hiệu.
- `GET /api/v1/bookings/{id}` hiện trả về booking/payment/slots nhưng không trả ticket. Trang chi tiết mặc định hiện “Chưa phát hành” cho booking không còn `CONFIRMED`; lịch sử quyết định nút vé chủ yếu theo booking status.
- Hotline hỗ trợ hiện được ghi trực tiếp ở nhiều footer/trang; `frontend/shared/footer.js` đã có cơ chế footer dùng chung nhưng mới được dùng ở trang vé điện tử.
- Dữ liệu `facilities.hotline` là hotline riêng của cơ sở và phải tiếp tục lấy từ API sân, không dùng hotline hỗ trợ của nền tảng.

## Phạm vi dự kiến

1. Tạo một hằng số frontend duy nhất cho hotline hỗ trợ (`1900 8899`) và dùng trong footer chung cùng các khối hỗ trợ/đoạn legal đang hiển thị hotline. Footer người dùng được thay bằng mount dùng chung trên trang chủ, tìm sân, lịch sử, chi tiết đơn, trang vé điện tử và các trang đăng nhập/đăng ký có footer (cả đường dẫn gốc và `auth/`). Hotline sân và số điện thoại người dùng giữ nguyên dữ liệu riêng.
2. Trả ticket từ API chi tiết đơn và API danh sách lịch sử (ticket có thể vắng mặt); không thêm trạng thái vào bảng DB. Thêm một hàm trình bày trạng thái vé dùng chung ở frontend: thiếu ticket → chưa phát hành; booking còn hiệu lực và payment hợp lệ → đã phát hành; booking hủy/hết hạn hoặc payment hoàn tiền → vé vô hiệu kèm lý do.
3. Dùng cùng hàm trạng thái trong lịch sử và chi tiết. Ở chi tiết, hiển thị mã ticket/QR khi ticket hợp lệ; ticket đã vô hiệu chỉ hiển thị trạng thái và lý do, không đưa QR hoạt động ra như vé hợp lệ. Không thay đổi nút PDF “Sắp có”.
4. Thêm kiểm thử tập trung cho ticket vắng mặt, ticket hợp lệ, booking hủy/hoàn tiền, và hiển thị hotline/footer dùng chung. Chạy các test frontend/backend phù hợp.
5. Sau khi hoàn tất và được duyệt, cập nhật `docs/04-product/roadmap.md` và `changelog.md` theo quy định dự án.

## Tệp dự kiến

- Tạo `frontend/shared/support-constants.js`.
- Sửa `frontend/shared/footer.js` và các HTML trang người dùng/đăng nhập/đăng ký để dùng footer chung; các nội dung hotline hỗ trợ ngoài footer dùng cùng hằng số.
- Sửa `backend/src/bookings/bookings.repository.js`, `backend/src/bookings/bookings.service.js` để trả ticket ở API chi tiết và danh sách lịch sử.
- Sửa `frontend/booking/booking-history-state.js`, `booking-history-page.js`, `booking-detail-page.js` và markup liên quan ở `chi-tiet-don-dat-san.html`.
- Thêm/cập nhật test frontend/backend liên quan; cập nhật roadmap/changelog sau khi thực hiện.

## Tiêu chí nghiệm thu

- Các trang chủ, tìm sân, lịch sử, chi tiết đơn, đăng nhập và đăng ký (nếu có footer) đều hiển thị hotline `1900 8899`, với liên kết gọi `tel:19008899`; footer được dựng từ một component dùng chung.
- Hotline sân vẫn hiển thị số lấy từ dữ liệu cơ sở.
- Booking #59 hiển thị `VÉ ĐÃ VÔ HIỆU` cùng lý do đã hủy/hoàn tiền; không báo “CHƯA PHÁT HÀNH”.
- Vé hợp lệ hiển thị `ĐÃ PHÁT HÀNH`, mã vé và QR; booking thực sự không có vé mới hiển thị `CHƯA PHÁT HÀNH`.
- Lịch sử và chi tiết dùng cùng quy tắc xác định trạng thái vé; không thêm hành vi tải PDF.
