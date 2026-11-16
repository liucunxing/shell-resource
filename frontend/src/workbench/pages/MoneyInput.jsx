import { useRef, useLayoutEffect } from "react";
import { Input } from "../../components/ui/input";

export function formatMoneyInput(value) {
  const raw = String(value ?? "").replaceAll(",", "");
  const match = raw.match(/^(\d*)(\.\d*)?$/);
  return match ? match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (match[2] || "") : raw;
}

export function MoneyInput({ value, onValueChange, inputRef, ...props }) {
  const input = useRef(null);
  const cursor = useRef(null);
  useLayoutEffect(() => {
    if (cursor.current !== null && input.current === document.activeElement) {
      input.current.setSelectionRange(cursor.current, cursor.current);
      cursor.current = null;
    }
  });
  return <Input {...props} ref={(node) => { input.current = node; if (typeof inputRef === "function") inputRef(node); }}
    type="text" inputMode="decimal" value={formatMoneyInput(value)}
    onChange={(event) => {
      const displayed = event.target.value;
      const position = event.target.selectionStart ?? displayed.length;
      const raw = displayed.replaceAll(",", "");
      cursor.current = formatMoneyInput(displayed.slice(0, position)).length;
      onValueChange(raw);
    }} />;
}
