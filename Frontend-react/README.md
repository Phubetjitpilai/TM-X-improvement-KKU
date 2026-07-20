# tmx-frontend

React + Vite + TypeScript + React Router + TanStack Query — frontend ใหม่ของ TM-X (กำลังย้ายจาก `Frontend/` เดิม ทีละหน้า ดู `CLAUDE.md` หัวข้อ "Frontend Framework Migration")

สถานะตอนนี้: มีแค่ `/export` ที่ทำงานได้จริง (เรียก `GET /api/export/csv` ของ backend) ส่วน `/` (Dashboard) และ `/edit` (Database Editor) ยังเป็น placeholder รอย้ายทีหลัง

## วิธีติดตั้ง (ต้องทำบนเครื่องที่ต่ออินเทอร์เน็ตได้ — สภาพแวดล้อมที่ใช้เขียนโค้ดนี้ไม่มี network ออกไปหา npm registry เลยติดตั้ง dependency ให้ไม่ได้ ต้องรันเองที่เครื่องคุณ)

```bash
cd Frontend-react
npm install
```

## รันตอน dev

ต้องรัน backend คู่กันด้วย (คนละ terminal):

```bash
# terminal 1 — backend
cd Backend-server
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# terminal 2 — frontend
cd Frontend-react
npm run dev
```

เปิด browser ไปที่ `http://localhost:5173` — คำขอ `/api/*` จะถูก proxy ไปที่ backend (`localhost:8000`) ให้อัตโนมัติ (ดู `vite.config.ts`) ไม่ติด CORS

## Build สำหรับใช้งานจริง

```bash
npm run build
```

จะได้โฟลเดอร์ `dist/` — **ยังห้ามเอาไปแทน `Frontend/` เดิมตอนนี้** เพราะ Dashboard/Edit ยังเป็นแค่ placeholder อยู่ ต้องรอย้ายครบทั้ง 3 หน้าก่อน ถึงจะเปลี่ยน static mount ใน `main.py` ให้ชี้มาที่นี่แทนได้ (ดู `CLAUDE.md`)

## โครงสร้างโฟลเดอร์

```
src/
├── api/client.ts        # fetch wrapper กลาง (GET/POST/PATCH/DELETE) ใช้ relative path เสมอ
├── hooks/
│   ├── useLookups.ts    # ดึง operators/owners/vendors/handlers/package-sizes (cache ด้วย TanStack Query)
│   └── useSSE.ts        # เชื่อม /api/stream, คืนสถานะ connecting/online/offline
├── components/
│   └── Layout.tsx       # topbar + nav ใช้ร่วมกันทุก route
├── pages/
│   ├── DashboardPage.tsx  # placeholder — รอย้ายจาก index.html
│   ├── EditPage.tsx       # placeholder — รอย้ายจาก edit.html
│   └── ExportPage.tsx     # ใช้งานได้จริงแล้ว — เรียก /api/export/csv
├── App.tsx               # ตั้ง route "/", "/edit", "/export"
└── main.tsx              # entry point, ตั้ง QueryClientProvider
```

## หมายเหตุ

โค้ดชุดนี้เขียนโดยไม่ได้รัน `npm install`/`npm run build` จริงเลยสักครั้ง (สภาพแวดล้อมที่เขียนไม่มี network ออกไปหา npm registry) จึงยังไม่ผ่านการคอมไพล์ยืนยันจริง — ถ้ารัน `npm run dev` หรือ `npm run build` แล้วเจอ type error หรือ import ผิดจุดไหน แจ้งข้อความ error มาได้เลย แก้ให้ต่อได้ทันที
