## 2026-11-16 — Loại dữ liệu trước deploy khỏi số liệu Admin
- Dùng chung điều kiện booking hợp lệ: user còn tồn tại và `created_at` từ `2026-11-15T17:00:00.000Z`; áp dụng cho danh sách, thống kê, biểu đồ, top sân, xuất Excel và slot.
- Đồng bộ `today`/`7d`/`30d` theo ngày tạo đơn UTC+7, status sáu nhóm, page size backend 10 và kỳ thống kê giữa Tổng quan/Đơn đặt sân; ghi rõ Ngày chơi là bộ lọc riêng.
- Lịch Khung giờ & Giá chỉ giữ trạng thái đã đặt/đang giữ của booking hợp lệ; không thay đổi dữ liệu slot. Sửa render dashboard thiếu phần tử và thêm nút thử lại khi API lỗi.
- Đối chiếu SELECT-only trên `sportbooking`: 66 booking → 2 hợp lệ; cả ba kỳ có dashboard/danh sách/tổng status = 2; 2 slot đặt của tuần 16–22/11 khớp 2 booking hợp lệ.
- Frontend tests: 231/231; backend service tests: 4/4; `node --check` đạt. Không migration, không ghi DB.

## 2026-11-15 — Làm mới giao diện hồ sơ cá nhân
- Áp bố cục hai cột, thẻ hồ sơ, điều hướng và trường nhập theo mockup; giữ nguyên form/API/validation và header dùng chung.
- Ẩn thống kê, CLB, hạng, sở thích và các trường không có API; phần tóm tắt dùng dữ liệu tài khoản thật qua `textContent`.
- Fidelity baseline trước khi đổi markup FAIL vì thiếu lớp và khối sidebar; sau thay đổi PASS. Frontend: 34/34 file test; `node --check` đạt.
- Browser với API giả ở desktop/mobile: không tràn ngang; focus bàn phím và trạng thái tải được xác nhận. API thật: **Chờ người dùng xác nhận**.

## 2026-11-15 — Lọc ngày và khung giờ tìm sân
- Bật lọc ngày chơi và các khung giờ ở cả thanh tìm kiếm/bộ lọc chi tiết; đồng bộ lựa chọn, URL/back, phân trang, reset và ngày truyền sang trang chi tiết sân.
- API xác thực phạm vi 14 ngày theo UTC+7, lọc qua `EXISTS` với cùng điều kiện slot chọn được của lưới giờ; test frontend 3/3, facilities integration 1/1, `node --check` đạt.
- Bộ lọc tiện ích tiếp tục hoãn: dữ liệu hiện là văn bản tự do không có mã chuẩn; kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-15 — Đồng bộ hotline hỗ trợ và trạng thái vé điện tử
- Đồng bộ hotline nền tảng SportBooking về đầu vào chung `frontend/shared/support-constants.js` và footer dùng chung `frontend/shared/footer.js`; tất cả trang giao diện đọc số từ cùng một nguồn, không hardcode ở từng file, trong khi hotline sân của từng cơ sở vẫn giữ theo dữ liệu sân.
- Sửa logic trạng thái vé điện tử ở chi tiết/lịch sử theo dữ liệu thật: khi có vé nhưng booking đã hủy/hoàn tiền hoặc hết hạn, hiển thị `VÉ ĐÃ VÔ HIỆU`; khi có vé hợp lệ và thanh toán thành công thì `ĐÃ PHÁT HÀNH`; khi không có vé thì `CHƯA PHÁT HÀNH`.
- Cập nhật API/renderer dùng chung để đồng bộ logic giữa lịch sử đặt sân và trang chi tiết đơn; kiểm tra dữ liệu booking #59 cho thấy ticket tồn tại nhưng đơn `CANCELLED` + `payment_status = REFUNDED` nên phải vô hiệu.
- Kiểm tra nguồn dữ liệu và giao diện: hotline/ticket đều kiểm tra lại theo dữ liệu thực tế; no hardcode lặp lại vì sử dụng source-of-truth. Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.
- Sửa footer để gán hotline sau khi gắn footer vào DOM; kiểm tra trình duyệt thấy `support-constants.js` và `footer.js` đều trả HTTP 200, không phát sinh lỗi JS (ngoài cảnh báo Tailwind CDN có sẵn).
- Vé có thiếu `qr_code` nay được trình bày vô hiệu thay vì ném lỗi; lỗi dựng một đơn được cô lập, ghi Console và không làm mất các thẻ khác. `frontend/tests/booking-history.test.js`: 25/25 đạt; `node --check` và `git diff --check` đạt.

## 2026-11-15 — Admin: xuất Excel các báo cáo còn lại
- Thêm xuất Excel cho Tổng quan, Người dùng, Cơ sở & Sân, Khung giờ & Giá; chuyển trang Đơn đặt sân sang dùng chung module tải và dựng workbook, giữ tên file/hành vi hiện có.
- Tệp báo cáo dùng tiếng Việt, cố định/in đậm hàng tiêu đề, định dạng ngày/giờ/tiền, thoát công thức và giới hạn 5.000 dòng; audit theo action mà không ghi dữ liệu cá nhân.
- Bỏ dòng chân thẻ “Doanh thu trong kỳ … / Theo dữ liệu API” ở biểu đồ Tổng quan; giữ nguyên số liệu, biểu đồ và trạng thái rỗng.
- HTTP integration cho quyền, bộ lọc, workbook, khớp số liệu dashboard, giới hạn, audit và dữ liệu nhạy cảm đạt; frontend 31/31 file test, `node --check` đạt, `npm test` 93/93 hai lượt liên tiếp trên `sportbooking_test`.
- Đã kiểm tra metadata schema `sportbooking_dev` bằng truy vấn chỉ đọc; các bảng/cột báo cáo tồn tại. Kiểm tra trình duyệt: **Chờ người dùng xác nhận**. Cần khởi động lại server.

