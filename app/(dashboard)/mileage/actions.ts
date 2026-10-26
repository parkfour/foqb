"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { mileageAmount } from "@/lib/mileage/rates";

type State = { error: string | null };

export async function addTrip(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "No book selected" };
  const text = (name: string) => ((formData.get(name) as string) ?? "").trim() || null;
  const miles = Number(formData.get("miles"));
  const rate = Number(formData.get("rate"));
  const tripDate = text("tripDate");
  const purpose = text("purpose");
  if (!tripDate || !purpose || !(miles > 0) || !(rate >= 0)) {
    return { error: "Date, miles, rate and the business purpose are required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("mileage_trips").insert({
    organization_id: orgId,
    trip_date: tripDate,
    miles,
    rate,
    purpose,
    start_place: text("startPlace"),
    end_place: text("endPlace"),
    vehicle: text("vehicle"),
    created_by: user?.id ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/mileage");
  return { error: null };
}

export async function deleteTrip(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("mileage_trips").delete().eq("id", id);
  revalidatePath("/mileage");
}

interface UnbookedTrip {
  id: string;
  miles: number;
  rate: number;
  journal_entries: { status: string } | null;
}

// Books every trip in the year not already in a posted entry, as one entry
// dated the last of them: the expense debited, whoever paid (the owner,
// usually) credited.
export async function bookTrips(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  const year = Number(formData.get("year"));
  const expenseAccountId = formData.get("expenseAccountId") as string;
  const creditAccountId = formData.get("creditAccountId") as string;
  if (!orgId || !year) return { error: "No book selected" };
  if (!expenseAccountId || !creditAccountId) return { error: "Choose both accounts" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mileage_trips")
    .select("id, miles, rate, trip_date, journal_entries(status)")
    .eq("organization_id", orgId)
    .gte("trip_date", `${year}-01-01`)
    .lte("trip_date", `${year}-12-31`)
    .order("trip_date");
  if (error) return { error: error.message };
  const trips = ((data ?? []) as unknown as (UnbookedTrip & { trip_date: string })[]).filter(
    (t) => t.journal_entries?.status !== "posted",
  );
  if (trips.length === 0) return { error: "Every trip this year is already booked" };

  const total = trips.reduce((s, t) => s + mileageAmount(Number(t.miles), Number(t.rate)), 0);
  const amount = Math.round(total * 100) / 100;
  const miles = trips.reduce((s, t) => s + Number(t.miles), 0);
  const { data: entryId, error: postError } = await supabase.rpc("post_journal_entry", {
    p_org_id: orgId,
    p_entry_date: trips[trips.length - 1].trip_date,
    p_memo: `Mileage: ${miles} miles at the standard rate`,
    p_lines: [
      { account_id: expenseAccountId, debit: amount, credit: 0 },
      { account_id: creditAccountId, debit: 0, credit: amount },
    ],
  });
  if (postError) return { error: postError.message };

  const { error: linkError } = await supabase
    .from("mileage_trips")
    .update({ journal_entry_id: entryId })
    .in(
      "id",
      trips.map((t) => t.id),
    );
  if (linkError) return { error: linkError.message };
  revalidatePath("/mileage");
  return { error: null };
}
