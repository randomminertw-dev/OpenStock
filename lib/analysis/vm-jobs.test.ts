import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({find:vi.fn(),write:vi.fn(),update:vi.fn(),base:vi.fn()}));
vi.mock('@/database/mongoose',()=>({connectToDatabase:async()=>({})}));
vi.mock('@/database/models/research-vm-job.model',()=>({ResearchVmJobModel:{init:async()=>{},findOne:mocks.find,findOneAndUpdate:mocks.write,updateOne:mocks.update}}));
vi.mock('@/database/models/research-report.model',()=>({ResearchReportModel:{findOne:mocks.base}}));
import {enqueueVmResearch,readVmResearch} from './vm-jobs';
import type {PublishedResearchReport} from './types';
const id='00000000-0000-0000-0000-000000000000';
beforeEach(()=>vi.clearAllMocks());
it('reads a job only through its authenticated owner',async()=>{mocks.find.mockReturnValue({lean:async()=>null});expect(await readVmResearch('alice',id)).toMatchObject({ok:false});expect(mocks.find).toHaveBeenCalledWith({userId:'alice',jobId:id});});
it('failed job explicit regeneration uses a fresh job identity and clears the old lease',async()=>{
 const old={jobId:id,status:'failed'};mocks.write.mockReturnValueOnce({lean:async()=>old}).mockReturnValueOnce({lean:async()=>({jobId:'new-job',status:'queued'})});
 const report={id:'r',snapshot:{symbol:'AAPL',inputHash:'h'}} as PublishedResearchReport;
 expect(await enqueueVmResearch('alice',report)).toBe('new-job');
 expect(mocks.write.mock.calls[1][0]).toEqual({userId:'alice',baseReportId:'r',jobId:id,status:'failed'});
 expect(mocks.write.mock.calls[1][1].$unset).toMatchObject({token:1,result:1});
});
it('rejects a completed prediction when the underlying snapshot differs',async()=>{
 mocks.find.mockReturnValue({lean:async()=>({jobId:id,status:'completed',baseReportId:'r',inputHash:'h',result:{probability:.6}})});
 mocks.base.mockReturnValue({lean:async()=>({report:{snapshot:{symbol:'AAPL',inputHash:'different',dataDate:'2026-10-15',source:{provider:'alpaca'},market:'us'}}})});
 expect(await readVmResearch('alice',id)).toMatchObject({ok:true,status:'failed'});expect(mocks.base).toHaveBeenCalledWith({userId:'alice','report.id':'r'});
});
