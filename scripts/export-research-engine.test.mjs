import {beforeAll,afterAll,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {exportResearchEngine} from './export-research-engine.mjs';
const root=process.cwd();let workspace;
beforeAll(()=>{workspace=mkdtempSync(path.join(tmpdir(),'engine-export-test-'));execFileSync(process.execPath,['scripts/build-research-node.mjs'],{cwd:root,stdio:'pipe'});},30000);
afterAll(()=>{if(workspace)rmSync(workspace,{recursive:true,force:true});});
it('exports a versioned package with locked runtime-only dependencies and an independent CLI',()=>{
 const output=path.join(workspace,'standalone','engine');exportResearchEngine({root,output,build:false});
 const manifest=JSON.parse(readFileSync(path.join(output,'manifest.json'),'utf8'));
 expect(manifest.engineVersion).toBe('research-snapshot-v1');expect(manifest.featureVersion).toBe('research-ml-features-v1');
 const pkg=JSON.parse(readFileSync(path.join(output,'package.json'),'utf8'));
 expect(Object.keys(pkg.dependencies).sort()).toEqual(['clsx','tailwind-merge']);expect(pkg.devDependencies).toBeUndefined();
 for(const [file,hash] of Object.entries(manifest.files))expect(createHash('sha256').update(readFileSync(path.join(output,file))).digest('hex')).toBe(hash);
 for(const name of Object.keys(pkg.dependencies))cpSync(path.join(root,'node_modules',name),path.join(output,'node_modules',name),{recursive:true});
 const selftest=JSON.parse(execFileSync(process.execPath,[path.join(output,'dist/scripts/research-node-entry.js'),'self-test'],{cwd:workspace,env:{...process.env,NODE_PATH:''},encoding:'utf8'}));
 expect(selftest).toMatchObject({engineVersion:manifest.engineVersion,indicators:57});
 expect(existsSync(path.join(output,'dist/app'))).toBe(false);
});
it('refuses unmanaged or modified output without deleting it',()=>{
 const output=path.join(workspace,'protected');mkdirSync(output);writeFileSync(path.join(output,'keep.txt'),'keep');
 expect(()=>exportResearchEngine({root,output,build:false})).toThrow();expect(readFileSync(path.join(output,'keep.txt'),'utf8')).toBe('keep');
 const managed=path.join(workspace,'managed');exportResearchEngine({root,output:managed,build:false});
 const entry=path.join(managed,'dist/scripts/research-node-entry.js');writeFileSync(entry,'changed');
 expect(()=>exportResearchEngine({root,output:managed,build:false})).toThrow();expect(readFileSync(entry,'utf8')).toBe('changed');
});
it('updates a verified export while preserving installed dependencies',()=>{
 const output=path.join(workspace,'update');exportResearchEngine({root,output,build:false});mkdirSync(path.join(output,'node_modules'));writeFileSync(path.join(output,'node_modules','marker'),'installed');
 exportResearchEngine({root,output,build:false});expect(readFileSync(path.join(output,'node_modules','marker'),'utf8')).toBe('installed');
});
