import nextEnv from '@next/env';

/** Load Next.js env files before importing modules that capture database config. */
export function loadTaiwanSyncEnvironment(directory = process.cwd()) {
    nextEnv.loadEnvConfig(directory, process.env.NODE_ENV !== 'production');
}
