"use client";

export interface ClassOption {
  id: string;
  name: string;
}

// A class (migration 089) for a line or a document; shows nothing when the
// book has none.
export function ClassSelect({
  classes,
  value,
  onChange,
  className = "rounded-md border border-slate-300 px-3 py-2 text-sm",
}: {
  classes: ClassOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  if (classes.length === 0) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Class" className={className}>
      <option value="">No class</option>
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
