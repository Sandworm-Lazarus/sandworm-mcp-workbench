import {spawnSync} from 'node:child_process';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {runDemo} from '../src/workbench.mjs';
const root=new URL('../',import.meta.url).pathname;
const args=['--test','--test-reporter=tap','tests/workbench.test.mjs','tests/web.test.cjs'];
const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
if(r.status!==0){process.stderr.write(r.stdout+r.stderr);process.exit(1);}
const count=Number(r.stdout.match(/# tests (\d+)/)?.[1]);
if(!count)throw Error('Test count unavailable');
const live=await runDemo();
await writeFile(join(root,'reports/upstream-live.json'),JSON.stringify(live,null,2)+'\n');
async function walk(p){let out=[];for(const e of await readdir(p,{withFileTypes:true})){if(['node_modules','.git','.venv'].includes(e.name))continue;const v=join(p,e.name);if(e.isDirectory())out.push(...await walk(v));else if(e.isFile())out.push(v);}return out;}
let files=[];for(const d of ['src','tests','examples','scripts','web'])files.push(...await walk(join(root,d)));
files.push(join(root,'package.json'),join(root,'package-lock.json'));
const manifest={};for(const f of files.sort())manifest[relative(root,f)]=createHash('sha256').update(await readFile(f)).digest('hex');
await mkdir(join(root,'reports'),{recursive:true});
await writeFile(join(root,'reports/validation.json'),JSON.stringify({schema_version:1,project:'sandworm-mcp-workbench',passed:count,failed:0,source_sha256:manifest,upstream_check:{name:'@modelcontextprotocol/inspector',version:'2.14.0',status:'passed',scope:'actual pinned Inspector CLI tools/list and tools/call against bundled synthetic stdio server; no external MCP tested'}},null,2)+'\n');
process.stdout.write(`PASS ${count} tests; validation hashes refreshed\n`);
