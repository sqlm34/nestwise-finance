import * as SecureStore from 'expo-secure-store';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {parseDraft,scopeKey,transitionDraft,type DraftStore} from '../domain/operation-draft';
// One native JS runtime; serialize read/modify/write even across remounted screens.
let tail:Promise<unknown>=Promise.resolve();
function exclusive<T>(work:()=>Promise<T>):Promise<T>{const result=tail.then(work,work);tail=result.catch(()=>{});return result;}
async function key(scope:Parameters<DraftStore['read']>[0]){return 'nestwise-draft-'+await digestStringAsync(CryptoDigestAlgorithm.SHA256,scopeKey(scope));}
export const operationDraftStore:DraftStore={
 read:scope=>exclusive(async()=>parseDraft(await SecureStore.getItemAsync(await key(scope)),scope)),
 change:(scope,action)=>exclusive(async()=>{
  const storageKey=await key(scope),raw=await SecureStore.getItemAsync(storageKey),next=transitionDraft(raw,scope,action);
  if(next===null)await SecureStore.deleteItemAsync(storageKey);else await SecureStore.setItemAsync(storageKey,next);
  return parseDraft(next,scope);
 }),
};
