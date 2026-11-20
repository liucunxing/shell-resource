import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import engine from "./domain/engine.js";
import "./user-profile.css";

type ProfileIdentity = {
  userId?: string | number | null;
  email?: string;
  label?: string;
  name?: string;
  role: string;
  roles?: string[];
  department?: string | string[];
  sectors?: string[];
  affiliation_sector?: string | null;
  affiliation_department?: string | null;
  adminContacts?: { name: string; email: string }[];
};

const roleNames: Record<string, string> = {
  owner: "Initiative Owner",
  lead: "部门负责人",
  management: "最高管理层",
  admin: "系统管理员",
};

export function profileFields(identity: ProfileIdentity) {
  const departments: string[] = engine.departments(identity.department);
  const homeDepartment = identity.affiliation_department?.trim();
  const homeSector = identity.affiliation_sector?.trim();
  const departmentLabel = homeDepartment
    ? [homeSector, homeDepartment].filter(Boolean).join(" / ")
    : departments.join("、");
  const assigned = identity.roles?.length ? identity.roles : [identity.role];
  const scope = assigned.map((role) => {
    if (role === "owner") return "本人负责的 Initiative";
    if (role === "admin") return "系统配置";
    if (role === "management") return "全部 Sector / 部门";
    if (role === "lead")
      return departments.length && identity.sectors?.length
        ? identity.sectors
            .flatMap((sector) =>
              departments.map((department) => `${sector} / ${department}`),
            )
            .join("、")
        : "部门范围未配置";
    return "未配置";
  });
  return [
    ["姓名", identity.label || identity.name || "未配置"],
    ["登录账号", identity.email || "未配置"],
    ["当前身份", roleNames[identity.role] || identity.role],
    ["拥有角色", assigned.map((role) => roleNames[role] || role).join("、")],
    ["授权范围", scope.join("、")],
    ["所属部门", departmentLabel || "-"],
  ];
}

export function UserProfileDetails({
  identity,
}: {
  identity: ProfileIdentity;
}) {
  return (
    <>
      <dl className="user-profile-details">
        {profileFields(identity).map(([label, value]) => (
          <div key={label} className={label === "所属部门" && value === "-" ? "user-profile-empty-department" : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="user-profile-contact">
        如需帮助，请联系管理员：
        {identity.adminContacts?.length
          ? identity.adminContacts
              .map(
                (contact) =>
                  `${contact.name}${contact.email ? `（${contact.email}）` : "（邮箱未配置）"}`,
              )
              .join("、")
          : "管理员联系方式尚未配置"}
      </div>
    </>
  );
}

export function UserProfileButton({ identity }: { identity: ProfileIdentity }) {
  const name =
    identity.label ||
    identity.name ||
    identity.email ||
    roleNames[identity.role];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="user-profile-trigger"
          aria-label={`${name}，${roleNames[identity.role] || identity.role}，查看个人信息`}
        >
          <span className="v19-avatar" aria-hidden="true">
            {name?.slice(0, 1).toUpperCase()}
          </span>
          <span className="user-profile-label">
            <b>{name}</b>
            <small>{roleNames[identity.role] || identity.role}</small>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent
        size="form"
        className="user-profile-dialog"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>我的用户信息</DialogTitle>
        </DialogHeader>
        <DialogBody><UserProfileDetails identity={identity} /></DialogBody>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
