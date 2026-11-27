import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createSupabaseMock, ok } from "../api/supabase-mock";

const { org } = vi.hoisted(() => ({ org: { workspace: "household", role: "owner" } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createSupabaseMock({
      tables: {
        journal_entries: { select: ok([]) },
        accounts: { select: ok([{ id: "a1", account_number: "1205", name: "PCB home", currency: null }]) },
      },
    }).client,
}));
vi.mock("@/lib/org/current", () => ({
  getCurrentOrgId: async () => "org-1",
  getCurrentUserRole: async () => org.role,
  canWrite: (role: string) => role !== "viewer",
  getWorkspaceType: async () => org.workspace,
  getUseAccountCodes: async () => true,
}));
vi.mock("@/lib/org/classes", () => ({ fetchActiveClasses: async () => [] }));
vi.mock("@/lib/org/book-currency", () => ({ getBookCurrency: async () => "USD" }));
vi.mock("@/app/(dashboard)/transactions/actions", () => ({ voidJournalEntry: vi.fn() }));
vi.mock("@/components/providers/online-status-provider", () => ({ useOnlineStatus: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import JournalPage from "@/app/(dashboard)/journal/page";

async function renderPage() {
  render(await JournalPage({ searchParams: Promise.resolve({}) }));
}

afterEach(cleanup);

describe("Journal Entries page", () => {
  it("lets a household book's editor make a journal entry", async () => {
    Object.assign(org, { workspace: "household", role: "owner" });
    await renderPage();
    expect(screen.getByRole("button", { name: "Post Entry" })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: /PCB home/ }).length).toBeGreaterThan(0);
  });

  it("shows no entry form to a household viewer", async () => {
    Object.assign(org, { workspace: "household", role: "viewer" });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Post Entry" })).not.toBeInTheDocument();
  });

  it("leaves a business book's entry form on Bank Transactions", async () => {
    Object.assign(org, { workspace: "business", role: "owner" });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Post Entry" })).not.toBeInTheDocument();
  });
});
