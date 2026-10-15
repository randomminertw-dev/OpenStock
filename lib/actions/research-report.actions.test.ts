import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), generate: vi.fn(), load: vi.fn(), repo: vi.fn(), enqueue:vi.fn(), status:vi.fn(), reportStatus:vi.fn() }));
vi.mock('@/lib/analysis/vm-jobs',()=>({enqueueVmResearch:mocked.enqueue,readVmResearch:mocked.status,readVmResearchForReport:mocked.reportStatus}));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocked.auth }));
vi.mock('@/lib/analysis/repository', () => ({ createResearchReportRepository: mocked.repo }));
vi.mock('@/lib/analysis/service', () => ({ createResearchReportService: () => ({ generate: mocked.generate }) }));
vi.mock('@/lib/analysis/load', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/analysis/load')>(), loadResearchSnapshot: mocked.load }));
// load.ts imports preferences, whose database setup is outside this action's auth boundary.
vi.mock('@/lib/actions/factor-preferences.actions', () => ({ getFactorPreference: vi.fn() }));
import { generateResearchReport, getResearchReports, getVmResearchStatus } from './research-report.actions';
beforeEach(() => { vi.clearAllMocks();vi.stubEnv('RESEARCH_VM_ENABLED','false'); mocked.auth.mockResolvedValue('alice'); mocked.list.mockResolvedValue([]); mocked.repo.mockReturnValue({ list: mocked.list }); });
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

it('keeps the saved basic report when VM enqueue fails', async()=>{
    vi.stubEnv('RESEARCH_VM_ENABLED','true');const result={ok:true,report:{id:'saved'},reused:false};mocked.generate.mockResolvedValue(result);mocked.enqueue.mockRejectedValue(new Error('private db credentials'));
    expect(await generateResearchReport('AAPL')).toMatchObject({...result,vmMessage:'VM 工作暫時無法建立，已提供基本規則報告。'});
    expect(mocked.enqueue).toHaveBeenCalledWith('alice',result.report);
});
it('does not access VM jobs when disabled, and scopes enabled status to session owner', async()=>{
    expect(await getVmResearchStatus('job')).toMatchObject({ok:false});expect(mocked.status).not.toHaveBeenCalled();
    vi.stubEnv('RESEARCH_VM_ENABLED','true');mocked.status.mockResolvedValue({ok:true,id:'job',status:'queued'});
    await getVmResearchStatus('job');expect(mocked.status).toHaveBeenCalledWith('alice','job');
});
