import React,{useEffect,useState} from 'react';
import {api} from './api';
export default function WorkspaceResume(){
 const [member,setMember]=useState(null),[session,setSession]=useState(null);
 useEffect(()=>{const controller=new AbortController();let alive=true;
  api('/session').then(async identity=>{if(!alive)return;setMember(identity);if(!identity.authenticated)return;
   if(identity.local||document.querySelector('meta[name="primus-replay-enabled"]')){
    try{const result=await api('/backtesting/sessions',{signal:controller.signal});if(alive)setSession(result.sessions?.find(item=>!item.finished)||null)}catch{}
   }
  }).catch(()=>{});return()=>{alive=false;controller.abort()};
 },[]);
 if(!member?.authenticated)return null;
 const replayEnabled=member.local||Boolean(document.querySelector('meta[name="primus-replay-enabled"]'));
 return <section className="pt-resume pt-wrap" aria-label="Continue your work"><h2>Continue your session</h2><div className="pt-resume-actions"><a className="pt-btn pt-btn-dark" href="/journal">Today’s Journal</a>{replayEnabled&&<a className="pt-btn" href={session?`/backtesting?session=${encodeURIComponent(session.id)}`:'/backtesting'}>{session?'Resume replay':'Open backtesting'}</a>}<a className="pt-btn" href="/lab">Review results</a></div></section>;
}
