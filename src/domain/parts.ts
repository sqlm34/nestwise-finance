export type PartUse={id:string;job:string;quantity:number;used_on:string};
export type Part={id:string;revision:number;created_at:string;state:{name:string;quantity:number;unit_cents:string;paid_on:string|null;note:string;transaction:string|null;used:number;archived:boolean;uses:PartUse[]}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(v:unknown,max:number,min=0)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function parsePartsCommand(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_parts');
 const d=value as Record<string,unknown>,kind=d.kind;
 if(typeof d.id!=='string'||!uuid.test(d.id)||typeof d.lot!=='string'||!uuid.test(d.lot)||!Number.isInteger(d.expected_revision)||Number(d.expected_revision)<0||Number(d.expected_revision)>=1000)throw new Error('invalid_parts');
 let keys=['id','lot','kind','expected_revision'];
 if(kind==='create'){
  keys=keys.concat(['name','quantity','unit_cents','paid_on','note']);
  if(!text(d.name,120,1)||!text(d.note,500)||!Number.isInteger(d.quantity)||Number(d.quantity)<1||Number(d.quantity)>999999||typeof d.unit_cents!=='string'||!/^(0|[1-9][0-9]{0,11})$/.test(d.unit_cents)||BigInt(d.unit_cents)*BigInt(Number(d.quantity))>9007199254740991n||d.paid_on!==null&&!date(d.paid_on))throw new Error('invalid_parts');
 }else if(kind==='evidence'){
  keys=keys.concat(['transaction','paid_on','note']);
  if(d.transaction!==null&&(typeof d.transaction!=='string'||!uuid.test(d.transaction))||d.paid_on!==null&&!date(d.paid_on)||!text(d.note,500))throw new Error('invalid_parts');
 }else if(kind==='consume'||kind==='return'){
  keys=keys.concat(['quantity','job','used_on']);
  if(!Number.isInteger(d.quantity)||Number(d.quantity)<1||Number(d.quantity)>999999||!text(d.job,120,1)||!date(d.used_on))throw new Error('invalid_parts');
 }else if(kind!=='archive')throw new Error('invalid_parts');
 if(Object.keys(d).length!==keys.length||keys.some(k=>!(k in d)))throw new Error('invalid_parts');
 return d;
}
export function parseParts(value:unknown):Part[]{
 if(!Array.isArray(value)||value.length>1000)throw new Error('invalid_parts');
 const ids=new Set<string>();
 for(const p of value){
  if(!p||typeof p.id!=='string'||!uuid.test(p.id)||ids.has(p.id)||!Number.isInteger(p.revision)||p.revision<1||p.revision>1000||!p.state)throw new Error('invalid_parts');
  ids.add(p.id);const s=p.state;
  parsePartsCommand({id:p.id,lot:p.id,kind:'create',expected_revision:0,name:s.name,quantity:s.quantity,unit_cents:s.unit_cents,paid_on:s.paid_on,note:s.note});
  if(s.transaction!==null&&(typeof s.transaction!=='string'||!uuid.test(s.transaction))||!Number.isInteger(s.used)||s.used<0||s.used>s.quantity||typeof s.archived!=='boolean'||!Array.isArray(s.uses)||s.uses.length>999)throw new Error('invalid_parts');
  let used=0;for(const u of s.uses){if(!u||!uuid.test(u.id)||!text(u.job,120,1)||!Number.isInteger(u.quantity)||u.quantity===0||!date(u.used_on))throw new Error('invalid_parts');used+=u.quantity;}
  if(used!==s.used)throw new Error('invalid_parts');
 }
 return value;
}
