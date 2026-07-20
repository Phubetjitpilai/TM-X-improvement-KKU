import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, ApiError } from "../api/client";
import { useSSE } from "../hooks/useSSE";

// DashboardPage — พอร์ตจาก Frontend/index.html (TM-X Dashboard) แบบยึด
// โครงสร้าง/ข้อความ/พฤติกรรมตามต้นฉบับเป๊ะๆ (ไม่ใช่ดีไซน์ใหม่ของตัวเอง) —
// เขียนรวมไว้ไฟล์เดียวขนาดใหญ่โดยตั้งใจ (แทนที่จะแยก component ย่อยเยอะๆ)
// เพราะ state ของหน้านี้พันกันหมดทุกส่วน (session/queue/telemetry/parts
// cache) เหมือนต้นฉบับที่เป็น script เดียวในไฟล์เดียวเช่นกัน

const PART_ENTRY_STORAGE_KEY = "tmx_part_entry_state_v1";
const MEAS_PAGE_SIZE = 10;
const ENTRY_MODES = ["ipm", "new", "rework"] as const;
type EntryMode = (typeof ENTRY_MODES)[number];

interface SessionState {
  state: "idle" | "running" | "stopped" | "timeout";
  session_id: number | null;
  measured_count: number;
  target_count: number;
}

interface Part {
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
  image_path?: string | null;
  image_upload_failed?: boolean;
}

interface Telemetry {
  number_alpl?: number;
  value_x: number;
  value_y: number;
  result: string;
  measurement_id?: number;
}

interface NewFields {
  part_number: string;
  handler: string | null;
  description: string | null;
  vendor: string | null;
  po_number: number | null;
  package_size: string | null;
  owner: string | null;
  recieve_date: string | null;
}

interface IpmQueue {
  list: number[];
  operator: string;
  session_id?: number | null;
}
interface NewQueue {
  list: number[];
  fields: NewFields;
  note: string | null;
  operator: string;
  session_id?: number | null;
}
interface ReworkQueue {
  list: number[];
  fields: NewFields;
  operator: string;
  session_id?: number | null;
}

function parseAlplList(raw: string): { list?: number[]; error?: string | null } {
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (tokens.length === 0) return { error: null };
  const list: number[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isInteger(n) || n <= 0) return { error: token };
    if (!seen.has(n)) {
      seen.add(n);
      list.push(n);
    }
  }
  return { list };
}

const HINT_TEXT = "ℹ️ ลำดับ ALPL ที่กรอกจะถูกใช้ map กับค่าที่วัดได้ตามลำดับ ตอนกด Start ในรอบถัดไป";

