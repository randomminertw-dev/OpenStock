import { readFileSync } from 'node:fs';
import { createResearchSnapshot, RESEARCH_ENGINE_VERSION } from '../lib/analysis/snapshot';
import { defaultFactorPreference } from '../lib/indicators/factor-periods';
import { buildHistoricalRows, type HistoryBundle } from '../lib/analysis/history-dataset';
import { analyzeResearch } from '../lib/analysis/engine';
import { renderResearchMarkdown } from '../lib/analysis/template';
import type { ResearchSnapshot } from '../lib/analysis/types';
try {
    if(process.argv[2]==='self-test'){
        const candles=Array.from({length:300},(_,i)=>({t:Date.parse('2025-01-01T00:00:00Z')/1000+i*86400,o:100+i,h:104+i,l:99+i,c:103+i,v:1000}));
        const snapshot=createResearchSnapshot({symbol:'BINANCE:BTCUSDT',source:{provider:'binance',symbol:'BTCUSDT',timeZone:'UTC'},candles,preference:defaultFactorPreference('crypto'),now:new Date((candles[299].t+86400)*1000)});
        process.stdout.write(JSON.stringify({engineVersion:RESEARCH_ENGINE_VERSION,indicators:snapshot.indicators.length}));
    } else {
    const raw=readFileSync(0,'utf8');
    if(Buffer.byteLength(raw)>64*1024*1024) throw new Error('Input too large');
    const value=JSON.parse(raw);
    if(process.argv[2]==='history') for(const row of buildHistoricalRows(value as HistoryBundle)) process.stdout.write(JSON.stringify(row)+'\n');
    else if(process.argv[2]==='rules') {const snapshot=value as ResearchSnapshot;const analysis=analyzeResearch(snapshot);process.stdout.write(JSON.stringify({analysis,markdown:renderResearchMarkdown(snapshot,analysis)}));}
    else throw new Error('Usage: research-node-entry self-test|history|rules < input.json');
    }
} catch { process.stderr.write('Research bridge input/analysis failed\n');process.exitCode=1; }
