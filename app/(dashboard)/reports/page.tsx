import { PageHeader } from "@/components/ui/page-header";
import { ReportControls } from "@/components/reports/report-controls";
import { TrialBalanceReport } from "@/components/reports/trial-balance-report";
import { IncomeStatementReport } from "@/components/reports/income-statement-report";
import { BalanceSheetReport } from "@/components/reports/balance-sheet-report";
import { ArAgingReport } from "@/components/reports/ar-aging-report";
import { ApAgingReport } from "@/components/reports/ap-aging-report";
import { TaxLineReport } from "@/components/reports/tax-line-report";
import { getCurrentOrgId } from "@/lib/org/current";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

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
  const asOf = params.asOf ?? today();
  const start = params.start ?? currentMonthStart();
  const end = params.end ?? today();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financial Reports"
        description="Trial balance, profit &amp; loss, and balance sheet selectors."
      />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <ReportControls report={report} asOf={asOf} start={start} end={end} />
      </div>

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
