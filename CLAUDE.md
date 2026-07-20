# TM-X Measurement System

ระบบอัตโนมัติสำหรับตรวจวัดมิติ (Dimensional Inspection) ของชิ้นงาน ALPL (IPM) ที่ใช้จัดแนว IC Lead กับ Contact Pin บนเครื่องทดสอบ 2 แพลตฟอร์ม (HT9046, HT9046MX) โดยมาแทนที่กระบวนการแมนนวลที่ทำผ่าน KEYENCE TM-X5065 Vision Controller เดิม


โปรเจกต์นี้เป็นทั้งระบบใช้งานจริงในห้อง PM Kit ของ Analog Devices (ADI) Thailand และเป็นผลงาน Capstone ของนักศึกษาฝึกงาน

---

## สถาปัตยกรรมระบบ

```
┌──────────────┐   HTTP (REST)    ┌──────────────────┐   SSE (server→client)   ┌──────────────┐
│   Frontend   │ ───────────────▶ │  Backend-server    │ ─────────────────────▶ │  Operator     │
│ (React SPA)  │ ◀─── SSE ─────── │     (FastAPI)      │                         │  Browser      │
└──────────────┘                  └──────────────────┘
                                          │
                                  MySQL   │  (รันบนเครื่องโดยตรง — เลิกใช้ Docker แล้ว)
                                  (data)  │
                                          ▼
                                   ┌──────────────┐
                                   │   MySQL DB   │
                                   └──────────────┘
                                          ▲
                                          │ HTTP (POST /api/measurements, heartbeat)
                                          │
                                   ┌──────────────────────┐   TCP + FTP (agent.py ต่อจริงแล้ว) ┌────────────────┐
                                   │ Backend-pc_station/    │ ─────────────────────────▶ │ KEYENCE TM-X5065│
                                   │     agent.py (บน Pi)     │ ◀───────────────────────── │  + MCU (Serial) │
                                   └──────────────────────┘                              └────────────────┘
```

- **Frontend → Backend**: HTTP request ปกติ (POST /api/session/start, /api/session/stop ฯลฯ)
- **Backend → Frontend**: Server-Sent Events (SSE) ทางเดียว ผ่าน `/api/stream`
- **Backend ↔ Agent**: HTTP — Backend สั่ง Agent ผ่าน `POST /command` (action: start/stop), Agent ส่งค่าที่วัดได้กลับผ่าน `POST /api/measurements`, heartbeat ผ่าน `POST /api/heartbeat`, และรูปภาพผ่าน `POST /api/measurements/{id}/image-upload` (multipart)
- **Agent ↔ TM-X Controller**: TCP (สั่งวัด/ขอค่า) + FTP (Agent เปิดเป็น FTP server ของตัวเองรอ TM-X ส่งรูปเข้ามา) — `agent.py` ต่อฮาร์ดแวร์จริงแล้ว (รันบน Raspberry Pi), เหลือแค่ `agent_mock_up.py` ที่ยังเป็น mock
- **รูปภาพ (image storage)**: **เลิกใช้ MinIO แล้ว** ดีไซน์สรุปแล้ว — Agent (บน Pi) รับรูปจาก TM-X ผ่าน FTP แบบ single-shot-per-trigger เก็บพักที่ `Store_image_temporary/` ชั่วคราว แล้วอัปโหลด (HTTP multipart) ไปที่ Backend (บน PC) ผ่าน `POST /api/measurements/{id}/image-upload` — Backend เซฟไฟล์จริงลง `ALPL_IMAGE_DIR` (ค่าเริ่มต้น `ALPL/`) แยกโฟลเดอร์ย่อยตาม `package_size` แล้วอัปเดต `measurements.image_path` เป็น relative path เสิร์ฟผ่าน static mount `/media/alpl`

---

## โครงสร้างโปรเจกต์

