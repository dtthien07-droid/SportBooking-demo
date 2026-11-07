Phiếu yêu cầu tính năng
Hãy mô tả theo cách bạn hiểu, giống như đang kể cho đồng nghiệp. Nếu chưa biết câu trả lời, ghi Chưa rõ.
1. Tên tính năng / việc cần làm:
Tính năng đăng nhập/ đăng ký 
Hồ sơ cá nhân
Quản lý sân, khung giờ, giá
Tìm kiếm và xem chi tiết sân
Đặt sân (lock TimeSlot)
Thanh toán giả lập
Hủy và hoàn tiền giả lập
Lịch sử đặt sân
Quản lý người dùng
Xử lý booking ngoại lệ
Tự động hủy booking quá hạn
Tìm đối ngẫu nhiên
Tìm đối theo tiêu chí
Hết hạn và nới lỏng tiêu chí
Cập nhật realtime 
Thông báo trong app và email
Đánh giá sân
Dashboard hệ thống 
Phân quyền admin & user
2. Vì sao cần tính năng này? (Vấn đề đang gặp)
Vấn đề đang gặp: các tính năng chuyển tiếp chưa được mượt mà; chưa được đồng bộ giữa các tính năng ví dụ tính năng đặt sân sẽ giữ chỗ 10p để user có thể thanh toán tuy nhiên phần lịch sân vẫn hiện trống và user khác có thể vào đặt sânm
3. Ai sẽ sử dụng tính năng này?
Vai trò người dùng: user 
Vai trò quản trị viên: admin 
4. Khi nào tính năng bắt đầu?
Người dùng thao tác ở màn hình nào, nhấn nút gì hoặc hệ thống tự động thực hiện khi nào?
Nếu người dùng ấn quên mật khẩu phải hiển thị ra trang tiếp để người dùng có thể lấy lại mật khẩu
Khi người dùng ấn vào link web cần hiển thị trang đăng nhập; user chưa có tài khoản phải vào trang đăng ký để đăng ký tài khoản sau đó đăng ký tài khoản thành công thì hệ thống tự động quay lại phần đăng nhập tài khoản để nhập tài khoản vào trang chủ  còn đối với user sẽ cấp tài khoản mặc định  để truy cập vào trang của admin. Ở màn hình của user sẽ có các tính năng: trang chủ, tìm sân, lịch sử đặt sân, tin tức thể thao, thông báo và hồ sơ cá nhân . Ở màn hình của admin có các tính năng dashoard thống kê; quản lý người dùng, quản lý sân khung giờ và giá, Xử lý booking ngoại lệ. Với trang chủ,  hiện thị các thông tin chung của hệ thống sportbooking, có lựa chọn hàng đầu hiện thị các sân thể thao được đánh giá cáo 5 sao user có thể xem chi tiết sân hoặc click đặt sân ghép đối ngay lập tức.Nếu user click vào tên sân sẽ hiển thị toàn bộ thông tin sân ( thông tin cơ bản - địa chỉ chi tiết - giừo đóng mở cưa- hotline liên hệ và có bẩng giá - các tiện ích sân bãi - chính sách huỷ sân và nội quy có map và đánh giá ) có 1 nút xác nhận chọn sân -> user click vào phần xác nhận đặt sân thì chuyển sang phần chọn khung giờ -> user có thể chọn những khung giờ trống -> sau khi chọn đc khung giờ trống sẽ click tiếp tục đặt thì sẽ chyển tới trang xác nhận thông tin bao gồm sân, khung giờ, thông tin cá nhân, và có thể click bật tìm đối hay không ( nếu bật tìm đối có thể chọn tìm đối ngẫu nhiên hay tìm đối theo tiêu chí - sẽ đc chọn giới tính trình đôj thể thức thi đấu đánh đơn hay đánh đôi kèm lời nhắn ) có phần tóm tắt chi phí user có thể chọn thanh toán 1 phần hay toàn phần sau khi hoàn tất các thông tin đó sẽ chuyển đến bước thanh toán ở bước thanh toán này sẽ chọn phương thức thanh toán( Chuyển khoản nhanh - tất cả ngân hàng đều dùng đc, ví momo, thẻ atm nội địa, thẻ quốc tế,...) và cũng có cột thông tin sân và tổng số tiền với hình thức user đã chọn sau đó user sẽ bấm xác nhận thì sẽ chuyển tới trang đátan thành công gồm có các thông tin như mã đặt sân; có khung vé điện tử thể thao có cả vé điện tử qr code có phần thông tin sân kèn theo như hotline ; map;.... và TH nếu user có bật tìm đối thì phải hiển thị radar tìm đối quét đối trong 10p hdest 10p hệ thống phải tự động gửi thông báo cho user để user quyết định nới lỏng tiêu chí hay là dừng tìm đối; và hệ thống phải tính giừ 10p từ lúc xác nhận thông tin đến trước khi thanh toán xong có nghĩa là ví dụ 1 user đặt sân nhg chưa thanh toán thì phải giữ sân đó cho họ 10p; trong 10p đó họ có thể thoát ra hoặc vào lại để tiếp tục nốt thủ tục đặt sân; và trong 10p đó bảng hệ thống khung giờ của sân phải đươc tạm khoá giữ chỗ nếu sau 10p user đó k hoàn tất thủ tục đặt sân thì ngay lập tức sân đó phải trả về trống để user khác có thể đặt sân được. Sau khi đặt sân thành công user có thể xem được chi tiết đặt sân và lịch sử đặt sân. Với phần chi tiết đăt sân sẽ có các thông tin về sân; ngày giờ sân đã đặt số tiền đã thanh toán, có map ; các thông tin cơ bản của sân và nếu user đó có tìm đối thì phải có thông tin là tìm đối đc hay k;tìm đc thì thông tin người đó ntn tên gì; nam hay nữ trình độ ntn có lời nhắn gì hay không và phần đơn đặt sân đó pải có mã khác nhau cho mỗi đơn không được trùng mã đơn đặt sân; không được trùng mã vé đặt sân điện tử của mỗi người. Và trang đó cũng có phần huỷ đặt sân nếu user bấm huỷ đặt sân sẽ hiển thị popup xác nhận huỷ gồm thông tin sân bị huỷ; lý do huỷ và số tiền được hoàn trả nếu huỷ trước 24h đc hoàn trả 100% từ 6-trước 24h hoàn 50% dưới 6h k hoàn. Chi tiết sân phải luôn cập nhật: Đã huỷ đơn/ Hoàn Thành / Đã xác nhận. Với trang lịch sử đặt sân phải  gồm lịch đặt sân sắp tới; tổng số tiền với các đơn đặt sân đã hoàn thành…; nó như 1 bản dashboard thống kê đặt sân của khách hàng; có các sân đã đặt các sân đã huỷ; với sân chưa huỷ thì có thể huỷ nhanh ở phần lịch sử đặt sân cũng hiện ra popup xác nhận huỷ như vậy; Nó phả cập nhật theo thời gian thực và hiện thị Sắp tới/ Đang trong trận đấu/ Hoàn thành  . Với những đơn đang trong trận đấu/ hoàn thành thì k đucowj huỷ sân nữa. Phải có ký hiệu/ đánh dấu để phân biệt với sân huỷ và k. Với những sân đã hoàn thành thì có thể viết review đánh giá và có thể đặt lại sân; xem lại chi tiết đơn.Với phần tin tức thể thao phải được lấy từ những tin tức thừ trang tin tức chính thống; uy tín. Ngoài ra với trang tìm sân thì sẽ hiện thị tổng 29 sân và có thể tuỳ chỉnh bộ lọc để chọn sân bọ lọc ( giừo; khu vực, bộ môn) sau đó tìm sân và user click vào chi tiết sân hay sân thì như luồng ở trên.Ngoài ra t còn muốn ở phần chọn khung giờ đặt sân ví dụ có 1 user đang tìm đối thì phần khung giờ phải hiện thị chữ xin ghép để người khác có thể ghép sân) và luôn cập nhật theo thời gian thực và tài khoản khác cũng phải ấn vào được chữ xin ghép đó để ghép chơi cùng nhau. Phần khung giờ ví dụ giờ đặt sân đã qua so với giờ hiện tại thực tế thì phải khoá giờ đã qua lại. Phần thông báo phải đuọcw cập nhật và thông báo những gì mà user đã thay đổi ví dụ huỷ/đặt sân. Và phần hiện thị đó dạng popup xem nhanh thười gian đếm ngược so với thực tế ví dụ 1 phút trước 2 phút trước… nếu user bấm xem toàn bộ thì phải chuyển tới trang thông báo gồm tất cact các thông báo có thể đánh dấu đã đọc hoặc xem chi tiết thông báo có cả phần phân loại thông báo- Tất cả thông báo; Lịch đặt sân & Giữ chỗ; Tìm đối & Ghép kèo;Thanh toán & Hoàn cọc; Khuyến mãi & Hệ thống…. và có thể xem được chi tiết thông báo đó; ngoài ra có hồ sơ cá nhân khi user click vào phần tên cá nhân hồ sơ này gồm các thông tin của khách hàng; có thể đổi đc mk tài khoản; đổi và cập nhật được các thông tin tài khoản nữa; có thể đăng xuất tài khoản.
Với tài khoản admin sẽ dùng 1 tài khoản mặc định để vào được hệ thống. Admin sẽ xem được dashboard tổng quan gồm doanh thu, xem được các báo cáo biểu đồ về sân bãi, có bao nhiêu đơn đặt trong hôm nay; trong tuần/ tháng / năm này,..., có thể xuất được bản excel báo cáo; xem được biểu đồ khi di chuột qua; xem đucowj báo cáo trong hôm nay; 7 ngày/ 30 ngày,... tuỳ vào việc admin chọn xem bao nhiêu lâu. Có phần cảnh báo việc cần xử lý ví dụ với các trường hợp ngoại lệ do cháy hoặc bão mà khách yêu cầu huỷ thì phải xác nhận; xem huỷ cho khách bao nhiêu tiền,... Có trang quản lý sân; sẽ thêm sửa  xoá sân; khung giờ; giá…Có trang danh sách đặt sân cập nhất hết đơn đặt sân, các áo cáo của các đơn đặt sân,...Và quản lý người dùng admin sẽ xem đc các sẽ biết được người ta đặt bnhieu nhiêu lượt có bùng cọc không tỷ lẹ hoàn thành là bnhieu,...( Hiện tại phần admin t mới nghĩ ra được các hướng thao tác thông tin vậy có gì sẽ sửa đôi bổ sung sau) 
5. Các bước xử lý bạn mong muốn
T muốn các thao tác phải trơn chu mượt mã chuyển tiếp giữa các trang 
6. Kết quả mong muốn khi hoàn thành
Có chuyển tiếp mượt mà, luôn cập nhật chính xác thông tin giữa các trang, thông tin giữa các trang phải được đồng bộ không được lệch hay sai, khi chuyển tiếp giữa các trang phải có nút bấm quay lại trang trước tất cả mọi trang đều có thể truy cập được với nhau.
7. Các quy tắc / điều kiện cần tuân thủ
Ví dụ: quyền sử dụng, giới hạn số lượng, thời hạn, điều kiện xác nhận...
User chỉ được dùng cá tính năng của user không đc phép truy cập xem các tính năng của admin
Hệ thống khi đăng nhập của amin phải luôn được cập nhật theo thực ví dụ user đặt sân thì trong báo cáo của admin phải có được thông tin đặt sân đó hệ thông phải tự động cập nhật 
8. Các trường hợp đặc biệt hoặc lỗi có thể xảy ra
1. Nhập sai thông tin: User nhập thiếu thông tin, sai định dạng số điện thoại, email hoặc mật khẩu khi đăng ký, đăng nhập.
2. Tài khoản đã tồn tại: Email hoặc số điện thoại đã được sử dụng để đăng ký trước đó.
3. Không đủ quyền truy cập: User cố truy cập vào trang quản trị hoặc thực hiện chức năng chỉ dành cho Admin.
4. Sân đã được đặt: Hai User cùng chọn một sân trong cùng khung giờ, hệ thống cần kiểm tra và ngăn việc đặt trùng lịch.
5. Giữ chỗ hết thời gian: User chọn sân nhưng không hoàn tất thanh toán trong thời gian quy định, hệ thống tự động giải phóng khung giờ.
6. Thanh toán thất bại: Giao dịch không thành công, bị gián đoạn hoặc chưa nhận được xác nhận thanh toán.
7. Hủy đặt sân không hợp lệ: User yêu cầu hủy đơn đã hoàn thành, đã bị hủy hoặc không đáp ứng điều kiện hủy.
8. Mất kết nối: Website mất kết nối Internet hoặc máy chủ gặp sự cố trong quá trình đặt sân, thanh toán.
9. Dữ liệu không đồng bộ: Trạng thái sân trên giao diện chưa cập nhật kịp thời so với dữ liệu thực tế trong hệ thống.
10. Lỗi tải hình ảnh hoặc dữ liệu: Không hiển thị được danh sách sân, hình ảnh, lịch đặt hoặc thông tin người dùng.
11. Lỗi tìm đối chơi: Bài đăng tìm đối đã hết hạn, bị hủy hoặc không còn khả dụng nhưng User vẫn truy cập.
12. Lỗi phân quyền Admin: Admin thực hiện thao tác quản lý nhưng dữ liệu không được lưu hoặc cập nhật thành công.
9. Ai cần được thông báo?
Người nhận:
User (Khách hàng): Khi đặt sân thành công, thanh toán thành công, đặt sân bị hủy, thay đổi lịch đặt hoặc có thông tin hoàn tiền.
Admin (Quản trị viên): Khi có đơn đặt sân mới, khách hàng hủy sân, thanh toán phát sinh hoặc có vấn đề cần quản lý.

