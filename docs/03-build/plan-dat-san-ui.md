# Kế hoạch UI xác nhận đặt sân

## Phạm vi và căn cứ

Kế hoạch này đối chiếu `frontend/dat-san.html` hiện tại với hàng **Xác nhận đặt sân** trong spec mục 2.1, roadmap module 4 mục 4.3, và business-flow mục 3 bước 5. Trong `docs/02-design/mockups/` không tìm thấy `old-dat-san.html` hoặc `dat-san-cu.png`; mockup xác nhận đặt sân hiện có là `xac-nhan-dat-san.html`, được dùng làm căn cứ giao diện cũ. Không sửa các tài liệu nguồn.

Trang hiện tại thuộc luồng giữ chỗ module 4: trước khi tạo đơn chỉ hiển thị tóm tắt sân/khung giờ/tổng giá; nhấn **Xác nhận đặt sân** mới gọi API tạo booking `PENDING` và khóa slot 10 phút. Vì vậy, việc bổ sung lựa chọn cọc và tìm đối phải giữ nguyên thời điểm tạo hold và đồng hồ server.

## Quyết định đã duyệt

1. `payments.payment_option` lưu lựa chọn `DEPOSIT_50`/`FULL`. Khi tạo booking `PENDING`, backend tạo payment trạng thái `PENDING` trong cùng transaction. `bookings.match_preference JSON NULL` lưu cấu hình chờ (mode, gender, skill, format, message); không tạo `match_requests` trong công việc hiện tại. Module tìm đối tạo `match_requests` khi booking `CONFIRMED`.
2. Tiền cọc bằng làm tròn lên số nguyên VND của tổng tiền chia 2; tiền còn thu tại sân bằng tổng trừ cọc. Backend tính và trả các số tiền này, frontend chỉ hiển thị.
3. Nếu có `match_preference`, backend xác minh khung đầu cách thời điểm hiện tại tối thiểu 30 phút. `format` chỉ nhận `SINGLES`/`DOUBLES` với `BADMINTON` hoặc `PICKLEBALL`. Vi phạm bị từ chối bằng mã lỗi và thông điệp nêu rõ điều kiện.
4. Khi tên cơ sở và sân trùng sau chuẩn hóa khoảng trắng/không phân biệt hoa thường, chỉ hiển thị một tên làm tiêu đề và dòng phụ **Sân mặc định**.
5. Trang dùng header đầy đủ dùng chung của app; bỏ header rút gọn riêng.
6. Migration, API và test backend được thực hiện trước UI. Test chạy trên `sportbooking_test`; không kết nối hoặc sửa `sportbooking_system`.

## 1. Bảng khác biệt hiện tại và mục tiêu

| Hạng mục | Giao diện cũ (`xac-nhan-dat-san.html`) | Hiện tại (`frontend/dat-san.html`) | Mục tiêu theo spec/luồng nghiệp vụ |
|---|---|---|---|
| Header | Header đầy đủ: logo, Trang chủ, Tìm sân, Lịch sử đặt sân, Tin tức, thông báo và vùng tài khoản. | Header riêng chỉ có logo và liên kết Tìm sân. | Dùng header đầy đủ dùng chung của app, đúng trạng thái đăng nhập và điều hướng. Tái sử dụng pattern/component chung hiện có, không duy trì header rút gọn riêng. |
| Bố cục | Trang đặt sân có điều hướng quay lại, stepper và các khu vực thông tin/xác nhận; nhiều nội dung thanh toán và ghép đối sau đó nằm cùng mockup nhiều bước. | Một card đơn với thông tin, danh sách slot, tổng tiền và thao tác. | Tổ chức rõ tóm tắt sân/khung giờ, thông tin người đặt, lựa chọn thanh toán và tùy chọn tìm đối; ưu tiên dễ đọc trên mobile. Chỉ đưa vào trang xác nhận các trường lựa chọn theo mục 2.1/4.3. |
| Thông tin sân/khung giờ | Tóm tắt địa điểm, sân, ngày và các slot. | Có Cơ sở, Sân, ngày, slot và tổng tiền. | Giữ thông tin đã có; sửa trường hợp tên cơ sở và tên sân giống nhau để không tạo cảm giác dữ liệu bị lặp (chi tiết mục 3). |
| Cọc 50% / toàn bộ | Có hai lựa chọn, hiển thị số tiền trả và phần còn thu ở sân khi chọn cọc. | Chưa có lựa chọn thanh toán; chỉ có tổng tiền. | Có radio mặc định cọc 50% và toàn bộ; backend tính cọc bằng `CEILING(tổng tiền / 2)` VND và tiền còn tại sân bằng tổng trừ cọc; với toàn bộ, số còn tại sân là 0. UI chỉ hiển thị số backend trả về. |
| Tìm đối | Mockup có giao diện tìm đối, loại ghép và các tiêu chí. | Chưa có công tắc hoặc trường tìm đối. | Có công tắc bật/tắt. Khi bật: chọn ngẫu nhiên/theo tiêu chí; kiểu theo tiêu chí mới hiện giới tính và trình độ. Thể thức đơn/đôi chỉ hiện cho cầu lông hoặc pickleball. Có trường lời nhắn. Khi tắt, ẩn/không gửi các tiêu chí. Yêu cầu tìm đối chỉ được tạo sau khi booking `CONFIRMED` và đã thanh toán (cọc hoặc toàn bộ), theo business-flow; không tạo `match_requests` lúc giữ chỗ. |
| Đồng hồ giữ chỗ | Mockup có nhãn giữ chỗ `10:00`. | Có panel đồng hồ `10:00`, chỉ hiện sau khi hold được tạo. | Giữ countdown lấy từ deadline/remaining seconds của server, bắt đầu sau khi xác nhận tạo hold thành công; không chạy từ lúc mở trang, không gia hạn khi tải lại. |
| Xác nhận / hủy | Có các hành động tiếp tục/xác nhận trong quy trình nhiều bước. | Nút Xác nhận đặt sân; Hủy giữ chỗ chỉ hiện khi đã có booking. | Giữ hai trạng thái hành động: trước hold có **Xác nhận đặt sân**; sau hold có **Hủy giữ chỗ**. Không để việc chọn cọc/tìm đối tự tạo hold. Khi hold hết hạn, khóa hành động theo trạng thái server. |

