import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { groupDays, mergeEntries, sensorReason, stats } from './data.js';
import Chart from './Chart.jsx';
import CareLinkPanel from './CareLinkPanel.jsx';
import { carelinkRequest } from './carelink-api.js';
import './styles.css';

const EMPTY = [];
const WEEKDAYS = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'];
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDate = key => new Date(`${key}T12:00:00`);
const monthLabel = date => date.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
const dayLabel = key => localDate(key).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101b18' : '#155e52';
  }, [theme]);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ted-theme', next); } catch {}
    setTheme(next);
  }
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState('');
  const [month, setMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [entered, setEntered] = useState(false);
  const fileRef = useRef(null);
  const dataLoaded = useRef(false);
  const days = useMemo(() => groupDays(entries), [entries]);
  const keys = useMemo(() => [...days.keys()].sort(), [days]);
  const monthPrefix = dateKey(month).slice(0, 7);
  const monthEntries = useMemo(() => entries.filter(entry => entry.date.startsWith(monthPrefix)), [entries, monthPrefix]);
  const monthStats = useMemo(() => stats(monthEntries), [monthEntries]);
  const selectedEntries = days.get(selected) || EMPTY;
  const selectedStats = useMemo(() => stats(selectedEntries), [selectedEntries]);
  const ceiling = useMemo(() => Math.max(400, Math.ceil(entries.reduce((max, entry) => Math.max(max, entry.bg ?? 0), 0) / 100) * 100), [entries]);

  function loadEntries(data, { focus = true, focusDate } = {}) {
    dataLoaded.current = true;
    const latest = focusDate || data.reduce((latest, entry) => entry.date > latest ? entry.date : latest, '');
    setEntries(current => focus ? mergeEntries(current, data) : mergeEntries(data, current));
    if (focus && latest) {
      setSelected(latest);
      setMonth(new Date(localDate(latest).getFullYear(), localDate(latest).getMonth(), 1));
    }
    setError('');
  }
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data.json`).then(response => {
      if (!response.ok) throw new Error('Datele locale nu au putut fi încărcate. Poți importa un CSV.');
      return response.json();
    }).then(data => { if (active) loadEntries(data, { focus: !dataLoaded.current }); })
      .catch(() => {
        if (active && !dataLoaded.current) setError('Datele inițiale nu au putut fi încărcate. Verifică dacă aplicația locală rulează sau importă un CSV.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      // Initialize the local session cookie, including when importing immediately after startup.
      await carelinkRequest('/api/carelink/status');
      const result = await carelinkRequest('/api/import', { csv: await file.text() });
      loadEntries(result.entries, { focusDate: result.importedLatest });
      setEntered(true);
    }
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
    <button className="theme-toggle" onClick={toggleTheme} aria-label="Mod întunecat" aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Activează modul luminos' : 'Activează modul întunecat'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
      </svg>
    </button>
    <main className={entered ? '' : 'entry-page'}>
      <section className={entered ? 'page-heading' : 'entry-heading'}>
        <div className="ted-brand">
          <div className={entered ? undefined : 'entry-brand-row'}>
            {!entered && <div className="entry-mascot"><img src={`${import.meta.env.BASE_URL}images/ted-bear.png`} alt="TeD, un ursuleț de pluș care ține în brațe o pompă de insulină" width="1254" height="1254" fetchPriority="high" /></div>}
            <h1>TeD</h1>
          </div>
          {entered ? <p className="ted-dashboard-caption">Select a day. Observe patterns.</p> : <p className="ted-tagline">Your Type 1 bear analyst</p>}
        </div>

        <div className="import-controls"><CareLinkPanel landing={!entered} onAuthenticated={() => setEntered(true)} onEntries={(data, options) => { loadEntries(data, options); setEntered(true); }} /><button className={entered ? 'primary-button' : 'secondary-button entry-import'} onClick={() => fileRef.current.click()} disabled={loading || importing}>{importing ? 'Se importă…' : entered ? 'Importă CSV' : 'Import CSV'}</button><input ref={fileRef} className="visually-hidden" aria-label="Importă fișier CSV" type="file" accept=".csv,text/csv" onChange={importFile} /></div>
        {!entered && entries.length > 0 && <button className="text-button entry-continue" onClick={() => setEntered(true)}>Continuă cu datele încărcate</button>}
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {entered && (loading ? <div className="empty-state" role="status">Se încarcă măsurătorile…</div> : !entries.length ? <div className="empty-state"><h2>Alege perioada din CareLink.</h2><p>Deschide „CareLink · Alege perioada” sau importă un CSV.</p></div> : <>
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
          <div className="calendar-footer"><div className="chart-legend"><span><i style={{ background: 'var(--chart-green)' }} />70–180</span><span><i style={{ background: 'var(--reading-high)' }} />Peste 180</span><span><i style={{ background: 'var(--reading-low)' }} />Sub 70</span><span><i style={{ background: 'var(--reading-missing)' }} />Date lipsă</span></div></div>
        </section>
        <section className="detail-panel" aria-label="Detaliile zilei selectate">
          <div className="panel-heading"><div><h2 className="selected-title">{dayLabel(selected)}</h2></div><div className="day-navigation"><button className="icon-button" disabled={!previousDay} aria-label="Ziua precedentă cu date" onClick={() => selectDay(previousDay)}>‹</button><span>{selectedIndex >= 0 ? `${selectedIndex + 1} / ${keys.length}` : 'Fără date'}</span><button className="icon-button" disabled={!nextDay} aria-label="Ziua următoare cu date" onClick={() => selectDay(nextDay)}>›</button></div></div>
          {selectedEntries.length ? <><div className="detail-summary"><span>Medie <strong>{selectedStats?.mean ?? '—'} mg/dL</strong></span><span>Minim <strong>{selectedStats?.min ?? '—'}</strong></span><span>Maxim <strong>{selectedStats?.max ?? '—'}</strong></span></div><p className="chart-unit">Glicemie (mg/dL)</p><Chart key={selected} entries={selectedEntries} ceiling={ceiling} /></> : <div className="empty-day">Nu există măsurători pentru această zi. Selectează o zi marcată în calendar.</div>}
        </section>

      </>)}
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
