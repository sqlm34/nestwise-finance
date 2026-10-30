import {createContext,useCallback,useContext,useLayoutEffect,useRef} from 'react';
import {useFocusEffect} from 'expo-router';
import {createBackSteps} from './domain/back-steps';

export const BackStepsContext=createContext<ReturnType<typeof createBackSteps>|null>(null);

export function useBackStep(enabled:boolean,back:()=>void,depth=10) {
  const steps=useContext(BackStepsContext),latest=useRef(back);
  useLayoutEffect(()=>{latest.current=back;});
  useFocusEffect(useCallback(()=>{
    if(enabled&&steps)return steps.add(depth,()=>latest.current());
  },[enabled,steps,depth]));
}
