import React,{useState} from 'react';
import {View} from 'react-native';
import {accountChoices} from '../domain/account-choices';
import type {Access,Selection} from '../domain/live-navigation';
import {Button,Notice} from './ui';
export function AccountChoices({space,selected,onSelect,ru,disabled=false}:{space:Access['workspaces'][number];selected:string|undefined;onSelect:(value:Selection)=>void;ru:boolean;disabled?:boolean}){
 const {primary,older}=accountChoices(space),[expanded,setExpanded]=useState(false);
 const rows=(accounts:typeof primary)=>accounts.map(a=><Button key={a.id} label={`${a.name} · ${a.currency}`} selected={selected===a.id} disabled={disabled} onPress={()=>onSelect({workspace:space.id,account:a.id,name:a.name,currency:a.currency})}/>);
 return <View style={{gap:8}}>{rows(primary)}{!!older.length&&<><Button label={ru?'Ранее сохранённые документы':'Previously saved documents'} selected={expanded} onPress={()=>setExpanded(v=>!v)}/>{(expanded||older.some(a=>a.id===selected))&&<><Notice text={ru?'Прежние счета сохранены для доступа к документам и очереди фото. Для новых покупок выбирайте счёт с последними четырьмя цифрами.':'Previous accounts retain documents and queued photos. For new purchases, select the account with the last four digits.'}/>{rows(older)}</>}</>}</View>;
}
