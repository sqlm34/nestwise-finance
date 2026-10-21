/** Bound waits without automatic retries: a timeout never means a write failed. */
export async function fetchWithDeadline(input:string,init:RequestInit={},timeoutMs=30_000,transport:typeof fetch=fetch):Promise<Response>{
 const controller=new AbortController(),external=init.signal;
 const abort=()=>controller.abort();
 if(external?.aborted)controller.abort();else external?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 try{return await transport(input,{...init,signal:controller.signal});}
 finally{clearTimeout(timer);external?.removeEventListener('abort',abort);}
}
