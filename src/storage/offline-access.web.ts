import type {Access} from '../domain/live-navigation';
// Browser cold starts require the hosted app. Native installations support local launch.
export async function saveOfflineAccess(_origin:string,_access:Access|null):Promise<void>{}
export async function readOfflineAccess(_origin:string):Promise<Access|null>{return null;}
