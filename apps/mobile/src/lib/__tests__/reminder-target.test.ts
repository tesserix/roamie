import {expect,test} from '@jest/globals';
import {reminderTripTarget,reminderGroupTarget} from '../reminder-target';
test('only opens a known trip belonging to the signed-in account',()=>{
 const data={kind:'trip-reminder',accountId:'a',tripId:'trip'};
 expect(reminderTripTarget(data,'a',[{id:'trip'}])).toBe('trip');
 expect(reminderTripTarget(data,'b',[{id:'trip'}])).toBeNull();
 expect(reminderTripTarget(data,'a',[])).toBeNull();
 expect(reminderTripTarget({...data,kind:'other'},'a',[{id:'trip'}])).toBeNull();
 expect(reminderTripTarget({url:'https://attacker.test'},'a',[])).toBeNull();
 expect(reminderTripTarget(null,'a',[])).toBeNull();
});

test('only opens a previously validated group for the active account',()=>{
 const data={kind:'group-reminder',accountId:'a',groupId:'group'};
 expect(reminderGroupTarget(data,'a',['group'])).toBe('group');
 expect(reminderGroupTarget(data,'b',['group'])).toBeNull();
 expect(reminderGroupTarget(data,'a',[])).toBeNull();
 expect(reminderGroupTarget({...data,kind:'trip-reminder'},'a',['group'])).toBeNull();
});
