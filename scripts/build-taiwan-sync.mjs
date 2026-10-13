import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

console.log('Building Taiwan sync CLI into .taiwan-sync/...');
mkdirSync('.taiwan-sync', { recursive: true });
execSync(
    'npx tsc --module commonjs --target es2022 --moduleResolution node --outDir .taiwan-sync --skipLibCheck true --rootDir . scripts/taiwan-sync-entry.ts',
    { stdio: 'inherit' }
);
console.log('Taiwan sync CLI build completed successfully.');
