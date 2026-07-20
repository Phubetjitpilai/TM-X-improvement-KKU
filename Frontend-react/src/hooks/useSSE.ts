import { useEffect, useRef, useState } from "react";

export type SSEStatus = "connecting" | "online" | "offline";

// ชื่อ event ทั้งหมดที่ backend (main.py) ยิงผ่าน /api/stream — ต้อง sync
// กับของจริงเสมอ ถ้า backend เพิ่ม event ใหม่ต้องมาเพิ่ม type ตรงนี้ด้วย
// (ดู main.py push_event() ทุกจุดที่เรียก)
export type SSEEventName =
  | "session_started"
  | "measurement"
  | "session_stopped"
  | "session_complete"
  | "session_timeout"
  | "image_updated"
  | "ping";

type Handlers = Partial<Record<SSEEventName, (data: any) => void>>;

// useSSE: เปิด connection ไปที่ /api/stream ครั้งเดียวต่อ component ที่เรียก
// (ปกติเรียกแค่จุดเดียวใน Layout แล้วส่งต่อ status ผ่าน context/props แทนที่จะ
// เปิดซ้ำหลายจุด) คืนค่าสถานะ connecting/online/offline ให้ไปโชว์เป็น badge
// สำคัญ: ต้อง reconnect เองถ้าหลุด (เบราว์เซอร์ EventSource มี auto-reconnect
// ในตัวอยู่แล้ว แต่เราต้องอัปเดต status ตาม readyState ให้ผู้ใช้เห็นด้วย) และ
// ต้อง cleanup (ปิด connection) ตอน component unmount ไม่งั้นจะเปิดค้างซ้อนกัน
export function useSSE(handlers: Handlers = {}) {
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onopen = () => setStatus("online");
    es.onerror = () => {
      // EventSource จะพยายาม reconnect เองอัตโนมัติ — แค่ปรับ badge เป็น
      // offline ระหว่างที่ยังต่อไม่ติด ไม่ต้อง es.close() เอง (ปิดเองจะทำให้
      // ไม่ auto-reconnect อีกเลย)
      setStatus("offline");
    };

    const names: SSEEventName[] = [
      "session_started",
      "measurement",
      "session_stopped",
      "session_complete",
      "session_timeout",
      "image_updated",
      "ping",
    ];
    const listeners = names.map((name) => {
      const listener = (evt: MessageEvent) => {
        if (name === "ping") return; // ping มีไว้ keep-alive เฉยๆ ไม่มี payload ที่ต้องแปลง
        const handler = handlersRef.current[name];
        if (!handler) return;
        try {
          handler(evt.data ? JSON.parse(evt.data) : undefined);
        } catch (err) {
          console.error(`useSSE: parse event "${name}" failed`, err);
        }
      };
      es.addEventListener(name, listener);
      return { name, listener };
    });

    return () => {
      listeners.forEach(({ name, listener }) => es.removeEventListener(name, listener));
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers อ่านผ่าน ref เจตนา ไม่ต้องใส่ dependency
  }, []);

  return status;
}
