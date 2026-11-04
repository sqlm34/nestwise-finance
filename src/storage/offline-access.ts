import * as SecureStore from 'expo-secure-store';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {decodeOfflineAccess,encodeOfflineAccess} from '../domain/offline-access';
import type {Access} from '../domain/live-navigation';
const key=async(origin:string)=>'nestwise.local-capture.'+await digestStringAsync(CryptoDigestAlgorithm.SHA256,origin);
let writes:Promise<unknown>=Promise.resolve();
export function saveOfflineAccess(origin:string,access:Access|null){const next=writes.then(async()=>{const k=await key(origin);if(access)await SecureStore.setItemAsync(k,encodeOfflineAccess(origin,access));else await SecureStore.deleteItemAsync(k);});writes=next.catch(()=>{});return next;}
export async function readOfflineAccess(origin:string){await writes;return decodeOfflineAccess(await SecureStore.getItemAsync(await key(origin)),origin);}