Hình thức thông báo:Thông báo trực tiếp trên website (Notification)./ Email (có thể phát triển thêm, chưa bắt buộc trong phiên bản hiện tại).
Thời điểm thông báo:
Ngay sau khi đặt sân thành công.
Ngay khi thanh toán được xác nhận.
Khi khách hàng hủy hoặc thay đổi lịch đặt.
Khi sân có sự cố hoặc không thể phục vụ lịch đã đặt.

10. Thông tin cần lưu trữ hoặc hiển thị
Thông tin thông báo: Mã thông báo, tiêu đề, nội dung và loại thông báo.
Người nhận: ID người dùng nhận thông báo (User hoặc Admin).
Thông tin liên quan: Mã đơn đặt sân, tên sân, ngày đặt và khung giờ đặt (nếu có).
Thời gian: Thời điểm tạo và gửi thông báo.
Trạng thái thông báo: Đã đọc hoặc chưa đọc.
Hình thức thông báo: Thông báo trên website hoặc email (nếu triển khai).

11. Ví dụ thực tế
Đưa ra 1–2 tình huống cụ thể để minh họa cách tính năng hoạt động.
...
12. Mức độ ưu tiên
Gấp
Lý do: Đây là chức năng hỗ trợ người dùng theo dõi trạng thái đặt sân, thanh toán và các thay đổi liên quan. Thông báo kịp thời giúp khách hàng và admin tránh bỏ lỡ thông tin quan trọng.
13. Những điểm bạn còn phân vân hoặc chưa xác định
—----------------
Bảng

