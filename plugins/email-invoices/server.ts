// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createAdminClient } from "@/lib/supabase/admin";
import type { ServerPluginParts } from "@/lib/plugins/types";
import { REMINDER_INTERVAL_SECONDS, sendDueReminders } from "./reminders";
import { loadMailServer, sendMail } from "./mailer";

export const emailInvoicesServer: ServerPluginParts = {
  jobs: [{ name: "invoice-reminders", minIntervalSeconds: REMINDER_INTERVAL_SECONDS, run: sendDueReminders }],
  // The book's mail server, for FOQB and other plugins (sendBookMail).
  mailer: {
    ready: async (organizationId) => (await loadMailServer(createAdminClient(), organizationId)) !== null,
    send: async (organizationId, mail) => {
      const admin = createAdminClient();
      const server = await loadMailServer(admin, organizationId);
      if (!server) throw new Error("This book has no mail server set up");
      const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      await sendMail(server, { fromName: (org?.name as string | undefined) ?? "FOQB", ...mail });
    },
  },
};
