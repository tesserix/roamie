import {beforeEach, expect, jest, test} from '@jest/globals';
import {SpeechRecorder} from '../speech-recorder';
let frame: (event: {id: string; speech: boolean; metering: number}) => void;
const mockNative = {speechDetection: true,startCapture: jest.fn<(id: string) => Promise<void>>().mockResolvedValue(), stopCapture: jest.fn<() => Promise<{uri: string}>>().mockResolvedValue({uri:'file:///speech.wav'}), addListener: jest.fn((_event: string, listener: typeof frame) => {frame=listener;return {remove:jest.fn()};})};
jest.mock('expo', () => ({requireOptionalNativeModule: () => mockNative}));
const legacy = {uri:'file:///legacy.m4a',prepareToRecordAsync:jest.fn<() => Promise<void>>().mockResolvedValue(),record:jest.fn(),stop:jest.fn<() => Promise<void>>().mockResolvedValue(),getStatus:()=>({isRecording:false,durationMillis:0,metering:-60,mediaServicesDidReset:false})};
beforeEach(()=>{jest.clearAllMocks();});
test('publishes speech decisions and the recorded WAV without starting a second microphone',async()=>{
 const recorder=new SpeechRecorder(legacy);
 await recorder.prepareToRecordAsync({} as never);
 recorder.record();
 await Promise.resolve();
 const id=mockNative.startCapture.mock.calls[0][0];
 frame({id,speech:false,metering:-25});
 expect(recorder.getStatus()).toMatchObject({isRecording:true,speech:false,metering:-25});
 frame({id,speech:true,metering:-20});
 expect(recorder.getStatus().speech).toBe(true);
 await recorder.stop();
 expect(recorder.uri).toBe('file:///speech.wav');
 expect(recorder.mimeType).toBe('audio/wav');
 expect(legacy.record).not.toHaveBeenCalled();
});
test('stopping while mockNative start is pending waits and then stops capture',async()=>{
 let started!:()=>void;
 mockNative.startCapture.mockImplementationOnce(()=>new Promise<void>(resolve=>{started=resolve;}));
 const recorder=new SpeechRecorder(legacy);
 await recorder.prepareToRecordAsync({} as never);recorder.record();
 const stop=recorder.stop();
 expect(mockNative.stopCapture).not.toHaveBeenCalled();
 started();await stop;
 expect(mockNative.stopCapture).toHaveBeenCalledTimes(1);
 expect(recorder.getStatus().isRecording).toBe(false);
});

test('ignores stale microphone events from an earlier capture',async()=>{
 const recorder=new SpeechRecorder(legacy);
 await recorder.prepareToRecordAsync({} as never);recorder.record();await Promise.resolve();
 const oldId=mockNative.startCapture.mock.calls[0][0];await recorder.stop();
 await recorder.prepareToRecordAsync({} as never);recorder.record();await Promise.resolve();
 frame({id:oldId,speech:true,metering:-10});
 expect(recorder.getStatus().speech).toBe(false);
 await recorder.stop();
});
test('retains the original recorder when a native build lacks speech detection',async()=>{
 mockNative.speechDetection=false;
 try {
  const recorder=new SpeechRecorder(legacy);
  await recorder.prepareToRecordAsync({} as never);recorder.record();await recorder.stop();
  expect(legacy.record).toHaveBeenCalledTimes(1);
  expect(recorder.uri).toBe('file:///legacy.m4a');
  expect(recorder.mimeType).toBe('audio/mp4');
  expect(recorder.getStatus().speech).toBeUndefined();
 } finally {mockNative.speechDetection=true;}
});

test('record resolves only when native microphone startup has completed',async()=>{
 let ready!:()=>void;
 mockNative.startCapture.mockImplementationOnce(()=>new Promise<void>(resolve=>{ready=resolve;}));
 const recorder=new SpeechRecorder(legacy);
 await recorder.prepareToRecordAsync({} as never);
 let completed=false;
 const starting=Promise.resolve(recorder.record()).then(()=>{completed=true;});
 await Promise.resolve();
 expect(completed).toBe(false);
 ready();await starting;
 expect(completed).toBe(true);
 await recorder.stop();
});

test('failed native startup reaches the caller and can still be stopped',async()=>{
 mockNative.startCapture.mockRejectedValueOnce(new Error('device unavailable'));
 const recorder=new SpeechRecorder(legacy);
 await recorder.prepareToRecordAsync({} as never);
 await expect(Promise.resolve().then(()=>recorder.record())).rejects.toThrow('Microphone could not start');
 expect(recorder.getStatus().mediaServicesDidReset).toBe(true);
 await recorder.stop();
 expect(mockNative.stopCapture).toHaveBeenCalledTimes(1);
});
