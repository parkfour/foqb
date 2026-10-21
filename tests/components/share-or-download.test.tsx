import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrDownloadFile } from "@/lib/pwa/share-or-download";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

function makeFile(): File {
  return new File(["content"], "backup.json", { type: "application/json" });
}

describe("shareOrDownloadFile", () => {
  it("shares via the Web Share API when the browser supports sharing this file", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });

    const file = makeFile();
    await shareOrDownloadFile(file, { title: "Backup", text: "Your backup" });

    expect(shareMock).toHaveBeenCalledWith({ files: [file], title: "Backup", text: "Your backup" });
  });

  it("treats a user cancelling the share sheet (AbortError) as success, not a failure", async () => {
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(abortError),
      configurable: true,
    });

    await expect(shareOrDownloadFile(makeFile())).resolves.toBeUndefined();
  });

  it("propagates a real share failure", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new Error("boom")),
      configurable: true,
    });

    await expect(shareOrDownloadFile(makeFile())).rejects.toThrow("boom");
  });

  it("falls back to a browser download when Web Share is unavailable", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });

    let wasConnectedAtClickTime = false;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        wasConnectedAtClickTime = this.isConnected;
      });

    await shareOrDownloadFile(makeFile());

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(wasConnectedAtClickTime).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("falls back to a download when canShare returns false for this file", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
    const shareMock = vi.fn();
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await shareOrDownloadFile(makeFile());

    expect(shareMock).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
