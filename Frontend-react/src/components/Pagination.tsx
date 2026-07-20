interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

// Pagination: bar "‹ Previous / หน้า X จาก Y / Next ›" ใช้ร่วมกันทุกตารางที่
// โหลดข้อมูลแบบแบ่งหน้า (parts, measurements) — ปิดปุ่ม Next อัตโนมัติเมื่อถึง
// หน้าสุดท้ายตาม `total` ที่ backend ส่งมา (ดู GET /api/parts, /api/measurements)
export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination-bar">
      <button
        type="button"
        className="btn-icon"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ‹ Previous
      </button>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--muted)" }}>
        หน้า {page} จาก {totalPages} ({total} รายการ)
      </span>
      <button
        type="button"
        className="btn-icon"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next ›
      </button>
    </div>
  );
}