## 2. Lưu lựa chọn cọc và tìm đối

Quyết định đã duyệt: lưu lựa chọn cọc ở `payments.payment_option`, với payment `PENDING` được tạo cùng booking `PENDING` trong transaction. Lưu cấu hình tìm đối ở `bookings.match_preference JSON NULL`. Khi booking chuyển `CONFIRMED`, module tìm đối sẽ tạo `match_requests`; phần đó không thuộc phạm vi triển khai hiện tại. API nhận `slot_ids`, `payment_option` và `match_preference` tùy chọn. Backend là nguồn tính số tiền và xác thực thời gian/thể thức.

## 3. Lỗi tên “Cơ sở” và “Sân” bị trùng

Trang hiện luôn render cả hai dòng. Khi `facility.name` và `court.name` giống nhau sau chuẩn hóa khoảng trắng/không phân biệt hoa thường, UI sẽ hiện một tên làm tiêu đề và dòng phụ **Sân mặc định**. Không đổi tên facility/court trong database.

## 4. File UI dự kiến sửa sau khi backend được kiểm tra

| File | Thay đổi dự kiến |
|---|---|
| `frontend/dat-san.html` | Thay header rút gọn bằng header đầy đủ dùng chung; thêm cấu trúc lựa chọn thanh toán, phần số tiền cọc/còn thu tại sân và khu vực tìm đối có điều kiện. |
| `frontend/booking/booking.css` | Bổ sung kiểu responsive cho bố cục, radio cọc, công tắc tìm đối, trường tiêu chí/lời nhắn và trạng thái focus/disabled. |
| `frontend/booking/booking-page.js` | Render lựa chọn tiền; ẩn/hiện tiêu chí dựa trên trạng thái công tắc, search mode và sport type; xử lý trường hợp tên Cơ sở/Sân trùng; giữ nguyên luồng đồng hồ server và hành động hold. |
| `frontend/booking/bookings-api.js` | Mở rộng adapter tạo/đọc booking để truyền và khôi phục các lựa chọn theo hợp đồng backend đã cập nhật. |
| `frontend/shared/app.js` và `frontend/shared/app.css` | Chỉ sửa nếu header dùng chung cần hỗ trợ trang đặt sân; ưu tiên dùng lại cơ chế hiện hữu, tránh đổi giao diện các trang khác. |

### Backend đã triển khai trước UI theo quyết định duyệt

| File | Thay đổi |
|---|---|
| `docs/02-design/spec.md` | Cập nhật schema `bookings`/`payments`, hợp đồng POST/GET, công thức cọc và quy tắc kiểm tra preference. |
| `infra/database/migrations/004-add-booking-match-preference-and-payments.sql` | Thêm `bookings.match_preference` và bảng `payments`. |
| `infra/database/migrate-bookings.js` | Áp dụng/xác minh migration 004 sau migration 003, từ chối schema áp dụng dở dang. |
| `backend/src/bookings/bookings.service.js` | Xác thực payload, giới hạn thời điểm/thể thức, tính tiền bằng số nguyên và trả payment/preference. |
| `backend/src/bookings/bookings.repository.js` | Ghi payment cùng transaction booking; đọc payment và preference ở GET. |
| `backend/tests/bookings.integration.test.js` | Bao phủ cọc lẻ, payment cùng booking, lỗi thời gian/thể thức và rollback khi ghi payment thất bại. |

`004-add-booking-match-preference-and-payments.sql` đã áp dụng trên `sportbooking_test`; migration chạy lại báo đã áp dụng và xác minh thành công. Bộ test backend đạt 23/23. Chưa kết nối hoặc sửa `sportbooking_system`, chưa sửa UI. Sau khi bạn kiểm tra backend, bước tiếp theo mới là chỉnh các file UI ở bảng trên.

## Thứ tự triển khai sau khi duyệt

1. Kiểm tra và duyệt thay đổi backend/schema đã thực hiện ở trên.
2. Cập nhật UI trong các file ở mục 4, giữ nguyên quy tắc chỉ tạo hold sau thao tác xác nhận và countdown bắt đầu từ server.
3. Kiểm tra giao diện với mockup hiện có, sport type cầu lông/pickleball/bóng đá mini, tên sân trùng, responsive, và các trạng thái booking/lock. Test phần UI sẽ được viết và chạy trong giai đoạn đó.