```
TM-X_Project/
├── Backend-server/              # FastAPI backend (Single Source of Truth)
│   ├── main.py
│   └── requirements.txt
├── Backend-pc_station/          # Agent ที่รันอยู่บน Raspberry Pi หน้างาน คุยกับ TM-X/MCU (agent.py) + รับรูปผ่าน FTP ของตัวเอง
│   ├── agent.py                 # ของจริง — ต่อ TCP/FTP กับ TM-X แล้ว (ftp.py logic ถูกรวมเข้ามาที่นี่)
│   ├── agent_mock_up.py         # โหมด mock (สุ่มค่า value_x/value_y) สำหรับเทสต์ไม่มีฮาร์ดแวร์
│   └── ftp.py                   # สคริปต์ทดสอบ FTP เดี่ยวๆ (เหลือไว้อ้างอิง ไม่ได้ถูกเรียกจากระบบจริงแล้ว)
├── Frontend/                    # Web Dashboard สำหรับ Operator (ของเดิม ยังใช้งานจริงอยู่ — ดูหัวข้อ Frontend)
│   ├── index.html               # หน้าหลัก: Live Telemetry, Part Entry, Camera Preview
│   ├── edit.html                # Database Editor (Parts/Measurements CRUD)
│   └── export.html              # หน้า Export ข้อมูล (CSV, placeholder)
├── Frontend-react/              # โปรเจกต์ React ใหม่ (Vite+TS+Router+TanStack Query) — กำลังย้ายมาแทน Frontend/ ทีละหน้า ยังไม่ deploy จริง (ดู Frontend-react/README.md)
├── mysql-init/
│   ├── init.sql                 # Schema (เดิม auto-run ตอน MySQL container start — ตอนนี้ MySQL รันบนเครื่องโดยตรง ต้อง import เองด้วยมือ)
│   └── insert.sql                # Seed ข้อมูลตั้งต้นของตาราง lookup (operator/owner/handler/vendor/package_size)
├── image_ALPL/                  # แหล่งภาพอ้างอิงของแต่ละ ALPL (ใช้เทียบ/แสดงผล)
├── Store_image_temporary/       # โฟลเดอร์พักภาพชั่วคราวบน Agent/Pi หลัง FTP รับจาก TM-X มา ก่อนอัปโหลดต่อให้ Backend แล้วลบทิ้ง
├── ALPL/                        # ที่เก็บรูปถาวรบนเครื่อง PC (Backend) แยกโฟลเดอร์ย่อยตาม package_size — สร้างอัตโนมัติโดย main.py (ดู ALPL_IMAGE_DIR)
├── TM-X_simulation/             # โปรแกรมจำลอง TM-X Controller (สำหรับเทสต์ตอนยังไม่มีฮาร์ดแวร์จริง)
│   ├── tm-x.py
│   └── requirements.txt
├── docker-compose.yml           # ⚠️ Legacy — เดิมรัน MySQL+MinIO ผ่าน Docker ตอนนี้ไม่ใช้แล้ว (MySQL รันบนเครื่องโดยตรง, MinIO เลิกใช้) ไฟล์ยังไม่ได้ลบออกจาก repo
└── .env                         # Config กลาง (DB, Agent, TM-X, Heartbeat, โฟลเดอร์พักภาพชั่วคราว)
```

---

## Tech Stack

| Layer | Tools |
|---|---|
| Backend | Python 3.11, FastAPI, Pydantic, httpx, pymysql, pandas, sse-starlette, python-dotenv |
| Database | MySQL 8.0 (รันบนเครื่องโดยตรง — เลิกใช้ Docker แล้ว) |
| Image Storage | ดีไซน์สรุปแล้ว (เลิกใช้ MinIO) — ไฟล์จริงบนดิสก์ 2 จุด: `Store_image_temporary/` พักชั่วคราวบน Agent/Pi, `ALPL_IMAGE_DIR` (`ALPL/`) เก็บถาวรบน PC แยกโฟลเดอร์ตาม package_size, ส่งข้ามเครื่องด้วย HTTP multipart upload |
| Frontend | React (Vite) + React Router (SPA) + TanStack Query (react-query) — กำลังย้ายจาก Vanilla JS เดิม (ดูหัวข้อ "Frontend Framework Migration") |
| Realtime | Server-Sent Events (SSE) |
| Hardware (เป้าหมาย ยังไม่ต่อจริง) | KEYENCE TM-X5065 (TCP), FTP สำหรับภาพ, MCU ผ่าน Serial |
| Infra | ไม่มี container แล้ว — MySQL รันเป็น local service บนเครื่อง PC โดยตรง (`docker-compose.yml` ยังอยู่ใน repo แต่เป็น legacy ไม่ได้ใช้งาน) |
| Reporting (แยกจากระบบนี้) | Power BI (DAX, ตาราง `combined_3_fixed`) |

