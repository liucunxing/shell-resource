import { Skeleton } from "@/components/ui/skeleton";
import "./workbench-loading.css";

export function WorkbenchWordmark() {
  return (
    <div className="v19-wordmark">
      <span className="v19-brand-icon"><img src="/resource-studio-icon.svg" alt="" /></span>
      <strong>Resource Studio</strong>
    </div>
  );
}

export function WorkbenchContentSkeleton({ label = "正在加载工作台数据…" }: { label?: string }) {
  return (
    <section role="status" className="workbench-loading">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <Skeleton className="loading-heading" />
        <div className="loading-summary">
          {[0, 1, 2, 3].map(index => (
            <div className="loading-card" key={index}>
              <Skeleton className="loading-label" />
              <Skeleton className="loading-value" />
            </div>
          ))}
        </div>
        <div className="loading-list">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="loading-row" key={index}>
              <Skeleton /><Skeleton /><Skeleton /><Skeleton />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WorkbenchLoadingShell({ label }: { label?: string }) {
  return (
    <div className="app-shell studio-shell v19-shell v19-fidelity-shell">
      <div className="workspace">
        <header className="v19-appnav">
          <WorkbenchWordmark />
        </header>
        <main className="page"><WorkbenchContentSkeleton label={label} /></main>
      </div>
    </div>
  );
}
