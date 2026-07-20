import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "../../api/client";
import { useLookups } from "../../hooks/useLookups";
import { useToast } from "../Toast";
import ConfirmDialog from "../ConfirmDialog";

// PartEntry: ย้ายมาจาก "Part Entry" modal ของ index.html เดิม (3 โหมด IPM/New/
// Rework) — เพื่อความง่าย รวมปุ่ม "Save" + "Start" เดิม (ที่ index.html เดิม
// แยกเป็น 2 ขั้นตอน: กรอกฟอร์ม+Save ก่อน แล้วค่อยกดปุ่ม Start ที่การ์ด Session
// Control แยกต่างหาก) ให้เหลือปุ่มเดียว "▶ Start" กดแล้วเริ่มวัดทันที — ลด
// ความซับซ้อนของ UI โดยยังคงกติกาทางธุรกิจ (validation, IPM unregistered-ALPL
// confirm, Rework prefill) ไว้ครบทุกจุดเหมือนเดิม ปิดใช้งานทั้งฟอร์มถ้ามี
// session อื่นกำลัง running อยู่แล้ว (backend คุมอยู่แล้วผ่าน Button Guard
// แต่ disable ฝั่ง UI ไว้ด้วยกันกดซ้ำโดยไม่จำเป็น)

type Mode = "IPM" | "New" | "Rework";

function parseAlplList(raw: string): number[] {
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (part.trim() && Number.isInteger(n) && n > 0) seen.add(n);
  }
  return [...seen];
}

async function alplExists(alpl: number): Promise<boolean> {
  try {
    await apiGet(`/api/parts/${alpl}`);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false;
    throw err;
  }
}

export default function PartEntry({ disabled }: { disabled: boolean }) {
  const [mode, setMode] = useState<Mode>("IPM");

  return (
    <div className="card">
      <div className="pe-card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Part Entry
        </div>
        <span className={`pe-mode-badge ${mode.toLowerCase()}`}>{mode}</span>
      </div>

      <div className="entry-toggle">
        {(["IPM", "New", "Rework"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`entry-toggle-btn ${mode === m ? "active" : ""}`}
            disabled={disabled}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "IPM" && <IpmForm disabled={disabled} />}
      {mode === "New" && <NewForm disabled={disabled} />}
      {mode === "Rework" && <ReworkForm disabled={disabled} />}
    </div>
  );
}

function useStartSession() {
  const { show } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost("/api/session/start", payload),
    onSuccess: () => {
      show("เริ่ม session แล้ว");
      qc.invalidateQueries({ queryKey: ["session-state"] });
    },
    onError: (err) => show(err instanceof ApiError ? err.message : "เริ่ม session ไม่สำเร็จ"),
  });
}

