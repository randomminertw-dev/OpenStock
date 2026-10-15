import {Schema,model,models,type Model} from 'mongoose';
import type { VmPrediction } from '@/lib/analysis/vm-contract';
export interface ResearchVmJob {
    jobId:string;userId:string;baseReportId:string;symbol:string;inputHash:string;createdAt:Date;deadlineAt:Date;
    status:'queued'|'running'|'completed'|'failed';token?:string;leaseUntil?:Date;result?:VmPrediction;errorCode?:string;
}
const schema=new Schema<ResearchVmJob>({jobId:{type:String,required:true},userId:{type:String,required:true},baseReportId:{type:String,required:true},symbol:{type:String,required:true},inputHash:{type:String,required:true},createdAt:{type:Date,required:true},deadlineAt:{type:Date,required:true},status:{type:String,enum:['queued','running','completed','failed'],required:true},token:String,leaseUntil:Date,result:Schema.Types.Mixed,errorCode:String},{collection:'research_vm_jobs'});
schema.index({userId:1,baseReportId:1},{unique:true});schema.index({jobId:1},{unique:true});schema.index({status:1,deadlineAt:1,createdAt:1});
export const ResearchVmJobModel:Model<ResearchVmJob>=(models.ResearchVmJob as Model<ResearchVmJob>)||model<ResearchVmJob>('ResearchVmJob',schema);
