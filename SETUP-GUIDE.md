# Hướng dẫn cài đặt grap-local

Hướng dẫn này sẽ giúp bạn cài đặt **grap-local** làm backend phân tích code cho các AI coding agent. Sau khi cài xong, các agent như Cursor, Claude Code, Codex, v.v. sẽ có thể truy vấn codebase của bạn — tìm symbol, xem dependency, phân tích blast radius.

---

## Mục lục

- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt](#cài-đặt)
- [Index một repository](#index-một-repository)
- [Cấu hình cho từng Agent](#cấu-hình-cho-từng-agent)
  - [Cursor](#cursor)
  - [Claude Code](#claude-code)
  - [Codex App (OpenAI)](#codex-app-openai)
  - [VS Code + GitHub Copilot](#vs-code--github-copilot)
  - [Antigravity (Google Gemini)](#antigravity-google-gemini)
- [Kiểm tra kết nối](#kiểm-tra-kết-nối)
- [Dùng với nhiều repo](#dùng-với-nhiều-repo)
- [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)

---

## Yêu cầu hệ thống

- **Node.js** >= 22.0.0
- **MongoDB** — chạy local hoặc dùng MongoDB Atlas (cloud)
- **npm** (đi kèm Node.js)

---

## Cài đặt

```bash
# 1. Clone repo về máy
git clone <url-repo-grap-local>
cd grap-local

# 2. Cài dependencies
npm install

# 3. Tạo file .env
cp .env.example .env
```

Mở file `.env` và chỉnh sửa:

```env
PORT=4010
MONGODB_URI=mongodb://127.0.0.1:27017       # hoặc URI MongoDB Atlas
DB_NAME=grap-local
LOG_LEVEL=info
```

> **Lưu ý**: File phải đặt tên là `.env` (không phải `.env.local`). dotenv chỉ tự động load file `.env`.

```bash
# 4. Khởi động REST server
npm run dev
```

Nếu thành công, bạn sẽ thấy:
```
Connected to MongoDB
grap-local REST server listening (port: 4010)
```

---

## Index một repository

Trước khi agent có thể truy vấn code, bạn cần **đăng ký** và **index** repo cần phân tích.

### Bước 1: Đăng ký repo

```bash
curl -X POST http://localhost:4010/repos/register \
  -H "Content-Type: application/json" \
  -d '{"name":"ten-du-an","rootPath":"/duong-dan-tuyet-doi/toi-du-an"}'
```

> **Đường dẫn Windows**: Dùng dấu `/` thay vì `\`:
> `"rootPath":"C:/Users/ban/projects/du-an-cua-ban"`

Response sẽ trả về `repoId` — lưu lại để dùng cho bước tiếp theo.

### Bước 2: Chạy index

```bash
curl -X POST http://localhost:4010/repos/<repoId>/index
```

### Bước 3: Kiểm tra trạng thái

```bash
curl http://localhost:4010/repos/<repoId>/status
```

Đợi đến khi `status` là `"ready"`. Repo lớn có thể mất vài phút.

### Cách nhanh: Dùng CLI

Đăng ký + index trong 1 lệnh duy nhất:

```bash
npm run index -- --path /duong-dan/toi-du-an --name ten-du-an
```

---

## Cấu hình cho từng Agent

Tất cả agent đều kết nối qua **MCP (Model Context Protocol)**. MCP server chạy bằng lệnh `npm run mcp` trong thư mục grap-local và giao tiếp qua **stdio**.

> **Quan trọng**: Thay `<ĐƯỜNG_DẪN_GRAP_LOCAL>` bên dưới bằng **đường dẫn tuyệt đối** tới thư mục grap-local trên máy của bạn. Ví dụ:
> - Windows: `C:/Users/ban/tools/grap-local`
> - macOS: `/Users/ban/tools/grap-local`
> - Linux: `/home/ban/tools/grap-local`

---

### Cursor

Tạo file `.cursor/mcp.json` trong **thư mục gốc dự án** bạn đang làm việc (KHÔNG phải trong grap-local):

```
du-an-cua-ban/
└── .cursor/
    └── mcp.json
```

Nội dung file:

```json
{
  "mcpServers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "<ĐƯỜNG_DẪN_GRAP_LOCAL>"
    }
  }
}
```

**Ví dụ** (Windows):
```json
{
  "mcpServers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "C:/Users/LENOVO/tools/grap-local"
    }
  }
}
```

Lưu file xong, khởi động lại Cursor. Các MCP tools sẽ xuất hiện khi dùng agent mode.

---

### Claude Code

#### Cách A: Dùng CLI (cấu hình toàn cục, áp dụng cho mọi dự án)

```bash
claude mcp add grap-local npm run mcp --cwd "<ĐƯỜNG_DẪN_GRAP_LOCAL>"
```

#### Cách B: Cấu hình riêng cho từng dự án

Tạo file `.mcp.json` ở **thư mục gốc dự án**:

```json
{
  "mcpServers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "<ĐƯỜNG_DẪN_GRAP_LOCAL>"
    }
  }
}
```

Lưu file xong, Claude Code sẽ tự động nhận MCP server khi bắt đầu cuộc hội thoại mới.

---

### Codex App (OpenAI)

Trong phần cài đặt của Codex App, thêm MCP server với:

| Trường    | Giá trị                        |
| --------- | ------------------------------ |
| Command   | `npm`                          |
| Args      | `run`, `mcp`                   |
| Cwd       | `<ĐƯỜNG_DẪN_GRAP_LOCAL>`      |

Codex sẽ tự khởi chạy MCP process và có thể dùng tất cả tools của grap-local.

---

### VS Code + GitHub Copilot

Copilot hỗ trợ MCP server. Tạo file `.vscode/mcp.json` trong **thư mục gốc dự án**:

```json
{
  "servers": {
    "grap-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "<ĐƯỜNG_DẪN_GRAP_LOCAL>"
    }
  }
}
```

Hoặc thêm vào `settings.json` của VS Code (áp dụng toàn cục):

```json
{
  "mcp": {
    "servers": {
      "grap-local": {
        "command": "npm",
        "args": ["run", "mcp"],
        "cwd": "<ĐƯỜNG_DẪN_GRAP_LOCAL>"
      }
    }
  }
}
```

---

### Antigravity (Google Gemini)

Antigravity **không hỗ trợ kết nối MCP** trực tiếp. Nhưng bạn vẫn dùng được bằng 2 cách:

1. **Gọi REST API qua terminal** — nhờ Antigravity chạy curl:
   ```
   "Tìm symbol UserService trong repo <repoId> bằng grap-local cho tôi"
   ```
   Antigravity sẽ chạy:
   ```bash
   curl "http://localhost:4010/repos/<repoId>/symbols/search?q=UserService"
   ```

2. **Đặt file AGENTS.md ở dự án** — Antigravity tự động đọc `AGENTS.md` ở thư mục gốc dự án khi bạn mở project. Ghi context, conventions vào đó để Antigravity hiểu codebase tốt hơn.

---

## Kiểm tra kết nối

Sau khi cấu hình MCP xong, yêu cầu agent chạy thử:

```
Gọi get_repo_status với repoId "<repoId-của-bạn>"
```

Agent sẽ trả về:
- Tên và đường dẫn repo
- Trạng thái: `ready`
- Thông tin lần index gần nhất (số file đã quét, đã index, bỏ qua)

### Danh sách MCP Tools

| Tool                 | Chức năng                                                 |
| -------------------- | --------------------------------------------------------- |
| `find_symbol`        | Tìm symbol theo tên hoặc tên đầy đủ (fqName)             |
| `get_symbol_context` | Xem định nghĩa + caller + callee + imports của symbol     |
| `get_file_symbols`   | Liệt kê tất cả symbol trong 1 file                       |
| `get_symbol_impact`  | Phân tích blast radius: ai gọi nó? Nó gọi ai?            |
| `search_files`       | Tìm file theo đường dẫn, symbol, import, hoặc nội dung   |
| `get_repo_status`    | Thông tin repo + lần index gần nhất + số file đã index    |

### Quy trình khuyến nghị cho Agent

1. `get_repo_status` → xác nhận repo đã `ready`
2. `find_symbol` → tìm symbol cần quan tâm
3. `get_symbol_context` → hiểu dependencies trước khi sửa code
4. `get_symbol_impact` → hiểu blast radius trước khi refactor
5. `search_files` → tìm file khi chỉ biết tên file hoặc nội dung

---

## Dùng với nhiều repo

Bạn có thể index nhiều repository vào cùng 1 instance grap-local. Mỗi repo có `repoId` riêng:

```bash
# Đăng ký repo frontend
curl -X POST http://localhost:4010/repos/register \
  -H "Content-Type: application/json" \
  -d '{"name":"frontend","rootPath":"C:/projects/frontend"}'

# Đăng ký repo backend
curl -X POST http://localhost:4010/repos/register \
  -H "Content-Type: application/json" \
  -d '{"name":"backend","rootPath":"C:/projects/backend"}'

# Index cả 2
curl -X POST http://localhost:4010/repos/<repoId-frontend>/index
curl -X POST http://localhost:4010/repos/<repoId-backend>/index

# Xem danh sách tất cả repo đã đăng ký
curl http://localhost:4010/repos
```

Agent chỉ cần truyền đúng `repoId` khi gọi tools.

---

## Xử lý lỗi thường gặp

### Lỗi "Cannot find module" khi chạy `npm run mcp`

```bash
npm install
```

### Lỗi "MONGODB_URI is required" (ZodError)

Kiểm tra file `.env` đã tồn tại chưa (không phải `.env.local`):
```bash
cp .env.example .env
# Rồi mở .env và điền MongoDB URI
```

### Lỗi "models is not exported from mongoose"

Các file model phải dùng đúng pattern:
```typescript
import mongoose, { Schema, model } from 'mongoose';
// Đúng:  mongoose.models.TenModel
// Sai:   import { models } from 'mongoose'
```

### Agent không kết nối được MCP

1. Kiểm tra grap-local chạy được: `npm run mcp` phải in ra `grap-local MCP server running on stdio`
2. Kiểm tra `cwd` trong config MCP là **đường dẫn tuyệt đối** tới thư mục grap-local
3. Đảm bảo `npm` có trong PATH hệ thống

### Index bị treo

```bash
# Kiểm tra trạng thái
curl http://localhost:4010/repos/<repoId>/status
```

Nếu status là `error`, chạy lại index:
```bash
curl -X POST http://localhost:4010/repos/<repoId>/index
```

### Xung đột cổng (port)

Đổi `PORT` trong file `.env` và cập nhật lại các lệnh curl tương ứng.

---

## Tổng quan kiến trúc

```
┌──────────────────────────────────────────────────┐
│               Dự án của bạn                       │
│                                                   │
│  ┌──────────┐  ┌───────────┐  ┌───────────────┐ │
│  │  Cursor   │  │Claude Code│  │   Codex App   │ │
│  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘ │
│        │              │                │          │
│        └──────────────┼────────────────┘          │
│                       │ MCP (stdio)               │
└───────────────────────┼───────────────────────────┘
                        │
┌───────────────────────┼───────────────────────────┐
│              grap-local                           │
│                       │                           │
│  ┌────────────────────▼──────────────────────┐   │
│  │          MCP Server (stdio)                │   │
│  │  find_symbol | get_symbol_context | ...    │   │
│  └────────────────────┬──────────────────────┘   │
│                       │                           │
│  ┌────────────────────▼──────────────────────┐   │
│  │         Tầng Service dùng chung            │   │
│  │  symbolService | graphService | ...        │   │
│  └────────────────────┬──────────────────────┘   │
│                       │                           │
│  ┌────────────────────▼──────────────────────┐   │
│  │              MongoDB                       │   │
│  │  repos | files | symbols | edges | runs    │   │
│  └───────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

Tài liệu chi tiết:
- [Kiến trúc](./docs/architecture.md)
- [Mô hình dữ liệu](./docs/data-model.md)
- [MCP Tools](./docs/mcp-tools.md)
- [Giới hạn](./docs/limitations.md)
