import React, {lazy, Suspense, useCallback, useEffect, useState} from 'react';
import {api} from '../api';
import {BullpenContext, usePresence} from '../hooks/usePresence';
import {PrimusHeader} from '../SiteExperience';
import '../trading-room.css';

const TradingRoom = lazy(() => import('./TradingRoom'));

export default function BullpenProvider({children}) {
  const presence = usePresence();
  const [meeting, setMeeting] = useState(null);
  const [minimised, setMinimised] = useState(false);
  const [joining, setJoining] = useState(false);
  const [roomError, setRoomError] = useState('');
  const isRoomActive = Boolean(meeting && presence.access?.configured);

  useEffect(() => {
    if (!isRoomActive) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isRoomActive]);

  useEffect(() => {
    const clearRoom = () => {
      setMeeting(null);
      setMinimised(false);
      setRoomError('');
    };
    window.addEventListener('primus:logout', clearRoom);
    return () => window.removeEventListener('primus:logout', clearRoom);
  }, []);

  useEffect(() => {
    if (!isRoomActive) return;
    const onNavigate = () => setMinimised(true);
    window.addEventListener('primus:navigate', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('primus:navigate', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, [isRoomActive]);

  const joinRoom = useCallback(async ({native = false} = {}) => {
    if (isRoomActive && !native) {
      setMinimised(false);
      return meeting;
    }
    setJoining(true);
    setRoomError('');
    try {
      const reply = await api('/bullpen?join=true');
      if (!reply?.meeting) throw new Error('The team room is unavailable.');
      if (!native) {
        setMinimised(false);
        setMeeting(reply.meeting);
      }
      return reply.meeting;
    } catch (failure) {
      setRoomError(failure.message);
      return null;
    } finally {
      setJoining(false);
    }
  }, [isRoomActive, meeting]);

  const leaveRoom = useCallback(() => {
    setMeeting(null);
    setMinimised(false);
  }, []);

  const minimiseRoom = useCallback(() => setMinimised(true), []);
  const restoreRoom = useCallback(() => setMinimised(false), []);

  const value = {
    ...presence,
    meeting,
    minimised,
    isRoomActive,
    joining,
    roomError,
    joinRoom,
    leaveRoom,
    minimiseRoom,
    restoreRoom,
  };

  return (
    <BullpenContext.Provider value={value}>
      {isRoomActive && (
        <div className={`pt-site bullpen-workspace${minimised ? ' is-minimised' : ''}`}>
          <div className="bullpen-room-site-header">
            <PrimusHeader active="learn" />
          </div>
          <Suspense fallback={<p role="status">Opening Trading Floor…</p>}>
            <TradingRoom
              meeting={meeting}
              onLeave={leaveRoom}
              minimised={minimised}
              onMinimise={minimiseRoom}
              onRestore={restoreRoom}
            />
          </Suspense>
        </div>
      )}
      <div hidden={isRoomActive && !minimised}>{children}</div>
    </BullpenContext.Provider>
  );
}
