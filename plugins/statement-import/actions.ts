// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { importStatement, type ImportResult } from "./import";
import type { ParsedStatement } from "./parse";

export async function importStatementAction(
  accountId: string,
  statement: ParsedStatement,
  options: { settleBefore?: boolean } = {},
): Promise<ImportResult> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { success: false, error: "No book selected" };
  if (!canWrite(await getCurrentUserRole(orgId))) return { success: false, error: "You can't change this book" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const result = await importStatement(supabase, orgId, user?.id ?? null, accountId, statement, {
    settleBefore: options.settleBefore === true,
  });
  if (result.success) {
    revalidatePath("/register");
    revalidatePath("/reconcile");
  }
  return result;
}
