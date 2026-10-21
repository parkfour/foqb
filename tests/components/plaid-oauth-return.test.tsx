import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
// Link's script "loads" immediately, so onReady (where resuming happens) fires on mount.
vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.());
    return null;
  },
}));

import { ConnectBankButton } from "@/components/settings/connect-bank-button";
import { rememberLinkSession, takeLinkSession } from "@/components/settings/plaid-link-session";

type CreateConfig = Parameters<NonNullable<Window["Plaid"]>["create"]>[0];

describe("Plaid OAuth return (/settings/bank-return)", () => {
  let createMock: ReturnType<typeof vi.fn<(config: CreateConfig) => { open: () => void }>>;
  let openMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    localStorage.clear();
    pushMock.mockReset();
    openMock = vi.fn<() => void>();
    createMock = vi.fn<(config: CreateConfig) => { open: () => void }>(() => ({ open: openMock }));
    window.Plaid = { create: createMock };
  });

  afterEach(() => {
    cleanup();
    delete window.Plaid;
    vi.unstubAllGlobals();
  });

  it("remembers a Link session for exactly one read", () => {
    rememberLinkSession({ token: "link-1", mode: "connect" });

    expect(takeLinkSession()).toEqual({ token: "link-1", mode: "connect" });
    expect(takeLinkSession()).toBeNull();
  });

  it("re-opens Link with the remembered token and the URL the bank returned to", async () => {
    rememberLinkSession({ token: "link-1", mode: "connect" });

    render(<ConnectBankButton organizationId="org-1" resumeOAuth />);

    await waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({
      token: "link-1",
      receivedRedirectUri: window.location.href,
    });
  });

  it("finishes a reconnect started before the redirect, then returns to Settings", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    rememberLinkSession({ token: "link-2", mode: "reconnect", enrollmentId: "enr-1" });

    render(<ConnectBankButton organizationId="org-1" resumeOAuth />);
    await waitFor(() => expect(openMock).toHaveBeenCalled());

    createMock.mock.calls[0][0].onSuccess("", { institution: null, accounts: [] });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/settings"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bank/reconnect",
      expect.objectContaining({ body: JSON.stringify({ enrollmentId: "enr-1" }) }),
    );
  });

  it("says so when there's no remembered session to resume", async () => {
    render(<ConnectBankButton organizationId="org-1" resumeOAuth />);

    expect(await screen.findByText(/expired — please start again/)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
