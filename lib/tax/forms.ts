// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Which tax_lines forms a book's tax form (organizations.tax_form) tags its
// accounts with: an individual return spans several forms.
export const TAX_FORM_LINES: Record<string, string[]> = {
  schedule_c: ["schedule_c"],
  corporate: ["corporate"],
  individual: ["form_1040", "schedule_1", "schedule_b", "schedule_c", "schedule_d", "schedule_e"],
};

export const FORM_NAMES: Record<string, string> = {
  schedule_c: "Schedule C",
  corporate: "Form 1120",
  form_1040: "Form 1040",
  schedule_1: "Schedule 1",
  schedule_b: "Schedule B",
  schedule_d: "Schedule D",
  schedule_e: "Schedule E",
};

// Schedule E has a column per rental: its lines are kept per property.
export const PER_PROPERTY_FORM = "schedule_e";