## 2026-11-14 — Đồng bộ cơ sở admin–khách, KPI và xóa cơ sở
- Nguyên nhân cơ sở id 30 “sân bóng” không hiện cho khách: truy vấn public dùng `INNER JOIN courts` nên cơ sở 0 sân con bị loại; dữ liệu đọc-only trên `sportbooking_dev` cũng cho thấy cơ sở này đang `is_active=0` và có 0 sân. Không thấy cache backend/ETag; response đã `no-store`, còn fetch frontend nay đặt `cache: 'no-store'`. Bộ lọc môn/khu vực chỉ áp dụng khi người dùng chọn; không lọc theo khung giờ trống.
- GET danh sách, tìm sân/trang chủ và chi tiết chỉ công khai cơ sở đang mở có ít nhất một sân con hoạt động; cơ sở mới tạo bằng form có sân đầu tiên hiển thị ngay. Cơ sở không có sân vẫn hiện trong admin với nhãn “Chưa có sân”.
- KPI tổng/mở/khóa nay đếm cơ sở trên toàn bộ dữ liệu, tổng bằng mở + khóa; giữ trường summary cũ tương thích. Tỷ lệ lấp đầy 7 ngày không đổi; cập nhật theo polling 5 giây và sau thao tác.
- Thêm DELETE cơ sở có expected_updated_at; chặn nếu có booking ở mọi trạng thái, xóa phụ thuộc và ghi `DELETE_FACILITY` trong cùng transaction. Bảng theo thứ tự: `booking_slots` → `time_slots` → `courts` → `facilities`; không xóa dữ liệu `sportbooking_dev`.
- Sửa phạm vi hàm popup/xóa để handler hàng cơ sở gọi được; test frontend 198/198, backend `npm test` 90/90 ở hai lượt liên tiếp trên `sportbooking_test`; `node --check` 12 file JS và `git diff --check` đạt.
- Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**. Cần khởi động lại server để nhận thay đổi.

## 2026-11-14 — Admin: hoàn thiện luồng cơ sở và sân
- Bổ sung form tạo cơ sở với sân đầu tiên, môn thể thao, giá thường và giá giờ vàng; backend yêu cầu có ít nhất một sân, validate giờ tròn và hỗ trợ giờ đóng 24:00.
- Tạo sân, 14 ngày khung giờ một giờ, giá theo khung giờ vàng và admin audit cùng transaction; sửa giờ chỉ cắt khung tương lai AVAILABLE, giữ khung đã đặt và từ chối nếu còn đơn hiệu lực ngoài giờ mới.
- Sau lưu, cập nhật hàng/số liệu ngay; khách nhìn thấy cơ sở, giờ và khung mới, có thể đặt. Lỗi giờ hiện tiếng Việt cạnh trường.
- HTTP integration: 19/19; frontend tests: 197/197; `node --check` đạt; `npm test` hai lượt liên tiếp: 82/82 mỗi lượt trên `sportbooking_test`. Không đổi schema/dependency; `sportbooking_dev` chỉ kiểm tra schema đọc-only.
- Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-14 — Admin: sửa ghi và đồng bộ dữ liệu khách
- Hoàn tất ba giai đoạn yêu cầu: xử lý tiếng Việt cho lỗi admin và log stack chỉ trong development; khóa/mở khóa tài khoản cùng thu hồi phiên; hủy sự cố tạo đúng hai thông báo trong cùng transaction.
- Đồng bộ giờ hoạt động giữa API admin/khách và khung giờ sân: giữ slot đã giữ/đặt, bỏ khung AVAILABLE ngoài giờ, sinh khung thiếu; booking ngoài giờ trả 409. Null giờ ở dữ liệu cũ không làm slot biến mất.
- Giá mới đồng bộ qua tìm sân, chi tiết, lưới giờ và đơn mới; slot đã giữ/đặt không đổi. Không migration, đổi schema hoặc thêm dependency.
- Kiểm tra HTTP tập trung trên `sportbooking_test` đạt cho hủy/thông báo, khóa/mở khóa, giờ hoạt động, trạng thái sân, giá và booking; `node --check` đạt 127 file JS.
- `npm test` chạy hai lượt: mỗi lượt 77/79 (cùng một assertion export đòi filename có dấu ngoặc kép; response trả `filename=...`, cộng test cha báo lỗi). Frontend: 189/192; còn ba assertion về class mockup, `data-slot-view="week"` và icon `edit`.
- Không tái hiện được các lỗi 500 ban đầu trên DB dev nên chưa xác nhận được nguyên nhân SQL gốc; giao diện: **Chờ người dùng xác nhận**.

