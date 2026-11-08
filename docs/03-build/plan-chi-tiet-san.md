# Kế hoạch — Chi tiết sân và lưới chọn khung giờ

> Trạng thái: Đã duyệt và triển khai; smoke test với API thực tế đang chờ người dùng xác nhận. Chỉ đọc mockup; không sửa `docs/02-design/mockups/`.

## Bước 0 — Đối chiếu dữ liệu

Mockup chi tiết sân cũ: `docs/02-design/mockups/chi-tiet-san.html`. Mockup có một trang chi tiết, gồm ảnh, tên/môn, đánh giá, địa chỉ, giờ hoạt động, hotline, giá giờ thường/giờ vàng, tiện ích, chính sách hủy, nội quy, bản đồ, đánh giá/nhận xét, chọn sân con, ngày, thông tin giá/khung còn trống và CTA đặt sân. Mockup có thêm nhiều ảnh và số lượng đánh giá nhưng API hiện tại không trả danh sách ảnh hoặc số lượng/nhận xét.

Routes được mount tại `/api/v1` trong `backend/src/app.js`; routes facilities yêu cầu phiên đăng nhập.

| Trường giao diện cần | API đã trả | Cách xử lý |
|---|---|---|
| Tên, địa chỉ, quận, giờ mở cửa/đóng cửa, hotline, mô tả | `GET /api/v1/facilities/:id`: `facility.name`, `address`, `district`, `opening_time`, `closing_time`, `hotline`, `description` | Hiển thị giá trị API; trường tùy chọn rỗng thì ẩn hoặc báo chưa có thông tin. |
| Môn, tên sân con, mô tả sân con | `courts[]`: `id`, `name`, `sport_type`, `sport_name`, `description` | Chọn sân con theo `court.id`; thể thức chỉ hiện theo môn của sân đang chọn. |
| Giá giờ thường/giờ vàng và giá của từng khung | `courts[]`: `price_normal`, `price_peak`; time-slot: `price` | Hiển thị giá từ API; tổng tạm tính cộng giá slot trả về, không tự tính giá giờ. Ghi rõ giá chính thức do hệ thống xác nhận khi đặt. |
| Ảnh | `facility.image_url` | Dùng URL API nếu hợp lệ; nếu rỗng/không hợp lệ dùng ảnh mặc định theo môn. API không có gallery nhiều ảnh nên không tạo thumbnail giả. |
| Tiện ích | `facility.amenities` (mảng) | Hiển thị từng mục bằng text; mảng rỗng thì ẩn/hiện trạng thái trống. |
| Nội quy, chính sách hủy | `facility.rules`, `facility.cancellation_policy` | Hiển thị nguyên văn dữ liệu API; null thì ẩn phần tương ứng. |
| Bản đồ | `facility.map_url`, `latitude`, `longitude` | Chỉ hiển thị liên kết/bản đồ dùng `map_url` khi là URL HTTP(S) hợp lệ; thiếu thì ẩn. Không dựng vị trí thay thế. |
| Đánh giá | `courts[].rating` (điểm khởi tạo); không có số lượng và nội dung đánh giá trong detail response | Chỉ hiển thị điểm API nếu có, không bịa số lượt/nhận xét; nếu không có thì ghi “Chưa có đánh giá” và ẩn danh sách nhận xét. |
| Ngày và trạng thái khung giờ | `GET /api/v1/courts/:id/time-slots?date=YYYY-MM-DD`: `service_date`, `time_slots[]` gồm `starts_at`, `ends_at`, `price`, `status`, `is_selectable`, `unavailable_reason` | Dùng `is_selectable`/`unavailable_reason` do server trả; nhãn theo `AVAILABLE`, `LOCKED`, `BOOKED`, `PAST_OR_TOO_SOON`. Hiển thị nguyên các slot API trả về, kể cả 24 slot. |

**Kết luận:** Không phát hiện trường quan trọng bắt buộc nào bị thiếu khỏi API hiện tại; chưa cần đề xuất thay đổi backend/seed. Thiếu gallery nhiều ảnh và danh sách/số lượng đánh giá là phần không thiết yếu, xử lý theo quy tắc trên. `rules`, `cancellation_policy`, `map_url`, `image_url` có thể null nhưng API có trường; UI sẽ không thay bằng nội dung tự tạo.

## Phạm vi dự kiến

- Tạo `frontend/chi-tiet-san.html` bằng cách chép nguyên markup, class và Tailwind CDN từ mockup `chi-tiet-san.html`; loại toàn bộ JavaScript cũ và dữ liệu giả. Giữ các chữ giao diện cũ trừ dữ liệu động/chi tiết mâu thuẫn nguồn nghiệp vụ; ghi nhận lệch mockup trong kết quả.
- Tạo `frontend/chi-tiet-san.js` gọi đúng hai GET API cùng origin với `credentials: 'same-origin'`; đọc facility ID từ `?id=` và ngày từ `?date=`, cập nhật URL khi đổi sân con/ngày, không dùng Web Storage.
- Chọn sân con từ `courts[]`; nạp ngày trong 14 ngày kể từ hôm nay và trạng thái lịch từ API. Ngày không có slot khả dụng cần thông báo rõ và cho đổi ngày.
- Hiển thị loading, lỗi có thử lại, 404 facility có đường về tìm sân, và 401 chuyển `/dang-nhap.html?returnTo=...`.
- Lưới slot dùng đúng trạng thái/khả dụng API; nhận diện giờ vàng 17:00–21:00; nhiều slot chỉ được chọn liên tiếp. Bấm bỏ slot đầu/cuối thì thu gọn lựa chọn; bỏ slot giữa thì giữ phần liền mạch phía trước. Hiển thị số giờ, tổng tiền tạm tính và lưu lựa chọn chỉ trên URL.
- Thể thức đơn/đôi chỉ cho cầu lông và pickleball. CTA tiếp tục/đặt sân disabled, không gọi API ghi.
- Nối thẻ sân ở trang chủ và tìm sân tới URL chi tiết theo facility ID; giữ URL tìm sân làm đích quay lại để bảo toàn bộ lọc. Giữ bộ lọc ngày/giờ ở trang tìm sân disabled.
- Chỉ sửa `docs/02-design/spec.md` để thêm URL trang; cập nhật module 3 trong roadmap và changelog sau khi triển khai.
- Không sửa backend, API, `sportbooking_system`, nội dung mockup, hoặc các bộ lọc ngoài phạm vi.

## Kiểm tra dự kiến

- Kiểm tra cú pháp JavaScript và các trường hợp lựa chọn slot liền kề/không liền kề, bỏ slot ở đầu/giữa/cuối.
- Chạy `npm test` tại `backend/` với `APP_ENV=test` và `DB_NAME=sportbooking_test`; không chạy migration/seed.
- Kiểm tra trang ở `http://localhost:3000/` khi API và phiên đăng nhập khả dụng. Chỉ ghi “Xong” cho bước đã chạy thử; phần cần xác nhận trực quan ghi “Chờ người dùng xác nhận”.
