import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lease: vi.fn(), write: vi.fn(), end: vi.fn(), transaction: vi.fn(), init: vi.fn(), create: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: async () => ({ startSession: async () => ({ withTransaction: mocks.transaction, endSession: mocks.end }) }) }));
vi.mock('@/database/models/research-report-request.model', () => ({ ResearchReportRequestModel: { findOneAndUpdate: mocks.lease, init: mocks.init, create: mocks.create } }));
vi.mock('@/database/models/research-report.model', () => ({ ResearchReportModel: { findOneAndUpdate: mocks.write, init: mocks.init } }));
import { createResearchReportRepository } from './repository';
import type { PublishedResearchReport } from './types';
const report = { snapshot: { symbol: '2330.TW', inputHash: 'hash' }, analysis: { rulesVersion: 'v1' }, publishedAt: '2026-10-15' } as PublishedResearchReport;
beforeEach(() => { vi.clearAllMocks(); mocks.transaction.mockImplementation(async callback => callback()); });
it('never writes a report when its publication lease is expired or replaced', async () => {
    mocks.lease.mockResolvedValue(null);
    await expect(createResearchReportRepository().save('alice', report, 'old-token')).rejects.toThrow('lease expired');
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.end).toHaveBeenCalledOnce();
});
it('checks owner and token and publishes through the same transaction session', async () => {
    mocks.lease.mockResolvedValue({ token: 'token' }); mocks.write.mockReturnValue({ lean: async () => ({ report }) });
    expect(await createResearchReportRepository().save('alice', report, 'token')).toEqual(report);
    const [filter, , options] = mocks.lease.mock.calls[0];
    expect(filter).toMatchObject({ userId: 'alice', token: 'token', lockedUntil: { $gt: expect.any(Date) } });
    expect(mocks.write.mock.calls[0][0]).toEqual({ userId: 'alice', symbol: '2330.TW', inputHash: 'hash', rulesVersion: 'v1' });
    expect(mocks.write.mock.calls[0][2].session).toBe(options.session);
    expect(mocks.end).toHaveBeenCalledOnce();
});
it('does not return a published report when transaction commit fails', async () => {
    mocks.lease.mockResolvedValue({}); mocks.write.mockReturnValue({ lean: async () => ({ report }) });
    mocks.transaction.mockImplementation(async callback => { await callback(); throw new Error('Commit failed'); });
    await expect(createResearchReportRepository().save('alice', report, 'token')).rejects.toThrow('Commit failed');
    expect(mocks.end).toHaveBeenCalledOnce();
});

it('automatically prepares collections and unique indexes before claiming the account lease', async () => {
    mocks.lease.mockResolvedValue(null); mocks.create.mockResolvedValue({});
    const now = new Date('2026-10-15T00:00:00Z');
    expect(await createResearchReportRepository().claim('alice', 'token', now)).toBe(true);
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.lease.mock.calls[0][0]).toEqual({ userId: 'alice', availableAt: { $lte: now }, lockedUntil: { $lte: now } });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ userId: 'alice', token: 'token', availableAt: new Date(now.getTime() + 60000), lockedUntil: new Date(now.getTime() + 120000) });
});
it('treats a competing unique lease insert as busy without stealing ownership', async () => {
    mocks.lease.mockResolvedValue(null); mocks.create.mockRejectedValue({ code: 11000 });
    expect(await createResearchReportRepository().claim('alice', 'token', new Date())).toBe(false);
});
