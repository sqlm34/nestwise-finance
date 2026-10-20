import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const configuredURL=process.env.EXPO_PUBLIC_API_URL ?? '';
export const apiURL=(() => {
  try {
    const url=new URL(configuredURL);
    const loopback=['localhost','127.0.0.1'].includes(url.hostname);
    if(url.origin!==configuredURL || (url.protocol!=='https:' && !(loopback && __DEV__))) return '';
    return url.origin;
  } catch {return '';}
})();
const scheme=Constants.expoConfig?.scheme;
export const authClient=createAuthClient({
  baseURL:apiURL || 'https://unconfigured.invalid',
  plugins: Platform.OS==='web' ? [] : [expoClient({
    scheme:typeof scheme==='string'?scheme:'nestwise-development',
    storagePrefix:'nestwise-auth',storage:SecureStore,
  })],
});
export async function authenticatedFetch(path: string, signal?: AbortSignal) {
  if(!apiURL) throw new Error('unconfigured');
  // Native cookies live in SecureStore; web cookies remain HttpOnly.
  const cookie=Platform.OS==='web'?'':await authClient.getCookie();
  return fetch(`${apiURL}${path}`,{
    credentials:'include',signal,headers:cookie?{Cookie:cookie}:{},
  });
}
export async function authenticatedPost(path:string,body:unknown,signal?:AbortSignal){
  if(!apiURL)throw new Error('unconfigured');
  const cookie=Platform.OS==='web'?'':await authClient.getCookie();
  return fetch(`${apiURL}${path}`,{method:'POST',credentials:'include',signal,
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie,'Expo-Origin':`${typeof scheme==='string'?scheme:'nestwise-development'}://`}:{})},body:JSON.stringify(body)});
}

export async function authenticatedUpload(path:string,bytes:Uint8Array,contentType='text/csv'){
  if(!apiURL)throw new Error('unconfigured');
  const cookie=Platform.OS==='web'?'':await authClient.getCookie();
  return fetch(apiURL+path,{method:'POST',credentials:'include',headers:{'Content-Type':contentType,...(cookie?{Cookie:cookie,'Expo-Origin':`${typeof scheme==='string'?scheme:'nestwise-development'}://`}:{})},body:Uint8Array.from(bytes)});
}
