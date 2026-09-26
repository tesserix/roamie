import { expect, jest, test } from '@jest/globals';
import { Vibration } from 'react-native';
import { signalFeedback } from '../feedback';
test('vibration is opt-in and never repeats',()=>{
 const vibrate=jest.spyOn(Vibration,'vibrate').mockImplementation(()=>{});
 signalFeedback(false);
 expect(vibrate).not.toHaveBeenCalled();
 signalFeedback(true);
 expect(vibrate).toHaveBeenCalledWith(80,false);
 vibrate.mockRestore();
});
