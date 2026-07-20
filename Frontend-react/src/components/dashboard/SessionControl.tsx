import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, ApiError } from "../../api/client";
import { useToast } from "../Toast";
import type { SessionState } from "../../hooks/useSessionState";

// SessionControl: การ์ดบนสุดของ Dashboard — โชว์สถานะ (idle/running/stopped/
// timeout) และปุ่ม Stop (ปุ่ม Start ย้ายไปรวมกับฟอร์ม Part Entry แทน — ดู
// หมายเหตุใน DashboardPage.tsx เรื่องที่ทำให้ flow ง่ายขึ้นกว่า index.html เดิม
// ที่แยกปุ่ม Start ออกจากฟอร์ม Part Entry)
export default function SessionControl({ session }: { session: SessionState | undefined }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const state = session?.state ?? "idle";

  const stopMutation = useMutation({
    mutationFn: () => apiPost("/api/session/stop", { session_id: session?.session_id }),
    onSuccess: () => {
      show("หยุด session แล้ว");
      qc.invalidateQueries({ queryKey: ["session-state"] });
    },
    onError: (err) => show(err instanceof ApiError ? err.message : "หยุดไม่สำเร็จ"),
  });

  return (
    <div className="card">
      <div className="card-title">Session Control</div>
      <div className="session-row">
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Status</div>
          <div className={`session-state-badge ${state}`}>{state.toUpperCase()}</div>
        </div>
        {state === "running" && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button type="button" className="btn-danger" disabled={stopMutation.isPending} onClick={() => stopMutation.mutate()}>
              ■ Stop
            </button>
          </div>
        )}
      </div>
      {state === "running" && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          ALPL ปัจจุบัน: <strong style={{ color: "var(--text)" }}>{session?.number_alpl ?? "—"}</strong> — วัดแล้ว{" "}
          {session?.measured_count ?? 0} / {session?.target_count ?? 0}
        </div>
      )}
    </div>
  );
}
