// Local panels take precedence over route history. Higher depth closes first.
export function createBackSteps() {
  const steps=new Map<symbol,{depth:number;back:()=>void}>();
  return {
    add(depth:number,back:()=>void) {
      const id=Symbol();steps.set(id,{depth,back});
      return ()=>{steps.delete(id);};
    },
    back() {
      const step=[...steps.values()].sort((a,b)=>b.depth-a.depth)[0];
      if(!step)return false;
      step.back();return true;
    },
  };
}
