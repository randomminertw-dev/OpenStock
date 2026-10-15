export interface VmPrediction {
    executor:'oracle-python';capability:'calibrated-model';modelVersion:string;calibration:'independent-sigmoid';featureVersion:'research-ml-features-v1';
    probability:number;horizon:number;horizonUnit:'trading_day'|'calendar_day';labelPolicy:string;asof:string;inputHash:string;symbol:string;provider:string;
}
export function vmEnabled(env:Record<string,string|undefined>=process.env){return env.RESEARCH_VM_ENABLED==='true';}
export function validVmPrediction(value:unknown, context:{symbol:string;inputHash:string;dataDate:string;market:string;source:{provider:string}}):value is VmPrediction {
    if(!value||typeof value!=='object')return false;
    const v=value as VmPrediction;const crypto=context.market==='crypto';
    return v.executor==='oracle-python'&&v.capability==='calibrated-model'&&v.calibration==='independent-sigmoid'&&v.featureVersion==='research-ml-features-v1'
        &&typeof v.modelVersion==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v.modelVersion)&&Number.isFinite(v.probability)&&v.probability>=0&&v.probability<=1
        &&v.symbol===context.symbol&&v.inputHash===context.inputHash&&v.asof===context.dataDate&&v.provider===context.source.provider
        &&v.horizon===(crypto?30:20)&&v.horizonUnit===(crypto?'calendar_day':'trading_day')&&v.labelPolicy===(crypto?'crypto-close-positive-v1':'stock-adjusted-positive-v1');
}
export type VmJobStatus={ok:true;id:string;status:'queued'|'running'|'completed'|'failed';prediction?:VmPrediction;message?:string}|{ok:false;message:string};
