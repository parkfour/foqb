// Shown on every page of a public demo instance (DEMO_MODE=1).
export function DemoBanner() {
  if (process.env.DEMO_MODE !== "1") return null;

  return (
    <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      This is a demo. Everything here is erased every 6 hours, and bank connections use Plaid&rsquo;s
      test banks only. Don&rsquo;t enter real information.
    </div>
  );
}
