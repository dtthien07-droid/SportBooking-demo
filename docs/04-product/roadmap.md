# Roadmap — SportBooking
- Vé điện tử (FR-07): trang hoàn tất có QR cục bộ và trang vé điện tử dùng chung payload văn bản; icon SVG không phụ thuộc font Material Symbols; kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

Nguồn: [docs/01-plan/business-flow.md](../01-plan/business-flow.md). Cập nhật trạng thái sau mỗi tính năng xong.

Trạng thái: Chưa làm / Đang làm / Xong

| # | Module | Mã | Nhóm | Trạng thái | Ghi chú |
|---|---|---|---|---|---|
| 1 | Đăng ký, đăng nhập, phân quyền, hồ sơ | FR-01, FR-03 | Cốt lõi | Đang làm | Đã triển khai backend và bước 10: express.static cùng origin, trang đăng nhập/đăng ký/hồ sơ và JS/CSS dùng chung. Hoàn thành hai trang `/dang-nhap.html` và `/dang-ky.html` theo mockup cũ; đăng nhập chỉ dùng email, form nối API mới; ô đồng ý chỉ bật sau khi đọc hết hai văn bản pháp lý được nhúng trong đăng ký. Các trang pháp lý công khai riêng chưa có trong frontend: footer hiện render span disabled "Điều khoản sử dụng · Sắp có" / "Chính sách bảo mật · Sắp có" (`shared/footer.js:34,36`), không phải link `#`; văn bản pháp lý nhúng trong `dang-ky.html:401–459`. Bước 11 smoke test thủ công: Chờ người dùng xác nhận. Backend bắt buộc `termsAccepted = true` và ghi `terms_accepted_at`. |
| 2 | Seed 29 sân, khung giờ, API sân, trang chủ, tìm sân | FR-04, FR-05 | Cốt lõi | Xong | API khách cho danh sách/trang chủ/tìm sân/chi tiết chỉ công khai cơ sở đang mở có ít nhất một sân con hoạt động; dùng `Cache-Control: no-store`; cơ sở không đủ điều kiện trả 404 ở trang chi tiết. Job tự sinh khung giờ nền mỗi giờ theo `SLOT_DAYS_AHEAD` (mặc định 14, UTC+7), chỉ chèn khung thiếu, giữ nguyên LOCKED/BOOKED. Trang tìm sân hỗ trợ lọc ngày trong 14 ngày và khung giờ; lọc tiện ích còn hoãn tới khi có mã chuẩn và ánh xạ dữ liệu cũ. |
| 3 | Admin quản lý cơ sở, sân, khung giờ, giá | FR-04 | Cốt lõi | Đang làm | KPI đếm tổng/mở/khóa cơ sở toàn hệ thống; tỷ lệ lấp đầy giữ nguyên; polling 5 giây. Cơ sở không có sân con vẫn hiện trong admin với nhãn “Chưa có sân”. Xóa chỉ khi không có đơn ở mọi trạng thái, dùng expected timestamp và audit cùng transaction; thứ tự xóa booking_slots → time_slots → courts → facilities. Khóa/mở cơ sở giữ nguyên hành vi hiện có. HTTP/frontend tests và `npm test` trên `sportbooking_test` đạt; kiểm tra trình duyệt: **Chờ người dùng xác nhận**. |
| 4 | Đặt sân, giữ chỗ 10 phút, chống đặt trùng | FR-06, FR-12 | Cốt lõi | Đang làm | Booking flow backend and integration coverage are implemented. Pending booking conflicts include `pending_booking_id` and `remaining_seconds`; expired PENDING holds are expired and released inside the create transaction; authenticated `GET /bookings/pending` returns only the caller's active hold. The shared header shows the active hold, countdown, continue-payment and cancel actions on every authenticated page using the shared header, except the documented hidden pages; create/cancel/successful payment refresh it immediately. `npm test` on `sportbooking_test`: 34/34.|
| 5 | Thanh toán giả lập, vé QR | FR-07 | Cốt lõi | Đang làm | Trang thanh toán lấy Bước 2 từ mockup, hiển thị dữ liệu API; nút xác nhận gửi SUCCESS, FAILURE chỉ hiện với `?demo=1`. QR chuyển khoản được vẽ cục bộ từ `SPORTBOOKING|<booking_code>|<amount_due>`, không phải VietQR; QR vé vẫn encode mã booking. Thanh bước dùng chung trên `dat-san.html`, `thanh-toan.html` và `dat-san-thanh-cong.html`. Frontend tests 26/26, `npm test` trên `sportbooking_test` 34/34; smoke test trình duyệt: Chờ người dùng xác nhận. Thông báo thuộc module 8; hủy/hoàn tiền thuộc module 6. |
| 6 | Hủy và hoàn tiền | FR-08 | Cốt lõi | Xong | Hủy PENDING/CONFIRMED trong transaction; hoàn 100%/50%/0% trên `paid_amount`, preview chỉ chủ đơn, giải phóng slot và xóa `match_preference`; job chuyển đơn đủ giờ sang COMPLETED mỗi phút. Preview có `seconds_until_start` và `server_time`; popup có đếm ngược/mức hoàn và khóa hủy khi đã bắt đầu. Migration 006 đã áp dụng/xác minh trên `sportbooking_test`; backend `npm test` 52/52 hai lượt; kiểm tra trình duyệt: **Chờ người dùng xác nhận**. |
| 7 | Lịch sử đặt sân | FR-09 | Cốt lõi | Xong | Lịch sử/chi tiết, điều hướng quay lại an toàn, API tóm tắt theo user, tìm kiếm mã/cơ sở và lọc môn; thẻ khóa ảnh, giới hạn địa chỉ, nút Hủy nhanh theo trạng thái server, icon SVG và nhóm nút tự xuống dòng. Sau hủy, lấy lại chi tiết từ server, dựng lại riêng thẻ bằng renderer chung, cập nhật summary; thông báo nằm ngoài thẻ và tự ẩn. GET lịch phía frontend bỏ qua cache; HTTP create→SUCCESS→cancel→GET lịch trống→đặt lại đạt; backend `npm test` 93/93, frontend 232/232. Kiểm thử thủ công trên trình duyệt ngày 15/11/2026 (người dùng xác nhận): đăng nhập và các chức năng chính hoạt động; không còn lỗi tải dữ liệu, chuyển hướng bất thường hoặc lỗi JavaScript ảnh hưởng nghiệp vụ. |
| 8 | Thông báo trong app | FR-17 | Cốt lõi | Xong | API riêng theo user; các sự kiện thanh toán, hết hạn và hủy đơn được phân bổ đúng BOOKING_HOLD/PAYMENT trong transaction, không đổi schema. PAYMENT được ghi trước BOOKING_HOLD; API sắp `created_at DESC, id DESC`; tab lọc đúng category. Trang và popup chuông dùng chung kiểu SVG/màu theo loại, thẻ 3 vùng, nhãn/trạng thái chưa đọc, nút hành động và khử tên sân/cơ sở trùng; đọc một tin cập nhật số đếm tại chỗ. Backend `npm test` 93/93, frontend 232/232. Kiểm thử thủ công trên trình duyệt ngày 15/11/2026 (người dùng xác nhận): đăng nhập và các chức năng chính hoạt động; không còn lỗi tải dữ liệu, chuyển hướng bất thường hoặc lỗi JavaScript ảnh hưởng nghiệp vụ. |
| 9 | Đánh giá sân | FR-18 | Nâng cao | Chưa làm | |
| 10 | Admin: dashboard, quản lý user, booking ngoại lệ | FR-10, FR-11, FR-19 | Cốt lõi | Xong | Sửa ghi admin, thông báo cho khách và đồng bộ giờ/giá đã qua HTTP tests tập trung trên `sportbooking_test`; không migration/đổi schema. `node --check`: 127 file đạt. Bổ sung xuất Excel dùng module chung cho Dashboard, Người dùng, Cơ sở & Sân, Khung giờ & Giá; Đơn đặt sân giữ xuất hiện tại qua module chung. Backend `npm test`: 93/93; frontend: 232/232. Schema `sportbooking_dev` đã đối chiếu chỉ đọc, đủ bảng/cột; không migration/đổi schema. Kiểm thử thủ công trên trình duyệt ngày 15/11/2026 (người dùng xác nhận): đăng nhập, phân quyền và các chức năng chính hoạt động; không còn lỗi JavaScript ảnh hưởng nghiệp vụ. |
| 11 | Tìm đối, ghép, nới lỏng | FR-13–15 | Nâng cao | Chưa làm | |
| 12 | Realtime (polling 5 giây) | FR-16 | Nâng cao | Đang làm | Có poll dữ liệu 5s: header khách — chuông + banner giữ chỗ (`shared/header.js:296`, dừng khi tab ẩn); lưới khung giờ (`chi-tiet-san.js:760–764`); lịch sử (`booking/booking-history-page.js:669`); chi tiết đơn (`booking/booking-detail-page.js:399`); trang đặt (`booking/booking-page.js:801–803`); 5 trang admin qua `admin/admin-shell.js:114` (mặc định 5000ms, lùi 10/20/30s khi lỗi) với ETag/304. Không poll dữ liệu (chủ đích — trang tĩnh hoặc chỉ đếm ngược): trang chủ, tìm sân, danh sách thông báo (chuông vẫn poll qua header), vé điện tử, hoàn tất, hồ sơ, thanh toán (chỉ đếm ngược 250ms). Kiểm tra trình duyệt: **Chờ người dùng xác nhận**. Trạng thái ghép đối chưa làm, chờ Module 11. |
| 13 | Hotline và trạng thái vé điện tử | FR-07, FR-09 | Cốt lõi | Xong | Đồng bộ hotline nền tảng qua `SportBookingConstants` + `shared/footer.js`; đối chiếu trạng thái vé với dữ liệu thật `booking_tickets` và `payment_status`, còn hiển thị `VÉ ĐÃ VÔ HIỆU` khi đơn đã hủy/hoàn tiền, đồng bộ giữa lịch sử và chi tiết. Footer gán hotline sau khi mount; vé thiếu mã QR và lỗi dựng đơn được xử lý riêng, không làm sập danh sách. |
| 14 | Quên mật khẩu, tin tức RSS, email | | Tùy chọn | Chưa làm | Làm sau cùng |

