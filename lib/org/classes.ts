import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClassOption } from "@/components/classes/class-select";

export async function fetchActiveClasses(supabase: SupabaseClient, orgId: string): Promise<ClassOption[]> {
  const { data } = await supabase.from("classes").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name");
  return (data ?? []) as ClassOption[];
}
