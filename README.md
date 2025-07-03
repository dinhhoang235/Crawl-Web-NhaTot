# 🚀 Tool Crawl Web Tự Động

## ⚙️ Yêu cầu hệ thống

- Đã cài **[Node.js](https://nodejs.org/)** (nên dùng bản LTS)
- Hệ điều hành: Windows 10/11
- Kết nối mạng ổn định lần đầu chạy

## 📁 Bước 1: Giải nén
Giải nén file `.zip` ra một thư mục bất kỳ, ví dụ Desktop hoặc Documents.

---

## 🖱️ Bước 2: Chạy lần đầu
Chạy file `run.bat` bằng cách **bấm đúp chuột** vào file đó.

> ✅ Lần đầu chạy sẽ:
> - Tự động cài Node packages
> - Sau đó chạy tool

---

## 💻 Bước 3: Lần sau chỉ cần chạy
Sau khi đã cài xong, những lần sau chỉ cần mở lại file `run.bat` để chạy tool.

---
## 💻 Bước 4: Mở file excel
sau khi chạy hết sẽ có 1 file excel được xuất ra.

## 🔧 Cách đổi link để quét
Mở file urls.js bằng nodepad sau đó copy link vào trong ''
Ví dụ: 'Copy đây'

---

## 📄 Thông tin thêm
Tool này sử dụng thư viện **Puppeteer** để điều khiển trình duyệt Chromium và chỉ link bài viết mà chủ của bài viết đăng <= 3 bài, các bài thuộc khu vực 'Cầu Giấy', 'Đống Đa', 'Ba Đình', 'Bắc Từ Liêm', 'Nam Từ Liêm', 'Tây Hồ', 'Hoàng Mai', 'Hai Bà Trưng', 'Thanh Xuân', 'Hà Đông'  . Cuối xuất link dủ yêu cầu ra file excel