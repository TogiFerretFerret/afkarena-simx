//! Source differential fixture for the connected Rust engine/unit/skill path.
//! This explicit fixture host is not a complete game-mechanics backend.
#[allow(dead_code)]
#[path="unit_skill_runtime_check.rs"] mod fixture;
use battle_core::{engine::{Battle,Outcome},engine_runtime as e,unit_skill_runtime as r,scheduler::{EntityId,ListId,Record}};
use std::io::{self,BufRead,Write};
use r::Hooks as _;
struct Host{inner:fixture::Host}
fn label(b:&Battle<e::EntityDispatch>)->String{
 format!("{}:{}:{}:{}:{}:{}:{}",fixture::bits(b.time_limit),fixture::bits(b.ticks),b.mode,b.config_mode.as_deref().unwrap_or("none"),b.entities.groups[0].0,b.entities.lists.iter().map(|v|v.iter().map(|x|x.0.to_string()).collect::<Vec<_>>().join(",")).collect::<Vec<_>>().join("/"),b.entities.entities.iter().map(|r|format!("{}{}",u8::from(r.frozen),u8::from(r.terminated))).collect::<Vec<_>>().join(","))
}
impl Host{
 fn event(&mut self,c:&mut e::DriverContext<'_, '_>,name:&str)->r::Result{
  let name=format!("{name}:{}",label(c.engine()?));
  c.mechanics().inspect(|u,s|self.inner.event_world(u,s,name))?;
  Ok(())
 }
 fn mark(&mut self,c:&mut e::DriverContext<'_, '_>,name:&str)->r::Result{c.mechanics().inspect(|u,s|self.inner.event_world(u,s,name))?;Ok(())}
}
impl e::RuntimeHooks for Host{
 fn engine(&mut self,c:&mut e::DriverContext<'_, '_>,call:e::EngineCall<'_>)->r::Result<e::EngineReply>{
  use e::{EngineCall as C,EngineReply as R};
  match call{
   C::Weather{dt}=>{self.event(c,&format!("engine:weather:{}",fixture::bits(dt)))?;Ok(R::Done)},
   C::Operation=>{self.event(c,"engine:operation")?;Ok(R::Done)},
   C::RageObjects{dt}=>{self.event(c,&format!("engine:rage:{}",fixture::bits(dt)))?;Ok(R::Done)},
   C::UpdateUnit{unit:0,dt,..}=>{self.event(c,&format!("engine:update:{}",fixture::bits(dt)))?;Ok(R::UseRustUnit)},
   C::RaceFix{..}=>{self.event(c,"engine:race-fix")?;Ok(R::Done)},
   C::Push{dt}=>{self.event(c,&format!("engine:push:{}",fixture::bits(dt)))?;Ok(R::Done)},
   C::IsHalloween{..}=>{self.event(c,"engine:is-halloween")?;Ok(R::Bool(false))},
   C::UsesMaxTicks{..}=>{self.event(c,"engine:uses-max")?;Ok(R::Bool(false))},
   C::FormatLog=>{self.event(c,"engine:format")?;Ok(R::Text("tick".into()))},
   C::AppendLog{text:"tick"}=>{self.event(c,"engine:append")?;Ok(R::Done)},
   C::End{outcome:Outcome::Timeout}=>{self.event(c,"engine:timeout")?;c.with_engine(|b|b.running=false)?;Ok(R::Done)},
   other=>Err(format!("unexpected engine fixture call: {other:?}")),
  }
 }
 fn unit(&mut self,c:&mut e::DriverContext<'_, '_>,call:r::UnitCall<'_>)->r::Result<r::Reply>{
  let is_manual=matches!(call,r::UnitCall::RecheckManual{..});
  let result=self.inner.unit(c.mechanics(),call);
  if result.is_ok()&&is_manual&&self.inner.action==21&&!self.inner.used{
   self.inner.used=true;c.with_engine(|b|b.freeze_level=0.0)?;
   self.mark(c,"mutate:engine-freeze-throw")?;return Err("fixture-sentinel".into())
  }
  result
 }
 fn skill(&mut self,c:&mut e::DriverContext<'_, '_>,call:r::SkillCall<'_>)->r::Result<r::Reply>{
  let is_attack=matches!(call,r::SkillCall::AttackFrame{..});
  let result=self.inner.skill(c.mechanics(),call);
  if result.is_ok()&&is_attack&&!self.inner.used{
   match self.inner.action{
    18=>{self.inner.used=true;c.mechanics().unit_mut(0)?.frozen_model=true;self.mark(c,"mutate:engine-unit-frozen")?;},
    19=>{self.inner.used=true;c.mechanics().set_mode("race_dream".into());self.mark(c,"mutate:engine-mode")?;},
    20=>{self.inner.used=true;c.with_engine(|b|b.tick_interval=0.25)?;self.mark(c,"mutate:engine-interval")?;},
    _=>{},
   }
  }
  result
 }
 fn resource(&mut self,c:&mut e::DriverContext<'_, '_>,call:r::ResourceCall)->r::Result<r::Reply>{
  if matches!(call,r::ResourceCall::Ticks){return Ok(r::Reply::Number(c.engine()?.ticks))}
  self.inner.resource(c.mechanics(),call)
 }
}
fn main()->io::Result<()>{
 let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());
 for line in stdin.lock().lines(){let line=line?;let mut input=line.split_whitespace();let action=input.next().unwrap().parse::<usize>().unwrap();let n=(0..9).map(|_|f64::from_bits(u64::from_str_radix(input.next().unwrap(),16).unwrap())).collect::<Vec<_>>();assert!(input.next().is_none());
  let runtime=fixture::make(&n,action);let mut battle=Battle::default();battle.running=true;battle.freeze_level=1.0;battle.tick_interval=n[0];battle.alive_enemy_count=1.0;battle.alive_player_count=1.0;battle.entities.entities.push(Record{frozen:false,terminated:false,data:e::EntityDispatch::Unit(0)});battle.entities.lists.push(vec![EntityId(0)]);battle.entities.groups.push(ListId(0));let mut driver=e::Driver::new(battle,runtime).unwrap();
  let mut host=Host{inner:fixture::Host{action,used:false,events:vec![],last_tick:-1.0,frame:0}};let mut errors=vec![];
  for frame in 0..2{
   host.inner.frame=driver.battle().ticks as usize;driver.inspect(|_,u,s|host.inner.event_world(u,s,format!("frame:{frame}:enter"))).unwrap();
   if let Err(error)=driver.tick(&mut host){assert_eq!(error,"fixture-sentinel");errors.push(format!("unit:{frame}"));driver.inspect(|_,u,s|host.inner.event_world(u,s,"error:unit")).unwrap();}
   driver.inspect(|_,u,s|host.inner.event_world(u,s,format!("frame:{frame}:after-unit"))).unwrap();
   if let Err(error)=driver.drain_callbacks(&mut host){assert_eq!(error,"fixture-sentinel");errors.push(format!("drain:{frame}"));driver.inspect(|_,u,s|host.inner.event_world(u,s,"error:drain")).unwrap();}
   driver.inspect(|_,u,s|host.inner.event_world(u,s,format!("frame:{frame}:after-drain"))).unwrap();
  }
  writeln!(out,"{{\"frames\":[{}],\"errors\":{:?},\"used\":{}}}",host.inner.events.join(","),errors,host.inner.used)?;
 }out.flush()
}
