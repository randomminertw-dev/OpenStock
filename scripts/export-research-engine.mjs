import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,lstatSync,existsSync,renameSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isBuiltin} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {buildResearchNode} from './build-research-node.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function files(directory,relative=''){
    const output=[];
    for(const name of readdirSync(path.join(directory,relative)).sort()){
        if(!relative&&name==='node_modules')continue;
        const key=relative?relative+'/'+name:name;const stat=lstatSync(path.join(directory,key));
        if(stat.isSymbolicLink())throw new Error('Engine package cannot contain symlinks');
        if(stat.isDirectory())output.push(...files(directory,key));
        else if(stat.isFile())output.push(key);else throw new Error('Unsupported engine package file');
    }
    return output;
}
function verifyExisting(directory){
    if(lstatSync(directory).isSymbolicLink())throw new Error('Output cannot be a symlink');
    const manifest=JSON.parse(readFileSync(path.join(directory,'manifest.json'),'utf8'));
    if(manifest.schemaVersion!==1||!manifest.files||Array.isArray(manifest.files)||typeof manifest.files!=='object')throw new Error('Unmanaged output directory');
    const actual=files(directory).filter(file=>file!=='manifest.json');const expected=Object.keys(manifest.files).sort();
    if(JSON.stringify(actual.sort())!==JSON.stringify(expected))throw new Error('Output contains unmanaged files');
    for(const file of expected){
        if(path.posix.isAbsolute(file)||file.split('/').some(part=>!part||part==='.'||part==='..')||file.includes('\\'))throw new Error('Unsafe package path');
        if(sha(readFileSync(path.join(directory,file)))!==manifest.files[file])throw new Error('Output was modified; export into a fresh directory');
    }
}
function packageLock(root,dist){
    const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));const entries=lock.packages;
    const dependencies={};const packages={};const pending=[];
    for(const file of files(dist)){
        if(!file.endsWith('.js'))continue;
        const source=readFileSync(path.join(dist,file),'utf8');
        for(const match of source.matchAll(/require\(["']([^"']+)["']\)/g)){
            const spec=match[1];if(spec.startsWith('.')||isBuiltin(spec))continue;
            const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
            const key='node_modules/'+name;if(!entries[key])throw new Error('Runtime dependency missing from lock: '+name);
            dependencies[name]=entries[key].version;pending.push(key);
        }
    }
    while(pending.length){
        const key=pending.pop();if(packages[key])continue;
        const entry=entries[key];if(!entry||entry.link)throw new Error('Unsupported runtime dependency: '+key);
        const selected={...entry};delete selected.dev;delete selected.devOptional;packages[key]=selected;
        for(const name of Object.keys({...entry.dependencies,...entry.optionalDependencies})){
            let parent=key,found;
            while(parent){const candidate=parent+'/node_modules/'+name;if(entries[candidate]){found=candidate;break;}const boundary=parent.lastIndexOf('/node_modules/');parent=boundary<0?'':parent.slice(0,boundary);}
            found??=entries['node_modules/'+name]?'node_modules/'+name:undefined;
            if(!found)throw new Error('Incomplete runtime dependency closure');pending.push(found);
        }
    }
    const pkg={name:'openstock-research-engine',version:'1.0.0',private:true,license:'AGPL-3.0-only',main:'dist/scripts/research-node-entry.js',engines:{node:'>=22'},dependencies};
    return {pkg,lock:{name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':{name:pkg.name,version:pkg.version,license:pkg.license,dependencies},...packages}}};
}
export function exportResearchEngine({root=process.cwd(),output,build=true}){
    root=path.resolve(root);if(!output)throw new Error('--output is required');output=path.resolve(output);
    const compiled=path.join(root,'.research-node');
    if(output===root||root.startsWith(output+path.sep)||output===compiled||output.startsWith(compiled+path.sep))throw new Error('Unsafe output directory');
    if(existsSync(output)){
        if(!lstatSync(output).isDirectory()||lstatSync(output).isSymbolicLink())throw new Error('Output must be a regular directory');
        if(readdirSync(output).length)verifyExisting(output);
    }
    if(build)buildResearchNode(root);
    const engineVersion=readFileSync(path.join(root,'lib/analysis/snapshot.ts'),'utf8').match(/RESEARCH_ENGINE_VERSION\s*=\s*'([^']+)'/)?.[1];
    const featureVersion=readFileSync(path.join(root,'lib/analysis/vm-contract.ts'),'utf8').match(/featureVersion:\s*'([^']+)'/)?.[1];
    if(!engineVersion||!featureVersion)throw new Error('Engine contract version unavailable');
    mkdirSync(path.dirname(output),{recursive:true});const stage=mkdtempSync(path.join(path.dirname(output),'.engine-export-'));let backup;
    try{
        cpSync(compiled,path.join(stage,'dist'),{recursive:true});
        const {pkg,lock}=packageLock(root,compiled);
        writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');writeFileSync(path.join(stage,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
        cpSync(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
        let sourceCommit='unavailable',sourceDirty=true;
        try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();sourceDirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();}catch{}
        const hashes=Object.fromEntries(files(stage).map(file=>[file,sha(readFileSync(path.join(stage,file)))]));
        const manifest={schemaVersion:1,engineVersion,featureVersion,sourceCommit,sourceDirty,files:hashes};
        writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');verifyExisting(stage);
        if(existsSync(output)){
            backup=mkdtempSync(path.join(path.dirname(output),'.engine-previous-'));rmSync(backup,{recursive:true});renameSync(output,backup);
            if(existsSync(path.join(backup,'node_modules')))renameSync(path.join(backup,'node_modules'),path.join(stage,'node_modules'));
        }
        renameSync(stage,output);if(backup)rmSync(backup,{recursive:true,force:true});return manifest;
    }catch(error){
        if(backup&&existsSync(backup)&&!existsSync(output)){
            if(existsSync(path.join(stage,'node_modules')))renameSync(path.join(stage,'node_modules'),path.join(backup,'node_modules'));
            renameSync(backup,output);
        }
        throw error;
    }finally{rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
    try{
        const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw new Error('Usage: npm run research:export-engine -- --output <engine-directory>');
        const manifest=exportResearchEngine({output:args[1]});console.log(`Engine ${manifest.engineVersion} exported to ${path.resolve(args[1])}`);
    }catch(error){console.error(error.message);process.exitCode=1;}
}
