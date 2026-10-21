export const documentLimit=2_000_000;
export type ArchivedDocument={hash:string;bytes:number;created_at:string;uploaded_by:string;archived:boolean;linked_groups:number};
export function parseDocuments(value:unknown):ArchivedDocument[]{
  if(!Array.isArray(value)||value.length>100)throw new Error('invalid_documents');
  const seen=new Set<string>();
  for(const d of value){
    if(!d||typeof d!=='object'||typeof d.hash!=='string'||! /^[0-9a-f]{64}$/.test(d.hash)||seen.has(d.hash)
      ||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>documentLimit||typeof d.archived!=='boolean'
      ||typeof d.created_at!=='string'||!Number.isFinite(Date.parse(d.created_at))||typeof d.uploaded_by!=='string'
      ||!Number.isSafeInteger(d.linked_groups)||d.linked_groups<0)throw new Error('invalid_documents');
    seen.add(d.hash);
  }
  return value;
}
