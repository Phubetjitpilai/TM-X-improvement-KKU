import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../api/client";
import { useToast } from "../components/Toast";

// EditPage — พอร์ตจาก Frontend/edit.html (Database Editor) แบบยึดโครงสร้าง/
// field/คอลัมน์/ข้อความ ตามต้นฉบับเป็นหลัก
//
// ความต่างจากต้นฉบับที่ตั้งใจ (ตามที่ผู้ใช้ขอ): ต้นฉบับ edit.html มีฟิลด์
// "Category" (dropdown จาก GET /api/categories) ในฟอร์ม/ตาราง Parts แต่
// backend (main.py) ปัจจุบันไม่มี endpoint /api/categories และ PARTS_SELECT
// ก็ไม่ได้ SELECT คอลัมน์ category เลย — dropdown นี้เลยว่างเปล่าเสมอและใช้
// งานจริงไม่ได้ จึงตัด Category ออกทั้งฟอร์มและคอลัมน์ตาราง แล้วใช้
// "Receive Date" (recieve_date — มีอยู่จริงใน parts/PARTS_SELECT/PartCreate)
// แทนที่ตำแหน่งเดิม

const PAGE_SIZE = 10;

interface Part {
  part_id?: number;
  number_alpl: number;
  part_number: string | null;
  description: string | null;
  po_number: number | null;
  recieve_date: string | null;
  handler: string | null;
  vendor: string | null;
  owner: string | null;
  package_size: string | null;
  nominal_x: number | null;
  nominal_y: number | null;
  upper_tol: number | null;
  lower_tol: number | null;
  template_name: string | null;
}

interface Measurement {
  measurement_id: number;
  session_id: number | null;
  number_alpl: number;
  value_x: number | null;
  value_y: number | null;
  result: string | null;
  note: string | null;
  timestamp: string | null;
  operator_name?: string | null;
}

interface EditContext {
  table: "parts" | "measurements" | null;
  mode: "add" | "edit" | null;
  key: number | null;
  original: Part | Measurement | null;
}

interface ConfirmState {
  message: ReactNode;
  onConfirm: () => void | Promise<void>;
}

function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : String(n);
}

