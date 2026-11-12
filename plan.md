# Translate Gateway: Kế hoạch dự án

Nov 12, 2026 · @helo

## Mục tiêu và phạm vi

Dự án xây một gateway dịch thuật tự host cho một người dùng: gộp các API dịch miễn phí không cần thẻ, tự chuyển nhà cung cấp khi hết hạn mức, và phục vụ một Chrome extension.

**Trong phạm vi**

- API dịch qua HTTP, test được bằng Postman hoặc curl.
- Màn hình admin để kết nối, cấu hình và theo dõi các nhà cung cấp.
- Cơ chế fallback, đếm quota và cache bản dịch.
- Chrome extension (Manifest V3) làm client đầu tiên.

**Ngoài phạm vi**

- Nhiều người dùng, phân quyền, thanh toán.
- Tạo nhiều tài khoản trên cùng một nhà cung cấp để nhân quota.
- Endpoint không chính thức (Google web, Lingva, DeepLX): chỉ là adapter tùy chọn, tắt mặc định.

**Giả định**

- **Stack:** TypeScript cho toàn bộ repo. Backend dùng Node.js với Fastify, lưu trữ bằng SQLite, admin UI dùng React với Vite. Lý do: extension bắt buộc viết bằng JS/TS, nên dùng chung một ngôn ngữ giúp chia sẻ kiểu dữ liệu giữa ba phần.
- **Triển khai:** phát triển và chạy trên máy cá nhân trước. Mọi thứ đóng gói bằng Docker Compose và cấu hình qua biến môi trường, để sau này deploy lên máy chủ mà không phải sửa mã.
- **Provider:** chỉ dùng các bên đăng ký được mà không cần thẻ Visa/Mastercard.

## Kiến trúc tổng quan

Gateway là một tiến trình duy nhất đứng giữa client và các nhà cung cấp. Mọi request dịch đi qua cache rồi tới router; router chọn provider còn quota theo thứ tự ưu tiên.

&#91;embedded content: kiến trúc gateway · 3 client, 5 provider\]

Đường nét đứt là lối dự phòng cuối: khi gateway báo mọi provider đã hết quota, extension tự dịch bằng Translator API chạy ngay trong Chrome mà không cần server.

## Provider và chuỗi fallback

Gateway thử lần lượt theo thứ tự ưu tiên dưới đây và chuyển sang bên kế tiếp khi một bên hết quota, bị giới hạn tốc độ hoặc lỗi. Thứ tự và trạng thái bật/tắt chỉnh được trong admin.

| Ưu tiên | Provider | Loại | Hạn mức miễn phí | Đặt lại | Ghi chú khi viết adapter |
| --- | --- | --- | --- | --- | --- |
| 1 | Gemini (AI Studio) | LLM | Theo request/phút và /ngày, xem trong AI Studio | Hàng ngày | Gom nhiều đoạn vào một request, trả về JSON |
| 2 | Groq hoặc OpenRouter | LLM | Theo request và token | Phút và ngày | API tương thích OpenAI, dùng chung một adapter |
| 3 | Cloudflare Workers AI (m2m100) | Dịch máy | 10.000 neuron/ngày | 00:00 UTC | Gọi qua REST, cần Account ID và API token |
| 4 | MyMemory | Dịch máy | 5.000 ký tự/ngày, 50.000 nếu kèm email | Hàng ngày | Tối đa 500 byte mỗi request, phải cắt nhỏ |
| 5 | LibreTranslate tự host | Dịch máy | Không giới hạn | Không áp dụng | Tùy chọn, chạy thêm một container |

Các con số hạn mức thay đổi thường xuyên, nên chúng được lưu thành cấu hình trong database chứ không viết cứng trong mã.

**Quy tắc điều phối**

