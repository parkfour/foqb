import { setReconcileNag } from "@/app/(dashboard)/settings/actions";

export function ReconcileNagSetting({ nagOff }: { nagOff: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Reminders</h2>
      <p className="mb-3 text-xs text-slate-500">
        Accounts whose last reconciled statement is older than the book&rsquo;s reminder age (Organization
        Settings) are tinted on Bank Balances and the chart of accounts. This is your own setting and applies
        to every book you use.
      </p>
      <form action={setReconcileNag} className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="nagOff" defaultChecked={nagOff} />
          Stop nagging me about reconciliations
        </label>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Save
        </button>
      </form>
    </div>
  );
}
