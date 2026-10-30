import {Platform} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {File,Paths} from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import {receiptMime} from './domain/receipt';
export type ReceiptFile={name:string;bytes:Uint8Array;mime:ReturnType<typeof receiptMime>;hash:string};
async function receiptFile(name:string,bytes:Uint8Array):Promise<ReceiptFile>{
  const mime=receiptMime(bytes);
  const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,Uint8Array.from(bytes));
  return {name,bytes,mime,hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}
export async function readReceiptFile(pdfOnly=false){
  let cached:File|undefined;
  try{
    const result=await DocumentPicker.getDocumentAsync({type:pdfOnly?['application/pdf']:['image/jpeg','image/png','image/webp','application/pdf'],copyToCacheDirectory:true,base64:false});
    if(result.canceled)return null;const asset=result.assets[0];
    if(Platform.OS!=='web')cached=new File(asset.uri);
    if((asset.size??0)>5_000_000)throw new Error('fileTooLarge');
    const bytes=asset.file?new Uint8Array(await asset.file.arrayBuffer()):await cached!.bytes();
    const file=await receiptFile(asset.name,bytes);if(pdfOnly&&file.mime!=='application/pdf')throw new Error('unsupportedFormat');return file;
  }finally{if(cached?.exists)try{cached.delete();}catch{/* Picker cache only. */}}
}
export async function captureReceipt(recover=false):Promise<ReceiptFile|null>{
  if(!recover&&Platform.OS!=='web'&&!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw new Error('camera_permission');
  const result=recover?await ImagePicker.getPendingResultAsync():await ImagePicker.launchCameraAsync({mediaTypes:['images'],allowsEditing:false,quality:1,exif:false});
  if(!result)return null;
  if('code' in result)throw new Error('camera_failed');
  if(result.canceled)return null;
  const asset=result.assets[0];
  if((asset.fileSize??0)>5_000_000)throw new Error('fileTooLarge');
  // ImagePicker owns this temporary capture; never remove an arbitrary user document.
  const cached=Platform.OS==='web'?null:new File(asset.uri);
  try{return await receiptFile(asset.fileName||'receipt-photo',asset.file?new Uint8Array(await asset.file.arrayBuffer()):await cached!.bytes());}
  finally{if(cached?.uri.startsWith(Paths.cache.uri)&&cached.exists)try{cached.delete();}catch{/* Cache cleanup is best effort. */}}
}
export async function saveReceiptOriginal(bytes:Uint8Array,expectedHash:string){
  const file=await receiptFile('original',bytes);
  if(file.hash!==expectedHash)throw new Error('original_mismatch');
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.mime];
  const name=`nestwise-receipt-${file.hash}.${ext}`;
  if(Platform.OS==='web'){
    const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:file.mime}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60_000);return;
  }
  if(!await Sharing.isAvailableAsync())throw new Error('sharing_unavailable');
  const cached=new File(Paths.cache,`${Crypto.randomUUID()}-${name}`);
  try{cached.create();cached.write(bytes);await Sharing.shareAsync(cached.uri,{mimeType:file.mime});}
  finally{if(cached.exists)try{cached.delete();}catch{/* Only the unique file created above. */}}
}
