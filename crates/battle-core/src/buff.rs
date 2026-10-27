//! Source ed.Buff.update and updateHPRDamage. Identity, live rereads and call order
//! are retained. Effects/removal/healing/damage remain required mechanics hooks.
use crate::skill::Number;
pub type UnitId=usize;pub type BuffId=usize;pub type Result<T=()>=std::result::Result<T,String>;
#[derive(Clone,Copy,Debug)]pub struct Unit{pub camp:f64,pub has_config:bool,pub field_npc:bool,pub is_unit:bool,pub hp:f64,pub max_hp:f64,pub heal:f64,pub dot_ratio:f64}
#[derive(Clone,Copy,Debug)]pub struct Buff{pub owner:UnitId,pub caster:Option<UnitId>,pub timer:Number,pub inc_hpr:Number,pub affected_by_attr:bool}
#[derive(Default)]pub struct World{pub units:Vec<Unit>,pub buffs:Vec<Buff>}
pub trait Hooks{
 fn is_turn_based(&mut self,w:&mut World,buff:BuffId)->Result<bool>;
 fn update_turn_based(&mut self,w:&mut World,buff:BuffId,dt:f64)->Result;
 fn remove_buff(&mut self,w:&mut World,owner:UnitId,buff:BuffId)->Result;
 fn transfer_target(&mut self,w:&mut World,owner:UnitId)->Result<UnitId>;
 fn add_heal(&mut self,w:&mut World,caster:UnitId,value:f64)->Result;
 fn hp_change_all(&mut self,w:&mut World,target:UnitId,value:f64,caster:UnitId,kind:&str)->Result;
 fn control_conflict(&mut self,w:&mut World,buff:BuffId)->Result<bool>;
 fn control_timer_coefficient(&mut self,w:&mut World,owner:UnitId,caster:UnitId,buff:BuffId)->Result<f64>;
 fn positive_timer_coefficient(&mut self,w:&mut World,owner:UnitId,caster:UnitId,buff:BuffId)->Result<f64>;
 fn add_damage(&mut self,w:&mut World,record_owner:UnitId,value:f64,caster:UnitId,owner:UnitId,kind:&str)->Result;
 fn add_real_bear_damage(&mut self,w:&mut World,record_owner:UnitId,value:f64,caster:UnitId,owner:UnitId)->Result;
 fn add_bear_damage(&mut self,w:&mut World,owner:UnitId,value:f64)->Result;
}
#[inline]fn number(v:Number)->f64{match v{Number::Undefined=>f64::NAN,Number::Null=>0.0,Number::Value(x)=>x}}
#[inline]fn truthy(x:f64)->bool{x!=0.0&&!x.is_nan()}
#[inline]fn or_zero(v:Number)->f64{let x=number(v);if truthy(x){x}else{0.0}}
#[inline]fn max(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative()&&b.is_sign_negative(){-0.0}else{0.0}}else if a>b{a}else{b}}
#[inline]fn min(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative()||b.is_sign_negative(){-0.0}else{0.0}}else if a<b{a}else{b}}
impl World{
 fn caster(&self,buff:BuffId)->Result<UnitId>{self.buffs[buff].caster.ok_or_else(||"source caster is null/undefined".into())}
 pub fn update<H:Hooks>(&mut self,buff:BuffId,dt:f64,h:&mut H)->Result{
  if h.is_turn_based(self,buff)?{return h.update_turn_based(self,buff,dt);}
  if !matches!(self.buffs[buff].timer,Number::Null)&&number(self.buffs[buff].timer)<=0.0{return h.remove_buff(self,self.buffs[buff].owner,buff);}
  let mut healing=or_zero(self.buffs[buff].inc_hpr)*dt;
  if healing>0.0{
   let target=h.transfer_target(self,self.buffs[buff].owner)?;
   let heal=self.units[target].heal;let heal=if truthy(heal){heal}else{0.0};
   healing*=max(0.0,heal/100.0+1.0);
   let amount=min(self.units[target].max_hp-self.units[target].hp,healing);
   h.add_heal(self,self.caster(buff)?,amount)?;
   h.hp_change_all(self,target,amount,self.caster(buff)?,"hpr")?;
  }
  if !matches!(self.buffs[buff].timer,Number::Null){
   let mut negative=self.buffs[buff].caster.is_some_and(|caster|self.units[caster].camp!=self.units[self.buffs[buff].owner].camp)&&self.buffs[buff].affected_by_attr;
   let field=self.buffs[buff].caster.is_some_and(|caster|self.units[caster].has_config&&self.units[caster].field_npc);
   if field&&self.buffs[buff].affected_by_attr&&h.control_conflict(self,buff)?{negative=true;}
   let positive=self.buffs[buff].caster.is_some_and(|caster|self.units[caster].camp==self.units[self.buffs[buff].owner].camp)&&self.buffs[buff].affected_by_attr;
   // Compound assignment reads the old timer BEFORE the coefficient callback.
   let old=number(self.buffs[buff].timer);
   let delta=if negative{dt*h.control_timer_coefficient(self,self.buffs[buff].owner,self.caster(buff)?,buff)?}
    else if positive{dt*h.positive_timer_coefficient(self,self.buffs[buff].owner,self.caster(buff)?,buff)?}else{dt};
   let timer=old-delta;self.buffs[buff].timer=Number::Value(timer);
   if timer<0.0{h.remove_buff(self,self.buffs[buff].owner,buff)?;}
  }
  Ok(())
 }
 pub fn update_hpr_damage<H:Hooks>(&mut self,buff:BuffId,dt:f64,h:&mut H)->Result{
  let mut amount=or_zero(self.buffs[buff].inc_hpr)*dt;
  if amount<0.0{
   amount*=max(0.0,1.0+self.units[self.buffs[buff].owner].dot_ratio);
   let amount=min(-amount,self.units[self.buffs[buff].owner].hp);
   if Some(self.buffs[buff].owner)!=self.buffs[buff].caster{
    let caster=self.caster(buff)?;
    if self.units[caster].is_unit&&self.units[caster].camp!=self.units[self.buffs[buff].owner].camp{
     h.add_damage(self,self.caster(buff)?,amount,self.caster(buff)?,self.buffs[buff].owner,"HPR")?;
     h.add_real_bear_damage(self,self.buffs[buff].owner,amount,self.caster(buff)?,self.buffs[buff].owner)?;
    }
    h.add_bear_damage(self,self.buffs[buff].owner,amount)?;
   }
  }
  Ok(())
 }
}

