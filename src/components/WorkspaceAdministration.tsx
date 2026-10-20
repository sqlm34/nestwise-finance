import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {parseWorkspaceCommand,memberRoles,type WorkspaceCommand} from '../domain/workspace-admin';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
type AdminData={actor:string;workspace:{id:string;name:string};accounts:{id:string;name:string}[];
  members:{user_id:string;name?:string|null;role:typeof memberRoles[number];all_accounts:boolean;account_ids:string[]}[];
  audit:{id:string;recorded_at:string;payload:WorkspaceCommand}[]};
const roles={owner:['Owner','Владелец'],member:['Member','Участник'],accountant:['Accountant','Бухгалтер'],reviewer:['Reviewer','Наблюдатель']} as const;
export function WorkspaceAdministration({workspace,onChanged,onSessionExpired}:{workspace:string|null;onChanged:()=>void;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [data,setData]=useState<AdminData|null>(null),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[kind,setKind]=useState<'family'|'personal'|'business'>('family');
  const [memberEmail,setMemberEmail]=useState(''),[memberRole,setMemberRole]=useState<typeof memberRoles[number]>('reviewer'),[memberAll,setMemberAll]=useState(false);
  const [draft,setDraft]=useState<{payload:WorkspaceCommand;label:string;workspace:string}|null>(null);
  const [retryOnly,setRetryOnly]=useState(false);
  const pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!workspace)return;const controller=new AbortController();let active=true;
    (async()=>{try{const r=await authenticatedFetch(`/v1/user/workspaces/${workspace}/administration`,controller.signal);
      if(!active)return;if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();
      const value=await r.json();if(!Array.isArray(value.accounts)||!Array.isArray(value.members)||!Array.isArray(value.audit)||value.workspace?.id!==workspace)throw new Error();
      if(active){setData(value);setError('');}
    }catch{if(active)setError(ru?'Не удалось загрузить настройки.':'Could not load settings.');}})();
    return()=>{active=false;controller.abort();};
  },[workspace,revision,onSessionExpired,ru]);
  function prepare(payload:WorkspaceCommand,label:string,targetWorkspace=workspace){
    setError('');try{setDraft({payload:parseWorkspaceCommand(payload),label,workspace:targetWorkspace!});}
    catch{setError(ru?'Введите название от 1 до 120 символов.':'Enter a name between 1 and 120 characters.');}
  }
  async function save(){
    if(!draft||pending.current)return;pending.current=true;setBusy(true);setError('');setRetryOnly(true);
    try{const r=await authenticatedPost(`/v1/user/workspaces/${draft.workspace}/administration`,draft.payload);
      if(!alive.current)return;if(r.status===401){onSessionExpired();return;}
      const value=await r.json();if(r.status>=400&&r.status<500)setRetryOnly(false);if(!r.ok){setError(value.error==='member_unavailable'?(ru?'Нужен уже активированный аккаунт Nestwise с этой почтой.':'An activated Nestwise account with this email is required.'):value.error==='last_workspace_owner'?(ru?'В пространстве должен оставаться хотя бы один владелец.':'At least one owner must remain.'):(ru?'Изменение не подтверждено. Проверьте доступ и повторите запрос.':'Change is not confirmed. Check access and retry.'));return;}
      if(value.id!==draft.payload.id)throw new Error();setRetryOnly(false);setDraft(null);setName('');setRevision(v=>v+1);onChanged();
    }catch{if(alive.current)setError(ru?'Нет подтверждения. Повторите этот же запрос.':'No confirmation received. Retry this same request.');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  return <Card><Text accessibilityRole="header" style={styles.h2}>{ru?'Настройки пространства':'Workspace settings'}</Text>
    {!!error&&<Notice error text={error}/>}{busy&&<ActivityIndicator/>}
    {draft?<>
      <Text style={styles.h2}>{draft.label}</Text>
      <Notice text={ru?'Изменения доступа применяются сразу и сохраняются в истории.':'Access changes take effect immediately and are retained in history.'}/>
      <Button primary label={ru?'Подтвердить изменение':'Confirm change'} disabled={busy} onPress={()=>void save()}/>
      <Button label={ru?'Отмена':'Cancel'} disabled={busy||retryOnly} onPress={()=>setDraft(null)}/>
    </>:<>
      <TextInput accessibilityLabel={ru?'Название пространства или счёта':'Workspace or account name'} placeholder={ru?'Название':'Name'} style={styles.input} value={name} onChangeText={setName} maxLength={120}/>
      {!workspace?<>
        <View style={styles.row}>{(['family','personal','business'] as const).map((k,i)=><Button key={k} selected={kind===k} label={(ru?['Семья','Личное','Бизнес']:['Family','Personal','Business'])[i]} onPress={()=>setKind(k)}/>)}</View>
        <Button label={ru?'Создать пространство':'Create workspace'} onPress={()=>{const id=randomUUID();prepare({id:randomUUID(),action:'create_workspace',target:id,name,kind},`${ru?'Создать':'Create'}: ${name}`,id);}}/>
      </>:<>
        <Button label={ru?'Добавить счёт':'Add account'} onPress={()=>prepare({id:randomUUID(),action:'create_account',target:randomUUID(),name},`${ru?'Добавить счёт':'Add account'}: ${name}`)}/>
        <Button label={ru?'Переименовать пространство':'Rename workspace'} onPress={()=>prepare({id:randomUUID(),action:'rename_workspace',target:workspace,name},`${data?.workspace.name} → ${name}`)}/>
        {data?.accounts.map(a=><Button key={a.id} label={`${ru?'Переименовать':'Rename'}: ${a.name}`} onPress={()=>prepare({id:randomUUID(),action:'rename_account',target:a.id,name},`${a.name} → ${name}`)}/>)}
        <Text accessibilityRole="header" style={styles.h2}>{ru?'Добавить пользователя Nestwise':'Add a Nestwise user'}</Text>
        <Notice text={ru?'У пользователя должен быть активированный аккаунт. Письмо не отправляется. Если доступ ко всем счетам выключен, назначьте нужные счета после добавления.':'The user must have an activated account. No email is sent. If access to all accounts is off, assign selected accounts after adding the user.'}/>
        <TextInput accessibilityLabel={ru?'Почта участника':'Member email'} placeholder={ru?'Электронная почта':'Email'} style={styles.input} value={memberEmail} onChangeText={setMemberEmail} maxLength={254} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"/>
        <View style={styles.row}>{memberRoles.map(role=><Button key={role} label={roles[role][ru?1:0]} selected={memberRole===role} onPress={()=>setMemberRole(role)}/>)}</View>
        <Button selected={memberAll} label={ru?'Доступ ко всем счетам':'Access to all accounts'} onPress={()=>setMemberAll(v=>!v)}/>
        <Button label={ru?'Проверить предоставляемый доступ':'Review access grant'} onPress={()=>prepare({id:randomUUID(),action:'add_member',target:workspace,email:memberEmail,role:memberRole,all_accounts:memberAll},`${memberEmail} · ${roles[memberRole][ru?1:0]} · ${memberAll?(ru?'Все счета':'All accounts'):(ru?'Счета пока не назначены':'No accounts assigned yet')}`)}/>
        {data?.members.map(m=><View key={m.user_id} style={{gap:8}}>
          <Text selectable style={styles.text}>{m.user_id===data.actor?(ru?'Вы':'You'):m.name||m.user_id} · {roles[m.role][ru?1:0]}</Text>
          <View style={styles.row}>{memberRoles.map(role=><Button key={role} selected={m.role===role} label={roles[role][ru?1:0]} onPress={()=>prepare({id:randomUUID(),action:'set_member',target:m.user_id,role,all_accounts:m.all_accounts},`${m.user_id}: ${roles[role][ru?1:0]}`)}/>)}</View>
          <Button label={m.all_accounts?(ru?'Ограничить выбранными счетами':'Limit to selected accounts'):(ru?'Предоставить все счета':'Grant all accounts')} onPress={()=>prepare({id:randomUUID(),action:'set_member',target:m.user_id,role:m.role,all_accounts:!m.all_accounts},`${m.user_id}: ${m.all_accounts?(ru?'Выбранные счета':'Selected accounts'):(ru?'Все счета':'All accounts')}`)}/>
          {!m.all_accounts&&data.accounts.map(a=><Button key={a.id} selected={m.account_ids.includes(a.id)} label={a.name} onPress={()=>prepare({id:randomUUID(),action:'set_account_grant',target:m.user_id,account:a.id,allowed:!m.account_ids.includes(a.id)},`${m.user_id}: ${m.account_ids.includes(a.id)?(ru?'Убрать доступ':'Remove access'):(ru?'Дать доступ':'Grant access')} · ${a.name}`)}/>)}
        </View>)}
        <Text style={styles.h2}>{ru?'Последние 50 изменений':'Latest 50 changes'}</Text>
        {data?.audit.map(a=><Text key={a.id} style={styles.muted}>{a.recorded_at} · {a.payload.name||a.payload.action}</Text>)}
      </>}
    </>}
  </Card>;
}
