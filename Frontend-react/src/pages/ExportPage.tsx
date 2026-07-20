import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";

// ExportPage: หน้าแรกที่ย้ายจริง (ตามลำดับที่ตกลงไว้ — ดู CLAUDE.md หัวข้อ
// Frontend Framework Migration) export.html เดิมเป็นแค่ placeholder
// "Coming soon" — logic ฝั่ง backend (GET /api/export/csv, main.py บรรทัด
// ~1552) ทำงานได้จริงมานานแล้วแต่ไม่เคยมีหน้าเว็บเรียกใช้ หน้านี้คือหน้าแรก
// ที่เรียกใช้จริง ใช้ filter ชุดเดียวกับ GET /api/measurements (number_alpl,
// result, date_from, date_to) ตามที่ backend รองรับ
//
// เพิ่ม dropdown เลือกฟอร์แมต CSV/PDF/Excel — CSV ใช้งานได้จริง (ต่อกับ
// /api/export/csv) ส่วน PDF/Excel backend ยังไม่มี endpoint รองรับ จึงทำเป็น
// หน้าเปล่า "Coming soon" ไว้ก่อนตามที่ขอ

type ExportFormat = "csv" | "pdf" | "excel";

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: "CSV", pdf: "PDF", excel: "Excel" };

interface Filters {
  numberAlpl: string;
  result: "" | "OK" | "NG";
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { numberAlpl: "", result: "", dateFrom: "", dateTo: "" };

function buildParams(f: Filters): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.numberAlpl.trim()) params.number_alpl = f.numberAlpl.trim();
  if (f.result) params.result = f.result;
  if (f.dateFrom) params.date_from = f.dateFrom;
  if (f.dateTo) params.date_to = f.dateTo;
  return params;
}

export default function ExportPage() {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // นับจำนวนที่ตรงกับ filter ปัจจุบันไว้โชว์ก่อนกดดาวน์โหลดจริง (ใช้ endpoint
  // เดียวกับตาราง measurements — limit=1 เพราะสนใจแค่ค่า total ที่ backend คืนมา
  // ไม่ได้จะเอา rows มาแสดง) — สั่งทำงานเฉพาะตอนเลือกฟอร์แมต CSV เท่านั้น
  const params = buildParams(filters);
  const preview = useQuery({
    queryKey: ["export-preview", params],
    queryFn: () => apiGet<{ items: unknown[]; total: number }>("/api/measurements", { ...params, limit: 1 }),
    enabled: format === "csv",
  });

  function handleDownload() {
    const qs = new URLSearchParams(params).toString();
    // ไม่ใช้ fetch เพราะ backend ตอบกลับมาเป็นไฟล์แนบ (Content-Disposition:
    // attachment) — navigate ตรงๆ แบบนี้ browser จะเปิด save dialog ให้เอง
    // โดยไม่ต้อง handle blob เอง
    window.location.href = `/api/export/csv${qs ? `?${qs}` : ""}`;
  }

  function updateField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={{ padding: "1.5rem 2rem" }}>
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-title">Export Measurements</div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1.25rem", maxWidth: 220 }}>
          <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>

        {format === "csv" && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.85rem",
                marginBottom: "1.25rem",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>ALPL Number</label>
                <input
                  type="text"
                  placeholder="เว้นว่าง = ทุก ALPL"
                  value={filters.numberAlpl}
                  onChange={(e) => updateField("numberAlpl", e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Result</label>
                <select value={filters.result} onChange={(e) => updateField("result", e.target.value as Filters["result"])}>
                  <option value="">-- ทั้งหมด --</option>
                  <option value="OK">OK</option>
                  <option value="NG">NG</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>จากวันที่</label>
                <input type="date" value={filters.dateFrom} onChange={(e) => updateField("dateFrom", e.target.value)} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>ถึงวันที่</label>
                <input type="date" value={filters.dateTo} onChange={(e) => updateField("dateTo", e.target.value)} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <button
                type="button"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={handleDownload}
                disabled={preview.isLoading}
              >
                ⬇ Download CSV
              </button>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                {preview.isLoading
                  ? "กำลังนับจำนวน…"
                  : preview.isError
                    ? "นับจำนวนไม่สำเร็จ (ลองดาวน์โหลดได้ตามปกติ)"
                    : `ตรงกับ ${preview.data?.total ?? 0} รายการ`}
              </span>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <button
                type="button"
                style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                ✕ Clear Filter
              </button>
            </div>
          </>
        )}

        {format !== "csv" && (
          <div
            style={{
              textAlign: "center",
              color: "var(--muted)",
              fontSize: "0.85rem",
              padding: "2.5rem 1rem",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius)",
            }}
          >
            Export {FORMAT_LABELS[format]} — Coming soon
          </div>
        )}
      </div>
    </div>
  );
}
