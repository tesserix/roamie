import {beforeEach, expect, jest, test} from '@jest/globals';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {LanguagePicker} from '../../components/language-picker';
const mockStatus = jest.fn(async () => ({online:false,wifi:false,supported:['en','hi','fr','de','ja'],downloaded:['en','hi','fr','de','ja']}));
jest.mock('expo',()=>({...jest.requireActual<Record<string,unknown>>('expo'),requireOptionalNativeModule:()=>({status:mockStatus})}));
beforeEach(()=>{mockStatus.mockResolvedValue({online:false,wifi:false,supported:['en','hi','fr','de','ja'],downloaded:['en','hi','fr','de','ja']});});
test('offline translation picker shows all five downloaded languages and no automatic or undownloaded choice',async()=>{
 const pick=jest.fn();
 await render(<LanguagePicker visible title="Your language" selected="en" allowAuto onPick={pick} onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('Hindi')).toBeTruthy());
 for(const name of ['English','French','German','Japanese']) expect(screen.getByText(name)).toBeTruthy();
 for(const name of ['Auto-detect','Spanish','Odia']) expect(screen.queryByText(name)).toBeNull();
 await fireEvent.press(screen.getByText('Hindi'));expect(pick).toHaveBeenCalledWith('hi');
});
test('online translation keeps its complete catalogue',async()=>{
 mockStatus.mockResolvedValue({online:true,wifi:true,supported:['en','hi'],downloaded:['en','hi']});
 await render(<LanguagePicker visible title="Language" selected="en" allowAuto onPick={()=>{}} onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('Auto-detect')).toBeTruthy());
 await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Odia');
 expect(screen.getByText('Odia')).toBeTruthy();
});
test('empty offline inventory explains how to download instead of offering unusable languages',async()=>{
 mockStatus.mockResolvedValue({online:false,wifi:false,supported:['en','hi'],downloaded:[]});
 await render(<LanguagePicker visible title="Language" selected="en" onPick={()=>{}} onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('No downloaded languages. Open Offline languages while connected to download packs.')).toBeTruthy());
 expect(screen.queryByText('English')).toBeNull();
});

test('download catalogue includes native languages outside the online app list', async () => {
 await render(<LanguagePicker visible title="Download languages" selected="" catalogue multiple availableCodes={['en','hi','gu','kn']} onPick={()=>{}} onClose={()=>{}}/>);
 expect(screen.getByText('Gujarati')).toBeTruthy();
 expect(screen.getByText('Kannada')).toBeTruthy();
});

test('download catalogue marks installed packs and prevents selecting a sixth total language', async () => {
 const pick = jest.fn();
 await render(<LanguagePicker visible title="Download languages" selected="" catalogue multiple availableCodes={['en','hi','fr','de','ja','gu']} downloadedCodes={['en','hi']} selectedCodes={['fr','de','ja']} maxDownloads={5} onPick={pick} onClose={()=>{}}/>);
 await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Gujarati');
 await fireEvent.press(screen.getByRole('checkbox', {name:'Gujarati'}));
 expect(pick).not.toHaveBeenCalled();
 await fireEvent.changeText(screen.getByLabelText('Search languages'), 'English');
 expect(screen.getByRole('checkbox', {name:'English, downloaded'}).props.accessibilityState.disabled).toBe(true);
});