/* ── IPM ─────────────────────────────────────────────────────────────── */
function IpmForm({ disabled }: { disabled: boolean }) {
  const lookups = useLookups();
  const start = useStartSession();
  const [alplRaw, setAlplRaw] = useState("");
  const [operator, setOperator] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingMissing, setPendingMissing] = useState<number[] | null>(null);
  const [checking, setChecking] = useState(false);

  async function findMissing(queue: number[]): Promise<number[]> {
    const missing: number[] = [];
    for (const alpl of queue) {
      if (!(await alplExists(alpl))) missing.push(alpl);
    }
    return missing;
  }

  async function handleSubmit() {
    const queue = parseAlplList(alplRaw);
    const next: Record<string, string> = {};
    if (queue.length === 0) next.alpl = "ต้องกรอก ALPL อย่างน้อย 1 ตัว (คั่นด้วยคอมมา)";
    if (!operator) next.operator = "ต้องเลือก Operator";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setChecking(true);
    try {
      const missing = await findMissing(queue);
      if (missing.length > 0) {
        if (!packageSize) {
          setErrors({ package_size: `มี ALPL ที่ยังไม่เคยลงทะเบียน (${missing.join(", ")}) ต้องกรอก Package Size ก่อน` });
          return;
        }
        setPendingMissing(missing);
        return;
      }
      start.mutate({ Measure_Type: "IPM", number_alpl: queue, Operator: operator });
    } finally {
      setChecking(false);
    }
  }

  async function confirmRegisterAndStart() {
    if (!pendingMissing) return;
    const queue = parseAlplList(alplRaw);
    try {
      for (const alpl of pendingMissing) {
        await apiPost("/api/parts", { number_alpl: alpl, package_size: packageSize });
      }
      start.mutate({ Measure_Type: "IPM", number_alpl: queue, Operator: operator });
    } catch (err) {
      setErrors({ package_size: err instanceof ApiError ? err.message : "ลงทะเบียน ALPL ใหม่ไม่สำเร็จ" });
    } finally {
      setPendingMissing(null);
    }
  }

  return (
    <>
      <div className="form-grid">
        <div className="form-group span-2">
          <label>
            ALPL (คั่นด้วยคอมมา) <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <input type="text" placeholder="e.g. 1028, 1029, 1030" value={alplRaw} onChange={(e) => setAlplRaw(e.target.value)} className={errors.alpl ? "invalid" : ""} disabled={disabled} />
          <div className="field-error">{errors.alpl}</div>
        </div>
        <div className="form-group">
          <label>
            Operator <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className={errors.operator ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก Operator --</option>
            {lookups.operators.map((o) => (
              <option key={o.operator_id} value={o.operator_name}>
                {o.operator_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.operator}</div>
        </div>
        <div className="form-group">
          <label>Package Size</label>
          <select value={packageSize} onChange={(e) => setPackageSize(e.target.value)} className={errors.package_size ? "invalid" : ""} disabled={disabled}>
            <option value="">-- ต้องกรอกถ้ามี ALPL ที่ยังไม่เคยลงทะเบียน --</option>
            {lookups.packageSizes.map((ps) => (
              <option key={ps.package_size_id} value={ps.package_size}>
                {ps.package_size}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.package_size}</div>
        </div>
      </div>
      <button type="button" className="btn-primary" disabled={disabled || checking || start.isPending} onClick={handleSubmit}>
        ▶ Start
      </button>

      {pendingMissing && (
        <ConfirmDialog
          title="ยืนยันลงทะเบียน ALPL ใหม่"
          message={`ALPL ${pendingMissing.join(", ")} ยังไม่เคยลงทะเบียน — ต้องการลงทะเบียนด้วย Package Size "${packageSize}" แล้วเริ่มวัดเลยไหม?`}
          confirmLabel="ลงทะเบียนและเริ่มวัด"
          onConfirm={confirmRegisterAndStart}
          onCancel={() => setPendingMissing(null)}
        />
      )}
    </>
  );
}

/* ── New ─────────────────────────────────────────────────────────────── */
function NewForm({ disabled }: { disabled: boolean }) {
  const lookups = useLookups();
  const start = useStartSession();
  const [form, setForm] = useState({
    alplRaw: "",
    part_number: "",
    operator: "",
    handler: "",
    vendor: "",
    description: "",
    po_number: "",
    package_size: "",
    owner: "",
    recieve_date: "",
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const queue = parseAlplList(form.alplRaw);
    const next: Record<string, string> = {};
    if (queue.length === 0) next.alplRaw = "ต้องกรอก ALPL อย่างน้อย 1 ตัว";
    if (!form.part_number.trim()) next.part_number = "ต้องกรอก Part Number";
    if (!form.operator) next.operator = "ต้องเลือก Operator";
    if (!form.handler) next.handler = "ต้องเลือก Handler";
    if (!form.vendor) next.vendor = "ต้องเลือก Vendor";
    if (!form.description.trim()) next.description = "ต้องกรอก Description";
    if (!form.po_number.trim() || !Number.isInteger(Number(form.po_number))) next.po_number = "PO Number ต้องเป็นตัวเลข";
    if (!form.package_size) next.package_size = "ต้องเลือก Package Size";
    if (!form.owner) next.owner = "ต้องเลือก Owner";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setChecking(true);
    try {
      const already: number[] = [];
      for (const alpl of queue) {
        if (await alplExists(alpl)) already.push(alpl);
      }
      if (already.length > 0) {
        setErrors({ alplRaw: `ALPL ${already.join(", ")} ลงทะเบียนไว้แล้ว — ใช้โหมด IPM แทนถ้าจะวัดซ้ำ` });
        return;
      }
      start.mutate({
        Measure_Type: "New",
        number_alpl: queue,
        part_number: form.part_number,
        Operator: form.operator,
        handler: form.handler,
        vendor: form.vendor,
        description: form.description,
        po_number: Number(form.po_number),
        package_size: form.package_size,
        owner: form.owner,
        recieve_date: form.recieve_date || undefined,
        Note: form.note || undefined,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <div className="form-grid">
        <div className="form-group">
          <label>
            ALPL (คั่นด้วยคอมมา) <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <input type="text" placeholder="e.g. 1028, 1029" value={form.alplRaw} onChange={(e) => update("alplRaw", e.target.value)} className={errors.alplRaw ? "invalid" : ""} disabled={disabled} />
          <div className="field-error">{errors.alplRaw}</div>
        </div>
        <div className="form-group">
          <label>
            Part Number <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <input type="text" value={form.part_number} onChange={(e) => update("part_number", e.target.value)} className={errors.part_number ? "invalid" : ""} disabled={disabled} />
          <div className="field-error">{errors.part_number}</div>
        </div>
        <div className="form-group">
          <label>
            Operator <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={form.operator} onChange={(e) => update("operator", e.target.value)} className={errors.operator ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.operators.map((o) => (
              <option key={o.operator_id} value={o.operator_name}>
                {o.operator_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.operator}</div>
        </div>
        <div className="form-group">
          <label>
            Handler <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={form.handler} onChange={(e) => update("handler", e.target.value)} className={errors.handler ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.handlers.map((h) => (
              <option key={h.handler_id} value={h.handler_name}>
                {h.handler_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.handler}</div>
        </div>
        <div className="form-group">
          <label>
            Vendor <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={form.vendor} onChange={(e) => update("vendor", e.target.value)} className={errors.vendor ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.vendors.map((v) => (
              <option key={v.vendor_id} value={v.vendor_name}>
                {v.vendor_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.vendor}</div>
        </div>
        <div className="form-group">
          <label>
            Owner <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={form.owner} onChange={(e) => update("owner", e.target.value)} className={errors.owner ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.owners.map((o) => (
              <option key={o.owner_id} value={o.owner_name}>
                {o.owner_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.owner}</div>
        </div>
        <div className="form-group">
          <label>
            Package Size <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={form.package_size} onChange={(e) => update("package_size", e.target.value)} className={errors.package_size ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.packageSizes.map((ps) => (
              <option key={ps.package_size_id} value={ps.package_size}>
                {ps.package_size}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.package_size}</div>
        </div>
        <div className="form-group">
          <label>
            PO Number <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <input type="text" inputMode="numeric" value={form.po_number} onChange={(e) => update("po_number", e.target.value)} className={errors.po_number ? "invalid" : ""} disabled={disabled} />
          <div className="field-error">{errors.po_number}</div>
        </div>
        <div className="form-group">
          <label>Receive Date</label>
          <input type="date" value={form.recieve_date} onChange={(e) => update("recieve_date", e.target.value)} disabled={disabled} />
        </div>
        <div className="form-group span-2">
          <label>
            Description <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <input type="text" value={form.description} onChange={(e) => update("description", e.target.value)} className={errors.description ? "invalid" : ""} disabled={disabled} />
          <div className="field-error">{errors.description}</div>
        </div>
        <div className="form-group span-2">
          <label>Note</label>
          <textarea value={form.note} onChange={(e) => update("note", e.target.value)} disabled={disabled} />
        </div>
      </div>
      <button type="button" className="btn-primary" disabled={disabled || checking || start.isPending} onClick={handleSubmit}>
        ▶ Start
      </button>
    </>
  );
}

/* ── Rework ──────────────────────────────────────────────────────────── */
function ReworkForm({ disabled }: { disabled: boolean }) {
  const lookups = useLookups();
  const start = useStartSession();
  const [alpl, setAlpl] = useState("");
  const [operator, setOperator] = useState("");
  const [prefill, setPrefill] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [looking, setLooking] = useState(false);

  async function handleLookup() {
    const n = Number(alpl);
    if (!alpl.trim() || !Number.isInteger(n)) {
      setErrors({ alpl: "ต้องกรอก ALPL เป็นเลขจำนวนเต็ม" });
      return;
    }
    setLooking(true);
    try {
      const part = await apiGet<Record<string, any>>(`/api/parts/${n}`);
      setPrefill({
        part_number: part.part_number ?? "",
        handler: part.handler ?? "",
        vendor: part.vendor ?? "",
        description: part.description ?? "",
        po_number: part.po_number?.toString() ?? "",
        package_size: part.package_size ?? "",
        owner: part.owner ?? "",
        recieve_date: "", // ต้องกรอกวันที่รับกลับมาใหม่เสมอ ไม่ auto-fill
      });
      setErrors({});
    } catch (err) {
      setPrefill(null);
      setErrors({ alpl: err instanceof ApiError && err.status === 404 ? "ALPL นี้ยังไม่เคยลงทะเบียน — ไปลงทะเบียนที่โหมด New ก่อน" : "ค้นหาไม่สำเร็จ" });
    } finally {
      setLooking(false);
    }
  }

  function updatePrefill(key: string, value: string) {
    setPrefill((p) => (p ? { ...p, [key]: value } : p));
  }

  async function handleSubmit() {
    const next: Record<string, string> = {};
    if (!prefill) next.alpl = "ต้องกด Lookup เพื่อดึงข้อมูลเดิมก่อน";
    if (!operator) next.operator = "ต้องเลือก Operator";
    if (prefill && !prefill.recieve_date) next.recieve_date = "ต้องกรอกวันที่รับกลับมาใหม่";
    setErrors(next);
    if (Object.keys(next).length > 0 || !prefill) return;

    start.mutate({
      Measure_Type: "Rework",
      number_alpl: [Number(alpl)],
      Operator: operator,
      part_number: prefill.part_number,
      handler: prefill.handler,
      vendor: prefill.vendor,
      description: prefill.description,
      po_number: prefill.po_number ? Number(prefill.po_number) : undefined,
      package_size: prefill.package_size,
      owner: prefill.owner,
      recieve_date: prefill.recieve_date,
    });
  }

  return (
    <>
      <div className="form-grid">
        <div className="form-group">
          <label>
            ALPL <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input type="text" placeholder="ต้องเคยลงทะเบียนผ่าน New มาแล้ว" value={alpl} onChange={(e) => setAlpl(e.target.value)} className={errors.alpl ? "invalid" : ""} disabled={disabled} />
            <button type="button" className="btn-ghost" disabled={disabled || looking} onClick={handleLookup}>
              🔍
            </button>
          </div>
          <div className="field-error">{errors.alpl}</div>
        </div>
        <div className="form-group">
          <label>
            Operator <span style={{ color: "var(--ng)" }}>*</span>
          </label>
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className={errors.operator ? "invalid" : ""} disabled={disabled}>
            <option value="">-- เลือก --</option>
            {lookups.operators.map((o) => (
              <option key={o.operator_id} value={o.operator_name}>
                {o.operator_name}
              </option>
            ))}
          </select>
          <div className="field-error">{errors.operator}</div>
        </div>

        {prefill && (
          <>
            <div className="form-group">
              <label>Part Number</label>
              <input type="text" value={prefill.part_number} onChange={(e) => updatePrefill("part_number", e.target.value)} disabled={disabled} />
            </div>
            <div className="form-group">
              <label>Handler</label>
              <select value={prefill.handler} onChange={(e) => updatePrefill("handler", e.target.value)} disabled={disabled}>
                {lookups.handlers.map((h) => (
                  <option key={h.handler_id} value={h.handler_name}>
                    {h.handler_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Vendor</label>
              <select value={prefill.vendor} onChange={(e) => updatePrefill("vendor", e.target.value)} disabled={disabled}>
                {lookups.vendors.map((v) => (
                  <option key={v.vendor_id} value={v.vendor_name}>
                    {v.vendor_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Owner</label>
              <select value={prefill.owner} onChange={(e) => updatePrefill("owner", e.target.value)} disabled={disabled}>
                {lookups.owners.map((o) => (
                  <option key={o.owner_id} value={o.owner_name}>
                    {o.owner_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Package Size</label>
              <select value={prefill.package_size} onChange={(e) => updatePrefill("package_size", e.target.value)} disabled={disabled}>
                {lookups.packageSizes.map((ps) => (
                  <option key={ps.package_size_id} value={ps.package_size}>
                    {ps.package_size}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>PO Number</label>
              <input type="text" inputMode="numeric" value={prefill.po_number} onChange={(e) => updatePrefill("po_number", e.target.value)} disabled={disabled} />
            </div>
            <div className="form-group">
              <label>
                Receive Date (วันที่รับกลับมาใหม่) <span style={{ color: "var(--ng)" }}>*</span>
              </label>
              <input type="date" value={prefill.recieve_date} onChange={(e) => updatePrefill("recieve_date", e.target.value)} className={errors.recieve_date ? "invalid" : ""} disabled={disabled} />
              <div className="field-error">{errors.recieve_date}</div>
            </div>
            <div className="form-group span-2">
              <label>Description</label>
              <input type="text" value={prefill.description} onChange={(e) => updatePrefill("description", e.target.value)} disabled={disabled} />
            </div>
          </>
        )}
      </div>
      <button type="button" className="btn-primary" disabled={disabled || !prefill || start.isPending} onClick={handleSubmit}>
        ▶ Start
      </button>
    </>
  );
}
