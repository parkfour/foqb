"use client";

import Link from "next/link";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Pencil,
  Check,
  X,
} from "lucide-react";
import type { MonthlyBudgetReport, BudgetCategoryItem } from "@/lib/budget/engine";
import { updateBudgetCategoryAction, copyPreviousMonthAction } from "@/app/(dashboard)/budget/actions";
import { useBookCurrency, useMoney } from "@/components/providers/book-currency-provider";

interface BudgetManagerProps {
  report: MonthlyBudgetReport;
  canWrite: boolean;
}

function parseMonthLabel(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const date = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getAdjacentMonth(yearMonth: string, offset: number): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed
  const date = new Date(year, month + offset, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

export function BudgetManager({ report, canWrite }: BudgetManagerProps) {
  const currency = useBookCurrency();
  const formatCurrency = useMoney();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const monthLabel = parseMonthLabel(report.yearMonth);

  // A category's transactions this month, in its ledger.
  const monthEnd = getAdjacentMonth(report.yearMonth, 1);
  const lastDay = new Date(Date.UTC(Number(monthEnd.slice(0, 4)), Number(monthEnd.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const ledgerHref = (accountId: string) =>
    `/reports/account/${accountId}?start=${report.yearMonth}-01&end=${lastDay}&from=budget&month=${report.yearMonth}`;

  function handleNavigateMonth(newMonth: string) {
    startTransition(() => {
      router.push(`/budget?month=${newMonth}`);
    });
  }

  function startEditing(category: BudgetCategoryItem) {
    if (!canWrite) return;
    setEditingAccountId(category.accountId);
    setEditAmount(category.budgetedAmount > 0 ? category.budgetedAmount.toString() : "");
    setErrorMessage(null);
  }

  function cancelEditing() {
    setEditingAccountId(null);
    setEditAmount("");
  }

  async function handleSaveBudget(accountId: string) {
    const num = parseFloat(editAmount);
    if (isNaN(num) || num < 0) {
      setErrorMessage("Please enter a valid positive amount");
      return;
    }

    startTransition(async () => {
      const res = await updateBudgetCategoryAction(
        accountId,
        report.yearMonth,
        num,
      );

      if (res.success) {
        setEditingAccountId(null);
        setEditAmount("");
        setFeedbackMessage("Budget updated");
        setTimeout(() => setFeedbackMessage(null), 3000);
      } else {
        setErrorMessage(res.error || "Failed to update budget");
      }
    });
  }

  async function handleCopyPrevious() {
    if (!canWrite) return;
    if (!confirm(`Copy previous month's budget values into ${monthLabel}?`)) return;

    startTransition(async () => {
      const res = await copyPreviousMonthAction(report.yearMonth);
      if (res.success) {
        setFeedbackMessage(`Copied ${res.count ?? 0} budget lines from previous month`);
        setTimeout(() => setFeedbackMessage(null), 3500);
      } else {
        setErrorMessage(res.error || "Failed to copy previous budget");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header & Month Navigator */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Household Budget
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Track planned category budgets against actual household expenditures.
          </p>
        </div>

        {/* Month Selector Bar */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => handleNavigateMonth(getAdjacentMonth(report.yearMonth, -1))}
              disabled={isPending}
              className="p-2 text-slate-500 hover:text-slate-800 disabled:opacity-50"
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 font-medium text-sm text-slate-800">
              <Calendar className="h-4 w-4 text-slate-400" />
              <span>{monthLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => handleNavigateMonth(getAdjacentMonth(report.yearMonth, 1))}
              disabled={isPending}
              className="p-2 text-slate-500 hover:text-slate-800 disabled:opacity-50"
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {canWrite && (
            <button
              type="button"
              onClick={handleCopyPrevious}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              title="Copy budget targets from previous month"
            >
              <Copy className="h-3.5 w-3.5 text-slate-400" />
              <span>Copy Last Month</span>
            </button>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Total Budgeted
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {formatCurrency(report.totalBudgeted)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Planned for {monthLabel}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Actual Spending
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                report.overallPercentage > 100
                  ? "bg-rose-100 text-rose-800"
                  : report.overallPercentage >= 80
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {report.overallPercentage}% Used
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {formatCurrency(report.totalSpent)}
          </p>
          {/* Overall Progress Bar */}
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-300 ${
                report.overallPercentage > 100
                  ? "bg-rose-500"
                  : report.overallPercentage >= 80
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, report.overallPercentage)}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Remaining Budget
          </p>
          <p
            className={`mt-2 text-2xl font-bold tracking-tight ${
              report.totalRemaining < 0 ? "text-rose-600" : "text-emerald-600"
            }`}
          >
            {formatCurrency(report.totalRemaining)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.totalRemaining < 0
              ? `${formatCurrency(Math.abs(report.totalRemaining))} over budget`
              : "Available to spend"}
          </p>
        </div>
      </div>

      {/* Category Breakdown Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Expense Categories & Allocation
          </h2>
        </div>

        <div className="divide-y divide-slate-100">
          {report.categories.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No expense accounts found in Chart of Accounts.
            </div>
          ) : (
            report.categories.map((category) => {
              const isEditing = editingAccountId === category.accountId;
              const isOver = category.status === "over_budget";
              const isCaution = category.status === "caution";

              return (
                <div
                  key={category.accountId}
                  className="flex flex-col p-4 transition-colors hover:bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  {/* Category Info */}
                  <div className="sm:w-1/3 min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-slate-400">
                        {category.accountNumber}
                      </span>
                      <Link href={ledgerHref(category.accountId)} className="text-sm font-semibold text-slate-900 hover:underline">
                        {category.accountName}
                      </Link>
                    </div>

                    {/* Status Badge */}
                    <div className="mt-1 flex items-center gap-1.5">
                      {isOver ? (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertTriangle className="h-3 w-3" />
                          Over by {formatCurrency(Math.abs(category.remainingAmount))}
                        </span>
                      ) : isCaution ? (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          <AlertCircle className="h-3 w-3" />
                          Near limit ({category.percentageUsed}%)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" />
                          On track ({category.percentageUsed}%)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Visual Progress Bar & Figures */}
                  <div className="flex-1 sm:px-4">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-slate-600">
                        Spent:{" "}
                        <Link href={ledgerHref(category.accountId)} className="font-semibold text-slate-900 font-mono hover:underline">
                          {formatCurrency(category.actualSpent)}
                        </Link>
                      </span>
                      <span className="text-slate-500 font-mono">
                        {category.percentageUsed}% of budget
                      </span>
                    </div>

                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isOver
                            ? "bg-rose-500"
                            : isCaution
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.min(100, category.percentageUsed)}%` }}
                      />
                    </div>
                  </div>

                  {/* Budget Allocation & Edit Controls */}
                  <div className="flex items-center justify-end gap-4 sm:w-1/4">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-400 font-mono">{currency}</span>
                        <input
                          type="number"
                          step="10"
                          min="0"
                          autoFocus
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveBudget(category.accountId);
                            if (e.key === "Escape") cancelEditing();
                          }}
                          className="w-24 rounded border border-blue-400 px-2 py-1 text-xs font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveBudget(category.accountId)}
                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                          title="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className="font-mono text-xs font-bold text-slate-900">
                            {formatCurrency(category.budgetedAmount)}
                          </p>
                          <p
                            className={`font-mono text-[11px] ${
                              category.remainingAmount < 0
                                ? "text-rose-600 font-semibold"
                                : "text-slate-500"
                            }`}
                          >
                            {category.remainingAmount < 0
                              ? `-${formatCurrency(Math.abs(category.remainingAmount))}`
                              : `${formatCurrency(category.remainingAmount)} left`}
                          </p>
                        </div>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => startEditing(category)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title="Edit budgeted amount"
                            aria-label={`Edit budget for ${category.accountName}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
