import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast as notify } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import "./toast-notice.css";

export function toastHost(root) {
  return (
    Array.from(
      root.querySelectorAll('[data-slot="dialog-content"][data-state="open"]'),
    ).at(-1) || root.body
  );
}

export function ToastNotice({ toast, onDismiss }) {
  const [host, setHost] = useState(() => toastHost(document));
  const layer = useRef(null);
  useLayoutEffect(() => {
    // Escape the dialog's transformed, clipped box while retaining its focus scope.
    const currentHost = toastHost(document);
    if (host !== currentHost) {
      setHost(currentHost);
      return;
    }
    if (layer.current?.isConnected) layer.current.showPopover?.();
  }, [host]);
  useLayoutEffect(() => {
    const update = () => setHost(toastHost(document));
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const options = { id: toast.id, duration: Infinity, onDismiss };
    if (toast.error) notify.error(toast.message, options);
    else notify.success(toast.message, options);
    return () => {
      notify.dismiss(toast.id);
    };
  }, [toast.id, toast.message, toast.error]);
  const toaster = <Toaster className="resource-toaster" position="top-right" closeButton richColors theme="light" />;
  return createPortal(host === document.body ? toaster : (
    <div ref={layer} popover="manual" className="resource-toast-layer">{toaster}</div>
  ), host);
}
