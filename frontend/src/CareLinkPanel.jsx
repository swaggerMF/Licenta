import React, { useEffect, useRef, useState } from 'react';
import DateRangePicker from './DateRangePicker.jsx';
import { dateKey, lastCompletedDay } from './range-dates.js';
import { carelinkRequest } from './carelink-api.js';

export default function CareLinkPanel({ onEntries, onAuthenticated, landing = false }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ state: 'idle', message: '', revision: 0 });
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const dataVersion = useRef(null);
  const loginRequested = useRef(false);
  const callback = useRef(onEntries);
  callback.current = onEntries;
  const authenticatedCallback = useRef(onAuthenticated);
  authenticatedCallback.current = onAuthenticated;
  const [from, setFrom] = useState(() => `${lastCompletedDay(dateKey(new Date())).slice(0, 7)}-01`);
  const [to, setTo] = useState(() => lastCompletedDay(dateKey(new Date())));
  const active = !['idle', 'error'].includes(status.state);

  useEffect(() => {
    if (status.authenticated) {
      window.focus();
      authenticatedCallback.current?.();
      if (loginRequested.current) {
        loginRequested.current = false;
        setOpen(true);
      }
    }
  }, [status.authenticated, status.windowBackgrounded]);

  useEffect(() => {
    if (open) dialog.current.showModal();
    else dialog.current.close();
  }, [open]);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let polling = false;
    async function poll() {
      if (controller.signal.aborted || polling) return;
      clearTimeout(timer);
      polling = true;
      try {
        const next = await carelinkRequest('/api/carelink/status', undefined, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(next);
        if (!next.dataVersion) dataVersion.current = null;
        if (next.dataVersion && next.dataVersion !== dataVersion.current) {
          const result = await carelinkRequest('/api/carelink/entries', undefined, controller.signal);
          if (controller.signal.aborted) return;
          if (result.dataVersion && result.dataVersion !== dataVersion.current) {
            callback.current(result.entries, { focusDate: result.importedLatest });
            setOpen(false);
            dataVersion.current = result.dataVersion;
          }
        }
        setConnectionError('');
      } catch (reason) {
        if (!controller.signal.aborted) setConnectionError(reason.message);
      } finally {
        polling = false;
        if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
      }
    }
    const resume = () => { if (document.visibilityState === 'visible') poll(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [open]);

  async function action(path, body) {
    setBusy(true);
    setError('');
    try {
      const next = await carelinkRequest(path, body);
      setStatus(next);
      return next;
    }
    catch (reason) {
      if (reason.code === 'CONNECTION_UNAVAILABLE') setConnectionError(reason.message);
      else setError(reason.message);
    }
    finally { setBusy(false); }
  }

  async function login() {
    loginRequested.current = true;
    const next = await action('/api/carelink/login', {});
    if (!next) loginRequested.current = false;
  }

  return <>
    <button className={landing ? 'primary-button' : 'secondary-button'} disabled={busy || (active && !status.authenticated)}
      onClick={() => { setError(''); if (status.authenticated) setOpen(true); else login(); }}>
      {status.authenticated ? 'CareLink · Alege perioada' : busy || status.state === 'connecting' ? 'Se deschide CareLink…' : status.state === 'awaiting_login' ? 'Autentificare în CareLink…' : landing ? 'Login with CareLink' : 'Conectează CareLink'}
    </button>
    {!open && !status.authenticated && <div className="carelink-entry-feedback">
      {error && <p className="error" role="alert">{error}</p>}
      {connectionError && <p className="error" role="status">{connectionError}</p>}
      {active && status.message && <p className="carelink-help" role="status">{status.message}</p>}
      {status.state === 'awaiting_login' && <button className="text-button" disabled={busy} onClick={() => action('/api/carelink/check-login', {})}>Verifică sesiunea</button>}
      {status.state === 'error' && <button className="text-button" disabled={busy} onClick={() => action('/api/carelink/disconnect', {})}>Resetează sesiunea</button>}
    </div>}
    <dialog ref={dialog} className="carelink-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby="carelink-title">
      <div className="carelink-heading"><h2 id="carelink-title">{status.authenticated ? 'Alege perioada' : 'Conectare CareLink'}</h2><button type="button" className="icon-button" aria-label="Închide" onClick={() => setOpen(false)}>×</button></div>
      {error && <div className="error" role="alert">{error}</div>}
      {connectionError && <div className="error" role="status">{connectionError} Reconectarea se încearcă automat; calendarul rămâne disponibil.</div>}
      {status.authenticated && <form className="carelink-form carelink-range" onSubmit={event => {
        event.preventDefault();
        action('/api/carelink/sync', { range: { from, to } });
      }}>
        <DateRangePicker from={from} to={to} disabled={busy || status.state === 'syncing'}
          onChange={range => { setFrom(range.from); setTo(range.to); }} />
        <button className="primary-button" disabled={busy || status.state === 'syncing'}>{status.state === 'syncing' ? 'Se descarcă…' : 'Descarcă perioada'}</button>
      </form>}
      {(status.state !== 'connected' && status.state !== 'ready' && (active || status.message)) && <p className="carelink-status" role="status">{status.message}</p>}
      {status.state === 'awaiting_login' && <button className="secondary-button" disabled={busy} onClick={() => action('/api/carelink/check-login', {})}>{busy ? 'Se verifică…' : 'Verifică sesiunea'}</button>}
      {status.state === 'error' && <button className="text-button" disabled={busy} onClick={() => action('/api/carelink/disconnect', {})}>Resetează sesiunea</button>}
    </dialog>
  </>;
}
