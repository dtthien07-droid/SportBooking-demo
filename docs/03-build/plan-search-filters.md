# Kế hoạch — Bộ lọc ngày và khung giờ tìm sân

> Trạng thái: đã duyệt; B1/B2 đã triển khai. B3 hoãn do dữ liệu tiện ích chưa chuẩn hóa. Phạm vi theo [business-flow.md](../01-plan/business-flow.md) và [spec.md](../02-design/spec.md); không đổi schema hoặc migration.

## Chẩn đoán đã xác minh

- `frontend/tim-san.html` đặt `disabled` trên ngày, khung giờ và các checkbox khung giờ/tiện ích; đồng thời hiển thị lời nhắc API chưa hỗ trợ.
- `GET /api/v1/facilities` hiện nhận `sport`, `district`, `q`, `page`, `page_size`; truy vấn lọc cơ sở hoạt động, sân hoạt động, môn, quận và tên/địa chỉ. Route đã đặt `Cache-Control: no-store`.
- Tiện ích lưu trong `facilities.amenities` dưới dạng JSON array văn bản. Admin có sáu checkbox nhãn cố định nhưng vẫn giữ tiện ích cũ/tự do; backend chấp nhận chuỗi tùy ý. Trong `sportbooking_dev`, 29 cơ sở có JSON hợp lệ; không cơ sở nào khớp chính xác sáu nhãn checkbox. Do không có mã tiện ích chuẩn và dữ liệu hiện tại không đồng nhất, phần lọc tiện ích B3 được hoãn, không suy đoán hoặc đổi dữ liệu.
- Lưới chọn giờ coi slot là chọn được khi sân/cơ sở hoạt động, trạng thái là `AVAILABLE` (hoặc `LOCKED` có khóa hết hạn) và giờ bắt đầu cách hiện tại ít nhất 15 phút. Trang chi tiết sân đã nhận tham số `date`.

## Phạm vi dự kiến sau khi duyệt

1. Backend: xác thực `date` theo ngày Việt Nam trong hôm nay đến hôm nay + 13 ngày; xác thực `time_band` dạng danh sách `morning|afternoon|evening|night`; trả lỗi 400 tiếng Việt khi sai. Kết hợp các bộ lọc với điều kiện hiện có và dùng cùng điều kiện khả dụng của lưới chọn giờ trong `EXISTS`; áp dụng điều kiện đồng nhất cho truy vấn danh sách và tổng phân trang.
2. Frontend: bật ngày và khung giờ; đồng bộ lựa chọn giữa thanh tìm kiếm và bộ lọc chi tiết; gọi API khi áp dụng; lưu/khôi phục `date` và `time_band` qua URL/back; đặt lại toàn bộ bộ lọc; cập nhật trạng thái rỗng, số kết quả và giữ phân trang. Không sửa lọc môn, từ khóa/khu vực hoặc luồng đặt sân.
3. Khi có ngày đã chọn, truyền `date` sang trang chi tiết sân (`chi-tiet-san.js` hiện hỗ trợ tham số này). Không thêm bộ lọc tiện ích cho tới khi người dùng quyết định chuẩn hóa/ánh xạ dữ liệu tiện ích.
4. Giữ nguyên các thay đổi đang có trong `facilities.*` và tích hợp trên đó; không dùng git checkout/restore/stash.

## Kiểm thử dự kiến

- Backend: kiểm thử date hợp lệ/sai/ngoài 14 ngày, time-band hợp lệ/sai, lọc kết hợp và tổng/phân trang; xác nhận slot bị đặt/đang khóa/đã qua hoặc không đủ 15 phút không làm cơ sở khớp.
- Frontend: kiểm thử đồng bộ hai giao diện, query URL, back/refresh, reset, nhiều khung giờ, trạng thái không có kết quả và truyền ngày sang trang chi tiết.
- Chạy `node --check` cho JavaScript sửa đổi, test frontend liên quan và test backend với `APP_ENV=test`, `DB_NAME=sportbooking_test`.

## Quyết định cần có nếu muốn triển khai B3

Chọn một nguồn mã chuẩn cho tiện ích và ánh xạ các giá trị văn bản cũ như “Nhà vệ sinh”, “Có bãi đỗ xe”, “Wifi miễn phí” sang mã đó; hoặc tiếp tục hoãn bộ lọc tiện ích. Không tự suy diễn ánh xạ trong phạm vi này.
