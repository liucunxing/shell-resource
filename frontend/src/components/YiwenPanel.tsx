import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, OverlayDrawer, Spinner } from "@fluentui/react-components";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ChatsCircle,
  SidebarSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { parseYiwenUrl } from "../config/yiwen";

const config = parseYiwenUrl(import.meta.env.VITE_YIWEN_IFRAME_URL);
const dockedQuery = "(min-width: 768px)";

export function YiwenPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [docked, setDocked] = useState(
    () => window.matchMedia(dockedQuery).matches,
  );
  const [hasOpened, setHasOpened] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open, docked]);

  useEffect(() => {
    const media = window.matchMedia(dockedQuery);
    const update = () => setDocked(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  const shouldLoad = !!config.url && (open || hasOpened);
  useEffect(() => {
    if (!shouldLoad || !loading) return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [shouldLoad, loading, revision]);

  const reload = () => {
    setLoading(true);
    setSlow(false);
    setRevision((value) => value + 1);
  };

  return (
    <OverlayDrawer
      id="yiwen-panel"
      className={`yiwen-panel ${docked ? "is-docked" : ""}`}
      open={open}
      position="end"
      size="full"
      modalType={docked || !open ? "non-modal" : "modal"}
      unmountOnClose={false}
      data-open={open}
      aria-labelledby="yiwen-title"
      onOpenChange={(_, data) => {
        // On a wide screen the budget workspace remains interactive.
        if (!data.open && !(docked && data.type === "backdropClick")) onClose();
      }}
    >
      <header className="yiwen-header">
        <div className="yiwen-heading">
          <ChatsCircle size={23} />
          <h2 id="yiwen-title">小One问数Agent</h2>
          {!config.url && <span className="yiwen-phase">二期预留</span>}
        </div>
        <Button
          ref={closeButton}
          appearance="subtle"
          icon={<SidebarSimple size={21} />}
          aria-label="收起小One问数Agent"
          title="收起面板"
          onClick={onClose}
        />
      </header>

      {config.url ? (
        <>
          <div className="yiwen-toolbar">
            <span>问数工作区</span>
            <div>
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowClockwise size={16} />}
                onClick={reload}
              >
                重新加载
              </Button>
              <a href={config.url} target="_blank" rel="noopener noreferrer">
                独立打开 <ArrowSquareOut size={15} />
              </a>
            </div>
          </div>
          <div className="yiwen-frame-area">
            {shouldLoad && (
              <iframe
                key={revision}
                src={config.url}
                title="易问产品问数界面"
                className="yiwen-frame"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={() => {
                  setLoading(false);
                  setSlow(false);
                }}
                onError={() => {
                  setLoading(false);
                  setSlow(true);
                }}
              />
            )}
            {loading && !slow && (
              <div className="yiwen-loading" role="status">
                <Spinner size="small" label="正在加载问数界面…" />
              </div>
            )}
          </div>
          <p className="yiwen-frame-help" role={slow ? "status" : undefined}>
            {slow
              ? "页面响应较慢，可重新加载或独立打开。"
              : "如页面空白或无法登录，可尝试独立打开。"}
          </p>
        </>
      ) : (
        <div className="yiwen-placeholder">
          <div className="yiwen-placeholder-intro">
            <div className="yiwen-placeholder-icon">
              {config.error ? (
                <WarningCircle size={34} />
              ) : (
                <ChatsCircle size={34} />
              )}
            </div>
            <h3>{config.error ? "问数暂时无法打开" : "小One将在二期接入"}</h3>
            <p>
              {config.error
                ? "接入地址配置有误，请联系管理员检查。"
                : "二期将在此接入易问，支持在规划工作台内查看问数界面。"}
            </p>
          </div>
          <div className="yiwen-placeholder-note">
            <span className="yiwen-status-dot" />
            <div>
              <b>{config.error ? "等待更新配置" : "问数服务待接入"}</b>
              <p>当前可继续使用预算规划与追踪功能。</p>
            </div>
          </div>
        </div>
      )}
      {!config.url && (
        <footer className="yiwen-footer">
          <span>资源投资工作台 × 小One</span>
          <span>二期功能</span>
        </footer>
      )}
    </OverlayDrawer>
  );
}
