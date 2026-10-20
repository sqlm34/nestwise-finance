import {Platform} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {File} from 'expo-file-system';
import * as Crypto from 'expo-crypto';
export async function readStatementFile(sample?:string):Promise<{name:string;text:string;hash:string}|null>{
  let cached:File|undefined;
  try{
    let name:string,bytes:Uint8Array;
    if(sample!==undefined){name='demo-reconciliation.csv';bytes=new TextEncoder().encode(sample);}
    else{
      const result=await DocumentPicker.getDocumentAsync({type:['text/csv','text/comma-separated-values','application/vnd.ms-excel','text/plain'],copyToCacheDirectory:true,base64:false});
      if(result.canceled)return null;
      const asset=result.assets[0];
      if(Platform.OS!=='web')cached=new File(asset.uri);
      if(!asset.name.toLowerCase().endsWith('.csv'))throw new Error('unsupportedFormat');
      if((asset.size??0)>2_000_000)throw new Error('fileTooLarge');
      name=asset.name;bytes=asset.file?new Uint8Array(await asset.file.arrayBuffer()):await cached!.bytes();
    }
    if(bytes.byteLength>2_000_000)throw new Error('fileTooLarge');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,Uint8Array.from(bytes));
    return {name,text,hash:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
  }finally{
    // Only the picker-created temporary cache copy, never the original document.
    if(cached?.exists)try{cached.delete();}catch{/* OS cache cleanup can race. */}
  }
}
