const standard=(setup,body='return B[0]+":"+B[1]+":"+B.length;',init='this.previous_position[0]||0,this.previous_position[1]||0')=>`function(){var log="";function probe(){var B=[${init}];${body}}${setup}}`;
export const scalarArrayAdversarialCases=[
 {name:'ordinary-values-length-truthiness',source:standard('return probe.call({previous_position:[2,3]});','return (B?"truthy:":"false:")+B[0]+":"+B[1]+":"+B.length;')},
 {name:'receiver-getter-reread-left-to-right',source:standard('var n=0,a={get 0(){log+="a0;";return 2}},b={get 1(){log+="b1;";return 7}},u={get previous_position(){log+="p"+n+";";return n++?b:a}};var out=probe.call(u);return out+":"+log;')},
 {name:'first-index-getter-replaces-receiver-field',source:standard('var u={};u.previous_position={get 0(){log+="zero;";u.previous_position={1:9};return 4},get 1(){throw "stale"}};var out=probe.call(u);return out+":"+log;')},
 {name:'second-index-mutates-captured-object',source:standard('var obj={valueOf:function(){log+="coerce;";return this.n},n:2},u={previous_position:{0:obj,get 1(){log+="one;";obj.n=8;return 3}}};var out=probe.call(u);return out+":"+log;','return (B[0]-B[1])+":"+(B[0]-1);')},
 {name:'nested-source-call-during-initializer',source:standard('var inner={previous_position:[5,6]},u={previous_position:{get 0(){log+="enter;";log+=probe.call(inner)+";";return 2},get 1(){log+="last;";return 3}}};var out=probe.call(u);return out+":"+log;')},
 {name:'prototype-index-mutated-between-elements',source:standard('var p={1:3},v=Object.create(p);Object.defineProperty(v,"0",{get:function(){log+="first;";p[1]=12;return 5}});var out=probe.call({previous_position:v});return out+":"+log;')},
 {name:'array-prototype-getter-never-observes-fresh-own-elements',source:standard('Object.defineProperty(Array.prototype,"0",{get:function(){log+="BAD;";return 99},configurable:true});var out;try{out=probe.call({previous_position:{0:2,1:3}})}finally{delete Array.prototype[0]}return out+":"+log;')},
 {name:'first-initializer-throws-once',source:standard('var u={previous_position:{get 0(){log+="zero;";throw "first"},get 1(){log+="BAD;";return 3}}};try{probe.call(u)}catch(e){return e+":"+log}return "BAD";')},
 {name:'second-initializer-throws-after-first',source:standard('var u={previous_position:{get 0(){log+="zero;";return 2},get 1(){log+="one;";throw "second"}}};try{probe.call(u)}catch(e){return e+":"+log}return "BAD";')},
 {name:'nan-and-negative-zero-fallback-becomes-positive-zero',source:standard('return probe.call({previous_position:[NaN,-0]});','return (1/B[0])+":"+(1/B[1]);')},
 {name:'negative-zero-value-slot-retains-bits',source:'function(){function probe(x){var B=[x,3];return B[0]}return probe(-0)}'},
 {name:'quiet-nan-payload-value-slot',source:'function(){function probe(x){var B=[x,3];return B[0]}var v=new DataView(new ArrayBuffer(8));v.setUint32(0,2146959360,false);v.setUint32(4,66,false);return probe(v.getFloat64(0,false))}'},
 {name:'object-and-function-identity-preserved',source:'function(){function probe(a,b){var B=[a,b];return (B[0]===a)+":"+(B[1]===b)+":"+(B[0]!==B[1])}var a={},b=function(){};return probe(a,b)}'},
 {name:'undefined-null-false-values-retained',source:'function(){function probe(a,b){var B=[a,b];return typeof B[0]+":"+String(B[0])+":"+String(B[1])}return probe(void 0,null)+":"+probe(false,"")}'},
 {name:'alive-branch-skips-throwing-initializer',source:'function(){function probe(){if(this.alive){var B=[this.previous_position[0]||0,this.previous_position[1]||0];return B[0]+B[1]}return "dead"}return probe.call({alive:false,get previous_position(){throw "BAD"}})}'},
 {name:'undefined-previous-position-throws',source:standard('try{probe.call({})}catch(e){return e.name}return "BAD";')},
 {name:'null-previous-position-throws',source:standard('try{probe.call({previous_position:null})}catch(e){return e.name}return "BAD";')},
 {name:'block-let-initializer-resolution',source:'function(){function probe(){let v=10;{let v=4;var B=[v,v+1];return B[0]+":"+B[1]}}return probe()}'},
 {name:'trace1-recent-get-receiver-and-source-frame',source:standard('try{probe.call({previous_position:[4,9]})}catch(e){return e.name}return "BAD";','var x=B[0],y=B[1];var missing;missing();return x+y;')},
 {name:'trace1-nested-source-error-after-scalar-read',source:'function(){function fail(){var no;no()}function probe(){var B=[this.previous_position[0]||0,this.previous_position[1]||0];var x=B[0],y=B[1];fail();return x+y}try{probe.call({previous_position:[2,5]})}catch(e){return e.name}return "BAD";}'}
];
export const scalarArrayRejectionCases=[
 ['escaped-alias','var B=[1,2];var a=B;return a[0];'],
 ['escaped-shorthand','var B=[1,2];var x=B[0];return {B};'],
 ['passed-as-call-argument','var B=[1,2];return other(B);'],
 ['returned-array','var B=[1,2];var x=B[0];return B;'],
 ['member-call-receiver','var B=[function(){return this.length},2];return B[0]();'],
 ['dynamic-index','var B=[1,2];return B[this.i];'],
 ['unknown-property','var B=[1,2];return B.constructor;'],
 ['numeric-write','var B=[1,2];B[0]=8;return B[0];'],
 ['length-write','var B=[1,2];B.length=1;return B[0];'],
 ['element-delete','var B=[1,2];delete B[0];return B[0];'],
 ['element-update','var B=[1,2];B[0]++;return B[0];'],
 ['reassignment','var B=[1,2];B=[3,4];return B[0];'],
 ['nested-function-capture','var B=[1,2];function f(){return B[0]}return f();'],
 ['conditional-not-dominating','if(this.alive){var B=[1,2]}return B[0];'],
 ['holes','var B=[1,,3];return B[0];'],
 ['spread','var B=[...this.a];return B[0];'],
 ['preinitializer-use','var x=B;var B=[1,2];return B[0];'],
 ['initializer-self-reference','var B=[B,2];return B[0];'],
 ['direct-eval','var B=[1,2];return eval("B[0]");'],
 ['logical-expression-escape','var B=[1,2];return B||0;'],
 ['duplicate-var-declaration','var B=[1,2];var B=[3,4];return B[0];']
].map(([name,body])=>({name,source:`function(){function probe(){${body}}return 0}`}));

export function actualUnitScalarAdversarialCase(unitFixture){const cut=unitFixture.indexOf('function run(index,mutate,label)');if(cut<0)throw Error('Missing pinned Unit fixture boundary');return{name:'production-unit-six-adversarial-paths',production:true,source:'function(){'+unitFixture.slice(0,cut)+`function one(mode){events=[];var f=make(123),u=f.u,count=0,plain=u.previous_position,pair=[7,8];if(mode===1)u.isAlive=function(){return false};if(mode===2)u.previous_position=void 0;if(mode>=3){if(mode===5){pair=[{valueOf:function(){events.push("object-valueOf");return 7}},-0];u.forceDestination=[20,30];}Object.defineProperty(u,"previous_position",{get:function(){count++;events.push("previous-get:"+count);if(mode===4&&count===3){var child=make(321);events.push("nested-before");update.call(child.u,0);events.push("nested-after");}return count<3?plain:pair},configurable:true});}var error=null;try{update.call(u,f.dt)}catch(e){error=e.name||String(e)}return{mode:mode,error:error,getters:count,position:primitive(u.position),events:events};}var results=[];for(var mode=0;mode<6;mode++)results.push(one(mode));return JSON.stringify(results);}`};}
