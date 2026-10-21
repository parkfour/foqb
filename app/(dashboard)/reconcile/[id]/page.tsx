import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ReconciliationWorksheet } from "@/components/reconcile/reconciliation-worksheet";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { fetchBeginningBalance, fetchReconciliation, fetchUnclearedLines } from "@/lib/reconcile";
import { formatTimestampDate } from "@/lib/time/book-time";
import { getBookClock } from "@/lib/org/book-clock";

export default async function ReconciliationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const orgId = await getCurrentOrgId();
  const { timeZone } = await getBookClock(orgId);

  if (!orgId) {
    redirect("/");
  }

  const reconciliation = await fetchReconciliation(orgId, id);
  if (!reconciliation) {
    notFound();
  }

  const [beginningBalance, lines, role] = await Promise.all([
    fetchBeginningBalance(reconciliation.accountId, reconciliation.accountType, reconciliation.id),
    fetchUnclearedLines(reconciliation.accountId, reconciliation.statementDate),
    getCurrentUserRole(orgId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Reconcile ${reconciliation.accountName}`}
        description={`Statement date ${reconciliation.statementDate}`}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {reconciliation.status === "completed" ? (
        <p className="text-sm text-emerald-700">
          This reconciliation was completed on{" "}
          {reconciliation.completedAt ? formatTimestampDate(reconciliation.completedAt, timeZone) : ""}
          .
        </p>
      ) : (
        <ReconciliationWorksheet
          reconciliationId={reconciliation.id}
          organizationId={orgId}
          accountType={reconciliation.accountType}
          beginningBalance={beginningBalance}
          statementEndingBalance={reconciliation.statementEndingBalance}
          lines={lines}
          canWrite={canWrite(role)}
        />
      )}
    </div>
  );
}
