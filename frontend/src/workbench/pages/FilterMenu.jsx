import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import "./filter-menu.css";

export function FilterMenu({ label, options, selected = [], onChange, searchable }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const allLabel = searchable ? `全部 ${label}` : `全部${label}`;
  const search = query.trim().toLowerCase();
  const matches = search
    ? options.filter((option) => [option.label, option.scope, option.value].some(
        (text) => text?.toLowerCase().includes(search),
      ))
    : options;
  return (
    <Popover onOpenChange={(open) => { if (!open) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="v19-filter-trigger"
          aria-label={selected.length ? `${label}，已选 ${selected.length} 项` : allLabel}
        >
          {selected.length ? `${label} · ${selected.length} 项` : allLabel}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="v19-filter-popover" aria-label={`${label}筛选`}>
        {searchable && (
          <Input
            type="search"
            aria-label={`搜索 ${label}`}
            placeholder={`搜索 ${label}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={!selected.length}
          onClick={() => onChange([])}
        >
          恢复全部
        </Button>
        <div className="v19-filter-options">
          {matches.length ? matches.map(({ value, label: name, scope }, index) => {
            const optionId = `${id}-${index}`;
            return (
              <div className="v19-filter-option" key={value}>
                <Checkbox
                  id={optionId}
                  checked={selected.includes(value)}
                  onCheckedChange={(checked) => onChange(checked
                    ? [...selected, value]
                    : selected.filter((entry) => entry !== value))}
                />
                <Label htmlFor={optionId}>
                  <span>{name}</span>
                  {scope && <small>{scope}</small>}
                </Label>
              </div>
            );
          }) : <p className="empty">没有匹配的选项</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

