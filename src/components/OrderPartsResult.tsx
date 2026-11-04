import React from 'react';
import {Text,View} from 'react-native';
import {styles,colors} from './ui';
import {useApp} from '../state';
import {exactUsd} from '../domain/exact-money';
import {orderAfterParts,type OrderResult} from '../domain/order-result';
export function OrderPartsResult({value}:{value:OrderResult}) {
  const {locale}=useApp(),ru=locale==='ru';
  const money=(value:string|bigint)=>exactUsd(BigInt(value),locale);
  return <View style={{gap:5,padding:12,borderRadius:10,backgroundColor:colors.pale}}>
    <Text style={[styles.text,{fontWeight:'700'}]}>{ru?'По заказу за всё время':'Whole order · all dates'}</Text>
    <Text style={styles.text}>{ru?'Получено от клиента':'Received from customer'}: {money(value.received_cents)}</Text>
    {value.refunds_cents!=='0'&&<Text style={styles.text}>{ru?'Возвращено клиенту':'Refunded to customer'}: {money(value.refunds_cents)}</Text>}
    <Text style={styles.text}>{ru?'Куплено запчастей для заказа':'Parts purchased for this order'}: {money(value.purchased_parts_cents)}</Text>
    <Text style={styles.text}>{ru?'Использовано со склада':'Parts used from stock'}: {money(value.stock_parts_cents)}</Text>
    <Text style={[styles.text,{fontWeight:'700'}]}>{ru?'Осталось после запчастей':'Remaining after parts'}: {money(orderAfterParts(value))}</Text>
    <Text style={[styles.muted,{fontSize:11}]}>{ru?'Складские детали оплачены раньше — повторно деньги не списываются. Результат до комиссий и остальных расходов.':'Stock parts were paid for earlier — no second cash charge. Before fees and other expenses.'}</Text>
  </View>;
}
