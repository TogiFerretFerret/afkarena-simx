/* EXPERIMENTAL worker-scoped diagnostic helper; generic wrap/parse unsupported. */
(function(host){
    "use strict";
var workerMapConstructor=Map;
var workerMapGet=Function.prototype.call.bind(workerMapConstructor.prototype.get);
var workerMapHas=Function.prototype.call.bind(workerMapConstructor.prototype.has);
var workerMapSet=Function.prototype.call.bind(workerMapConstructor.prototype.set);
var workerOwnDescriptor=Object.getOwnPropertyDescriptor,workerRoots=null;
var workerApproved=Object.create(null),workerNames=["AnimDuration","Astrolabe","AstrolabeTag","BattleFieldPosition","BattleGround","Equip","GuildTurntableTech","Param","ParamBattleMode","Pet","PetBook","PetQualityAttr","PetTalentCatg","PetTalentLib","SignatureLevel","SignaturePower","Skill","SkillBuff","SkinArtRes","Sound","SoundAnim","SoundBattle","SoundEffect","StageBattleBoss","StageBattleIdx","Transct","TransctHeroAttrs","Unit","UnitGS","UnitLevel","UnitPuppet","UnitQuality","UnitRank","UnitTag","UnitTexas","WarEffect"];
for(var workerIndex=0;workerIndex<workerNames.length;workerIndex++)workerApproved[workerNames[workerIndex]]=true;
    host.installQualificationTableMembrane=function installQualificationTableMembrane(options){
        options=options||{};
        if(typeof options.digest!=="function")throw new Error("Table membrane requires an exact digest function");
        var jsonParse=JSON.parse;
        var digest=options.digest,records=new workerMapConstructor(),proxies=new workerMapConstructor(),names=new workerMapConstructor();
        var ownKeys=Reflect.ownKeys,descriptor=Object.getOwnPropertyDescriptor,prototypeOf=Object.getPrototypeOf;
        var objectProto=Object.prototype,arrayProto=Array.prototype,data=new DataView(new ArrayBuffer(8));
        var counters={roots:0,nodes:0,proxies:0,gets:0,descriptors:0,writes:0,failures:0};
        var firstFailure=null,maxNodes=options.maxNodes===undefined?2000000:options.maxNodes;
        var maxDepth=options.maxDepth===undefined?256:options.maxDepth;
        function failure(message,write){
            counters.failures++;if(write)counters.writes++;
            if(firstFailure===null)firstFailure=message;
            var error=new Error("Qualification table membrane: "+message);error.tableMembraneFailure=true;throw error;
        }
        function bits(value){data.setFloat64(0,value,false);return data.getUint32(0,false).toString(16).padStart(8,"0")+data.getUint32(4,false).toString(16).padStart(8,"0");}
        function assertWorkerLease(){
 if(typeof __nativeTables!=="object"||__nativeTables===null)failure("worker-scoped table loader required",false);
 if(workerRoots===null)workerRoots=__nativeTables;
 if(workerRoots!==__nativeTables)failure("worker table-root lease replaced",false);
}
function assertWorkerRoot(root,name){
 assertWorkerLease();
 if(workerApproved[name]!==true)failure("table outside bounded worker lease: "+name,false);
 var owned=workerOwnDescriptor(workerRoots,name);
 if(!owned||!("value" in owned)||owned.value!==root)failure("generic wrap root is outside worker lease",false);
}
function register(root,name){
            if(firstFailure!==null)failure("previous violation: "+firstFailure,false);
            if(typeof name!=="string"||name.length===0)failure("named table root required",false);
            if(root===null||typeof root!=="object")failure("table root must be a JSON object or array",false);
            assertWorkerRoot(root,name);
            if(workerMapHas(proxies,root)){
                var known=workerMapGet(proxies,root);if(known.table!==name||known.path.length!==0)failure("wrapped root registered with a different name/path",false);return root;
            }
            if(workerMapHas(records,root)){
                var old=workerMapGet(records,root);if(old.table!==name||old.path.length!==0)failure("raw alias crosses named table roots",false);return old.proxy||makeProxy(old);
            }
            if(workerMapHas(names,name))failure("table name reused with a different raw root: "+name,false);
            var local=new workerMapConstructor(),pending=[],nodes=[],rootInfo={name:name,sha256:null};
            function scalar(value,path,depth){
                if(value===null)return["null"];
                var type=typeof value;
                if(type==="string"||type==="boolean")return[type,value];
                if(type==="number")return["f64",bits(value)];
                if(type!=="object")failure("non-JSON "+type+" value at "+JSON.stringify(path),false);
                if(options.isProxy&&options.isProxy(value))failure("initial Proxy table is unsupported",false);
                if(depth>maxDepth)failure("table depth exceeds qualification bound",false);
                var previous=workerMapGet(local,value);
                if(previous){if(previous.visiting)failure("cyclic JSON table at "+JSON.stringify(path),false);return["ref",previous.id];}
                if(workerMapHas(records,value)||workerMapHas(proxies,value))failure("raw/wrapped alias crosses named table roots",false);
                if(nodes.length>=maxNodes)failure("table node bound exceeded",false);
                var isArray=Array.isArray(value),proto=prototypeOf(value);
                if(proto!==(isArray?arrayProto:objectProto))failure("unsupported JSON prototype at "+JSON.stringify(path),false);
                if(!Object.isExtensible(value))failure("non-extensible initial table node",false);
                var record={raw:value,table:name,path:path.slice(),kind:isArray?"array":"object",id:nodes.length,root:rootInfo,visiting:true,proxy:null,metadata:null};
                workerMapSet(local,value,record);pending.push(record);
                var node={id:record.id,kind:record.kind,prototype:isArray?"Array.prototype":"Object.prototype",extensible:true,properties:[]};nodes.push(node);
                var keys=ownKeys(value);
                for(var i=0;i<keys.length;i++){
                    var key=keys[i],d=descriptor(value,key);
                    if(typeof key!=="string"||!d||!("value" in d))failure("non-JSON key/accessor descriptor",false);
                    var lengthProperty=isArray&&key==="length";
                    if(d.writable!==true||d.enumerable!==!lengthProperty||d.configurable!==!lengthProperty)failure("unsupported initial JSON descriptor: "+key,false);
                    if(isArray&&!lengthProperty&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=4294967295||Number(key)>=value.length))failure("non-index array property: "+key,false);
                    node.properties.push({key:key,enumerable:d.enumerable,configurable:d.configurable,writable:d.writable,value:scalar(d.value,path.concat([key]),depth+1)});
                }
                record.visiting=false;return["ref",record.id];
            }
            var rootRef=scalar(root,[],0),text=JSON.stringify(["qualification-json-table-v1",rootRef,nodes]);
            var hash=digest(text);
            if(typeof hash!=="string"||!/^[0-9a-f]{64}$/.test(hash))failure("digest must return lowercase SHA-256 hex",false);
            rootInfo.sha256=hash;
            // Publish no proxies/records until the WHOLE root is validated.
            for(var i=0;i<pending.length;i++){
                var record=pending[i];workerMapSet(records,record.raw,record);
                record.metadata=Object.freeze({table:name,path:Object.freeze(record.path.slice()),sha256:hash,kind:record.kind});
            }
            workerMapSet(names,name,rootInfo);counters.roots++;counters.nodes+=pending.length;
            return makeProxy(workerMapGet(local,root));
        }
        function makeProxy(record){
            if(record.proxy)return record.proxy;
            var target=record.raw;
            function child(value,key){if(value!==null&&typeof value==="object"){var entry=workerMapGet(records,value);if(entry)return makeProxy(entry);if(key!==undefined&&descriptor(target,key))failure("unregistered own object child; raw host alias changed",false);}return value;}
            function deny(operation,key){return failure(operation+" on "+record.table+JSON.stringify(record.path)+(key===undefined?"":" key "+String(key)),true);}
            var proxy=new Proxy(target,{
                get:function(t,key,receiver){counters.gets++;return child(Reflect.get(t,key,receiver),key);},
                getOwnPropertyDescriptor:function(t,key){
                    counters.descriptors++;var d=descriptor(t,key);if(!d)return undefined;
                    // All object-valued own descriptors are configurable, so a
                    // wrapped child respects Proxy descriptor invariants.
                    return{value:child(d.value,key),writable:d.writable,enumerable:d.enumerable,configurable:d.configurable};
                },
                set:function(t,key){return deny("set",key);},
                defineProperty:function(t,key){return deny("defineProperty",key);},
                deleteProperty:function(t,key){return deny("deleteProperty",key);},
                setPrototypeOf:function(){return deny("setPrototypeOf");},
                preventExtensions:function(){return deny("preventExtensions");}
            });
            record.proxy=proxy;workerMapSet(proxies,proxy,record);counters.proxies++;return proxy;
        }
        return{
            wrap:function(root,info){return register(root,info&&info.name);},
            parse:function(){return failure("generic parse is outside whole-worker root lease",false);},
            immutableMetadata:function(value){if(firstFailure!==null)failure("previous violation: "+firstFailure,false);var record=value!==null&&(typeof value==="object"||typeof value==="function")?workerMapGet(proxies,value):null;return record?record.metadata:null;},
            assertClean:function(){assertWorkerLease();if(firstFailure!==null)failure("previous violation: "+firstFailure,false);return true;},
            stats:function(){return{roots:counters.roots,nodes:counters.nodes,proxies:counters.proxies,gets:counters.gets,descriptors:counters.descriptors,writes:counters.writes,failures:counters.failures,clean:firstFailure===null,firstFailure:firstFailure};}
        };
    };
})(globalThis);
