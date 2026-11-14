import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./components/ui/button";
import { TooltipProvider } from "./components/ui/tooltip";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { WorkbenchProvider } from "./workbench/WorkbenchContext.jsx";
import { PortalEntry } from "./portal/PortalEntry";
import { isPortalEntry } from "./portal/session";
import "./shadcn.css";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Frontend render error", error, info);
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>页面暂时无法显示</h1>
        <p>已保存的数据保留，请刷新后重试。</p>
        <Button onClick={() => location.reload()}>重新加载</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <IconContext.Provider value={{ weight: "regular", size: 18 }}>
      <ErrorBoundary>
        {isPortalEntry() ? (
          <PortalEntry>
            <WorkbenchProvider>
              <App />
            </WorkbenchProvider>
          </PortalEntry>
        ) : (
          <WorkbenchProvider>
            <App />
          </WorkbenchProvider>
        )}
      </ErrorBoundary>
    </IconContext.Provider>
  </TooltipProvider>,
);
