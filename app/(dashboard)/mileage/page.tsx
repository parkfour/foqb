import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { TripForm } from "@/components/mileage/trip-form";
import { BookTripsForm } from "@/components/mileage/book-trips-form";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getUseAccountCodes } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { formatMoney } from "@/lib/money";
import { getBookCurrency } from "@/lib/org/book-currency";
import { mileageAmount } from "@/lib/mileage/rates";
import { deleteTrip } from "./actions";

interface TripRow {
  id: string;
  trip_date: string;
  miles: number;
  rate: number;
  purpose: string;
  start_place: string | null;
  end_place: string | null;
  vehicle: string | null;
  journal_entry_id: string | null;
  journal_entries: { status: string } | null;
}

export default async function MileagePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const orgId = await getCurrentOrgId();
  const description = "Business trips at the IRS standard rate, for Schedule C or a reimbursement.";
  if (!orgId) {
    return (
      <div>
        <PageHeader title="Mileage" description={description} />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const today = await bookToday(orgId);
  const year = Number((await searchParams).year) || Number(today.slice(0, 4));
  const supabase = await createClient();
  const [{ data }, { data: accounts }, role, currency, showAccountCodes] = await Promise.all([
    supabase
      .from("mileage_trips")
      .select("id, trip_date, miles, rate, purpose, start_place, end_place, vehicle, journal_entry_id, journal_entries(status)")
      .eq("organization_id", orgId)
      .gte("trip_date", `${year}-01-01`)
      .lte("trip_date", `${year}-12-31`)
      .order("trip_date", { ascending: false }),
    supabase
      .from("accounts")
      .select("id, account_number, name, type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("currency", null)
      .in("type", ["expense", "liability", "equity"])
      .order("account_number"),
    getCurrentUserRole(orgId),
    getBookCurrency(orgId),
    getUseAccountCodes(orgId),
  ]);
  const trips = (data as unknown as TripRow[] | null) ?? [];
  const formatCurrency = (value: number) => formatMoney(value, currency);
  const userCanWrite = canWrite(role);
  const isBooked = (t: TripRow) => t.journal_entries?.status === "posted";
  const miles = trips.reduce((s, t) => s + Number(t.miles), 0);
  const amount = trips.reduce((s, t) => s + mileageAmount(Number(t.miles), Number(t.rate)), 0);
  const unbooked = trips.filter((t) => !isBooked(t));
  const all = (accounts ?? []) as { id: string; account_number: string; name: string; type: string }[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Mileage" description={description} />
        <div className="flex gap-3 text-sm">
          <Link href={`/mileage?year=${year - 1}`} className="underline hover:text-slate-900">
            ← {year - 1}
          </Link>
          <span className="font-medium">{year}</span>
          <Link href={`/mileage?year=${year + 1}`} className="underline hover:text-slate-900">
            {year + 1} →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Business miles</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{miles.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">At the standard rate</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(amount)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Not yet booked</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {formatCurrency(unbooked.reduce((s, t) => s + mileageAmount(Number(t.miles), Number(t.rate)), 0))}
          </p>
        </div>
      </div>

      {userCanWrite && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Log a trip</h2>
          <TripForm />
        </div>
      )}

      {userCanWrite && unbooked.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Book {year}&apos;s unbooked trips</h2>
          <p className="mb-3 text-xs text-slate-500">
            One entry for {unbooked.length} trip{unbooked.length === 1 ? "" : "s"}. Ask your tax professional whether
            the standard rate or actual costs suit you; you can&apos;t book both for the same vehicle.
          </p>
          <BookTripsForm
            year={year}
            expenseAccounts={all.filter((a) => a.type === "expense")}
            creditAccounts={all.filter((a) => a.type !== "expense")}
            showAccountCodes={showAccountCodes}
          />
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Purpose</th>
                <th className="px-5 py-3 font-medium">Route</th>
                <th className="px-5 py-3 font-medium text-right">Miles</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No trips in {year}.
                  </td>
                </tr>
              ) : (
                trips.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{t.trip_date}</td>
                    <td className="px-5 py-3 text-slate-900">
                      {t.purpose}
                      {t.vehicle && <span className="text-slate-500"> ({t.vehicle})</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {[t.start_place, t.end_place].filter(Boolean).join(" → ") || "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-900">{Number(t.miles)}</td>
                    <td className="px-5 py-3 text-right text-slate-900">
                      {formatCurrency(mileageAmount(Number(t.miles), Number(t.rate)))}
                      <span className="block text-xs text-slate-500">at ${Number(t.rate)}/mi</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isBooked(t) ? (
                        <Link href={`/journal/${t.journal_entry_id}`} className="text-sm text-slate-500 underline">
                          Booked
                        </Link>
                      ) : (
                        userCanWrite && (
                          <form action={deleteTrip}>
                            <input type="hidden" name="id" value={t.id} />
                            <button type="submit" className="text-sm text-slate-400 hover:text-red-600">
                              Delete
                            </button>
                          </form>
                        )
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
