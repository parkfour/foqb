import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvImportForm } from "@/components/csv/import-form";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

function makeCsvFile(): File {
  return new File(["account_number,name,type\n1000,Cash,asset"], "accounts.csv", {
    type: "text/csv",
  });
}

// jsdom's constraint validation incorrectly reports a `required` file input
// as valueMissing even after upload, which silently blocks a real click →
// native-submit chain. Submitting the form event directly sidesteps that
// jsdom-only gap without touching the component (the `required` attribute is
// legitimate production UX; the handler already re-checks for a file anyway).
async function selectFileAndSubmit(form: HTMLFormElement) {
  const user = userEvent.setup();
  const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, makeCsvFile());
  fireEvent.submit(form);
}

// getByText's default matcher only joins an element's direct text-node
// children, so text split across a nested element (here, the "1" in
// <strong>) never matches. This is RTL's documented workaround: match on
// full textContent, but only at the deepest element that contains it.
function byTextContent(text: string) {
  return (_content: string, element: Element | null) => {
    if (!element || element.textContent !== text) return false;
    return Array.from(element.children).every((child) => child.textContent !== text);
  };
}

describe("CsvImportForm", () => {
  it("previews the import as a dry run before writing anything", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, dryRun: true, imported: 1, errors: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CsvImportForm action="/api/import/accounts" label="Import CSV" />);
    await selectFileAndSubmit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(byTextContent("Preview: would import 1 row."))).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;
    expect(body.get("dryRun")).toBe("true");
    expect(screen.getByRole("button", { name: /confirm import/i })).toBeInTheDocument();
  });

  it("confirms the import with the same file after preview", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ success: true, dryRun: true, imported: 1, errors: [] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, dryRun: false, imported: 1, errors: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CsvImportForm action="/api/import/accounts" label="Import CSV" />);
    await selectFileAndSubmit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm import/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));

    await waitFor(() => {
      expect(screen.getByText(/imported 1 row/i)).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = secondOptions.body as FormData;
    expect(secondBody.get("dryRun")).toBe("false");
    expect(secondBody.get("file")).toBeInstanceOf(File);
  });

  it("cancels the preview without importing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, dryRun: true, imported: 1, errors: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CsvImportForm action="/api/import/accounts" label="Import CSV" />);
    await selectFileAndSubmit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
