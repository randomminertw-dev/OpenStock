import {randomUUID} from 'node:crypto';
import {connectToDatabase} from '@/database/mongoose';
import {ResearchVmJobModel} from '@/database/models/research-vm-job.model';
import {ResearchReportModel} from '@/database/models/research-report.model';
import type {PublishedResearchReport} from './types';
import {validVmPrediction,type VmJobStatus} from './vm-contract';
export async function enqueueVmResearch(userId:string,report:PublishedResearchReport){
    await connectToDatabase();await ResearchVmJobModel.init();
    let job=await ResearchVmJobModel.findOneAndUpdate({userId,baseReportId:report.id},{$setOnInsert:{jobId:randomUUID(),userId,baseReportId:report.id,symbol:report.snapshot.symbol,inputHash:report.snapshot.inputHash,status:'queued',createdAt:new Date(),deadlineAt:new Date(Date.now()+600000)}},{upsert:true,new:true}).lean();
    if(!job)throw new Error('Job not saved');
    if(job.status==='failed') {
        const retry=await ResearchVmJobModel.findOneAndUpdate({userId,baseReportId:report.id,jobId:job.jobId,status:'failed'},{$set:{jobId:randomUUID(),status:'queued',createdAt:new Date(),deadlineAt:new Date(Date.now()+600000)},$unset:{token:1,leaseUntil:1,result:1,errorCode:1}},{new:true}).lean();
        if(retry)job=retry;else {const current=await ResearchVmJobModel.findOne({userId,baseReportId:report.id}).lean();if(current)job=current;}
    }
    return job.jobId;
}
export async function readVmResearch(userId:string,jobId:string):Promise<VmJobStatus>{
    if(!/^[a-f0-9-]{36}$/i.test(jobId))return {ok:false,message:'研究工作代碼無效。'};
    await connectToDatabase();let job=await ResearchVmJobModel.findOne({userId,jobId}).lean();
    if(!job)return {ok:false,message:'研究工作不存在或無權讀取。'};
    const now=new Date();
    if((job.status==='queued'||job.status==='running')&&(job.deadlineAt<=now||(job.status==='running'&&job.leaseUntil&&job.leaseUntil<=now))){
        await ResearchVmJobModel.updateOne({userId,jobId,status:job.status,token:job.token},{$set:{status:'failed',errorCode:'expired'}});
        job=await ResearchVmJobModel.findOne({userId,jobId}).lean();if(!job)return {ok:false,message:'研究工作無法讀取。'};
    }
    if(job.status==='completed'){
        const base=await ResearchReportModel.findOne({userId,'report.id':job.baseReportId}).lean();
        if(!base||!validVmPrediction(job.result,base.report.snapshot)||job.inputHash!==base.report.snapshot.inputHash)return {ok:true,id:jobId,status:'failed',message:'VM 結果驗證未通過，保留基本規則報告。'};
        return {ok:true,id:jobId,status:'completed',prediction:job.result};
    }
    return {ok:true,id:jobId,status:job.status,message:job.status==='failed'?'VM 未完成合格進階分析，保留基本規則報告。':undefined};
}

export async function readVmResearchForReport(userId:string,baseReportId:string):Promise<VmJobStatus|null>{
    if(!/^[a-f0-9-]{36}$/i.test(baseReportId))return null;
    await connectToDatabase();const job=await ResearchVmJobModel.findOne({userId,baseReportId}).lean();
    return job?readVmResearch(userId,job.jobId):null;
}