Nhóm
Mã
Yêu cầu
Tiêu chí cụ thể 
Hiệu năng 
NFR01
Thời gian phản hồi 
Các thao tác thông thường mất không quá 2 giây; tìm sân không quá 3 giây
Bảo mật
NFR02
Mã hóa 
Mật khẩu được mã hóa, không ai đọc được; dữ liệu gửi đi qua kết nối an toàn (có biểu tượng ổ khóa)


NFR03
Phân quyền và phiên 
Người dùng và quản trị viên chỉ dùng được chức năng của mình; tự đăng xuất sau 8 giờ; nhập sai mật khẩu 5 lần thì tạm khóa tài khoản
Toàn vẹn dữ liệu
NFR06
Không đặt trùng sân
Một sân trong cùng một khung giờ chỉ có đúng 1 người đặt thành công; nếu có lỗi giữa chừng thì hủy toàn bộ thao tác, không để dữ liệu sai lệch
Khả năng sử dụng 
NFR07
Ngôn ngữ 
Giao diện hiển thị tiếng Việt đúng dấu




 
 UC-01: Đăng ký / đăng nhập


Mục
Nội dung ngắn gọn
Use Case Name
Đăng ký / đăng nhập
XRef
FR-01; API POST /api/auth/register, /api/auth/login
Trigger
Người dùng hoặc Admin bấm Đăng nhập (hoặc Đăng ký).
Precondition
Đang ở trang đăng nhập/đăng ký.
Basic Path
1. Nhập tài khoản và mật khẩu.

