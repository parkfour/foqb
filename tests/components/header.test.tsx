import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Header } from "@/components/layout/header";

const { useRouterMock, pushMock, useOnlineStatusMock } = vi.hoisted(() => {
  const pushMock = vi.fn();
  return {
    useRouterMock: vi.fn(() => ({ push: pushMock })),
    pushMock,
    useOnlineStatusMock: vi.fn(() => true),
  };
});

vi.mock("next/navigation", () => ({ useRouter: useRouterMock }));
vi.mock("@/components/providers/online-status-provider", () => ({
  useOnlineStatus: useOnlineStatusMock,
}));
vi.mock("@/app/logout/actions", () => ({ logout: vi.fn() }));
vi.mock("@/app/(dashboard)/actions", () => ({ switchOrganization: vi.fn() }));

const organizations = [
  { id: "org-1", name: "Org One", logoDataUrl: null },
  { id: "org-2", name: "Org Two", logoDataUrl: null },
];

beforeEach(() => {
  pushMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Header org switcher", () => {
  it("lists every organization plus a trailing option to create or restore another", () => {
    render(<Header organizations={organizations} currentOrgId="org-1" role="owner" />);

    const select = screen.getByRole("combobox", { name: /switch organization/i });
    const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Org One", "Org Two", "+ Create or restore another organization"]);
  });

  it("navigates to /organizations/new instead of submitting a switch when that option is chosen", () => {
    const { container } = render(
      <Header organizations={organizations} currentOrgId="org-1" role="owner" />,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const requestSubmitSpy = vi.spyOn(form, "requestSubmit");

    const select = screen.getByRole("combobox", { name: /switch organization/i });
    fireEvent.change(select, { target: { value: "__new__" } });

    expect(pushMock).toHaveBeenCalledWith("/organizations/new");
    expect(requestSubmitSpy).not.toHaveBeenCalled();
  });

  it("submits the switch form as normal when an actual organization is chosen", () => {
    const { container } = render(
      <Header organizations={organizations} currentOrgId="org-1" role="owner" />,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const requestSubmitSpy = vi.spyOn(form, "requestSubmit").mockImplementation(() => {});

    const select = screen.getByRole("combobox", { name: /switch organization/i });
    fireEvent.change(select, { target: { value: "org-2" } });

    expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows 'No organization' with no switcher when the user has none", () => {
    render(<Header organizations={[]} currentOrgId={null} role={null} />);

    expect(screen.getByText("No organization")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /switch organization/i })).not.toBeInTheDocument();
  });
});
