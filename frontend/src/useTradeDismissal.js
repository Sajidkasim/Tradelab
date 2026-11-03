import {useCallback,useRef} from 'react';
// One guard for backdrop, Escape, close icon and the form's Cancel action.
export default function useTradeDismissal(onClose){
 const state=useRef({dirty:false,busy:false}),close=useRef(onClose);close.current=onClose;
 const onDraftStateChange=useCallback(value=>{state.current=value},[]);
 const requestClose=useCallback(()=>{
  if(state.current.busy)return;
  if(state.current.dirty&&!window.confirm('Are you sure you want to cancel? Your unsaved trade details and notes will be lost.'))return;
  state.current={dirty:false,busy:false};close.current();
 },[]);
 return {requestClose,onDraftStateChange};
}
