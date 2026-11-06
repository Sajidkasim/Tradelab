import React from 'react';
import './matrix-loading.css';

export default function MatrixLoading(){
  return <div className="matrix-loading" role="status">
    <div className="matrix-loading-inner">
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
