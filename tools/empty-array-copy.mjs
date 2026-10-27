import {types} from 'node:util';
import {runInContext} from 'node:vm';
import {sourceCopyFunction} from './flat-numeric-copy.mjs';

// This is a diagnostic prototype of the native preflight, never a default path.
// Private descriptor reads cannot invoke source getters or proxy traps.
export function installEmptyArrayCopyPrototype(runtime,{mode='observe'}={}){
 if(!['observe','specialize'].includes(mode))throw Error('Unknown empty-array copy mode');
 const global=runInContext('globalThis',runtime.context),arrayPrototype=Reflect.getPrototypeOf(runInContext('[]',runtime.context));
 const objectPrototype=Reflect.getPrototypeOf(runInContext('({})',runtime.context));
 const objectBinding=Reflect.getOwnPropertyDescriptor(global,'Object'),constructor=Reflect.getOwnPropertyDescriptor(objectPrototype,'constructor');
 if(!objectBinding||!('value'in objectBinding)||!constructor||!('value'in constructor)||objectBinding.value!==constructor.value||types.isProxy(objectBinding.value)||Function.prototype.toString.call(objectBinding.value)!=='function Object() { [native code] }')throw Error('Original Object required');
 const object=objectBinding.value,keys=Reflect.getOwnPropertyDescriptor(object,'keys'),arrayConstructor=Reflect.getOwnPropertyDescriptor(arrayPrototype,'constructor');
 if(!keys||!('value'in keys)||types.isProxy(keys.value)||Function.prototype.toString.call(keys.value)!=='function keys() { [native code] }')throw Error('Original Object.keys required');
 if(!arrayConstructor||!('value'in arrayConstructor)||types.isProxy(arrayConstructor.value)||Function.prototype.toString.call(arrayConstructor.value)!=='function Array() { [native code] }')throw Error('Original Array constructor required');
 const ArrayIntrinsic=arrayConstructor.value,original=runtime.ed.copyObj;
 if(types.isProxy(original)||Function.prototype.toString.call(original)!==sourceCopyFunction)throw Error('Exact source ed.copyObj required');
 function classify(value){
  if(types.isProxy(value))return 'proxy';
  if(!Array.isArray(value))return 'not_array';
  if(Reflect.getPrototypeOf(value)!==arrayPrototype)return 'prototype';
  const globalObject=Reflect.getOwnPropertyDescriptor(global,'Object'),currentKeys=Reflect.getOwnPropertyDescriptor(object,'keys'),currentConstructor=Reflect.getOwnPropertyDescriptor(arrayPrototype,'constructor');
  if(!globalObject||!('value'in globalObject)||globalObject.value!==object)return 'Object_changed';
  if(!currentKeys||!('value'in currentKeys)||currentKeys.value!==keys.value)return 'keys_changed';
  if(!currentConstructor||!('value'in currentConstructor)||currentConstructor.value!==ArrayIntrinsic)return 'constructor_changed';
  if(!Object.isExtensible(value))return 'nonextensible';
  const ownKeys=Reflect.ownKeys(value);if(ownKeys.length!==1||ownKeys[0]!=='length')return 'own_properties';
  const length=Reflect.getOwnPropertyDescriptor(value,'length');
  if(!length||!('value'in length)||length.value!==0||!length.writable||length.enumerable||length.configurable)return 'length';
  return 'eligible_empty';
 }
 const counts={calls:0,eligible:0,fastCalls:0,originalCalls:0},reasons={};
 function replacement(value){
  counts.calls++;const reason=classify(value);reasons[reason]=(reasons[reason]??0)+1;
  if(reason==='eligible_empty'){counts.eligible++;if(mode==='specialize'){counts.fastCalls++;return Reflect.construct(ArrayIntrinsic,[]);}}
  counts.originalCalls++;return Reflect.apply(original,this,[value]);
 }
 runtime.ed.copyObj=replacement;
 return{classify,stats:()=>({...counts,mode,reasons:{...reasons}}),restore(){if(runtime.ed.copyObj!==replacement)throw Error('Copy function replaced externally');runtime.ed.copyObj=original;}};
}
