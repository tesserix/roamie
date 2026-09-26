import { expect, jest, test } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import * as AuthSession from 'expo-auth-session';
import SignIn from '../../components/sign-in';
import { AuthProvider } from '../auth';
import { session } from '../auth-client';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(async()=>null),deleteItemAsync:jest.fn(),setItemAsync:jest.fn()}));
jest.mock('expo-web-browser',()=>({maybeCompleteAuthSession:jest.fn()}));
jest.mock('expo-auth-session',()=>({fetchDiscoveryAsync:jest.fn(async()=>({})),AuthRequest:jest.fn(()=>({promptAsync:jest.fn(async()=>({type:'cancel'}))})),ResponseType:{Code:'code'},Prompt:{Login:'login'}}));
jest.mock('expo-router',()=>({useIsFocused:()=>false}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('@expo/vector-icons/FontAwesome',()=>({__esModule:true,default:()=>null}));
test('social icons keep provider names accessible and unavailable Facebook disabled',async()=>{
 await session.clear();
 global.fetch=jest.fn<typeof fetch>().mockResolvedValue({ok:true,json:async()=>({issuer:'https://auth.tesserix.app',organizationId:'org',projectId:'project',clientIds:{ios:'ios',android:'android'},providers:{google:'g',apple:'a'}})} as Response);
 await render(<AuthProvider><SignIn/></AuthProvider>);
 const google=await screen.findByRole('button',{name:'Continue with Google'});
 expect(google.props.accessibilityState.disabled).not.toBe(true);
 expect(screen.getByRole('button',{name:'Continue with Facebook'}).props.accessibilityState.disabled).toBe(true);
 expect(screen.getByText('Google')).toBeTruthy();
 expect(screen.getByText('Apple')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'Emergency help'}));
 expect(await screen.findByRole('button', {name: 'Back to sign-in'})).toBeTruthy();
});

test('Google launches the pinned HTTPS Zitadel endpoints with PKCE',async()=>{
 await session.clear();
 global.fetch=jest.fn<typeof fetch>().mockResolvedValue({ok:true,json:async()=>({issuer:'https://auth.tesserix.app',organizationId:'org',projectId:'project',clientIds:{ios:'ios',android:'android'},providers:{google:'g'}})} as Response);
 await render(<AuthProvider><SignIn/></AuthProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'Continue with Google'}));
 const request=jest.mocked(AuthSession.AuthRequest).mock.results.at(-1)?.value as {promptAsync:ReturnType<typeof jest.fn>};
 expect(request.promptAsync).toHaveBeenCalledWith(expect.objectContaining({authorizationEndpoint:'https://auth.tesserix.app/oauth/v2/authorize',tokenEndpoint:'https://auth.tesserix.app/oauth/v2/token'}));
 expect(AuthSession.AuthRequest).toHaveBeenCalledWith(expect.objectContaining({usePKCE:true,redirectUri:'roamie:/auth/callback',responseType:'code'}));
});
