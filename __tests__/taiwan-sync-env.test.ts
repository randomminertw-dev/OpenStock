import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Taiwan CLI environment initialization', () => {
    const loaderUrl = pathToFileURL(resolve('scripts/taiwan-sync-env.mjs')).href;

    function runWithFixture(existingUri?: string) {
        const directory = mkdtempSync(join(tmpdir(), 'taiwan-env-'));
        writeFileSync(join(directory, '.env.local'), 'MONGODB_URI=mongodb://fixture/local\nTAIWAN_HISTORY_ENABLED=true\n');
        const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
        delete env.__NEXT_PROCESSED_ENV;
        delete env.MONGODB_URI;
        delete env.TAIWAN_HISTORY_ENABLED;
        if (existingUri) env.MONGODB_URI = existingUri;
        try {
            return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
                const { loadTaiwanSyncEnvironment } = await import(${JSON.stringify(loaderUrl)});
                loadTaiwanSyncEnvironment(process.cwd());
                console.log(JSON.stringify({ uri: process.env.MONGODB_URI, history: process.env.TAIWAN_HISTORY_ENABLED }));
            `], { cwd: directory, env, encoding: 'utf8' }).trim());
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    it('loads the same .env.local configuration used by Next.js before the CLI imports MongoDB', () => {
        expect(runWithFixture()).toEqual({ uri: 'mongodb://fixture/local', history: 'true' });
    });

    it('preserves an explicitly supplied database target over the local env file', () => {
        expect(runWithFixture('mongodb://fixture/explicit')).toEqual({ uri: 'mongodb://fixture/explicit', history: 'true' });
    });
});
