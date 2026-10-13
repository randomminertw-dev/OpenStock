import { describe, expect, it } from 'vitest';
import { runCli } from '../scripts/taiwan-sync-entry';

describe('taiwan:sync CLI', () => {
    it('--dry-run 列出預計 URL、任務數與目標環境標籤，不讀寫 DB 也不呼叫上游', async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const io = {
            log: (msg: string) => stdout.push(msg),
            error: (msg: string) => stderr.push(msg),
        };

        const exitCode = await runCli([
            '--dry-run',
            '--symbols', 'TWSE:2330,TWSE:0050,TPEX:6488,TPEX:00679B',
            '--days', '800',
        ], {}, io);

        expect(exitCode).toBe(0);
        const output = stdout.join('\n');

        // Must print target env label
        expect(output).toMatch(/target/i);
        // Must print task counts
        expect(output).toMatch(/tasks|units|planned/i);
        // Must print planned URLs for TWSE and TPEX
        expect(output).toContain('twse.com.tw');
        expect(output).toContain('tpex.org.tw');

        // Must indicate dry-run mode
        expect(output).toMatch(/dry-run/i);
    });

    it('--apply 缺少 --target 參數時退出非 0', async () => {
        const stderr: string[] = [];
        const io = {
            log: () => {},
            error: (msg: string) => stderr.push(msg),
        };

        const env = {
            TAIWAN_MAX_REQUESTS_PER_DAY: '100',
            TAIWAN_MAX_JOBS_PER_DAY: '10',
            TAIWAN_MAX_TRANSFER_BYTES_PER_DAY: '50000000',
            TAIWAN_MAX_STORAGE_BYTES: '100000000',
            TAIWAN_MAX_TRACKED_SECURITIES: '50',
            TAIWAN_MAX_RESPONSE_BYTES: '10000000',
        };

        const exitCode = await runCli([
            '--apply',
            '--symbols', 'TWSE:2330',
        ], env, io);

        expect(exitCode).not.toBe(0);
        expect(stderr.join('\n')).toMatch(/--target/);
    });

    it('--apply 缺少明確 budget 環境變數時退出非 0', async () => {
        const stderr: string[] = [];
        const io = {
            log: () => {},
            error: (msg: string) => stderr.push(msg),
        };

        // Empty env (no budget)
        const exitCode = await runCli([
            '--apply',
            '--target', 'production',
            '--symbols', 'TWSE:2330',
        ], {}, io);

        expect(exitCode).not.toBe(0);
        expect(stderr.join('\n')).toMatch(/budget/i);
    });

    it('支援 close、catalog、details 或特定範圍 history 工作模式', async () => {
        const stdout: string[] = [];
        const io = {
            log: (msg: string) => stdout.push(msg),
            error: () => {},
        };

        const codeClose = await runCli(['--dry-run', '--close'], {}, io);
        expect(codeClose).toBe(0);
        expect(stdout.join('\n')).toMatch(/close/i);

        stdout.length = 0;
        const codeCatalog = await runCli(['--dry-run', '--catalog'], {}, io);
        expect(codeCatalog).toBe(0);
        expect(stdout.join('\n')).toMatch(/catalog/i);

        stdout.length = 0;
        const codeDetails = await runCli(['--dry-run', '--details', '--symbols', 'TWSE:2330'], {}, io);
        expect(codeDetails).toBe(0);
        expect(stdout.join('\n')).toMatch(/details/i);
    });
});
