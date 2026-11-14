import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast as notify } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export function toastHost(root) {
  return (
    Array.from(
      root.querySelectorAll('[data-slot="dialog-content"][data-state="open"]'),
    ).at(-1) || root.body
  );
}

export function ToastNotice({ toast, onDismiss }) {
  const [host, setHost] = useState(() => toastHost(document));
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
  return createPortal(
    <Toaster position="bottom-right" closeButton richColors theme="light" />,
    host,
  );
}
