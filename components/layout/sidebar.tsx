"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Landmark,
  ClipboardCheck,
  BookOpen,
  BarChart3,
  ListFilter,
  NotebookPen,
  Package,
  Tag,
  Settings,
  Users,
  Building2,
  History,
  Boxes,
  Shield,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  TrendingUp,
  CreditCard,
  Home,
  ArrowLeftRight,
  PieChart,
  Puzzle,
  type LucideIcon,
} from "lucide-react";

interface NavLeaf {
  type: "link";
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  type: "group";
  label: string;
  icon: LucideIcon;
  prefix: string;
  items: { href: string; label: string }[];
}

type NavEntry = NavLeaf | NavGroup;

const BASE_NAV_ENTRIES: NavEntry[] = [
  { type: "link", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { type: "link", href: "/transactions", label: "Bank Transactions", icon: Landmark },
  { type: "link", href: "/reconcile", label: "Reconcile", icon: ClipboardCheck },
  {
    type: "group",
    label: "Customers",
    icon: Users,
    prefix: "/customers",
    items: [
      { href: "/customers/new", label: "Add" },
      { href: "/customers", label: "Edit" },
      { href: "/customers/invoices/new", label: "Invoice" },
      { href: "/customers/payments/new", label: "Receive Payment" },
      { href: "/customers/invoices", label: "All Invoices" },
      { href: "/customers/recurring", label: "Recurring Invoices" },
    ],
  },
  {
    type: "group",
    label: "Vendors",
    icon: Building2,
    prefix: "/vendors",
    items: [
      { href: "/vendors/new", label: "Add" },
      { href: "/vendors", label: "Edit" },
      { href: "/vendors/bills/new", label: "Enter Invoice" },
      { href: "/vendors/payments/new", label: "Make Payment" },
      { href: "/vendors/bills", label: "All Bills" },
      { href: "/vendors/recurring", label: "Recurring Bills" },
    ],
  },
  { type: "link", href: "/accounts", label: "Chart of Accounts", icon: BookOpen },
  { type: "link", href: "/items", label: "Items", icon: Tag },
  { type: "link", href: "/fixed-assets", label: "Fixed Assets", icon: Boxes },
  { type: "link", href: "/reports", label: "Financial Reports", icon: BarChart3 },
  { type: "link", href: "/between-books", label: "Between Your Books", icon: ArrowLeftRight },
  { type: "link", href: "/rules", label: "Rules", icon: ListFilter },
  { type: "link", href: "/audit-log", label: "Audit Log", icon: History },
];

const HOUSEHOLD_NAV_ENTRIES: NavEntry[] = [
  { type: "link", href: "/", label: "Net Worth", icon: TrendingUp },
  { type: "link", href: "/register", label: "Register", icon: CreditCard },
  { type: "link", href: "/transactions", label: "Bank Transactions", icon: Landmark },
  { type: "link", href: "/reconcile", label: "Reconcile", icon: ClipboardCheck },
  { type: "link", href: "/budget", label: "Budget", icon: PieChart },
  { type: "link", href: "/properties", label: "Properties & Assets", icon: Home },
  { type: "link", href: "/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { type: "link", href: "/accounts", label: "Chart of Accounts", icon: BookOpen },
  { type: "link", href: "/journal", label: "Journal Entries", icon: NotebookPen },
  { type: "link", href: "/between-books", label: "Between Your Books", icon: ArrowLeftRight },
  { type: "link", href: "/rules", label: "Rules", icon: ListFilter },
  { type: "link", href: "/audit-log", label: "Audit Log", icon: History },
];

const INVENTORY_NAV_ITEM: NavLeaf = {
  type: "link",
  href: "/inventory",
  label: "Inventory",
  icon: Package,
};

const SETTINGS_NAV_ITEM: NavLeaf = { type: "link", href: "/settings", label: "Settings", icon: Settings };

const SITE_ADMIN_NAV_ITEM: NavLeaf = {
  type: "link",
  href: "/site-admin",
  label: "Site Admin",
  icon: Shield,
};

const NAV_GROUPS = BASE_NAV_ENTRIES.filter((entry): entry is NavGroup => entry.type === "group");

export function Sidebar({
  showInventory = false,
  showSiteAdmin = false,
  workspaceType = "business",
  orgName,
  orgLogoDataUrl,
  sourceCodeUrl,
  pluginPages = [],
}: {
  showInventory?: boolean;
  showSiteAdmin?: boolean;
  workspaceType?: "business" | "household";
  orgName?: string;
  sourceCodeUrl?: string | null;
  orgLogoDataUrl?: string | null;
  // Enabled plugins' own pages, listed before Settings.
  pluginPages?: { href: string; label: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(NAV_GROUPS.filter((group) => pathname.startsWith(group.prefix)).map((g) => g.label)),
  );

  const isHousehold = workspaceType === "household";
  const pluginEntries: NavLeaf[] = pluginPages.map((p) => ({ type: "link", ...p, icon: Puzzle }));
  const navEntries = isHousehold
    ? [
        ...HOUSEHOLD_NAV_ENTRIES,
        ...pluginEntries,
        SETTINGS_NAV_ITEM,
        ...(showSiteAdmin ? [SITE_ADMIN_NAV_ITEM] : []),
      ]
    : [
        ...BASE_NAV_ENTRIES,
        ...(showInventory ? [INVENTORY_NAV_ITEM] : []),
        ...pluginEntries,
        SETTINGS_NAV_ITEM,
        ...(showSiteAdmin ? [SITE_ADMIN_NAV_ITEM] : []),
      ];

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-md border border-slate-200 bg-white p-2 shadow-sm md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 transform flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          {orgLogoDataUrl ? (
            <span className="flex items-center gap-2 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable asset */}
              <img
                src={orgLogoDataUrl}
                alt=""
                className="h-7 w-7 shrink-0 rounded-md border border-slate-100 object-contain"
              />
              <span className="truncate text-lg font-semibold text-slate-900">{orgName}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Image src="/icon.svg" alt="" width={28} height={28} unoptimized className="rounded-md" />
              <span className="text-lg font-semibold text-slate-900">FOQB</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-md p-1 text-slate-500 md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {navEntries.map((entry) => {
            if (entry.type === "link") {
              const isActive = pathname === entry.href;
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {entry.label}
                </Link>
              );
            }

            const isExpanded = expandedGroups.has(entry.label);
            const Icon = entry.icon;
            const Chevron = isExpanded ? ChevronDown : ChevronRight;

            return (
              <div key={entry.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.label)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{entry.label}</span>
                  <Chevron className="h-4 w-4" />
                </button>
                {isExpanded && (
                  <div className="ml-6 flex flex-col gap-1 border-l border-slate-200 pl-3">
                    {entry.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                            isActive
                              ? "bg-slate-900 text-white"
                              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="shrink-0 px-4 py-3 text-xs text-slate-400">
          <p>
            <Link href="/changelog" className="hover:text-slate-600 hover:underline" title="What's new">
              v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_GIT_SHA}
            </Link>
          </p>
          <p className="mt-1 flex gap-2">
            <Link href="/terms" className="hover:text-slate-600 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-slate-600 hover:underline">
              Privacy
            </Link>
            <Link href="/security" className="hover:text-slate-600 hover:underline">
              Security
            </Link>
            {sourceCodeUrl && (
              <a href={sourceCodeUrl} className="hover:text-slate-600 hover:underline">
                Source
              </a>
            )}
          </p>
        </div>
      </aside>
    </>
  );
}