1. Tra cache trước. Nếu có bản dịch thì trả về ngay, không gọi provider nào.
2. Lọc ra các provider đang bật, còn quota theo bộ đếm nội bộ, và không ở trạng thái tạm nghỉ.
3. Gọi provider có ưu tiên cao nhất. Client có thể chỉ định provider cụ thể qua tham số `provider`.
4. Nếu nhận lỗi 429 hoặc lỗi quota: đánh dấu provider tạm nghỉ đến thời điểm đặt lại, rồi thử bên kế tiếp.
5. Nếu lỗi mạng hoặc 5xx: thử lại một lần, sau đó tạm nghỉ 60 giây (circuit breaker) và thử bên kế tiếp.
6. Nếu mọi provider đều thất bại: trả mã lỗi `ALL_PROVIDERS_EXHAUSTED`. Extension khi đó tự dịch bằng Translator API có sẵn trong Chrome.

**Giao diện chung của adapter**

Mỗi provider là một file hiện thực cùng một interface, nên thêm provider mới không đụng tới router.

```ts
interface TranslationProvider {
  id: string;
  kind: "llm" | "mt";
  maxCharsPerRequest: number;
  translate(req: {
    texts: string[];
    source: string | "auto";
    target: string;
  }): Promise<{ translations: string[]; charsUsed: number }>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
}
```

Với LLM, prompt yêu cầu trả về mảng JSON có đúng số phần tử như đầu vào. Adapter kiểm tra số phần tử, nếu lệch thì coi là lỗi và để router fallback.

## Thiết kế API

Gateway có hai nhóm endpoint: API dịch cho client (xác thực bằng gateway key) và API quản trị cho màn hình admin (xác thực bằng mật khẩu admin và cookie phiên).

**API dịch (dùng cho Postman và extension)**

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| POST | `/v1/translate` | Dịch một mảng đoạn văn bản |
| GET | `/v1/providers` | Liệt kê provider đang bật và tình trạng quota |
| GET | `/v1/languages` | Danh sách mã ngôn ngữ hỗ trợ |
| GET | `/health` | Kiểm tra server còn sống, không cần key |

Ví dụ gọi `/v1/translate`:

```http
POST /v1/translate
Authorization: Bearer <gateway-key>
Content-Type: application/json

{
  "texts": ["Hello world", "How are you?"],
  "source": "auto",
  "target": "vi",
  "provider": null,
  "noCache": false
}
```

```json
{
  "translations": [
    { "text": "Xin chào thế giới", "provider": "gemini", "cached": false },
    { "text": "Bạn khỏe không?", "provider": "cache", "cached": true }
  ],
  "fallbackChain": ["gemini"]
}
```

- `texts` luôn là mảng để extension gửi cả lô đoạn văn trong một request. Thứ tự kết quả khớp thứ tự đầu vào.
- `provider` để trống thì gateway tự chọn. Nếu chỉ định mà bên đó hết quota, gateway trả lỗi chứ không tự đổi.
- `fallbackChain` ghi lại các provider đã thử, giúp gỡ lỗi khi test bằng Postman.
- Lỗi trả về theo một khuôn chung: `{ "error": { "code": "...", "message": "..." } }`. Các mã chính: `UNAUTHORIZED`, `INVALID_REQUEST`, `PROVIDER_UNAVAILABLE`, `ALL_PROVIDERS_EXHAUSTED`.

**API quản trị (tiền tố `/admin/api`)**

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| POST | `/login`, `/logout` | Đăng nhập bằng mật khẩu admin |
| GET, POST | `/providers` | Xem danh sách, thêm provider |
| PATCH, DELETE | `/providers/:id` | Sửa key, hạn mức, bật/tắt, xóa |
| POST | `/providers/:id/test` | Gọi thử một câu để kiểm tra kết nối |
| PUT | `/providers/order` | Lưu thứ tự ưu tiên |
| GET | `/usage` | Số ký tự và request đã dùng theo provider |
| GET | `/logs` | Lịch sử request gần đây |
| GET, POST, DELETE | `/keys` | Quản lý gateway key cho client |
| DELETE | `/cache` | Xóa cache bản dịch |
| POST | `/playground` | Dịch thử từ admin, cho phép ép provider |

