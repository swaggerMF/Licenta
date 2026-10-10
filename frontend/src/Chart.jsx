import React, { useId, useState } from 'react';
import { chartSegments, glucoseColor, sensorReason } from './data.js';

export default function Chart({ entries, ceiling, compact = false }) {
  const [hover, setHover] = useState(null);
  const id = useId().replaceAll(':', '');
  const width = compact ? 220 : 1000;
  const height = compact ? 64 : 398;
  const margin = compact
    ? { left: 2, right: 2, top: 3, bottom: 3 }
    : { left: 46, right: 20, top: 120, bottom: 34 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = minute => margin.left + minute / 1440 * innerWidth;
  const y = value => margin.top + (1 - value / ceiling) * innerHeight;
  const segments = chartSegments(entries);
  const bands = [
    { name: 'high', top: margin.top, bottom: y(180) },
    { name: 'low', top: y(70), bottom: y(0) },
  ];
  const tooltipWidth = 290;
  const tooltipX = hover ? Math.max(margin.left, Math.min(width - tooltipWidth - margin.right, x(hover.minute) - tooltipWidth / 2)) : 0;

  function move(event) {
    // SVG coordinates also account for letterboxing on narrow screens.
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const minute = Math.max(0, Math.min(1440, (point.x - margin.left) / innerWidth * 1440));
    const closest = entries.reduce((best, entry) => !best || Math.abs(entry.minute - minute) < Math.abs(best.minute - minute) ? entry : best, null);
    // In a gap without a CSV record, do not show a distant glucose reading.
    setHover(closest && Math.abs(closest.minute - minute) <= 7.5
      ? closest
      : { minute, time: `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`, bg: null, event: 'NONE' });
  }

  return <div className={compact ? 'mini-chart' : 'daily-chart'}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="Glicemie pe 24 de ore: linie verde, arie galbenă peste 180 și roșie sub 70 mg/dL; gri pentru date lipsă"
      onPointerMove={compact ? undefined : move} onPointerLeave={() => setHover(null)}>
      <defs>
        {bands.map(band => <clipPath key={band.name} id={`${id}-${band.name}`}>
          <rect x={margin.left} y={band.top} width={innerWidth} height={band.bottom - band.top} />
        </clipPath>)}
      </defs>
      {!compact && <>
        <rect x={margin.left} y={y(180)} width={innerWidth} height={y(70) - y(180)} fill="#eff6ef" />
        {Array.from({ length: ceiling / 100 + 1 }, (_, i) => i * 100).map(value => <g key={value}>
          <line className="grid-line" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} />
          <text className="axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{value}</text>
        </g>)}
        {[70, 180].map(value => <g key={value}>
          <line className="threshold-line" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} />
          <text className="axis-label threshold-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{value}</text>
        </g>)}
        {[0, 4, 8, 12, 16, 20, 24].map(hour => <text className="axis-label" key={hour} x={x(hour * 60)} y={height - 8} textAnchor="middle">{String(hour).padStart(2, '0')}:00</text>)}
      </>}
      {entries.filter(entry => entry.bg === null).map((entry, index) => <rect key={`missing-${index}`}
        x={x(Math.max(0, entry.minute - 2.5))} y={margin.top} width={Math.max(1, innerWidth * Math.min(5, 1440 - entry.minute) / 1440)} height={innerHeight}
        fill="#87938d" opacity="0.1"><title>{entry.time} · Fără glicemie · {sensorReason(entry)}</title></rect>)}
      {segments.map((segment, index) => {
        const points = segment.map(entry => `${x(entry.minute)},${y(entry.bg)}`).join(' ');
        return <React.Fragment key={index}>
          {['high', 'low'].map(name => {
            const baseline = y(name === 'high' ? 180 : 70);
            return <polygon key={name} points={`${x(segment[0].minute)},${baseline} ${points} ${x(segment.at(-1).minute)},${baseline}`}
              clipPath={`url(#${id}-${name})`} fill={name === 'high' ? '#ffca05' : '#ff303b'} opacity="0.65" />;
          })}
          <polyline className="glucose-line" style={{ color: '#155e52' }}
            strokeWidth={compact ? 2 : 2.5} points={points} />
          {segment.length === 1 && <circle cx={x(segment[0].minute)} cy={y(segment[0].bg)} r={compact ? 1.7 : 3} fill="#155e52" />}
        </React.Fragment>;
      })}
      {hover && !compact && <g className="chart-hover" pointerEvents="none">
        <line className="hover-line" x1={x(hover.minute)} x2={x(hover.minute)} y1="106" y2={height - margin.bottom} />
        {hover.bg !== null && <circle cx={x(hover.minute)} cy={y(hover.bg)} r="5" fill="#155e52" stroke="white" strokeWidth="2" />}
        <foreignObject x={tooltipX} y="0" width={tooltipWidth} height="106">
          <div xmlns="http://www.w3.org/1999/xhtml" className="chart-tooltip" style={{ borderColor: glucoseColor(hover.bg) }}>
            <span className="tooltip-time">{hover.time}</span>
            <strong style={{ color: glucoseColor(hover.bg) }}>{hover.bg === null ? 'Fără glicemie' : `${hover.bg} mg/dL`}</strong>
            {(hover.bg === null || hover.event !== 'NONE') && <span className="tooltip-reason">{sensorReason(hover)}</span>}
          </div>
        </foreignObject>
      </g>}
    </svg>
  </div>;
}
