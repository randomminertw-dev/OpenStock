import { existsSync } from 'fs';
import { fork, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compiledEntry = join(__dirname, '../.taiwan-sync/scripts/taiwan-sync-entry.js');

if (!existsSync(compiledEntry)) {
    console.log('Compiled CLI entry not found. Building first...');
    execSync('node scripts/build-taiwan-sync.mjs', { stdio: 'inherit' });
}

const child = fork(compiledEntry, process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env,
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
