import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { WorkbenchProvider } from "./workbench/WorkbenchContext.jsx";
import "./styles.css";

const theme = {
  ...webLightTheme,
  fontFamilyBase: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  colorBrandBackground: "#da291c",
  colorBrandBackgroundHover: "#b82218",
  colorBrandBackgroundPressed: "#981c21",
  colorBrandForeground1: "#b82218",
  colorBrandForeground2: "#a51f24",
  colorBrandStroke1: "#da291c",
  colorBrandBackground2: "#fff7d1",
  colorCompoundBrandBackground: "#da291c",
  colorCompoundBrandBackgroundHover: "#b82218",
  colorCompoundBrandBackgroundPressed: "#981c21",
  colorCompoundBrandStroke: "#da291c",
  colorCompoundBrandStrokeHover: "#b82218",
  colorCompoundBrandStrokePressed: "#981c21",
  colorCompoundBrandForeground1: "#b82218",
  colorCompoundBrandForeground1Hover: "#b82218",
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
        <WorkbenchProvider>
          <App />
        </WorkbenchProvider>
      </ErrorBoundary>
    </IconContext.Provider>
  </FluentProvider>,
);