## 2026-11-14 — Admin GĐ4–5: Khung giờ, giá và xuất đơn
- GĐ4: API hỗ trợ lịch khung giờ tối đa 31 ngày, tổng hợp từng ngày trong tháng, xem trước giá và cập nhật một/hai mức giá chỉ cho khung `AVAILABLE`; giao diện ngày/tuần/tháng hiển thị trạng thái và số liệu theo phạm vi.
- GĐ5: bộ lọc áp dụng được dùng nhất quán cho danh sách và `GET /admin/bookings/export`; Excel tối đa 5.000 dòng, trạng thái tiếng Việt, thoát công thức, audit không chứa dữ liệu cá nhân.
- Dùng chung dialog hủy sự cố trên trang Đơn đặt sân; sửa lỗi khởi tạo do trang không có form tĩnh và nút xác nhận không liên kết với form xử lý submit.
- ExcelJS đã có trong backend, không thêm dependency; không migration/đổi schema. Đã thêm HTTP/frontend tests nhưng chưa chạy được do VS Code không có test controller và Windows shell sandbox không khả dụng; `npm audit` chưa chạy.
- Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-14 — Admin GĐ3: Cơ sở và sân
- API admin trả summary tổng số cơ sở, sân đang hoạt động/tạm khóa và tỷ lệ lấp đầy 7 ngày; trạng thái cơ sở/sân tiếp tục kiểm tra đơn hiệu lực, `expected_updated_at` và audit trong transaction.
- API khách hiển thị cả cơ sở/sân tạm khóa; slot bị khóa không chọn được, đơn mới trả `409 COURT_INACTIVE`. Danh sách, trang chủ và chi tiết sân phản ánh trạng thái.
- Trang quản trị sắp lại bảng/KPI, bỏ cột môn/đơn giá và nút xóa, giữ một nút Sửa; icon của trang dùng SVG nội tuyến.
- Đã thêm HTTP integration và frontend tests. Không chạy được test/`node --check`: PowerShell sandbox Windows không có backend; VS Code test discovery không có controller. Chẩn đoán editor không có lỗi; trình duyệt: **Chờ người dùng xác nhận**.
- Không migration hoặc đổi schema.

## 2026-11-14 — Admin GĐ2: Người dùng
- `GET /admin/users` trả summary tổng tài khoản, ACTIVE, ADMIN_LOCKED và người dùng mới trong tháng UTC+7; khóa tài khoản thu hồi phiên cùng transaction.
- `requireAuth` kiểm tra trạng thái mỗi request; tài khoản bị khóa nhận `401 ACCOUNT_LOCKED`, đăng nhập nhận `403` và thông báo thống nhất. Mở khóa cho phép đăng nhập phiên mới.
- Trang người dùng có bốn số liệu thật, khóa không thời hạn với lý do tùy chọn, đếm ký tự, xác nhận mở khóa; thay icon ligature/font bằng SVG dùng chung.
- Kiểm tra frontend tập trung 33/33 và backend HTTP tập trung 23/23 đạt; trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-14 — Admin GĐ1: Tổng quan sau demo
- Dashboard thêm series theo giờ/ngày, KPI doanh thu kỳ trước và số liệu sân; bảng đơn hiển thị SĐT, nhãn tiếng Việt, lọc và popup chi tiết.
- Thêm API `GET /admin/bookings/{id}`; hủy sự cố dùng dialog chung, cập nhật 2 thông báo khách trong transaction và banner số tiền hoàn.
- Bỏ mục “Cài đặt hệ thống” khỏi menu admin; giữ polling 5 giây. Không migration hoặc đổi schema.
- Backend `npm test` đạt 76/76 hai lượt; frontend tests đạt 181/181 và `node --check` đạt trên 125 file; trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-13 — Module 10, GĐ5–6: polling đơn và tổng kiểm
- Trang đơn đặt sân cập nhật bảng, số đếm tab và KPI tại chỗ mỗi 5 giây; giữ bộ lọc/trang/scroll, làm nổi đơn mới 5 giây và làm mới ngay sau thao tác admin.
- Trang tổng quan dùng lại phiên xác thực từ header chung, chỉ gọi `/auth/me` dự phòng khi header không có user.
- Thêm test polling và xác thực dashboard; toàn bộ 28 file frontend test đạt, backend `npm test` đạt 75/75 hai lượt với `APP_ENV=test`, `DB_NAME=sportbooking_test`.
- Quét 5 trang Admin: không dùng `innerHTML`, `localStorage`, icon font hay nội dung ngoài nghiệp vụ; các trang dùng admin shell và nằm trong allowlist. Migration 008 chỉ có một file.
- Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**. Mockup nguồn người dùng/khung giờ rỗng; dashboard/cơ sở chưa chép nguyên nội dung mockup.
- Lệnh chạy migration trên dev từ thư mục gốc khi được phép: `node infra\database\migrate-bookings.js --database sportbooking_dev`.

