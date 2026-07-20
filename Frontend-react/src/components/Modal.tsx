import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}

// Modal: popup กลางที่ EditPage (Add/Edit Part, Add/Edit Measurement) และ
// DashboardPage (Part Entry, Report) เรียกใช้ร่วมกัน — เดิม index.html/edit.html
// ต่างคน copy markup ของ overlay+box เอง คนละชุด
export default function Modal({ title, onClose, children, maxWidth = 640 }: ModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="card-title" style={{ marginBottom: 0 }}>
            {title}
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
