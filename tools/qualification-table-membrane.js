/* Qualification-only read-only JSON table boundary. Inject the same source in
 * oracle and candidate; keep the returned capability outside game globals.
 * Hash reuse is justified by enforced writes failing, never by assumed purity.
 */
(function(host){
    "use strict";
    host.installQualificationTableMembrane=function installQualificationTableMembrane(options){
        options=options||{};
        if(typeof options.digest!=="function")throw new Error("Table membrane requires an exact digest function");
        var jsonParse=JSON.parse;
        var digest=options.digest,records=new WeakMap(),proxies=new WeakMap(),names=new Map();
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
        function register(root,name){
            if(firstFailure!==null)failure("previous violation: "+firstFailure,false);
            if(typeof name!=="string"||name.length===0)failure("named table root required",false);
            if(root===null||typeof root!=="object")failure("table root must be a JSON object or array",false);
            if(proxies.has(root)){
                var known=proxies.get(root);if(known.table!==name||known.path.length!==0)failure("wrapped root registered with a different name/path",false);return root;
            }
            if(records.has(root)){
                var old=records.get(root);if(old.table!==name||old.path.length!==0)failure("raw alias crosses named table roots",false);return old.proxy||makeProxy(old);
            }
            if(names.has(name))failure("table name reused with a different raw root: "+name,false);
            var local=new WeakMap(),pending=[],nodes=[],rootInfo={name:name,sha256:null};
            function scalar(value,path,depth){
                if(value===null)return["null"];
                var type=typeof value;
                if(type==="string"||type==="boolean")return[type,value];
                if(type==="number")return["f64",bits(value)];
                if(type!=="object")failure("non-JSON "+type+" value at "+JSON.stringify(path),false);
                if(options.isProxy&&options.isProxy(value))failure("initial Proxy table is unsupported",false);
                if(depth>maxDepth)failure("table depth exceeds qualification bound",false);
                var previous=local.get(value);
                if(previous){if(previous.visiting)failure("cyclic JSON table at "+JSON.stringify(path),false);return["ref",previous.id];}
                if(records.has(value)||proxies.has(value))failure("raw/wrapped alias crosses named table roots",false);
                if(nodes.length>=maxNodes)failure("table node bound exceeded",false);
                var isArray=Array.isArray(value),proto=prototypeOf(value);
                if(proto!==(isArray?arrayProto:objectProto))failure("unsupported JSON prototype at "+JSON.stringify(path),false);
                if(!Object.isExtensible(value))failure("non-extensible initial table node",false);
                var record={raw:value,table:name,path:path.slice(),kind:isArray?"array":"object",id:nodes.length,root:rootInfo,visiting:true,proxy:null,metadata:null};
                local.set(value,record);pending.push(record);
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
                var record=pending[i];records.set(record.raw,record);
                record.metadata=Object.freeze({table:name,path:Object.freeze(record.path.slice()),sha256:hash,kind:record.kind});
            }
            names.set(name,rootInfo);counters.roots++;counters.nodes+=pending.length;
            return makeProxy(local.get(root));
        }
        function makeProxy(record){
            if(record.proxy)return record.proxy;
            var target=record.raw;
            function child(value,key){if(value!==null&&typeof value==="object"){var entry=records.get(value);if(entry)return makeProxy(entry);if(key!==undefined&&descriptor(target,key))failure("unregistered own object child; raw host alias changed",false);}return value;}
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
            record.proxy=proxy;proxies.set(proxy,record);counters.proxies++;return proxy;
        }
        return{
            wrap:function(root,info){return register(root,info&&info.name);},
            parse:function(text,info){if(typeof text!=="string")failure("JSON text must be a primitive string",false);return register(jsonParse(text),info&&info.name);},
            immutableMetadata:function(value){if(firstFailure!==null)failure("previous violation: "+firstFailure,false);var record=value!==null&&(typeof value==="object"||typeof value==="function")?proxies.get(value):null;return record?record.metadata:null;},
            assertClean:function(){if(firstFailure!==null)failure("previous violation: "+firstFailure,false);return true;},
            stats:function(){return{roots:counters.roots,nodes:counters.nodes,proxies:counters.proxies,gets:counters.gets,descriptors:counters.descriptors,writes:counters.writes,failures:counters.failures,clean:firstFailure===null,firstFailure:firstFailure};}
        };
    };
})(globalThis);
