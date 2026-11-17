import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const DealerDetailAccess = createContext(false);
export function DealerDetailAccessProvider({ role, children }: { role?: string; children: ReactNode }) {
  return <DealerDetailAccess.Provider value={role === "lead" || role === "management" || role === "admin"}>{children}</DealerDetailAccess.Provider>;
}
export const useDealerDetailAccess = () => useContext(DealerDetailAccess);
export function DealerDetailButton({ children, className, title, ...props }: ComponentProps<typeof Button>) {
  const allowed = useDealerDetailAccess();
  return allowed ? <Button {...props} className={className} title={title}>{children}</Button>
    : <span className={className || "font-bold"} title={title}>{children}</span>;
}
