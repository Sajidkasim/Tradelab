import React,{useEffect,useState} from 'react';
import Unlock from './Unlock';
import {api,setCsrf} from './api';

export default function PrimeSignIn(){
 const [session,setSession]=useState(null),[error,setError]=useState('');
 async function load(){
  setError('');
  try{const value=await api('/session');setCsrf(value.csrf);if(value.authenticated){location.replace('/journal');return}setSession(value)}catch(e){setError(e.message)}
 }
 useEffect(()=>{document.title='Sign in — Prime Trader';load()},[]);
 if(!session)return <main className="loading-screen">{error?<><p role="alert">{error}</p><button className="button" onClick={load}>Try again</button></>:'Opening Prime Trader…'}</main>;
 return <Unlock prime ready={Boolean(session.csrf)} authMode={session.auth_mode} workspace="journal" onUnlocked={()=>location.replace('/journal')}/>;
}
