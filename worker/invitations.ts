import { neon } from '@neondatabase/serverless';
import { sha256 } from './security';
export function invitations(url:string) {
  const sql=neon(url);
  return {
    async check(hash:string,key:string) {
      return (await sql`SELECT nestwise_auth.check_invitation(${hash},${key}) valid`)[0].valid as boolean;
    },
    async accept(hash:string,passwordHash:string) {
      return (await sql`SELECT nestwise_auth.accept_invitation(${hash},${passwordHash}) email`)[0].email as string;
    },
  };
}
export async function acceptInvitation(body:unknown,ip:string,secret:string,store:ReturnType<typeof invitations>) {
  if(!body || typeof body!=='object') return null;
  const {token,password}=body as Record<string,unknown>;
  if(typeof token!=='string' || !/^[0-9a-f]{64}$/.test(token) || typeof password!=='string'
    || password.length<12 || password.length>128) return null;
  const hash=await sha256(token);
  const key=await sha256(`${secret}:invitation:${ip}`);
  if(!await store.check(hash,key)) return null;
  const {hashPassword}=await import('better-auth/crypto');
  try {return await store.accept(hash,await hashPassword(password));}
  catch(error) {
    if(error instanceof Error && error.message==='invalid_invitation') return null;
    throw error;
  }
}
