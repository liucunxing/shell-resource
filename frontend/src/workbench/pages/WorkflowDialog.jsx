import { useEffect, useRef } from "react";

export function WorkflowDialog({ title, children, busy, onClose, onConfirm, confirmLabel = "确认", disabled = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="modal v19-dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="button" disabled={busy} onClick={onClose} aria-label="关闭弹窗">×</button></div>
    <div className="modal-body">{children}</div>
    <div className="modal-foot"><button className="button" disabled={busy} onClick={onClose}>{onConfirm ? "取消" : "关闭"}</button>
      {onConfirm && <button className="button primary" disabled={busy || disabled} onClick={onConfirm}>{busy ? "处理中…" : confirmLabel}</button>}</div>
  </dialog>;
}
