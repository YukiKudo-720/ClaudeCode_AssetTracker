// Workaround for Prisma 6.x auto-install behavior in pnpm workspaces.
//
// Problem: `prisma generate` always tries to spawn `pnpm add prisma@x.x.x -D --silent`
// to "ensure" prisma is installed. On Windows, Node's child_process.spawn with
// shell:false (which Prisma uses) cannot find `pnpm.cmd` via PATHEXT lookup.
// Even with corepack-managed pnpm, the spawn fails with ENOENT, blocking generate.
//
// Solution: install a no-op `pnpm.cmd` shim into apps/server/node_modules/.bin/
// so that Prisma's auto-install "succeeds" (does nothing, since the packages are
// already installed via `corepack pnpm install`). Real package management is done
// via `corepack pnpm ...` directly, which bypasses the shim entirely.
//
// This script runs as a postinstall hook and re-creates the shim after every
// pnpm install (which would otherwise clean it up).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const targets = [
  join(repoRoot, 'apps', 'server', 'node_modules', '.bin'),
];

const cmdContent = [
  '@echo off',
  'REM No-op shim for Prisma auto-install. See scripts/install-prisma-shim.mjs.',
  'exit /b 0',
  '',
].join('\r\n');

for (const dir of targets) {
  if (!existsSync(dir)) {
    console.warn(`[prisma-shim] skipped (no dir): ${dir}`);
    continue;
  }
  const file = join(dir, 'pnpm.CMD');
  writeFileSync(file, cmdContent);
  console.log(`[prisma-shim] installed: ${file}`);
}
