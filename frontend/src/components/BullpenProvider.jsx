import React from 'react';
import {BullpenContext,usePresence} from '../hooks/usePresence';

export default function BullpenProvider({children}) {
  return <BullpenContext.Provider value={usePresence()}>{children}</BullpenContext.Provider>;
}