2. Hệ thống kiểm tra thông tin từ Database MySQL.

3. Tạo phiên đăng nhập và lưu vào trình duyệt.

4. Chuyển sang trang chủ (User) hoặc trang Admin.
Alternative Paths
Chưa có tài khoản: Điền form Đăng ký, đồng ý điều khoản rồi chuyển về đăng nhập.
Postcondition
Đăng nhập thành công (lưu phiên); Đăng ký thành công (thêm tài khoản vào Database).
Exception Paths
Sai tài khoản/mật khẩu hoặc Email/SĐT bị trùng: Hệ thống từ chối và báo lỗi.
Other
Chạy HTTPS an toàn trên máy chủ đám mây (Render).



UC-03: Hồ sơ cá nhân
Mục
Nội dung
Use Case Name
Hồ sơ cá nhân
XRef
FR-03; API GET, PUT /users/me
Trigger
User chọn Hồ sơ cá nhân.
Precondition
Đã đăng nhập.
Basic Path
1. Hệ thống hiển thị hồ sơ. 2. User sửa họ tên, SĐT, giới tính, trình độ. 3. User bấm Lưu. 4. Hệ thống kiểm tra và cập nhật.
Alternative Paths
Đổi mật khẩu: nhập mật khẩu cũ và mật khẩu mới (từ 8 ký tự).
Postcondition
Hồ sơ được cập nhật.
Exception Paths
SĐT sai định dạng hoặc đã có người dùng; mật khẩu cũ sai: từ chối.
Other
Giới tính và trình độ là dữ liệu đầu vào cho tìm đối (UC-14).



