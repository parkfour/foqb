"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_ORG_COOKIE } from "@/lib/org/current";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/org/default-accounts";

export interface ActionState {
  error: string | null;
}

export async function createOrganization(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = (formData.get("name") as string)?.trim();
  const recoverySecret = (formData.get("recoverySecret") as string)?.trim();
  const recoverySecretConfirm = (formData.get("recoverySecretConfirm") as string)?.trim();

  if (!name) {
    return { error: "Organization name is required" };
  }

  if (!recoverySecret || recoverySecret.length < 8) {
    return { error: "The owner-removal secret must be at least 8 characters" };
  }

  if (recoverySecret !== recoverySecretConfirm) {
    return { error: "The owner-removal secret and its confirmation don't match" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in" };
  }

  // Generated up front (rather than read back via .select() after insert)
  // because the newly inserted org isn't visible under its own SELECT
  // policy until the membership row below exists — requesting it back via
  // RETURNING would violate RLS (chicken-and-egg on org membership).
  const orgId = randomUUID();

  const { error: orgError } = await supabase.from("organizations").insert({ id: orgId, name });

  if (orgError) {
    return { error: orgError.message };
  }

  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: orgId,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    return { error: memberError.message };
  }

  // Best-effort: the org is already created successfully either way, and
  // Settings offers a "set it if missing" fallback (setOwnerRemovalSecret)
  // for any org that ends up without one.
  const { error: secretError } = await supabase.rpc("set_owner_removal_secret", {
    p_org_id: orgId,
    p_secret: recoverySecret,
  });
  if (secretError) {
    console.error("Failed to set owner-removal secret at org creation", secretError);
  }

  // Best-effort seed: the org is already created successfully either way.
  const { error: seedError } = await supabase.from("accounts").insert(
    DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
      organization_id: orgId,
      account_number: account.account_number,
      name: account.name,
      type: account.type,
    })),
  );

  if (seedError) {
    console.error("Failed to seed default chart of accounts", seedError);
  }

  revalidatePath("/");
  return { error: null };
}

export async function switchOrganization(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId") as string;
  if (!organizationId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  // Verify membership before trusting the submitted org id, rather than
  // relying solely on a later RLS-scoped read to quietly ignore a bad value.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!membership) return;

  (await cookies()).set(CURRENT_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/");
}