## 2026-11-12 — Module 10B: Giao diện Quản trị
- Chép khung trang từ `docs/02-design/mockups/danh-sach-dat-san-admin.html`; giữ bố cục số liệu, tab, bộ lọc, bảng, hàng mẫu và phân trang. Thay header bằng header dùng chung, font nạp qua stylesheet dùng chung và biểu tượng bằng SVG đã đăng ký.
- Xóa dữ liệu mẫu cố định, nối lại dữ liệu hiện có qua API và template hàng; giữ 7 tab nghiệp vụ, phân trang và các trạng thái tải/lỗi/rỗng. Header ADMIN chỉ còn logo, thông tin quản trị viên và đăng xuất.
- Bổ sung thanh điều hướng trái theo ảnh đã duyệt với sáu mục; Tổng quan và Danh sách đặt sân liên kết tới các khối hiện có, bốn mục chưa triển khai hiển thị “Sắp có” và không có đích giả. Ở màn hình hẹp, thanh bên chuyển thành dải ngang có thể cuộn.
- Thêm bộ lọc nháp/đã áp dụng, tìm theo mã đặt sân, ngày chơi và cơ sở lấy từ API (phân trang, gom theo quận và sắp xếp tiếng Việt); thêm Tìm kiếm/Đặt lại, phục hồi và đồng bộ applied lên URL. Tab và số đếm dùng bộ lọc applied. Dashboard API không hỗ trợ các bộ lọc này nên các thẻ số liệu giữ phạm vi toàn hệ thống và trang ghi rõ điều đó.
- GET `/api/v1/admin/bookings` bổ sung hai tham số chỉ đọc `facility_id` và `date`, có validate 400, kết hợp được với status, tìm mã và phân trang; integration test HTTP kiểm tra lọc và quyền truy cập.
- Mockup không có popup; giữ nguyên popup hủy do sự cố hiện tại, gồm focus trap, Esc, xác thực lý do, hoàn 100% số đã trả và xử lý lỗi API.
- API admin chỉ trả trạng thái gốc, không có `display_status_code`; frontend dùng thời gian slot theo quy tắc UTC+7 half-open của backend để phân loại “Sắp tới”, “Đang trong trận” và booking CONFIRMED đã tới giờ kết thúc trong tab “Hoàn thành”. API danh sách cũng không trả cờ hết hạn lock của PENDING; nút có thể hiện với PENDING hết hạn, còn backend từ chối yêu cầu bằng `409 BOOKING_EXPIRED`.
- Giữ nguyên điều hướng trang chủ USER, ẩn chuông và thanh giữ chỗ trên trang admin.
- Test từng file frontend trước đó: 157/157 đạt; test Quản trị sau khi thêm thanh bên: 19/19 đạt; `node --check frontend/admin/admin-page.js`: đạt. `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 72/72 đạt hai lượt liên tiếp trước thay đổi thanh bên. Kiểm tra trình duyệt: **Chờ người dùng xác nhận** (trang yêu cầu phiên ADMIN).

## 2026-11-12 — Module 10A: API Admin và hủy sự cố
- Thêm API Admin liệt kê booking có lọc/truy vấn/phân trang, dashboard 4 chỉ số theo today/7d/30d và hủy sự cố.
- Bảo vệ mọi route Admin bằng `requireAuth` rồi `requireAdmin`; user thường nhận `403`.
- Hủy `CONFIRMED` kể cả đang diễn ra hoàn tiền 100%, nhả slot và gửi thông báo hủy/hoàn trong cùng transaction; hủy `PENDING` hoàn 0 và chỉ tạo thông báo hủy. Lệnh hủy user và test hiện có giữ nguyên.
- Thêm integration tests có tự dọn dữ liệu trên `sportbooking_test`. `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 71/71 đạt hai lượt liên tiếp; fail 0.
- Cụm 10B (giao diện) chưa triển khai.