export default function DashboardPage() {
  // ── Session ────────────────────────────────────────────────────────
  const [session, setSession] = useState<SessionState>({ state: "idle", session_id: null, measured_count: 0, target_count: 1 });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ── Telemetry / Camera preview ───────────────────────────────────────
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [lastImageMeasurementId, setLastImageMeasurementId] = useState<number | null>(null);
  const [cameraImgUrl, setCameraImgUrl] = useState<string | null>(null);

  // ── Stats ─────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ total: 0, ok: 0, ng: 0 });

  // ── Parts cache (ใช้ validate ALPL + report modal — ไม่มีตารางแสดงในหน้านี้) ──
  const partsRef = useRef<Part[]>([]);

  // ── Dropdown lookups (Operator/Owner/Vendor/Handler/Package Size) ────
  // โหลดครั้งเดียวตอนเปิดหน้าจาก endpoint ของแต่ละตัวจริงๆ (เหมือน index.html
  // ต้นฉบับ) ไม่ใช่ derive จาก parts cache (เดิมทำผิดไป — ทำให้ Operator ไม่มี
  // ตัวเลือกเลยเพราะ parts ไม่มี field operator, และ Handler/Vendor/Owner/
  // Package Size ก็โชว์ไม่ครบเพราะเห็นแค่ค่าที่เคยผูกกับ part ที่โหลดมาแล้ว)
  const [operatorOptions, setOperatorOptions] = useState<string[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [handlerOptions, setHandlerOptions] = useState<string[]>([]);
  const [packageSizeOptions, setPackageSizeOptions] = useState<string[]>([]);

  // ── Part Entry queues ────────────────────────────────────────────────
  const [ipmQueue, setIpmQueue] = useState<IpmQueue | null>(null);
  const [newQueue, setNewQueue] = useState<NewQueue | null>(null);
  const [reworkQueue, setReworkQueue] = useState<ReworkQueue | null>(null);
  const ipmQueueRef = useRef<IpmQueue | null>(null);
  const newQueueRef = useRef<NewQueue | null>(null);
  const reworkQueueRef = useRef<ReworkQueue | null>(null);
  ipmQueueRef.current = ipmQueue;
  newQueueRef.current = newQueue;
  reworkQueueRef.current = reworkQueue;

  // ── Part Entry modal / toggle ────────────────────────────────────────
  const [peModalOpen, setPeModalOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [peSummaryOpen, setPeSummaryOpen] = useState(false);

  const emptyNewForm = { numberAlpl: "", partNumber: "", operator: "", handler: "", vendor: "", description: "", poNumber: "", packageSize: "", owner: "", receiveDate: "", note: "" };
  const emptyReworkForm = { numberAlpl: "", operator: "", partNumber: "", handler: "", vendor: "", description: "", poNumber: "", packageSize: "", owner: "", receiveDate: "" };

  const [ipmForm, setIpmForm] = useState({ numberAlpl: "", operator: "", packageSize: "" });
  const [ipmErrors, setIpmErrors] = useState<Record<string, string>>({});
  const [ipmLocked, setIpmLocked] = useState(false);
  const [ipmStatus, setIpmStatus] = useState("");
  const [ipmPkgDisabled, setIpmPkgDisabled] = useState(false);
  const [ipmPkgPlaceholder, setIpmPkgPlaceholder] = useState("ต้องกรอกถ้ามี ALPL ที่ยังไม่เคยลงทะเบียน");

  const [newForm, setNewForm] = useState(emptyNewForm);
  const [newErrors, setNewErrors] = useState<Record<string, string>>({});
  const [newLocked, setNewLocked] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  const [reworkForm, setReworkForm] = useState(emptyReworkForm);
  const [reworkErrors, setReworkErrors] = useState<Record<string, string>>({});
  const [reworkLocked, setReworkLocked] = useState(false);
  const [reworkStatus, setReworkStatus] = useState("");

  // ── Confirm modal (Promise-based, ใช้ตอน IPM เจอ ALPL ที่ยังไม่เคยลงทะเบียน) ──
  const [confirmModal, setConfirmModal] = useState<{ message: string } | null>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  function showConfirmModal(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmModal({ message });
    });
  }
  function resolveConfirmModal(result: boolean) {
    setConfirmModal(null);
    confirmResolveRef.current?.(result);
    confirmResolveRef.current = null;
  }

  // ── Measurements table (server-side pagination + filter) ─────────────
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measTotal, setMeasTotal] = useState(0);
  const [measPage, setMeasPage] = useState(1);
  const [measFilterAlplInput, setMeasFilterAlplInput] = useState("");
  const measFilterAlplRef = useRef("");
  const [measFilterDate, setMeasFilterDate] = useState("");
  const measSearchTimer = useRef<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // ── Report modal ───────────────────────────────────────────────────────
  const [reportModal, setReportModal] = useState<{ measurement: Measurement; part: Part | null; imageUrl: string | null; imageState: "loading" | "ok" | "none" } | null>(null);

  const stationStatus = useSSE({
    session_started: (d) => onSessionStarted(d),
    measurement: (d) => onNewMeasurement(d),
    session_stopped: () => onSessionStopped(),
    session_complete: (d) => onSessionComplete(d),
    session_timeout: () => onSessionTimeout(),
    image_updated: (d) => onImageUpdated(d),
  });
  const stationStatusRef = useRef(stationStatus);
  stationStatusRef.current = stationStatus;

  // ── localStorage persistence (ipmQueue/newQueue/reworkQueue/telemetry) ──
  function savePartEntryState() {
    try {
      localStorage.setItem(
        PART_ENTRY_STORAGE_KEY,
        JSON.stringify({
          ipmQueue: ipmQueueRef.current,
          newQueue: newQueueRef.current,
          reworkQueue: reworkQueueRef.current,
          lastTelemetry: telemetry,
          lastImageMeasurementId,
        }),
      );
    } catch {
      /* localStorage อาจใช้ไม่ได้ — ไม่ critical ปล่อยผ่าน */
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Data loaders
  // ══════════════════════════════════════════════════════════════════
  async function refreshParts(): Promise<Part[]> {
    try {
      const d = await apiGet<{ items: Part[]; total: number }>("/api/parts", { limit: 100000 });
      const items = d.items ?? [];
      partsRef.current = items;
      return items;
    } catch (e) {
      console.warn("refreshParts:", e);
      return partsRef.current;
    }
  }

  async function loadMeasurementsPage(page = measPage, alpl = measFilterAlplRef.current, date = measFilterDate) {
    const params: Record<string, string | number> = { limit: MEAS_PAGE_SIZE, offset: (page - 1) * MEAS_PAGE_SIZE };
    if (alpl) params.number_alpl = alpl;
    if (date) {
      params.date_from = `${date} 00:00:00`;
      params.date_to = `${date} 23:59:59`;
    }
    try {
      const d = await apiGet<{ items: Measurement[]; total: number }>("/api/measurements", params);
      setMeasurements(d.items ?? []);
      setMeasTotal(d.total ?? 0);
    } catch (e) {
      console.warn("loadMeasurementsPage:", e);
    }
  }

  async function updateStats(sid: number | null) {
    if (sid == null) {
      setStats({ total: 0, ok: 0, ng: 0 });
      return;
    }
    try {
      const [totalD, okD, ngD] = await Promise.all([
        apiGet<{ total: number }>("/api/measurements", { session_id: sid, limit: 1 }).catch(() => ({ total: 0 })),
        apiGet<{ total: number }>("/api/measurements", { session_id: sid, result: "OK", limit: 1 }).catch(() => ({ total: 0 })),
        apiGet<{ total: number }>("/api/measurements", { session_id: sid, result: "NG", limit: 1 }).catch(() => ({ total: 0 })),
      ]);
      setStats({ total: totalD.total ?? 0, ok: okD.total ?? 0, ng: ngD.total ?? 0 });
    } catch (e) {
      console.warn("updateStats:", e);
    }
  }

  async function loadDropdownData() {
    const [operators, owners, vendors, handlers, packageSizes] = await Promise.all([
      apiGet<{ operator_name: string }[]>("/api/operators").catch(() => []),
      apiGet<{ owner_name: string }[]>("/api/owners").catch(() => []),
      apiGet<{ vendor_name: string }[]>("/api/vendors").catch(() => []),
      apiGet<{ handler_name: string }[]>("/api/handlers").catch(() => []),
      apiGet<{ package_size: string }[]>("/api/package-sizes").catch(() => []),
    ]);
    setOperatorOptions(operators.map((o) => o.operator_name));
    setOwnerOptions(owners.map((o) => o.owner_name));
    setVendorOptions(vendors.map((v) => v.vendor_name));
    setHandlerOptions(handlers.map((h) => h.handler_name));
    setPackageSizeOptions(packageSizes.map((p) => p.package_size));
  }

  async function loadSessionState() {
    try {
      const d = await apiGet<Partial<SessionState>>("/api/session/state");
      updateSession(d);
    } catch (e) {
      console.warn("loadSessionState:", e);
    }
  }

  // updateSession: merge ค่าใหม่เข้ากับ session เดิม + เช็คว่าคิว Part Entry
  // ที่ค้างอยู่ "หมดอายุ" ไปแล้วหรือยัง (ผูกกับ session_id ที่จบไปแล้ว) —
  // เทียบ session_id ตรงๆ แทนการเช็คแค่ transition สด เพื่อครอบคลุมเคส
  // เปิดหน้า/refresh หลัง session จบไปแล้ว (ดู comment เดิมใน index.html)
  function updateSession(data: Partial<SessionState>) {
    const merged = { ...sessionRef.current, ...data } as SessionState;
    setSession(merged);
    sessionRef.current = merged;

    const queue = ipmQueueRef.current || newQueueRef.current || reworkQueueRef.current;
    const queueIsStale = !!queue && queue.session_id != null && !(merged.state === "running" && merged.session_id === queue.session_id);
    if (queueIsStale) {
      clearAllQueuesAndForms();
    }
    updateStats(merged.session_id);
  }

  function clearAllQueuesAndForms() {
    setIpmQueue(null);
    setNewQueue(null);
    setReworkQueue(null);
    ipmQueueRef.current = null;
    newQueueRef.current = null;
    reworkQueueRef.current = null;
    savePartEntryState();
    setIpmForm({ numberAlpl: "", operator: "", packageSize: "" });
    setIpmErrors({});
    setIpmLocked(false);
    setIpmStatus("");
    setNewForm(emptyNewForm);
    setNewErrors({});
    setNewLocked(false);
    setNewStatus("");
    setReworkForm(emptyReworkForm);
    setReworkErrors({});
    setReworkLocked(false);
    setReworkStatus("");
    setEntryMode(null);
  }

  function resetTelemetry() {
    setTelemetry(null);
    setCameraImgUrl(null);
    setLastImageMeasurementId(null);
    savePartEntryState();
  }

  // ── SSE handlers ───────────────────────────────────────────────────
  function onSessionStarted(d: any) {
    resetTelemetry();
    updateSession({ state: "running", session_id: d.session_id, measured_count: 0, target_count: d.target_count });
  }
  async function onNewMeasurement(d: any) {
    updateSession({ measured_count: d.measured, target_count: d.target });
    setTelemetry(d);
    savePartEntryState();
    updateStats(sessionRef.current.session_id);
    if (measPage === 1 && !measFilterAlplRef.current && !measFilterDate) {
      await loadMeasurementsPage(1, "", measFilterDate);
      setHighlightId(d.measurement_id);
      window.setTimeout(() => setHighlightId((h) => (h === d.measurement_id ? null : h)), 2600);
    }
  }
  function onSessionStopped() {
    resetTelemetry();
    updateSession({ state: "stopped" });
    clearAllQueuesAndForms();
  }
  function onSessionComplete(d: any) {
    resetTelemetry();
    updateSession({ state: "stopped", measured_count: d.measured, target_count: d.target });
    clearAllQueuesAndForms();
  }
  function onSessionTimeout() {
    resetTelemetry();
    updateSession({ state: "timeout" });
    clearAllQueuesAndForms();
  }
  async function onImageUpdated(d: any) {
    setMeasurements((prev) => prev.map((m) => (m.measurement_id === d.measurement_id ? { ...m, image_path: d.image_path, image_upload_failed: !!d.upload_failed } : m)));
    if (d.upload_failed) return;
    await updateCameraPreview(d.measurement_id);
  }

  async function updateCameraPreview(measurementId: number) {
    try {
      const data = await apiGet<{ url: string }>(`/api/image-url/${measurementId}`);
      setCameraImgUrl(data.url);
      setLastImageMeasurementId(measurementId);
      savePartEntryState();
    } catch (e) {
      // /api/image-url ปัจจุบันเป็นแค่ stub (ตอบ 404 เสมอ — ดู CLAUDE.md) —
      // ล้มเหลวเงียบๆ เหมือนต้นฉบับ ปล่อยให้ Camera Preview โชว่ placeholder ต่อไป
      console.warn("updateCameraPreview:", e);
    }
  }

  // ── Mount: โหลดข้อมูลเริ่มต้น + restore localStorage + polling สำรอง ──────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PART_ENTRY_STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.ipmQueue) setIpmQueue(d.ipmQueue), (ipmQueueRef.current = d.ipmQueue);
        if (d.newQueue) setNewQueue(d.newQueue), (newQueueRef.current = d.newQueue);
        if (d.reworkQueue) setReworkQueue(d.reworkQueue), (reworkQueueRef.current = d.reworkQueue);
        if (d.lastTelemetry) setTelemetry(d.lastTelemetry);
        if (d.lastImageMeasurementId) {
          setLastImageMeasurementId(d.lastImageMeasurementId);
          updateCameraPreview(d.lastImageMeasurementId);
        }
      }
    } catch (e) {
      console.warn("loadPartEntryState:", e);
    }

    (async () => {
      await Promise.all([loadSessionState(), loadMeasurementsPage(1, "", ""), refreshParts(), loadDropdownData()]);
    })();

    const t = window.setInterval(loadSessionState, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Measurements filter/pagination handlers ───────────────────────────
  function onMeasSearchChange(value: string) {
    setMeasFilterAlplInput(value);
    if (measSearchTimer.current) window.clearTimeout(measSearchTimer.current);
    measSearchTimer.current = window.setTimeout(async () => {
      measFilterAlplRef.current = value.trim();
      setMeasPage(1);
      await loadMeasurementsPage(1, measFilterAlplRef.current, measFilterDate);
    }, 300);
  }
  async function onMeasDateChange(value: string) {
    setMeasFilterDate(value);
    setMeasPage(1);
    await loadMeasurementsPage(1, measFilterAlplRef.current, value);
  }
  async function onMeasClearFilter() {
    if (measSearchTimer.current) window.clearTimeout(measSearchTimer.current);
    setMeasFilterAlplInput("");
    measFilterAlplRef.current = "";
    setMeasFilterDate("");
    setMeasPage(1);
    await loadMeasurementsPage(1, "", "");
  }
  async function onMeasPrev() {
    if (measPage <= 1) return;
    const p = measPage - 1;
    setMeasPage(p);
    await loadMeasurementsPage(p, measFilterAlplRef.current, measFilterDate);
  }
  async function onMeasNext() {
    if ((measPage - 1) * MEAS_PAGE_SIZE + measurements.length >= measTotal) return;
    const p = measPage + 1;
    setMeasPage(p);
    await loadMeasurementsPage(p, measFilterAlplRef.current, measFilterDate);
  }

  // ══════════════════════════════════════════════════════════════════
  // Session Start / Stop
  // ══════════════════════════════════════════════════════════════════
  const hasQueue = !!(ipmQueue || newQueue || reworkQueue);
  const canStart = session.state !== "running" && stationStatus === "online" && hasQueue;
  const startLabel = ipmQueue
    ? `▶ Start (IPM ×${ipmQueue.list.length})`
    : newQueue
      ? `▶ Start (New ×${newQueue.list.length})`
      : reworkQueue
        ? `▶ Start (Rework ×${reworkQueue.list.length})`
        : "▶ Start (กด Save IPM/New/Rework ก่อน)";

  async function startFromQueue() {
    const mode: EntryMode = ipmQueue ? "ipm" : newQueue ? "new" : "rework";
    const queue = ipmQueue || newQueue || reworkQueue;
    if (!queue) return;
    const list = queue.list;
    const label = mode === "ipm" ? "IPM" : mode === "new" ? "New" : "Rework";
    if (!window.confirm(`เริ่ม session ด้วยคิว ${label} จำนวน ${list.length} ALPL (${list.join(", ")}) ใช่ไหม?`)) return;

    const numberAlplStrList = list.map((n) => String(n));
    let body: Record<string, unknown>;
    if (mode === "ipm" && ipmQueue) {
      body = { "จำนวนชิ้นงานที่ต้องวัด": list.length, Measure_Type: "IPM", number_alpl: numberAlplStrList, Operator: ipmQueue.operator };
    } else if (mode === "new" && newQueue) {
      body = {
        "จำนวนชิ้นงานที่ต้องวัด": list.length,
        Measure_Type: "New",
        number_alpl: numberAlplStrList,
        Operator: newQueue.operator,
        Note: newQueue.note ?? null,
        ...newQueue.fields,
      };
    } else if (reworkQueue) {
      body = {
        "จำนวนชิ้นงานที่ต้องวัด": list.length,
        Measure_Type: "Rework",
        number_alpl: numberAlplStrList,
        Operator: reworkQueue.operator,
        ...reworkQueue.fields,
      };
    } else {
      return;
    }

    try {
      const data = await apiPost<{ session_id: number; target_count: number }>("/api/session/start", body);
      queue.session_id = data.session_id;
      if (mode === "ipm") setIpmQueue({ ...queue } as IpmQueue);
      else if (mode === "new") setNewQueue({ ...queue } as NewQueue);
      else setReworkQueue({ ...queue } as ReworkQueue);
      savePartEntryState();
      updateSession({ state: "running", session_id: data.session_id, measured_count: 0, target_count: data.target_count });
      refreshParts();
    } catch (e) {
      window.alert(`Error: ${e instanceof ApiError ? e.message : "Start failed"}`);
    }
  }

  async function stopSession() {
    if (!window.confirm("Stop the current session?")) return;
    try {
      await apiPost("/api/session/stop", { session_id: session.session_id });
    } catch (e) {
      window.alert(`Error: ${e instanceof ApiError ? e.message : "Stop failed"}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Part Entry — mode switching
  // ══════════════════════════════════════════════════════════════════
  function formHasData(mode: EntryMode): boolean {
    if (mode === "ipm") return !!(ipmForm.numberAlpl || ipmForm.operator || ipmForm.packageSize);
    if (mode === "new") return Object.values(newForm).some((v) => v.trim() !== "");
    return Object.values(reworkForm).some((v) => v.trim() !== "");
  }
  function clearFormCompletely(mode: EntryMode) {
    if (mode === "ipm") {
      setIpmForm({ numberAlpl: "", operator: "", packageSize: "" });
      setIpmErrors({});
      setIpmLocked(false);
      setIpmStatus("");
    } else if (mode === "new") {
      setNewForm(emptyNewForm);
      setNewErrors({});
      setNewLocked(false);
      setNewStatus("");
    } else {
      setReworkForm(emptyReworkForm);
      setReworkErrors({});
      setReworkLocked(false);
      setReworkStatus("");
    }
  }
  function switchEntryMode(target: EntryMode) {
    if (entryMode === target) return;
    const otherModes = ENTRY_MODES.filter((m) => m !== target);
    const dirtyMode = otherModes.find((m) => formHasData(m));
    if (dirtyMode) {
      const labels = { ipm: "IPM", new: "New", rework: "Rework" };
      if (!window.confirm(`หากกด ${labels[target]} ข้อมูลที่กรอกไว้ในฟอร์ม ${labels[dirtyMode]} จะหายไป ดำเนินการต่อหรือไม่?`)) return;
    }
    otherModes.forEach(clearFormCompletely);
    setEntryMode(target);
  }

  function openPeModal() {
    if (ipmQueue) setEntryMode("ipm");
    else if (newQueue) setEntryMode("new");
    else if (reworkQueue) setEntryMode("rework");
    setPeModalOpen(true);
  }
  function closePeModal() {
    setPeModalOpen(false);
  }

  // ── IPM ────────────────────────────────────────────────────────────
  async function updateIpmPackageSizeLock(raw: string) {
    const { list, error } = parseAlplList(raw);
    if (!list || list.length === 0 || error) {
      setIpmPkgDisabled(false);
      setIpmPkgPlaceholder("ต้องกรอกถ้ามี ALPL ที่ยังไม่เคยลงทะเบียน");
      return;
    }
    const items = await refreshParts();
    const registeredSet = new Set(items.map((p) => p.number_alpl));
    const allRegistered = list.every((n) => registeredSet.has(n));
    setIpmPkgDisabled(allRegistered);
    if (allRegistered) {
      setIpmForm((f) => ({ ...f, packageSize: "" }));
      setIpmPkgPlaceholder("ไม่ต้องกรอก — ALPL ทุกตัวลงทะเบียนแล้ว");
    } else {
      setIpmPkgPlaceholder("ต้องกรอกถ้ามี ALPL ที่ยังไม่เคยลงทะเบียน");
    }
  }

  async function onSubmitIpm(e: React.FormEvent) {
    e.preventDefault();
    setIpmErrors({});
    const numberAlplRaw = ipmForm.numberAlpl.trim();
    const operator = ipmForm.operator.trim();
    const packageSize = ipmForm.packageSize.trim();
    const { list: numberAlplList, error: alplError } = parseAlplList(numberAlplRaw);

    let hasError = false;
    const errors: Record<string, string> = {};
    let unregistered: number[] = [];
    if (alplError === null) {
      errors.number_alpl = "กรอก ALPL อย่างน้อย 1 ค่า";
      hasError = true;
    } else if (alplError) {
      errors.number_alpl = `"${alplError}" ไม่ใช่เลข ALPL ที่ถูกต้อง (ต้องเป็นเลขจำนวนเต็มบวก)`;
      hasError = true;
    } else {
      const items = await refreshParts();
      const registeredSet = new Set(items.map((p) => p.number_alpl));
      unregistered = (numberAlplList ?? []).filter((n) => !registeredSet.has(n));
    }
    if (!operator) {
      errors.operator = "กรอกชื่อ Operator";
      hasError = true;
    }
    if (hasError) {
      setIpmErrors(errors);
      return;
    }

    if (unregistered.length > 0) {
      if (!packageSize) {
        setIpmErrors({ package_size: `ต้องเลือก Package Size ก่อน — มี ALPL ที่ยังไม่เคยลงทะเบียน: ${unregistered.join(", ")}` });
        return;
      }
      closePeModal();
      const proceed = await showConfirmModal(
        `ALPL ${unregistered.join(", ")} ยังไม่เคยบันทึกมาก่อน — ระบบจะลงทะเบียน Part ใหม่ด้วย Package Size "${packageSize}" แล้วดำเนินการวัดต่อเลย คุณจะดำเนินการต่อหรือไม่?`,
      );
      if (!proceed) {
        setPeModalOpen(true);
        return;
      }
      for (const alpl of unregistered) {
        try {
          await apiPost("/api/parts", { number_alpl: alpl, package_size: packageSize });
        } catch (err) {
          setPeModalOpen(true);
          setIpmErrors({ package_size: err instanceof ApiError ? err.message : `ลงทะเบียน ALPL ${alpl} ไม่สำเร็จ` });
          return;
        }
      }
      await refreshParts();
    }

    setNewQueue(null);
    setReworkQueue(null);
    const queue: IpmQueue = { list: numberAlplList ?? [], operator };
    setIpmQueue(queue);
    ipmQueueRef.current = queue;
    savePartEntryState();
    updateSession({ target_count: (numberAlplList ?? []).length, measured_count: 0 });

    setIpmStatus(`✔ บันทึกสำเร็จ ${(numberAlplList ?? []).length} ALPL`);
    setIpmLocked(true);
    closePeModal();
    window.setTimeout(() => setIpmStatus(""), 4000);
  }

  // ── New ────────────────────────────────────────────────────────────
  function checkAlplExistence(list: number[], mode: "new" | "rework"): string | null {
    const registeredSet = new Set(partsRef.current.map((p) => p.number_alpl));
    if (mode === "new") {
      const already = list.filter((n) => registeredSet.has(n));
      if (already.length > 0) return `ALPL ${already.join(", ")} ลงทะเบียนชิ้นงานนี้ไปแล้ว`;
    } else {
      const notRegistered = list.filter((n) => !registeredSet.has(n));
      if (notRegistered.length > 0) return `ALPL ${notRegistered.join(", ")} ยังไม่ได้ลงทะเบียนชิ้นงานนี้ — กรุณาไปลงทะเบียนที่แท็บ New ก่อน`;
    }
    return null;
  }

  async function onSubmitNew(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const { list: numberAlplList, error: alplError } = parseAlplList(newForm.numberAlpl.trim());
    if (alplError === null) errors.number_alpl = "กรอก ALPL อย่างน้อย 1 ค่า";
    else if (alplError) errors.number_alpl = `"${alplError}" ไม่ใช่เลข ALPL ที่ถูกต้อง (ต้องเป็นเลขจำนวนเต็มบวก)`;
    else {
      await refreshParts();
      const existenceError = checkAlplExistence(numberAlplList ?? [], "new");
      if (existenceError) errors.number_alpl = existenceError;
    }
    if (!newForm.partNumber.trim()) errors.part_number = "กรอก Part Number";
    if (!newForm.operator.trim()) errors.operator = "กรอกชื่อ Operator";
    if (!newForm.packageSize.trim()) errors.package_size = "กรอก Package Size (จะ map nominal/tolerance/template ให้อัตโนมัติ)";
    if (!newForm.handler.trim()) errors.handler = "เลือก Handler";
    if (!newForm.vendor.trim()) errors.vendor = "เลือก Vendor";
    if (!newForm.description.trim()) errors.description = "กรอก Description";
    if (!newForm.owner.trim()) errors.owner = "เลือก Owner";
    if (newForm.poNumber.trim() === "") errors.po_number = "กรอก PO Number";
    else if (isNaN(Number(newForm.poNumber))) errors.po_number = "ต้องเป็นตัวเลข";

    if (Object.keys(errors).length > 0) {
      setNewErrors(errors);
      return;
    }

    const fields: NewFields = {
      part_number: newForm.partNumber.trim(),
      handler: newForm.handler.trim() || null,
      description: newForm.description.trim() || null,
      vendor: newForm.vendor.trim() || null,
      po_number: newForm.poNumber.trim() === "" ? null : Number(newForm.poNumber),
      package_size: newForm.packageSize.trim() || null,
      owner: newForm.owner.trim() || null,
      recieve_date: newForm.receiveDate.trim() || null,
    };
    const note = newForm.note.trim() || null;

    updateSession({ target_count: (numberAlplList ?? []).length, measured_count: 0 });
    setIpmQueue(null);
    setReworkQueue(null);
    const queue: NewQueue = { list: numberAlplList ?? [], fields, note, operator: newForm.operator.trim() };
    setNewQueue(queue);
    newQueueRef.current = queue;
    savePartEntryState();

    setNewStatus(`✔ บันทึกสำเร็จ ${(numberAlplList ?? []).length} ALPL`);
    setNewLocked(true);
    closePeModal();
    window.setTimeout(() => setNewStatus(""), 4000);
  }

  // ── Rework ─────────────────────────────────────────────────────────
  async function updateReworkPrefill(raw: string) {
    if (!raw.trim()) return;
    const { list, error } = parseAlplList(raw.trim());
    if (error) return;
    if (!list || list.length !== 1) return;
    const items = await refreshParts();
    const found = items.find((p) => p.number_alpl === list[0]);
    if (!found) {
      setReworkErrors({ number_alpl: `ALPL ${list[0]} ยังไม่เคยลงทะเบียน — ไปที่แท็บ New ก่อน` });
      return;
    }
    setReworkErrors({});
    setReworkForm((f) => ({
      ...f,
      partNumber: found.part_number ?? "",
      handler: found.handler ?? "",
      vendor: found.vendor ?? "",
      description: found.description ?? "",
      poNumber: found.po_number != null ? String(found.po_number) : "",
      packageSize: found.package_size ?? "",
      owner: found.owner ?? "",
      receiveDate: "",
    }));
  }

  async function onSubmitRework(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const { list: numberAlplList, error: alplError } = parseAlplList(reworkForm.numberAlpl.trim());
    if (alplError === null) errors.number_alpl = "กรอก ALPL 1 ค่า";
    else if (alplError) errors.number_alpl = `"${alplError}" ไม่ใช่เลข ALPL ที่ถูกต้อง (ต้องเป็นเลขจำนวนเต็มบวก)`;
    else if ((numberAlplList ?? []).length !== 1)
      errors.number_alpl = "Rework รองรับทีละ 1 ALPL เท่านั้น — กรอกทีละตัว แล้วกด Start ทีละรอบ";
    else {
      await refreshParts();
      const existenceError = checkAlplExistence(numberAlplList ?? [], "rework");
      if (existenceError) errors.number_alpl = existenceError;
    }
    if (!reworkForm.operator.trim()) errors.operator = "กรอกชื่อ Operator";
    if (!reworkForm.partNumber.trim()) errors.part_number = "กรอก Part Number";
    if (!reworkForm.handler.trim()) errors.handler = "เลือก Handler";
    if (!reworkForm.vendor.trim()) errors.vendor = "เลือก Vendor";
    if (!reworkForm.description.trim()) errors.description = "กรอก Description";
    if (!reworkForm.packageSize.trim()) errors.package_size = "กรอก Package Size";
    if (!reworkForm.owner.trim()) errors.owner = "เลือก Owner";
    if (!reworkForm.receiveDate.trim()) errors.receive_date = "กรอกวันที่รับชิ้นงานกลับมา";
    if (reworkForm.poNumber.trim() === "") errors.po_number = "กรอก PO Number";
    else if (isNaN(Number(reworkForm.poNumber))) errors.po_number = "ต้องเป็นตัวเลข";

    if (Object.keys(errors).length > 0) {
      setReworkErrors(errors);
      return;
    }

    const fields: NewFields = {
      part_number: reworkForm.partNumber.trim(),
      handler: reworkForm.handler.trim() || null,
      description: reworkForm.description.trim() || null,
      vendor: reworkForm.vendor.trim() || null,
      po_number: reworkForm.poNumber.trim() === "" ? null : Number(reworkForm.poNumber),
      package_size: reworkForm.packageSize.trim() || null,
      owner: reworkForm.owner.trim() || null,
      recieve_date: reworkForm.receiveDate.trim() || null,
    };

    updateSession({ target_count: (numberAlplList ?? []).length, measured_count: 0 });
    setIpmQueue(null);
    setNewQueue(null);
    const queue: ReworkQueue = { list: numberAlplList ?? [], fields, operator: reworkForm.operator.trim() };
    setReworkQueue(queue);
    reworkQueueRef.current = queue;
    savePartEntryState();

    setReworkStatus(`✔ บันทึกสำเร็จ ${(numberAlplList ?? []).length} ALPL`);
    setReworkLocked(true);
    closePeModal();
    window.setTimeout(() => setReworkStatus(""), 4000);
  }

  // ══════════════════════════════════════════════════════════════════
  // Report modal (คลิกแถวในตาราง Measurements)
  // ══════════════════════════════════════════════════════════════════
  async function openReportModal(measurementId: number) {
    const m = measurements.find((x) => x.measurement_id === measurementId);
    if (!m) return;
    let part: Part | null = null;
    try {
      part = await apiGet<Part>(`/api/parts/${m.number_alpl}`);
    } catch {
      part = partsRef.current.find((p) => p.number_alpl === m.number_alpl) ?? null;
    }
    setReportModal({ measurement: m, part, imageUrl: null, imageState: m.image_path ? "loading" : "none" });
    if (m.image_path) {
      try {
        const data = await apiGet<{ url: string }>(`/api/image-url/${measurementId}`);
        setReportModal((prev) => (prev && prev.measurement.measurement_id === measurementId ? { ...prev, imageUrl: data.url, imageState: "ok" } : prev));
      } catch {
        setReportModal((prev) => (prev && prev.measurement.measurement_id === measurementId ? { ...prev, imageState: "none" } : prev));
      }
    }
  }

  const isRunning = session.state === "running";
  const canEditQueue = session.state !== "running";
  const activeQueue = ipmQueue || newQueue || reworkQueue;
  const activeQueueMode: EntryMode | null = ipmQueue ? "ipm" : newQueue ? "new" : reworkQueue ? "rework" : null;

  return (
    <div className="layout">
      <main className="main">
        {/* Section 1 — Session Control */}
        <section>
          <div className="card">
            <div className="card-title">Session Control</div>
            <div className="session-row">
              <div className="session-info">
                <div className="session-state-label">Status</div>
                <div className={`session-state-badge ${session.state}`}>{session.state.toUpperCase()}</div>
              </div>
              <div className="session-btns">
                <button className="btn-start" disabled={!canStart} onClick={startFromQueue}>
                  {startLabel}
                </button>
                {isRunning && (
                  <button className="btn-stop" onClick={stopSession}>
                    ■ Stop
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2 — Live View */}
        <section>
          <div className="live-view-grid">
            <div className="card">
              <div className="telemetry-header">
                <div className="card-title" style={{ marginBottom: 0 }}>
                  Live Telemetry
                </div>
                <span className="telemetry-alpl-badge">ALPL {telemetry?.number_alpl ?? "—"}</span>
              </div>
              <div className="telemetry-grid">
                <div className="telemetry-xy-col">
                  <div className="telemetry-cell x">
                    <div className="tc-label">Value X</div>
                    <div className="tc-value">
                      {telemetry ? telemetry.value_x.toFixed(3) : "—"}
                      <span> mm</span>
                    </div>
                  </div>
                  <div className="telemetry-cell y">
                    <div className="tc-label">Value Y</div>
                    <div className="tc-value">
                      {telemetry ? telemetry.value_y.toFixed(3) : "—"}
                      <span> mm</span>
                    </div>
                  </div>
                </div>
                <div className={`telemetry-result-col${telemetry ? (telemetry.result === "OK" ? " ok" : " ng") : ""}`}>
                  <div className="telemetry-result-label">Result</div>
                  <div className={`telemetry-result-value${telemetry ? (telemetry.result === "OK" ? " ok" : " ng") : ""}`}>{telemetry?.result ?? "—"}</div>
                </div>
              </div>
              <div className="telemetry-footer">
                <span>Session</span>
                <strong>{session.state === "idle" || !session.session_id ? "— / — measured" : `${session.measured_count} / ${session.target_count} measured`}</strong>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Camera Preview</div>
              <div className="camera-preview-box">
                {cameraImgUrl ? (
                  <img src={cameraImgUrl} alt={`Latest capture (measurement #${lastImageMeasurementId})`} />
                ) : (
                  <>
                    <span className="camera-preview-icon">🖼</span>
                    <span>No image yet</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3 — Stats */}
        <section>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Total</div>
              <div className="stat-value total">{stats.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">OK</div>
              <div className="stat-value ok">{stats.ok}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">NG</div>
              <div className="stat-value ng">{stats.ng}</div>
            </div>
          </div>
        </section>

        {/* Section 4 — Part Entry */}
        <section>
          <div className="card">
            <div className="pe-card-header">
              <div className="card-title" style={{ marginBottom: 0 }}>
                Part Entry
              </div>
              {activeQueueMode && <span className={`pe-mode-badge-lg ${activeQueueMode}`}>{activeQueueMode === "ipm" ? "IPM" : activeQueueMode === "new" ? "New" : "Rework"}</span>}
            </div>

            {!activeQueue ? (
              <>
                <div className="pe-empty">ยังไม่มีข้อมูล Part Entry ค้างอยู่ — กด "New Entry" เพื่อเตรียมคิว IPM, ลงทะเบียน Part ใหม่ หรือส่ง Rework</div>
                <div style={{ marginTop: "1rem", textAlign: "center" }}>
                  <button className="btn-pe-action" onClick={openPeModal}>
                    + New Entry
                  </button>
                </div>
              </>
            ) : (
              <div className="pe-summary-dropdown">
                <button type="button" className="pe-summary-toggle" onClick={() => setPeSummaryOpen((v) => !v)}>
                  <span className="pe-summary-toggle-left">
                    <span>ALPL: {activeQueue.list.join(", ")}</span>
                  </span>
                  <span className={`pe-summary-arrow${peSummaryOpen ? " open" : ""}`}>▼</span>
                </button>
                <div className={`pe-summary-body${peSummaryOpen ? " open" : ""}`}>
                  <div className="pe-summary-grid">
                    {activeQueueMode === "ipm" && ipmQueue && (
                      <>
                        <span className="pg-label">Number ALPL</span>
                        <span className="pg-value">{ipmQueue.list.join(", ")}</span>
                        <span className="pg-label">Operator</span>
                        <span className="pg-value">{ipmQueue.operator}</span>
                      </>
                    )}
                    {activeQueueMode === "new" && newQueue && (
                      <>
                        <span className="pg-label">Number ALPL</span>
                        <span className="pg-value">{newQueue.list.join(", ")}</span>
                        <span className="pg-label">Operator</span>
                        <span className="pg-value">{newQueue.operator}</span>
                        <span className="pg-label">Note</span>
                        <span className="pg-value">{newQueue.note || "—"}</span>
                        <hr className="pg-divider" />
                        <span className="pg-label">Part Number</span>
                        <span className="pg-value">{newQueue.fields.part_number}</span>
                        <span className="pg-label">Handler</span>
                        <span className="pg-value">{newQueue.fields.handler || "—"}</span>
                        <span className="pg-label">Description</span>
                        <span className="pg-value">{newQueue.fields.description || "—"}</span>
                        <span className="pg-label">Vendor</span>
                        <span className="pg-value">{newQueue.fields.vendor || "—"}</span>
                        <hr className="pg-divider" />
                        <span className="pg-label">Purchase Order No</span>
                        <span className="pg-value">{newQueue.fields.po_number != null ? newQueue.fields.po_number : "—"}</span>
                        <span className="pg-label">Package Size</span>
                        <span className="pg-value">{newQueue.fields.package_size || "—"}</span>
                        <span className="pg-label">Owner</span>
                        <span className="pg-value">{newQueue.fields.owner || "—"}</span>
                        <span className="pg-label">Receive Date</span>
                        <span className="pg-value">{newQueue.fields.recieve_date || "—"}</span>
                      </>
                    )}
                    {activeQueueMode === "rework" && reworkQueue && (
                      <>
                        <span className="pg-label">Number ALPL</span>
                        <span className="pg-value">{reworkQueue.list.join(", ")}</span>
                        <span className="pg-label">Operator</span>
                        <span className="pg-value">{reworkQueue.operator}</span>
                        <hr className="pg-divider" />
                        <span className="pg-label">Part Number</span>
                        <span className="pg-value">{reworkQueue.fields.part_number}</span>
                        <span className="pg-label">Handler</span>
                        <span className="pg-value">{reworkQueue.fields.handler || "—"}</span>
                        <span className="pg-label">Description</span>
                        <span className="pg-value">{reworkQueue.fields.description || "—"}</span>
                        <span className="pg-label">Vendor</span>
                        <span className="pg-value">{reworkQueue.fields.vendor || "—"}</span>
                        <hr className="pg-divider" />
                        <span className="pg-label">Purchase Order No</span>
                        <span className="pg-value">{reworkQueue.fields.po_number != null ? reworkQueue.fields.po_number : "—"}</span>
                        <span className="pg-label">Package Size</span>
                        <span className="pg-value">{reworkQueue.fields.package_size || "—"}</span>
                        <span className="pg-label">Owner</span>
                        <span className="pg-value">{reworkQueue.fields.owner || "—"}</span>
                        <span className="pg-label">Receive Date</span>
                        <span className="pg-value">{reworkQueue.fields.recieve_date || "—"}</span>
                      </>
                    )}
                  </div>
                  <div className="pe-summary-actions">{canEditQueue && (
                    <button className="btn-pe-action" onClick={openPeModal}>
                      ✎ Edit
                    </button>
                  )}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Section 5 — Measurements Table */}
        <section>
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                Measurements <span className="count">({measTotal})</span>
              </div>
            </div>
            <div className="filter-bar">
              <input type="text" placeholder="ค้นหาด้วย ALPL Number..." value={measFilterAlplInput} onChange={(e) => onMeasSearchChange(e.target.value)} />
              <input type="date" title="กรองตาม Timestamp (วันที่)" value={measFilterDate} onChange={(e) => onMeasDateChange(e.target.value)} />
              <button className="btn-clear-filter" onClick={onMeasClearFilter}>
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
                    <th>Image</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={8}>{measFilterAlplRef.current || measFilterDate ? "ไม่พบ Measurement ที่ตรงกับตัวกรอง" : "No measurements"}</td>
                    </tr>
                  ) : (
                    measurements.map((m) => {
                      const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : "—";
                      const res = m.result || "—";
                      const cls = res === "OK" ? "ok" : res === "NG" ? "ng" : "";
                      return (
                        <tr key={m.measurement_id} data-clickable className={highlightId === m.measurement_id ? "highlight-new" : ""} onClick={() => openReportModal(m.measurement_id)}>
                          <td>{m.measurement_id}</td>
                          <td>{m.session_id ?? "—"}</td>
                          <td>{m.number_alpl}</td>
                          <td>{m.value_x != null ? m.value_x.toFixed(3) : "—"}</td>
                          <td>{m.value_y != null ? m.value_y.toFixed(3) : "—"}</td>
                          <td>
                            <span className={`result-badge ${cls}`}>{res}</span>
                          </td>
                          <td className="img-cell">
                            {m.image_path ? (
                              <button className="img-btn-inner" title="View report" onClick={(e) => { e.stopPropagation(); openReportModal(m.measurement_id); }} />
                            ) : m.image_upload_failed ? (
                              <span className="no-img upload-failed" title="Agent อัปโหลดรูปไม่สำเร็จหลังลอง 3 ครั้ง">⚠ Failed</span>
                            ) : (
                              <span className="no-img">—</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{ts}</td>
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
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--muted)" }}>
                {measTotal === 0 ? "ไม่มีรายการ" : `แสดง ${(measPage - 1) * MEAS_PAGE_SIZE + 1}–${(measPage - 1) * MEAS_PAGE_SIZE + measurements.length} จาก ${measTotal} รายการ`}
              </span>
              <button type="button" className="btn-icon" disabled={(measPage - 1) * MEAS_PAGE_SIZE + measurements.length >= measTotal} onClick={onMeasNext}>
                Next ›
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ── Measurement Report modal ─────────────────────────────────── */}
      <div className={`modal-overlay${reportModal ? " open" : ""}`}>
        <div className="report-modal-box">
          {reportModal && (
            <>
              <div className="report-header">
                <div>
                  <div className="report-header-title">Measurement report — ALPL {reportModal.measurement.number_alpl}</div>
                  <div className="report-header-sub">
                    {reportModal.measurement.timestamp ? new Date(reportModal.measurement.timestamp).toLocaleString() : "—"} ·{" "}
                    {reportModal.measurement.session_id != null ? `Session #${reportModal.measurement.session_id}` : "Session —"} · {reportModal.measurement.operator_name || "—"}
                  </div>
                </div>
                <div className="report-header-right">
                  <button className="report-close" onClick={() => setReportModal(null)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="report-grid">
                <div className="report-cell report-image-cell">
                  {reportModal.imageState === "loading" ? (
                    <span className="report-no-image">Loading…</span>
                  ) : reportModal.imageState === "ok" && reportModal.imageUrl ? (
                    <img src={reportModal.imageUrl} alt={`Measurement #${reportModal.measurement.measurement_id} image`} />
                  ) : (
                    <span className="report-no-image">No image</span>
                  )}
                </div>
                <div className="report-cell">
                  <div className="report-section-title">
                    <span className="bar" />
                    Part specifications
                  </div>
                  <div className="report-specs-grid">
                    <div>
                      <div className="rs-label">Part number</div>
                      <div className="rs-value">{reportModal.part?.part_number || "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Handler</div>
                      <div className="rs-value">{reportModal.part?.handler || "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Vendor</div>
                      <div className="rs-value">{reportModal.part?.vendor || "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Package size</div>
                      <div className="rs-value">{reportModal.part?.package_size || "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Owner</div>
                      <div className="rs-value">{reportModal.part?.owner || "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">PO number</div>
                      <div className="rs-value">{reportModal.part?.po_number != null ? reportModal.part.po_number : "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Receive date</div>
                      <div className="rs-value">{reportModal.part?.recieve_date ? new Date(reportModal.part.recieve_date).toLocaleDateString() : "—"}</div>
                    </div>
                    <div>
                      <div className="rs-label">Template</div>
                      <div className="rs-value">{reportModal.part?.template_name || "—"}</div>
                    </div>
                    <div className="rs-full">
                      <div className="rs-label">Description</div>
                      <div className="rs-value">{reportModal.part?.description || "—"}</div>
                    </div>
                  </div>
                </div>
                <div className="report-cell report-status-cell">
                  <span className="report-status-label">Result</span>
                  <span className={`report-status-value${reportModal.measurement.result === "OK" ? " ok" : reportModal.measurement.result === "NG" ? " ng" : ""}`}>
                    {reportModal.measurement.result || "—"}
                  </span>
                </div>
                <div className="report-cell report-dims-cell">
                  <div className="report-section-title">
                    <span className="bar" />
                    Dimensions and tolerances
                  </div>
                  {(() => {
                    const fmt = (v: number | null | undefined) => (v != null && !isNaN(v) ? Number(v).toFixed(3) : "—");
                    const nomX = reportModal.part?.nominal_x, nomY = reportModal.part?.nominal_y;
                    const upTol = reportModal.part?.upper_tol, loTol = reportModal.part?.lower_tol;
                    const bound = (nom: number | null | undefined, tol: number | null | undefined, sign: number) =>
                      nom != null && tol != null ? fmt(Number(nom) + sign * Number(tol)) : "—";
                    return (
                      <div className="report-dims-grid">
                        <div>
                          <div className="report-dim-label">Actual X{nomX != null ? ` · nom ${fmt(nomX)}` : ""}</div>
                          <div className="report-dim-value x">{fmt(reportModal.measurement.value_x)} mm</div>
                          <div className="report-tol-box">
                            <div className="tol-row">
                              <span>Upper</span>
                              <span>{bound(nomX, upTol, 1)}</span>
                            </div>
                            <div className="tol-row">
                              <span>Lower</span>
                              <span>{bound(nomX, loTol, -1)}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="report-dim-label">Actual Y{nomY != null ? ` · nom ${fmt(nomY)}` : ""}</div>
                          <div className="report-dim-value y">{fmt(reportModal.measurement.value_y)} mm</div>
                          <div className="report-tol-box">
                            <div className="tol-row">
                              <span>Upper</span>
                              <span>{bound(nomY, upTol, 1)}</span>
                            </div>
                            <div className="tol-row">
                              <span>Lower</span>
                              <span>{bound(nomY, loTol, -1)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Confirm modal (Promise-based — IPM เจอ ALPL ที่ยังไม่เคยลงทะเบียน) ── */}
      <div className={`modal-overlay${confirmModal ? " open" : ""}`}>
        <div className="pe-modal-box" style={{ maxWidth: 480 }}>
          <div className="pe-modal-header">
            <div className="card-title">ยืนยันการดำเนินการ</div>
          </div>
          <div style={{ fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1.25rem" }}>{confirmModal?.message}</div>
          <div className="entry-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn-edit-entry" onClick={() => resolveConfirmModal(false)}>
              ยกเลิก
            </button>
            <button type="button" className="btn-submit-entry" onClick={() => resolveConfirmModal(true)}>
              ดำเนินการต่อ
            </button>
          </div>
        </div>
      </div>

      {/* ── Part Entry modal ─────────────────────────────────────────── */}
      <div className={`modal-overlay${peModalOpen ? " open" : ""}`}>
        <div className="pe-modal-box">
          <div className="pe-modal-header">
            <div className="card-title">Part Entry</div>
            <button className="pe-modal-close" onClick={closePeModal}>
              ✕
            </button>
          </div>

          <div className="entry-toggle" role="tablist" aria-label="Entry mode">
            <button
              type="button"
              className={`entry-toggle-btn${entryMode === "ipm" ? " active" : ""}`}
              disabled={(entryMode === "new" && newLocked) || (entryMode === "rework" && reworkLocked)}
              title={entryMode === "new" && newLocked ? "กด Edit ในฟอร์ม NEW ก่อน ถ้าต้องการสลับโหมด" : entryMode === "rework" && reworkLocked ? "กด Edit ในฟอร์ม REWORK ก่อน ถ้าต้องการสลับโหมด" : undefined}
              onClick={() => switchEntryMode("ipm")}
            >
              IPM
            </button>
            <button
              type="button"
              className={`entry-toggle-btn${entryMode === "new" ? " active" : ""}`}
              disabled={(entryMode === "ipm" && ipmLocked) || (entryMode === "rework" && reworkLocked)}
              title={entryMode === "ipm" && ipmLocked ? "กด Edit ในฟอร์ม IPM ก่อน ถ้าต้องการสลับโหมด" : entryMode === "rework" && reworkLocked ? "กด Edit ในฟอร์ม REWORK ก่อน ถ้าต้องการสลับโหมด" : undefined}
              onClick={() => switchEntryMode("new")}
            >
              New
            </button>
            <button
              type="button"
              className={`entry-toggle-btn${entryMode === "rework" ? " active" : ""}`}
              disabled={(entryMode === "ipm" && ipmLocked) || (entryMode === "new" && newLocked)}
              title={entryMode === "ipm" && ipmLocked ? "กด Edit ในฟอร์ม IPM ก่อน ถ้าต้องการสลับโหมด" : entryMode === "new" && newLocked ? "กด Edit ในฟอร์ม NEW ก่อน ถ้าต้องการสลับโหมด" : undefined}
              onClick={() => switchEntryMode("rework")}
            >
              Rework
            </button>
          </div>

          {!entryMode && <div className="entry-placeholder">กรุณาเลือกโหมด IPM, New หรือ Rework ก่อนกรอกข้อมูล</div>}

          <datalist id="package-size-datalist">
            {packageSizeOptions.map((ps) => (
              <option key={ps} value={ps} />
            ))}
          </datalist>

          {entryMode === "ipm" && (
            <form onSubmit={onSubmitIpm}>
              <div className="entry-session-hint">{HINT_TEXT}</div>
              <div className="entry-form-grid">
                <div className="form-group">
                  <label>
                    ALPL <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1028, 1029, 1030"
                    disabled={ipmLocked}
                    value={ipmForm.numberAlpl}
                    onChange={(e) => setIpmForm((f) => ({ ...f, numberAlpl: e.target.value }))}
                    onBlur={(e) => updateIpmPackageSizeLock(e.target.value)}
                  />
                  <div className="field-error">{ipmErrors.number_alpl}</div>
                </div>
                <div className="form-group">
                  <label>
                    Operator <span className="req">*</span>
                  </label>
                  <select disabled={ipmLocked} value={ipmForm.operator} onChange={(e) => setIpmForm((f) => ({ ...f, operator: e.target.value }))}>
                    <option value="">-- เลือก Operator --</option>
                    {operatorOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{ipmErrors.operator}</div>
                </div>
                <div className="form-group">
                  <label>Package Size</label>
                  <input
                    type="text"
                    list="package-size-datalist"
                    placeholder={ipmPkgPlaceholder}
                    disabled={ipmLocked || ipmPkgDisabled}
                    value={ipmForm.packageSize}
                    onChange={(e) => setIpmForm((f) => ({ ...f, packageSize: e.target.value }))}
                  />
                  <div className="field-error">{ipmErrors.package_size}</div>
                </div>
              </div>
              <div className="entry-actions">
                {!ipmLocked && (
                  <button type="submit" className="btn-submit-entry">
                    ✔ Save
                  </button>
                )}
                {ipmLocked && canEditQueue && (
                  <button type="button" className="btn-edit-entry" onClick={() => setIpmLocked(false)}>
                    ✎ Edit
                  </button>
                )}
                <span className={`entry-status${ipmStatus ? " success" : ""}`}>{ipmStatus}</span>
              </div>
            </form>
          )}

          {entryMode === "new" && (
            <form onSubmit={onSubmitNew}>
              <div className="entry-session-hint">{HINT_TEXT}</div>
              <div className="entry-form-grid">
                <div className="form-group">
                  <label>
                    ALPL <span className="req">*</span>
                  </label>
                  <input type="text" placeholder="e.g. 1028, 1029, 1030" disabled={newLocked} value={newForm.numberAlpl} onChange={(e) => setNewForm((f) => ({ ...f, numberAlpl: e.target.value }))} />
                  <div className="field-error">{newErrors.number_alpl}</div>
                </div>
                <div className="form-group">
                  <label>
                    Part Number <span className="req">*</span>
                  </label>
                  <input type="text" placeholder="e.g. ADI-9046-X" disabled={newLocked} value={newForm.partNumber} onChange={(e) => setNewForm((f) => ({ ...f, partNumber: e.target.value }))} />
                  <div className="field-error">{newErrors.part_number}</div>
                </div>
                <div className="form-group">
                  <label>
                    Operator <span className="req">*</span>
                  </label>
                  <select disabled={newLocked} value={newForm.operator} onChange={(e) => setNewForm((f) => ({ ...f, operator: e.target.value }))}>
                    <option value="">-- เลือก Operator --</option>
                    {operatorOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{newErrors.operator}</div>
                </div>
                <div className="form-group">
                  <label>
                    Handler <span className="req">*</span>
                  </label>
                  <select disabled={newLocked} value={newForm.handler} onChange={(e) => setNewForm((f) => ({ ...f, handler: e.target.value }))}>
                    <option value="">-- เลือก Handler --</option>
                    {handlerOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{newErrors.handler}</div>
                </div>
                <div className="form-group">
                  <label>
                    Vendor <span className="req">*</span>
                  </label>
                  <select disabled={newLocked} value={newForm.vendor} onChange={(e) => setNewForm((f) => ({ ...f, vendor: e.target.value }))}>
                    <option value="">-- เลือก Vendor --</option>
                    {vendorOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{newErrors.vendor}</div>
                </div>
                <div className="form-group span-2">
                  <label>
                    Description <span className="req">*</span>
                  </label>
                  <input type="text" disabled={newLocked} value={newForm.description} onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))} />
                  <div className="field-error">{newErrors.description}</div>
                </div>
                <div className="form-group">
                  <label>
                    PO Number <span className="req">*</span>
                  </label>
                  <input type="text" inputMode="numeric" placeholder="ตัวเลขเท่านั้น" disabled={newLocked} value={newForm.poNumber} onChange={(e) => setNewForm((f) => ({ ...f, poNumber: e.target.value }))} />
                  <div className="field-error">{newErrors.po_number}</div>
                </div>
                <div className="form-group">
                  <label>
                    Package Size <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    list="package-size-datalist"
                    placeholder="เลือก package size — จะ map nominal/tolerance/template ให้อัตโนมัติ"
                    disabled={newLocked}
                    value={newForm.packageSize}
                    onChange={(e) => setNewForm((f) => ({ ...f, packageSize: e.target.value }))}
                  />
                  <div className="field-error">{newErrors.package_size}</div>
                </div>
                <div className="form-group">
                  <label>
                    Owner <span className="req">*</span>
                  </label>
                  <select disabled={newLocked} value={newForm.owner} onChange={(e) => setNewForm((f) => ({ ...f, owner: e.target.value }))}>
                    <option value="">-- เลือก Owner --</option>
                    {ownerOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{newErrors.owner}</div>
                </div>
                <div className="form-group">
                  <label>Receive Date</label>
                  <input type="date" disabled={newLocked} value={newForm.receiveDate} onChange={(e) => setNewForm((f) => ({ ...f, receiveDate: e.target.value }))} />
                  <div className="field-error">{newErrors.receive_date}</div>
                </div>
                <div className="form-group span-2">
                  <label>Note</label>
                  <textarea placeholder="Optional note about this part / batch" disabled={newLocked} value={newForm.note} onChange={(e) => setNewForm((f) => ({ ...f, note: e.target.value }))} />
                  <div className="field-error">{newErrors.note}</div>
                </div>
              </div>
              <div className="entry-actions">
                {!newLocked && (
                  <button type="submit" className="btn-submit-entry">
                    ✔ Save
                  </button>
                )}
                {newLocked && canEditQueue && (
                  <button type="button" className="btn-edit-entry" onClick={() => setNewLocked(false)}>
                    ✎ Edit
                  </button>
                )}
                <span className={`entry-status${newStatus ? " success" : ""}`}>{newStatus}</span>
              </div>
            </form>
          )}

          {entryMode === "rework" && (
            <form onSubmit={onSubmitRework}>
              <div className="entry-session-hint">{HINT_TEXT}</div>
              <div className="entry-form-grid">
                <div className="form-group">
                  <label>
                    ALPL <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ต้องเคยลงทะเบียนผ่าน New มาแล้ว"
                    disabled={reworkLocked}
                    value={reworkForm.numberAlpl}
                    onChange={(e) => setReworkForm((f) => ({ ...f, numberAlpl: e.target.value }))}
                    onBlur={(e) => updateReworkPrefill(e.target.value)}
                  />
                  <div className="field-error">{reworkErrors.number_alpl}</div>
                </div>
                <div className="form-group">
                  <label>
                    Operator <span className="req">*</span>
                  </label>
                  <select disabled={reworkLocked} value={reworkForm.operator} onChange={(e) => setReworkForm((f) => ({ ...f, operator: e.target.value }))}>
                    <option value="">-- เลือก Operator --</option>
                    {operatorOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{reworkErrors.operator}</div>
                </div>
                <div className="form-group">
                  <label>
                    Part Number <span className="req">*</span>
                  </label>
                  <input type="text" disabled={reworkLocked} value={reworkForm.partNumber} onChange={(e) => setReworkForm((f) => ({ ...f, partNumber: e.target.value }))} />
                  <div className="field-error">{reworkErrors.part_number}</div>
                </div>
                <div className="form-group">
                  <label>
                    Handler <span className="req">*</span>
                  </label>
                  <select disabled={reworkLocked} value={reworkForm.handler} onChange={(e) => setReworkForm((f) => ({ ...f, handler: e.target.value }))}>
                    <option value="">-- เลือก Handler --</option>
                    {handlerOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{reworkErrors.handler}</div>
                </div>
                <div className="form-group">
                  <label>
                    Vendor <span className="req">*</span>
                  </label>
                  <select disabled={reworkLocked} value={reworkForm.vendor} onChange={(e) => setReworkForm((f) => ({ ...f, vendor: e.target.value }))}>
                    <option value="">-- เลือก Vendor --</option>
                    {vendorOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{reworkErrors.vendor}</div>
                </div>
                <div className="form-group span-2">
                  <label>
                    Description <span className="req">*</span>
                  </label>
                  <input type="text" disabled={reworkLocked} value={reworkForm.description} onChange={(e) => setReworkForm((f) => ({ ...f, description: e.target.value }))} />
                  <div className="field-error">{reworkErrors.description}</div>
                </div>
                <div className="form-group">
                  <label>
                    PO Number <span className="req">*</span>
                  </label>
                  <input type="text" inputMode="numeric" placeholder="ตัวเลขเท่านั้น" disabled={reworkLocked} value={reworkForm.poNumber} onChange={(e) => setReworkForm((f) => ({ ...f, poNumber: e.target.value }))} />
                  <div className="field-error">{reworkErrors.po_number}</div>
                </div>
                <div className="form-group">
                  <label>
                    Package Size <span className="req">*</span>
                  </label>
                  <input type="text" list="package-size-datalist" disabled={reworkLocked} value={reworkForm.packageSize} onChange={(e) => setReworkForm((f) => ({ ...f, packageSize: e.target.value }))} />
                  <div className="field-error">{reworkErrors.package_size}</div>
                </div>
                <div className="form-group">
                  <label>
                    Owner <span className="req">*</span>
                  </label>
                  <select disabled={reworkLocked} value={reworkForm.owner} onChange={(e) => setReworkForm((f) => ({ ...f, owner: e.target.value }))}>
                    <option value="">-- เลือก Owner --</option>
                    {ownerOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="field-error">{reworkErrors.owner}</div>
                </div>
                <div className="form-group">
                  <label>
                    Receive Date <span className="req">*</span>
                  </label>
                  <input type="date" disabled={reworkLocked} value={reworkForm.receiveDate} onChange={(e) => setReworkForm((f) => ({ ...f, receiveDate: e.target.value }))} />
                  <div className="field-error">{reworkErrors.receive_date}</div>
                </div>
              </div>
              <div className="entry-actions">
                {!reworkLocked && (
                  <button type="submit" className="btn-submit-entry">
                    ✔ Save
                  </button>
                )}
                {reworkLocked && canEditQueue && (
                  <button type="button" className="btn-edit-entry" onClick={() => setReworkLocked(false)}>
                    ✎ Edit
                  </button>
                )}
                <span className={`entry-status${reworkStatus ? " success" : ""}`}>{reworkStatus}</span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
