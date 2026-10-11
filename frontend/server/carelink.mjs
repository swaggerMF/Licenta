import { activateControl } from './controls.mjs';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDownloadedCsv } from './parser.mjs';
import { mergeEntries } from '../src/data.js';
import { RangeSelectionError, setReportRange, validateRange } from './report-range.mjs';

const LOGIN_URL = 'https://carelink.minimed.com/app/login';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const REPORTS = /^(reports?|rapoarte|rapporti|rapports|berichte|informes|relatórios|rapporten|raporty)$/i;
const LOGOUT = /log\s*out|sign\s*out|deconectare|ieșire|iesire|esci|disconnetti|déconnexion|abmelden|cerrar sesión|terminar sessão|uitloggen|wyloguj/i;

function carelinkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['carelink.minimed.com', 'carelink.minimed.eu'].includes(url.hostname) ? url : null;
  } catch { return null; }
}

export function browserOptions({ headless = false } = {}) {
  const systemBrowser = process.env.CARELINK_BROWSER_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  return { headless, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    ...(systemBrowser ? { executablePath: systemBrowser } : {}) };
}

async function visible(locator) {
  try {
    for (const item of await locator.all()) if (await item.isVisible()) return true;
  } catch { /* A page can navigate or close during inspection; check again later. */ }
  return false;
}

export class CareLinkSession {
  constructor({ launch = options => chromium.launch(options), parseDownload = readDownloadedCsv } = {}) {
    this.launch = launch;
    this.parseDownload = parseDownload;
    this.state = 'idle';
    this.message = '';
    this.entries = [];
    this.revision = 0;
    this.dataVersion = null;
    this.generation = 0;
    this.syncBusy = false;
    this.downloadQueue = Promise.resolve();
  }

  status() {
    return { state: this.state, message: this.message, revision: this.revision, dataVersion: this.dataVersion, updatedAt: this.updatedAt || null,
      authenticated: Boolean(this.authenticated && this.context), requestedRange: this.requestedRange || null,
      windowBackgrounded: Boolean(this.windowBackgrounded) };
  }

  addEntries(entries) {
    this.entries = mergeEntries(this.entries, entries);
    this.importedLatest = entries.reduce((latest, entry) => entry.date > latest ? entry.date : latest, '');
    this.revision++;
    this.dataVersion = randomUUID();
    this.updatedAt = new Date().toISOString();
  }

  startLogin(credentials = {}) {
    if (this.browser || this.state === 'connecting') throw new Error('Există deja o sesiune. Deconectează-te înainte de o conectare nouă.');
    const generation = ++this.generation;
    this.state = 'connecting';
    this.message = 'Se deschide CareLink…';
    this.connect(credentials, generation).catch(async () => {
      if (generation !== this.generation) return;
      this.state = 'error';
      this.message = 'CareLink nu a putut fi deschis. Verifică conexiunea și instalarea browserului, apoi reconectează-te.';
      await this.closeBrowser();
    });
  }

  async connect(credentials, generation) {
    let browser;
    try {
      browser = await this.launch(browserOptions());
      if (generation !== this.generation) { await browser.close(); return; }
      this.browser = browser;
      const context = await browser.newContext({ acceptDownloads: true, locale: 'en-US' });
      context.setDefaultTimeout(5000);
      this.context = context;
      const attach = page => {
        page.on('download', download => this.consumeDownload(download, generation));
      };
      context.on('page', attach);
      browser.on('disconnected', () => {
        if (this.browser !== browser || generation !== this.generation) return;
        this.browser = null;
        this.context = null;
        this.authenticated = false;
        this.state = 'idle';
        this.message = 'Fereastra CareLink a fost închisă. Reconectează-te pentru sincronizare.';
      });
      const page = await context.newPage();
      this.page = page;
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (generation !== this.generation) return;
      this.state = 'awaiting_login';
      this.message = 'Alege țara și limba English în CareLink și finalizează manual autentificarea, inclusiv mesajele de acceptare și verificările afișate.';
    } finally {
      credentials.password = '';
      credentials.username = '';
    }
    if (generation === this.generation && this.browser) {
      this.watchLogin(generation).catch(() => {});
    }
  }

  reportsLocator(page) {
    return page.getByRole('link', { name: REPORTS })
      .or(page.getByRole('button', { name: REPORTS }))
      .or(page.locator('a[href*="/reports"]'))
      .or(page.getByText(REPORTS));
  }

