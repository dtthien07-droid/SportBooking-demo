# Kế hoạch — Đồng bộ cơ sở admin–khách, KPI và xóa cơ sở

## Chẩn đoán trước thay đổi

- API khách dùng `INNER JOIN courts`, nên cơ sở không có sân con không xuất hiện; không lọc theo khung giờ trống. Danh sách có phân trang.
- Response API khách đã có `Cache-Control: no-store`; fetch frontend chưa chỉ định `cache: 'no-store'`. Không thấy ETag hoặc cache danh sách ở backend/frontend.
- Bộ lọc môn thể thao/khu vực chỉ áp dụng khi khách chọn; không phải nguyên nhân mặc định khiến cơ sở bị loại.
- Truy vấn chỉ đọc trên `sportbooking_dev`: API hiện trả 29 cơ sở; id 30 “sân bóng” có `is_active=0`, 0 sân con và 0 booking. Theo quy tắc hiển thị mới, cơ sở này không đủ điều kiện; không ghi/xóa dữ liệu dev.

## Phạm vi đã duyệt và thực hiện

- D4: khách chỉ thấy cơ sở `is_active=1` có ít nhất một sân con đang hoạt động. Danh sách/tìm sân/trang chủ và chi tiết dùng no-store; chi tiết cơ sở không đủ điều kiện trả 404. Cơ sở không có sân vẫn hiện ở admin kèm nhãn “Chưa có sân”.
- D2: bốn KPI đếm cơ sở trên toàn bộ dữ liệu, tổng bằng mở + khóa; giữ trường summary sân con cũ để tương thích. Tỷ lệ lấp đầy 7 ngày giữ nguyên; cập nhật sau thao tác và theo polling 5 giây.
- D3: thêm xóa có popup, `expected_updated_at`, chặn nếu có booking ở mọi trạng thái, xóa phụ thuộc và ghi `DELETE_FACILITY` cùng transaction. Thứ tự: `booking_slots` → `time_slots` → `courts` → `facilities`.
- Giữ nguyên hành vi bật/tắt cơ sở; không migration, đổi schema, thêm thư viện hoặc ghi dữ liệu vào `sportbooking_dev`.

## Tệp trong phạm vi

- Backend: `backend/src/admin/admin.routes.js`, `backend/src/admin/facilities.service.js`, `backend/src/facilities/facilities.repository.js`, `backend/src/facilities/facilities.service.js`.
- Frontend: `frontend/admin/facilities-page.js`, `frontend/admin/facilities-state.js`, `frontend/admin/admin-api.js`, `frontend/shared/facilities-api.js`, `frontend/chi-tiet-san.js`.
- Kiểm thử: `backend/tests/admin-facility-lifecycle.integration.test.js`, `backend/tests/facilities.integration.test.js`, `frontend/tests/admin-facilities.test.js`.

## Kiểm chứng

- Frontend: toàn bộ test 198/198; test cơ sở mục tiêu 10/10.
- Backend: `APP_ENV=test`, `DB_NAME=sportbooking_test`, `npm test` đạt 90/90 trong hai lượt liên tiếp.
- `node --check` 12 file JavaScript trong phạm vi và `git diff --check` đạt.
- Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.
