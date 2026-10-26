import { describe, expect, it, vi } from "vitest";
import { fetchPrice, parseStooq, stooqSymbol } from "@/plugins/security-prices/server";

describe("security prices plugin", () => {
  it("asks Stooq for a US symbol with .US and keeps a market suffix", () => {
    expect(stooqSymbol("VTI")).toBe("vti.us");
    expect(stooqSymbol("VOD.UK")).toBe("vod.uk");
  });

  it("reads the close and date, and gives nothing for an unknown symbol", () => {
    expect(parseStooq("Symbol,Date,Time,Open,High,Low,Close,Volume\nVTI.US,2026-10-23,22:00:09,301,303,300,302.5,1000\n")).toEqual({
      price: 302.5,
      asOf: "2026-10-23",
      source: "Stooq daily close",
    });
    expect(parseStooq("Symbol,Date,Time,Open,High,Low,Close,Volume\nNOPE.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n")).toBeNull();
  });

  it("sends only the symbol, and refuses one that isn't a symbol", async () => {
    const fetcher = vi.fn(async () => new Response("Symbol,Date,Time,Open,High,Low,Close,Volume\nVTI.US,2026-10-23,22:00:09,1,1,1,2,1\n"));
    expect(await fetchPrice("VTI", fetcher as unknown as typeof fetch)).toMatchObject({ price: 2 });
    expect((fetcher.mock.calls[0] as unknown[])[0]).toContain("s=vti.us");
    expect(await fetchPrice("vti; rm -rf", fetcher as unknown as typeof fetch)).toBeNull();
  });
});
