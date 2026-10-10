import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { groupDays, parseCsv, sensorReason, stats } from './data.js';
import Chart from './Chart.jsx';
import './styles.css';

const EMPTY = [];
const WEEKDAYS = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'];
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDate = key => new Date(`${key}T12:00:00`);
const monthLabel = date => date.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
const dayLabel = key => localDate(key).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function App() {
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState('');
  const [month, setMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const days = useMemo(() => groupDays(entries), [entries]);
  const keys = useMemo(() => [...days.keys()].sort(), [days]);
  const monthPrefix = dateKey(month).slice(0, 7);
  const monthEntries = useMemo(() => entries.filter(entry => entry.date.startsWith(monthPrefix)), [entries, monthPrefix]);
  const monthStats = useMemo(() => stats(monthEntries), [monthEntries]);
  const selectedEntries = days.get(selected) || EMPTY;
  const selectedStats = useMemo(() => stats(selectedEntries), [selectedEntries]);
  const ceiling = useMemo(() => Math.max(300, Math.ceil(entries.reduce((max, entry) => Math.max(max, entry.bg ?? 0), 0) / 100) * 100), [entries]);

  function loadEntries(data) {
    const latest = data.map(entry => entry.date).sort().at(-1);
    setEntries(data);
    setSelected(latest || '');
    if (latest) setMonth(new Date(localDate(latest).getFullYear(), localDate(latest).getMonth(), 1));
    setError('');
  }
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data.json`).then(response => {
      if (!response.ok) throw new Error('Datele locale nu au putut fi încărcate. Poți importa un CSV.');
      return response.json();
    }).then(data => { if (active) loadEntries(data); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try { loadEntries(parseCsv(await file.text())); }
    catch (reason) { setError(reason.message); }
    finally { setImporting(false); event.target.value = ''; }
  }
  function changeMonth(delta) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    const prefix = dateKey(next).slice(0, 7);
    setSelected(keys.find(key => key.startsWith(prefix)) || dateKey(next));
  }
  function selectDay(key) {
    setSelected(key);
    setMonth(new Date(localDate(key).getFullYear(), localDate(key).getMonth(), 1));
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((offset + length) / 7) * 7;
  const selectedIndex = keys.indexOf(selected);
  const previousDay = keys.filter(key => key < selected).at(-1);
  const nextDay = keys.find(key => key > selected);

  return <div className="app">
    <main>
      <section className="page-heading">
        <h1>Select a day. Observe patterns.</h1>
        <div className="import-controls"><button className="primary-button" onClick={() => fileRef.current.click()} disabled={loading || importing}><span aria-hidden="true">↑</span> {importing ? 'Se importă…' : 'Importă CSV'}</button><input ref={fileRef} className="visually-hidden" aria-label="Importă fișier CSV" type="file" accept=".csv,text/csv" onChange={importFile} /></div>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {loading ? <div className="empty-state" role="status">Se încarcă măsurătorile…</div> : !entries.length ? <div className="empty-state"><h2>Calendarul începe cu datele tale.</h2><p>Importă un export CSV care conține secțiunea Sensor pentru a vedea graficele zilnice.</p></div> : <>
        <section className="overview" aria-label="Rezumatul lunii afișate">
          <div><span>Media lunii</span><strong>{monthStats?.mean ?? '—'} <small>mg/dL</small></strong></div>
          <div><span>Valoare minimă</span><strong>{monthStats?.min ?? '—'} <small>mg/dL</small></strong></div>
          <div><span>Valoare maximă</span><strong>{monthStats?.max ?? '—'} <small>mg/dL</small></strong></div>
          <div><span>Zile cu măsurători</span><strong>{keys.filter(key => key.startsWith(monthPrefix) && stats(days.get(key))).length} <small>/ {length} zile</small></strong></div>
        </section>
        <section className="calendar-panel" id="calendar" aria-label="Calendar glicemic">
          <div className="panel-heading"><div className="month-title"><h2>{monthLabel(month)}</h2></div><div className="month-navigation"><button className="text-button" onClick={() => selectDay(keys.at(-1))}>Ultima zi cu date</button><button className="icon-button" aria-label="Luna precedentă" onClick={() => changeMonth(-1)}>‹</button><button className="icon-button" aria-label="Luna următoare" onClick={() => changeMonth(1)}>›</button></div></div>
          <div className="weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">
            {Array.from({ length: cellCount }, (_, index) => {
              const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1);
              const key = dateKey(date);
              const currentMonth = date.getMonth() === month.getMonth();
              const readings = days.get(key) || EMPTY;
              const summary = stats(readings);
              return <button key={key} className={`day-cell ${currentMonth ? '' : 'outside'} ${selected === key ? 'selected' : ''} ${summary ? 'has-data' : ''}`} onClick={() => selectDay(key)} aria-pressed={selected === key} aria-label={`${dayLabel(key)}, ${summary ? `media ${summary.mean} mg/dL` : 'fără date'}`}>
                <div className="day-header"><span className="day-number">{date.getDate()}</span>{summary && <span className="reading-dot" />}</div>
                {summary ? <><Chart entries={readings} ceiling={ceiling} compact /><span className="day-mean">{summary.mean} <small>mg/dL</small></span></> : <span className="no-data">{readings.length ? sensorReason(readings[0]) : 'Fără date'}</span>}
              </button>;
            })}
          </div>
          <div className="calendar-footer"><div className="chart-legend"><span><i style={{ background: '#155e52' }} />70–180</span><span><i style={{ background: '#c89916' }} />Peste 180</span><span><i style={{ background: '#dc4444' }} />Sub 70</span><span><i style={{ background: '#87938d' }} />Date lipsă</span></div></div>
        </section>
        <section className="detail-panel" aria-label="Detaliile zilei selectate">
          <div className="panel-heading"><div><h2 className="selected-title">{dayLabel(selected)}</h2></div><div className="day-navigation"><button className="icon-button" disabled={!previousDay} aria-label="Ziua precedentă cu date" onClick={() => selectDay(previousDay)}>‹</button><span>{selectedIndex >= 0 ? `${selectedIndex + 1} / ${keys.length}` : 'Fără date'}</span><button className="icon-button" disabled={!nextDay} aria-label="Ziua următoare cu date" onClick={() => selectDay(nextDay)}>›</button></div></div>
          {selectedEntries.length ? <><div className="detail-summary"><span>Medie <strong>{selectedStats?.mean ?? '—'} mg/dL</strong></span><span>Minim <strong>{selectedStats?.min ?? '—'}</strong></span><span>Maxim <strong>{selectedStats?.max ?? '—'}</strong></span></div><p className="chart-unit">Glicemie (mg/dL)</p><Chart key={selected} entries={selectedEntries} ceiling={ceiling} /></> : <div className="empty-day">Nu există măsurători pentru această zi. Selectează o zi marcată în calendar.</div>}
        </section>

      </>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
