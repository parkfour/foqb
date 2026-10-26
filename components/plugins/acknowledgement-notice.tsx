import type { ReactNode } from "react";
import type { PluginAcknowledgement } from "@/lib/plugins/types";

// A plugin's disclaimer, in full, with who has acknowledged it. `action`
// is the acknowledge form, when the viewer may and still needs to.
export function AcknowledgementNotice({
  acknowledgement,
  site,
  book,
  action,
}: {
  acknowledgement: PluginAcknowledgement;
  site: { at: string } | null;
  book?: { at: string } | null;
  action?: ReactNode;
}) {
  return (
    <div role="note" className="flex flex-col gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
      <p className="text-base font-bold uppercase tracking-wide">{acknowledgement.title}</p>
      {acknowledgement.text.map((paragraph, i) => (
        <p key={i} className="text-sm leading-relaxed">
          {paragraph}
        </p>
      ))}
      <ul className="text-xs text-amber-900">
        <li>
          This instance: {site ? `acknowledged by a Site Admin on ${site.at.slice(0, 10)}` : "not yet acknowledged by a Site Admin"}
        </li>
        {book !== undefined && <li>This book: {book ? `acknowledged by an owner on ${book.at.slice(0, 10)}` : "not yet acknowledged by an owner"}</li>}
        <li>Disclaimer version {acknowledgement.version}. The plugin does nothing until both have acknowledged it.</li>
      </ul>
      {action}
    </div>
  );
}

export function AcknowledgeForm({
  action,
  hidden,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  label: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4" />
        {label}
      </label>
      <button
        type="submit"
        className="self-start rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
      >
        Acknowledge
      </button>
    </form>
  );
}
