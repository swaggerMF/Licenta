import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const input = process.env.CSV_PATH ? path.resolve(process.env.CSV_PATH) : path.join(root, 'in.csv');
const output = path.join(root, 'frontend/public/data.json');
mkdirSync(path.dirname(output), { recursive: true });
if (!existsSync(input)) {
  writeFileSync(output, '[]');
  console.log('Nu există CSV local. Importă un fișier din interfață.');
} else {
  mkdirSync(path.join(root, 'frontend/.cache'), { recursive: true });
  const binary = path.join(root, 'frontend/.cache/parser');
  execFileSync('g++', ['-std=c++20', '-O2', path.join(root, 'main.cpp'), '-o', binary], { stdio: 'inherit' });
  const json = execFileSync(binary, [input, '--json'], { maxBuffer: 50 * 1024 * 1024 });
  JSON.parse(json.toString());
  writeFileSync(output, json);
  console.log('Datele parserului C++ au fost exportate pentru calendar.');
}
