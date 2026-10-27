/* Shared source/AOT logical-state exporter. Ordinary JavaScript only.
 * Observational capture does not invoke source getters or callbacks. Native
 * closure environments and weak-collection contents remain explicit boundaries.
 * Function code is emitted once in codeTable; state retains identity + code ID.
 */
(function (host) {
    "use strict";
    var ownKeys = Reflect.ownKeys;
    var descriptor = Object.getOwnPropertyDescriptor;
    var prototypeOf = Object.getPrototypeOf;
    var functionText = Function.prototype.toString;
    function apply(fn, receiver, args) { return Reflect.apply(fn, receiver, args); }
    var data = new DataView(new ArrayBuffer(8));
    // Number Map equality is bit-exact except zero and NaN. Handle signed zero
    // directly and never memoize NaNs, retaining their sign/payload through the
    // same DataView store as the uncached encoder. Bound diagnostic cache size.
    var numberBits = new Map();
    function bits(value) {
        if (value === 0) return 1 / value < 0 ? "8000000000000000" : "0000000000000000";
        var cacheable = value === value, cached = cacheable ? numberBits.get(value) : undefined;
        if (cached !== undefined) return cached;
        data.setFloat64(0, value, false);
        var encoded = data.getUint32(0, false).toString(16).padStart(8, "0") + data.getUint32(4, false).toString(16).padStart(8, "0");
        if (cacheable) { if (numberBits.size >= 4096) numberBits.clear(); numberBits.set(value, encoded); }
        return encoded;
    }
    var typedArrayBrand = /^(Uint|Int|Float|BigInt|BigUint).*Array$/;
    // SHA-256 over UTF-8, including replacement of lone UTF-16 surrogates as in
    // Node's UTF-8 encoder. Diagnostic hashing requires no host crypto binding.
    host.portableTraceSha256 = function portableTraceSha256(text) {
        var words=[], byteLength=0;
        function byte(value){var index=byteLength>>>2;words[index]=(words[index]||0)|(value<<(24-(byteLength%4)*8));byteLength++;}
        for(var i=0;i<text.length;i++){
            var c=text.charCodeAt(i);
            if(c>=0xd800&&c<=0xdbff){var next=text.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){c=0x10000+((c-0xd800)<<10)+(next-0xdc00);i++;}else c=0xfffd;}
            else if(c>=0xdc00&&c<=0xdfff)c=0xfffd;
            if(c<128)byte(c);
            else if(c<2048){byte(192|(c>>>6));byte(128|(c&63));}
            else if(c<65536){byte(224|(c>>>12));byte(128|((c>>>6)&63));byte(128|(c&63));}
            else{byte(240|(c>>>18));byte(128|((c>>>12)&63));byte(128|((c>>>6)&63));byte(128|(c&63));}
        }
        var length=byteLength;
        byte(128);while(byteLength%64!==56)byte(0);
        var high=Math.floor(length/536870912),low=(length*8)>>>0;
        for(var shift=24;shift>=0;shift-=8)byte((high>>>shift)&255);
        for(var shift2=24;shift2>=0;shift2-=8)byte((low>>>shift2)&255);
        var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        function r(x,n){return(x>>>n)|(x<<(32-n));}
        var w=new Array(64);
        for(var offset=0;offset<words.length;offset+=16){
            for(var j=0;j<64;j++)w[j]=j<16?words[offset+j]|0:((r(w[j-15],7)^r(w[j-15],18)^(w[j-15]>>>3))+w[j-16]+(r(w[j-2],17)^r(w[j-2],19)^(w[j-2]>>>10))+w[j-7])|0;
            var a=h[0],b=h[1],c0=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
            for(var round=0;round<64;round++){
                var t1=(hh+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[round]+w[round])|0;
                var t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c0)^(b&c0)))|0;
                hh=g;g=f;f=e;e=(d+t1)|0;d=c0;c0=b;b=a;a=(t1+t2)|0;
            }
            h[0]=(h[0]+a)|0;h[1]=(h[1]+b)|0;h[2]=(h[2]+c0)|0;h[3]=(h[3]+d)|0;h[4]=(h[4]+e)|0;h[5]=(h[5]+f)|0;h[6]=(h[6]+g)|0;h[7]=(h[7]+hh)|0;
        }
        var hex='';for(var hi=0;hi<h.length;hi++)hex+=(h[hi]>>>0).toString(16).padStart(8,'0');return hex;
    };
    host.installGraphCapture = function installGraphCapture(options) {
        options = options || {};
        var strict = !!options.strictGraph;
        var maxNodes = options.maxNodes === undefined ? 100000 : options.maxNodes;
        var ids = new WeakMap(), nextId = 1, symbols = new Map(), nextSymbol = 1;
        var codeOverrides = new WeakMap(), functionCodes = new WeakMap(), codeIds = new Map(), codeTable = [];
        var intrinsics = new WeakMap(), brands = new WeakMap();
        var propertyCaches = new WeakMap(), nodeCaches = new WeakMap();
        function sameEncoding(a,b) {
            if(a===b)return true;
            if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
            for(var i=0;i<a.length;i++)if(!sameEncoding(a[i],b[i]))return false;
            return true;
        }
        var standardFunctions = ["length", "name", "arguments", "caller"];
        var names = ["Object", "Function", "Array", "String", "Number", "Boolean", "BigInt", "Symbol", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Promise", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Error", "TypeError", "RangeError"];
        for (var ni = 0; ni < names.length; ni++) {
            var constructor = host[names[ni]];
            if (typeof constructor !== "function") continue;
            intrinsics.set(constructor, names[ni]);
            if (constructor.prototype) { intrinsics.set(constructor.prototype, names[ni] + ".prototype"); brands.set(constructor.prototype, names[ni]); }
        }
        intrinsics.set(Math, "Math"); intrinsics.set(JSON, "JSON"); intrinsics.set(Reflect, "Reflect");
        var typedPrototype = typeof Uint8Array === "function" ? prototypeOf(Uint8Array.prototype) : null;
        if (typedPrototype) intrinsics.set(typedPrototype, "%TypedArray%.prototype");
        function symbol(value) {
            if (!symbols.has(value)) symbols.set(value, nextSymbol++);
            var description = value.description;
            return ["symbol", symbols.get(value), Symbol.keyFor(value) === undefined ? null : Symbol.keyFor(value), description === undefined ? null : description];
        }
        function identify(value) { if (!ids.has(value)) ids.set(value, nextId++); return ids.get(value); }
        function code(fn) {
            if (functionCodes.has(fn)) return functionCodes.get(fn);
            var entry, override = codeOverrides.get(fn);
            if (override !== undefined) entry = { kind: "logical", identity: override };
            else {
                var text = apply(functionText, fn, []);
                if (/\{\s*\[native code\]\s*\}/.test(text)) {
                    var name = descriptor(fn, "name"), length = descriptor(fn, "length");
                    entry = { kind: "native", name: name && "value" in name ? name.value : "", length: length && "value" in length ? length.value : 0 };
                } else entry = { kind: "source", source: text };
            }
            var key = JSON.stringify(entry), id = codeIds.get(key);
            if (id === undefined) { id = codeTable.length; codeIds.set(key, id); codeTable.push(entry); }
            functionCodes.set(fn, id); return id;
        }
        function defaultPrototype(value, fn) {
            if (!value || typeof value !== "object") return false;
            var keys = ownKeys(value), d = descriptor(value, "constructor"), parent = prototypeOf(value);
            return keys.length === 1 && keys[0] === "constructor" && d && d.value === fn && d.writable === true && d.enumerable === false && d.configurable === true && intrinsics.get(parent) === "Object.prototype";
        }
        function codeOnly(fn) {
            var keys = ownKeys(fn);
            for (var i = 0; i < keys.length; i++) {
                if (standardFunctions.indexOf(keys[i]) !== -1) continue;
                if (keys[i] !== "prototype") return false;
                var d = descriptor(fn, keys[i]);
                if (!d || !("value" in d) || !d.writable || d.enumerable || d.configurable || !defaultPrototype(d.value, fn)) return false;
            }
            return true;
        }
        function brand(value) {
            var p = prototypeOf(value);
            while (p !== null) {
                if (brands.has(p)) return brands.get(p);
                p = prototypeOf(p);
            }
            return "Object";
        }
        function snapshot(roots) {
            var queue = [], seen = new Set(), nodes = [], opaque = [], functionCount = 0;
            function fail(message) { var error = new Error(message); error.graphCaptureFailure = true; throw error; }
            function encode(value) {
                if (value === null) return ["null"];
                var type = typeof value;
                if (type === "undefined") return ["undefined"];
                if (type === "boolean" || type === "string") return [type, value];
                if (type === "number") return ["f64", bits(value)];
                if (type === "bigint") return ["bigint", String(value)];
                if (type === "symbol") return symbol(value);
                if (options.isProxy && options.isProxy(value)) fail("Cannot faithfully inspect a Proxy");
                if (intrinsics.has(value)) return ["intrinsic", intrinsics.get(value)];
                if (type === "object") {
                    var d = descriptor(value, "constructor"), fn = d && d.value;
                    if (typeof fn === "function" && descriptor(fn, "prototype") && descriptor(fn, "prototype").value === value && defaultPrototype(value, fn)) return ["default-function-prototype", encode(fn)];
                }
                var id = identify(value);
                if (!seen.has(id)) {
                    if (seen.size >= maxNodes) fail("Graph exceeds node bound; no partial snapshot emitted");
                    seen.add(id);
                    if (type === "function" && !strict && codeOnly(value)) functionCount++;
                    else queue.push(value);
                }
                return type === "function" && !strict ? ["function", id, code(value)] : ["ref", id];
            }
            var encodedRoots = [], rootNames = Object.keys(roots);
            for (var ri = 0; ri < rootNames.length; ri++) encodedRoots.push([rootNames[ri], encode(roots[rootNames[ri]])]);
            for (var offset = 0; offset < queue.length; offset++) {
                var value = queue[offset], id = ids.get(value), isFunction = typeof value === "function", codeFunction = isFunction && !strict;
                var node = { id: id, kind: isFunction ? "function" : Array.isArray(value) ? "array" : "object", properties: [], extensible: Object.isExtensible(value) };
                if (!codeFunction) node.prototype = encode(prototypeOf(value));
                if (isFunction) { node.code = code(value); functionCount++; }
                var type = brand(value);
                try {
                    if (type === "Number" || type === "Boolean" || type === "String" || type === "BigInt" || type === "Symbol") {
                        node.value = encode(apply(host[type].prototype.valueOf, value, [])); node.kind = "boxed_" + type.toLowerCase();
                    } else if (type === "Date") { node.time = encode(apply(Date.prototype.getTime, value, [])); node.kind = "date"; }
                    else if (type === "Map") {
                        var entries = apply(Map.prototype.entries, value, []), entry; node.entries = []; node.kind = "map";
                        while (!(entry = entries.next()).done) node.entries.push([encode(entry.value[0]), encode(entry.value[1])]);
                    } else if (type === "Set") {
                        var values = apply(Set.prototype.values, value, []), item; node.entries = []; node.kind = "set";
                        while (!(item = values.next()).done) node.entries.push(encode(item.value));
                    } else if (type === "WeakMap" || type === "WeakSet" || type === "Promise") opaque.push({ id: id, kind: type + "_internal_state" });
                    else if (type === "RegExp") {
                        node.pattern = apply(descriptor(RegExp.prototype, "source").get, value, []); node.flags = [];
                        var flags = ["hasIndices", "global", "ignoreCase", "multiline", "dotAll", "unicode", "unicodeSets", "sticky"];
                        for (var fi = 0; fi < flags.length; fi++) { var getter = descriptor(RegExp.prototype, flags[fi]); if (getter && apply(getter.get, value, [])) node.flags.push(flags[fi]); }
                        node.kind = "regexp";
                    } else if (type === "ArrayBuffer" || type === "SharedArrayBuffer") {
                        apply(descriptor(host[type].prototype, "byteLength").get, value, []);
                        var bytes = new Uint8Array(value), hex = ""; for (var bi = 0; bi < bytes.length; bi++) hex += (bytes[bi] + 256).toString(16).slice(1); node.bytes = hex; node.kind = "arraybuffer";
                    } else if (type === "DataView" || typedArrayBrand.test(type)) {
                        var p = type === "DataView" ? DataView.prototype : typedPrototype;
                        node.buffer = encode(apply(descriptor(p, "buffer").get, value, []));
                        node.byteOffset = apply(descriptor(p, "byteOffset").get, value, []); node.byteLength = apply(descriptor(p, "byteLength").get, value, []); node.kind = type === "DataView" ? "dataview" : "typedarray";
                    }
                } catch (error) {
                    if (error.graphCaptureFailure) throw error;
                    // A plain object can deliberately inherit a native prototype
                    // without carrying its internal slots. Retain that fact.
                    node.kind = "object"; node.nativeBrandRejected = type;
                    delete node.value; delete node.time; delete node.entries; delete node.pattern; delete node.flags; delete node.bytes; delete node.buffer; delete node.byteOffset; delete node.byteLength;
                }
                var propertyCache=propertyCaches.get(value);
                if(!propertyCache){propertyCache=new Map();propertyCaches.set(value,propertyCache);}
                var keys = ownKeys(value);
                for (var ki = 0; ki < keys.length; ki++) {
                    var key = keys[ki], propertyDescriptor = descriptor(value, key);
                    if (codeFunction && standardFunctions.indexOf(key) !== -1) continue;
                    if (codeFunction && key === "prototype" && "value" in propertyDescriptor && propertyDescriptor.writable && !propertyDescriptor.enumerable && !propertyDescriptor.configurable && defaultPrototype(propertyDescriptor.value, value)) continue;
                    var previous=propertyCache.get(key),isData="value" in propertyDescriptor;
                    var sameValue=isData&&previous&&previous.data&&Object.is(previous.value,propertyDescriptor.value)&&
                        (typeof propertyDescriptor.value!=="number"||propertyDescriptor.value===propertyDescriptor.value||previous.numberBits===bits(propertyDescriptor.value));
                    if(previous&&previous.data===isData&&previous.enumerable===propertyDescriptor.enumerable&&previous.configurable===propertyDescriptor.configurable&&
                        (isData?previous.writable===propertyDescriptor.writable&&sameValue:previous.get===propertyDescriptor.get&&previous.set===propertyDescriptor.set)){
                        var reusable=true;
                        if(isData){
                            var child=propertyDescriptor.value,childType=typeof child;
                            // Even unchanged edges must traverse every mutable
                            // descendant and re-check function/prototype shape.
                            if(child!==null&&(childType==="object"||childType==="function"||childType==="symbol"))reusable=sameEncoding(previous.property.value,encode(child));
                        }else{
                            reusable=sameEncoding(previous.property.get,encode(propertyDescriptor.get));
                            reusable=sameEncoding(previous.property.set,encode(propertyDescriptor.set))&&reusable;
                        }
                        if(reusable){node.properties.push(previous.property);continue;}
                    }
                    var property = { key: typeof key === "symbol" ? symbol(key) : ["string", key], enumerable: propertyDescriptor.enumerable, configurable: propertyDescriptor.configurable };
                    if ("value" in propertyDescriptor) { property.writable = propertyDescriptor.writable; property.value = encode(propertyDescriptor.value); }
                    else { property.get = encode(propertyDescriptor.get); property.set = encode(propertyDescriptor.set); }
                    propertyCache.set(key,{data:isData,value:propertyDescriptor.value,get:propertyDescriptor.get,set:propertyDescriptor.set,
                        enumerable:propertyDescriptor.enumerable,configurable:propertyDescriptor.configurable,writable:propertyDescriptor.writable,
                        numberBits:isData&&typeof propertyDescriptor.value==="number"&&propertyDescriptor.value!==propertyDescriptor.value?bits(propertyDescriptor.value):null,property:property});
                    node.properties.push(property);
                }
                if(propertyCache.size>node.properties.length)for(var cachedKey of propertyCache.keys())if(keys.indexOf(cachedKey)===-1)propertyCache.delete(cachedKey);
                // Reuse only ordinary graph records with no native internal
                // fields. Native objects and rejected brands are rebuilt above.
                if((node.kind==="object"||node.kind==="array"||node.kind==="function")&&node.nativeBrandRejected===undefined){
                    var previousNode=nodeCaches.get(value),same=previousNode&&previousNode.kind===node.kind&&previousNode.extensible===node.extensible&&previousNode.code===node.code&&
                        sameEncoding(previousNode.prototype,node.prototype)&&previousNode.properties.length===node.properties.length;
                    for(var pi=0;same&&pi<node.properties.length;pi++)if(previousNode.properties[pi]!==node.properties[pi])same=false;
                    if(same)node=previousNode;else nodeCaches.set(value,node);
                }
                if (!codeFunction || node.properties.length) nodes.push(node);
            }
            if (functionCount) opaque.push({ kind: "function_closure_bindings", count: functionCount });
            var graph = { version: 3, roots: encodedRoots, nodes: nodes, codeTable: codeTable.slice(), coverage: { accessorsInvoked: false, functionPolicy: strict ? "graph" : "code", opaque: opaque, proxyDetection: typeof options.isProxy === "function" ? "provided" : "source-domain-no-proxies" } };
            if (options.hash) graph.sha256 = options.hash(JSON.stringify({ version: graph.version, roots: graph.roots, nodes: graph.nodes, codeTable: graph.codeTable }));
            return graph;
        }
        return {
            snapshot: snapshot,
            codeTable: codeTable,
            registerFunctionCode: function (fn, identity) {
                if (typeof fn !== "function" || typeof identity !== "string") throw new Error("Logical function identity requires function + string");
                if (functionCodes.has(fn)) throw new Error("Function code already captured");
                codeOverrides.set(fn, identity);
            }
        };
    };
    // The same recorder is injected verbatim in both execution engines. Every
    // payload number is covered by the graph's binary64 encoding, rather than
    // JSON's lossy NaN/-0 conversion. This is a diagnostic path, never a timer.
    host.installPortableBattleTrace = function installPortableBattleTrace(options) {
        options = options || {};
        var capture = host.installGraphCapture(options), events = [], finished = false, canonicalCode=[], codeHashes=[], nodeHashes=new Map(), identityHashes=new WeakMap();
        var digest=options.digest||host.portableTraceSha256;
        var maxEvents = options.maxEvents === undefined ? 1000000 : options.maxEvents;
        return {
            capture: capture,
            record: function (kind, payload, roots) {
                if (finished) throw new Error("Cannot append after trace completion");
                if (typeof kind !== "string") throw new Error("Trace event kind must be a string");
                if (events.length >= maxEvents) throw new Error("Trace exceeds event bound; no completed trace emitted");
                var graph = capture.snapshot({ state: roots, payload: payload });
                var event={sequence:events.length,kind:kind};
                if(options.compact){
                    while(canonicalCode.length<graph.codeTable.length){
                        var entry=graph.codeTable[canonicalCode.length];
                        canonicalCode.push(entry.kind==='source'?{kind:'source',sha256:digest(entry.source)}:entry);
                        codeHashes.push(digest(JSON.stringify(canonicalCode[canonicalCode.length-1])));
                    }
                    var orderedHashes=[];
                    for(var ni=0;ni<graph.nodes.length;ni++){
                        var node=graph.nodes[ni],cached=identityHashes.get(node);
                        if(!cached){
                            var text=JSON.stringify(node);cached=nodeHashes.get(node.id);
                            if(!cached||cached.text!==text){cached={text:text,hash:digest(text)};nodeHashes.set(node.id,cached);}
                            identityHashes.set(node,cached);
                        }
                        orderedHashes.push([node.id,cached.hash]);
                    }
                    // Exact Merkle coverage: every node byte and its traversal
                    // order are covered. Reuse needs equality of the complete
                    // serialization; no mutable field is assumed invariant.
                    event.stateHash=digest(JSON.stringify(['portable-graph-merkle-v1',graph.version,graph.roots,orderedHashes,codeHashes,
                        {accessorsInvoked:graph.coverage.accessorsInvoked,functionPolicy:graph.coverage.functionPolicy,opaque:graph.coverage.opaque}]));
                }else event.graph=graph;
                events.push(event);
                if(options.onProgress&&events.length%(options.progressInterval||100)===0)
                    options.onProgress({events:events.length,kind:kind,frame:payload&&payload.frame,nodes:graph.nodes.length,codeEntries:graph.codeTable.length});
                return event;
            },
            finish: function (summary) {
                if (finished) throw new Error("Trace already completed");
                if (!summary || summary.status !== "completed" || summary.running !== false)
                    throw new Error("Only a terminated source battle can complete a trace");
                this.record("battle:completed", summary, {});
                finished = true;
                return { version: 1, status: "completed", graphHash:options.compact?'sha256-merkle-v1':null,events: events, qualifiesForThroughputTarget: false };
            }
        };
    };
})(globalThis);
