import { Buildings, ChartDonut, ClipboardText, GearSix, List, PencilLine, ShieldCheck, SlidersHorizontal, SquaresFour, Stack, UserList } from "@phosphor-icons/react";

export function navigationFor(identity, hasOwnInitiatives) {
  const ownerNavigation = [
      ["home", SquaresFour, "我的 Initiative", "负责项目与拆分进度"],
      [
        "editor",
        PencilLine,
        "拆分工作台",
        "进入最近更新的草稿",
      ],
      ["portfolio", ChartDonut, "我的投入组合", "本人全部 Initiative 叠加分析"],
      ["submissions", ClipboardText, "草稿与提交", "批量校验与提交"],
    ];
  if (identity.role === "owner") return ownerNavigation;
  if (identity.role === "lead")
    return [
      ["department", Buildings, "部门投入组合", "本部门已提交方案"],
      ["department-review", ShieldCheck, "部门方案提交", "提交管理层与撤回修改"],
      ...(hasOwnInitiatives ? ownerNavigation : []),
    ];
  if (identity.role === "management")
    return [["management", Stack, "全局投资看板", "部门已确认方案"]];
  return [
    ["admin-versions", GearSix, "版本与发布", ""],
    ["department-review", ShieldCheck, "部门方案与驳回", "一键开放全部部门修改"],
    ["admin-initiatives", ClipboardText, "项目配置", ""],
    ["admin-users", UserList, "用户与权限", ""],
    ["admin-enums", SlidersHorizontal, "组织与枚举", ""],
    ["admin-thresholds", ShieldCheck, "健康检查阈值", ""],
    ["admin-audit", List, "操作审计", ""],
  ];
}