#[cfg(test)]mod tests{
 use super::*;
 #[derive(Default)]struct Fixture{events:Vec<String>,mutate_timer:bool}
 impl Hooks for Fixture{
  fn is_turn_based(&mut self,_:&mut World,_:BuffId)->Result<bool>{Ok(false)}
  fn update_turn_based(&mut self,_:&mut World,_:BuffId,_:f64)->Result{Err("unexpected turnbased".into())}
  fn remove_buff(&mut self,_:&mut World,owner:UnitId,_:BuffId)->Result{self.events.push(format!("remove:{owner}"));Ok(())}
  fn transfer_target(&mut self,_:&mut World,owner:UnitId)->Result<UnitId>{Ok(owner)}
  fn add_heal(&mut self,_:&mut World,caster:UnitId,value:f64)->Result{self.events.push(format!("heal:{caster}:{value}"));Ok(())}
  fn hp_change_all(&mut self,_:&mut World,target:UnitId,value:f64,caster:UnitId,_:&str)->Result{self.events.push(format!("hp:{target}:{caster}:{value}"));Ok(())}
  fn control_conflict(&mut self,_:&mut World,_:BuffId)->Result<bool>{Ok(true)}
  fn control_timer_coefficient(&mut self,w:&mut World,_:UnitId,_:UnitId,buff:BuffId)->Result<f64>{if self.mutate_timer{w.buffs[buff].timer=Number::Value(100.0);}Ok(2.0)}
  fn positive_timer_coefficient(&mut self,_:&mut World,_:UnitId,_:UnitId,_:BuffId)->Result<f64>{Ok(0.5)}
  fn add_damage(&mut self,_:&mut World,_:UnitId,_:f64,_:UnitId,_:UnitId,_:&str)->Result{self.events.push("damage".into());Ok(())}
  fn add_real_bear_damage(&mut self,_:&mut World,_:UnitId,_:f64,_:UnitId,_:UnitId)->Result{self.events.push("real_bear".into());Ok(())}
  fn add_bear_damage(&mut self,_:&mut World,_:UnitId,_:f64)->Result{self.events.push("bear".into());Ok(())}
 }
 fn world()->World{let unit=Unit{camp:1.0,has_config:true,field_npc:false,is_unit:true,hp:50.0,max_hp:100.0,heal:0.0,dot_ratio:0.0};World{units:vec![unit,Unit{camp:-1.0,..unit}],buffs:vec![Buff{owner:0,caster:Some(1),timer:Number::Value(1.0),inc_hpr:Number::Value(0.0),affected_by_attr:true}]}}
 #[test]fn compound_timer_assignment_uses_value_before_callback_mutation(){let mut w=world();let mut h=Fixture{mutate_timer:true,..Fixture::default()};w.update(0,0.25,&mut h).unwrap();assert_eq!(w.buffs[0].timer,Number::Value(0.5));}
 #[test]fn exact_zero_expires_at_next_update_not_at_decrement(){let mut w=world();let mut h=Fixture::default();w.update(0,0.5,&mut h).unwrap();assert_eq!(w.buffs[0].timer,Number::Value(0.0));assert!(h.events.is_empty());w.update(0,0.0,&mut h).unwrap();assert_eq!(h.events,["remove:0"]);}
 #[test]fn undefined_timer_is_not_null_and_becomes_nan(){let mut w=world();w.buffs[0].timer=Number::Undefined;w.update(0,0.25,&mut Fixture::default()).unwrap();assert!(number(w.buffs[0].timer).is_nan());}
 #[test]fn healing_above_max_keeps_original_negative_reported_amount(){let mut w=world();w.units[0].hp=110.0;w.buffs[0].timer=Number::Null;w.buffs[0].inc_hpr=Number::Value(4.0);let mut h=Fixture::default();w.update(0,0.25,&mut h).unwrap();assert_eq!(h.events,["heal:1:-10","hp:0:1:-10"]);}
 #[test]fn enemy_hpr_damage_reports_all_three_callbacks_in_source_order(){let mut w=world();w.buffs[0].inc_hpr=Number::Value(-20.0);let mut h=Fixture::default();w.update_hpr_damage(0,0.25,&mut h).unwrap();assert_eq!(h.events,["damage","real_bear","bear"]);}
}
