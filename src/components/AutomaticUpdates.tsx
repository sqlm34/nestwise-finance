import {useEffect,useRef} from 'react';
import {Keyboard,Platform} from 'react-native';
import * as Updates from 'expo-updates';
import {isForeground,onForegroundRefresh} from '../foreground-refresh';
import {automaticUpdate} from '../domain/automatic-update';

/** Only mounted on the read-only overview, never over an entry/import form. */
function NativeUpdates({canApply}:{canApply:boolean}){
  const {isUpdatePending,isChecking,isDownloading}=Updates.useUpdates();
  const latest=useRef({canApply,isUpdatePending,isChecking,isDownloading});
  useEffect(()=>{latest.current={canApply,isUpdatePending,isChecking,isDownloading};},[canApply,isUpdatePending,isChecking,isDownloading]);
  useEffect(()=>{
    if(!Updates.isEnabled)return;
    const manager=automaticUpdate({state:()=>({canApply:latest.current.canApply,pending:latest.current.isUpdatePending,checking:latest.current.isChecking,downloading:latest.current.isDownloading,foreground:isForeground(),keyboard:Keyboard.isVisible()}),check:Updates.checkForUpdateAsync,download:Updates.fetchUpdateAsync,reload:Updates.reloadAsync,now:Date.now});
    void manager.check();
    const stop=onForegroundRefresh(()=>{void manager.check();void manager.apply();});
    return()=>{manager.stop();stop();};
  },[]);
  return null;
}
export function AutomaticUpdates(props:{canApply:boolean}){
  return Platform.OS==='web'?null:<NativeUpdates {...props}/>;
}
