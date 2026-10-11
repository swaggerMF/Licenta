import React, { useState } from 'react';
import { dateKey, localDate, europeanDate, monthDays, recentRange, lastCompletedDay } from './range-dates.js';

const weekdays = ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'];

export default function DateRangePicker({ from, to, onChange, disabled = false }) {
  const today = dateKey(new Date());
  const completedThrough = lastCompletedDay(today);
  const [view, setView] = useState(() => localDate(from));
  const [endpoint, setEndpoint] = useState('from');
  const [hover, setHover] = useState(null);
  const year = view.getFullYear(), month = view.getMonth();
  const monthName = view.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
  const preview = endpoint === 'to' && hover && hover <= today;
  const start = preview && hover < from ? hover : from;
  const end = preview ? (hover < from ? from : hover) : to;

  function select(key) {
    if (endpoint === 'from') {
      onChange({ from: key, to: key });
      setEndpoint('to');
    } else {
      onChange(key < from ? { from: key, to: from } : { from, to: key });
      setEndpoint('from');
    }
    setHover(null);
  }

  function preset(range) {
    onChange(range);
    setView(localDate(range.from));
    setEndpoint('from');
    setHover(null);
  }

  return <fieldset className="period-picker" disabled={disabled}>
    <legend className="visually-hidden">Perioada de import</legend>
    <div className="period-endpoints">
      {[['from', 'De la', from], ['to', 'Până la', to]].map(([key, label, value]) =>
        <button type="button" key={key} className={`period-endpoint ${endpoint === key ? 'is-active' : ''}`}
          aria-pressed={endpoint === key} onClick={() => { setEndpoint(key); setView(localDate(value)); setHover(null); }}>
          <span>{label}</span><strong>{europeanDate(value)}</strong>
        </button>)}
      <span className="period-arrow" aria-hidden="true">→</span>
    </div>
    <div className="period-presets" aria-label="Perioade rapide">
      <button type="button" onClick={() => preset(recentRange(completedThrough, 7))}>Ultimele 7 zile</button>
      <button type="button" onClick={() => preset(recentRange(completedThrough, 30))}>Ultimele 30 zile</button>
      <button type="button" disabled={completedThrough.slice(0, 7) !== today.slice(0, 7)} onClick={() => preset({ from: `${today.slice(0, 7)}-01`, to: completedThrough })}>Luna aceasta</button>
    </div>
    <div className="period-calendar">
      <div className="period-navigation">
        <button className="icon-button" type="button" aria-label="Luna precedentă" disabled={disabled || year === 1900 && month === 0}
          onClick={() => { setView(new Date(year, month - 1, 1)); setHover(null); }}>‹</button>
        <div className="period-month-selects">
          <label className="visually-hidden" htmlFor="period-month">Luna</label>
          <select id="period-month" value={month} onChange={event => setView(new Date(year, Number(event.target.value), 1))}>
            {Array.from({ length: 12 }, (_, index) => <option key={index} value={index} disabled={year === new Date().getFullYear() && index > new Date().getMonth()}>
              {new Date(2026, index, 1).toLocaleDateString('ro-RO', { month: 'long' })}
            </option>)}
          </select>
          <label className="visually-hidden" htmlFor="period-year">Anul</label>
          <select id="period-year" value={year} onChange={event => {
            const nextYear = Number(event.target.value);
            setView(new Date(nextYear, nextYear === new Date().getFullYear() ? Math.min(month, new Date().getMonth()) : month, 1));
          }}>
            {Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => <option key={index} value={new Date().getFullYear() - index}>{new Date().getFullYear() - index}</option>)}
          </select>
        </div>
        <button className="icon-button" type="button" aria-label="Luna următoare" disabled={disabled || dateKey(new Date(year, month + 1, 1)) > today}
          onClick={() => { setView(new Date(year, month + 1, 1)); setHover(null); }}>›</button>
      </div>
      <div className="period-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="period-days" role="group" aria-label={monthName} onMouseLeave={() => setHover(null)}>
        {monthDays(year, month).map(key => {
          const date = localDate(key);
          const edge = key === start || key === end;
          return <button type="button" key={key} disabled={disabled || key > today || key < '1900-01-01'}
            className={`period-day ${date.getMonth() !== month ? 'is-outside' : ''} ${key >= start && key <= end ? 'in-range' : ''} ${edge ? 'is-edge' : ''} ${key === today ? 'is-today' : ''}`}
            aria-label={date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}
            aria-pressed={key === from || key === to} aria-current={key === today ? 'date' : undefined}
            onMouseEnter={() => setHover(key)} onFocus={() => setHover(key)} onClick={() => select(key)}>
            {date.getDate()}
          </button>;
        })}
      </div>
    </div>
  </fieldset>;
}