API key của nhà cung cấp chỉ được ghi vào, không bao giờ trả ra đầy đủ: các endpoint đọc chỉ hiển thị bốn ký tự cuối.

## Màn hình Admin

Admin là một ứng dụng web một trang do chính gateway phục vụ tại `/admin`, gồm năm trang. Trang Providers là trọng tâm và được làm đầu tiên.

| Trang | Chức năng chính |
| --- | --- |
| Providers | Thêm provider từ danh sách mẫu, nhập API key, đặt hạn mức và chu kỳ đặt lại, bật/tắt, kéo thả để đổi thứ tự ưu tiên, nút "Test kết nối" |
| Playground | Nhập văn bản, chọn ngôn ngữ, chọn provider hoặc để tự động, xem kết quả kèm provider đã dùng và thời gian phản hồi |
| Usage | Thanh tiến độ quota của từng provider, thời điểm đặt lại kế tiếp, tỉ lệ cache hit |
| Logs | Bảng các request gần đây: thời gian, provider, số ký tự, trạng thái, chuỗi fallback |
| Settings | Tạo và thu hồi gateway key, đổi mật khẩu admin, xóa cache, ngưỡng dừng an toàn (mặc định 90% hạn mức) |

**Luồng kết nối một provider**

1. Chọn loại provider từ danh sách mẫu. Mỗi mẫu có sẵn hạn mức mặc định và đường dẫn tới trang lấy key của bên đó.
2. Nhập thông tin xác thực. Phần lớn chỉ cần một API key, riêng Cloudflare cần thêm Account ID, MyMemory chỉ cần email.
3. Bấm "Test kết nối". Gateway dịch thử một câu ngắn và hiển thị kết quả hoặc thông báo lỗi nguyên văn từ provider.
4. Lưu. Provider xuất hiện ở cuối danh sách ưu tiên và có thể kéo lên.

## Mô hình dữ liệu

Toàn bộ trạng thái nằm trong một file SQLite với sáu bảng.

| Bảng | Cột chính | Vai trò |
| --- | --- | --- |
| `providers` | `id`, `type`, `name`, `enabled`, `priority`, `credentials_enc`, `quota_unit`, `quota_limit`, `quota_period`, `reset_timezone`, `cooldown_until` | Cấu hình và trạng thái từng provider |
| `usage_counters` | `provider_id`, `period_start`, `units_used`, `requests` | Bộ đếm quota theo từng chu kỳ |
| `translation_cache` | `hash`, `source_lang`, `target_lang`, `source_text`, `translated_text`, `provider_id`, `hits`, `last_hit_at` | Cache bản dịch |
| `request_logs` | `id`, `ts`, `gateway_key_id`, `target_lang`, `chars`, `provider_id`, `status`, `fallback_chain`, `latency_ms` | Lịch sử request cho trang Logs |
| `gateway_keys` | `id`, `name`, `key_hash`, `created_at`, `revoked_at` | Key cấp cho Postman và extension |
| `settings` | `key`, `value` | Mật khẩu admin (đã băm), ngưỡng an toàn |

- **Khóa cache:** SHA-256 của `source_lang + target_lang + văn bản đã chuẩn hóa` (cắt khoảng trắng thừa). Cache theo từng đoạn chứ không theo cả request, nên các đoạn lặp lại giữa các trang đều được dùng lại.
- **Đơn vị quota:** `quota_unit` nhận `chars`, `requests` hoặc `neurons`, vì mỗi bên đếm một kiểu. Bộ đếm tăng theo đơn vị của chính provider đó.
- **Đặt lại quota:** không cần tác vụ định kỳ. Khi kiểm tra quota, gateway tính `period_start` hiện tại theo `quota_period` và `reset_timezone`; chu kỳ mới tự có bộ đếm bằng 0.
- **Bảo vệ key:** `credentials_enc` được mã hóa AES-256-GCM bằng khóa lấy từ biến môi trường `MASTER_KEY`. Gateway key chỉ lưu dạng băm.

