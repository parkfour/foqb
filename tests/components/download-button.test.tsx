import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DownloadButton } from "@/components/ui/download-button";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

function jsonResponse(body: string, filename: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Disposition": `attachment; filename="${filename}"` }),
    blob: async () => new Blob([body], { type: "application/json" }),
  };
}

describe("DownloadButton", () => {
  it("fetches the file, names it from Content-Disposition, and shares it when supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("{}", "foqb-backup-org-1.json"));
    vi.stubGlobal("fetch", fetchMock);
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });

    render(<DownloadButton href="/api/export/organization" label="Download full backup" />);
    fireEvent.click(screen.getByRole("button", { name: "Download full backup" }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith("/api/export/organization");
    const call = shareMock.mock.calls[0][0] as { files: File[] };
    expect(call.files[0].name).toBe("foqb-backup-org-1.json");
  });

  it("falls back to a download when sharing isn't supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("account,name\n1000,Cash", "accounts.csv"));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DownloadButton href="/api/export/accounts" label="Export CSV" />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
  });

  it("shows an error message when the fetch itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    render(<DownloadButton href="/api/export/accounts" label="Export CSV" />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(screen.getByText(/download failed/i)).toBeInTheDocument();
    });
  });
});
