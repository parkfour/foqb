import { describe, expect, it } from "vitest";
import { findPluginPage, pluginPageLinks } from "@/lib/plugins/pages";
import type { FOQBPlugin } from "@/lib/plugins/types";

const Page = () => null;
const plugins: FOQBPlugin[] = [
  {
    manifest: { id: "taxes", name: "Taxes", version: "1", description: "" },
    pages: [
      { slug: "return", title: "Tax return", workspace: "household", component: Page },
      { slug: "Bad Slug", title: "Never listed", component: Page },
    ],
  },
  { manifest: { id: "other", name: "Other", version: "1", description: "" }, pages: [{ slug: "x", title: "X", component: Page }] },
];

describe("plugin pages", () => {
  it("lists only enabled plugins' pages for this kind of book", () => {
    expect(pluginPageLinks("household", ["taxes"], plugins)).toEqual([{ href: "/plugins/taxes/return", label: "Tax return" }]);
    expect(pluginPageLinks("business", ["taxes"], plugins)).toEqual([]);
    expect(pluginPageLinks("business", ["taxes", "other"], plugins)).toEqual([{ href: "/plugins/other/x", label: "X" }]);
  });

  it("finds a page only when its plugin is enabled and the book is the right kind", () => {
    expect(findPluginPage("taxes", "return", "household", ["taxes"], plugins)?.title).toBe("Tax return");
    expect(findPluginPage("taxes", "return", "household", [], plugins)).toBeNull();
    expect(findPluginPage("taxes", "return", "business", ["taxes"], plugins)).toBeNull();
    expect(findPluginPage("taxes", "Bad Slug", "household", ["taxes"], plugins)).toBeNull();
    expect(findPluginPage("taxes", "missing", "household", ["taxes"], plugins)).toBeNull();
  });
});
