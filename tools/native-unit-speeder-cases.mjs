// Shared standalone source harness. The actual original Unit.update body is
// injected unchanged; neither candidate nor reference replaces its continuation.
export function unitSpeederProbeSource(original){return `
var buffer=new ArrayBuffer(8),view=new DataView(buffer);
function bits(v){view.setFloat64(0,v,false);return view.getUint32(0,false).toString(16).padStart(8,'0')+view.getUint32(4,false).toString(16).padStart(8,'0');}
var events=[],sourceSentinel={label:'exact-source-sentinel'};
var ed={emUnitState_Idle:0,emUnitState_Walk:1,emUnitState_Attack:2,emUnitState_Fall:3,emUnitState_Dead:4,emUnitState_Dying:5,
 gravity:-10,edpZero:[0,0],edpMult:function(p,n){return[p[0]*n,p[1]*n]},edpDistanceSQ:function(a,b){var x=a[0]-b[0],y=a[1]-b[1];return x*x+y*y},fixPosition:function(p){return p},
 battleEngine:{config:{localBot:false},freeze_level:0,getStageRect:function(){events.push(['rect']);return{minX:-400,maxX:400}}}};
var update=(${original});
function make(index){
 var skill={info:{SetSpeeder:index%5===0?null:index%5===1?0:index%5===2?-20:25.5},lockActionSpeeder:index%11===0,lockMSFix:false,lockUnitDirection:false,target:null};
 var attrs={MSPD:(index%301)-150,ATKHAST:(index%171)-85,MSFix:0,HAST:(index%101)-50,MPR:2.5,HPR:index%2?1.25:-0,HEAL:15,DOTRATIO:0.25,AllMpRatio:0.1,PRMpRatio:25};
 var fx={frozen:index%13===0,motionless:index%17===0,immoblilize:false,fix:false,disableAI:false,stopBuff:false,noHPR:false,unheal:false};
 var config={is_boss:index%3===0,is_summoned:false};
 var u={name:'probe',state:index%4===0?4:index%3===0?2:0,config:config,attribs:attrs,buff_effects:fx,
  hp:100,mp:10,camp:1,current_skill:index%7===0?null:skill,basic_skill:index%2?skill:{},
  speeder:99,dt_action:99,action_name:'atk',action_elapsed:1.5,action_duration:1,action_loop:false,
  position:[0,0],previous_position:[1,2],walk_v:[0.125,-0.25],knockup_v:[0,0],velocity:[0,0],direction:1,
  height:0,zSpeed:null,gravityCoef:1,knockup_time:0,knock_state:false,walkIgnoreRect:false,
  forceDestination:null,destination:null,global_cd:2,skill_list:[],buff_list:[],frozen_model:false,
  thumpResistanceLevel:0,thumpResistanceReduce:null,enterDelayTimer:null};
 function log(name){events.push([name,bits(u.speeder),bits(u.dt_action),bits(u.hp),bits(u.mp)]);}
 u.isAlive=function(){events.push(['alive']);return this.state!==4&&this.state!==5};
 u.terminate=function(){events.push(['terminate'])};
 u.onActionFinished=function(){log('finished');if(index%19===0){u.attribs.HPR=2;u.action_name='after'}};
 u.addBuff=function(){log('add-buff');return null};u.isMode_TB=function(){events.push(['tb']);return false};
 u.fall=function(){events.push(['fall'])};u.isPet=function(){events.push(['pet']);return false};
 u.ai={update:function(dt){events.push(['ai',bits(dt)])},castSkillWhenControlled:function(){events.push(['ai-controlled'])}};
 u.recheckManualCast=function(){log('manual')};u.getTransferMpTarget=function(){events.push(['mp-target']);return u};
 u.getTransferTarget=function(){events.push(['hp-target']);return u};
 u.setMp=function(value,owner){events.push(['mp',bits(value),owner===u]);u.mp=value};
 u.setHp=function(value){events.push(['hp',bits(value)]);u.hp=value};
 u.battledata={addRestore:function(value){events.push(['restore',bits(value)])}};
 skill.caster=u;skill.update=function(a,b,c){events.push(['skill',bits(a),bits(b),bits(c)]);};
 skill.onPhaseFinished=function(){events.push(['phase'])};u.skill_list=[skill];
 // A null current skill cannot own an attack-phase completion. Keep this
 // generated valid-state corpus on the idle continuation in that case.
 if(!u.current_skill&&u.state===2)u.state=0;
 return{u:u,skill:skill,attrs:attrs,fx:fx,config:config,dt:index%23===0?-0:index%29===0?0:(index%31-10)/64};
}
function primitive(object){var out=[];Object.keys(object).sort().forEach(function(key){var d=Object.getOwnPropertyDescriptor(object,key);if(!('value'in d)){out.push([key,'accessor']);return}var x=d.value;if(typeof x==='number')out.push([key,{bits:bits(x)}]);else if(x===null||typeof x==='string'||typeof x==='boolean')out.push([key,x]);else if(Array.isArray(x)&&x.every(function(n){return typeof n==='number'}))out.push([key,x.map(bits)]);});return out;}
function run(index,mutate,label){events=[];var f=make(index);if(mutate)mutate(f);var error=null;try{update.call(f.u,f.dt)}catch(e){error={sameSentinel:e===sourceSentinel,name:e.name,message:e.message}};
 var before=events.slice(),state={unit:primitive(f.u),attrs:primitive(f.attrs),effects:primitive(f.fx),config:primitive(f.config),skill:primitive(f.skill),info:primitive(f.skill.info),sameCurrent:f.u.current_skill===f.skill,sameBasic:f.u.basic_skill===f.skill};
 return{label:label===undefined?index:label,error:error,events:before,state:state};}
var rows=[],forcedCollections=0;for(var i=0;i<20000;i++){rows.push(run(i));if(i%97===0&&typeof gc==='function'){gc();forcedCollections++;}}
var checks=[
 ['prefix-mutates-attribs',function(f){f.u.state=0;f.u.config.is_summoned=false;f.u.isAlive=function(){events.push(['prefix-alive']);f.attrs.MSPD=150;return true};}],
 ['prefix-throws',function(f){f.u.isAlive=function(){events.push(['prefix-throw']);throw sourceSentinel}}],
 ['mspd-getter',function(f){Object.defineProperty(f.attrs,'MSPD',{get:function(){events.push(['get-mspd']);return 50}})}],
 ['mspd-throws',function(f){Object.defineProperty(f.attrs,'MSPD',{get:function(){events.push(['get-mspd']);throw sourceSentinel}})}],
 ['set-speeder-getter',function(f){Object.defineProperty(f.skill.info,'SetSpeeder',{get:function(){events.push(['get-set']);return 25}})}],
 ['setter-speed',function(f){var value=0;Object.defineProperty(f.u,'speeder',{get:function(){events.push(['read-speed']);return value},set:function(x){events.push(['set-speed',bits(x)]);value=x}})}],
 ['setter-action',function(f){var value=0;Object.defineProperty(f.u,'dt_action',{get:function(){events.push(['read-action']);return value},set:function(x){events.push(['set-action',bits(x)]);value=x}})}],
 ['readonly-speed',function(f){Object.defineProperty(f.u,'speeder',{writable:false})}],
 ['readonly-action',function(f){Object.defineProperty(f.u,'dt_action',{writable:false})}],
 ['frozen-unit',function(f){Object.freeze(f.u)}],
 ['proxy-unit',function(f){f.u=new Proxy(f.u,{get:function(t,k){events.push(['proxy-get',String(k)]);return t[k]},set:function(t,k,v){events.push(['proxy-set',String(k)]);t[k]=v;return true}})}],
 ['proxy-attribs',function(f){f.u.attribs=new Proxy(f.attrs,{get:function(t,k){events.push(['attr-get',String(k)]);return t[k]}})}],
 ['inherited-inputs',function(f){f.u.attribs=Object.create(f.attrs);f.u.config=Object.create(f.config);f.u.buff_effects=Object.create(f.fx)}],
 ['aliased-inputs',function(f){Object.keys(f.attrs).forEach(function(k){f.u[k]=f.attrs[k]});Object.keys(f.fx).forEach(function(k){f.u[k]=f.fx[k]});f.u.attribs=f.u;f.u.buff_effects=f.u;}],
 ['unused-haste-getter',function(f){f.u.state=4;f.u.basic_skill={};Object.defineProperty(f.attrs,'ATKHAST',{get:function(){events.push(['unused-haste']);return 50}})}],
 ['unused-motionless-getter',function(f){f.fx.frozen=true;Object.defineProperty(f.fx,'motionless',{get:function(){events.push(['unused-motionless']);return false}})}],
 ['coercive-mspd',function(f){f.attrs.MSPD={valueOf:function(){events.push(['coerce-mspd']);return 50}}}],
 ['coercive-dt',function(f){f.dt={valueOf:function(){events.push(['coerce-dt']);return 0.125}}}],
 ['nan-mspd',function(f){f.attrs.MSPD=NaN}],['infinite-dt',function(f){f.dt=Infinity;f.u.state=4}]
];for(var j=0;j<checks.length;j++)rows.push(run(123,checks[j][1],checks[j][0]));
print(JSON.stringify({rows:rows,functionSource:update.toString(),forcedCollections:forcedCollections}));
`;}
