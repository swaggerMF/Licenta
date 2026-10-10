import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = path.join(root, 'frontend/.cache/parser');
let compilation;

async function ensureParser() {
  if (!compilation) compilation = (async () => {
    await mkdir(path.dirname(binary), { recursive: true });
    const source = await stat(path.join(root, 'main.cpp'));
    const compiled = await stat(binary).catch(() => null);
    if (!compiled || compiled.mtimeMs < source.mtimeMs) {
      await exec('g++', ['-std=c++20', '-O2', path.join(root, 'main.cpp'), '-o', binary], { timeout: 60000 });
    }
    return binary;
  })().catch(error => { compilation = null; throw error; });
  return compilation;
}

export async function parseCsvFile(filename) {
  const parser = await ensureParser();
  const { stdout } = await exec(parser, [filename, '--json'], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries) || !entries.length) throw new Error('CSV-ul nu conține date valide în secțiunea Sensor.');
  return entries;
}

export async function parseCsvText(text) {
  const directory = await mkdtemp(path.join(tmpdir(), 'carelink-import-'));
  try {
    const filename = path.join(directory, 'export.csv');
    await writeFile(filename, text, { mode: 0o600 });
    return await parseCsvFile(filename);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function readDownloadedCsv(filename) {
  const size = (await stat(filename)).size;
  if (size > 20 * 1024 * 1024) throw new Error('CSV-ul depășește limita de 20 MB. Selectează o perioadă mai scurtă.');
  // Check content, not just the filename supplied by the site.
  const text = await readFile(filename, 'utf8');
  if (!text.includes(';Sensor;')) throw new Error('Fișierul descărcat nu este un export CSV de senzor CareLink.');
  return parseCsvFile(filename);
}
