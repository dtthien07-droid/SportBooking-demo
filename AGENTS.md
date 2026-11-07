# Luật dự án SportBooking

## Công nghệ
- Backend: Node.js. Frontend: HTML, CSS, JavaScript thuần. Database: MySQL.
- Realtime dùng polling 5 giây.

## Cấu trúc
- Root CHỈ chứa các folder con và 2 file AGENTS.md, CLAUDE.md. Không tạo file mới ở root.
- Ngoại lệ được phép ở root: .gitignore, .git/, .claude/.
- Mọi file .md, tài liệu, log, báo cáo, ghi chú sinh ra phải đặt trong /docs.
- Code phải nằm đúng folder trách nhiệm:
  - frontend/ : chỉ UI/UX
  - backend/  : chỉ API và logic nghiệp vụ
  - infra/    : database, storage, deploy
- Tính năng mới tạo theo domain trong code: frontend/<ten>, backend/<ten>.
- Không chắc file nên đặt ở đâu thì hỏi, không tự quăng ra root.
- Trước khi sửa folder nào, đọc README.md của folder đó.

## Kiến trúc
- Frontend chỉ gọi backend qua API. Chỉ backend được kết nối database.
- Quyền và trạng thái luôn kiểm tra ở backend, không tin giao diện.
- Không đặt bí mật (mật khẩu, key) trong code hoặc docs. Dùng .env, chỉ commit .env.example,
  .env phải nằm trong .gitignore. Mật khẩu lưu dạng băm (bcrypt).

## Tài liệu và nguồn sự thật
- docs/01-plan/phieu-yeu-cau.md là bản gốc, CHỈ ĐỌC, không sửa.
- docs/01-plan/business-flow.md là nguồn sự thật. Khác phiếu thì theo business-flow.
- docs/02-design/spec.md là thiết kế. Khác business-flow thì theo business-flow.

## Quy trình làm tính năng
- Thứ tự: business-flow.md -> spec.md -> plan -> code -> test.
- Trước khi làm, đọc business-flow.md và spec.md.
- Viết kế hoạch vào docs/03-build/plan-<ten-tinh-nang>.md và chờ tôi duyệt rồi mới code.
- Thông tin thiếu hoặc mâu thuẫn: hỏi tôi, không tự đoán.
- Viết test cho phần quan trọng (đặt sân: hợp lệ, trùng giờ, giờ đã qua, thiếu dữ liệu, lock hết hạn). Chạy test và báo kết quả.
- Xong mỗi tính năng: cập nhật docs/04-product/roadmap.md và changelog.md.
- Không tự ý sửa tính năng đã "Xong" trong roadmap khi chưa được yêu cầu.
- Chỉ sửa file liên quan đến tính năng đang làm. Không refactor ngoài phạm vi.