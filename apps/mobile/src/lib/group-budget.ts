import type {
  Group as ApiGroup,
  ShareInput,
  Split,
  GroupExpense,
  Debt,
  Settlement,
} from "./group-budget-contract";
export type {
  ShareInput,
  Split,
  GroupExpense,
  Debt,
  Participant,
  Settlement,
} from "./group-budget-contract";
export type SplitMethod = GroupExpense["method"];
export type Group = Omit<ApiGroup, "emails"> & { emails?: ApiGroup["emails"] };
export type GroupSummary = Pick<Group, "id" | "title" | "currency">;
export type GroupList = {
  groups: GroupSummary[];
  invitations: GroupSummary[];
  nextCursor: string | null;
};
export const today = () => new Date().toLocaleDateString("en-CA");

export function currencyDecimals(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a currency code.");
  // ISO minor units differ from some locales’ cash-display precision (for example HUF).
  if (
    [
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "ISK",
      "JPY",
      "KMF",
      "KRW",
      "PYG",
      "RWF",
      "UGX",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ].includes(currency)
  )
    return 0;
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency))
    return 3;
  return 2;
}
export const groupFormat = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currencyDisplay: "code",
    currency,
    minimumFractionDigits: currencyDecimals(currency),
    maximumFractionDigits: currencyDecimals(currency),
  }).format(minor / 10 ** currencyDecimals(currency));
export function convertMinor(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null {
  if (from === to) return amount;
  const rate = rates[from];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const result = Math.round(
    (amount / 10 ** currencyDecimals(from) / rate) * 10 ** currencyDecimals(to),
  );
  return Number.isSafeInteger(result) ? result : null;
}

export function minorAmount(text: string, currency: string): number | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const places = currencyDecimals(currency);
  if (fraction.length > places) return null;
  const value =
    Number(whole) * 10 ** places + Number(fraction.padEnd(places, "0"));
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
    ? value
    : null;
}

export function allocate(
  amount: number,
  method: SplitMethod,
  shares: ShareInput[],
): Split[] {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 1_000_000_000 ||
    !shares.length ||
    shares.length > 20 ||
    new Set(shares.map((x) => x.participantId)).size !== shares.length ||
    shares.some((x) => !Number.isSafeInteger(x.value) || x.value < 0)
  )
    throw new Error("Check the amount and selected travellers.");
  const sorted = [...shares].sort((a, b) =>
    a.participantId.localeCompare(b.participantId),
  );
  const weights = sorted.map((x) => (method === "equal" ? 1 : x.value));
  const total = weights.reduce((a, b) => a + b, 0);
  if (
    (method === "percentage" && total !== 10000) ||
    (method === "exact" && total !== amount)
  )
    throw new Error(
      method === "percentage"
        ? "Percentages must total 100%."
        : "Exact amounts must equal the expense total.",
    );
  if (method === "exact")
    return sorted.map((x) => ({
      participantId: x.participantId,
      amountMinor: x.value,
    }));
  const parts = weights.map((weight, i) => ({
    participantId: sorted[i].participantId,
    amountMinor: Math.floor((amount * weight) / total),
    remainder: (amount * weight) % total,
  }));
  let left = amount - parts.reduce((n, x) => n + x.amountMinor, 0);
  const order = [...parts].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      a.participantId.localeCompare(b.participantId),
  );
  for (const part of order) {
    if (!left) break;
    part.amountMinor++;
    left--;
  }
  return parts.map(({ participantId, amountMinor }) => ({
    participantId,
    amountMinor,
  }));
}

type DebtExpense = Pick<
  GroupExpense,
  "id" | "payerId" | "currency" | "occurredOn" | "splits"
>;
type DebtSettlement = Pick<
  Settlement,
  "fromId" | "toId" | "currency" | "amountMinor"
> & { occurredOn?: string };
export function debts(
  expenses: DebtExpense[],
  settlements: DebtSettlement[],
  asOf = today(),
): Debt[] {
  const pairs = new Map<
    string,
    {
      a: string;
      b: string;
      currency: string;
      items: { amount: number; date: string; id: string }[];
    }
  >();
  const pair = (from: string, to: string, currency: string) => {
    const [a, b] = [from, to].sort();
    const key = JSON.stringify([a, b, currency]);
    if (!pairs.has(key)) pairs.set(key, { a, b, currency, items: [] });
    return pairs.get(key)!;
  };
  for (const expense of expenses)
    for (const split of expense.splits) {
      if (split.participantId === expense.payerId || !split.amountMinor)
        continue;
      const p = pair(split.participantId, expense.payerId, expense.currency);
      p.items.push({
        amount: split.amountMinor * (split.participantId === p.a ? 1 : -1),
        date: expense.occurredOn,
        id: expense.id,
      });
    }
  for (const s of settlements) {
    const p = pair(s.fromId, s.toId, s.currency);
    p.items.push({
      amount: -s.amountMinor * (s.fromId === p.a ? 1 : -1),
      date: s.occurredOn ?? asOf,
      id: "",
    });
  }
  const result: Debt[] = [];
  for (const p of pairs.values()) {
    const net = p.items.reduce((n, x) => n + x.amount, 0);
    if (!net) continue;
    const sign = Math.sign(net);
    const positive = p.items
      .filter((x) => Math.sign(x.amount) === sign)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let offset = p.items
      .filter((x) => Math.sign(x.amount) !== sign)
      .reduce((n, x) => n + Math.abs(x.amount), 0);
    let oldestOn = asOf;
    for (const item of positive) {
      const amount = Math.abs(item.amount);
      if (offset >= amount) {
        offset -= amount;
        continue;
      }
      oldestOn = item.date;
      break;
    }
    result.push({
      fromId: sign > 0 ? p.a : p.b,
      toId: sign > 0 ? p.b : p.a,
      currency: p.currency,
      amountMinor: Math.abs(net),
      oldestOn,
      overdue:
        (Date.parse(asOf + "T00:00:00Z") -
          Date.parse(oldestOn + "T00:00:00Z")) /
          86400000 >=
        30,
    });
  }
  return result.sort(
    (a, b) =>
      a.fromId.localeCompare(b.fromId) ||
      a.toId.localeCompare(b.toId) ||
      a.currency.localeCompare(b.currency),
  );
}

export function reminderUrl(
  channel: "email" | "whatsapp",
  contact: string,
  message: string,
): string {
  if (channel === "email") {
    if (!/^[^\s@,;?&#]+@[^\s@,;?&#]+\.[^\s@,;?&#]+$/.test(contact))
      throw new Error("Add a valid email address first.");
    return `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent("Roamie trip expense reminder")}&body=${encodeURIComponent(message)}`;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(contact))
    throw new Error(
      "Use an international WhatsApp number, including + and country code.",
    );
  return `https://wa.me/${contact.slice(1)}?text=${encodeURIComponent(message)}`;
}
export function reminderText(group: Group, debt: Debt): string {
  const name = (id: string) =>
    group.participants.find((x) => x.id === id)?.name ?? "a traveller";
  return `Hi ${name(debt.fromId)}, a friendly reminder for ${group.title}: ${groupFormat(debt.amountMinor, debt.currency)} remains recorded as owed to ${name(debt.toId)}. Please check the Roamie group and record any repayment already made. Thank you!`;
}
