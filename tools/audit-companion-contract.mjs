import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
const root=resolve(import.meta.dirname,'..');
const hash=s=>createHash('sha256').update(s).digest('hex');
const sources={};
for(const name of ['game_battle.js','game_util.js','game_ui_1.js'])sources[name]=await readFile(resolve(root,'src/srcmodule',name),'utf8');
const battle=sources['game_battle.js'],callbacks=[];
traverse(parse(battle),{CallExpression(path){
 if(path.node.callee.type!=='Identifier'||path.node.callee.name!=='clientCall')return;
 const argument=path.node.arguments[0];if(!argument)return;
 const writes=[],calls=[];
 path.traverse({AssignmentExpression(p){writes.push(battle.slice(p.node.left.start,p.node.left.end))},UpdateExpression(p){writes.push(battle.slice(p.node.argument.start,p.node.argument.end))},CallExpression(p){calls.push(battle.slice(p.node.callee.start,p.node.callee.end))}});
 const text=battle.slice(argument.start,argument.end);
 callbacks.push({start:argument.start,end:argument.end,sha256:hash(text),writes,calls,text});
}});
function fragment(file,needle,before=0,after=350){const s=sources[file],index=s.indexOf(needle);if(index<0)throw new Error(`Missing evidence: ${needle}`);const start=Math.max(0,index-before),end=Math.min(s.length,index+after),text=s.slice(start,end);return{file:`src/srcmodule/${file}`,start,end,sha256:hash(text),text};}
const evidence=[
 ['companionStageSelection',fragment('game_util.js','ed.loginMgr.isCompanions()&&e<=12',80,250)],
 ['localBotManualGuard',fragment('game_battle.js','canmanual:function',0,190)],
 ['sceneLookup',fragment('game_ui_1.js','ed.getBtScene=function',0,630)],
 ['optionalSceneDispatch',fragment('game_util.js','ed.callViewMessage=function',0,950)],
 ['actorCreationOccursInScene',fragment('game_ui_1.js','syncActors:function',0,385)],
 ['turnBasedActorWritesLogicState',fragment('game_battle.js','this.model.isEnterStateFinish=!0',130,160)],
 ['turnBasedLogicConsumesActorCompletion',fragment('game_battle.js','updateEnter_TB:function',0,680)],
 ['bossActorWritesModelSnapshotField',fragment('game_battle.js','DarkYeanling.actor_update=function',0,220)],
 ['nullSceneCounterexample',fragment('game_battle.js','t.playPointEffect.setAction("Start3")',210,100)],
 ['callbackMutatesModelTimer',fragment('game_battle.js','t.caster.atk2ImpactTimer=1',470,80)],
 ['timerConsumedByBattleUpdate',fragment('game_battle.js','BC.update=function',0,250)],
 ['callbackMutatesBuffGraph',fragment('game_battle.js','N.relatedChain=t.chainEff',80,150)],
 ['debugSnapshotChecksSubset',fragment('game_ui_1.js','snapshot:function(e){if(!ed.openDebug)',0,620)]
].map(([name,record])=>({name,...record}));
const report={version:1,status:'Source evidence audit, not a proof that rendering can be erased',sourceFiles:Object.fromEntries(Object.entries(sources).map(([name,s])=>[`src/srcmodule/${name}`,hash(s)])),
 findings:{companionMentionsInBattleCore:[...battle.matchAll(/companions/gi)].length,localBotMentionsInBattleCore:[...battle.matchAll(/localBot/g)].length,clientCallSites:callbacks.length,callbackSitesWithAssignments:callbacks.filter(r=>r.writes.length).length,directBattleRngCallsInsideCallbacks:callbacks.reduce((n,r)=>n+r.calls.filter(c=>['ed.rand','ed.srand','ed.peek'].includes(c)).length,0),hostMathRandomCallbackSites:callbacks.filter(r=>r.calls.includes('Math.random')).length},
 evidence,conclusions:[
 'Companions account/stage selection is visible; the inspected source does not establish a separate headless companion event loop.',
 'localBot changes diagnostics, manual control, tag handling and scoring. It does not select a callback-free or actor-free event loop.',
 'Turn-based combat explicitly feeds actor animation completion into model.isEnterStateFinish and skill progression. A stage-only contract must exclude this mode before considering renderer erasure.',
 'DarkYeanling actor update writes model.lastHpChangeTick. This may serve UI only, but full mutable-state equivalence includes the field; projecting it away requires a dependency argument.',
 'The original optional scene dispatcher can return undefined, but some original queued callbacks dereference its result unconditionally. A null-scene host does not complete every legal hero workload.',
 'Callbacks write fields on source battle models and buffs. Some fields look graphical, but erasing these writes would change complete source state and requires an explicit observable-state projection and dependency proof.',
 'No direct battle RNG calls were found in callback expressions. This syntactic result does not establish transitive purity: callbacks invoke source methods, host Math.random and nested callbacks.',
 'Original actor/effect scene phases may be omitted only after proving their effects irrelevant to the chosen contract. Debug serialized-state snapshots are a useful check, not a proof over every mutable field or callback closure.'
 ],recommendedNextStep:'Keep original callbacks and fail closed for unsupported host dependencies. Treat exact core mechanics state/RNG/queued commands as a candidate projection, then audit all renderer-origin reads and transitive callback effects before qualifying a device-free implementation.',qualifiesForWholeBattleFidelity:false};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/companion-execution-contract.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:'benchmarks/validation/companion-execution-contract.json',...report.findings}));
