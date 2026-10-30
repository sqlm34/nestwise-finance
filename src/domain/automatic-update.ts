type UpdateState={canApply:boolean;pending:boolean;checking:boolean;downloading:boolean;foreground:boolean;keyboard:boolean};
type UpdateDriver={state:()=>UpdateState;check:()=>Promise<{isAvailable:boolean}>;download:()=>Promise<unknown>;reload:()=>Promise<void>;now:()=>number};
export function automaticUpdate(driver:UpdateDriver){
  let active=true,busy=false,reloading=false,lastCheck=-Infinity,lastApply=-Infinity;
  async function check(){
    const state=driver.state();
    if(!active||busy||!state.foreground||state.checking||state.downloading||state.pending||driver.now()-lastCheck<300_000)return;
    busy=true;lastCheck=driver.now();
    try{const result=await driver.check();if(active&&result.isAvailable)await driver.download();}catch{/* Retry later; keep the working version. */}finally{busy=false;}
  }
  async function apply(){
    const state=driver.state();
    if(!active||reloading||!state.canApply||!state.pending||!state.foreground||state.keyboard||driver.now()-lastApply<60_000)return;
    reloading=true;lastApply=driver.now();
    try{await driver.reload();}catch{reloading=false;}
  }
  return {check,apply,stop(){active=false;}};
}
