// ตัว fetch กลางที่ทุก hook/page เรียกใช้ — ใช้ relative path ("/api/...") เสมอ
// ไม่ hardcode host เพราะ:
//   - ตอน dev: Vite proxy (ดู vite.config.ts) ส่ง /api/* ไปที่ backend
//     (localhost:8000) ให้อัตโนมัติ
//   - ตอน production: main.py เสิร์ฟทั้งไฟล์ build ของ React และ API จาก
//     origin เดียวกัน (ดู CLAUDE.md หัวข้อ Frontend Framework Migration)
//     relative path เลยใช้ได้ตรงๆ โดยไม่ต้องรู้ IP/port ของเครื่อง server เลย

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // backend ส่ง error กลับมาเป็น {"detail": "..."} เสมอ (FastAPI HTTPException
    // แบบมาตรฐาน) — ดึงข้อความนั้นมาแสดงให้ผู้ใช้อ่านรู้เรื่อง แทนที่จะโชว์
    // แค่ "Request failed"
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // response ไม่ใช่ JSON (เช่น 500 ดิบๆ) — ใช้ statusText ต่อไป
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? "?" +
      new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const res = await fetch(`${path}${qs}`);
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  return handleResponse<T>(res);
}
