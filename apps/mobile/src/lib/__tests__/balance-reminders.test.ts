import {expect,test} from '@jest/globals';
import {balanceNotice,balanceReminders} from '../balance-reminders';
import type {Group} from '../group-budget';
const group:Group={id:'g',title:'Trip friends',currency:'AUD',revision:1,isOwner:true,participants:[{id:'me',name:'Me',email:'',whatsapp:'',isSelf:true,hasAccount:true,invitedUntil:null},{id:'friend',name:'Friend',email:'',whatsapp:'',isSelf:false,hasAccount:true,invitedUntil:null}],expenses:[{id:'e',payerId:'friend',description:'Lunch',currency:'AUD',amountMinor:2000,occurredOn:'2026-11-05',method:'equal',shares:[{participantId:'me',value:1},{participantId:'friend',value:1}],splits:[{participantId:'me',amountMinor:1000},{participantId:'friend',amountMinor:1000}],homeCurrency:'AUD',homeMinor:2000,rateAsOf:'',canEdit:true}],settlements:[]};
const now=new Date(2026,10,5,12);
test('schedules a bounded personal balance check without stale lock-screen amounts',()=>{
 const notice=balanceNotice(group,now);
 expect(notice).not.toBeNull();
 const plans=balanceReminders(notice!,now);
 expect(plans).toHaveLength(7);
 expect(plans[0].date.getHours()).toBe(18);
 expect(plans[0].body).toContain('who owes whom');
 expect(plans[0].body).not.toContain('10.00');
 expect(plans[0].body).not.toContain('Friend');
 expect(balanceReminders(notice!,new Date(2026,10,13))).toEqual([]);
});
test('stops reminders after settlement and ignores balances unrelated to the signed-in member',()=>{
 expect(balanceNotice({...group,settlements:[{id:'s',fromId:'me',toId:'friend',currency:'AUD',amountMinor:1000,occurredOn:'2026-11-05'}]},now)).toBeNull();
 expect(balanceNotice({...group,participants:group.participants.map(p=>({...p,isSelf:false}))},now)).toBeNull();
});
