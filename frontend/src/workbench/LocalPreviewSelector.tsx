import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { LocalPreviewConfig } from "./localPreview";

export function LocalPreviewSelector({
  config,
  email,
  onChange,
  disabled,
  compact = false,
}: {
  config: LocalPreviewConfig;
  email: string;
  onChange: (email: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {!compact && (
        <Badge
          variant="secondary"
          className="whitespace-nowrap max-[759px]:hidden"
        >
          本地测试 · {config.dataLabel || "合成数据"}
        </Badge>
      )}
      <NativeSelect
        aria-label="本地测试角色（合成数据）"
        title={`本地测试 · ${config.dataLabel || "合成数据"}`}
        value={email}
        disabled={disabled}
        className="h-8 w-40 max-[759px]:w-32 text-xs"
        onChange={(event) => onChange(event.target.value)}
      >
        {config.users.map((user) => (
          <NativeSelectOption key={user.email} value={user.email}>
            {user.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
