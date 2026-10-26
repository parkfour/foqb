"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";

export async function addClass(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const orgId = await getCurrentOrgId();
  const name = ((formData.get("name") as string) ?? "").trim();
  if (!orgId || !name) return { error: "A name is required" };
  const supabase = await createClient();
  const { error } = await supabase.from("classes").insert({ organization_id: orgId, name });
  if (error) return { error: error.code === "23505" ? "There's already a class with that name" : error.message };
  revalidatePath("/classes");
  return { error: null };
}

export async function toggleClass(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("classes").update({ is_active: formData.get("isActive") !== "true" }).eq("id", id);
  revalidatePath("/classes");
}
