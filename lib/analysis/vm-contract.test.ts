import { it,expect } from 'vitest';
import { validVmPrediction, vmEnabled } from './vm-contract';
it('defaults disabled and only accepts explicitly enabled mode',()=>{expect(vmEnabled({})).toBe(false);expect(vmEnabled({RESEARCH_VM_ENABLED:'true'})).toBe(true);});
it('rejects invalid, stale or mismatched prediction fields',()=>{
 const context={symbol:'AAPL',inputHash:'hash',dataDate:'2026-10-15',source:{provider:'alpaca'},market:'us'};
 const result={executor:'oracle-python',capability:'calibrated-model',modelVersion:'v1',calibration:'independent-sigmoid',featureVersion:'research-ml-features-v1',probability:.6,horizon:20,horizonUnit:'trading_day',labelPolicy:'stock-adjusted-positive-v1',asof:context.dataDate,inputHash:'hash',symbol:'AAPL',provider:'alpaca'};
 expect(validVmPrediction(result,context)).toBe(true);for(const patch of [{probability:NaN},{probability:1.2},{symbol:'TSLA'},{asof:'2026-10-14'},{horizon:30},{calibration:'none'}])expect(validVmPrediction({...result,...patch},context)).toBe(false);
});
