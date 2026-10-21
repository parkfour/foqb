import { PageHeader } from "@/components/ui/page-header";
import { ReportControls } from "@/components/reports/report-controls";
import { TrialBalanceReport } from "@/components/reports/trial-balance-report";
import { IncomeStatementReport } from "@/components/reports/income-statement-report";
import { BalanceSheetReport } from "@/components/reports/balance-sheet-report";
import { ArAgingReport } from "@/components/reports/ar-aging-report";
import { ApAgingReport } from "@/components/reports/ap-aging-report";
import { TaxLineReport } from "@/components/reports/tax-line-report";
import { TimezoneChangeNotice } from "@/components/ui/timezone-change-notice";
import { getCurrentOrgId } from "@/lib/org/current";
import { bookToday } from "@/lib/org/book-clock";
import { monthStart } from "@/lib/time/book-time";

interface ReportsPageProps {
  searchParams: Promise<{ report?: string; asOf?: string; start?: string; end?: string }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const orgId = await getCurrentOrgId();

  if (!orgId) {
    return (
      <div>
        <PageHeader
          title="Financial Reports"
          description="Trial balance, profit &amp; loss, and balance sheet selectors."
        />
        <p className="text-sm text-slate-500">Create an organization first.</p>
      </div>
    );
  }

  const params = await searchParams;
  const report = params.report ?? "trial-balance";
  const today = await bookToday(orgId);
  const asOf = params.asOf ?? today;
  const start = params.start ?? monthStart(today);
  const end = params.end ?? today;
  const isRange = report === "income-statement" || report === "tax-line-items";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financial Reports"
        description="Trial balance, profit &amp; loss, and balance sheet selectors."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <ReportControls report={report} asOf={asOf} start={start} end={end} />
      </div>

      {/* A range report covers every day in it; an as-of report turns on its last day. */}
      <TimezoneChangeNotice from={isRange ? start : asOf} to={isRange ? end : asOf} />

      {report === "income-statement" ? (
        <IncomeStatementReport orgId={orgId} start={start} end={end} />
      ) : report === "tax-line-items" ? (
        <TaxLineReport orgId={orgId} start={start} end={end} />
      ) : report === "balance-sheet" ? (
        <BalanceSheetReport orgId={orgId} asOf={asOf} />
      ) : report === "ar-aging" ? (
        <ArAgingReport orgId={orgId} asOf={asOf} />
      ) : report === "ap-aging" ? (
        <ApAgingReport orgId={orgId} asOf={asOf} />
      ) : (
        <TrialBalanceReport orgId={orgId} asOf={asOf} />
      )}
    </div>
  );
}
