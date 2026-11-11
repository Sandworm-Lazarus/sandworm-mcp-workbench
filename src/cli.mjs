import {open} from 'node:fs/promises';
import {snapshot,report,runDemo,MAX_BYTES} from './workbench.mjs';
async function read(path){let f;try{f=await open(path,'r');const b=Buffer.alloc(MAX_BYTES+1);const {bytesRead}=await f.read(b,0,b.length,0);if(bytesRead>MAX_BYTES)throw Error('INPUT_LIMIT');return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,bytesRead));}catch(e){if(e.message==='INPUT_LIMIT')throw e;throw Error('INPUT_READ_FAILED');}finally{await f?.close();}}
try{
  const [command,current,baseline]=process.argv.slice(2);
  let r;
  if(command==='demo-live'&&!current)r=await runDemo();
  else if(['inspect','fixture'].includes(command)&&current){
    const now=snapshot(await read(current));
    const old=baseline?snapshot(await read(baseline)):null;
    r=report(now,old,command==='fixture'?'fixture':'import');
  }else throw Error('USAGE: node src/cli.mjs inspect tools.json [baseline.json] | fixture tools.json | demo-live');
  process.stdout.write(JSON.stringify(r,null,2)+'\n');
}catch(e){process.stderr.write(JSON.stringify({error:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'WORKBENCH_FAILED'})+'\n');process.exitCode=1;}
