import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The signed-in user, asked of Supabase Auth once per request: the layout,
// the page and the helpers they share all need it, and each ask is a
// network round trip.
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
