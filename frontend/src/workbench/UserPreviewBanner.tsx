type PreviewIdentity = { email?: string; label?: string; role?: string };

export function UserPreviewBanner({ identity, actor, busy, onExit }: {
  identity: PreviewIdentity | null;
  actor: PreviewIdentity | null;
  busy: boolean;
  onExit: () => void;
}) {
  const role = { owner: "Owner", lead: "部门负责人", management: "管理层", admin: "管理员" }[
    identity?.role as "owner" | "lead" | "management" | "admin"
  ];
  return <section className="user-preview-banner" aria-label="当前模拟用户视角">
    <div>
      <strong>模拟查看 · {identity?.label || identity?.email || "正在加载用户视角"}</strong>
      <p>{identity?.email}{role && ` · ${role}`} · 只读模式</p>
      <small>管理员：{actor?.label || actor?.email}。保存、同步、导入、生成分析和问数暂不可用。</small>
    </div>
    <button type="button" className="button small" disabled={busy} onClick={onExit}>
      返回管理员
    </button>
  </section>;
}
