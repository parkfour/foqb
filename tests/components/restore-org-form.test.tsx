import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestoreOrgForm } from "@/components/onboarding/restore-org-form";

const { useRouterMock, refreshMock } = vi.hoisted(() => {
  const refreshMock = vi.fn();
  return { useRouterMock: vi.fn(() => ({ refresh: refreshMock })), refreshMock };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));

beforeEach(() => {
  refreshMock.mockClear();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

function makeBackupFile(): File {
  return new File([JSON.stringify({ organization: { id: "org-1", name: "Test Org" } })], "backup.json", {
    type: "application/json",
  });
}

describe("RestoreOrgForm", () => {
  it("uploads the file and refreshes on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, organizationId: "org-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<RestoreOrgForm />);
    const user = userEvent.setup();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeBackupFile());
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/import/organization",
      expect.objectContaining({ method: "POST" }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("shows the server's error message and does not refresh on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This backup file is missing its organization details." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<RestoreOrgForm />);
    const user = userEvent.setup();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeBackupFile());
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText("This backup file is missing its organization details.")).toBeInTheDocument();
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
