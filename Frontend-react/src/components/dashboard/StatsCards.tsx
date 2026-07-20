import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";

// StatsCards: Total/OK/NG — scope เฉพาะ session ปัจจุบันเท่านั้น (เหมือน
// index.html เดิม) ใช้ /api/measurements?session_id=X&result=OK/NG&limit=1
// เอาแค่ `total` ที่ backend คำนวณจาก COUNT(*) มา ไม่ได้ดึง rows จริงมานับเอง
export default function StatsCards({ sessionId }: { sessionId?: number }) {
  const totalQ = useQuery({
    queryKey: ["stats", sessionId, "total"],
    queryFn: () => apiGet<{ total: number }>("/api/measurements", { session_id: sessionId, limit: 1 }),
    enabled: sessionId !== undefined,
  });
  const okQ = useQuery({
    queryKey: ["stats", sessionId, "OK"],
    queryFn: () => apiGet<{ total: number }>("/api/measurements", { session_id: sessionId, result: "OK", limit: 1 }),
    enabled: sessionId !== undefined,
  });
  const ngQ = useQuery({
    queryKey: ["stats", sessionId, "NG"],
    queryFn: () => apiGet<{ total: number }>("/api/measurements", { session_id: sessionId, result: "NG", limit: 1 }),
    enabled: sessionId !== undefined,
  });

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-label">Total</div>
        <div className="stat-value">{totalQ.data?.total ?? 0}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">OK</div>
        <div className="stat-value ok">{okQ.data?.total ?? 0}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">NG</div>
        <div className="stat-value ng">{ngQ.data?.total ?? 0}</div>
      </div>
    </div>
  );
}
