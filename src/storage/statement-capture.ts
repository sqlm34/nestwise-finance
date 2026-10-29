import {Directory,File,Paths} from 'expo-file-system';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ReceiptFile} from '../receipt-file';
export type CapturedStatement={name:string;hash:string;mime:ReceiptFile['mime'];editor:string;queued:boolean};
async function id(scope:string){return digestStringAsync(CryptoDigestAlgorithm.SHA256,scope);}
const folder=()=>new Directory(Paths.document,'statement-capture-v1');
let tail:Promise<unknown>=Promise.resolve();
function serial<T>(f:()=>Promise<T>){const p=tail.then(f,f);tail=p.catch(()=>{});return p;}
export const statementCapture={
 async read(scope:string):Promise<CapturedStatement|null>{await tail;const raw=await AsyncStorage.getItem('statement-capture:'+await id(scope));return raw?JSON.parse(raw):null;},
 save(scope:string,value:CapturedStatement,file?:ReceiptFile,active=true){return serial(async()=>{const key=await id(scope);if(file){const dir=folder();dir.create({idempotent:true,intermediates:true});const dest=new File(dir,key+'-'+file.hash);if(!dest.exists){dest.create();dest.write(file.bytes);}const stored=await dest.bytes();if(stored.length!==file.bytes.length||stored.some((b,i)=>b!==file.bytes[i]))throw Error('capture_storage_failed');}await AsyncStorage.setItem('statement-capture-record:'+key+':'+value.hash,JSON.stringify(value));if(active)await AsyncStorage.setItem('statement-capture:'+key,JSON.stringify(value));});},
 async list(scope:string):Promise<CapturedStatement[]>{await tail;const prefix='statement-capture-record:'+await id(scope)+':';const keys=(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith(prefix));return (await AsyncStorage.multiGet(keys)).map(([,v])=>JSON.parse(v!) as CapturedStatement);},
 async bytes(scope:string,value:CapturedStatement){await tail;return new File(folder(),await id(scope)+'-'+value.hash).bytes();},
};
