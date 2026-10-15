import ts from 'typescript';
import {mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function buildResearchNode(root=process.cwd()) {
    root=path.resolve(root);
    const out=path.join(root,'.research-node');
    rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
    const program=ts.createProgram([path.join(root,'scripts/research-node-entry.ts'),path.join(root,'types/global.d.ts')],{
        target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,
        esModuleInterop:true,skipLibCheck:true,strict:true,baseUrl:root,paths:{'@/*':['./*']},rootDir:root,outDir:out,types:['node'],
    });
    const diagnostics=ts.getPreEmitDiagnostics(program);
    if(diagnostics.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
    program.emit();
    function rewrite(dir){
        for(const entry of readdirSync(dir,{withFileTypes:true})){
            const file=path.join(dir,entry.name);
            if(entry.isDirectory())rewrite(file);
            else if(file.endsWith('.js'))writeFileSync(file,readFileSync(file,'utf8').replace(/require\(["']@\/([^"']+)["']\)/g,(_,target)=>{
                let relative=path.relative(path.dirname(file),path.join(out,target)).split(path.sep).join('/');
                if(!relative.startsWith('.'))relative='./'+relative;
                return `require(${JSON.stringify(relative)})`;
            }));
        }
    }
    rewrite(out);return out;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
    try{buildResearchNode();console.log('Shared research bridge built in .research-node/');}
    catch(error){console.error(error.message);process.exitCode=1;}
}
