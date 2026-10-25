import assert from 'node:assert/strict';
import {tavilySources} from '../functions/api/research-search.js';
const env={TAVILY_API_KEY:'synthetic-secret'};let account,searches=0,status=200;
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.equal(options.headers.authorization,'Bearer synthetic-secret');assert.equal(options.redirect,'error');
 if(url.endsWith('/usage'))return Response.json({account,key:{limit:1000,usage:0}});
 assert.equal(url,'https://api.tavily.com/search');searches++;
 const body=JSON.parse(options.body);assert.equal(body.search_depth,'basic');assert.equal(body.auto_parameters,false);assert.equal(body.include_answer,false);assert.equal(body.include_raw_content,false);assert.equal(body.max_results,5);assert.ok(!options.body.includes('synthetic-secret'));
 if(status!==200)return new Response('provider body should never be exposed',{status});
 return Response.json({results:[{title:'Official 2026 update',url:'https://official.example/update',content:'Current evidence',published_date:'2026-10-25'},{title:'Unsafe',url:'javascript:alert(1)',content:'bad'}]});
};
const free=()=>({current_plan:'Researcher',plan_limit:1000,plan_usage:0,paygo_limit:0,paygo_usage:0});
await assert.rejects(tavilySources({},'latest news'),/not connected/);assert.equal(searches,0);
account=free();const sources=await tavilySources(env,'latest AI capabilities');assert.equal(sources.length,1);assert.equal(sources[0].publishedAt,'2026-10-25');assert.ok(!JSON.stringify(sources).includes('synthetic-secret'));
for(const change of [{current_plan:'Bootstrap'},{paygo_limit:10},{plan_usage:1000},{plan_usage:null},{plan_limit:undefined}]){
 account={...free(),...change};const before=searches;await assert.rejects(tavilySources(env,'news'));assert.equal(searches,before,'Unsafe billing or exhausted/unknown usage cannot start a search');
}
account=free();status=432;await assert.rejects(tavilySources(env,'news'),/No paid fallback/);
globalThis.fetch=original;
console.log('Tavily passed: server-only key, verified free plan, paid-usage rejection, monthly exhaustion, bounded basic requests, safe sources, publication dates and no paid fallback.');
