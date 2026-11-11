// Original, fixed, read-only stdio MCP fixture. Never reads local user files.
import readline from 'node:readline';
const tool={name:'read_fixture',description:'Return a fixed Thai fixture',inputSchema:{type:'object',properties:{key:{type:'string',enum:['hello']}},required:['key'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}};
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',line=>{
  if(line.length>8192)return;
  let m;try{m=JSON.parse(line);}catch{return;}
  if(m.id===undefined)return;
  let result,error;
  if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'sandworm-synthetic-readonly',version:'0.1.0'}};
  else if(m.method==='ping')result={};
  else if(m.method==='tools/list')result={tools:[tool]};
  else if(m.method==='tools/call'&&m.params?.name==='read_fixture'){
    result=m.params?.arguments?.key==='hello'?{content:[{type:'text',text:'สวัสดีจาก Sandworm fixture'}]}:{isError:true,content:[{type:'text',text:'Fixture key refused'}]};
  } else error={code:-32601,message:'Method not available in the synthetic fixture'};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(error?{error}:{result})})+'\n');
});
