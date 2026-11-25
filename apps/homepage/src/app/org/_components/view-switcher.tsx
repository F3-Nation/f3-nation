import type { DirectoryView } from "../_lib/url-state";

const VIEWS: { value: DirectoryView; label: string }[] = [
  { value: "map", label: "Map" },
  { value: "table", label: "Table" },
];

interface ViewSwitcherProps {
  view: DirectoryView;
  onChange: (view: DirectoryView) => void;
}

/** Map / Table toggle shown in each view's header. */
export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Directory view"
      className="flex shrink-0 rounded-sm border border-[#2c3648] bg-[#151a24] p-0.5"
    >
      {VIEWS.map((option) => {
        const active = option.value === view;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => !active && onChange(option.value)}
            className={`rounded-sm px-3 py-1 text-xs font-medium tracking-wide uppercase transition-colors ${
              active
                ? "bg-[#f6f3ea] text-[#0b0d12]"
                : "text-[#f8f4ea] hover:bg-[#233046]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