**สำคัญ**: ต้องใช้ Python 3.11 เท่านั้น (3.14 ใช้ไม่ได้กับ dependency บางตัว)

---

## Database Schema (`mysql-init/init.sql`)

3 ตาราง ความสัมพันธ์: `parts (1) → (N) sessions (1) → (N) measurements`

- **`parts`**: PK = `number_alpl` (1 ALPL = 1 vendor/handler/package เสมอ) **ไม่ได้เก็บ nominal/tolerance เอง** — ผูกกับ `package_size` ผ่าน `package_size_id` แทน
- **`package_size`**: เก็บ `nominal_x`, `nominal_y` และ tolerance **ตัวเดียวใช้ร่วมกันทั้งแกน X/Y** (`upper_tol`, `lower_tol` — ไม่ได้แยกราย axis) พร้อม `template_name` (โปรแกรมวัดของ TM-X ที่ผูกกับขนาด package นี้)
- **`sessions`**: 1 รอบการวัด state = `idle | running | stopped | timeout`, มี `target_count`/`measured_count` ใช้เช็คว่าวัดครบหรือยัง
- **`measurements`**: ผลวัดแต่ละชิ้น มี `value_x`, `value_y`, `result` (OK/NG), `measure_type` (IPM/New/Rework/Manual), `image_path` (relative path ใต้ `ALPL_IMAGE_DIR` บนเครื่อง PC เช่น `"3x3/42_1028.jpg"` — ไม่ใช่ MinIO แล้ว เสิร์ฟผ่าน static mount `/media/alpl`)
  - หมายเหตุ (อัปเดต): คอลัมน์ operator **ไม่ใช่ `Oparetor` (VARCHAR สะกดผิด) แบบเดิมแล้ว** — ตอนนี้เป็น `operator_id` (FK ไปตาราง `operator` ที่เก็บ `operator_name`) เอกสารเดิมพูดถึง `Oparetor` เพราะเป็นข้อมูลเก่าก่อน migrate ตอนนี้ล้าสมัยแล้ว

---

## Backend (`Backend-server/main.py`)

