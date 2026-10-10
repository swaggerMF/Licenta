import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDownloadedCsv } from './parser.mjs';
import { DownloadWatcher, downloadsDirectory } from './download-watcher.mjs';

const LOGIN_URL = 'https://carelink.minimed.com/app/login';
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function browserOptions({ headless = false } = {}) {
  const systemBrowser = process.env.CARELINK_BROWSER_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  return { headless, ...(systemBrowser ? { executablePath: systemBrowser } : {}) };
}

async function visible(locator) {
  return locator.first().isVisible().catch(() => false);
}

export class CareLinkSession {
  constructor({ launch = options => chromium.launch(options), parseDownload = readDownloadedCsv } = {}) {
    this.launch = launch;
    this.parseDownload = parseDownload;
    this.state = 'idle';
    this.message = '';
    this.entries = [];
    this.revision = 0;
    this.generation = 0;
    this.syncBusy = false;
  }

  status() {
    return { state: this.state, message: this.message, revision: this.revision, updatedAt: this.updatedAt || null,
      mode: this.normalMode ? 'normal' : 'automated', downloadDirectory: downloadsDirectory() };
  }

  async startNormalLogin() {
    await this.disconnect();
    const generation = this.generation;
    this.normalMode = true;
    const watcher = new DownloadWatcher({ onEntries: entries => {
      if (generation !== this.generation) return;
      this.entries = entries;
      this.revision++;
      this.updatedAt = new Date().toISOString();
      this.state = 'ready';
      this.message = 'Exportul descărcat a fost preluat. Calendarul a fost actualizat.';
    } });
    this.watcher = watcher;
    try {
      await watcher.start();
      if (generation !== this.generation) { watcher.stop(); return; }
      this.state = 'awaiting_export';
      this.message = `Autentifică-te în browserul tău, apoi descarcă Data Export (CSV) în ${downloadsDirectory()}. Fișierele CareLink noi sunt preluate automat.`;
    } catch {
      if (generation !== this.generation) return;
      this.normalMode = false;
      this.state = 'error';
      this.message = `Folderul de descărcări nu poate fi citit: ${downloadsDirectory()}. Configurează CARELINK_DOWNLOAD_DIR sau folosește Importă CSV.`;
      throw new Error(this.message);
    }
  }

