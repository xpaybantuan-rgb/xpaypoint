import { Agent, routeAgentRequest } from "agents";
interface Env {
  XPayPointCTOAgent: DurableObjectNamespace; REPO_OWNER: string; REPO_NAME: string;
  SITE_URL: string; AUTOPILOT_ENABLED: string; GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string; GITHUB_TOKEN?: string; ADMIN_TOKEN?: string;
}
interface State {
  lastCheckAt:string|null; siteStatus:"healthy"|"unhealthy"|"unknown"; latestWorkflow:string|null;
  openPullRequests:number; lastAlertSignature:string|null; lastAuditAt:string|null;
  lastAgentRunAt:string|null; lastAgentRunStatus:"success"|"failed"|null;
  lastAgentRunSummary:string|null; lastError:string|null;
}
const initialState:State={lastCheckAt:null,siteStatus:"unknown",latestWorkflow:null,openPullRequests:0,lastAlertSignature:null,lastAuditAt:null,lastAgentRunAt:null,lastAgentRunStatus:null,lastAgentRunSummary:null,lastError:null};
const instructions=[
"You are XPAYPOINT's autonomous CTO coding agent under Founder-authorized Level 2 governance.",
"Inspect repository, PRs, review feedback and CI. You may create autopilot/* branches, commit narrow fixes to allowed files, and open PRs targeting main.",
"Never merge, deploy, release, rollback, write to main, or change production databases, Supabase schema/records, payment/checkout/fulfillment, customer transactions, balances, wallets, XPAYCOIN, deposits, withdrawals, cashback, rewards, ledgers, refunds, secrets, credentials, GitHub/Cloudflare settings, Worker bindings, or deployment configuration.",
"Server-side tools enforce branch and path restrictions. Never bypass them. Never request, reveal, or include secrets. Do not claim tests passed unless CI reports success.",
"For protected work, stop and report Founder approval is required. Work on one narrow issue, avoid duplicate PRs, summarize findings and tests."
].join("\n");
function json(data:unknown,status=200){return Response.json(data,{status,headers:{"cache-control":"no-store"}});}
function auth(req:Request,token?:string){return Boolean(token)&&req.headers.get("Authorization")==="Bearer "+token;}
function branchGuard(b:string){if(!/^autopilot\/[a-z0-9][a-z0-9-]{2,60}$/.test(b))throw Error("Only autopilot branches can be written.");}
function pathGuard(p:string){
 if(p.includes("\\")||p.split("/").some(x=>x==="."||x===".."))throw Error("Path traversal blocked.");
 const ok=p==="README.md"||p.startsWith("cto-agent/src/")||p.startsWith("cto-agent/tests/")||p.startsWith("hq/")||p.startsWith("docs/")||p.startsWith("governance/");
 const bad=/(^|\/)(\.env|\.dev\.vars|secrets?)(\.|\/|$)/i.test(p)||/(^|\/)(index|topup|profil|cek-pesanan|admin-vipayment)\.html$/i.test(p)||/(^|\/)(supabase|database|migrations)(\/|$)/i.test(p)||p.startsWith(".github/")||p==="cto-agent/wrangler.jsonc"||p==="cto-agent/package.json"||p==="cto-agent/tsconfig.json";
 if(!ok||bad)throw Error("Protected or unsupported path: "+p);
}
function ghHeaders(e:Env):Record<string,string>{const h:Record<string,string>={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"XPAYPOINT-Autonomous-CTO"};if(e.GITHUB_TOKEN)h.Authorization="Bearer "+e.GITHUB_TOKEN;return h;}
async function gh<T>(e:Env,p:string,init:RequestInit={}):Promise<T>{
 const r=await fetch("https://api.github.com/repos/"+e.REPO_OWNER+"/"+e.REPO_NAME+p,{...init,headers:{...ghHeaders(e),...(init.headers as Record<string,string>|undefined)}});
 if(!r.ok)throw Error("GitHub API "+r.status+": "+(await r.text()).slice(0,300));return r.json() as Promise<T>;
}
function dec(v:string){const b=atob(v.replace(/\n/g,""));return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)));}
function enc(v:string){const a=new TextEncoder().encode(v);let b="";for(let i=0;i<a.length;i+=0x8000)b+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(b);}
async function tool(e:Env,n:string,a:any):Promise<unknown>{
 if(n==="get_repository_snapshot"){
  const [repo,prs,runs]=await Promise.all([gh<any>(e,""),gh<any[]>(e,"/pulls?state=open&per_page=20"),gh<any>(e,"/actions/runs?per_page=10")]);
  return {repository:repo.full_name,visibility:repo.visibility,openPRs:prs.map(p=>({number:p.number,title:p.title,head:p.head?.ref,reviewComments:p.review_comments,url:p.html_url})),runs:(runs.workflow_runs||[]).map((x:any)=>({name:x.name,status:x.status,conclusion:x.conclusion,url:x.html_url}))};
 }
 if(n==="read_repository_file"){
  const p=String(a.path||""),ref=String(a.ref||"main");
  if(ref!=="main"&&!/^autopilot\/[a-z0-9][a-z0-9-]{2,60}$/.test(ref)&&!/^feature\/[a-z0-9-]+$/.test(ref)&&!/^governance\/[a-z0-9-]+$/.test(ref))throw Error("Invalid ref.");
  const f=await gh<any>(e,"/contents/"+p.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(ref));
  if(f.type!=="file"||typeof f.content!=="string")throw Error("Not a text file.");
  return {path:p,ref,sha:f.sha,content:f.encoding==="base64"?dec(f.content):f.content};
 }
 if(n==="read_pull_request_feedback"){
  const k=Number(a.number);if(!Number.isInteger(k)||k<1)throw Error("Invalid PR number.");
  const [c,r]=await Promise.all([gh<any[]>(e,"/pulls/"+k+"/comments?per_page=100"),gh<any[]>(e,"/pulls/"+k+"/reviews?per_page=100")]);
  return {comments:c.map(x=>({path:x.path,line:x.line,body:x.body,author:x.user?.login})),reviews:r.map(x=>({state:x.state,body:x.body,author:x.user?.login}))};
 }
 if(n==="create_development_branch"){
  const b=String(a.name||"");branchGuard(b);const m=await gh<any>(e,"/git/ref/heads/main");
  const r=await gh<any>(e,"/git/refs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ref:"refs/heads/"+b,sha:m.object.sha})});return {branch:r.ref,sha:r.object?.sha};
 }
 if(n==="commit_safe_files"){
  const b=String(a.branch||"");branchGuard(b);if(!e.GITHUB_TOKEN)throw Error("GitHub token missing.");
  if(!Array.isArray(a.files)||a.files.length<1||a.files.length>8)throw Error("Provide 1-8 files.");
  const out=[];for(const f of a.files){const p=String(f.path||""),v=String(f.content||"");pathGuard(p);if(v.length>200000)throw Error("File too large.");
   const q=p.split("/").map(encodeURIComponent).join("/");let sha:string|undefined;
   try{sha=(await gh<any>(e,"/contents/"+q+"?ref="+encodeURIComponent(b))).sha;}catch(err){if(!String(err).includes("404"))throw err;}
   const r=await gh<any>(e,"/contents/"+q,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({message:String(a.message||"chore: XPAYPOINT autopilot update").slice(0,160),content:enc(v),branch:b,...(sha?{sha}:{})})});out.push({path:p,sha:r.commit?.sha});
  }return {branch:b,commits:out};
 }
 if(n==="open_pull_request"){
  const b=String(a.head||"");branchGuard(b);if(!e.GITHUB_TOKEN)throw Error("GitHub token missing.");
  const r=await gh<any>(e,"/pulls",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:String(a.title||"XPAYPOINT autopilot fix").slice(0,120),head:b,base:"main",body:String(a.body||"").slice(0,9000)+"\n\nAutopilot safety: not merged or deployed. Founder review required."})});
  return {number:r.number,url:r.html_url,state:r.state,merged:r.merged};
 }
 throw Error("Tool not allowed: "+n);
}
const tools=[{functionDeclarations:[
 {name:"get_repository_snapshot",description:"Read repository, open PRs and CI runs.",parameters:{type:"OBJECT",properties:{}}},
 {name:"read_repository_file",description:"Read text file from main or development branch.",parameters:{type:"OBJECT",properties:{path:{type:"STRING"},ref:{type:"STRING"}},required:["path"]}},
 {name:"read_pull_request_feedback",description:"Read reviews and inline comments for PR.",parameters:{type:"OBJECT",properties:{number:{type:"INTEGER"}},required:["number"]}},
 {name:"create_development_branch",description:"Create autopilot/<short-slug> from main.",parameters:{type:"OBJECT",properties:{name:{type:"STRING"}},required:["name"]}},
 {name:"commit_safe_files",description:"Commit safe files to autopilot branch only.",parameters:{type:"OBJECT",properties:{branch:{type:"STRING"},message:{type:"STRING"},files:{type:"ARRAY",items:{type:"OBJECT",properties:{path:{type:"STRING"},content:{type:"STRING"}},required:["path","content"]}}},required:["branch","message","files"]}},
 {name:"open_pull_request",description:"Open PR from autopilot branch to main, never merge.",parameters:{type:"OBJECT",properties:{head:{type:"STRING"},title:{type:"STRING"},body:{type:"STRING"}},required:["head","title","body"]}}
]}];
async function runGemini(e:Env,task:string):Promise<string>{
 if(!e.GEMINI_API_KEY||!e.GITHUB_TOKEN)throw Error("GEMINI_API_KEY or GITHUB_TOKEN missing.");
 const model=e.GEMINI_MODEL||"gemini-2.5-flash",url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent";
 const contents:any[]=[{role:"user",parts:[{text:instructions+"\n\nTask:\n"+task}]}];
 for(let i=0;i<12;i++){
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":e.GEMINI_API_KEY},body:JSON.stringify({contents,tools,toolConfig:{functionCallingConfig:{mode:"AUTO"}},generationConfig:{temperature:0.2,maxOutputTokens:8192}}),signal:AbortSignal.timeout(55000)});
  if(!r.ok)throw Error("Gemini API "+r.status+": "+(await r.text()).slice(0,300));
  const d=await r.json() as any,c=d.candidates?.[0]?.content;if(!c?.parts)throw Error("Gemini returned no candidate.");contents.push(c);
  const calls=c.parts.filter((p:any)=>p.functionCall);if(!calls.length)return c.parts.filter((p:any)=>p.text).map((p:any)=>p.text).join("\n").slice(0,10000)||"Agent completed.";
  const responses=[];for(const p of calls){try{responses.push({functionResponse:{name:p.functionCall.name,response:{result:await tool(e,p.functionCall.name,p.functionCall.args||{})}}});}catch(err){responses.push({functionResponse:{name:p.functionCall.name,response:{error:err instanceof Error?err.message:"Tool failed"}}});}}
  contents.push({role:"user",parts:responses});
 }throw Error("Gemini agent reached 12 tool calls.");
}
export class XPayPointCTOAgent extends Agent<Env,State>{
 initialState=initialState;
 async onStart():Promise<void>{
  await this.scheduleEvery(300,"runCycle",{}, {retry:{maxAttempts:3,baseDelayMs:1000,maxDelayMs:15000}});
  await this.schedule("0 2 * * *","runDailyAudit",{}, {idempotent:true,retry:{maxAttempts:2,baseDelayMs:5000,maxDelayMs:30000}});
 }
 async onRequest():Promise<Response>{await this.runCycle();return json({service:"XPAYPOINT Autonomous CTO",mode:"Level 2",intervalSeconds:300,state:this.state});}
 async runDailyAudit():Promise<void>{
  if(this.env.AUTOPILOT_ENABLED!=="true")return;
  try{const s=await runGemini(this.env,"Daily audit: inspect open PRs, review feedback, CI, code health and docs. Fix one safe narrow issue if justified, then open a PR. Do not touch protected areas.");const now=new Date().toISOString();this.setState({...this.state,lastAuditAt:now,lastAgentRunAt:now,lastAgentRunStatus:"success",lastAgentRunSummary:s,lastError:null});}
  catch(err){const now=new Date().toISOString();this.setState({...this.state,lastAuditAt:now,lastAgentRunAt:now,lastAgentRunStatus:"failed",lastError:err instanceof Error?err.message.slice(0,500):"Audit failed"});}
 }
 async runCycle():Promise<void>{
  const now=new Date().toISOString();try{
   const site=await fetch(this.env.SITE_URL,{redirect:"follow",signal:AbortSignal.timeout(10000)});
   const [prs,runs]=await Promise.all([gh<any[]>(this.env,"/pulls?state=open&per_page=20"),gh<any>(this.env,"/actions/runs?per_page=5")]);
   const latest=runs.workflow_runs?.[0],review=prs.filter(p=>Number(p.review_comments||0)>0),failed=latest?.conclusion==="failure";
   const signature=(!site.ok||failed||review.length)?JSON.stringify({site:site.ok,run:latest?.id||null,prs:review.map(p=>[p.number,p.updated_at,p.review_comments])}):null;
   const next:State={...this.state,lastCheckAt:now,siteStatus:site.ok?"healthy":"unhealthy",latestWorkflow:latest?String(latest.name||"workflow")+": "+latest.status+"/"+(latest.conclusion||"pending"):"no workflow runs",openPullRequests:prs.length,lastError:null};
   if(signature&&signature!==this.state.lastAlertSignature&&this.env.AUTOPILOT_ENABLED==="true"){
    const s=await runGemini(this.env,"Investigate alert. Site healthy: "+site.ok+". Latest workflow: "+JSON.stringify(latest||null)+". PRs with review comments: "+JSON.stringify(review.map(p=>({number:p.number,title:p.title,head:p.head?.ref,reviewComments:p.review_comments,url:p.html_url})) )+". Fix only safe Level 2 issues and open a PR. Report protected issues without editing.");
    next.lastAgentRunAt=now;next.lastAgentRunStatus="success";next.lastAgentRunSummary=s;next.lastAlertSignature=signature;
   }else if(!signature)next.lastAlertSignature=null;
   this.setState(next);
  }catch(err){this.setState({...this.state,lastCheckAt:now,lastError:err instanceof Error?err.message.slice(0,500):"Monitor failed"});}
 }
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const u=new URL(request.url);if(u.pathname==="/health")return json({ok:true,service:"xpaypoint-cto-agent",time:new Date().toISOString()});
 if(u.pathname==="/start"&&request.method==="POST"){if(!auth(request,env.ADMIN_TOKEN))return new Response("Unauthorized",{status:401});const r=new Request(new URL("/agents/xpaypointctoagent/founder",u.origin),{method:"GET"});return (await routeAgentRequest(r,env))??new Response("Agent route not found",{status:404});}
 if(u.pathname.startsWith("/agents/")){if(!auth(request,env.ADMIN_TOKEN))return new Response("Unauthorized",{status:401});return (await routeAgentRequest(request,env))??new Response("Agent route not found",{status:404});}
 return new Response("Not found",{status:404});
}} satisfies ExportedHandler<Env>;
