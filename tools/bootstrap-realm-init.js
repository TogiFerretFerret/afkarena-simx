/* Shared source-oracle scaffold: construct all source globals and sentinel
 * constructors inside the executing JS realm, before Cocos or game startup.
 * This same text is copied into the compiled oracle.
 */
var ed=globalThis.ed={};
var cc=globalThis.cc={
    game:{config:null,CONFIG_KEY:{}},
    Node:function Node(){},
    error:function(){throw new Error(Array.prototype.join.call(arguments," "));}
};
var window=globalThis;
globalThis.window=globalThis;
globalThis.HTMLElement=function HTMLElement(){};
