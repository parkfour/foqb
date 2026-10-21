import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { createOrganizationMock } = vi.hoisted(() => ({ createOrganizationMock: vi.fn() }));

vi.mock("@/app/(dashboard)/actions", () => ({ createOrganization: createOrganizationMock }));

import { CreateOrgForm } from "@/components/onboarding/create-org-form";

afterEach(() => {
  cleanup();
});

describe("CreateOrgForm", () => {
  it("requires an owner-removal secret and its confirmation, each at least 8 characters", () => {
    render(<CreateOrgForm />);

    const secret = screen.getByPlaceholderText("At least 8 characters");
    const confirm = screen.getByPlaceholderText("Confirm secret");

    expect(secret).toHaveAttribute("required");
    expect(secret).toHaveAttribute("minLength", "8");
    expect(secret).toHaveAttribute("type", "password");
    expect(confirm).toHaveAttribute("required");
    expect(confirm).toHaveAttribute("minLength", "8");
    expect(confirm).toHaveAttribute("type", "password");
  });

  it("explains what the secret is for", () => {
    render(<CreateOrgForm />);

    expect(screen.getByText(/last or second-to-last owner/i)).toBeInTheDocument();
    expect(screen.getByText(/can't be recovered or changed later/i)).toBeInTheDocument();
  });
});
