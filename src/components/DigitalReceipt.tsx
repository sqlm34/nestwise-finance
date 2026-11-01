import React from 'react';
import {Pressable,Text,View} from 'react-native';
import type {ReceiptData} from '../domain/receipt';
import {receiptCategoryLabel,isBusinessCategory,type ReceiptCategory} from '../domain/receipt-classification';
import {exactUsd} from '../domain/exact-money';
import {colors,styles} from './ui';

export function DigitalReceipt({data,categories,ru,onCategory,disabled=false}:{data:ReceiptData;categories:ReceiptCategory[];ru:boolean;onCategory?:(index:number)=>void;disabled?:boolean}){
 const money=(n:string|null)=>n===null?'—':exactUsd(BigInt(n),ru?'ru':'en');
 return <View style={{alignSelf:'center',width:'100%',maxWidth:560,backgroundColor:'#fffdf7',borderWidth:1,borderColor:'#dedbd2',borderRadius:6,padding:16,gap:12}}>
  <Text accessibilityRole="header" style={[styles.h2,{textAlign:'center'}]}>{data.supplier|| (ru?'Чек / инвойс':'Receipt / invoice')}</Text>
  <Text style={[styles.muted,{textAlign:'center'}]}>{data.date||'—'} · USD</Text>
  <View style={{borderTopWidth:1,borderStyle:'dashed',borderColor:'#c8c5bc'}}/>
  {data.items.map((item,index)=><View key={index} style={{paddingVertical:8,borderBottomWidth:1,borderStyle:'dashed',borderColor:'#e4e0d7',gap:5}}>
   <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
    <View style={{flex:1,minWidth:0}}><Text style={[styles.text,{fontSize:14}]}>{item.description||'—'}</Text>
     <Text style={{fontSize:11,color:isBusinessCategory(categories[index])?colors.green:colors.muted,marginTop:5}}>{receiptCategoryLabel(categories[index]??null,ru)}{isBusinessCategory(categories[index])?' · Aksenov LLC':''}</Text>
    </View>
    <Text style={[styles.text,{fontSize:14,fontWeight:'600',textAlign:'right',paddingTop:10}]}>{money(item.cents)}</Text>
    {onCategory&&<Pressable accessibilityRole="button" accessibilityLabel={`${ru?'Категория позиции':'Item category'} ${index+1}: ${item.description}`} accessibilityState={{disabled}} disabled={disabled} onPress={()=>onCategory(index)} style={{width:44,height:44,alignItems:'center',justifyContent:'center',marginRight:-6}}><Text style={{fontSize:27,color:disabled?colors.muted:colors.green}}>⋯</Text></Pressable>}
   </View>
  </View>)}
  {([['tax_cents',ru?'Налог':'Tax'],['tip_cents',ru?'Чаевые':'Tip'],['shipping_cents',ru?'Доставка':'Shipping'],['discount_cents',ru?'Скидка':'Discount']] as const).filter(([key])=>data[key]===null||data[key]!=='0').map(([key,label])=><View key={key} style={{flexDirection:'row',justifyContent:'space-between',gap:10}}><Text style={styles.muted}>{label}</Text><Text style={styles.text}>{key==='discount_cents'&&data[key]!==null?'−':''}{money(data[key])}</Text></View>)}
  <View style={{borderTopWidth:2,borderColor:'#50695d',paddingTop:14,flexDirection:'row',justifyContent:'space-between',gap:10}}><Text style={[styles.h2,{fontSize:18}]}>{ru?'ИТОГО':'TOTAL'}</Text><Text style={[styles.h2,{fontSize:18}]}>{money(data.total_cents)}</Text></View>
 </View>;
}
