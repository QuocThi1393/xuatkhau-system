# Hướng dẫn Deploy Website Xuất Khẩu System

## Cấu trúc file

```
xuatkhau-system/
├── index.html          ← Trang chủ (danh sách lô hàng)
├── customers.html      ← Quản lý khách hàng
├── firestore.rules     ← Rules bảo mật Firebase
├── css/
│   └── style.css
└── js/
    ├── firebase-config.js
    ├── auth.js
    └── utils.js
```

---

## BƯỚC 1 — Bật Firestore Database

1. Vào https://console.firebase.google.com
2. Chọn project **DULIEUXUATKHAU**
3. Menu trái → **Firestore Database** → **Create database**
4. Chọn **Start in test mode** → Next
5. Chọn region **asia-southeast1 (Singapore)** → Enable

---

## BƯỚC 2 — Cài Security Rules

1. Trong Firestore → tab **Rules**
2. Xóa nội dung cũ, paste nội dung file `firestore.rules` vào
3. Bấm **Publish**

---

## BƯỚC 3 — Upload code lên GitHub

### Cách đơn giản nhất (không cần Git):

1. Vào repo: https://github.com/QuocThi1393/xuatkhau-system
2. Bấm **Add file** → **Upload files**
3. Kéo thả **toàn bộ các file và thư mục** vào
4. Kéo thứ tự: index.html, customers.html, firestore.rules, folder css/, folder js/
5. Commit message: `Initial upload`
6. Bấm **Commit changes**

> **Lưu ý:** GitHub không cho upload folder trống.
> Phải upload từng file theo đúng đường dẫn.

### Cách upload đúng folder:

Với folder `css/` và `js/`, GitHub sẽ tự tạo folder khi bạn upload file bên trong.
Ví dụ: upload file `style.css` → GitHub hỏi đường dẫn → nhập `css/style.css`

---

## BƯỚC 4 — Kiểm tra website

Sau khi upload xong ~2-3 phút, truy cập:
```
https://QuocThi1393.github.io/xuatkhau-system/
```

---

## Mật khẩu Admin

Mật khẩu mặc định: **xuatkhau2024**

Để đổi mật khẩu: mở file `js/auth.js`, sửa dòng:
```js
const ADMIN_PASSWORD = "xuatkhau2024";
```

---

## Tính năng hiện tại

### Trang chủ (index.html)
- [x] Danh sách lô hàng dạng card
- [x] Sắp xếp theo ngày đóng hàng → tiến độ
- [x] Checklist 11 bước, click để tick/untick
- [x] Bước 10 (CO) có thể bỏ qua (tick 2 lần)
- [x] Xổ xuống xem chi tiết đơn hàng
- [x] Thêm/sửa/xóa đơn hàng (Admin)
- [x] Thêm/sửa/xóa lô hàng (Admin)
- [x] Generate email booking tự động
- [x] Filter theo trạng thái
- [x] Real-time (tự cập nhật khi có thay đổi)

### Trang khách hàng (customers.html)
- [x] Danh sách khách hàng
- [x] Thêm/sửa/xóa (Admin)
- [x] Lưu: tên, liên hệ, email, consignee, description, C/O form, note

### Tính năng sắp thêm
- [ ] Import Excel
- [ ] Phân quyền theo bộ phận
- [ ] Lịch sử thay đổi

---

## Sử dụng hàng ngày

1. Mở website → Đăng nhập Admin (góc trên phải)
2. Bấm **+ Thêm lô hàng** → điền thông tin cơ bản
3. Bấm vào card → xổ xuống → **+ Thêm đơn** để nhập từng đơn hàng
4. Tick từng ô checklist khi hoàn thành bước đó
5. Bấm **Generate email** để tạo email booking tự động
