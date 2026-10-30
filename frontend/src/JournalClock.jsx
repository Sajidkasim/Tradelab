import { createContext, useContext } from 'react';
export const JournalClock = createContext('America/New_York');
export function useJournalClock() {
  const timezone = useContext(JournalClock);
  return { timezone, clockName: timezone === 'Europe/London' ? 'UK' : 'New York' };
}
