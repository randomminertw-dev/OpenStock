'use client';
import {useEffect,useState} from 'react';
import {getVmResearchForReport,getVmResearchStatus} from '@/lib/actions/research-report.actions';
import type {PublishedResearchReport} from '@/lib/analysis/types';
import {validVmPrediction,type VmJobStatus} from '@/lib/analysis/vm-contract';
export default function VmResearchStatus({report,jobId}:{report:PublishedResearchReport;jobId?:string}){
    const [state,setState]=useState<VmJobStatus|null>(null);
    useEffect(()=>{
        let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;let id=jobId;let attempts=0;setState(null);
        async function poll(){
            try{
                const result=id?await getVmResearchStatus(id):await getVmResearchForReport(report.id);
                if(cancelled)return;
                if(!result){setState(null);return;}
                setState(result);
                if(result.ok&&(result.status==='queued'||result.status==='running')){
                    id=result.id;if(++attempts<120)timer=setTimeout(poll,5000);
                    else setState({ok:false,message:'VM 查詢已逾時，基本規則報告仍可閱讀。'});
                }
            }catch{if(!cancelled)setState({ok:false,message:'VM 狀態暫時無法讀取，基本規則報告仍可閱讀。'});}
        }
        void poll();return()=>{cancelled=true;if(timer)clearTimeout(timer);};
    },[report.id,jobId]);
    if(!state)return null;
    const prediction=state.ok&&state.status==='completed'&&validVmPrediction(state.prediction,report.snapshot)?state.prediction:null;
    return <aside className="my-3 rounded-xl border border-line p-3 text-xs" aria-label="VM 進階分析">
        {prediction?<><h3 className="font-semibold">VM 進階分析 · 已校準模型</h3><p className="num mt-2 text-lg">{prediction.horizon} {prediction.horizonUnit==='trading_day'?'交易日':'日曆日'}後上漲機率：{(prediction.probability*100).toFixed(1)}%</p><p className="mt-2 break-all text-faint">資料日期 {prediction.asof} · 模型 {prediction.modelVersion} · Oracle Python</p><p className="mt-2 text-faint">{prediction.horizonUnit==='trading_day'?'事件為拆股／股息調整收盤價高於基準日；未扣交易成本。':'事件為原交易對收盤價高於基準日；未扣交易成本。'}模型估計不保證結果。</p></>:<><h3 className="font-semibold">基本規則分析</h3><p className="mt-2 text-faint" role="status">{state.ok&&(state.status==='queued'||state.status==='running')?'基本報告已保存；VM 進階分析處理中。':state.message??'VM 結果無法使用，保留基本規則報告。'}</p></>}
    </aside>;
}