## Cấu trúc repo

Repo là một monorepo dùng pnpm workspaces với ba ứng dụng và một gói kiểu dữ liệu dùng chung.

```text
translate-gateway/
├── apps/
│   ├── server/                  # Gateway (Fastify)
│   │   ├── src/
│   │   │   ├── providers/       # Mỗi provider một file adapter
│   │   │   │   ├── types.ts     # Interface TranslationProvider
│   │   │   │   ├── registry.ts  # Ánh xạ type -> adapter
│   │   │   │   ├── gemini.ts
│   │   │   │   ├── openai-compatible.ts   # Groq, OpenRouter, Mistral
│   │   │   │   ├── cloudflare.ts
│   │   │   │   ├── mymemory.ts
│   │   │   │   └── libretranslate.ts
│   │   │   ├── core/
│   │   │   │   ├── router.ts    # Chọn provider, fallback, circuit breaker
│   │   │   │   ├── quota.ts     # Bộ đếm và chu kỳ đặt lại
│   │   │   │   ├── cache.ts
│   │   │   │   ├── chunker.ts   # Cắt và gom đoạn theo giới hạn provider
│   │   │   │   └── crypto.ts    # Mã hóa credentials
│   │   │   ├── routes/
│   │   │   │   ├── public.ts    # /v1/*
│   │   │   │   └── admin.ts     # /admin/api/*
│   │   │   ├── db/              # Schema, migration
│   │   │   └── index.ts
│   │   └── test/
│   ├── admin/                   # React + Vite, build ra file tĩnh
│   │   └── src/pages/           # Providers, Playground, Usage, Logs, Settings
│   └── extension/               # Chrome extension, Manifest V3
│       ├── manifest.json
│       └── src/
│           ├── background.ts    # Service worker, gọi gateway
│           ├── content.ts       # Đọc và thay văn bản trên trang
│           ├── options/         # Nhập URL gateway và gateway key
│           └── popup/
├── packages/
│   └── shared/                  # Kiểu request/response dùng chung
├── docs/
│   └── postman_collection.json
├── docker-compose.yml
├── .env.example                 # MASTER_KEY, ADMIN_PASSWORD, PORT
└── README.md
```

Server phục vụ luôn bản build của admin, nên khi chạy chỉ cần một tiến trình và một cổng.

## Lộ trình

Dự án gồm một giai đoạn khởi tạo, sáu giai đoạn chính làm tuần tự và một giai đoạn deploy tùy chọn; mỗi giai đoạn kết thúc bằng một thứ chạy được và kiểm chứng được. Gateway test được bằng Postman từ giai đoạn 1, admin có từ giai đoạn 4, extension ở giai đoạn 5.

**Giai đoạn 0: Khởi tạo**

Hoàn thành khi: `docker compose up` chạy được và `GET /health` trả 200.

- [ ] Tạo monorepo pnpm, cấu hình TypeScript, ESLint, Prettier
- [ ] Dựng server Fastify với endpoint `/health`
- [ ] Tạo schema SQLite và cơ chế migration
- [ ] Viết `.env.example` và `docker-compose.yml`

**Giai đoạn 1: Gateway tối thiểu với một provider**

Hoàn thành khi: gọi `POST /v1/translate` từ Postman nhận được bản dịch.

- [ ] Định nghĩa interface `TranslationProvider` và registry
- [ ] Viết adapter MyMemory (không cần key nên làm đầu tiên)
- [ ] Viết `chunker` để cắt đoạn theo giới hạn 500 byte
- [ ] Viết endpoint `/v1/translate` có kiểm tra đầu vào
- [ ] Xác thực bằng gateway key, tạm thời đọc từ biến môi trường

