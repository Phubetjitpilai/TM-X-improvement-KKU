import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import Modal from "../Modal";

interface MeasurementRow {
  measurement_id: number;
  number_alpl: number;
  value_x: number;
  value_y: number;
  result: "OK" | "NG";
  timestamp: string;
}

interface PartDetail {
  number_alpl: number;
  part_number: string | null;
  handler: string | null;
  vendor: string | null;
  owner: string | null;
  package_size: string | null;
  nominal_x: number;
  nominal_y: number;
  upper_tol: number;
  lower_tol: number;
}

// ReportModal: เปิดตอนคลิกแถวในตาราง Measurements — ดึงข้อมูล part สดๆ จาก
// backend เสมอ (ไม่ใช้ค่าที่ cache ไว้จากตาราง) กัน tolerance/spec ไม่ตรงกับ
// ปัจจุบันถ้ามีคนแก้ package_size ของ part นี้ทีหลัง
export default function ReportModal({ row, onClose }: { row: MeasurementRow; onClose: () => void }) {
  const partQ = useQuery({
    queryKey: ["part", row.number_alpl],
    queryFn: () => apiGet<PartDetail>(`/api/parts/${row.number_alpl}`),
  });

  const part = partQ.data;
  const resultClass = row.result === "OK" ? "ok" : "ng";

  return (
    <Modal title={`Measurement Report — ALPL ${row.number_alpl}`} onClose={onClose} maxWidth={960}>
      <div style={{ fontSize: "0.83rem", color: "var(--muted)", marginBottom: "1rem" }}>
        {new Date(row.timestamp).toLocaleString("th-TH")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        <div className="card" style={{ background: "var(--surface2)" }}>
          <div className="card-title" style={{ color: "var(--accent)" }}>
            Part Specifications
          </div>
          {partQ.isLoading ? (
            <div>กำลังโหลด…</div>
          ) : !part ? (
            <div style={{ color: "var(--muted)" }}>ไม่พบข้อมูล part</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem 1.25rem", fontSize: "0.85rem" }}>
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Part Number</div>
                <div>{part.part_number ?? "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Package Size</div>
                <div>{part.package_size ?? "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Handler</div>
                <div>{part.handler ?? "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Vendor</div>
                <div>{part.vendor ?? "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Owner</div>
                <div>{part.owner ?? "—"}</div>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.6rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Result</span>
          <span className={`telemetry-result-value ${resultClass}`} style={{ fontSize: "2.6rem" }}>
            {row.result}
          </span>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1", background: "var(--surface2)" }}>
          <div className="card-title" style={{ color: "var(--accent2)" }}>
            Dimensions and Tolerances
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Value X</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.6rem" }}>
                {row.value_x.toFixed(3)} mm
              </div>
              {part && (
                <div className="card" style={{ padding: "0.6rem 0.75rem", fontSize: "0.78rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                    <span>Nominal</span>
                    <span>{part.nominal_x} mm</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                    <span>Range</span>
                    <span>
                      {(part.nominal_x - part.lower_tol).toFixed(3)} – {(part.nominal_x + part.upper_tol).toFixed(3)} mm
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Value Y</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--accent2)", marginBottom: "0.6rem" }}>
                {row.value_y.toFixed(3)} mm
              </div>
              {part && (
                <div className="card" style={{ padding: "0.6rem 0.75rem", fontSize: "0.78rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                    <span>Nominal</span>
                    <span>{part.nominal_y} mm</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                    <span>Range</span>
                    <span>
                      {(part.nominal_y - part.lower_tol).toFixed(3)} – {(part.nominal_y + part.upper_tol).toFixed(3)} mm
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
