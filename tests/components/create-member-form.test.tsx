import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { createMemberAccountMock } = vi.hoisted(() => ({ createMemberAccountMock: vi.fn() }));

vi.mock("@/app/(dashboard)/settings/actions", () => ({
  createMemberAccount: createMemberAccountMock,
}));

import { CreateMemberForm } from "@/components/settings/create-member-form";

afterEach(() => {
  cleanup();
});

describe("CreateMemberForm", () => {
  it("renders the email field and every role option", () => {
    render(<CreateMemberForm organizationId="org-1" />);

    const email = screen.getByLabelText(/new member.s email/i);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("required");
    expect(screen.getByRole("option", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Accountant", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Viewer" })).toBeInTheDocument();
  });

  it("passes the organization id through as a hidden field", () => {
    const { container } = render(<CreateMemberForm organizationId="org-42" />);
    const hidden = container.querySelector('input[name="organizationId"]');
    expect(hidden).toHaveValue("org-42");
  });
});
