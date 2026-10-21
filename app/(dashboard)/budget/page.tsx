import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getCurrentUserRole, canWrite } from "@/lib/org/current";
import { getMonthlyBudgetReport } from "@/lib/budget/engine";
import { BudgetManager } from "@/components/budget/budget-manager";
import { bookToday } from "@/lib/org/book-clock";
import { addDays } from "@/lib/time/book-time";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";

interface BudgetPageProps {
  searchParams: Promise<{ month?: string }>;
}

function nextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default async function BudgetPage({ searchParams }: BudgetPageProps) {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    redirect("/");
  }

  const supabase = await createClient();
  const role = await getCurrentUserRole(orgId);
  const userCanWrite = canWrite(role);

  const { month } = await searchParams;
  const defaultMonth = (await bookToday(orgId)).slice(0, 7);
  const targetMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth;

  const report = await getMonthlyBudgetReport(supabase, orgId, targetMonth);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <TimezoneChangeNotice from={`${targetMonth}-01`} to={addDays(`${nextMonth(targetMonth)}-01`, -1)} />
      <BudgetManager report={report} canWrite={userCanWrite} />
    </div>
  );
}
