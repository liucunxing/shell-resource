import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function WorkflowDialog({
  title,
  children,
  busy,
  onClose,
  onConfirm,
  confirmLabel = "确认",
  disabled = false,
  wide = false,
}) {
  const previous = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        size={wide ? "wide" : "default"}
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle>{title}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            ×
          </Button>
        </DialogHeader>
        <DialogBody className="grid gap-4">{children}</DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {onConfirm ? "取消" : "关闭"}
          </Button>
          {onConfirm && (
            <Button disabled={busy || disabled} onClick={onConfirm}>
              {busy ? "处理中…" : confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