รันด้วย:
```bash
cd Backend-server
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

หลักการออกแบบที่สำคัญ (ต้องเข้าใจก่อนแก้โค้ด):

1. **FastAPI คือ Single Source of Truth** — สถานะทั้งหมด (session, measurement) อยู่ที่ backend เท่านั้น Agent ไม่เขียนลง DB ตรงๆ เลย
2. **`session_queues` (in-memory dict)** — เก็บคิว ALPL + ตำแหน่งปัจจุบันของแต่ละ session (โหมด IPM/New) เพราะ schema ตาราง `sessions` เก็บแค่ `number_alpl` ตัวเดียว (ALPL แรกของคิว)
   - **ความเสี่ยงที่รู้อยู่แล้ว**: ถ้า server restart กลางที่ session กำลัง running คิวนี้จะหาย ยังไม่มีการ persist ลง DB
3. **Stop flow ไม่สมมาตร (asymmetry)** — กด Stop จากเว็บ จะอัปเดต DB (`state='stopped'`) + แจ้ง Agent แต่ปุ่ม Stop ทางกายภาพที่ MCU ตอนนี้แค่ flip flag ใน memory ฝั่ง Agent เท่านั้น **ไม่ได้อัปเดต DB** — เป็น gap สถาปัตยกรรมที่ต้อง flag ไว้เวลา present งาน
4. **SSE เป็นทางเดียว** server → client เท่านั้น (`/api/stream`) ฝั่ง frontend ยังคงใช้ HTTP POST ปกติในการส่งคำสั่งไป backend (ไม่ใช่ bidirectional)
5. **MeasurementType: IPM vs New**
   - `IPM`: ALPL ลงทะเบียนไว้แล้วใน `parts` → query หา `template_name` อย่างเดียว ไม่ insert part ใหม่
   - `New`: ลงทะเบียน part ใหม่ + วัดในรอบเดียว → ต้อง insert `parts` ก่อน insert `sessions` เสมอ (เพราะมี FOREIGN KEY)
6. **Agent ไม่รู้ว่ากำลังวัด ALPL ตัวไหนในคิว** — แค่ส่ง `value_x`/`value_y` มาเรื่อยๆ Backend เป็นคนจับคู่ ALPL จากตำแหน่งใน `session_queues` เอง (ยกเว้น manual session แบบเก่าที่ไม่มี entry ใน `session_queues` จะใช้ `req.number_alpl` ที่ Agent ส่งมาตรงๆ)
7. **Heartbeat checker** (background task) — ตรวจทุก `HEARTBEAT_INTERVAL` วินาที ถ้า session ไหน `state='running'` แต่ `last_seen` เก่ากว่า `HEARTBEAT_TIMEOUT` → เปลี่ยนเป็น `timeout` และ broadcast ผ่าน SSE

### Endpoint หลัก
- `GET /api/stream` — SSE stream
- `GET /api/session/state`, `POST /api/session/start`, `POST /api/session/stop`
- `POST /api/heartbeat`
- `GET/POST/PATCH/DELETE /api/parts`, `/api/parts/{id}`
- `GET/POST/PATCH/DELETE /api/measurements`, `/api/measurements/{id}`, `PATCH /api/measurements/{id}/image`
- `POST /api/measurements/{id}/image-upload` — รับไฟล์รูป (multipart, `UploadFile`) จาก Agent เซฟลง `ALPL_IMAGE_DIR/<package_size>/<measurement_id>_<number_alpl><ext>` แล้วอัปเดต `measurements.image_path` เป็น relative path + broadcast SSE event `image_updated`
- `GET /api/image-url/{measurement_id}` — คืน `{"url": "/media/alpl/<image_path>"}` จริงแล้ว (ไม่ใช่ stub อีกต่อไป) หรือ 404 ถ้ายังไม่มีรูป ส่วน `POST /api/upload-url` เดิม (MinIO presigned URL) ถูกลบออกจากโค้ดไปแล้ว ไม่มีอยู่อีกต่อไป
- `GET /api/export/csv` — export พร้อม filter (ใช้ filter ชุดเดียวกับ `list_measurements`)

---

## Agent (`Backend-pc_station/agent.py`)

รันด้วย:
```bash
cd Backend-pc_station
pip install -r requirements.txt
python agent.py
```

- **`agent.py` รันบน Raspberry Pi ต่อฮาร์ดแวร์จริงแล้ว** — คุย TCP กับ TM-X (`TMX_HOST`/`TMX_PORT`) ส่ง template name ตอน Start แล้วรอ trigger (ปัจจุบันจำลองด้วยการกด Enter ที่ terminal แทนสัญญาณจาก MCU จริง) เพื่ออ่านค่า `value_x`/`value_y` ทีละชิ้น — ส่วน `agent_mock_up.py` (mock, สุ่มค่าแทนการรอฮาร์ดแวร์) ยังเก็บไว้แยกต่างหากสำหรับเทสต์ไม่มีฮาร์ดแวร์
- ฟังก์ชันสื่อสารกับฮาร์ดแวร์จริง (`_ensure_tcp`, `tcp_write`, `tcp_readline`, `_init_serial`, `send_serial`, `serial_reader_loop`) ใช้งานจริงแล้วใน `agent.py`
- รับคำสั่งจาก Backend ผ่าน HTTP server ของตัวเอง (`POST /command`, action: `start`/`stop`) — ฟัง port ตาม `AGENT_PORT`
- ส่ง heartbeat กลับ backend ทุก `HEARTBEAT_INTERVAL` วินาที พร้อม `session_id` ปัจจุบัน
- **รูปภาพ**: `agent.py` เปิด FTP server ของตัวเอง (`SingleShotImageHandler`, ฟัง `AGENT_FTP_HOST`/`AGENT_FTP_PORT`) รอ TM-X ส่งรูปเข้ามา — ปกติล็อกไม่ให้อัปโหลด จนกว่า `arm_image_capture()` จะถูกเรียกตอนเริ่ม trigger วัดแต่ละชิ้น (ปลดล็อกรับได้ 1 ใบ, timeout ตาม `IMAGE_WAIT_TIMEOUT`) ไฟล์ที่รับมาพักไว้ที่ `TEMP_IMAGE_DIR` (`Store_image_temporary/`) แล้ว `upload_image_to_backend()` อัปโหลดต่อไปที่ `POST /api/measurements/{id}/image-upload` ของ Backend (HTTP multipart) จากนั้นลบไฟล์ temp ทิ้งเสมอ — ดีไซน์เดิมที่ทดสอบแยกไว้ใน `ftp.py` ถูกรวมเข้ามาที่นี่แล้ว (`ftp.py` เหลือไว้เป็นสคริปต์ทดสอบเดี่ยวๆ ไม่ได้ถูกเรียกจากระบบจริงอีกต่อไป)
- `/simulate/object-ready` — endpoint ไว้ test ตอนยังไม่มีฮาร์ดแวร์ (ไม่มีความหมายแล้วสำหรับ `agent.py` ที่ต่อฮาร์ดแวร์จริง เพราะรอ trigger จริงแทน)

---

## Frontend (`Frontend/`)

> **สถานะ**: ย้ายครบทั้ง 3 หน้าแล้ว (ยังไม่ verify การ build/รันจริงครบ 100%) — โปรเจกต์ React ใหม่อยู่ที่ `Frontend-react/` (Vite + TypeScript + React Router + TanStack Query) **Export และ Edit ใช้งานได้จริงแล้ว** (Parts/Measurements CRUD ครบ, ล็อกตอน session running, value_x/value_y แก้ไม่ได้) **Dashboard (Home) ย้ายมาแล้วเช่นกัน** (Session Control, Live Telemetry ผ่าน SSE, Part Entry 3 โหมด IPM/New/Rework, Stats, ตาราง Measurements + Report modal) — หมายเหตุ: ปุ่ม Save กับ Start ของ Part Entry เดิมที่แยกกัน 2 ขั้นตอน ถูกรวมเป็นปุ่มเดียว "▶ Start" เพื่อลดความซับซ้อนของ UI (ดูรายละเอียดใน `PartEntry.tsx`) ไฟล์ .html เดิมด้านล่างนี้**ยังเป็นของจริงที่ใช้งานอยู่** (`main.py` ยังเสิร์ฟจาก `Frontend/` เดิม ไม่ใช่ `Frontend-react/`) จนกว่าจะทดสอบ React ฝั่งนี้จนมั่นใจแล้วค่อยสลับ static mount ดูแผนที่หัวข้อ "Frontend Framework Migration" ท้ายหัวข้อนี้

ปัจจุบัน (ก่อนย้าย) — Single-file vanilla JS ทุกหน้า ธีมสว่าง (light theme)

- **`index.html`** — Dashboard หลัก: Live Telemetry (รับผ่าน SSE), Part Entry modal (เลือกโหมด IPM/New แล้วกด Start), Camera Preview, System Diagnostics, Stats card (scope เฉพาะ session ปัจจุบัน)
- **`edit.html`** — Database Editor จัดการตาราง Parts/Measurements (Add/Edit/Delete ผ่าน modal forms)
- **`export.html`** — หน้า export ข้อมูลเป็น CSV (ปัจจุบันเป็นแค่ placeholder "Coming soon" — logic ฝั่ง backend `/api/export/csv` ทำงานได้จริงแล้ว แต่ยังไม่มีหน้าเว็บเรียกใช้)

### Frontend Framework Migration (แผนที่ตกลงกันไว้)

- **เครื่องมือที่เลือก**: React + Vite (build tool, ไม่ใช้ Next.js เพราะไม่ต้องการ server-side rendering) + TanStack Query (react-query) สำหรับดึง/cache/refetch ข้อมูลจาก backend แทนการเขียน fetch + loading/error state เอง
- **เหตุผลที่ย้าย**: โค้ด vanilla JS เดิมยาวเกินไป (`index.html` ~2,552 บรรทัด) และมีโค้ดซ้ำระหว่าง `index.html`/`edit.html` หลายจุด (fetch dropdown operators/vendors/handlers/owners/package-sizes ซ้ำกันคนละชุด, pattern "fetch แล้วต้อง refetch เองหลัง save/delete" ซ้ำทุกตาราง)
- **ลำดับการย้าย** (ทีละหน้า ไม่ทำพร้อมกันหมด): `export.html` ก่อน (ยังเป็นแค่ placeholder เสี่ยงน้อยสุด ใช้ทดสอบ toolchain + ถือโอกาสสร้างหน้า export ที่เรียก `/api/export/csv` จริง) → `edit.html` (CRUD ตรงไปตรงมา ฝึก pattern) → `index.html` (ซับซ้อนสุด ย้ายท้ายสุด)
- **shared code ที่ควรทำเป็น hook/component กลางตั้งแต่แรก**: `useLookups()` (ดึง operators/owners/vendors/handlers/package-sizes ครั้งเดียวใช้ทุกหน้า), `useSSE()` (เชื่อม `/api/stream`), `<Pagination>` / `<Modal>` / `<ConfirmDialog>` / `<Toast>`
- **การ deploy ไม่เปลี่ยนสถาปัตยกรรม**: `npm run build` ได้โฟลเดอร์ `Frontend/dist/` แล้วเปลี่ยน static mount ท้าย `main.py` (`app.mount("/", StaticFiles(directory=_frontend_dir, html=True))`) ให้ชี้ไปที่ `Frontend/dist` แทน `Frontend/` — backend ยังเป็น process เดียว (uvicorn) เหมือนเดิม เครื่อง PC หน้างานไม่ต้องมี Node.js ติดตั้ง (Node ใช้แค่ตอน dev/build บนเครื่องที่เขียนโค้ด)
- **ระหว่าง dev**: ต้องรัน 2 อย่างพร้อมกัน — `uvicorn main:app` (port 8000, API) และ `npm run dev` (Vite dev server, port 5173, หน้า React ที่กำลังแก้) — เรียกข้าม port ได้เพราะ `main.py` เปิด CORS `allow_origins=["*"]` ไว้แล้ว
- **ตัดสินใจแล้ว**: ใช้ **SPA เดียว + React Router** (`react-router-dom`) แทนการแยก build หลายหน้าแบบเดิม — route `/` (Dashboard), `/edit` (Database Editor), `/export` (Export) อยู่ใน React app เดียวกัน แชร์ layout/topbar เดียวกันได้ทันที ไม่ต้อง copy topbar markup ซ้ำ 3 ไฟล์แบบ index.html/edit.html/export.html เดิม

---

## Environment Variables (`.env`)

| ตัวแปร | ใช้ที่ | คำอธิบาย |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | Backend | การเชื่อมต่อ MySQL (รันบนเครื่องโดยตรง — port default 3306 ไม่ใช่ 3307 ของ Docker เดิมแล้ว) |
| `BACKEND_URL` | Agent | URL ของ Backend (สำหรับ Agent ยิง measurement/heartbeat กลับ) — ถ้า Agent อยู่คนละเครื่อง (เช่น Raspberry Pi) ต้องเปลี่ยนเป็น IP ของเครื่อง PC ที่รัน Backend |
| `AGENT_HOST` | Backend | ที่อยู่ของเครื่องที่ Agent รันอยู่ (ทิศตรงข้ามกับ `BACKEND_URL`) — default `localhost` (เทสต์เครื่องเดียวได้ปกติ) เปลี่ยนเป็น IP ของ Raspberry Pi เมื่อแยกเครื่องจริง |
| `AGENT_PORT` | Backend, Agent | Port ที่ Agent HTTP server ฟังอยู่ |
| `SERIAL_PORT`, `SERIAL_BAUD` | Agent | การเชื่อมต่อ MCU ผ่าน Serial (ยังไม่ใช้จริง) |
| `TMX_HOST`, `TMX_PORT` | Agent | TCP ของ TM-X Controller (ต่อจริงแล้วที่ `192.168.10.11:8600`) |
| `TEMP_IMAGE_DIR` | Agent (Pi) | โฟลเดอร์พักภาพชั่วคราวหลัง FTP รับจาก TM-X มา ก่อนอัปโหลดต่อให้ Backend แล้วลบทิ้ง (default `./Store_image_temporary`) |
| `ALPL_IMAGE_DIR` | Backend (PC) | ที่เก็บรูปถาวร แยกโฟลเดอร์ย่อยตาม `package_size` อัตโนมัติ (default `TM-X_Project/ALPL/`) |
| `AGENT_FTP_HOST`, `AGENT_FTP_PORT` | Agent (Pi) | ที่อยู่/พอร์ตของ FTP server ที่ Agent เปิดเองรอรับรูปจาก TM-X (default port `2121` เพราะ Linux ต้องเป็น root ถึง bind พอร์ต < 1024 ได้ — เปลี่ยนเป็น `21` แล้วรัน `sudo` ได้ถ้า TM-X ตั้งปลายทางตายตัวที่ 21) |
| `AGENT_FTP_USER`, `AGENT_FTP_PASS` | Agent (Pi) | บัญชีที่ TM-X ใช้ล็อกอินเข้า FTP server ของ Agent |
| `AGENT_IMAGE_WAIT_TIMEOUT` | Agent (Pi) | เวลารอรูปสูงสุดหลัง trigger (วินาที) ก่อนจะยอมวัดต่อโดยไม่มีรูป |
| `HEARTBEAT_INTERVAL`, `HEARTBEAT_TIMEOUT` | Backend, Agent | ความถี่ heartbeat / timeout threshold |

> หมายเหตุ: ตัวแปร `MINIO_*` ทั้งหมดถูกถอดออกจากโค้ดแล้ว (เลิกใช้ MinIO) — ถ้าเห็นใน `.env` เก่าที่ยังไม่ได้อัปเดต ลบทิ้งได้เลย ไม่มีโค้ดจุดไหนอ่านค่านี้อีกต่อไป

> **อย่า commit `.env` จริงขึ้น repo** — ไฟล์ตัวอย่างควรเป็น `.env.example` ที่ไม่มีรหัสผ่านจริง

---

## วิธีรันทั้งระบบ (Local Dev)

```bash
# 1. ต้องมี MySQL รันอยู่บนเครื่องแล้ว (ไม่ใช้ Docker แล้ว) — ถ้ายังไม่เคย import
#    schema ให้รัน mysql-init/init.sql แล้วตามด้วย mysql-init/insert.sql เข้า
#    ฐานข้อมูล tmx_db ด้วยตัวเองก่อน (เดิม auto-run ตอน Docker container start
#    ครั้งแรก แต่ตอนนี้ไม่มี Docker แล้วต้อง import เอง เช่นผ่าน mysql CLI หรือ
#    MySQL Workbench)

