export const memberRoles=['owner','member','accountant','reviewer'] as const;
export type WorkspaceCommand={id:string;action:'create_workspace'|'rename_workspace'|'create_account'|'rename_account'|'set_member'|'set_account_grant';
  target:string;name?:string;kind?:'family'|'personal'|'business';role?:typeof memberRoles[number];all_accounts?:boolean;account?:string;allowed?:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseWorkspaceCommand(value:unknown):WorkspaceCommand{
  const fail=():never=>{throw new Error('invalid_workspace_command');};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const r=value as Record<string,unknown>;
  if(typeof r.id!=='string'||!uuid.test(r.id)||typeof r.target!=='string'||!uuid.test(r.target))return fail();
  const base={id:r.id.toLowerCase(),target:r.target.toLowerCase()};
  const exact=(extra:string[])=>{const keys=['id','action','target',...extra];if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))fail();};
  const name=()=>{if(typeof r.name!=='string'||!r.name.trim()||r.name.trim().length>120||/[\u0000-\u001f\u007f]/.test(r.name))return fail();return r.name.trim();};
  switch(r.action){
    case 'create_workspace':exact(['name','kind']);if(!['family','personal','business'].includes(r.kind as string))return fail();return {...base,action:r.action,name:name(),kind:r.kind as WorkspaceCommand['kind']};
    case 'rename_workspace':case 'create_account':case 'rename_account':exact(['name']);return {...base,action:r.action,name:name()};
    case 'set_member':exact(['role','all_accounts']);if(!memberRoles.includes(r.role as typeof memberRoles[number])||typeof r.all_accounts!=='boolean')return fail();return {...base,action:r.action,role:r.role as WorkspaceCommand['role'],all_accounts:r.all_accounts};
    case 'set_account_grant':exact(['account','allowed']);if(typeof r.account!=='string'||!uuid.test(r.account)||typeof r.allowed!=='boolean')return fail();return {...base,action:r.action,account:r.account.toLowerCase(),allowed:r.allowed};
    default:return fail();
  }
}