Nhóm Admin

UC-04: Quản lý sân, khung giờ, giá
Mục
Nội dung
Use Case Name
Quản lý sân, khung giờ, giá
XRef
FR-04; API /admin/facilities, /admin/fields, /admin/fields/{id}/slots
Trigger
Admin chọn thêm, sửa, xóa cơ sở hoặc sân, hoặc tạo khung giờ.
Precondition
Đã đăng nhập bằng tài khoản Admin.
Basic Path
1. Admin chọn cơ sở hoặc sân. 2. Admin nhập thông tin (địa chỉ, giờ mở cửa, SĐT, bản đồ, tiện ích, chính sách hủy, ảnh, giá thường, giá giờ vàng). 3. Admin chọn ngày tạo khung giờ. 4. Hệ thống tạo khung giờ 1 tiếng và gán giá.
Alternative Paths
Ngày đã có khung giờ: giữ nguyên, chỉ tạo phần còn thiếu.
Postcondition
Dữ liệu được lưu; khung giờ ở trạng thái AVAILABLE.
Exception Paths
Thiếu thông tin: 400. Xóa sân đang có đặt sân hiệu lực: từ chối. Không phải Admin: 403.
Other
Giờ vàng 17:00 đến 21:00; thêm cơ sở hoặc sân mới không cần sửa hệ thống.



UC-10: Quản lý người dùng
Mục
Nội dung
Use Case Name
Quản lý người dùng
XRef
FR-10; API GET /admin/users, PUT /admin/users/{id}/status
Trigger
Admin mở danh sách người dùng và chọn Khóa hoặc Mở khóa.
Precondition
Đã đăng nhập bằng tài khoản Admin.
Basic Path
1. Hệ thống hiển thị danh sách người dùng. 2. Admin chọn một tài khoản. 3. Admin chọn Khóa hoặc Mở khóa. 4. Hệ thống xác nhận lại rồi cập nhật.
Alternative Paths
Tìm tài khoản theo tên hoặc email.
Postcondition
Tài khoản LOCKED không đăng nhập được; mở khóa thì dùng lại bình thường.
Exception Paths
Admin tự khóa mình: từ chối. Không phải Admin: 403.
Other
Trạng thái khóa áp dụng trực tiếp lên tài khoản trong cơ sở dữ liệu cho đến khi có thao tác mở lại từ Admin. 


UC-11: Xử lý booking ngoại lệ
Mục
Nội dung
Use Case Name
Xử lý booking ngoại lệ
XRef
FR-11; API GET /adm
in/bookings, PUT /bookings/{id}/cancel
Trigger
Admin chọn xử lý một đơn trong Danh sách đặt sân.
Precondition
Là Admin; có đơn cần xử lý.
Basic Path
1. Admin xem mọi đơn, lọc theo trạng thái. 2. Admin chọn đơn cần xử lý. 3. Admin chọn hủy hoặc hoàn tiền thủ công. 4. Admin xác nhận. 5. Hệ thống cập nhật đơn, khung giờ, thanh toán và báo cho khách.
Alternative Paths
Đơn bình thường tự xác nhận sau khi thanh toán nên Admin không phải duyệt.
Postcondition
Đơn CANCELLED, khung giờ AVAILABLE, thanh toán REFUNDED.
Exception Paths
Đơn đã COMPLETED hoặc đã hủy: từ chối (409).
Other
Dùng khi có sự cố; Admin hủy thì hoàn 100% số đã trả.


