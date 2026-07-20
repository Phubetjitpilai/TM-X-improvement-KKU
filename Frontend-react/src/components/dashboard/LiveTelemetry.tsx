export interface TelemetryData {
  number_alpl: number;
  value_x: number;
  value_y: number;
  result: "OK" | "NG";
  measured: number;
  target: number;
}

// LiveTelemetry: โชว์ค่าวัดล่าสุดที่ได้จาก SSE event "measurement" (ดู
// DashboardPage.tsx ที่รับ event แล้วส่งมาเป็น prop) ไม่ได้ query เอง เพราะ
// ค่านี้มีเฉพาะตอนกำลัง running จริงๆ เท่านั้น ไม่มี endpoint แยกให้ query ย้อนหลัง
export default function LiveTelemetry({ telemetry }: { telemetry: TelemetryData | null }) {
  const resultClass = telemetry ? (telemetry.result === "OK" ? "ok" : "ng") : "";

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Live Telemetry
        </div>
        <span
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--accent)",
            background: "var(--surface2)",
            padding: "0.2rem 0.7rem",
            borderRadius: 999,
          }}
        >
          ALPL {telemetry?.number_alpl ?? "—"}
        </span>
      </div>
      <div className="telemetry-grid">
        <div className="telemetry-xy-col">
          <div className="telemetry-cell x">
            <div className="tc-label">Value X</div>
            <div className="tc-value">{telemetry ? telemetry.value_x.toFixed(3) : "—"} mm</div>
          </div>
          <div className="telemetry-cell y">
            <div className="tc-label">Value Y</div>
            <div className="tc-value">{telemetry ? telemetry.value_y.toFixed(3) : "—"} mm</div>
          </div>
        </div>
        <div className={`telemetry-result-col ${resultClass}`}>
          <div style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Result</div>
          <div className={`telemetry-result-value ${resultClass}`}>{telemetry?.result ?? "—"}</div>
        </div>
      </div>
      <div className="telemetry-footer">
        <span>Session</span>
        <strong>
          {telemetry ? `${telemetry.measured} / ${telemetry.target}` : "— / —"} measured
        </strong>
      </div>
    </div>
  );
}
