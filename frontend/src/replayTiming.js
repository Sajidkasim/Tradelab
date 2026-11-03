export function recordTiming(name,start){
 if(localStorage.getItem('primus-replay-profile')!=='1')return;
 const row={name,ms:performance.now()-start,time:performance.now()};
 (window.__primusReplayTimings??=[]).push(row);
 if(window.__primusReplayTimings.length>3000)window.__primusReplayTimings.shift();
}