  async checkLogin(generation = this.generation) {
    const context = this.context;
    if (!context || generation !== this.generation) return false;
    for (const page of context.pages()) {
      try {
        if (page.isClosed() || !carelinkUrl(page.url())) continue;
        const frames = page.frames();
        // A visible login/MFA form takes precedence over a dashboard URL during redirects.
        let loginVisible = false;
        for (const frame of frames) {
          if (await visible(frame.locator('input[type="password"], input[autocomplete="one-time-code"], #landing-login-button-id, [role="dialog"], [role="alertdialog"], dialog[open], mat-dialog-container, mat-legacy-dialog-container'))) loginVisible = true;
        }
        if (loginVisible) continue;
        for (const frame of frames) {
          const url = carelinkUrl(frame.url());
          if (!url) continue;
          const reports = await visible(this.reportsLocator(frame));
          const exported = await visible(this.exportLocator(frame));
          const logout = await visible(frame.getByRole('button', { name: LOGOUT }).or(frame.getByRole('link', { name: LOGOUT })));
          const dashboard = /^\/app\/dashboard\/?$/.test(url.pathname)
            && await visible(frame.locator('main, [role="main"], nav, [role="navigation"], header, mat-toolbar, app-dashboard, [class*="dashboard"]'));
          if (!reports && !exported && !logout && !dashboard) continue;
          if (generation !== this.generation || context !== this.context || page.isClosed()) return false;
          this.page = page;
          this.reportView = frame;
          const justConnected = !this.authenticated;
          this.authenticated = true;
          if (['connecting', 'awaiting_login'].includes(this.state)) {
            this.state = 'connected';
            this.message = 'Conectat la CareLink. Alege perioada din aplicație pentru descărcare.';
          }
          if (justConnected && /^\/app\/dashboard\/?$/.test(url.pathname)) {
            this.reportsNavigation = this.navigateToReports(page).catch(() => {
              this.message = 'Conectat. Reports nu s-a încărcat încă; voi reîncerca la descărcarea perioadei.';
            });
            await this.reportsNavigation;
          }
          if (justConnected && generation === this.generation && context === this.context) this.windowBackgrounded = await this.backgroundWindow(page);
          return true;
        }
      } catch { /* Keep checking other pages when a tab navigates or closes. */ }
    }
    return false;
  }

  exportLocator(page) {
    return page.locator('#p-button-export-reports').or(page.getByRole('button', { name: /data export.*csv|export.*csv/i }))
      .or(page.getByRole('link', { name: /data export.*csv|export.*csv/i }))
      .or(page.getByText(/^Data Export\s*\(CSV\)$/i))
      .and(page.locator(':not(#p-button-export-reports-all-data):not(#p-button-export-reports-all-data *)'));
  }

  async navigateToReports(page) {
    const url = carelinkUrl(page.url());
    if (!url) throw new RangeSelectionError('Pagina CareLink nu este disponibilă. Revino la sesiunea autentificată.');
    if (!/^\/app\/reports\/?$/.test(url.pathname)) {
      await page.goto(new URL('/app/reports', url.origin).href, { waitUntil: 'domcontentloaded', timeout: 12000 });
    }
    this.reportView = page.mainFrame();
  }

  async backgroundWindow(page) {
    let control;
    try {
      // Only minimize the Chromium window owned by this CareLink session.
      control = await page.context().newCDPSession(page);
      const { windowId } = await control.send('Browser.getWindowForTarget');
      await control.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      return true;
    } catch { return false; /* Window managers may reject minimization; keep the login usable. */ }
    finally { await control?.detach().catch(() => {}); }
  }

