import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), generate: vi.fn(), load: vi.fn(), repo: vi.fn() }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocked.auth }));
vi.mock('@/lib/analysis/repository', () => ({ createResearchReportRepository: mocked.repo }));
vi.mock('@/lib/analysis/service', () => ({ createResearchReportService: () => ({ generate: mocked.generate }) }));
vi.mock('@/lib/analysis/load', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/analysis/load')>(), loadResearchSnapshot: mocked.load }));
// load.ts imports preferences, whose database setup is outside this action's auth boundary.
vi.mock('@/lib/actions/factor-preferences.actions', () => ({ getFactorPreference: vi.fn() }));
import { generateResearchReport, getResearchReports } from './research-report.actions';
beforeEach(() => { vi.clearAllMocks(); mocked.auth.mockResolvedValue('alice'); mocked.list.mockResolvedValue([]); mocked.repo.mockReturnValue({ list: mocked.list }); });
describe('research server action boundaries', () => {
    it('rejects unauthenticated requests before any repository or source access', async () => {
        mocked.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        expect(await generateResearchReport('2330.TW')).toMatchObject({ ok: false, code: 'unauthorized' });
        expect(mocked.repo).not.toHaveBeenCalled(); expect(mocked.load).not.toHaveBeenCalled();
    });
    it('reads only the session owner and canonical market symbol', async () => {
        expect(await getResearchReports('2330.TW')).toEqual({ ok: true, reports: [] });
        expect(mocked.list).toHaveBeenCalledWith('alice', 'TWSE:2330');
        await getResearchReports('6488.TWO');
        expect(mocked.list).toHaveBeenLastCalledWith('alice', 'TPEX:6488');
        await getResearchReports('CG:BITCOIN');
        expect(mocked.list).toHaveBeenLastCalledWith('alice', 'CG:bitcoin');
    });
    it('validates symbols without calling upstream or accepting arbitrary owner IDs', async () => {
        expect(await generateResearchReport('$where')).toMatchObject({ ok: false, code: 'unsupported-symbol' });
        expect(mocked.repo).not.toHaveBeenCalled();
        mocked.generate.mockResolvedValue({ ok: false, code: 'busy', message: 'busy' });
        await generateResearchReport('NASDAQ:AAPL');
        expect(mocked.generate).toHaveBeenCalledWith('alice', 'AAPL');
    });
});
