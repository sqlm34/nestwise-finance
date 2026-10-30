import {AppState,Platform} from 'react-native';

export function isForeground(){
  return Platform.OS==='web'?typeof document!=='undefined'&&document.visibilityState==='visible':AppState.currentState==='active';
}
/** Callers own cancellation and prevent overlapping requests. */
export function onForegroundRefresh(refresh:()=>void,interval=5000){
  const tick=()=>{if(isForeground())refresh();};
  const timer=setInterval(tick,interval);
  if(Platform.OS==='web'){
    document.addEventListener('visibilitychange',tick);window.addEventListener('online',tick);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('online',tick);};
  }
  const subscription=AppState.addEventListener('change',tick);
  return()=>{clearInterval(timer);subscription.remove();};
}