UC-19: Dashboard thống kê
Mục
Nội dung
Use Case Name
Dashboard thống kê
XRef
FR-19; API GET /admin/reports
Trigger
Admin mở trang Tổng quan.
Precondition
Đã đăng nhập bằng tài khoản Admin.
Basic Path
1. Hệ thống tính doanh thu thực thu theo ngày, tỷ lệ lấp sân, số đặt sân mới, số yêu cầu tìm đối đang chờ, top sân được đặt nhiều. 2. HT hiển thị thẻ số liệu, biểu đồ doanh thu và bảng top sân.
Alternative Paths
Admin đổi khoảng thời gian (hôm nay, 7 ngày, 30 ngày).
Postcondition
Không đổi dữ liệu.
Exception Paths
Chưa có dữ liệu: hiển thị 0. Không phải Admin: 403.
Other
Doanh thu thực thu = số tiền đã thanh toán trừ tiền đã hoàn.



Nhóm tìm sân và đặt sân (User)
UC-05: Tìm kiếm và xem chi tiết sân
Mục
Nội dung
Use Case Name
Tìm kiếm và xem chi tiết sân
XRef
FR-05; API GET /facilities, /facilities/{id}, /fields/{id}/slots
Trigger
User nhập điều kiện tìm hoặc chọn một cơ sở.
Precondition
Đã đăng nhập.
Basic Path
1. User chọn môn, khu vực, ngày, khung giờ, . 2. Hệ thống trả danh sách cơ sở (ảnh, địa chỉ, giá từ, điểm sao). 3. User chọn một cơ sở. 4. User xem chi tiết: giờ mở, liên hệ, bảng giá, lịch trống, tiện ích, bản  đồ, đánh giá.
Alternative Paths
User bấm nút "Đặt sân"  Hệ thống hiển thị bảng chọn khung giờ trống để tiếp tục quy trình đặt sân (chuyển sang UC-06). 
Postcondition
Không đổi dữ liệu.
Exception Paths
Không có sân phù hợp: thông báo. Cơ sở không tồn tại: 404.
Other
Trạng thái khung giờ cập nhật thời gian thực (FR-16); mỗi cơ sở dùng một ảnh duy nhất ở mọi trang.


UC-06: Đặt sân (lock TimeSlot)
Mục
Nội dung
Use Case Name
Đặt sân (lock TimeSlot)
XRef
FR-06; NFR không đặt trùng; API POST /bookings
Trigger
User chọn khung giờ trống và bấm Đặt sân.
Precondition
Đã đăng nhập; khung giờ còn trống.
Basic Path
1. User chọn sân, ngày, khung giờ. 2. Hệ thống khóa khung giờ 10 phút. 3. HT tạo đơn chờ thanh toán. 4. Chuyển sang bước thanh toán.
Alternative Paths
Bật tìm đối thủ: Bật công tắc MatchMaker trước khi thanh toán; thanh toán xong tự động chuyển sang tìm đối 
Postcondition
Đơn PENDING, khung giờ LOCKED.
Exception Paths
Khung giờ đã có người giữ: 409. Khung giờ đã qua: 400.
Other
Chống đặt trùng bằng giao dịch và ràng buộc duy nhất; kiểm chứng bằng TC-02.


UC-07: Thanh toán giả lập
Mục
Nội dung
Use Case Name
Thanh toán giả lập
XRef
FR-07; FR-12; API POST /bookings/{id}/pay
Trigger
User bấm Thanh toán.
Preco
+ndition
Có đơn PENDING còn trong hạn giữ chỗ.
Basic Path
1. User chọn đặt cọc hoặc thanh toán toàn bộ. 2. User chọn phương thức. 3. Hệ thống ghi nhận số tiền đã trả. 4. HT xác nhận đơn, thông báo thành công.
Alternative Paths
Sau khi xong, User có thể  Tìm đối (UC-13, UC-14); không chọn thì ca kết thúc.
Postcondition
Đơn CONFIRMED, thanh toán PAID, khung giờ BOOKED.
Exception Paths
Quá hạn giữ chỗ: tự hủy (410). Đơn không còn chờ thanh toán: 409.
Other
Tiền cọc là 50% giá sân, phần còn lại thu tại sân (ngoài hệ thống); thanh toán chỉ giả lập.


