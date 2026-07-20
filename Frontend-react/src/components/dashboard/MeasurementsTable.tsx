import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import Pagination from "../Pagination";
import ReportModal from "./ReportModal";

const PAGE_SIZE = 10;

interface MeasurementRow {
  measurement_id: number;
  session_id: number;
  number_alpl: number;
  value_x: number;
  value_y: number;
  result: "OK" | "NG";
  timestamp: string;
}

// MeasurementsTable: ตารางประวัติการวัดบน Dashboard (read-only — แก้/ลบทำที่
// หน้า Edit เท่านั้น) คลิกแถวเปิด ReportModal ค้นหาด้วย ALPL + กรองวันที่ได้
export default function MeasurementsTable() {
  const [page, setPage] = useState(1);
  const [alplFilter, setAlplFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selected, setSelected] = useState<MeasurementRow | null>(null);

  const query = useQuery({
    queryKey: ["dashboard-measurements", page, alplFilter, dateFilter],
    queryFn: () =>
      apiGet<{ items: MeasurementRow[]; total: number }>("/api/measurements", {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        number_alpl: alplFilter ? Number(alplFilter) : undefined,
        date_from: dateFilter || undefined,
        date_to: dateFilter || undefined,
      }),
  });

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          Measurements{" "}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({query.data?.total ?? 0})</span>
        </div>
      </div>
      <div className="filter-bar">
        <input
          type="text"
          placeholder="ค้นหาด้วย ALPL Number..."
          value={alplFilter}
          onChange={(e) => {
            setAlplFilter(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value);
            setPage(1);
          }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setAlplFilter("");
            setDateFilter("");
            setPage(1);
          }}
        >
          ✕ Clear Filter
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Session</th>
              <th>ALPL</th>
              <th>Value X</th>
              <th>Value Y</th>
              <th>Result</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr className="empty-row">
                <td colSpan={7}>กำลังโหลด…</td>
              </tr>
            ) : (query.data?.items.length ?? 0) === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>ไม่พบข้อมูล</td>
              </tr>
            ) : (
              query.data!.items.map((m) => (
                <tr key={m.measurement_id} data-clickable onClick={() => setSelected(m)}>
                  <td>{m.measurement_id}</td>
                  <td>{m.session_id}</td>
                  <td>{m.number_alpl}</td>
                  <td>{m.value_x}</td>
                  <td>{m.value_y}</td>
                  <td>
                    <span className={`result-badge ${m.result === "OK" ? "ok" : "ng"}`}>{m.result}</span>
                  </td>
                  <td>{new Date(m.timestamp).toLocaleString("th-TH")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onPageChange={setPage} />

      {selected && <ReportModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
