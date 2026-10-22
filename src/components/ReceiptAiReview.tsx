import React,{useEffect,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {parseReceipt,type ReceiptData} from '../domain/receipt';
import {Button,Notice,styles} from './ui';

/** Recognition is a separate draft. Only an explicit Apply replaces the editor. */
export function ReceiptAiReview({path,ru,disabled,onApply,onBusy,onSessionExpired}:{path:string;ru:boolean;disabled:boolean;onApply:(data:ReceiptData)=>void;onBusy:(busy:boolean)=>void;onSessionExpired:()=>void}){
  const [enabled,setEnabled]=useState<boolean|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<ReceiptData|null>(null),[error,setError]=useState('');
  const sending=useRef(false);
  useEffect(()=>{let active=true;const controller=new AbortController();
    void authenticatedFetch(path,controller.signal).then(async response=>{
      if(response.status===401){onSessionExpired();return;}if(!response.ok)throw new Error();
      const value=await response.json();if(active)setEnabled(value.enabled===true);
    }).catch(()=>{if(active)setEnabled(false);});
    return()=>{active=false;controller.abort();};
  },[path,onSessionExpired]);
  async function recognize(){
    if(sending.current||disabled)return;sending.current=true;setBusy(true);onBusy(true);setError('');setConsent(false);
    try{
      const response=await authenticatedPost(path,{consent:true},undefined,70_000);
      if(response.status===401){onSessionExpired();return;}
      const value=await response.json();if(!response.ok)throw new Error(value.error);
      if(value.review_required!==true)throw new Error('ocr_incomplete');
      setResult(parseReceipt(value.data));
    }catch(e){const code=e instanceof Error?e.message:'';
      setError(code==='ocr_not_configured'?(ru?'Распознавание ещё не подключено. Доступен ручной ввод.':'Recognition is not connected yet. Manual entry is available.'):
        code==='ocr_rate_limited'?(ru?'Достигнут лимит распознавания. Запрос автоматически не повторяется.':'Recognition limit reached. The request is not retried automatically.'):
        code==='ocr_incomplete'?(ru?'Не удалось прочитать чек полностью. Используйте оригинал для ручного ввода.':'Could not read the receipt completely. Enter the details from the original.'):
        (ru?'Ответ распознавания не получен. Оплаченный запрос мог выполниться; автоматического повтора нет. Можно заполнить поля вручную.':'No recognition response received. The paid request may have completed; there is no automatic retry. You can enter details manually.'));
    }finally{sending.current=false;setBusy(false);onBusy(false);}
  }
  return <View style={{gap:8}}>
    <Text style={styles.h2}>{ru?'Распознавание чека':'Receipt recognition'}</Text>
    {enabled===null?<Text style={styles.muted}>{ru?'Проверка доступности…':'Checking availability…'}</Text>:!enabled?
      <Notice text={ru?'OpenAI ещё не подключён или временно недоступен. Заполните чек вручную.':'OpenAI is not connected or temporarily unavailable. Enter receipt details manually.'}/>:
      !result&&!consent&&<Button label={ru?'Распознать через OpenAI':'Recognize with OpenAI'} disabled={busy||disabled} onPress={()=>setConsent(true)}/>}
    {consent&&<>
      <Notice text={ru?'Выбранный оригинал целиком будет отправлен в OpenAI для распознавания. Это платный запрос. Данные API по умолчанию не используются для обучения; журналы безопасности могут храниться до 30 дней. Полученные суммы и дату нужно проверить.':'The entire selected original will be sent to OpenAI for a paid recognition request. API data is not used for training by default; safety logs may be retained for up to 30 days. Review the returned amounts and date.'}/>
      <Button primary label={ru?'Отправить этот чек в OpenAI':'Send this receipt to OpenAI'} disabled={busy||disabled} onPress={()=>void recognize()}/>
      <Button label={ru?'Продолжить вручную':'Continue manually'} onPress={()=>setConsent(false)}/>
    </>}
    {busy&&<Text accessibilityRole="alert" style={styles.muted}>{ru?'Распознаём… Это может занять около минуты.':'Recognizing… This can take about a minute.'}</Text>}
    {!!error&&<Notice error text={error}/>}
    {result&&<>
      <Notice text={ru?'Результат ИИ ещё не сохранён. Применение заменит текущие поля редактора. Пустые суммы оставлены неизвестными; сверяйте их с оригиналом. Дата чека не считается датой оплаты.':'AI result is not saved. Applying replaces the current editor fields. Empty amounts remain unknown; compare with the original. Receipt date is not assumed to be the payment date.'}/>
      <Text selectable style={styles.text}>{result.supplier||'—'} · {result.date||'—'} · {result.items.length} {ru?'позиций':'items'}</Text>
      <Text selectable style={styles.text}>{ru?'Итого':'Total'}: {result.total_cents===null?'—':`${BigInt(result.total_cents)/100n}.${(BigInt(result.total_cents)%100n).toString().padStart(2,'0')} USD`}</Text>
      <Button primary label={ru?'Применить к полям для проверки':'Apply to review fields'} disabled={disabled} onPress={()=>{onApply(result);setResult(null);}}/>
      <Button label={ru?'Отклонить результат':'Discard result'} disabled={disabled} onPress={()=>setResult(null)}/>
    </>}
  </View>;
}
