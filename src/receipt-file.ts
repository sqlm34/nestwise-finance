import {Platform} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {File} from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {receiptMime} from './domain/receipt';
export async function readReceiptFile(){
  let cached:File|undefined;
  try{
    const result=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','image/webp','application/pdf'],copyToCacheDirectory:true,base64:false});
    if(result.canceled)return null;const asset=result.assets[0];
    if(Platform.OS!=='web')cached=new File(asset.uri);
    if((asset.size??0)>5_000_000)throw new Error('fileTooLarge');
    const bytes=asset.file?new Uint8Array(await asset.file.arrayBuffer()):await cached!.bytes(),mime=receiptMime(bytes);
    const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,Uint8Array.from(bytes));
    return {name:asset.name,bytes,mime,hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
  }finally{if(cached?.exists)try{cached.delete();}catch{/* Picker cache only. */}}
}
