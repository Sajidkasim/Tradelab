import React from 'react';
import PrimusCompass from './components/PrimusCompass';
import { PrimusTopoField } from './components/PrimusAtmosphere';

export default function MatrixLoading(){
  return <div className="matrix-loading" role="status">
    <PrimusTopoField variant="card" />
    <div className="matrix-loading-inner">
      <div className="matrix-loading-reticle" aria-hidden="true"><PrimusCompass size={34} /></div>
      <span className="matrix-loading-kicker">PRIMUSLAB / MACRO DESK</span>
      <strong>The Matrix</strong>
      <div className="matrix-loading-bars" aria-hidden="true">
        {[26,42,34,62,51,77,65,90,74].map((height,index)=>
          <i key={height} style={{height:`${height}%`,animationDelay:`${index*75}ms`}}/>)}
      </div>
      <span>Opening macro snapshot…</span>
    </div>
  </div>;
}
