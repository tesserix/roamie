import { toHome } from './money';
import type { Expense } from './store';

export type StatementLine = { date: string; merchant: string; amountMinor: number; currency: string; category: string };
export type StatementRow = StatementLine & { homeMinor: number | null; duplicate: boolean; selected: boolean };

export function reviewStatement(lines: StatementLine[], expenses: Expense[], home: string, rates: Record<string, number> | null): StatementRow[] {
  return lines.map(line => {
    const homeMinor = line.currency === home ? line.amountMinor : rates ? toHome(line.amountMinor, line.currency, home, rates) : null;
    const duplicate = expenses.some(e => e.currency === line.currency && e.amountMinor === line.amountMinor && e.at.slice(0, 10) === line.date);
    return { ...line, homeMinor, duplicate, selected: homeMinor !== null && !duplicate };
  });
}
