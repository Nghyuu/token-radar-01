// Token Radar, radar-2: the entrypoint.
//
// The program turns one frozen DefiLlama snapshot into the radar the page
// shows: a board of pre-token protocols ranked by implied launch value, a
// data script the dashboard reads with no fetch, the dashboard and its
// screenshots copied alongside, and a dossier the judge reads. Nothing is
// fetched and nothing is hard-coded to a protocol: the snapshot alone
// decides the ranking, so a new snapshot ranks a new universe untouched.
//
// Usage, from this repository's root:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// Without --input it reads /input/snapshot.json; without
// MAKEFUN_OUTPUT_DIR it writes to out/ next to this file.

import { cpSync as copyTree, mkdirSync as makeDir, readFileSync as readText, writeFileSync as writeText } from 'node:fs';
import { dirname as dirOf, join as joinPath } from 'node:path';
import { fileURLToPath as pathOfModule } from 'node:url';
import { boardIssue as boardProblem, buildRadar as buildTheRadar, dataScript as renderData, parseSnapshot as parseTheSnapshot } from './lib/model.ts';
import { buildDossier as buildTheDossier } from './vendor/makefun-board.ts';

const DEFAULT_INPUT = '/input/snapshot.json';
const DOSSIER_TEXT_LIMIT = 65536;

function optionAfter(argv: string[], flag: string): string | undefined {
  for (let i = 0; i + 1 < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) return argv[i + 1];
    if (arg !== undefined && arg.startsWith(flag + '=')) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function buildAll(): void {
  const argv = process.argv.slice(2);
  const root = dirOf(pathOfModule(import.meta.url));
  const snapshotPath = optionAfter(argv, '--input') ?? DEFAULT_INPUT;
  const outRoot = process.env.MAKEFUN_OUTPUT_DIR ?? joinPath(root, 'out');

  const snapshot = parseTheSnapshot(readText(snapshotPath, 'utf8'));
  const { board, radar } = buildTheRadar(snapshot);
  const problem = boardProblem(board, snapshot);
  if (problem !== null) throw new Error(`board refused: ${problem}`);

  makeDir(outRoot, { recursive: true });
  writeText(joinPath(outRoot, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeText(joinPath(outRoot, 'data.js'), renderData(radar));
  copyTree(joinPath(root, 'dashboard'), joinPath(outRoot, 'dashboard'), { recursive: true });
  copyTree(joinPath(root, 'screenshots'), joinPath(outRoot, 'screenshots'), { recursive: true });
  const dossier = buildTheDossier(outRoot, { text_max_bytes: DOSSIER_TEXT_LIMIT });
  writeText(joinPath(outRoot, 'dossier.json'), dossier);
  console.log(`token-radar: ${board.length} rows, ${radar.live_size} live rows, dossier ${dossier.length} bytes, wrote ${outRoot}`);
}

buildAll();