function pageInfoText(page: number, total: number, count: number): string {
  if (total === 0) return "ไม่มีรายการ";
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = (page - 1) * PAGE_SIZE + count;
  return `แสดง ${start}–${end} จาก ${total} รายการ`;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function renderOptions(items: string[]) {
  return (
    <>
      <option value="">-- เลือก --</option>
      {items.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </>
  );
}

export default function EditPage() {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  // ── Parts state (server-side pagination + search) ──────────────────
  const [partsData, setPartsData] = useState<Part[]>([]);
  const [partsTotal, setPartsTotal] = useState(0);
  const [partsPage, setPartsPage] = useState(1);
  const [partsSearchInput, setPartsSearchInput] = useState("");
  const partsSearchRef = useRef("");
  const partsSearchTimer = useRef<number | null>(null);

  // ── Measurements state (server-side pagination + filter) ───────────
  const [measurementsData, setMeasurementsData] = useState<Measurement[]>([]);
  const [measTotal, setMeasTotal] = useState(0);
  const [measPage, setMeasPage] = useState(1);
  const [measSearchInput, setMeasSearchInput] = useState("");
  const [measDate, setMeasDate] = useState("");
  const measSearchRef = useRef("");
  const measSearchTimer = useRef<number | null>(null);

  // ── Session running lock ────────────────────────────────────────────
  const [sessionRunning, setSessionRunning] = useState(false);

  // ── Dropdown lookups ─────────────────────────────────────────────────
  const [handlerOptions, setHandlerOptions] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<string[]>([]);
  const [packageSizeOptions, setPackageSizeOptions] = useState<string[]>([]);

  // ── Modal / form state ───────────────────────────────────────────────
  const [editContext, setEditContext] = useState<EditContext>({ table: null, mode: null, key: null, original: null });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alplNoteConsumed, setAlplNoteConsumed] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // ── Row highlight (highlight-row, 2.2s fade — เหมือนต้นฉบับ) ─────────
  const [highlight, setHighlight] = useState<{ table: "parts" | "measurements"; key: number } | null>(null);
  function flashHighlight(table: "parts" | "measurements", key: number) {
    setHighlight({ table, key });
    window.setTimeout(() => setHighlight((h) => (h && h.key === key && h.table === table ? null : h)), 2300);
  }

  async function loadParts(page: number, search: string) {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (search) params.search = search;
    try {
      const d = await apiGet<{ items: Part[]; total: number }>("/api/parts", params);
      setPartsData(d.items ?? []);
      setPartsTotal(d.total ?? 0);
      return d.items ?? [];
    } catch (e) {
      console.error("loadParts:", e);
      toast.show("ไม่สามารถดึงข้อมูล Parts จาก Database ได้");
      return [];
    }
  }

  async function loadMeasurements(page: number, search: string, date: string) {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (search && /^\d+$/.test(search)) params.number_alpl = search;
    if (date) {
      params.date_from = `${date} 00:00:00`;
      params.date_to = `${date} 23:59:59`;
    }
    try {
      const d = await apiGet<{ items: Measurement[]; total: number }>("/api/measurements", params);
      setMeasurementsData(d.items ?? []);
      setMeasTotal(d.total ?? 0);
      return d.items ?? [];
    } catch (e) {
      console.error("loadMeasurements:", e);
      toast.show("ไม่สามารถดึงข้อมูล Measurements จาก Database ได้");
      return [];
    }
  }

  async function loadDropdownData() {
    const [handlers, vendors, owners, packageSizes] = await Promise.all([
      apiGet<{ handler_name: string }[]>("/api/handlers").catch(() => []),
      apiGet<{ vendor_name: string }[]>("/api/vendors").catch(() => []),
      apiGet<{ owner_name: string }[]>("/api/owners").catch(() => []),
      apiGet<{ package_size: string }[]>("/api/package-sizes").catch(() => []),
    ]);
    setHandlerOptions(handlers.map((h) => h.handler_name));
    setVendorOptions(vendors.map((v) => v.vendor_name));
    setOwnerOptions(owners.map((o) => o.owner_name));
    setPackageSizeOptions(packageSizes.map((p) => p.package_size));
  }

  async function checkSessionRunning() {
    try {
      const d = await apiGet<{ state: string }>("/api/session/state");
      setSessionRunning(d.state === "running");
    } catch {
      /* poll ล้มเหลวเงียบๆ — ไม่ให้กระทบการใช้งานหน้าอื่น */
    }
  }

  useEffect(() => {
    (async () => {
      await Promise.all([loadParts(1, ""), loadMeasurements(1, "", ""), loadDropdownData(), checkSessionRunning()]);
    })();
    const t = window.setInterval(checkSessionRunning, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadPartsAfterMutation(highlightAlpl?: number) {
    let page = partsPage;
    let items = await loadParts(page, partsSearchRef.current);
    if (items.length === 0 && page > 1) {
      page -= 1;
      setPartsPage(page);
      items = await loadParts(page, partsSearchRef.current);
    }
    if (highlightAlpl != null) flashHighlight("parts", highlightAlpl);
  }
  async function reloadMeasAfterMutation(highlightId?: number) {
    let page = measPage;
    let items = await loadMeasurements(page, measSearchRef.current, measDate);
    if (items.length === 0 && page > 1) {
      page -= 1;
      setMeasPage(page);
      items = await loadMeasurements(page, measSearchRef.current, measDate);
    }
    if (highlightId != null) flashHighlight("measurements", highlightId);
  }

  // ── Parts filter handlers ────────────────────────────────────────────
  function onPartsSearchChange(value: string) {
    setPartsSearchInput(value);
    if (partsSearchTimer.current) window.clearTimeout(partsSearchTimer.current);
    partsSearchTimer.current = window.setTimeout(async () => {
      partsSearchRef.current = value.trim();
      setPartsPage(1);
      await loadParts(1, partsSearchRef.current);
    }, 300);
  }
  async function onPartsClearFilter() {
    if (partsSearchTimer.current) window.clearTimeout(partsSearchTimer.current);
    setPartsSearchInput("");
    partsSearchRef.current = "";
    setPartsPage(1);
    await loadParts(1, "");
  }
  async function onPartsPrev() {
    if (partsPage <= 1) return;
    const p = partsPage - 1;
    setPartsPage(p);
    await loadParts(p, partsSearchRef.current);
  }
  async function onPartsNext() {
    if ((partsPage - 1) * PAGE_SIZE + partsData.length >= partsTotal) return;
    const p = partsPage + 1;
    setPartsPage(p);
    await loadParts(p, partsSearchRef.current);
  }

  // ── Measurements filter handlers ─────────────────────────────────────
  function onMeasSearchChange(value: string) {
    setMeasSearchInput(value);
    if (measSearchTimer.current) window.clearTimeout(measSearchTimer.current);
    measSearchTimer.current = window.setTimeout(async () => {
      measSearchRef.current = value.trim();
      setMeasPage(1);
      await loadMeasurements(1, measSearchRef.current, measDate);
    }, 300);
  }
  async function onMeasDateChange(value: string) {
    setMeasDate(value);
    setMeasPage(1);
    await loadMeasurements(1, measSearchRef.current, value);
  }
  async function onMeasClearFilter() {
    if (measSearchTimer.current) window.clearTimeout(measSearchTimer.current);
    setMeasSearchInput("");
    setMeasDate("");
    measSearchRef.current = "";
    setMeasPage(1);
    await loadMeasurements(1, "", "");
  }
  async function onMeasPrev() {
    if (measPage <= 1) return;
    const p = measPage - 1;
    setMeasPage(p);
    await loadMeasurements(p, measSearchRef.current, measDate);
  }
  async function onMeasNext() {
    if ((measPage - 1) * PAGE_SIZE + measurementsData.length >= measTotal) return;
    const p = measPage + 1;
    setMeasPage(p);
    await loadMeasurements(p, measSearchRef.current, measDate);
  }

  // ── Modal open/close ─────────────────────────────────────────────────
  function openPartModal(mode: "add" | "edit", numberAlpl: number | null = null) {
    const part = mode === "edit" ? partsData.find((p) => p.number_alpl === numberAlpl) ?? null : null;
    setEditContext({ table: "parts", mode, key: numberAlpl, original: part });
    setFieldErrors({});
    setAlplNoteConsumed(false);
  }
  function openMeasModal(mode: "add" | "edit", measurementId: number | null = null) {
    const m = mode === "edit" ? measurementsData.find((x) => x.measurement_id === measurementId) ?? null : null;
    setEditContext({ table: "measurements", mode, key: measurementId, original: m });
    setFieldErrors({});
    setAlplNoteConsumed(false);
  }
  function closeEditModal() {
    setEditContext({ table: null, mode: null, key: null, original: null });
    setFieldErrors({});
  }

  // ── Save Part ─────────────────────────────────────────────────────────
  async function savePart(e: FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const get = (k: string) => ((fd.get(k) as string) ?? "").trim();
    const errors: Record<string, string> = {};
    const isAdd = editContext.mode === "add";

    const numberAlplRaw = get("number_alpl");
    const nAlpl = Number(numberAlplRaw);
    if (numberAlplRaw === "" || !Number.isInteger(nAlpl) || nAlpl <= 0) {
      errors.number_alpl = "ต้องเป็นเลขจำนวนเต็มบวก";
    } else if (partsData.some((p) => p.number_alpl === nAlpl && p.number_alpl !== editContext.key)) {
      errors.number_alpl = `ALPL ${nAlpl} มีอยู่ในตารางแล้ว`;
    }

    if (isAdd) {
      if (!get("part_number")) errors.part_number = "กรอก Part Number";
      if (!get("handler")) errors.handler = "เลือก Handler";
      if (!get("vendor")) errors.vendor = "เลือก Vendor";
      if (!get("description")) errors.description = "กรอก Description";
      if (!get("po_number")) errors.po_number = "กรอก PO Number";
      if (!get("package_size")) errors.package_size = "กรอก Package Size (จะ map nominal/tolerance/template ให้อัตโนมัติ)";
      if (!get("owner")) errors.owner = "เลือก Owner";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.number_alpl) setAlplNoteConsumed(true);
      return;
    }

    const record: Record<string, unknown> = {
      number_alpl: nAlpl,
      part_number: get("part_number"),
      handler: get("handler") || null,
      vendor: get("vendor") || null,
      description: get("description") || null,
      po_number: get("po_number") === "" ? null : Number(get("po_number")),
      recieve_date: get("recieve_date") || null,
      package_size: get("package_size") || null,
      owner: get("owner") || null,
    };

    if (!isAdd && editContext.original) {
      const orig = editContext.original as unknown as Record<string, unknown>;
      const changed = Object.keys(record).some((k) => String(orig[k] ?? null) !== String(record[k] ?? null));
      if (!changed) {
        closeEditModal();
        return;
      }
    }

    try {
      if (isAdd) await apiPost("/api/parts", record);
      else await apiPatch(`/api/parts/${editContext.key}`, record);
      toast.show(isAdd ? `เพิ่ม ALPL ${nAlpl} สำเร็จ` : `บันทึก ALPL ${nAlpl} สำเร็จ`);
      await reloadPartsAfterMutation(nAlpl);
      closeEditModal();
    } catch (err) {
      toast.show(errMsg(err, "บันทึกข้อมูล Part ไม่สำเร็จ"));
    }
  }

  function confirmDeletePart(numberAlpl: number) {
    setConfirmState({
      message: (
        <>
          ลบ Part <strong>ALPL {numberAlpl}</strong> ออกจากตารางใช่ไหม?{" "}
          <span style={{ color: "var(--ng)" }}>
            ⚠ การลบ Part นี้จะลบ Session/Measurement (ข้อมูลการวัด) ทั้งหมดของ ALPL นี้ไปด้วย — กู้คืนไม่ได้
          </span>
        </>
      ),
      onConfirm: async () => {
        try {
          await apiDelete(`/api/parts/${numberAlpl}?cascade=true`);
          await reloadPartsAfterMutation();
          await reloadMeasAfterMutation();
          closeEditModal();
          toast.show(`ลบ ALPL ${numberAlpl} พร้อมประวัติการวัดทั้งหมดสำเร็จ`);
        } catch (err) {
          toast.show(errMsg(err, "ไม่สามารถลบข้อมูลได้"));
        }
        setConfirmState(null);
      },
    });
  }

  // ── Save Measurement ──────────────────────────────────────────────────
  async function saveMeas(e: FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const get = (k: string) => ((fd.get(k) as string) ?? "").trim();
    const isEdit = editContext.mode === "edit";
    const errors: Record<string, string> = {};

    const numberAlplRaw = get("number_alpl");
    const nAlpl = Number(numberAlplRaw);
    if (numberAlplRaw === "" || !Number.isInteger(nAlpl) || nAlpl <= 0) {
      errors.number_alpl = "ต้องเป็นเลขจำนวนเต็มบวก";
    } else if (!partsData.some((p) => p.number_alpl === nAlpl)) {
      errors.number_alpl = `ALPL ${nAlpl} ยังไม่ได้ลงทะเบียนในตาราง Parts`;
    }

    let sessionId: number | null = null;
    if (isEdit) {
      const existing = measurementsData.find((m) => m.measurement_id === editContext.key);
      sessionId = existing?.session_id ?? null;
    }

    let valueX: number | undefined;
    let valueY: number | undefined;
    if (!isEdit) {
      const vx = get("value_x");
      const vy = get("value_y");
      if (vx === "" || isNaN(Number(vx))) errors.value_x = "กรอก Value X เป็นตัวเลข";
      if (vy === "" || isNaN(Number(vy))) errors.value_y = "กรอก Value Y เป็นตัวเลข";
      valueX = Number(vx);
      valueY = Number(vy);
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.number_alpl) setAlplNoteConsumed(true);
      return;
    }

    const note = get("note") || null;
    const payload: Record<string, unknown> = isEdit
      ? { session_id: sessionId, number_alpl: nAlpl, note }
      : { session_id: sessionId, number_alpl: nAlpl, value_x: valueX, value_y: valueY, note };

    if (isEdit && editContext.original) {
      const orig = editContext.original as unknown as Record<string, unknown>;
      const changed = ["number_alpl", "note"].some((k) => String(orig[k] ?? null) !== String(payload[k] ?? null));
      if (!changed) {
        closeEditModal();
        return;
      }
    }

    try {
      const res = isEdit
        ? await apiPatch<{ result?: string }>(`/api/measurements/${editContext.key}`, payload)
        : await apiPost<{ result?: string }>("/api/measurements", payload);
      const resultNote = res?.result ? ` (Result: ${res.result})` : "";
      toast.show(isEdit ? `บันทึก Measurement ID ${editContext.key} เรียบร้อยแล้ว${resultNote}` : `เพิ่ม Measurement เรียบร้อยแล้ว${resultNote}`);
      await reloadMeasAfterMutation((editContext.key as number) ?? undefined);
      closeEditModal();
    } catch (err) {
      toast.show(errMsg(err, "บันทึกข้อมูล Measurement ไม่สำเร็จ"));
    }
  }

  function confirmDeleteMeas(measurementId: number) {
    setConfirmState({
      message: (
        <>
          ลบ Measurement <strong>ID {measurementId}</strong> ออกจากตารางใช่ไหม?
        </>
      ),
      onConfirm: async () => {
        try {
          await apiDelete(`/api/measurements/${measurementId}`);
          await reloadMeasAfterMutation();
          closeEditModal();
          toast.show(`ลบ Measurement ID ${measurementId} สำเร็จ`);
        } catch {
          toast.show("ไม่สามารถลบข้อมูลได้");
        }
        setConfirmState(null);
      },
    });
  }

  const isEdit = editContext.mode === "edit";
  const reqMark = editContext.mode === "add" ? <span className="req">*</span> : null;
  const partOrig = editContext.table === "parts" ? (editContext.original as Part | null) : null;
  const measOrig = editContext.table === "measurements" ? (editContext.original as Measurement | null) : null;
  const pv = (field: keyof Part) => (partOrig ? (partOrig[field] as string | number | null) ?? "" : "");
  const mv = (field: keyof Measurement) => (measOrig ? (measOrig[field] as string | number | null) ?? "" : "");

  return (
    <div className="main-edit">
      {sessionRunning && (
        <div className="mock-banner">
          ⏳ ขณะนี้กำลังวัดอยู่ (Session Running) — ไม่สามารถแก้ไขหรือลบข้อมูล Part / Measurement ได้ กรุณากด Stop session ก่อน
        </div>
      )}

      {/* ═══════════════════════ PARTS TABLE ═══════════════════════ */}
      <section className="card">
        <div className="card-header">
          <div className="card-title">
            Parts <span className="count">({partsTotal})</span>
          </div>
          <button type="button" className="btn-add" onClick={() => openPartModal("add")}>
            + Add Part
          </button>
        </div>

        <div className="filter-bar">
          <input
            type="text"
            placeholder="ค้นหาด้วย ALPL Number..."
            value={partsSearchInput}
            onChange={(e) => onPartsSearchChange(e.target.value)}
          />
          <button type="button" className="btn-clear-filter" onClick={onPartsClearFilter}>
            ✕ Clear Filter
          </button>
        </div>
        <div className="filter-result-note" />

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ALPL</th>
                <th>Part Number</th>
                <th>Handler</th>
                <th>Receive Date</th>
                <th>Package Size</th>
                <th>Vendor</th>
                <th>Owner</th>
                <th>Description</th>
                <th>PO Number</th>
                <th>Nominal X/Y</th>
                <th>Tol (+/-)</th>
                <th>Template</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {partsData.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={13}>{partsSearchRef.current ? "ไม่พบ Part ที่ตรงกับคำค้นหา" : "ยังไม่มีข้อมูล Parts"}</td>
                </tr>
              ) : (
                partsData.map((p) => (
                  <tr key={p.number_alpl} className={highlight?.table === "parts" && highlight.key === p.number_alpl ? "highlight-row" : ""}>
                    <td>
                      <strong>{p.number_alpl}</strong>
                    </td>
                    <td>{p.part_number ?? "—"}</td>
                    <td>{p.handler ?? "—"}</td>
                    <td>{p.recieve_date ? new Date(p.recieve_date).toLocaleDateString() : "—"}</td>
                    <td>{p.package_size ?? "—"}</td>
                    <td>{p.vendor ?? "—"}</td>
                    <td>{p.owner ?? "—"}</td>
                    <td className="desc-cell" title={p.description ?? ""}>
                      {p.description ?? "—"}
                    </td>
                    <td>{p.po_number ?? "—"}</td>
                    <td>
                      {fmtNum(p.nominal_x)} / {fmtNum(p.nominal_y)}
                    </td>
                    <td>
                      +{fmtNum(p.upper_tol)} / -{fmtNum(p.lower_tol)}
                    </td>
                    <td>{p.template_name ?? "—"}</td>
                    <td className="row-actions">
                      <button
                        className="btn-icon edit"
                        disabled={sessionRunning}
                        title={sessionRunning ? "กำลังวัดอยู่ ไม่สามารถแก้ไขได้" : undefined}
                        onClick={() => openPartModal("edit", p.number_alpl)}
                      >
                        ✎ Edit
                      </button>
                      <button
                        className="btn-icon delete"
                        disabled={sessionRunning}
                        title={sessionRunning ? "กำลังวัดอยู่ ไม่สามารถลบได้" : undefined}
                        onClick={() => confirmDeletePart(p.number_alpl)}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <button type="button" className="btn-icon" disabled={partsPage <= 1} onClick={onPartsPrev}>
            ‹ Previous
          </button>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{pageInfoText(partsPage, partsTotal, partsData.length)}</span>
          <button
            type="button"
            className="btn-icon"
            disabled={(partsPage - 1) * PAGE_SIZE + partsData.length >= partsTotal}
            onClick={onPartsNext}
          >
            Next ›
          </button>
        </div>
      </section>

      {/* ═══════════════════════ MEASUREMENTS TABLE ═══════════════════════ */}
      <section className="card">
        <div className="card-header">
          <div className="card-title">
            Measurements <span className="count">({measTotal})</span>
          </div>
        </div>

        <div className="filter-bar">
          <input
            type="text"
            placeholder="ค้นหาด้วย ALPL Number..."
            value={measSearchInput}
            onChange={(e) => onMeasSearchChange(e.target.value)}
          />
          <input type="date" title="กรองตาม Timestamp (วันที่)" value={measDate} onChange={(e) => onMeasDateChange(e.target.value)} />
          <button type="button" className="btn-clear-filter" onClick={onMeasClearFilter}>
            ✕ Clear Filter
          </button>
        </div>
        <div className="filter-result-note" />

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
                <th>Note</th>
                <th>Timestamp</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {measurementsData.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={9}>{measSearchRef.current || measDate ? "ไม่พบ Measurement ที่ตรงกับตัวกรอง" : "ยังไม่มีข้อมูล Measurements"}</td>
                </tr>
              ) : (
                measurementsData.map((m) => {
                  const res = m.result || "—";
                  const cls = res === "OK" ? "ok" : res === "NG" ? "ng" : "";
                  const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : "—";
                  return (
                    <tr
                      key={m.measurement_id}
                      className={highlight?.table === "measurements" && highlight.key === m.measurement_id ? "highlight-row" : ""}
                    >
                      <td>{m.measurement_id}</td>
                      <td>{m.session_id ?? "—"}</td>
                      <td>
                        <strong>{m.number_alpl}</strong>
                      </td>
                      <td>{m.value_x != null ? m.value_x.toFixed(3) : "—"}</td>
                      <td>{m.value_y != null ? m.value_y.toFixed(3) : "—"}</td>
                      <td>
                        <span className={`result-badge ${cls}`}>{res}</span>
                      </td>
                      <td>{m.note ?? "—"}</td>
                      <td>{ts}</td>
                      <td className="row-actions">
                        <button
                          className="btn-icon edit"
                          disabled={sessionRunning}
                          title={sessionRunning ? "กำลังวัดอยู่ ไม่สามารถแก้ไขได้" : undefined}
                          onClick={() => openMeasModal("edit", m.measurement_id)}
                        >
                          ✎ Edit
                        </button>
                        <button
                          className="btn-icon delete"
                          disabled={sessionRunning}
                          title={sessionRunning ? "กำลังวัดอยู่ ไม่สามารถลบได้" : undefined}
                          onClick={() => confirmDeleteMeas(m.measurement_id)}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <button type="button" className="btn-icon" disabled={measPage <= 1} onClick={onMeasPrev}>
            ‹ Previous
          </button>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{pageInfoText(measPage, measTotal, measurementsData.length)}</span>
          <button
            type="button"
            className="btn-icon"
            disabled={(measPage - 1) * PAGE_SIZE + measurementsData.length >= measTotal}
            onClick={onMeasNext}
          >
            Next ›
          </button>
        </div>
      </section>

      {/* Shared datalist: Package Size */}
      <datalist id="package-size-datalist">
        {packageSizeOptions.map((ps) => (
          <option key={ps} value={ps} />
        ))}
      </datalist>

      {/* ── Edit/Add modal (ใช้ร่วมกันทั้ง Parts และ Measurements) ────── */}
      <div className={`modal-overlay${editContext.table ? " open" : ""}`}>
        <div className="edit-modal-box">
          <div className="edit-modal-header">
            <div className="card-title">
              {editContext.table === "parts"
                ? isEdit
                  ? `Edit Part — ALPL ${editContext.key}`
                  : "Add New Part"
                : editContext.table === "measurements"
                  ? isEdit
                    ? `Edit Measurement — ID ${editContext.key}`
                    : "Add New Measurement"
                  : ""}
            </div>
            <button type="button" className="modal-close" onClick={closeEditModal}>
              ✕
            </button>
          </div>
          <form ref={formRef} onSubmit={editContext.table === "parts" ? savePart : saveMeas}>
            <div className="entry-form-grid">
              {editContext.table === "parts" && (
                <>
                  <div className="form-group">
                    <label htmlFor="f-number_alpl">
                      ALPL <span className="req">*</span>
                    </label>
                    <input type="number" id="f-number_alpl" name="number_alpl" defaultValue={pv("number_alpl") || editContext.key || ""} />
                    <div className="field-error">
                      {fieldErrors.number_alpl ? (
                        fieldErrors.number_alpl
                      ) : isEdit && !alplNoteConsumed ? (
                        <span className="field-locked-note">
                          แก้ ALPL ได้ — ระวัง: ถ้า ALPL นี้มีประวัติ session/measurement ผูกอยู่แล้ว การเปลี่ยนจะถูก DB ปฏิเสธ (FK constraint)
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-part_number">Part Number {reqMark}</label>
                    <input type="text" id="f-part_number" name="part_number" defaultValue={pv("part_number")} />
                    <div className="field-error">{fieldErrors.part_number}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-handler">Handler {reqMark}</label>
                    <select id="f-handler" name="handler" defaultValue={pv("handler")}>
                      {renderOptions(handlerOptions)}
                    </select>
                    <div className="field-error">{fieldErrors.handler}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-vendor">Vendor {reqMark}</label>
                    <select id="f-vendor" name="vendor" defaultValue={pv("vendor")}>
                      {renderOptions(vendorOptions)}
                    </select>
                    <div className="field-error">{fieldErrors.vendor}</div>
                  </div>
                  <div className="form-group span-2">
                    <label htmlFor="f-description">Description {reqMark}</label>
                    <input type="text" id="f-description" name="description" defaultValue={pv("description")} />
                    <div className="field-error">{fieldErrors.description}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-po_number">PO Number {reqMark}</label>
                    <input type="number" id="f-po_number" name="po_number" defaultValue={pv("po_number")} />
                    <div className="field-error">{fieldErrors.po_number}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-recieve_date">Receive Date</label>
                    <input
                      type="date"
                      id="f-recieve_date"
                      name="recieve_date"
                      defaultValue={partOrig?.recieve_date ? String(partOrig.recieve_date).slice(0, 10) : ""}
                    />
                    <div className="field-error">{fieldErrors.recieve_date}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-package_size">Package Size {reqMark}</label>
                    <input
                      type="text"
                      id="f-package_size"
                      name="package_size"
                      list="package-size-datalist"
                      defaultValue={pv("package_size")}
                      placeholder="เลือก package size — map nominal/tolerance/template ให้อัตโนมัติ"
                    />
                    <div className="field-error">{fieldErrors.package_size}</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="f-owner">Owner {reqMark}</label>
                    <select id="f-owner" name="owner" defaultValue={pv("owner")}>
                      {renderOptions(ownerOptions)}
                    </select>
                    <div className="field-error">{fieldErrors.owner}</div>
                  </div>
                </>
              )}

              {editContext.table === "measurements" && (
                <>
                  <div className="form-group">
                    <label htmlFor="f-number_alpl">
                      ALPL <span className="req">*</span>
                    </label>
                    <input type="number" id="f-number_alpl" name="number_alpl" defaultValue={mv("number_alpl")} />
                    <div className="field-error">
                      {fieldErrors.number_alpl ? (
                        fieldErrors.number_alpl
                      ) : isEdit && !alplNoteConsumed ? (
                        <span className="field-locked-note">
                          แก้ ALPL ได้ — ใช้กรณี IPM เลือกชิ้นที่มีอยู่จริงผิดตัว (ต้องเป็น ALPL ที่ลงทะเบียนใน Parts แล้ว)
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {!isEdit && (
                    <>
                      <div className="form-group">
                        <label htmlFor="f-value_x">
                          Value X (mm) <span className="req">*</span>
                        </label>
                        <input type="number" step="0.001" id="f-value_x" name="value_x" defaultValue={mv("value_x")} />
                        <div className="field-error">{fieldErrors.value_x}</div>
                      </div>
                      <div className="form-group">
                        <label htmlFor="f-value_y">
                          Value Y (mm) <span className="req">*</span>
                        </label>
                        <input type="number" step="0.001" id="f-value_y" name="value_y" defaultValue={mv("value_y")} />
                        <div className="field-error">{fieldErrors.value_y}</div>
                      </div>
                    </>
                  )}
                  <div className="form-group span-2">
                    <label htmlFor="f-note">Note</label>
                    <textarea id="f-note" name="note" defaultValue={mv("note") ?? ""} />
                    <div className="field-error" />
                  </div>
                  <div className="form-group span-2">
                    <div className="field-locked-note">Result (OK/NG) คำนวณอัตโนมัติจาก Value X/Y เทียบกับ tolerance ของ ALPL — ไม่ต้องเลือกเอง</div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <div>
                {editContext.table === "measurements" && isEdit && (
                  <button
                    type="button"
                    className="btn-delete-inline"
                    onClick={() => editContext.key != null && confirmDeleteMeas(editContext.key)}
                  >
                    🗑 Delete
                  </button>
                )}
              </div>
              <div className="modal-actions-right">
                <button type="button" className="btn-cancel" onClick={closeEditModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-save">
                  ✔ Save
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* ── Confirm delete modal ─────────────────────────────────────── */}
      <div className={`modal-overlay${confirmState ? " open" : ""}`}>
        <div className="confirm-box">
          <p>{confirmState?.message}</p>
          <div className="confirm-actions">
            <button type="button" className="btn-cancel" onClick={() => setConfirmState(null)}>
              Cancel
            </button>
            <button type="button" className="btn-delete-inline" onClick={() => confirmState?.onConfirm()}>
              🗑 Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
