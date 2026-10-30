export const APP_TIME_ZONE='America/Indiana/Indianapolis';
type Locale='en'|'ru';
export function localDateTime(value:string|number|Date,locale:Locale){
  return new Intl.DateTimeFormat(locale==='ru'?'ru-RU':'en-US',{timeZone:APP_TIME_ZONE,year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(value));
}
/** Calendar date in Indianapolis. Date-only business/document fields are already dates and are not converted. */
export function localToday(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:APP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
