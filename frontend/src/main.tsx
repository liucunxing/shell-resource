import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { WorkspaceProvider } from "./state/WorkspaceContext";
import "./styles.css";

const theme = {
  ...webLightTheme,
  fontFamilyBase: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  colorBrandBackground: "#cf292e",
  colorBrandBackgroundHover: "#b62025",
  colorBrandBackgroundPressed: "#981c21",
  colorBrandForeground1: "#bd262b",
  colorBrandForeground2: "#a51f24",
  colorBrandStroke1: "#cf292e",
  colorBrandBackground2: "#fff0f0",
  colorCompoundBrandBackground: "#cf292e",
  colorCompoundBrandBackgroundHover: "#b62025",
  colorCompoundBrandBackgroundPressed: "#981c21",
  colorCompoundBrandStroke: "#cf292e",
  colorCompoundBrandStrokeHover: "#b62025",
  colorCompoundBrandStrokePressed: "#981c21",
  colorCompoundBrandForeground1: "#bd262b",
  colorCompoundBrandForeground1Hover: "#b62025",
  colorCompoundBrandForeground1Pressed: "#981c21",
  borderRadiusMedium: "6px",
  borderRadiusSmall: "4px",
};
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
        <p>已保存的本机数据保留，请刷新后重试。</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={theme}>
    <IconContext.Provider value={{ weight: "regular", size: 18 }}>
      <ErrorBoundary>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </ErrorBoundary>
    </IconContext.Provider>
  </FluentProvider>,
);
