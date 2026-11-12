# Translate Gateway

Gateway dịch thuật tự host cho một người dùng: gộp các API dịch miễn phí không cần thẻ, tự chuyển nhà cung cấp khi hết hạn mức, có cache và phục vụ một Chrome extension. Chi tiết thiết kế xem [plan.md](plan.md).

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `apps/server` | Gateway (Fastify + SQLite), API `/v1/*` và `/admin/api/*` |
| `apps/admin` | Màn hình admin (React + Vite), server phục vụ tại `/admin` |
| `apps/extension` | Chrome extension (Manifest V3) |
| `packages/shared` | Schema Zod và kiểu dùng chung |
| `docs/postman_collection.json` | Collection để thử bằng Postman |

## Chạy nhanh

```bash
cp .env.example .env        # đổi MASTER_KEY và ADMIN_PASSWORD
docker compose up --build   # http://localhost:8787
```

Hoặc chạy trực tiếp (Node 22 + pnpm):

```bash
pnpm install
pnpm --filter @tg/admin build
set -a; . ./.env; set +a
pnpm --filter @tg/server start
```

1. Mở `http://localhost:8787/admin`, đăng nhập bằng `ADMIN_PASSWORD`.
2. Settings → **Tạo key** để lấy gateway key (hoặc đặt `BOOTSTRAP_GATEWAY_KEY` trong `.env`).
3. Lần chạy đầu gateway tự thêm MyMemory (không cần key). Thêm provider khác ở trang Providers.

```bash
curl -s localhost:8787/v1/translate \
  -H "Authorization: Bearer <gateway-key>" -H "Content-Type: application/json" \
  -d '{"texts":["Hello world"],"source":"auto","target":"vi"}'
```

## Biến môi trường

`MASTER_KEY` (≥16 ký tự, mã hóa credentials, mất là không giải mã được), `ADMIN_PASSWORD` (chỉ dùng lần đầu để băm vào DB), `PORT`, `PUBLIC_URL`, `ADMIN_ORIGIN`, `DB_PATH`, `BOOTSTRAP_GATEWAY_KEY`, `RATE_LIMIT_PER_MINUTE` (mặc định 60/key).

## Lấy key từng provider

| Provider | Nơi lấy | Ghi chú |
| --- | --- | --- |
| Gemini | https://aistudio.google.com/apikey | Chỉnh hạn mức trong admin cho khớp AI Studio |
| Groq | https://console.groq.com/keys | Chọn mẫu "Groq" trong "OpenAI-compatible" |
| OpenRouter | https://openrouter.ai/keys | Chọn mẫu "OpenRouter" |
| Cloudflare Workers AI | Dashboard → My Profile → API Tokens | Cần thêm Account ID |
| MyMemory | Không cần | Nhập email để lên 50.000 ký tự/ngày (đặt hạn mức tương ứng) |
| LibreTranslate | `docker compose --profile libre up` | Base URL `http://libretranslate:5000` |

Các con số hạn mức đổi thường xuyên nên được lưu trong database và chỉnh ở admin, không viết cứng trong mã.

## Chrome extension

```bash
pnpm --filter @tg/extension build
```

Chrome → `chrome://extensions` → bật Developer mode → Load unpacked → chọn `apps/extension/dist`. Mở trang Options nhập URL gateway và gateway key. Dịch cả trang từ popup, dịch đoạn bôi đen từ menu chuột phải. Khi gateway trả `ALL_PROVIDERS_EXHAUSTED`, extension tự dùng Translator API của Chrome (nếu trình duyệt hỗ trợ).

## Thêm adapter mới

1. Tạo `apps/server/src/providers/<ten>.ts` xuất một `ProviderDefinition` (xem `mymemory.ts`): `template` mô tả form trong admin, `create()` trả về đối tượng `TranslationProvider`.
2. Ném `ProviderError("quota" | "transient" | "auth" | "invalid", …)` để router biết cách tạm nghỉ/fallback.
3. Đăng ký trong `providers/registry.ts`. Router không cần sửa.

## Phát triển

```bash
pnpm test    # vitest (server)
pnpm lint
pnpm build   # kiểm tra kiểu, build admin và extension
```

## Ghi chú so với plan

- Truy cập SQLite dùng `better-sqlite3` với migration SQL thuần (theo `PRAGMA user_version`) thay vì Drizzle ORM; schema khớp bảng trong plan.
- Admin dùng CSS thuần thay Tailwind, kéo thả bằng HTML5 drag-and-drop.
- Đơn vị `neurons` của Cloudflare được ước lượng bằng số ký tự.
- Giai đoạn 7 (Caddy, sao lưu, khóa đăng nhập admin sau 5 lần sai, giới hạn tốc độ theo key) đã có phần giới hạn tốc độ và khóa đăng nhập; `docker-compose.prod.yml` và script sao lưu ở dưới.

## Deploy (tùy chọn)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Đặt `DOMAIN=gateway.example.com` trong `.env`; Caddy tự cấp HTTPS. Sao lưu SQLite: `./scripts/backup.sh`. Giữ `MASTER_KEY` ở nơi riêng.
