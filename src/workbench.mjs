import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const VERSION='0.1.0';
export const INSPECTOR_VERSION='2.14.0';
export const MAX_BYTES=262144, MAX_TOOLS=64;
export class WorkbenchError extends Error { constructor(code){super(code);this.code=code;} }
const fail=code=>{throw new WorkbenchError(code);};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function strictJson(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)fail('INPUT_LIMIT');
  let parsed;try{parsed=JSON.parse(text);}catch{fail('INVALID_JSON');}
  const stack=[];let nodes=0;
  // JSON.parse supplies grammar validation; this independent token walk rejects
  // duplicate decoded keys and lossy numbers before any schema is accepted.
  for(let i=0;i<text.length;){
    const c=text[i];
    if(/\s/.test(c)){i++;continue;}
    if(c==='"'){
      const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}
      const value=JSON.parse(text.slice(start,i));
      const top=stack.at(-1);
      if(top?.keys&&top.key){if(top.keys.has(value))fail('DUPLICATE_JSON_KEY');top.keys.add(value);top.key=false;}
      nodes++;
    }else if(c==='{'||c==='['){stack.push(c==='{'?{keys:new Set(),key:true}:{});i++;nodes++;if(stack.length>24)fail('JSON_DEPTH_LIMIT');}
    else if(c==='}'||c===']'){stack.pop();i++;}
    else if(c===','){const top=stack.at(-1);if(top?.keys)top.key=true;i++;}
    else if(c===':'){i++;}
    else if(c==='t'||c==='f'||c==='n'){i+=c==='f'?5:4;nodes++;}
    else{const m=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));if(!m||m.index!==0)fail('INVALID_JSON');const n=Number(m[0]);if(!Number.isFinite(n)||(Number.isInteger(n)&&!Number.isSafeInteger(n)))fail('UNSAFE_JSON_NUMBER');i+=m[0].length;nodes++;}
    if(nodes>20000)fail('JSON_NODE_LIMIT');
  }
  return parsed;
}
function canonical(value,depth=0){
  if(depth>20)fail('SCHEMA_TOO_DEEP');
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
export function snapshot(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)fail('INPUT_LIMIT');
  const input=strictJson(text);
  const tools=input?.result?.tools??input?.tools??input?.snapshot?.tools;
  if(!Array.isArray(tools)||tools.length>MAX_TOOLS)fail('INVALID_TOOLS');
  if(input?.result?.nextCursor||input?.nextCursor||input?.snapshot?.nextCursor)fail('PAGINATION_INCOMPLETE');
  const seen=new Set();
  const normalized=tools.map(t=>{
    if(!t||typeof t!=='object'||typeof t.name!=='string'||!/^[-A-Za-z0-9_.]{1,128}$/.test(t.name)||seen.has(t.name))fail('INVALID_OR_DUPLICATE_TOOL');
    seen.add(t.name);
    if(!t.inputSchema||typeof t.inputSchema!=='object'||Array.isArray(t.inputSchema)||t.inputSchema.type!=='object')fail('INVALID_INPUT_SCHEMA');
    if(t.description!==undefined&&(typeof t.description!=='string'||t.description.length>4096))fail('DESCRIPTION_LIMIT');
    if(t.outputSchema!==undefined&&(!t.outputSchema||typeof t.outputSchema!=='object'||Array.isArray(t.outputSchema)))fail('INVALID_OUTPUT_SCHEMA');
    const row={name:t.name,inputSchema:t.inputSchema};
    if(t.outputSchema!==undefined)row.outputSchema=t.outputSchema;
    if(t.description!==undefined)row.description=t.description;
    // Server hints are evidence only. They do not grant permission to call a tool.
    if(t.annotations!==undefined){
      if(!t.annotations||typeof t.annotations!=='object'||Array.isArray(t.annotations))fail('INVALID_ANNOTATIONS');
      row.annotations={};
      for(const k of ['readOnlyHint','destructiveHint','idempotentHint','openWorldHint']){
        if(t.annotations[k]!==undefined){if(typeof t.annotations[k]!=='boolean')fail('INVALID_ANNOTATIONS');row.annotations[k]=t.annotations[k];}
      }
    }
    row.contract_sha256=digest(canonical(row));return row;
  }).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  return {schema_version:1,engine_version:VERSION,input_sha256:digest(text),tools:normalized,contract_sha256:digest(canonical(normalized))};
}
export function compare(before,after){
  // Revalidate imported baseline tool rows; do not trust its stored hashes.
  const a=snapshot(JSON.stringify({tools:before.tools})),b=snapshot(JSON.stringify({tools:after.tools}));
  const left=new Map(a.tools.map(t=>[t.name,t])),right=new Map(b.tools.map(t=>[t.name,t]));
  const findings=[];
  for(const [name,t] of right){
    if(!left.has(name))findings.push({id:name,status:'added',message:'เพิ่ม tool ใหม่ ต้องตรวจสิทธิ์ก่อนเรียก'});
    else if(left.get(name).contract_sha256!==t.contract_sha256)findings.push({id:name,status:'changed',message:'สัญญาของ tool เปลี่ยน ต้องทบทวนชุดทดสอบ'});
  }
  for(const name of left.keys())if(!right.has(name))findings.push({id:name,status:'removed',message:'tool เดิมหายจากรายการ'});
  return findings.sort((a,b)=>a.id.localeCompare(b.id,'en'));
}
export function report(current,baseline=null,mode='import'){
  if(!['import','fixture','live'].includes(mode))fail('INVALID_MODE');
  const findings=baseline?compare(baseline,current):current.tools.map(t=>({id:t.name,status:'observed',message:'บันทึก schema แล้ว ยังไม่รับรองความปลอดภัย'}));
  return {schema_version:1,project:'sandworm-mcp-workbench',engine_version:VERSION,mode,
    upstream:{name:'@modelcontextprotocol/inspector',version:INSPECTOR_VERSION},
    summary:{tools:current.tools.length,changes:baseline?findings.length:0},findings,snapshot:current,
    boundaries:['Names, descriptions and schemas are included; review before sharing.','Annotations are untrusted hints; schema diff is not a security certification.']};
}
export async function boundedProcess(executable,args,{env={},timeoutMs=15000,maxBytes=MAX_BYTES,cwd}={}){
  return new Promise((resolve,reject)=>{
    let child,total=0,out=[],done=false;
    const stop=code=>{if(done)return;done=true;if(child?.pid){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}clearTimeout(timer);reject(new WorkbenchError(code));};
    let timer;
    try{child=spawn(executable,args,{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}catch{return reject(new WorkbenchError('PROCESS_START_FAILED'));}
    timer=setTimeout(()=>stop('PROCESS_TIMEOUT'),timeoutMs);
    child.on('error',()=>stop('PROCESS_START_FAILED'));
    for(const [s,capture] of [[child.stdout,true],[child.stderr,false]])s.on('data',b=>{total+=b.length;if(total>maxBytes)stop('PROCESS_OUTPUT_LIMIT');else if(capture)out.push(b);});
    child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)return reject(new WorkbenchError('INSPECTOR_FAILED'));resolve(Buffer.concat(out).toString('utf8'));});
  });
}
export async function runDemo(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const launcher=join(root,'node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js');
  let pkg;try{pkg=JSON.parse(await readFile(join(root,'node_modules/@modelcontextprotocol/inspector/package.json'),'utf8'));}catch{fail('INSTALL_PINNED_INSPECTOR');}
  if(pkg.version!==INSPECTOR_VERSION)fail('INSPECTOR_VERSION_MISMATCH');
  const state=await mkdtemp(join(tmpdir(),'sandworm-mcp-'));
  // No inherited provider keys, proxy settings, catalog or OAuth state.
  const env={PATH:process.env.PATH??'',HOME:state,USERPROFILE:state,MCP_STORAGE_DIR:state,MCP_AUTO_OPEN_ENABLED:'false',NO_PROXY:'*'};
  const base=['--cli',process.execPath,join(root,'examples/server.mjs')];
  try{
    const text=await boundedProcess(process.execPath,[launcher,...base,'--method','tools/list','--format','json','--quiet'],{env,cwd:root});
    const current=snapshot(text);
    const call=await boundedProcess(process.execPath,[launcher,...base,'--method','tools/call','--tool-name','read_fixture','--tool-arg','key=hello','--format','json','--quiet'],{env,cwd:root});
    let result;try{result=JSON.parse(call);}catch{fail('INVALID_CALL_RESULT');}
    const r=result.result??result;
    if(r.isError||r.content?.[0]?.text!=='สวัสดีจาก Sandworm fixture')fail('DEMO_ASSERTION_FAILED');
    const output=report(current,null,'live');output.assertions={read_fixture:'passed',call_result_sha256:digest(call)};
    return output;
  } finally {await rm(state,{recursive:true,force:true});}
}
