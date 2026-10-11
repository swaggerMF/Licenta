import React from 'react';

export default function TedMascot({ onToday }) {
  return <button type="button" className="ted-mascot-button" aria-label="TeD — mergi la ziua de azi" title="Cu TeD la ziua de azi" onClick={onToday}>
    <span className="ted-mascot-figure">
      <img src={`${import.meta.env.BASE_URL}images/ted-bear.png`} alt="" width="1254" height="1254" />
    </span>
  </button>;
}
