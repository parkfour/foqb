// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Federal payroll figures by year. Withholding: IRS Publication 15-T,
// "Percentage Method Tables for Automated Payroll Systems", annual
// schedules, for a Form W-4 from 2020 or later. A year missing here can't
// be run: add its tables (and check every figure against the IRS) first.

export type FilingStatus = "single" | "married" | "head";

// [at least, tentative amount, rate, of the amount over]
export type Bracket = [number, number, number, number];

export interface YearTables {
  standard: Record<FilingStatus, Bracket[]>;
  // Form W-4 Step 2 box checked (two jobs).
  step2: Record<FilingStatus, Bracket[]>;
  // Worksheet 1A line 1g, when Step 2 isn't checked.
  line1g: { married: number; other: number };
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  // Withheld from an employee's wages over this in the year; no employer share.
  additionalMedicareThreshold: number;
  additionalMedicareRate: number;
  futaWageBase: number;
  // After the full credit for state unemployment tax paid on time.
  futaRate: number;
}

export const TAX_TABLES: Record<number, YearTables> = {
  // Publication 15-T (2026); Social Security wage base announced October 2025.
  2026: {
    standard: {
      married: [
        [0, 0, 0, 0],
        [19300, 0, 0.1, 19300],
        [44100, 2480, 0.12, 44100],
        [120100, 11600, 0.22, 120100],
        [230700, 35932, 0.24, 230700],
        [422850, 82048, 0.32, 422850],
        [531750, 116896, 0.35, 531750],
        [788000, 206583.5, 0.37, 788000],
      ],
      single: [
        [0, 0, 0, 0],
        [7500, 0, 0.1, 7500],
        [19900, 1240, 0.12, 19900],
        [57900, 5800, 0.22, 57900],
        [113200, 17966, 0.24, 113200],
        [209275, 41024, 0.32, 209275],
        [263725, 58448, 0.35, 263725],
        [648100, 192979.25, 0.37, 648100],
      ],
      head: [
        [0, 0, 0, 0],
        [15550, 0, 0.1, 15550],
        [33250, 1770, 0.12, 33250],
        [83000, 7740, 0.22, 83000],
        [121250, 16155, 0.24, 121250],
        [217300, 39207, 0.32, 217300],
        [271750, 56631, 0.35, 271750],
        [656150, 191171, 0.37, 656150],
      ],
    },
    step2: {
      married: [
        [0, 0, 0, 0],
        [16100, 0, 0.1, 16100],
        [28500, 1240, 0.12, 28500],
        [66500, 5800, 0.22, 66500],
        [121800, 17966, 0.24, 121800],
        [217875, 41024, 0.32, 217875],
        [272325, 58448, 0.35, 272325],
        [400450, 103291.75, 0.37, 400450],
      ],
      single: [
        [0, 0, 0, 0],
        [8050, 0, 0.1, 8050],
        [14250, 620, 0.12, 14250],
        [33250, 2900, 0.22, 33250],
        [60900, 8983, 0.24, 60900],
        [108938, 20512, 0.32, 108938],
        [136163, 29224, 0.35, 136163],
        [328350, 96489.63, 0.37, 328350],
      ],
      head: [
        [0, 0, 0, 0],
        [12075, 0, 0.1, 12075],
        [20925, 885, 0.12, 20925],
        [45800, 3870, 0.22, 45800],
        [64925, 8077.5, 0.24, 64925],
        [112950, 19603.5, 0.32, 112950],
        [140175, 28315.5, 0.35, 140175],
        [332375, 95585.5, 0.37, 332375],
      ],
    },
    line1g: { married: 12900, other: 8600 },
    socialSecurityWageBase: 184500,
    socialSecurityRate: 0.062,
    medicareRate: 0.0145,
    additionalMedicareThreshold: 200000,
    additionalMedicareRate: 0.009,
    futaWageBase: 7000,
    futaRate: 0.006,
  },
};
