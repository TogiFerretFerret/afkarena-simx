import assert from 'node:assert/strict';
export const componentVariants=Object.freeze({
 'all-on':{primary_numeric_arrays_enabled:true,ordinary_set_fast_path_enabled:true,dynamic_own_slots_enabled:true},
 'primary-off':{primary_numeric_arrays_enabled:false,ordinary_set_fast_path_enabled:true,dynamic_own_slots_enabled:true},
 'ownset-off':{primary_numeric_arrays_enabled:true,ordinary_set_fast_path_enabled:false,dynamic_own_slots_enabled:true},
 'ownread-off':{primary_numeric_arrays_enabled:true,ordinary_set_fast_path_enabled:true,dynamic_own_slots_enabled:false},
 'all-new-off':{primary_numeric_arrays_enabled:false,ordinary_set_fast_path_enabled:false,dynamic_own_slots_enabled:false},
});
export const defaultComponentVariants=['all-on','primary-off','ownset-off','all-new-off'];
export function selectComponentVariants(args){const selected=[];for(let i=0;i<args.length;i++){if(args[i]==='--variant'||args[i]==='--variants'){assert.ok(args[i+1],'Missing variant value');selected.push(...args[++i].split(','));}}const result=selected.length?selected:defaultComponentVariants;assert.ok(new Set(result).size===result.length,'Duplicate variant');for(const name of result)assert.ok(Object.hasOwn(componentVariants,name),'Unknown variant '+name);return result;}
export function componentGcExpectation(manifest){assert.equal(manifest.nativeBattleGc,true,'GC-enabled manifest required');assert.equal(manifest.gcProof?.passed,true,'Source GC proof required');const cadence=manifest.nativeBattleGcCadence;assert.ok(Number.isSafeInteger(cadence)&&cadence>0,'Invalid manifest GC cadence');return{cadence,totalBattles:23,expectedCollections:Math.ceil(23/cadence)};}
export function componentSelectorRust(){return `let variant=std::env::var("RUST_PORT_AB_VARIANT").expect("explicit component variant required");
 let (primary,ownset,ownread)=match variant.as_str(){${Object.entries(componentVariants).map(([name,flags])=>'"'+name+'"=>('+Object.values(flags).join(',')+'),').join('')}_=>panic!("unknown component variant")};
 let mut rt=Runtime::new_with_string_hash(js_runtime::StringHashMode::Fx);
 assert!(rt.literal_length_fast_path_enabled&&rt.numeric_property_key_cache_enabled&&rt.index_string_fast_path_enabled&&rt.dense_array_shift_enabled&&rt.literal_property_slots_enabled,"existing optimization defaults changed");
 rt.primary_numeric_arrays_enabled=primary;rt.ordinary_set_fast_path_enabled=ownset;rt.dynamic_own_slots_enabled=ownread;
 eprintln!("AB_VARIANT:{}",variant);`;}
