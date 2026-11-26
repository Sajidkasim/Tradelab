import React,{useEffect,useState} from 'react';
import {PrimusHeader} from './SiteExperience';
import {api,setCsrf} from './api';
import {getCachedSession} from './routeCache';
import {Button,Notice} from './components';
import './workspace-pages.css';
export function useIdentity(){
 const [identity,setIdentity]=useState(()=>getCachedSession()),[error,setError]=useState('');
 async function load(){setError('');try{const value=await api('/session');setCsrf(value.csrf);setIdentity(value)}catch(e){setError(e.message)}}
 useEffect(()=>{load();const out=()=>setIdentity({authenticated:false,auth_mode:'google'});window.addEventListener('primus:logout',out);return()=>window.removeEventListener('primus:logout',out)},[]);
 return {identity,error,reload:load};
}
export function WorkspacePage({active,kicker,title,intro,children,heroAside,hideHeading=false,className=""}){
 useEffect(()=>{document.title=`${title} — PrimusTrader`},[title]);
 return <div className={`pt-site workspace-page ${className}`}><PrimusHeader active={active}/><main className="pt-wrap wp-main">{!hideHeading&&<div className={heroAside?"ce-hero-layout":undefined}><header className="wp-heading">{kicker && <span className="pt-overline">{kicker}</span>}<h1>{title}</h1><p>{intro}</p></header>{heroAside}</div>}{children}</main></div>;
}
export function SignInPanel({identity,path,reload,title='Your space stays private'}){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="wp-panel wp-signin"><h2>{title}</h2><p>Sign in with your existing Primus account to save and return later.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(identity.auth_mode==='google'){const result=await api(`/login/google?return_to=${encodeURIComponent(path)}`,{method:'POST'});location.assign(result.url)}else{const result=await api('/unlock',{method:'POST',body:{password}});setCsrf(result.csrf);setPassword('');await reload()}}catch(e){setError(e.message)}finally{setBusy(false)}}}>{identity.auth_mode!=='google'&&<label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>}<Button variant="primary" busy={busy} type="submit">{identity.auth_mode==='google'?'Continue with Google':'Sign in'}</Button></form>{error&&<Notice error>{error}</Notice>}</section>;
}
