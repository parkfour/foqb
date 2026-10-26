// Holdings from trades, at average cost: a buy adds its quantity and cost
// (price times quantity, plus fees); a sell takes quantity off at the
// average cost so far, and its gain is the proceeds (less fees) over that.

export interface Trade {
  id?: string;
  account_id: string;
  security_id: string;
  trade_date: string;
  kind: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
}

export interface Holding {
  account_id: string;
  security_id: string;
  quantity: number;
  cost: number;
  realized: number;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

export function computeHoldings(trades: Trade[]): Holding[] {
  const byKey = new Map<string, Holding>();
  const sorted = [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  for (const t of sorted) {
    const key = `${t.account_id}:${t.security_id}`;
    const h = byKey.get(key) ?? { account_id: t.account_id, security_id: t.security_id, quantity: 0, cost: 0, realized: 0 };
    const quantity = Number(t.quantity);
    if (t.kind === "buy") {
      h.quantity = round(h.quantity + quantity, 6);
      h.cost = round(h.cost + quantity * Number(t.price) + Number(t.fees));
    } else {
      const sale = saleOf(h, quantity, Number(t.price), Number(t.fees));
      h.realized = round(h.realized + sale.gain);
      h.cost = round(h.cost - sale.cost);
      h.quantity = round(h.quantity - quantity, 6);
    }
    byKey.set(key, h);
  }
  return [...byKey.values()];
}

// Selling `quantity` from a holding: the average cost it takes out, the
// proceeds and the gain. Selling more than is held takes out all the cost.
export function saleOf(h: Pick<Holding, "quantity" | "cost">, quantity: number, price: number, fees: number) {
  const cost = h.quantity > 0 ? round(h.cost * Math.min(quantity / h.quantity, 1)) : 0;
  const proceeds = round(quantity * price - fees);
  return { cost, proceeds, gain: round(proceeds - cost) };
}