  async watchLogin(generation) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (generation === this.generation && this.context && Date.now() < deadline) {
      if (await this.checkLogin(generation)) return;
      await delay(1500);
    }
    if (generation === this.generation && this.state === 'awaiting_login') {
      this.message = 'Autentificarea nu a fost confirmată. Dacă vezi dashboard-ul CareLink, apasă Verifică sesiunea.';
    }
  }

  async sync(range) {
    if (range) range = validateRange(range);
    if (!this.context || !this.page || this.page.isClosed()) throw new Error('Deschide mai întâi o sesiune CareLink.');
    if (this.syncBusy || this.parsingDownload) throw new Error('Un export este deja în curs. Așteaptă finalizarea lui.');
    this.syncBusy = true;
    const generation = this.generation;
    try {
      this.state = 'syncing';
      this.message = 'Se caută exportul CSV în Reports…';
      await this.reportsNavigation;
      if (generation !== this.generation) return;
      const page = this.page;
      let view = this.reportView && !this.reportView.isDetached() ? this.reportView : page;
      if (/login|signin/i.test(new URL(page.url()).pathname)) {
        this.authenticated = false;
        this.state = 'awaiting_login';
        this.message = 'Sesiunea CareLink necesită autentificare. Finalizează login-ul în fereastra CareLink.';
        this.watchLogin(generation).catch(() => {});
        return;
      }
      if (!await visible(this.exportLocator(view))) {
        if (carelinkUrl(page.url())) {
          this.message = 'Se deschide pagina Reports…';
          await this.navigateToReports(page);
          view = this.reportView;
        } else {
          const reports = this.reportsLocator(view).filter({ visible: true }).first();
          if (await visible(reports)) await reports.click({ timeout: 5000 });
        }
        await this.exportLocator(view).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 12000 });
      }
      const exportButton = this.exportLocator(view).filter({ visible: true }).first();
      if (range) {
        await setReportRange(view, range, { background: Boolean(this.windowBackgrounded), onProgress: message => { if (generation === this.generation) this.message = message; } });
        if (generation !== this.generation) return;
        this.requestedRange = range;
      }
      if (await visible(exportButton)) await exportButton.and(view.locator(':not(:disabled):not([aria-disabled="true"])'))
        .waitFor({ state: 'visible', timeout: 10000 });
      if (!await visible(exportButton) || !await exportButton.isEnabled({ timeout: 5000 })) {
        this.state = 'awaiting_export';
        this.message = 'În fereastra CareLink, deschide Reports, alege perioada și apasă Data Export (CSV). Fișierul va fi preluat automat.';
        return;
      }
      this.message = 'Se descarcă CSV-ul pentru perioada selectată în CareLink…';
      const downloaded = page.waitForEvent('download', { timeout: 60000 });
      // A download listener on every page handles parsing and state changes.
      await Promise.all([downloaded, activateControl(exportButton, { background: Boolean(this.windowBackgrounded) })]);
    } catch (error) {
      if (generation === this.generation && this.browser) {
        this.state = 'awaiting_export';
        this.message = error instanceof RangeSelectionError ? error.message : 'Exportul automat nu s-a finalizat. Poți apăsa Data Export (CSV) în fereastra CareLink; descărcarea va fi preluată automat.';
      }
    } finally { if (generation === this.generation) this.syncBusy = false; }
  }

  consumeDownload(download, generation) {
    // Several exports may finish while the previous CSV is still being parsed.
    const pending = this.downloadQueue.then(() => this.processDownload(download, generation));
    this.downloadQueue = pending.catch(() => {});
    return pending;
  }

  async processDownload(download, generation) {
    if (generation !== this.generation || this.parsingDownload) return;
    if (!/\.csv$/i.test(download.suggestedFilename())) return;
    this.parsingDownload = true;
    let directory;
    try {
      this.state = 'syncing';
      this.message = 'Se procesează exportul CSV…';
      directory = await mkdtemp(path.join(tmpdir(), 'carelink-download-'));
      const filename = path.join(directory, 'export.csv');
      await download.saveAs(filename);
      const entries = await this.parseDownload(filename);
      if (generation !== this.generation) return;
      this.addEntries(entries);
      this.state = 'ready';
      this.message = 'Calendarul a fost actualizat.';
    } catch {
      if (generation === this.generation) {
        this.state = 'error';
        this.message = 'CSV-ul nu a putut fi procesat. Verifică exportul senzorului și încearcă din nou.';
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      if (generation === this.generation) this.parsingDownload = false;
    }
  }

  async closeBrowser() {
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.authenticated = false;
    this.windowBackgrounded = false;
    this.page = null;
    this.reportView = null;
    this.reportsNavigation = null;
    await browser?.close().catch(() => {});
  }

  async disconnect() {
    this.generation++;
    this.requestedRange = null;
    await this.closeBrowser();
    // Disconnect authentication and monitoring, retaining the imported history.
    this.state = 'idle';
    this.message = '';
    this.syncBusy = false;
    this.parsingDownload = false;
  }
}