## 2026-11-12 — Chỉnh giao diện thông báo và popup chuông
- Dùng chung kiểu hiển thị theo loại thông báo cho trang và popup, gồm màu tương phản, icon SVG, nhãn chữ và trạng thái chưa đọc.
- Sắp thẻ thông báo thành ba vùng; bỏ nút đọc riêng từng thẻ, cập nhật số chưa đọc ở chuông/tiêu đề/tab tại chỗ; hỗ trợ nút xem đơn, vé và chi tiết đơn hủy.
- Khử tên cơ sở/sân bị lặp trong tiêu đề và nội dung. Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-12 — Phân bổ thông báo và thanh giữ chỗ dùng chung
- Gom việc tạo notification vào event module dùng connection transaction; phân bổ thanh toán thành công/hủy đơn/hoàn tiền theo BOOKING_HOLD và PAYMENT, không ghi thông báo cho hủy PENDING hay thanh toán thất bại. Hủy sự cố có helper chưa gắn API; không thêm migration/schema.
- Bộ lọc trang thông báo theo category; thông báo mới nhất dùng `created_at DESC, id DESC`.
- Dựng thanh giữ chỗ từ hàm render header dùng chung, hiện trên mọi trang đăng nhập có header trừ `/thanh-toan.html`, `/dang-nhap.html`, `/dang-ky.html`; đồng bộ qua event, pageshow, visibilitychange và polling 5 giây khi tab hiển thị.
- Tìm sân hiển thị điểm sao tối đa một chữ số và giờ mở cửa không có giây; 24 giờ ghi “Mở cửa 24/24”.
- Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-11 — Module 8: Thông báo trong app
- Thêm migration 007 và API danh sách, unread-count, đánh dấu đọc/đọc tất cả; truy vấn giới hạn theo user, trả `Cache-Control: no-store`.
- Ghi thông báo thanh toán thành công, hết hạn giữ chỗ, hủy đơn có/không hoàn và hủy giữ chỗ trong transaction nghiệp vụ; tác vụ hết hạn chạy lặp không tạo trùng.
- Nối chuông dùng SVG cục bộ, huy hiệu `9+`, popup 5 thông báo và polling 5 giây khi tab hiển thị; thêm trang thông báo theo API, bộ lọc, trạng thái và phân trang.
- Migration đã áp dụng/xác minh trên `sportbooking_test`; frontend tests 111/111; `npm test` trên `sportbooking_test`: 59/59 hai lượt; `node --check`: đạt. Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-12 — Sửa cập nhật thẻ sau khi hủy
- Sau POST hủy, lấy lại chi tiết đơn từ server, dựng lại và thay riêng thẻ bằng renderer lịch sử hiện có; tải summary mới cho ba số liệu và số đếm các tab.
- Bỏ lời nhắn khỏi nội dung thẻ; thông báo hủy hiển thị trong banner `role="status"` độc lập, có nút đóng và tự ẩn sau 6 giây. Thẻ đã hủy chỉ hiển thị chi tiết và số tiền hoàn nếu có.
- Kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-11 — Cập nhật giao diện lịch sử và hủy đơn
- Chẩn đoán slot: transaction đã giải phóng đủ trạng thái, API lịch lấy trạng thái từ `time_slots`; GET lịch chưa bỏ qua cache và frontend chưa đặt `cache: no-store`. Đã thêm bypass cache phía frontend; test HTTP create → thanh toán SUCCESS → hủy → GET slot AVAILABLE → đặt lại thành công.
- Chuyển 7 icon ligature trên thẻ đơn sang SVG nội tuyến; bổ sung nút Hủy nhanh dùng popup chung, chỉ hiện với đơn server cho phép hủy và tự xuống dòng trên màn hẹp.
- Popup hủy dùng `seconds_until_start`/`server_time` từ preview; đồng hồ lệch giờ máy theo server, tiến trình 3 mức, cập nhật preview qua mốc, khóa xác nhận khi trận bắt đầu. Nhãn tiền hoàn, hotline và thời lượng được điều chỉnh theo dữ liệu.
- Frontend tests: 99/99; `node --check`: đạt; `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 52/52 hai lượt. Kiểm tra bằng trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-11 — Lịch sử đặt sân: sửa bố cục thẻ, khóa ảnh và giới hạn địa chỉ; frontend 93/93, backend 52/52, node --check đạt. Trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-12 — SVG và nội dung QR vé
- Thay icon ligature bằng SVG nội tuyến; trang hoàn tất hiển thị QR vé duy nhất cho đơn `CONFIRMED`, cùng payload văn bản với trang vé điện tử.
- Điều chỉnh hàng nút trang hoàn tất và bỏ nút quay lại đầu trang vé; kiểm tra trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-11 — Module 6: Hủy và hoàn tiền
- Mở rộng hủy PENDING/CONFIRMED trong một transaction, lưu người/lý do hủy, giải phóng slot, xóa `match_preference`; hoàn 100%/50%/0% số đã trả theo giờ UTC+7, làm tròn phần 50% xuống.
- Thêm API `GET /api/v1/bookings/:id/refund-preview` chỉ cho chủ đơn và `Cache-Control: no-store`; giữ tác vụ COMPLETED idempotent mỗi phút.
- Bật popup xác nhận theo preview server ở lịch sử/chi tiết; sau hủy tải lại dữ liệu và hiển thị khoản hoàn.
- Thêm migration 006; đã áp dụng và xác minh chỉ trên `sportbooking_test`. Frontend tests: từng file đạt; `npm test` trên `sportbooking_test`: 52/52 hai lượt; `node --check`: đạt. Kiểm tra giao diện bằng trình duyệt: **Chờ người dùng xác nhận**.

## 2026-11-11 — Vé điện tử
- Thêm vé QR dữ liệu thật, điều hướng `buildTicketUrl` và trang hoàn tất không vẽ QR; kiểm tra trình duyệt: **Chờ người dùng xác nhận**.
# 2026-11-09 — Module 7: Tóm tắt và lọc lịch sử đặt sân

- Thêm API chỉ đọc `/api/v1/bookings/summary` với số liệu và tổng thanh toán ròng chỉ thuộc user hiện tại; danh sách hỗ trợ tìm kiếm và lọc môn.
- Bổ sung các trường chỉ đọc cho API danh sách/chi tiết và định dạng mã mới `SPB-YYYYMMDD-xxxxxx` theo UTC+7; không đổi mã đơn hiện tại hay luồng đặt/giữ chỗ/thanh toán.
- Nối số liệu, tabs, tìm kiếm, lọc môn và thông tin đặt/chi tiết vào frontend; thêm điều hướng quay lại an toàn.
- Frontend tests: 67/67; `npm test` với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 43/43; `node --check`: đạt. Kiểm tra trình duyệt: Chờ người dùng xác nhận.

# 2026-11-09 - Shared booking stepper

- Extracted the three-step booking progress UI into a shared component used by booking, payment, and ticket pages; step 1 is reachable from payment only while its hold remains active.
- Added step-state tests; frontend tests: 26/26. Visual browser confirmation: waiting for user confirmation.

# 2026-11-09 - Payment page follows booking step 2

- Rebuilt `thanh-toan.html` from the payment/hold section of the approved booking mockup; removed the normal-flow result buttons and static sample amounts.
- Payment confirmation now sends `SUCCESS`; the failure link is available only with `?demo=1`. Local transfer QR encodes `SPORTBOOKING|<booking_code>|<amount_due>` and is explicitly not VietQR.
- Creating a hold now navigates directly to payment. The shared pending banner is hidden on booking and payment pages; empty/expired holds no longer show an active-hold timer.
- `node --check` changed frontend JavaScript passed; frontend tests: 13/13; `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 34/34.
- Browser smoke test: waiting for user confirmation.