**Giai đoạn 2: Nhiều provider, quota và fallback**

Hoàn thành khi: đặt hạn mức của provider đầu thật thấp, gọi liên tiếp và thấy `fallbackChain` chuyển sang provider thứ hai.

- [ ] Viết adapter Gemini với prompt trả về JSON và kiểm tra số phần tử
- [ ] Viết adapter tương thích OpenAI cho Groq và OpenRouter
- [ ] Viết bộ đếm quota theo chu kỳ phút, ngày, tháng
- [ ] Viết router: thứ tự ưu tiên, tạm nghỉ khi 429, circuit breaker khi lỗi
- [ ] Viết unit test cho router bằng provider giả

**Giai đoạn 3: Cache và log**

Hoàn thành khi: gọi lại cùng một văn bản thì nhận `cached: true` và bộ đếm quota không tăng.

- [ ] Viết cache theo từng đoạn với khóa SHA-256
- [ ] Ghi `request_logs` cho mỗi request
- [ ] Thêm endpoint `/v1/providers` trả tình trạng quota

**Giai đoạn 4: Màn hình admin**

Hoàn thành khi: thêm, test và sắp xếp provider hoàn toàn qua giao diện, không cần sửa `.env`.

- [ ] Viết mã hóa credentials và đăng nhập admin
- [ ] Viết các endpoint `/admin/api/providers` và `/test`
- [ ] Dựng trang Providers (thêm, sửa, bật/tắt, kéo thả thứ tự)
- [ ] Dựng trang Playground
- [ ] Dựng trang Usage, Logs, Settings
- [ ] Chuyển gateway key từ biến môi trường sang bảng `gateway_keys`

**Giai đoạn 5: Chrome extension**

Hoàn thành khi: bấm một nút trên trang tiếng Anh bất kỳ và đọc được trang đó bằng tiếng Việt.

- [ ] Dựng khung Manifest V3 và trang options (URL gateway, gateway key)
- [ ] Dịch đoạn văn bản được bôi đen, hiện kết quả trong popup nhỏ
- [ ] Dịch cả trang: thu thập các nút văn bản, gom lô, thay nội dung
- [ ] Chỉ dịch phần đang hiển thị, dịch tiếp khi cuộn
- [ ] Fallback cục bộ bằng Translator API của Chrome khi gateway trả `ALL_PROVIDERS_EXHAUSTED`

**Giai đoạn 6: Hoàn thiện**

Hoàn thành khi: một người lạ đọc README và tự chạy được dự án.

- [ ] Viết adapter Cloudflare Workers AI và LibreTranslate
- [ ] Xuất Postman collection vào `docs/`
- [ ] Viết README: cài đặt, cách lấy key từng provider, cách thêm adapter mới
- [ ] Bổ sung test tích hợp cho luồng dịch đầy đủ

**Giai đoạn 7: Deploy (tùy chọn)**

Hoàn thành khi: extension trên một máy khác dịch được qua URL HTTPS công khai của gateway.

- [ ] Viết `docker-compose.prod.yml` có Caddy làm reverse proxy HTTPS
- [ ] Bật giới hạn tốc độ theo gateway key và khóa tạm đăng nhập admin
- [ ] Viết script sao lưu file SQLite
- [ ] Viết hướng dẫn deploy trong README

## Triển khai

Gateway chạy local trước, nhưng được thiết kế để chuyển lên máy chủ chỉ bằng cách đổi biến môi trường.

