import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";

export function toastHost(root) {
  return Array.from(root.querySelectorAll("dialog[open]")).at(-1) || root.body;
}

export function ToastNotice({ toast, onDismiss }) {
  const [host, setHost] = useState(() => toastHost(document));
  useLayoutEffect(() => {
    const update = () => setHost(toastHost(document));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <div
      id="toast"
      className={`visible ${toast.error ? "error" : ""}`}
      role={toast.error ? "alert" : "status"}
    >
      <span>{toast.message}</span>
      <button className="icon-button" aria-label="关闭提示" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>,
    host,
  );
}
