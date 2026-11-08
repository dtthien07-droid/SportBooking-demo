# Kế hoạch — Trang chủ user và tìm sân

> Trạng thái: đã duyệt và triển khai. Phạm vi giao diện theo [business-flow.md](../01-plan/business-flow.md) và [spec.md](../02-design/spec.md). Chỉ đọc các mockup; không sửa `docs/02-design/mockups/`.

## Phạm vi

- Tạo `frontend/trangchu-user.html` và `frontend/tim-san.html` từ markup, class, Tailwind CDN và bố cục của hai mockup; không viết lại thiết kế.
- Bỏ JavaScript cũ và dữ liệu giả/nhúng sẵn (sân, giá, kèo, thống kê); không thêm dữ liệu mẫu. Giữ các chữ giới thiệu cũ, ghi nhận nội dung lệch business-flow trong báo cáo cuối.
- Tại trang chủ, tải tối đa 4 cơ sở nổi bật từ API thật; hiển thị loading, lỗi có nút thử lại, và trạng thái rỗng có hướng dẫn.
- Tại trang tìm sân, nối môn/quận/từ khóa/phân trang với API; giữ lại nhưng vô hiệu hóa điều khiển ngày, khung giờ và tiện ích vì API chưa hỗ trợ các bộ lọc đó.
- Sửa điều hướng đăng nhập thành công trong `frontend/shared/app.js` tới `/trangchu-user.html`. Khi API sân trả 401, chuyển tới `/dang-nhap.html`.
- Cập nhật ghi chú module 2 trong `docs/04-product/roadmap.md` và thêm mục trong `docs/04-product/changelog.md` sau khi hoàn tất.

## Hợp đồng API đã xác minh

- `backend/src/app.js` gắn facilities router tại `/api/v1`; `backend/src/facilities/facilities.routes.js` cung cấp `GET /facilities`. Đường dẫn gọi là `/api/v1/facilities`.
- Query được service chấp nhận: `sport`, `district`, `q`, `page`, `page_size`. `sport` nhận `BADMINTON`, `FOOTBALL_MINI`, `PICKLEBALL`; `page_size` tối đa 50.
- Response có `{ facilities, pagination }`; pagination gồm `page`, `page_size`, `total`, `total_pages`. Mỗi facility gồm `id`, `name`, `address`, `district`, `opening_time`, `closing_time`, `hotline`, `image_url`, `sports`, `sport`, `sport_name`, `price_min`, `price_max`, `rating` cùng các trường mô tả/tiện ích.
- Không gửi ngày/khung giờ/tiện ích vì route không lọc theo các trường này. Fetch dùng `credentials: 'same-origin'`; dữ liệu API đưa vào DOM bằng `textContent` và thuộc tính DOM, không ghép chuỗi HTML.

## Các file dự kiến sửa/tạo

1. Tạo `frontend/trangchu-user.html`.
2. Tạo `frontend/tim-san.html`.
3. Tạo `frontend/trangchu-user.js`, `frontend/tim-san.js` và `frontend/shared/facilities-api.js` cho API và trạng thái giao diện.
4. Sửa `frontend/shared/app.js` cho chuyển hướng sau đăng nhập.
5. Cập nhật `docs/04-product/roadmap.md` và `docs/04-product/changelog.md`.

Không sửa backend/API, các trang khác hoặc bất kỳ file nào trong `docs/02-design/mockups/`.

## Kiểm tra

- Kiểm tra cú pháp JavaScript; xác nhận markup không còn dữ liệu sân/giá/thống kê/kèo giả hoặc script cũ.
- Kiểm tra query cho từng bộ lọc và chuyển trang; xác nhận loading, lỗi/thử lại, rỗng và 401.
- Chạy test frontend/backend phù hợp hiện có; kiểm tra hai URL qua `http://localhost:3000/` nếu server khả dụng.
