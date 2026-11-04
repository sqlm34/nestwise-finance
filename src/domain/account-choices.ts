import type {Access} from './live-navigation';
type Space=Access['workspaces'][number];
export function accountChoices(space:Space){
 const bank=(name:string)=>/^Chase(?:\s*·\s*\d{4})?$/.test(name)?'chase':/^Old National(?: Bank|\s*·\s*\d{4})?$/.test(name)?'old-national':null;
 const connected=new Set(space.accounts.filter(a=>/·\s*\d{4}$/.test(a.name)).map(a=>bank(a.name)).filter(Boolean));
 const older=space.kind==='personal'?space.accounts.filter(a=>bank(a.name)&&connected.has(bank(a.name))&&!/·\s*\d{4}$/.test(a.name)):[];
 return {primary:space.accounts.filter(a=>!older.includes(a)),older};
}
