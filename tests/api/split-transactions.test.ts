import { describe, expect, it } from "vitest";
import {
  buildSplitJournalLines,
  validateSplitTransaction,
} from "@/lib/transactions/split";

describe("Split Transactions", () => {
  describe("validateSplitTransaction", () => {
    it("validates that the sum of split lines equals the parent transaction amount exactly", () => {
      // Outflow: -$150.00
      const parentOutflow = -150.0;
      const validSplits = [
        { account_id: "acc-groceries", amount: 100.0, memo: "Groceries" },
        { account_id: "acc-household", amount: 50.0, memo: "Household items" },
      ];

      const result = validateSplitTransaction(parentOutflow, validSplits);
      expect(result.isValid).toBe(true);
      expect(result.totalSplits).toBe(150.0);
      expect(result.expectedTotal).toBe(150.0);
      expect(result.difference).toBe(0);
    });

    it("rejects splits when sum does not match parent transaction total", () => {
      const parentOutflow = -100.0;
      const underSplits = [
        { account_id: "acc-groceries", amount: 60.0, memo: "Groceries" },
        { account_id: "acc-household", amount: 30.0, memo: "Household items" },
      ];

      const underResult = validateSplitTransaction(parentOutflow, underSplits);
      expect(underResult.isValid).toBe(false);
      expect(underResult.difference).toBe(10.0);

      const overSplits = [
        { account_id: "acc-groceries", amount: 70.0, memo: "Groceries" },
        { account_id: "acc-household", amount: 40.0, memo: "Household items" },
      ];

      const overResult = validateSplitTransaction(parentOutflow, overSplits);
      expect(overResult.isValid).toBe(false);
      expect(overResult.difference).toBe(-10.0);
    });

    it("rejects splits if any line is missing an account", () => {
      const parentOutflow = -100.0;
      const splitsMissingAccount = [
        { account_id: "", amount: 50.0, memo: "Line 1" },
        { account_id: "acc-2", amount: 50.0, memo: "Line 2" },
      ];

      const result = validateSplitTransaction(parentOutflow, splitsMissingAccount);
      expect(result.isValid).toBe(false);
    });
  });

  describe("buildSplitJournalLines & Ledger Integrity", () => {
    it("balances total debits and credits for an outflow (expense/spending) transaction", () => {
      const bankAccountId = "bank-checking";
      const parentAmount = -250.75;
      const parentMemo = "Target Superstore";

      const splits = [
        { account_id: "acc-groceries", amount: 150.25, memo: "Food & pantry" },
        { account_id: "acc-clothing", amount: 75.5, memo: "Kids clothes" },
        { account_id: "acc-pharmacy", amount: 25.0, memo: "Prescription" },
      ];

      const lines = buildSplitJournalLines(bankAccountId, parentAmount, parentMemo, splits);

      // Verify lines structure: 3 split debits + 1 bank credit
      expect(lines).toHaveLength(4);

      const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

      expect(Math.round(totalDebits * 100) / 100).toBe(250.75);
      expect(Math.round(totalCredits * 100) / 100).toBe(250.75);
      expect(totalDebits).toBe(totalCredits);

      const bankLine = lines.find((l) => l.account_id === bankAccountId);
      expect(bankLine?.credit).toBe(250.75);
      expect(bankLine?.debit).toBe(0);
    });

    it("balances total debits and credits for an inflow (deposit/income) transaction", () => {
      const bankAccountId = "bank-checking";
      const parentAmount = 3000.0;
      const parentMemo = "Bi-weekly Payroll Direct Deposit";

      const splits = [
        { account_id: "acc-salary", amount: 2800.0, memo: "Base salary" },
        { account_id: "acc-reimbursement", amount: 200.0, memo: "Travel expense reimbursement" },
      ];

      const lines = buildSplitJournalLines(bankAccountId, parentAmount, parentMemo, splits);

      // 1 bank debit + 2 split credits
      expect(lines).toHaveLength(3);

      const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

      expect(totalDebits).toBe(3000.0);
      expect(totalCredits).toBe(3000.0);
      expect(totalDebits).toBe(totalCredits);

      const bankLine = lines.find((l) => l.account_id === bankAccountId);
      expect(bankLine?.debit).toBe(3000.0);
      expect(bankLine?.credit).toBe(0);
    });

    it("remains balance-sheet-neutral on inter-account transfers without recording income or expense", () => {
      // Transfer $500 from Checking to Savings + $500 to Brokerage
      const checkingAccountId = "acc-checking";
      const parentAmount = -1000.0;

      const transferSplits = [
        { account_id: "acc-savings", amount: 500.0, memo: "Transfer to Savings" },
        { account_id: "acc-brokerage", amount: 500.0, memo: "Transfer to Brokerage" },
      ];

      const lines = buildSplitJournalLines(checkingAccountId, parentAmount, "Savings transfer", transferSplits);

      const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

      expect(totalDebits).toBe(1000.0);
      expect(totalCredits).toBe(1000.0);
      // All involved accounts are Asset accounts (balance-sheet neutral)
    });
  });
});
