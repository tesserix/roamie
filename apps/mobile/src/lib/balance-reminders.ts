import { debts, type Group } from './group-budget';
import type { TripReminder } from './trip-reminders';
export type BalanceNotice = {groupId:string;title:string;checkedAt:string};
export function balanceNotice(group:Group,now:Date):BalanceNotice|null {
  const self=group.participants.find(person=>person.isSelf);
  if(!self || !debts(group.expenses,group.settlements).some(debt=>debt.amountMinor>0&&(debt.fromId===self.id||debt.toId===self.id))) return null;
  return {groupId:group.id,title:group.title.slice(0,120),checkedAt:now.toISOString()};
}
export function balanceReminders(notice:BalanceNotice,now:Date):TripReminder[] {
  const checked=new Date(notice.checkedAt);
  if(!Number.isFinite(checked.getTime()) || typeof notice.groupId!=='string' || typeof notice.title!=='string') return [];
  const first=new Date(checked);first.setHours(18,0,0,0);
  if(first<=checked) first.setDate(first.getDate()+1);
  return Array.from({length:7},(_,index)=>{const date=new Date(first);date.setDate(date.getDate()+index);return {tripId:`group:${notice.groupId}`,groupId:notice.groupId,kind:'balances' as const,title:'Shared expense check-in',body:`Open ${notice.title.slice(0,120)} in Roamie to review who owes whom and check the latest repayments.`,date};}).filter(plan=>plan.date>now);
}
