//! Closed-world acceleration of the exact battle-mode predicate. Immutable
//! configuration plans replace only transient pure split/parser work. Both
//! actual getDataTable calls and the conditional getBattleId call still run.
use crate::{Runtime,Value,StringId,ObjectId,ObjectKind,PropertyKey,Descriptor,PropertyKind,EnvId,JsResult};
use crate::closures::{FunctionKind,FunctionSource};
const TABLE_SOURCE:&str=include_str!("battle_mode_get_table_source.js");
const ID_SOURCE:&str=include_str!("battle_mode_get_id_source.js");
const PARSER_SOURCE:&str=include_str!("battle_mode_parser_source.js");
pub(crate) struct BattleModeGuard{object:Value,properties:Vec<(ObjectId,PropertyKey,Option<Descriptor>)>}
pub(crate) struct BattleModePlan{stage:StringId,heroes:StringId,ranges:Vec<(StringId,u32,u32)>,hero_ids:Vec<u32>}
enum Raw{Missing,Value(Value),Unsafe}
fn same(a:Option<Descriptor>,b:Option<Descriptor>)->bool{match(a,b){(None,None)=>true,(Some(a),Some(b))=>a.enumerable==b.enumerable&&a.configurable==b.configurable&&match(a.kind,b.kind){(PropertyKind::Data{value:a,writable:aw},PropertyKind::Data{value:b,writable:bw})=>a==b&&aw==bw,_=>false},_=>false}}
fn exact_source(source:Option<&FunctionSource>,expected:&str)->bool{match source{Some(FunctionSource::Owned(s))=>s.iter().copied().eq(expected.encode_utf16()),Some(FunctionSource::StaticUtf16Le{bytes,start,end})=>bytes.get(start.saturating_mul(2)..end.saturating_mul(2)).is_some_and(|b|b.chunks_exact(2).map(|p|u16::from_le_bytes([p[0],p[1]])).eq(expected.encode_utf16())),_=>false}}
fn integer(v:Value)->Option<u32>{match v{Value::Number(n)if n.is_finite()&&n>=0.0&&n<=u32::MAX as f64&&n.fract()==0.0=>Some(n as u32),_=>None}}
impl Runtime {
 pub(crate) fn capture_battle_mode_guard(&mut self){let mut properties=Vec::new();let object_key=PropertyKey(self.intern("Object"));let Some(d)=self.objects[self.global_object.0].own(object_key)else{return};let PropertyKind::Data{value:object,..}=d.kind else{return};let Ok(object_id)=self.object_id(object)else{return};let has_key=PropertyKey(self.intern("hasOwnProperty"));let Some(has)=self.objects[self.object_prototype.0].own(has_key)else{return};let PropertyKind::Data{value:has,..}=has.kind else{return};let Ok(has_id)=self.object_id(has)else{return};for(object,name)in[(self.global_object,"Object"),(object_id,"prototype"),(self.object_prototype,"hasOwnProperty"),(self.function_prototype,"call"),(has_id,"call"),(self.string_prototype,"split")]{let key=PropertyKey(self.intern(name));properties.push((object,key,self.objects[object.0].own(key)));}self.battle_mode_guard=Some(BattleModeGuard{object,properties});}
 fn mode_raw_property(&self,value:Value,key:PropertyKey)->Raw{let Ok(mut id)=self.object_id(value)else{return Raw::Unsafe};for _ in 0..32{let Some(object)=self.objects.get(id.0)else{return Raw::Unsafe};if !matches!(object.kind,ObjectKind::Ordinary)||!object.arguments_map.is_empty(){return Raw::Unsafe}if let Some(d)=object.own(key){return match d.kind{PropertyKind::Data{value,..}=>Raw::Value(value),_=>Raw::Unsafe}}if let Some(parent)=object.prototype{id=parent}else{return Raw::Missing}}Raw::Unsafe}
 fn mode_raw_binding(&self,mut env:EnvId,name:StringId)->Raw{loop{let Some(e)=self.environments.get(env.0)else{return Raw::Unsafe};if let Some(&slot)=e.bindings.get(&name){let Some(b)=e.cells.get(slot)else{return Raw::Unsafe};if !b.alive||!b.initialized{return Raw::Unsafe}if !b.object_backed{return Raw::Value(b.value)}break}if let Some(parent)=e.parent{env=parent}else{break}}self.mode_raw_property(Value::Object(self.global_object),PropertyKey(name))}
 fn mode_value(&mut self,value:Value,name:&'static str)->Option<Value>{let key=PropertyKey(self.static_identifier_id(name));match self.mode_raw_property(value,key){Raw::Value(v)=>Some(v),_=>None}}
 fn mode_source_env(&self,value:Value,source:&str)->Option<EnvId>{let Value::Function(id)=value else{return None};let f=self.functions.get(id.0)?;if !exact_source(f.source.as_ref(),source){return None}match f.kind{FunctionKind::Native{env,..}=>Some(env),_=>None}}
 fn mode_helpers_intact(&self)->bool{let Some(g)=&self.battle_mode_guard else{return false};for &(object,key,expected)in &g.properties{if !same(self.objects[object.0].own(key),expected){return false}}if self.objects[self.function_prototype.0].prototype!=Some(self.object_prototype)||self.objects[self.string_prototype.0].prototype!=Some(self.object_prototype){return false}let has_key=g.properties[2].1;let Some(Descriptor{kind:PropertyKind::Data{value:has,..},..})=self.objects[self.object_prototype.0].own(has_key)else{return false};let Ok(id)=self.object_id(has)else{return false};self.objects[id.0].prototype==Some(self.function_prototype)&&!self.objects[self.object_prototype.0].properties.iter().flatten().any(|(_,d)|d.enumerable)}
 pub fn try_native_battle_mode_limit(&mut self,hero:Value,parent:EnvId)->JsResult<Option<Value>>{
  if !self.native_battle_mode_limit_enabled{return Ok(None)}if !self.truthy(hero){return Ok(Some(Value::Bool(false)))}
  if !self.mode_helpers_intact(){return Ok(None)}
  let ed_name=self.static_identifier_id("ed");let Raw::Value(ed)=self.mode_raw_binding(parent,ed_name)else{return Ok(None)};
  let Some(engine)=self.mode_value(ed,"battleEngine")else{return Ok(None)};let Some(config)=self.mode_value(engine,"config")else{return Ok(None)};let Some(Value::String(mode))=self.mode_value(config,"mode")else{return Ok(None)};if self.string_units(mode).is_empty(){return Ok(None)}
  let Some(table_fn)=self.mode_value(ed,"getDataTable")else{return Ok(None)};let Some(table_env)=self.mode_source_env(table_fn,TABLE_SOURCE)else{return Ok(None)};
  let Some(parser)=self.mode_value(ed,"parseUseSkillCacheStageBattle")else{return Ok(None)};let Some(parser_env)=self.mode_source_env(parser,PARSER_SOURCE)else{return Ok(None)};if !self.stage_range_intrinsics_intact(parser_env){return Ok(None)}
  let object_name=self.static_identifier_id("Object");let Raw::Value(object)=self.mode_raw_binding(table_env,object_name)else{return Ok(None)};if object!=self.battle_mode_guard.as_ref().unwrap().object{return Ok(None)}
  let tables_name=self.static_identifier_id("__nativeTables");let Raw::Value(tables)=self.mode_raw_binding(table_env,tables_name)else{return Ok(None)};
  let boundary_name=self.static_identifier_id("__nativeTableBoundary");if !matches!(self.mode_raw_binding(table_env,boundary_name),Raw::Missing|Raw::Value(Value::Undefined)){return Ok(None)}
  let Some(param)=self.mode_value(tables,"Param")else{return Ok(None)};let param_key=PropertyKey(self.static_identifier_id("Param"));let Ok(tables_id)=self.object_id(tables)else{return Ok(None)};if !matches!(self.objects[tables_id.0].own(param_key),Some(Descriptor{kind:PropertyKind::Data{value,..},..})if value==param){return Ok(None)}
  let Some(stage)=self.mode_value(param,"Stage")else{return Ok(None)};let Some(stage_row)=self.mode_value(stage,"UseSkillCacheStageBattle")else{return Ok(None)};let Some(Value::String(stage_text))=self.mode_value(stage_row,"StrValue")else{return Ok(None)};
  let Some(hero_row)=self.mode_value(stage,"UseSkillCacheHeroList")else{return Ok(None)};let Some(Value::String(hero_text))=self.mode_value(hero_row,"StrValue")else{return Ok(None)};
  let Some(info)=self.mode_value(hero,"info")else{return Ok(None)};let Some(hero_id)=self.mode_value(info,"ID").and_then(integer)else{return Ok(None)};
  let Some(camp)=self.mode_value(hero,"camp").and_then(integer)else{return Ok(None)};let Some(camps)=self.mode_value(ed,"battle_camp")else{return Ok(None)};let Some(enemy)=self.mode_value(camps,"enemy").and_then(integer)else{return Ok(None)};
  if !self.battle_mode_plan.as_ref().is_some_and(|p|p.stage==stage_text&&p.heroes==hero_text){
   let units=self.string_units(stage_text);if units.len()>8192{return Ok(None)}let parts=units.split(|u|*u==59).collect::<Vec<_>>();if parts.len()>128{return Ok(None)}let mut raw:Vec<(Vec<u16>,u32,u32)>=Vec::new();let mut current:Option<&[u16]>=None;let mut i=0;
   while i<parts.len(){if let Some(lo)=crate::stage_range_parser::uint(parts[i]){let Some(name)=current else{return Ok(None)};let Some(next)=parts.get(i+1)else{return Ok(None)};let Some(hi)=crate::stage_range_parser::uint(next)else{return Ok(None)};raw.push((name.to_vec(),lo,hi));i+=2;}else if crate::stage_range_parser::mode(parts[i]){current=Some(parts[i]);i+=1;}else{return Ok(None)}}
   let hu=self.string_units(hero_text);if hu.len()>4096{return Ok(None)}let mut hero_ids=Vec::new();for token in hu.split(|u|*u==59){let Some(id)=crate::stage_range_parser::uint(token)else{return Ok(None)};if hero_ids.len()>=128{return Ok(None)}hero_ids.push(id)}hero_ids.sort_unstable();hero_ids.dedup();
   let mut ranges=Vec::new();for(name,lo,hi)in raw{let name=self.intern_utf16(&name);ranges.push((name,lo,hi));}self.battle_mode_plan=Some(BattleModePlan{stage:stage_text,heroes:hero_text,ranges,hero_ids});
  }
  let plan=self.battle_mode_plan.as_ref().unwrap();for &(name,_,_)in &plan.ranges{if self.objects[self.object_prototype.0].own(PropertyKey(name)).is_some(){return Ok(None)}}
  let match_mode=plan.ranges.iter().any(|(name,_,_)|*name==mode);
  let mut battle_fn=None;if match_mode{let Some(f)=self.mode_value(engine,"getBattleId")else{return Ok(None)};if self.mode_source_env(f,ID_SOURCE).is_none(){return Ok(None)}if self.mode_value(engine,"battle_id").and_then(integer).is_none(){return Ok(None)}battle_fn=Some(f);}
  // All reads, source identities and primitive domains are validated before
  // the first source call. The proven helper paths cannot mutate any inputs.
  let param_name=self.static_string("Param");let actual=self.call(table_fn,ed,&[param_name])?;debug_assert_eq!(actual,param);
  let range_matches=if let Some(f)=battle_fn{let id=self.call(f,engine,&[])?;let id=integer(id).expect("validated pure battle ID");self.battle_mode_plan.as_ref().unwrap().ranges.iter().any(|&(name,lo,hi)|name==mode&&id>=lo&&id<=hi)}else{false};
  let actual=self.call(table_fn,ed,&[param_name])?;debug_assert_eq!(actual,param);
  let hero_matches=self.battle_mode_plan.as_ref().unwrap().hero_ids.binary_search(&hero_id).is_ok();Ok(Some(Value::Bool(match_mode&&range_matches&&hero_matches&&camp==enemy)))
 }
}
impl BattleModeGuard{pub(crate)fn reachability_roots(&self)->Vec<Value>{let mut out=vec![self.object];for &(object,key,d)in &self.properties{out.push(Value::Object(object));out.push(Value::String(key.0));if let Some(Descriptor{kind:PropertyKind::Data{value,..},..})=d{out.push(value)}}out}}
impl BattleModePlan{pub(crate)fn reachability_roots(&self)->Vec<Value>{let mut out=vec![Value::String(self.stage),Value::String(self.heroes)];out.extend(self.ranges.iter().map(|(name,_,_)|Value::String(*name)));out}}