  startLogin(credentials) {
    if (this.browser || this.normalMode || this.state === 'connecting') throw new Error('Există deja o sesiune. Deconectează-te înainte de o conectare nouă.');
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
      this.context = context;
      const attach = page => {
        page.on('download', download => this.consumeDownload(download, generation));
      };
      context.on('page', attach);
      browser.on('disconnected', () => {
        if (this.browser !== browser || generation !== this.generation) return;
        this.browser = null;
        this.context = null;
        this.state = 'idle';
        this.message = 'Fereastra CareLink a fost închisă. Reconectează-te pentru sincronizare.';
      });
      const page = await context.newPage();
      this.page = page;
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const warning = page.locator('#btn-unsupported-close');
      await Promise.race([
        warning.waitFor({ state: 'visible', timeout: 15000 }),
        page.locator('#landing-login-button-id').waitFor({ state: 'visible', timeout: 15000 }),
      ]).catch(() => {});
      if (await visible(warning)) await warning.click();
      const countrySelect = page.getByRole('combobox').first();
      if (await countrySelect.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
        await countrySelect.click();
        const options = await page.getByRole('option').allTextContents();
        const selected = options.find(option => normalize(option) === normalize(credentials.country));
        if (selected) await page.getByRole('option').filter({ hasText: new RegExp(`^\\s*${selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).click();
        else {
          await page.keyboard.press('Escape');
          this.message = 'Selectează țara în fereastra CareLink și continuă autentificarea.';
        }
        const signIn = page.locator('#landing-login-button-id');
        if (selected && await visible(signIn)) await signIn.click();
      }
      if (generation !== this.generation) return;
      this.state = 'awaiting_login';
      this.message ||= 'Finalizează autentificarea în fereastra CareLink, inclusiv codul de verificare dacă este cerut.';
      // Credentials are used only on the official login page and are never persisted.
      await this.fillCredentials(page, credentials).catch(() => {});
    } finally {
      credentials.password = '';
      credentials.username = '';
    }
    if (generation === this.generation && this.browser) {
      if (this.state === 'awaiting_login') this.message = 'Finalizează autentificarea în fereastra CareLink. După conectare, exportul va fi încercat automat.';
      this.watchLogin(generation).catch(() => {});
    }
  }

  async fillCredentials(page, { username, password }) {
    if (!username || !password) return;
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
    const hostname = new URL(page.url()).hostname;
    if (!/(^|\.)(minimed\.com|minimed\.eu|medtronic\.com|medtronicdiabetes\.com)$/.test(hostname)) return;
    const userInput = page.locator('input[name="username"], input[name="email"], input[type="email"], input[autocomplete="username"], input#username').first();
    if (!await visible(userInput)) return;
    await userInput.fill(username);
    await passwordInput.fill(password);
    const submit = page.getByRole('button', { name: /^(sign in|log in|login|conectare|autentificare)$/i }).first();
    if (await visible(submit)) await submit.click();
  }

  reportsLocator(page) {
    return page.getByRole('link', { name: /^(reports|rapoarte)$/i })
      .or(page.getByRole('button', { name: /^(reports|rapoarte)$/i }))
      .or(page.locator('a[href*="/reports"]'));
  }

  exportLocator(page) {
    return page.getByRole('button', { name: /data export.*csv|export.*csv/i })
      .or(page.getByRole('link', { name: /data export.*csv|export.*csv/i }))
      .or(page.getByText(/^Data Export\s*\(CSV\)$/i));
  }

  async watchLogin(generation) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (generation === this.generation && this.context && Date.now() < deadline) {
      for (const page of this.context.pages()) {
        if (!/^https:\/\/carelink\.minimed\.(com|eu)\//.test(page.url())) continue;
        if (await visible(this.reportsLocator(page)) || await visible(this.exportLocator(page))) {
          this.page = page;
          if (this.revision) return;
          this.state = 'connected';
          this.message = 'Conectat la CareLink.';
          await this.sync();
          return;
        }
      }
      await delay(1500);
    }
    if (generation === this.generation && this.state === 'awaiting_login') {
      this.message = 'Autentificarea nu a fost confirmată. Completează login-ul și apasă Sincronizează, sau reconectează-te.';
    }
  }

  async sync() {
    if (this.normalMode) {
      await this.watcher?.scan();
      return;
    }
    if (!this.context || !this.page || this.page.isClosed()) throw new Error('Deschide mai întâi o sesiune CareLink.');
    if (this.syncBusy) return;
    this.syncBusy = true;
    const generation = this.generation;
    try {
      this.state = 'syncing';
      this.message = 'Se caută exportul CSV în Reports…';
      const page = this.page;
      if (!await visible(this.exportLocator(page))) {
        const reports = this.reportsLocator(page);
        if (await visible(reports)) {
          await reports.first().click();
          await this.exportLocator(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        }
      }
      const exportButton = this.exportLocator(page).first();
      if (!await visible(exportButton) || !await exportButton.isEnabled()) {
        this.state = 'awaiting_export';
        this.message = 'În fereastra CareLink, deschide Reports, alege perioada și apasă Data Export (CSV). Fișierul va fi preluat automat.';
        return;
      }
      this.message = 'Se descarcă CSV-ul pentru perioada selectată în CareLink…';
      const downloaded = page.waitForEvent('download', { timeout: 60000 });
      // A download listener on every page handles parsing and state changes.
      await Promise.all([downloaded, exportButton.click()]);
    } catch {
      if (generation === this.generation && this.browser) {
        this.state = 'awaiting_export';
        this.message = 'Exportul automat nu s-a finalizat. Poți apăsa Data Export (CSV) în fereastra CareLink; descărcarea va fi preluată automat.';
      }
    } finally { if (generation === this.generation) this.syncBusy = false; }
  }

  async consumeDownload(download, generation) {
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
      this.entries = entries;
      this.revision++;
      this.updatedAt = new Date().toISOString();
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
    this.page = null;
    await browser?.close().catch(() => {});
  }

  async disconnect() {
    this.generation++;
    this.watcher?.stop();
    this.watcher = null;
    this.normalMode = false;
    await this.closeBrowser();
    this.entries = [];
    this.revision = 0;
    this.updatedAt = null;
    this.state = 'idle';
    this.message = '';
    this.syncBusy = false;
    this.parsingDownload = false;
  }
}