UC-08: Hủy và hoàn tiền giả lập
Mục
Nội dung
Use Case Name
Hủy và hoàn tiền giả lập
XRef
FR-08; API PUT /bookings/{id}/cancel
Trigger
User chọn Hủy đặt sân.
Precondition
Đơn của User đang PENDING hoặc CONFIRMED.
Basic Path
1. Hệ thống hiển thị số tiền hoàn theo chính sách. 2. User xác nhận hủy. 3. HT Hủy đơn, trả khung giờ về trống. 4. HT hoàn tiền và thông báo.
Alternative Paths
Chưa thanh toán: hủy, không hoàn tiền. Đang có yêu cầu tìm đối: hủy luôn yêu cầu đó.
Postcondition
Đơn CANCELLED, khung giờ AVAILABLE, thanh toán REFUNDED (nếu có hoàn).
Exception Paths
User không xác nhận: không đổi gì. Đơn đã hoàn thành, đã hủy hoặc hết hạn: 409.
Other
Hoàn trên số đã trả: hủy từ 24 giờ trước hoàn 100%; từ 6 đến dưới 24 giờ hoàn 50%; dưới 6 giờ không hoàn.


UC-09: Lịch sử đặt sân
Mục
Nội dung
Use Case Name
Lịch sử đặt sân
XRef
FR-09; API GET /bookings/me
Trigger
User chọn Lịch sử đặt sân.
Precondition
Đã đăng nhập.
Basic Path
1. Hệ thống lấy các đơn của chính User. 2. Hiển thị kèm trạng thái. 3. User lọc theo trạng thái. 4. Chọn một đơn xem chi tiết.
Alternative Paths
Từ chi tiết: Thanh toán (UC-07) khi PENDING; Hủy (UC-08); Tìm đối (UC-13, UC-14) khi CONFIRMED; Viết đánh giá (UC-18) khi COMPLETED.
Postcondition
Không đổi dữ liệu.
Exception Paths
Chưa có đơn: thông báo trống. Xem đơn của người khác: 404.
Other
Chi tiết có số tiền đã trả và số tiền đã hoàn.


UC-18: Đánh giá sân
Mục
Nội dung
Use Case Name
Đánh giá sân
XRef
FR-18; API POST /reviews
Trigger
User chọn Viết đánh giá ở đơn đã hoàn thành.
Precondition
Đơn của chính User ở trạng thái COMPLETED và chưa có đánh giá.
Basic Path
1. Chọn số sao từ 1 đến 5. 2. Nhập nhận xét (tùy chọn). 3. Gửi. 4. Hệ thống lưu đánh giá và cập nhật điểm trung bình của sân.
Alternative Paths
Không có.
Postcondition
Mỗi đơn có đúng một đánh giá.
Exception Paths
Đơn chưa COMPLETED hoặc đã đánh giá: từ chối (409). Số sao ngoài 1 đến 5: 400.
Other
Điểm trung bình tính từ các đánh giá của sân.



UC-17: Thông báo trong app và Email
Mục
Nội dung
Use Case Name
Thông báo trong app và Email
XRef
FR-17; API GET /notifications
Trigger
Có sự kiện (đặt sân thành công, sân bị hủy hoặc hết hạn, ghép đối thành công hoặc hết hạn) hoặc User mở chuông thông báo.
Precondition
User có tài khoản.
Basic Path
1. Hệ thống tạo thông báo cho User. 2. Chuông hiện số chưa đọc. 3. User mở danh sách và xem thông báo. 4. Hệ thống đánh dấu đã đọc/xem.
Alternative Paths
Với đặt sân thành công, sân bị hủy, ghép đối thành công: gửi thêm email.
Postcondition
Thông báo được lưu; trạng thái đã đọc được cập nhật.
Exception Paths
Gửi email lỗi: vẫn giữ thông báo trong app.
Other
SMS nằm ngoài phạm vi.



Nhóm tìm đối
UC-13: Tìm đối ngẫu nhiên
Mục
Nội dung
Use Case Name
Tìm đối ngẫu nhiên
XRef
FR-13; API POST /match-requests
Trigger
User chọn Tìm đối chơi cùng và chế độ Ngẫu nhiên.
Precondition
Đơn của User đã CONFIRMED và chưa có yêu cầu tìm đối.
Basic Path
1. User chọn Ngẫu nhiên. 2. Hệ thống tạo yêu cầu SEARCHING, báo Đang tìm đối. 3. Tác vụ nền tìm yêu cầu khác cùng môn, cùng khung giờ. 4. Khi tìm thấy: hai bên MATCHED, thông báo kèm hồ sơ ngắn của người được ghép.
Alternative Paths
Chưa ghép được khi đến hạn: chuyển sang UC-15.
Postcondition
Yêu cầu MATCHED, EXPIRED hoặc CANCELLED; đơn vẫn CONFIRMED.
Exception Paths
Đơn chưa CONFIRMED: 409. Đã có yêu cầu: từ chối. User có thể hủy tìm đối bất kỳ lúc nào.
Other
Quá trình tìm kiếm đối thủ đếm ngược 10 phút theo kịch bản thời gian thực; khi hết giờ cho phép nới lỏng tiêu chí mở rộng phạm vi tìm kiếm hoặc chuyển sang chơi riêng. 