Khoảng cách đã biết giữa mockup/tài liệu và code (link trang cũ ở `profile/profile.html:22`, chữ Tennis/VIP/"bán kính 5km" còn sót, hàng mẫu admin bị JS thay khi tải…) được liệt kê đầy đủ tại Guide mục 9.7, ghi nhận 15/11/2026 — chưa sửa code.

## Module 3 frontend: Chi tiết sân và lưới chọn khung giờ

Ghi chú: Module 3 frontend theo phạm vi màn hình; hàng số 3 trong bảng roadmap tổng thể vẫn là module Admin và không thay đổi.

| # | Việc | Trạng thái | Ghi chú |
|---|---|---|---|
| 3.1 | Đối chiếu mockup, trường API và luồng chọn khung | Xong | API có đủ trường quan trọng; gallery nhiều ảnh và số lượng/nội dung đánh giá không có nên không tạo dữ liệu giả. |
| 3.2 | Nối trang chi tiết, sân con, trạng thái lịch và lựa chọn khung liền kề | Chờ người dùng xác nhận | Code đã triển khai; chưa xác minh end-to-end với API thật vì runtime hiện trả 404. |
| 3.3 | Test lựa chọn giờ liền kề, không liền kề, bỏ đầu/giữa/cuối | Xong | 4/4 test `frontend/tests/slot-selection.test.js` đạt. |
| 3.4 | Smoke test giao diện với API đang chạy tại localhost:3000 | Chờ người dùng xác nhận | Runtime API tại môi trường này trả 404 cho `/api/v1/facilities/1`; cần xác nhận bằng cấu hình/backend đang chạy của người dùng. |

