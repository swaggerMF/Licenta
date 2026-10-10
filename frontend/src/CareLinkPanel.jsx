import React, { useEffect, useRef, useState } from 'react';
import { carelinkRequest } from './carelink-api.js';
import { CARELINK_COUNTRIES } from './carelink-countries.js';

export default function CareLinkPanel({ onEntries }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ state: 'idle', message: '', revision: 0 });
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const dataVersion = useRef(null);
  const callback = useRef(onEntries);
  callback.current = onEntries;
  const active = !['idle', 'error'].includes(status.state);

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
    try { setStatus(await carelinkRequest(path, body)); }
    catch (reason) {
      if (reason.code === 'CONNECTION_UNAVAILABLE') setConnectionError(reason.message);
      else setError(reason.message);
    }
    finally { setBusy(false); }
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = { country: values.get('country'), username: values.get('username').trim(), password: values.get('password') };
    form.elements.password.value = '';
    await action('/api/carelink/login', body);
    body.password = '';
  }

  return <>
    <button className="secondary-button" onClick={() => { setError(''); setOpen(true); }}>
      {status.state === 'ready' ? 'CareLink actualizat' : status.state === 'syncing' ? 'Se sincronizează…' : 'Conectează CareLink'}
    </button>
    <dialog ref={dialog} className="carelink-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby="carelink-title">
      <div className="carelink-heading"><h2 id="carelink-title">Conectare CareLink</h2><button type="button" className="icon-button" aria-label="Închide" onClick={() => setOpen(false)}>×</button></div>
      {error && <div className="error" role="alert">{error}</div>}
      {connectionError && <div className="error" role="status">{connectionError} Reconectarea se încearcă automat; calendarul rămâne disponibil.</div>}
      <div className="carelink-normal-login">
        <p className="carelink-help">Dacă CAPTCHA respinge autentificarea, folosește browserul tău obișnuit. Selectează țara și autentifică-te acolo, apoi descarcă Data Export (CSV).</p>
        <p className="carelink-help">La activare, aplicația urmărește doar CSV-urile noi din <strong>{status.downloadDirectory || 'folderul Downloads'}</strong> și importă automat exporturile CareLink. Fișierele existente sunt ignorate.</p>
        <a className="secondary-button" href="https://carelink.minimed.com/app/login" target="_blank" rel="noopener noreferrer"
          aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); else action('/api/carelink/normal-login', {}); }}>Deschide în browserul tău</a>
      </div>
      {!active && <form onSubmit={login} className="carelink-form">
        <label>Țara<select name="country" defaultValue="România" required>{CARELINK_COUNTRIES.map(country => <option key={country} value={country}>{country}</option>)}</select></label>
        <label>Email / utilizator<input name="username" autoComplete="username" maxLength="320" placeholder="Opțional — poți completa direct în CareLink" /></label>
        <label>Parolă<input name="password" type="password" autoComplete="current-password" maxLength="1024" placeholder="Opțional" /></label>
        <p className="carelink-help">Se deschide o fereastră CareLink. Completează acolo codul de verificare, dacă este cerut. Parola nu este salvată de aplicație.</p>
        <button className="primary-button" disabled={busy}>{busy ? 'Se deschide…' : 'Continuă în CareLink'}</button>
      </form>}
      {(active || status.message) && <p className="carelink-status" role="status">{status.message}</p>}
      {active && <div className="carelink-actions"><button className="primary-button" disabled={busy || ['connecting', 'syncing'].includes(status.state)} onClick={() => action('/api/carelink/sync', {})}>{status.mode === 'normal' ? 'Verifică descărcările' : 'Sincronizează'}</button><button className="text-button" disabled={busy} onClick={() => action('/api/carelink/disconnect', {})}>{status.mode === 'normal' ? 'Oprește preluarea' : 'Deconectează'}</button></div>}
      {status.state === 'error' && <button className="text-button" disabled={busy} onClick={() => action('/api/carelink/disconnect', {})}>Resetează sesiunea</button>}
    </dialog>
  </>;
}
