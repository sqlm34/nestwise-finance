import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {captureReceipt,readReceiptFile,type ReceiptFile} from '../receipt-file';
import {receiptQueueStore} from '../storage/receipt-queue';
import {scopeKey,type DraftScope} from '../domain/operation-draft';
import {Button,Card,Notice,styles} from './ui';
let noteWrites:Promise<unknown>=Promise.resolve();
export function LocalReceiptNote({scope,ru}:{scope:DraftScope;ru:boolean}){
 const key='nestwise.capture-note.v1:'+scopeKey(scope),[note,setNote]=useState(''),[ready,setReady]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState(false);const generation=useRef(0);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true;void noteWrites.then(()=>AsyncStorage.getItem(key)).then(v=>{if(active){setNote(v||'');setReady(true);setSaved(true);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[key]);
 function change(value:string){const revision=++generation.current;setNote(value);setSaved(false);const next=noteWrites.then(()=>AsyncStorage.setItem(key,value));noteWrites=next.catch(()=>{});void next.then(()=>{if(alive.current&&generation.current===revision){setSaved(true);setError(false);}}).catch(()=>{if(alive.current)setError(true);});}
 return <View style={{gap:8}}><Text style={styles.label}>{ru?'Заметка к покупкам на этом устройстве':'Purchase notes on this device'}</Text>
 <TextInput accessibilityLabel={ru?'Продавец, дата, сумма и позиции':'Merchant, date, amount and items'} multiline maxLength={10000} editable={ready} value={note} onChangeText={change} placeholder={ru?'Продавец, дата, сумма, позиции. После подключения перенесите данные в чек.':'Merchant, date, amount, items. Enter these details in the receipt when connected.'} style={[styles.input,{minHeight:90}]}/>
 <Notice text={error?(ru?'Заметка не сохранена. Не закрывайте экран.':'Note not saved. Keep this screen open.'):saved?(ru?'Заметка сохранена только на устройстве. Расход не создан.':'Note saved on this device only. No expense created.'):(ru?'Сохраняем заметку…':'Saving note…')} error={error}/></View>;
}
export function LocalReceiptCapture({origin,user,workspace,account,ru}:{origin:string;user:string;workspace:string;account:string;ru:boolean}){
 const scope=useMemo(()=>({origin,user,workspace,account}),[origin,user,workspace,account]);
 const [rows,setRows]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false);
 useEffect(()=>{let active=true;void receiptQueueStore.list(scope).then(v=>{if(active)setRows(v.map(r=>r.name));}).catch(()=>{if(active)setError(ru?'Не удалось прочитать сохранённые фото.':'Could not read saved photos.');});return()=>{active=false;};},[scope,ru]);
 async function add(pick:()=>Promise<ReceiptFile|null>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const file=await pick();if(!file)return;await receiptQueueStore.put({scope,hash:file.hash,name:file.name,bytes:file.bytes,created:new Date().toISOString()});setRows((await receiptQueueStore.list(scope)).map(r=>r.name));}catch{setError(ru?'Не удалось сохранить фото. Проверьте разрешение камеры, свободное место и размер файла (до 5 МБ).':'Could not save photo. Check camera permission, storage and file size (up to 5 MB).');}finally{lock.current=false;setBusy(false);}}
 return <Card><Text style={styles.h2}>{ru?'Чеки без интернета':'Offline receipts'}</Text><Notice text={ru?'Фото сохраняются на этом устройстве. После подключения и проверки входа откройте «Чеки» этого счёта для отправки. Распознавание и расходы требуют интернета и подтверждения.':'Photos stay on this device. After reconnecting and verifying sign-in, open this account’s Receipts to upload. Recognition and expenses require connectivity and confirmation.'}/>
 <Button label={ru?'Сфотографировать чек':'Photograph receipt'} disabled={busy} onPress={()=>void add(()=>captureReceipt())}/><Button label={ru?'Выбрать фото или PDF':'Choose photo or PDF'} disabled={busy} onPress={()=>void add(()=>readReceiptFile())}/>
 {!!error&&<Notice error text={error}/>}<Text style={styles.text}>{ru?'Сохранено фото':'Saved photos'}: {rows.length}</Text>{rows.map((name,i)=><Text key={i} style={styles.muted}>{name}</Text>)}
 <LocalReceiptNote key={scopeKey(scope)} scope={scope} ru={ru}/></Card>;
}