# 2. รัน Backend (terminal ที่ 1)
cd Backend-server
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 3. รัน Agent (terminal ที่ 2, ปกติรันบน Raspberry Pi หน้างาน)
cd Backend-pc_station
pip install -r requirements.txt
python agent.py            # ต่อฮาร์ดแวร์ TM-X จริง (TCP+FTP) — ใช้งานจริงแล้ว
# หรือ python agent_mock_up.py ถ้ายังไม่มีฮาร์ดแวร์ (สุ่มค่าแทน)

# 4. รัน Frontend
# ก่อนย้าย React เสร็จ: เปิดไฟล์ Frontend/index.html ผ่าน browser โดยตรง (หรือให้
# backend เสิร์ฟผ่าน StaticFiles mount ที่มีอยู่แล้วที่ localhost:8000)
# หลังย้าย React เสร็จ: cd Frontend && npm install && npm run dev (terminal ที่ 3
# แยกจาก backend ระหว่าง dev — ดูหัวข้อ Frontend Framework Migration)
```

ตรวจ Python version ก่อนเสมอ: ต้องเป็น **3.11**

---

## Known Issues / งานที่เหลือ

- [ ] `session_queues` ไม่ persist ลง DB — หายเมื่อ server restart กลาง session
- [ ] Stop flow ไม่สมมาตร — ปุ่มกายภาพไม่อัปเดต DB เหมือนปุ่มบนเว็บ
- [ ] `edit.html` ยังเป็น frontend-only mockup (มี `console.log` payload ไว้ ยังไม่เรียก API จริง) — มี TODO marker ค้างอยู่
- [ ] db-editor topbar navigation links (Home, Edit, Export) ยังไม่ครบ
- [ ] Trigger วัดแต่ละชิ้นใน `agent.py` ยังจำลองด้วยการกด Enter ที่ terminal แทนสัญญาณ trigger จริงจาก MCU — รอต่อ MCU ผ่าน Serial จริง
- [ ] Power BI dashboard (`combined_3_fixed`) พัฒนาแยกขนานไปกับ Web Frontend
- [ ] Frontend ย้ายจาก Vanilla JS ไปเป็น React + Vite + TanStack Query ที่ `Frontend-react/` ครบทั้ง 3 หน้าแล้ว (Export, Edit, Dashboard) — ยังไม่ได้ตัดสลับ static mount ใน `main.py` ให้ชี้มาที่นี่ (ยังเสิร์ฟจาก `Frontend/` เดิมอยู่) รอทดสอบผ่านหน้าจอจริงให้ครบทุก flow ก่อน (โดยเฉพาะ Dashboard ที่ซับซ้อนสุด — Part Entry 3 โหมด, SSE) โค้ด Dashboard/Edit เขียนโดยยังไม่เคยผ่าน `npm run build` จริงเช่นกัน (ดูหัวข้อ Frontend Framework Migration)

---

## Conventions สำหรับแก้โค้ด

- คอมเมนต์ในโค้ดเขียนเป็นภาษาไทย ให้คงสไตล์นี้ต่อเวลาแก้ไฟล์เดิม
- คอลัมน์ operator ถูก migrate จาก `Oparetor` (VARCHAR สะกดผิด) ไปเป็น `operator_id` (FK ไปตาราง `operator`) เรียบร้อยแล้ว — ห้าม migrate กลับไปเป็น VARCHAR ตรงๆ โดยไม่คุยกันก่อน
- Tolerance เก็บที่ตาราง `package_size` เป็นค่าเดียวใช้ร่วมกันทั้งแกน X/Y (`upper_tol`, `lower_tol`) — **ไม่ได้แยกราย axis และไม่ได้เก็บที่ `parts`** ห้ามย้ายกลับไปเก็บที่ `parts` หรือแยกเป็น per-axis (`upper_tol_x`/`upper_tol_y` ฯลฯ) โดยไม่คุยกันก่อน
- **Frontend เดิม** (ไฟล์ .html ที่ยังไม่ย้าย — ดูสถานะที่หัวข้อ Frontend): ให้คงเป็น single HTML file ต่อหน้า ห้าม split เป็นหลาย JS/CSS file
- **Frontend ที่ย้ายเป็น React แล้ว**: แยกเป็น component ตามปกติของ React ได้เลย (ไม่ต้องยัดรวมไฟล์เดียวแบบเดิม) ใช้ TanStack Query จัดการ data fetching/cache/invalidate แทนการเขียน fetch + state เอง — ดูรายละเอียดที่หัวข้อ "Frontend Framework Migration"
- ก่อนแก้ตรรกะ session/queue ใน `main.py` ให้อ่าน docstring ภาษาไทยในฟังก์ชันที่เกี่ยวข้องก่อนเสมอ (อธิบายเหตุผลเชิงสถาปัตยกรรมไว้ละเอียด)