## Module 4: Đặt sân, giữ chỗ, chống đặt trùng (FR-06, FR-12)

Nguồn: [business-flow.md mục 3 (bước 4-6, 10), 6.1, 6.2, quy tắc 1-4](../01-plan/business-flow.md).  
Trạng thái chung: **Đang làm**

Cập nhật 2026-11-08: Backend hold/đọc/hủy, expiry job và bộ integration test đã được triển khai; frontend trang xác nhận, đồng hồ server, hủy và xử lý 401/409/410 đã được triển khai. Browser smoke test với API giả xác nhận tổng tiền, countdown 10:00, hủy, tiếp tục sau reload, lỗi 401 và 409. Backend `npm test` trên `sportbooking_test`: 93/93; frontend tests: 232/232.

| # | Việc | Trạng thái |
|---|---|---|
| 4.1 | Chọn một hoặc nhiều khung giờ liền kề, cùng sân, cùng ngày | Chờ người dùng xác nhận |
| 4.2 | Khóa giờ đã qua và giờ bắt đầu cách hiện tại dưới 15 phút | Chờ người dùng xác nhận |
| 4.3 | Màn hình xác nhận: tổng giá, chọn cọc 50% hoặc toàn bộ, bật/tắt tìm đối | Chờ người dùng xác nhận |
| 4.4 | Tạo đơn `PENDING` và khóa nguyên tử tất cả khung giờ (`lock_expires_at` = +10 phút) | Xong |
| 4.5 | Chống đặt trùng bằng transaction và ràng buộc duy nhất | Xong |
| 4.6 | Mỗi user tối đa một đơn `PENDING`; cho tiếp tục hoặc hủy đơn cũ | Xong |
| 4.7 | Lịch trống coi lock quá hạn là trống; hiển thị "Đang được giữ chỗ" cho người khác | Chờ người dùng xác nhận |
| 4.8 | Tác vụ nền mỗi phút: `PENDING` hết hạn thành `EXPIRED`, trả khung `AVAILABLE`, gửi thông báo | Chờ người dùng xác nhận |
| 4.9 | Quay lại tiếp tục đơn `PENDING` còn hạn, không gia hạn lock | Xong |
| 4.10 | Test: đặt hợp lệ, đặt trùng bị từ chối, giờ đã qua, thiếu dữ liệu, lock hết hạn thì lịch trống | Xong |

## Module 1 UI: Hồ sơ cá nhân (FR-03)

- Đã làm mới giao diện trang hồ sơ theo mockup, giữ nguyên thao tác sửa hồ sơ/đổi mật khẩu, trạng thái, API và header chung.
- Ẩn các khối mockup không có dữ liệu/chức năng API; kiểm thử frontend 34/34 file đạt.
- Kiểm tra trình duyệt với API giả: responsive desktop/mobile, không tràn ngang, focus bàn phím rõ. Xác nhận với API thật: **Chờ người dùng xác nhận**.