UC-14: Tìm đối theo tiêu chí
Mục
Nội dung
Use Case Name
Tìm đối theo tiêu chí
XRef
FR-14; API POST /match-requests
Trigger
User chọn Tìm đối chơi cùng và chế độ Theo tiêu chí.
Precondition
Đơn đã CONFIRMED, chưa có yêu cầu; hồ sơ có giới tính và trình độ.
Basic Path
1. Chọn giới tính (Nam, Nữ, Bất kỳ) và trình độ. 2. Hệ thống tạo yêu cầu SEARCHING. 3. Tác vụ nền lọc cùng môn, cùng khung giờ rồi tính điểm. 4. Chọn người điểm cao nhất vượt ngưỡng, hai bên MATCHED, thông báo.
Alternative Paths
Chưa ghép được: chuyển sang UC-15.
Postcondition
Yêu cầu MATCHED, EXPIRED hoặc CANCELLED; đơn vẫn CONFIRMED.
Exception Paths
Đơn chưa CONFIRMED: 409. User hủy tìm đối.
Other
Quá trình tìm kiếm đối thủ đếm ngược 10 phút theo kịch bản thời gian thực; khi hết giờ cho phép nới lỏng tiêu chí mở rộng phạm vi tìm kiếm hoặc chuyển sang chơi riêng. 



UC-15 Hết hạn và nới lỏng tiêu chí

Mục
Nội dung
Use Case Name
Hết hạn và nới lỏng tiêu chí tìm đối
XRef
FR-15; API PUT /match-requests/{id}/relax
Trigger
Hết thời gian đếm ngược 10 phút tìm kiếm đối thủ.
Precondition
Đang có yêu cầu tìm đối ở trạng thái SEARCHING.
Basic Path
1. Hết thời gian đếm ngược mà chưa tìm được người phù hợp: hệ thống hiển thị thông báo đề xuất nới lỏng tiêu chí.

2. User xác nhận đồng ý.

3. Hệ thống chuyển tiêu chí thành Bất kỳ (mọi trình độ, mở rộng bán kính) và tiếp tục quét.
Alternative Paths
User không muốn tìm nữa: chọn giữ lại sân chơi riêng, yêu cầu tìm đối bị hủy bỏ.
Postcondition
Yêu cầu tiếp tục SEARCHING với tiêu chí mở rộng, hoặc EXPIRED/CANCELLED; đơn đặt sân vẫn CONFIRMED.
Exception Paths
Hết thời hạn mà User không xác nhận: yêu cầu tự chuyển sang EXPIRED; đơn sân vẫn giữ nguyên hiệu lực.
Other
Đếm lùi thời gian thực hiển thị trực tiếp trên giao diện người dùng; không tự ý thay đổi tiêu chí khi người dùng chưa đồng ý.


UC-12: Tự động hủy booking quá hạn

Mục
Nội dung ngắn gọn
Use Case Name
Tự động hủy và cập nhật trạng thái đơn đặt sân
XRef
FR-12; Logic thời gian thực
Trigger
Người dùng mở hoặc tải lại trang Lịch sử / Chi tiết đơn.
Precondition
Đơn đặt sân đã tồn tại trên hệ thống.
Basic Path
1. Hệ thống lấy giờ hiện tại so sánh với giờ của đơn.
2. Đơn chờ thanh toán quá 10 phút: tự hủy và mở lại sân trống.
3. Cập nhật giao diện theo thời gian thực.
Alternative Paths
Đơn đã xác nhận nhưng hết giờ chơi: tự chuyển thành Hoàn thành và khóa nút hủy.
Postcondition
Đơn hiển thị đúng trạng thái thực tế (Sắp tới / Trong trận / Hoàn thành).
Exception Paths
Lỗi dữ liệu thời gian: giữ nguyên trạng thái cũ.
Other
Tính toán động trực tiếp khi mở trang, không cần tác vụ nền chạy ngầm.




