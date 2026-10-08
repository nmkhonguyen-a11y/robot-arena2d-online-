# Mech Arena 2D

Game robot bắn súng 2D chạy trên trình duyệt, có chơi online (1v1, 2v2, 5v5, sinh tồn 2 người, The World), tài khoản, nhiệm vụ và quay thưởng.

## Chạy thử trên máy
Cần Node.js 18 trở lên.

    npm install
    npm start

Mở http://localhost:3000. Bạn bè cùng Wi-Fi vào bằng `http://IP-máy-bạn:3000`.

## Đưa lên Internet (Render.com)
1. Đẩy repo này lên GitHub.
2. Vào render.com > New > Web Service > chọn repo.
3. Build Command: `npm install` | Start Command: `npm start`.
4. Nhận địa chỉ dạng `https://ten-ban.onrender.com`, gửi cho bạn bè.

Hoặc dùng file `render.yaml` kèm theo: Render > New > Blueprint > chọn repo.

### Lưu ý về tài khoản
Server lưu tài khoản trong `data/accounts.json`. Trên gói miễn phí của Render, ổ đĩa bị xóa mỗi lần khởi động lại, tài khoản sẽ mất.
Muốn giữ lâu dài: gắn Persistent Disk (gói trả phí), mount vào `/var/data` và đặt biến môi trường `DATA_DIR=/var/data`, hoặc đổi phần lưu trữ trong `server.js` sang cơ sở dữ liệu.

Không đưa thư mục `data/` lên GitHub (đã nằm trong `.gitignore`).

## Tài khoản
- Tên chỉ gồm chữ và số (3-16 ký tự), không phân biệt hoa thường.
- 5 tài khoản đăng ký đầu tiên có dấu `@` và Credits, A-Coins vô hạn, cùng bảng Tool admin (phím F1 trong trận).

## Điều khiển
- Máy tính: A/D di chuyển, W/Space nhảy, chuột ngắm và bắn, Shift/E/Q kỹ năng, phím số đổi súng, R nạp đạn.
- Điện thoại: xoay ngang, dùng nút trên màn hình.
- The World: F tập hợp, G tấn công, H giữ vị trí, V xung phong.

## Cấu trúc
    server.js         server Node.js (Express + Socket.IO)
    public/index.html toàn bộ game (HTML + CSS + JavaScript)
    package.json      thư viện cần cài
    render.yaml       cấu hình tự động cho Render