- **Đóng gói:** một Docker image chứa server và bản build của admin. File SQLite nằm trên volume gắn ngoài để không mất dữ liệu khi cập nhật image.
- **HTTPS:** bắt buộc khi deploy, vì gateway key đi kèm mọi request. Caddy đứng trước làm reverse proxy và tự cấp chứng chỉ. Nếu chạy từ máy ở nhà thì dùng một dịch vụ tunnel thay cho mở cổng.
- **Biến môi trường:** `MASTER_KEY`, `ADMIN_PASSWORD`, `PORT`, `PUBLIC_URL`, `ADMIN_ORIGIN`.
- **CORS:** extension gọi gateway từ service worker với `host_permissions` nên không phụ thuộc CORS. Gateway chỉ mở CORS cho origin của admin.
- **Giới hạn tốc độ:** mặc định 60 request mỗi phút cho mỗi gateway key, kèm giới hạn kích thước body.
- **Bảo vệ admin:** cookie phiên đặt `HttpOnly`, `Secure`, `SameSite=Strict`; khóa tạm sau 5 lần nhập sai mật khẩu.
- **Sao lưu:** sao chép file SQLite định kỳ và giữ `MASTER_KEY` ở nơi riêng. Mất `MASTER_KEY` thì không giải mã được credentials đã lưu.
- **Nơi host:** chọn khi tới giai đoạn 7. Điều kiện cần là có ổ đĩa bền cho SQLite và đăng ký được mà không cần thẻ.

## Rủi ro và các quyết định đã chốt

Rủi ro lớn nhất là hạn mức miễn phí bị thay đổi hoặc cắt bỏ; thiết kế adapter và quota dạng cấu hình là để chịu được điều đó.

| Rủi ro | Cách xử lý |
| --- | --- |
| Provider đổi hoặc bỏ gói miễn phí | Hạn mức là cấu hình trong admin; thay provider chỉ cần thêm một file adapter |
| LLM trả sai định dạng hoặc thiếu đoạn | Adapter kiểm tra số phần tử, lệch thì coi là lỗi và fallback |
| Lộ API key của provider | Key mã hóa trong database, không bao giờ nằm trong extension, admin chỉ hiện bốn ký tự cuối |
| Người lạ dùng gateway khi deploy lên mạng | Bắt buộc gateway key, giới hạn tốc độ theo key, admin có mật khẩu |
| Nội dung riêng tư bị gửi tới bên thứ ba | Gói miễn phí của một số LLM có thể dùng dữ liệu để huấn luyện; extension cần danh sách trang không dịch |
| Bộ đếm nội bộ lệch với bộ đếm thật của provider | Luôn xử lý lỗi 429 từ provider như nguồn sự thật, bộ đếm nội bộ chỉ để tránh gọi thừa |
| Giọng văn không đồng nhất khi fallback giữa trang | Chấp nhận ở bản đầu; về sau có thể ưu tiên giữ một provider cho cả một trang |

**Quyết định đã chốt**

| Hạng mục | Lựa chọn | Lý do |
| --- | --- | --- |
| Backend | Node.js bản LTS, TypeScript, Fastify | Cùng ngôn ngữ với extension, Fastify nhẹ và có sẵn kiểm tra schema |
| Database | SQLite, truy cập qua Drizzle ORM | Một file duy nhất, schema có kiểu, migration đơn giản |
| Kiểm tra dữ liệu | Zod, schema đặt trong `packages/shared` | Server, admin và extension dùng chung một định nghĩa |
| Admin UI | React, Vite, Tailwind CSS | Phổ biến, nhiều tài liệu, build ra file tĩnh |
| Extension | Manifest V3, TypeScript, build bằng Vite | Chuẩn hiện hành của Chrome |
| Test | Vitest | Chạy được cho cả ba ứng dụng trong monorepo |
| Triển khai | Local trước, sẵn sàng deploy bằng Docker và Caddy | Có thể deploy sau mà không sửa mã |
| Cặp ngôn ngữ chính | Anh sang Việt, ngôn ngữ nguồn tự nhận diện | Giả định theo nhu cầu đọc web; đổi được trong extension |
| Chọn provider | Tự động theo ưu tiên, client có thể ép một provider | Vừa tiện dùng hằng ngày vừa dễ test từng bên |
| Adapter không chính thức | Không đưa vào repo | Tránh vi phạm điều khoản và để repo công khai được |
