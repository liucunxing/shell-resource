import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import E from "../domain/engine.js";

function eligible(user, item) {
  return (
    user.enabled !== false &&
    ["owner", "lead"].includes(user.role) &&
    E.hasDepartment(user, item.department) &&
    user.sector?.includes(item.sector)
  );
}

export function UserInitiativePicker({
  user,
  form,
  version,
  items,
  owned,
  users,
  transfers,
  onChange,
}) {
  const [search, setSearch] = useState("");
  const details = useRef(null);
  const options = items.filter(
    (item) =>
      owned.has(item.id) ||
      eligible(form, item) ||
      Object.hasOwn(transfers, item.id),
  );
  const selected = (item) =>
    Object.hasOwn(transfers, item.id)
      ? transfers[item.id] === true
      : owned.has(item.id);
  const chosen = options.filter(selected);
  const released = options.filter(
    (item) => owned.has(item.id) && !selected(item),
  );
  const ownerNames = new Map(
    users.map((person) => [
      person.email?.toLowerCase(),
      person.label || person.email,
    ]),
  );
  const filtered = options.filter((item) =>
    [
      item.name,
      item.sector,
      item.department,
      item.ownerId,
      ownerNames.get(item.ownerId?.toLowerCase()),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  function toggle(item, checked) {
    const next = { ...transfers };
    if (owned.has(item.id) === checked) delete next[item.id];
    else next[item.id] = checked ? true : "";
    onChange(next);
  }

  return (
    <div className="user-editor-projects">
      <div className="user-editor-project-heading">
        <strong>负责 Initiative</strong>
        <small>规划版本 {version.id}</small>
      </div>
      <details
        ref={details}
        onToggle={(event) => {
          if (!event.currentTarget.open) setSearch("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current.open) {
            event.preventDefault();
            event.stopPropagation();
            details.current.open = false;
            details.current.querySelector("summary").focus();
          }
        }}
      >
        <summary aria-label="选择负责 Initiative">
          <span>
            {chosen.length
              ? `已选 ${chosen.length} 项 · ${chosen.map((item) => item.name).join("、")}`
              : "选择负责的 Initiative"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="user-editor-options">
          <Input
            aria-label="搜索 Initiative"
            placeholder="搜索项目、业务线或负责人"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="user-editor-option-list">
            {filtered.map((item) => (
              <Label key={item.id} className="user-editor-option">
                <Checkbox
                  aria-label={item.name}
                  checked={selected(item)}
                  onCheckedChange={(value) => toggle(item, value === true)}
                />
                <span>
                  {item.name}
                  <small>
                    {item.sector} / {item.department} ·{" "}
                    {ownerNames.get(item.ownerId?.toLowerCase()) ||
                      item.ownerId ||
                      "待分配"}
                    {item.enabled === false ? " · 项目已停用" : ""}
                  </small>
                </span>
              </Label>
            ))}
            {!filtered.length && (
              <small>
                {search ? "没有匹配的项目" : "当前授权范围内没有项目"}
              </small>
            )}
          </div>
        </div>
      </details>
      {released.map((item) => (
        <Label key={item.id} className="form-field user-editor-transfer">
          {item.name} · 接任负责人
          <NativeSelect
            value={transfers[item.id]}
            onChange={(event) =>
              onChange({ ...transfers, [item.id]: event.target.value })
            }
          >
            <NativeSelectOption value="">选择接任负责人</NativeSelectOption>
            {users
              .filter(
                (person) =>
                  person.email?.toLowerCase() !== user.email.toLowerCase() &&
                  eligible(person, item),
              )
              .map((person) => (
                <NativeSelectOption key={person.email} value={person.email}>
                  {person.label}（{person.email}）
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </Label>
      ))}
      {Object.keys(transfers).length > 0 && (
        <small>保存后，改派项目须由新负责人重新提交，所属部门重新确认。</small>
      )}
    </div>
  );
}
