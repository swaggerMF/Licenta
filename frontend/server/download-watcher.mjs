import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { readDownloadedCsv } from './parser.mjs';

export function downloadsDirectory() {
  if (process.env.CARELINK_DOWNLOAD_DIR) return path.resolve(process.env.CARELINK_DOWNLOAD_DIR);
  return [path.join(homedir(), 'Downloads'), path.join(homedir(), 'Descărcări')].find(existsSync)
    || path.join(homedir(), 'Downloads');
}

// Only new/changed CSV files are considered; existing downloads are never imported.
// Wait for an unchanged size/mtime across two scans before reading a download.
export class DownloadWatcher {
  constructor({ directory = downloadsDirectory(), parseFile = readDownloadedCsv, onEntries, interval = 1500 }) {
    this.directory = directory;
    this.parseFile = parseFile;
    this.onEntries = onEntries;
    this.interval = interval;
    this.seen = new Map();
    this.pending = new Map();
    this.stopped = true;
  }

  async files() {
    const files = new Map();
    for (const name of await readdir(this.directory)) {
      if (!/\.csv$/i.test(name)) continue;
      const filename = path.join(this.directory, name);
      const info = await stat(filename).catch(() => null);
      if (info?.isFile()) files.set(filename, `${info.size}:${info.mtimeMs}`);
    }
    return files;
  }

  async start() {
    this.seen = await this.files();
    this.stopped = false;
    if (this.interval) this.timer = setInterval(() => this.scan().catch(() => {}), this.interval);
  }

  async scan() {
    if (this.stopped || this.scanning) return;
    this.scanning = true;
    try {
      const files = await this.files();
      for (const [filename, signature] of files) {
        if (this.stopped) return;
        if (this.seen.get(filename) === signature) continue;
        if (this.pending.get(filename) !== signature) {
          this.pending.set(filename, signature);
          continue;
        }
        try {
          const entries = await this.parseFile(filename);
          // If the file changed during parsing, wait until it is stable again.
          const current = await stat(filename);
          if (`${current.size}:${current.mtimeMs}` !== signature) continue;
          if (!this.stopped) await this.onEntries(entries);
        } catch {
          // Other CSV files or incomplete/invalid exports do not replace the calendar.
        }
        this.seen.set(filename, signature);
        this.pending.delete(filename);
      }
      for (const filename of this.pending.keys()) if (!files.has(filename)) this.pending.delete(filename);
    } finally { this.scanning = false; }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