# 2026-11-09 - Shared pending-hold banner and encoding guard

- Added a shared pending-hold banner with server-based countdown, continue-payment and cancel actions; hidden on the payment page.
- Extended `GET /api/v1/bookings/pending` with `id`, facility/court, date, time ranges and remaining seconds.
- Restored the pending-booking Vietnamese message and added a UTF-8/no-BOM source scan.
- `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 34/34 passed.

# 2026-11-09 - Existing pending booking handling

- Added pending booking details to the 409 response and an authenticated `GET /api/v1/bookings/pending` endpoint.
- Expired PENDING bookings are marked EXPIRED and their locked slots released in the same transaction that attempts the next booking.
- Added continue/cancel actions and a remaining-time display on the booking page; cancellation retries the requested booking.
- `npm test` with `APP_ENV=test`, `DB_NAME=sportbooking_test`: 33/33 passed.

# 2026-11-09 ? Payment and ticket UI

- Added payment and QR ticket pages based on the existing mockups, wired to the booking/payment APIs, and enabled the booking-page CTA.
- Ticket QR is generated locally from the booking code; no external QR service is used.
- JavaScript syntax checks and local QR SVG generation passed. Browser smoke testing was not run; backend 33/33 result is user-reported.

# 2026-11-09 — Thanh toán giả lập và vé QR (FR-07)

- Thêm migration 005 cho `payment_attempts` và `booking_tickets`, cùng kiểm tra trạng thái migration trong runner.
- Thêm API tạo payment attempt giả lập và đọc payment history/ticket; SUCCESS cập nhật payment, booking, slots và tạo vé trong một transaction; FAILURE giữ booking chờ thanh toán.
- Thêm test tích hợp cho SUCCESS, FAILURE/retry, hết hạn, quyền sở hữu, thanh toán lặp cạnh tranh, expiry job và quyền Admin đọc payments.
- Chưa đánh dấu hoàn tất: migration chưa áp dụng/xác minh được vì MariaDB localhost:3306 không hoạt động; `npm test` bị sandbox chặn tiến trình con (`spawn EPERM`). Syntax check đạt và test unit slot-generator chạy trực tiếp đạt 3/3. Không kết nối hay thay đổi `sportbooking_dev` hoặc `sportbooking_system`.

# 2026-11-08

## 2026-11-08 — Tự sinh khung giờ

- Tách logic sinh slot dùng chung cho seed và job nền; seed và server đọc SLOT_DAYS_AHEAD (mặc định 14, hợp lệ 1–60). Job chạy lúc khởi động và mỗi giờ ở development, chỉ chèn slot thiếu cho sân/cơ sở đang hoạt động; test mặc định tắt.
- Kiểm thử tích hợp trên sportbooking_test: slot còn thiếu, chạy lặp, bảo toàn LOCKED/BOOKED, bỏ sân tắt, 24:00 và qua tháng.
- `node --check` các JavaScript liên quan đạt; `npm test` với APP_ENV=test, DB_NAME=sportbooking_test đạt 26/26.
- Nạp dotenv rõ ràng tại entrypoint, log cấu hình và kết quả từng lượt; startup trên sportbooking_dev đã bù 914 slot tới 2026-11-23. Thêm test log thành công/lỗi; `npm test` đạt 27/27.

## Tài liệu
- Chốt business-flow, spec, plan-auth, plan-seed-data, roadmap.
- Cập nhật số liệu khảo sát thành cầu lông 10, bóng đá mini 8, pickleball 11 (tổng 29, 6 quận).
- Thêm cột facilities.map_url, courts.initial_rating, survey_price_min/max; ánh xạ cột Excel và danh sách lỗi dữ liệu cần chuẩn hóa.
- API xem sân yêu cầu đăng nhập; công thức hạn chu kỳ tìm đối; ghi chú MariaDB 10.4 (XAMPP); quy ước tài khoản DB sportbooking_app, DB_NAME dev/test.

## Backend
- Khởi tạo backend: package.json (express, mysql2, dotenv, bcrypt), .env.example, .gitignore.
- src/config/database.js: guard từ chối root, sportbooking_system, DB test không kết thúc bằng _test.
- Migration 001 tạo users và user_sessions (infra/database/migrations).
- user.repository.js, session.repository.js: truy vấn tham số hóa, token phiên chỉ lưu hash.
- password.helper.js (bcrypt), auth.service.js: đăng ký, đăng nhập, khóa 15 phút sau 5 lần sai (khóa admin tách riêng).
- infra/database/seed-admin.js: chạy lặp không ghi đè admin, dùng ADMIN_PASSWORD_HASH.

## Kiểm thử
- backend/tests/auth-step5.test.js: 7 test đạt (bcrypt, đăng ký, trùng email/SĐT, khóa 5 lần sai, seed admin).

## Hạ tầng
- Tạo sportbooking_dev, sportbooking_test, tài khoản sportbooking_app chỉ có quyền trên hai database này; chạy migration 001 vào sportbooking_test.

# 2026-11-08 — Kiểm thử tích hợp xác thực (bước 9)

- Bổ sung test tích hợp HTTP trên `sportbooking_test`, có guard bắt buộc `APP_ENV=test` và `DB_NAME=sportbooking_test`; kiểm thử đăng ký, đăng nhập, khóa sau 5 lần sai, cookie/phiên, hồ sơ, đổi mật khẩu và giới hạn quyền.
- **Xong:** `npm test` chạy với cấu hình test, 9/9 test đạt; dữ liệu test được dọn sau khi chạy.
- Sửa binding tham số cho các trường hồ sơ không được gửi để PATCH một phần hoạt động đúng với MySQL.

# 2026-11-08 — Frontend xác thực và hồ sơ (bước 10–11)

- Bổ sung ba trang HTML đăng nhập, đăng ký và hồ sơ; dùng CSS/JS chung, Be Vietnam Pro, design tokens, trạng thái loading/lỗi, hiển thị lỗi cạnh trường, responsive và `prefers-reduced-motion`.
- Kết nối đúng các route auth/profile hiện có bằng `fetch` cùng origin và cookie phiên; không lưu mật khẩu/token trong Web Storage. Thêm `express.static` để phục vụ `frontend/` trong cùng origin.
- **Xong bước 10:** kiểm tra cú pháp JavaScript; 8/8 test auth không cần DB đạt; Express mock phục vụ đủ ba trang và hai asset; browser xác nhận xử lý 401, layout viewport 390px và điều hướng hết phiên về login kèm `returnTo`.
- **Chờ người dùng xác nhận:** smoke test thủ công bước 11 với database/cấu hình chạy thực tế (đăng ký, admin, khóa sau 5 lần sai, hồ sơ, đổi mật khẩu, đăng xuất).
- `npm test` chạy 8 test đạt; test tích hợp dừng ở guard do môi trường hiện tại không đặt `APP_ENV=test` và `DB_NAME=sportbooking_test`, trước khi kết nối database.

# 2026-11-08 — Giao diện auth theo mockup đã deploy

- Tạo `frontend/dang-nhap.html` và `frontend/dang-ky.html` từ markup mockup; giữ class và Tailwind CDN, bỏ script đăng nhập/đăng ký cũ, dùng `/shared/app.js` và API `/api/v1/auth/*`.
- Đăng nhập chỉ nhận email; đăng ký nhúng Điều khoản sử dụng và Chính sách bảo mật, chỉ bật ô đồng ý sau khi mở và cuộn đến cuối cả hai văn bản.
- Dùng ảnh login có sẵn tại `frontend/assets/images/sportbooking-login-courts.jpg` (đã đối chiếu trùng nguồn mockup); đổi `GET /` sang `/dang-nhap.html` và đồng bộ URL trong spec.
- Kiểm tra redirect và tài nguyên static bằng HTTP; browser xác nhận form gửi đúng payload (API được mock), email type/placeholder, legal-read gate, và không tràn ngang ở viewport 390px.
- `node --test tests/auth-step5.test.js tests/auth-step6-8.test.js`: 8/8 đạt. `npm test`: 8 test đạt; test tích hợp dừng ở guard do môi trường hiện tại không đặt `APP_ENV=test` và `DB_NAME=sportbooking_test`, trước khi kết nối database.

# 2026-11-08 — Trang chủ user và tìm sân

- Tạo `frontend/trangchu-user.html` và `frontend/tim-san.html` từ markup mockup; giữ Tailwind CDN và bố cục, loại bỏ script/dữ liệu sân, giá, thông báo, kèo và số liệu giả.
- Nối trang chủ và tìm sân tới `GET /api/v1/facilities` qua `frontend/shared/facilities-api.js`, dùng đúng query/response fields, `credentials: 'same-origin'`, textContent, loading/error/retry/empty states và chuyển 401 tới login.
- Tìm sân hỗ trợ môn, quận, từ khóa và phân trang; ngày/khung giờ/tiện ích để disabled do API không hỗ trợ. Đăng nhập thành công chuyển tới `/trangchu-user.html`.
- Kiểm tra JS syntax và 14 test auth/facility seed đạt. Browser với API giả xác nhận render sân, query filter/pagination, redirect 401 và redirect login thành công.
- Máy chủ đang chạy tại `http://localhost:3000` phục vụ trang nhưng `GET /api/v1/facilities` trả 404; chưa xác nhận dữ liệu thật qua runtime này. Không sửa backend/API.

# 2026-11-08 — Module 3 frontend: Chi tiết sân và lưới khung giờ

- Tạo `frontend/chi-tiet-san.html` từ mockup chi tiết sân; bỏ JavaScript cũ và dữ liệu sân/đánh giá/bản đồ/giá giả. Ảnh mặc định là hình minh họa theo môn; ảnh, chính sách, tiện ích, bản đồ và giá lấy từ response API.
- Nối trang với `GET /api/v1/facilities/:id` và `GET /api/v1/courts/:id/time-slots?date=...`; giữ `id`, `date`, sân con và URL tìm kiếm trên query string. Thẻ sân trên trang chủ/tìm sân mở chi tiết đúng facility ID.
- Lưới hiển thị toàn bộ slot API trả về, dùng `is_selectable`/trạng thái server, nhãn giờ vàng, tổng giờ/giá tạm tính; chọn liền kề và CTA không gọi API ghi.
- **Xong:** `node --check` các JavaScript thay đổi; test lựa chọn slot liền kề/không liền kề/bỏ đầu-giữa-cuối đạt 4/4; `npm test` backend với `APP_ENV=test`, `DB_NAME=sportbooking_test` đạt 16/16.
- **Chờ người dùng xác nhận:** smoke test thực tế tại `http://localhost:3000/`; API facilities của runtime hiện tại trả 404. Không chạy migration/seed; không sửa backend, API, `sportbooking_system` hoặc mockup.

# 2026-11-08 — Module 4: API giữ chỗ và frontend xác nhận

- Thêm API tạo/đọc/hủy booking với transaction, khóa dòng user/slot, snapshot giá và job giải phóng booking hết hạn; thêm integration tests cho hold, xung đột, concurrency, hủy và expiry.
- Nối lựa chọn slot liền kề sang `/dat-san.html`; trang xác nhận hiển thị thông tin server, gọi API khi xác nhận, đồng bộ booking khi tải lại, đếm ngược và hỗ trợ hủy.
- Browser smoke test với API giả xác nhận hiển thị tổng tiền, tạo hold và đồng hồ `10:00`, hủy giữ chỗ, tải lại đơn còn hạn, chuyển login với 401 và thông báo 409.
- `npm test` chạy với `APP_ENV=test`, `DB_NAME=sportbooking_test`: 14/17 đạt; 3 integration test không thể kết nối do `sportbooking_app` bị từ chối quyền vào `sportbooking_test`. Chưa chạy GRANT vì môi trường hiện không có kết nối quản trị DB được cấu hình.
- **Chờ xác nhận:** cấp quyền DB test bằng tài khoản quản trị cục bộ rồi chạy lại `npm test` để xác nhận integration thật; không sử dụng `sportbooking_system` và không sửa mockups.
## 2026-11-13 — Module 10, GĐ0–2: nền tảng, tổng quan và người dùng
- Thêm migration 008 `admin_audit_logs` và runner idempotent; áp dụng/xác minh chỉ trên `sportbooking_test`. Hủy sự cố và khóa/mở khóa user ghi audit cùng transaction.
- GET admin bookings/dashboard/users hỗ trợ weak ETag, `If-None-Match`/304, `Cache-Control: no-cache`, `server_time`; dashboard có range UTC+7, KPIs, chart data, top sân và đơn gần nhất.
- Thêm trang tổng quan và người dùng, admin shell dùng chung, polling 5 giây có xử lý tab ẩn, abort và backoff; ADMIN đăng nhập vào dashboard.
- User API loại trường nhạy cảm; khóa thu hồi mọi phiên, không hủy booking, chống tự khóa và thao tác trùng đồng thời. HTTP tests kiểm tra khóa/đăng nhập/mở khóa/audit.
- Kiểm tra: admin HTTP integration 11/11; service 1/1; frontend admin/navigation 42/42; syntax và `git diff --check` đạt. Toàn bộ suite chưa chạy; kiểm tra bằng trình duyệt: **Chờ người dùng xác nhận**.
- GĐ5–6 chưa làm; dashboard/users/facilities/slots dùng layout theo design system, chưa chép nguyên markup mockup.

## 2026-11-13 — Module 10, GĐ3: quản lý cơ sở và sân
- Thêm API Admin danh sách/chi tiết/tạo/sửa cơ sở và sân; lọc, phân trang, weak ETag/304, kiểm tra đầu vào, `expected_updated_at`, tên sân duy nhất trong cơ sở và chặn ngừng hoạt động/đổi môn khi còn đơn hiệu lực.
- Mọi thay đổi cơ sở/sân ghi audit trong transaction; cập nhật dùng khóa theo thứ tự cơ sở rồi sân, `is_seed=false`, không xóa dữ liệu vật lý.
- Thêm trang `quan-tri-san.html` theo bộ khung Admin dùng chung, bộ lọc, form cơ sở, danh sách/form sân và xác nhận ngừng hoạt động; không hỗ trợ xóa hay xuất báo cáo.
- HTTP integration Admin GĐ0–3 đạt; kiểm tra trực quan bằng trình duyệt: **Chờ người dùng xác nhận**. GĐ4–6 còn lại.

## 2026-11-13 — Module 10, GĐ4: khung giờ và giá
- Thêm API Admin xem khung theo ngày, xem trước số khung trống, sinh khung tối đa 31 ngày bằng slot generator dùng chung, và cập nhật giá cho các khung `AVAILABLE` từ ngày Việt Nam hiện tại.
- Khung `LOCKED`/`BOOKED` và `booking_slots.price_at_booking` không bị đổi; sinh khung lặp lại chỉ báo số đã có. Mọi lần sinh/cập nhật giá ghi audit cùng transaction; GET khung hỗ trợ weak ETag/304.
- Thêm trang `quan-tri-khung-gio-gia.html` với chọn cơ sở/sân/ngày, trạng thái bằng chữ, xem trước giá và tạo khoảng ngày; polling qua admin shell.
- HTTP integration GĐ0–4 đạt; kiểm tra trình duyệt: **Chờ người dùng xác nhận**. GĐ5–6 còn lại.
