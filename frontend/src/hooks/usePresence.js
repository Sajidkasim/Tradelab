import {createContext, useContext, useCallback, useEffect, useRef, useState} from 'react';
import {api, setCsrf} from '../api';

export const BullpenContext = createContext(null);
export const useBullpen = () => useContext(BullpenContext);

const TEAM = ['Sajid','Safwaan','Mubeen','Mustafa','Amir'];
export const REACTIONS = ['🔥','👏','🎯'];
const REFRESH_MS = 240_000;

export function usePresence() {
  const [access,setAccess] = useState(undefined);
  const [connected,setConnected] = useState(false);
  const [inCall,setInCall] = useState(false);
  const [people,setPeople] = useState([]);
  const [peers,setPeers] = useState([]);
  const [messages,setMessages] = useState([]);
  const [reaction,setReaction] = useState(null);
  const [deskVersion,setDeskVersion] = useState(0);
  const [error,setError] = useState('');
  const channelRef = useRef(null);
  const sdkRef = useRef(null);
  const lastSent = useRef(0);
  const trackedPayloadRef = useRef(null);
  const metaRef = useRef({});
  const inCallRef = useRef(false);

  const syncTrack = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !connected || !access?.configured) return;
    if (!inCallRef.current) {
      if (trackedPayloadRef.current !== null) {
        trackedPayloadRef.current = null;
        void channel.untrack();
      }
      return;
    }
    const payload = {name: access.name, ...metaRef.current};
    const serialized = JSON.stringify(payload);
    if (trackedPayloadRef.current === serialized) return;
    trackedPayloadRef.current = serialized;
    void channel.track(payload).then(result => {
      if (result !== 'ok' && channelRef.current === channel) {
        trackedPayloadRef.current = null;
        setError('Could not update who is in the room.');
      }
    });
  }, [connected, access]);

  const updateInCall = useCallback(value=>{
    inCallRef.current=value;
    setInCall(value);
    if(!value){
      metaRef.current={};
      setMessages([]);
      setReaction(null);
    }
  },[]);

  const updatePresenceMeta = useCallback((nextMeta) => {
    metaRef.current = nextMeta || {};
    syncTrack();
  }, [syncTrack]);

  useEffect(()=>{
    const controller=new AbortController();
    let refresh;
    let alertChannel;
    const signal=controller.signal;
    const disconnect=()=>{
      clearInterval(refresh);
      controller.abort();
      setConnected(false);
      setAccess(null);
      setPeople([]);
      setPeers([]);
      setMessages([]);
      updateInCall(false);
    };
    const load=async()=>{
      const session=await api('/session',{signal});
      if(!session.authenticated||session.auth_mode!=='google'||signal.aborted){
        if(!signal.aborted)setAccess(null);
        return;
      }
      setCsrf(session.csrf);
      const credentials=await api('/bullpen',{signal});
      if(signal.aborted)return;
      setAccess(credentials);
      if(!credentials?.configured)return;

      const {createClient}=await import('@supabase/supabase-js');
      if(signal.aborted)return;
      const client=createClient(credentials.url,credentials.publishableKey,{
        accessToken:async()=>credentials.token,
      });
      sdkRef.current=client;
      await client.realtime.setAuth(credentials.token);
      if(signal.aborted)return;
      const channel=client.channel(credentials.topic,{
        config:{private:true,presence:{enabled:true},broadcast:{ack:true,self:true}},
      });
      channelRef.current=channel;
      const receiveMessage=payload=>{
        if(signal.aborted||!inCallRef.current||typeof payload?.text!=='string'||payload.text.length>400||
           typeof payload.id!=='string'||payload.id.length>80)return;
        setMessages(list=>list.some(item=>item.id===payload.id)?list:[...list.slice(-99),payload]);
      };
      if(credentials.alertTopic){
        alertChannel=client.channel(credentials.alertTopic,{config:{private:true}})
          .on('broadcast',{event:'alert'},({payload})=>{
            if(payload?.name==='System')receiveMessage(payload);
          }).subscribe();
      }
      channel.on('presence',{event:'sync'},()=>{
        if(signal.aborted)return;
        const flat=Object.values(channel.presenceState()).flat();
        const byName=new Map();
        for(const item of flat){
          if(TEAM.includes(item?.name)) byName.set(item.name, item);
        }
        const orderedNames=TEAM.filter(name=>byName.has(name));
        setPeople(orderedNames);
        setPeers(orderedNames.map(name=>byName.get(name)));
      }).on('broadcast',{event:'chat'},({payload})=>{
        if(TEAM.includes(payload?.name))receiveMessage(payload);
      }).on('broadcast',{event:'reaction'},({payload})=>{
        if(!signal.aborted&&inCallRef.current&&REACTIONS.includes(payload?.emoji))setReaction({emoji:payload.emoji,id:crypto.randomUUID()});
      }).on('broadcast',{event:'desk'},()=>{
        if(!signal.aborted)setDeskVersion(v=>v+1);
      }).subscribe(status=>{
        if(signal.aborted)return;
        trackedPayloadRef.current=null;
        setConnected(status==='SUBSCRIBED');
        if(status!=='SUBSCRIBED'){setPeople([]);setPeers([]);}
        setError(status==='SUBSCRIBED'?'':'Live chat is reconnecting.');
      });
      refresh=setInterval(async()=>{
        try{
          const next=await api('/bullpen',{signal});
          if(signal.aborted)return;
          if(!next?.configured){disconnect();closeChannel();return;}
          credentials.token=next.token;
          await client.realtime.setAuth(next.token);
        }catch(failure){
          if(!signal.aborted)setError('Could not refresh live chat access.');
        }
      },REFRESH_MS);
    };
    const closeChannel=()=>{
      const client=sdkRef.current,channel=channelRef.current;
      channelRef.current=null;
      sdkRef.current=null;
      if(channel&&client)void client.removeChannel(channel);
      if(alertChannel&&client)void client.removeChannel(alertChannel);
      alertChannel=null;
    };
    const logout=()=>{disconnect();closeChannel()};
    window.addEventListener('primus:logout',logout);
    load().catch(()=>{
      if(!signal.aborted){setAccess(null);setError('Could not check Bullpen access.')}
    });
    return ()=>{
      window.removeEventListener('primus:logout',logout);
      clearInterval(refresh);
      controller.abort();
      closeChannel();
    };
  },[]);

  useEffect(()=>{
    syncTrack();
  },[inCall,connected,access,syncTrack]);

  async function send(event,value){
    if(!connected||!inCall||!channelRef.current)return false;
    if(event!=='desk'&&Date.now()-lastSent.current<350)return false;
    if(event!=='desk')lastSent.current=Date.now();
    try{
      const result=await channelRef.current.send({
        type:'broadcast',event,payload:{...value,name:access.name,id:crypto.randomUUID()},
      });
      if(result==='ok')return true;
    }catch{
      // The socket may close between the readiness check and send.
    }
    if(event!=='desk')setError('Message could not be sent. Try again.');
    return false;
  }

  return {access,connected,people,peers,messages,reaction,deskVersion,error,setInCall:updateInCall,updatePresenceMeta,send};
}
