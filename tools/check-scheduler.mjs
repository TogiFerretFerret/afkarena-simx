import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
export async function loadTickSource(){
  const metadata=JSON.parse(await readFile(resolve(root,'config/scheduler-translation.json'),'utf8'));
  const file=await readFile(resolve(root,metadata.source),'utf8');
  const source=file.slice(metadata.start,metadata.end);
  assert.equal(createHash('sha256').update(source).digest('hex'),metadata.sha256,'Stale BattleEngine.tick source coordinates');
  return {metadata,source};
}

export function createSchedulerOracle(source){
  const tick=runInNewContext(`(${source})`,{
    ed:{halloweenFunBattleMgr:{isHalloweenFunMode:()=>false},BattleEngine:{modesUsingMaxTicks:[]},btLog:{append:()=>{}}},
  });
  return scenario=>{
    const updates=[],frames=[];
    const entities=scenario.entities.map((e,id)=>({
      id,frozen_model:e.frozen,terminated:e.terminated,updates:0,used:false,
      update(){
        frame('before_update',id);
        this.updates++;updates.push(id);
        if(this.used){frame('after_update',id);return;}
        this.used=true;
        const {kind,a,b}=scenario.actions[id];
        switch(kind){
          case 0:break;
          case 1:lists[a].push(entities[b]);break;
          case 2:lists[a].splice(b,1);break;
          case 3:engine[`group_${a}`]=lists[b];break;
          case 4:entities[a].terminated=true;break;
          case 5:entities[a].frozen_model=true;break;
          case 6:entities[a].frozen_model=false;break;
          case 7:lists[a].pop();break;
          case 8:lists[a].length=0;break;
          default:throw new Error(`Unknown action ${kind}`);
        }
        frame('after_update',id);
      },
    }));
    const lists=scenario.lists.map(list=>list.map(id=>entities[id]));
    const groups=scenario.groups.map(id=>lists[id]);
    function state(){
      return {groups:groups.map(list=>lists.indexOf(list)),lists:lists.map(list=>Array.from(list,e=>e.id)),
        entities:entities.map(e=>({frozen:e.frozen_model,terminated:e.terminated,updates:e.updates,used:e.used}))};
    }
    function frame(kind,id){frames.push({kind,id,state:state()});}
    const engine={running:true,freeze_level:0,ignore_level:0,time_limit:90,tick_interval:.125,
      special_time_limit:0,ticks:0,config:{mode:'stage'},alive_enemy_count:1,alive_player_count:1,
      enity_list_name:groups.map((_,i)=>`group_${i}`),
      weatherUpdate(){},tickOperation(){},tickRageObjects(){},checkPush(){},getMode(){return'stage'},
      getTimeRemain(){return this.time_limit},toBtLogString(){return''},onBattleEnd(){throw new Error('Unexpected battle end in scheduler fixture')},
    };
    for(let i=0;i<groups.length;i++)Object.defineProperty(engine,`group_${i}`,{
      get(){return groups[i]},
      set(value){
        const fresh=!lists.includes(value);
        if(fresh)lists.push(value);
        groups[i]=value;
        if(fresh)frame('filter',i);
      },
    });
    tick.call(engine);
    return {updates,...state(),frames};
  };
}

export function serializeScenario(s){
  return [s.entities.length,s.lists.length,s.groups.length,
    ...s.entities.flatMap(e=>[Number(e.frozen),Number(e.terminated)]),
    ...s.actions.flatMap(a=>[a.kind,a.a,a.b]),
    ...s.lists.flatMap(list=>[list.length,...list]),...s.groups].join(' ');
}

export function schedulerCases(){
  const make=(lists,groups,actions,flags=[])=>({lists,groups,actions:actions.map(a=>({kind:a[0]??0,a:a[1]??0,b:a[2]??0})),entities:actions.map((_,i)=>({frozen:flags[i]?.[0]??false,terminated:flags[i]?.[1]??false}))});
  const cases=[
    make([[0],[1]],[0,1],[[1,0,2],[0],[0]]),
    make([[0],[1]],[0,1],[[1,1,2],[0],[0]]),
    make([[0],[1]],[0,1],[[0],[1,0,2],[0]]),
    make([[0,1,2]],[0],[[2,0,0],[0],[0]]),
    make([[0,1,2]],[0],[[8,0],[0],[0]]),
    make([[0,1],[2]],[0,1],[[3,0,1],[0],[0]]),
    make([[0,1],[2]],[0,1],[[3,1,0],[0],[0]]),
    make([[0,1,2]],[0],[[4,1],[0],[0]]),
    make([[0,1,2]],[0],[[5,1],[0],[0]]),
    make([[0,1,2]],[0],[[6,1],[0],[0]],[[false,false],[true,false]]),
    make([[0,0,1],[1]],[0,0,1],[[1,0,0],[0]]),
    make([[0,1,2]],[0],[[0],[0],[0]],[[false,true],[true,true],[false,false]]),
  ];
  let state=0x6d2b79f5;
  const next=limit=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%limit};
  for(let i=0;i<20000;i++){
    const n=1+next(10),l=1+next(4),g=1+next(5);
    const flags=Array.from({length:n},()=>[next(5)===0,next(5)===0]);
    const lists=Array.from({length:l},()=>Array.from({length:next(8)},()=>next(n)));
    const groups=Array.from({length:g},()=>next(l));
    const actions=Array.from({length:n},()=>{
      const kind=next(9);
      return[kind,kind===3?next(g):kind>=4&&kind<=6?next(n):next(l),kind===1?next(n):kind===3?next(l):next(10)];
    });
    cases.push(make(lists,groups,actions,flags));
  }
  return cases;
}

async function main(){
  if(!process.argv[2])throw new Error('Usage: node tools/check-scheduler.mjs BINARY');
  const {metadata,source}=await loadTickSource();
  const oracle=createSchedulerOracle(source),cases=schedulerCases();
  const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serializeScenario).join('\n')+'\n',encoding:'utf8',maxBuffer:256*1024*1024});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);
  let updateCount=0,frameCount=0;
  for(let index=0;index<cases.length;index++){
    const expected=oracle(cases[index]),actual=JSON.parse(lines[index]);
    try{assert.deepEqual(actual,expected)}catch(error){
      await mkdir(resolve(root,'work'),{recursive:true});
      await writeFile(resolve(root,'work/scheduler-first-divergence.json'),JSON.stringify({caseIndex:index,input:cases[index],expected,actual},null,2)+'\n');
      throw new Error(`Scheduler diverged at case ${index}; see work/scheduler-first-divergence.json`,{cause:error});
    }
    updateCount+=expected.updates.length;
    frameCount+=expected.frames.length;
  }
  const summary={version:1,sourceSha256:metadata.sha256,referenceRuntime:process.version,cases:cases.length,updateCount,frameCount,
    scope:'Actual BattleEngine.tick list-loop behavior under fixture callbacks; timing and battle-result logic stubbed'};
  await mkdir(resolve(root,'work'),{recursive:true});
  await writeFile(resolve(root,'work/scheduler-summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
