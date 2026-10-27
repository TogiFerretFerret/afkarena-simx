//! Source control flow for ed.Unit.update. Mechanics are explicit required hooks.
//! The hot state is typed and contiguous; vector/effect/buff identities stay stable.
use crate::js_math::max;
use crate::entity::{Vec2Arena,Vec2Id};
use std::sync::Arc;

pub type UnitId=usize;
pub type SkillId=usize;
pub type BuffId=usize;
pub type Result<T=()>=std::result::Result<T,String>;
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum State{Idle,Walk,Attack,Fall,Dead,Dying,Other(u32)}
#[derive(Clone,Copy,Debug,Default)]
pub struct Attributes{pub mspd:f64,pub atkhast:f64,pub ms_fix:f64,pub hast:f64,pub mpr:f64,pub hpr:f64,pub heal:f64,pub dot_ratio:f64,pub all_mp_ratio:f64,pub pr_mp_ratio:f64}
/// Predicate views of source effect fields. Updating effects must update this view.
#[derive(Clone,Copy,Debug,Default)]
pub struct Effects{pub frozen:bool,pub motionless:bool,pub immobilize:bool,pub fix:bool,pub disable_ai:bool,pub stop_buff:bool,pub no_hpr:bool,pub unheal:bool}
#[derive(Clone,Copy,Debug,Default)]
pub struct SkillView{pub set_speeder:Option<f64>,pub lock_action_speeder:bool,pub lock_ms_fix:bool,pub lock_direction:bool,pub target:Option<UnitId>}
#[derive(Clone,Copy,Debug,Default)]
pub struct BuffView{pub clear_on_caster_death:bool,pub caster:Option<UnitId>,pub timer:Option<f64>,pub unheal_counter:Option<f64>}
pub struct Unit{
 pub state:State,pub is_summoned:bool,pub is_boss:bool,pub camp:f64,pub hp:f64,pub mp:f64,pub attribs:Attributes,pub effects:usize,
 pub position:Vec2Id,pub previous_position:Vec2Id,pub walk_v:Vec2Id,pub knockup_v:Vec2Id,pub velocity:Vec2Id,pub knockup_accel:Option<Vec2Id>,pub force_destination:Option<Vec2Id>,pub destination:Option<Vec2Id>,
 pub direction:f64,pub height:f64,pub z_speed:Option<f64>,pub gravity_coef:f64,pub delay_terminate_timer:Option<f64>,
 pub current_skill:Option<SkillId>,pub basic_skill:Option<SkillId>,pub skills:Vec<SkillId>,pub buffs:Vec<BuffId>,
 pub speeder:f64,pub dt_action:f64,pub action_name:Option<Arc<str>>,pub action_elapsed:f64,pub action_duration:f64,pub action_loop:bool,
 pub fall_frozen_delay:Option<f64>,pub fall_frozen_time:f64,pub knockup_time:f64,pub knock_state:bool,pub knock_not_fall:bool,pub walk_ignore_rect:bool,
 pub global_cd:f64,pub frozen_model:bool,pub thump_resistance_level:f64,pub thump_resistance_reduce:Option<f64>,pub enter_delay_timer:Option<f64>,
}
impl Unit{#[inline]pub fn is_alive(&self)->bool{self.state!=State::Dead&&self.state!=State::Dying}}
pub struct World{pub units:Vec<Unit>,pub vectors:Vec2Arena,pub effects:Vec<Effects>,pub skills:Vec<SkillView>,pub buffs:Vec<BuffView>,pub zero:Vec2Id,pub gravity:f64,pub freeze_level:f64,pub local_bot:bool}
#[derive(Clone,Copy)]pub struct Rect{pub min_x:f64,pub max_x:f64}
/// No default/no-op mechanics: all calls must be supplied by the execution core.
pub trait Hooks{
 fn terminate(&mut self,w:&mut World,id:UnitId)->Result;
 fn debug_checks(&mut self,w:&mut World,id:UnitId)->Result;
 fn action_finished(&mut self,w:&mut World,id:UnitId)->Result;
 fn add_buff(&mut self,w:&mut World,id:UnitId,tid:u32,caster:UnitId)->Result<Option<BuffId>>;
 fn is_turn_based(&mut self,w:&mut World,id:UnitId)->Result<bool>;
 fn fall(&mut self,w:&mut World,id:UnitId)->Result;
 fn stage_rect(&mut self,w:&mut World)->Result<Rect>;
 fn skill_is_basic(&mut self,w:&mut World,skill:SkillId)->Result<bool>;
 fn update_skill(&mut self,w:&mut World,skill:SkillId,dt_action:f64,dt_cd:f64,raw_dt:f64)->Result;
 fn phase_finished(&mut self,w:&mut World,skill:SkillId)->Result;
 fn cast_when_controlled(&mut self,w:&mut World,id:UnitId)->Result;
 fn update_ai(&mut self,w:&mut World,id:UnitId,dt:f64)->Result;
 fn is_pet(&mut self,w:&mut World,id:UnitId)->Result<bool>;
 fn recheck_manual(&mut self,w:&mut World,id:UnitId)->Result;
 fn buff_has_effect(&mut self,w:&mut World,buff:BuffId,effect:&str)->Result<bool>;
 fn update_buff(&mut self,w:&mut World,buff:BuffId,dt:f64)->Result;
 fn transfer_mp_target(&mut self,w:&mut World,id:UnitId)->Result<UnitId>;
 fn set_mp(&mut self,w:&mut World,id:UnitId,value:f64,source:UnitId)->Result;
 fn buff_hpr_damage(&mut self,w:&mut World,buff:BuffId,dt:f64)->Result;
 fn transfer_hp_target(&mut self,w:&mut World,id:UnitId)->Result<UnitId>;
 fn set_hp(&mut self,w:&mut World,id:UnitId,value:f64)->Result;
 fn add_restore(&mut self,w:&mut World,id:UnitId,value:f64)->Result;
 fn fix_position(&mut self,w:&mut World,position:Vec2Id)->Result<Vec2Id>;
}
#[inline]fn truthy(x:f64)->bool{x!=0.0&&!x.is_nan()}
#[inline]fn or_zero(x:f64)->f64{if truthy(x){x}else{0.0}}
#[inline]fn distance(a:[f64;2],b:[f64;2])->f64{let x=a[0]-b[0];let y=a[1]-b[1];x*x+y*y}
#[inline]fn crossed(position:[f64;2],previous:[f64;2],destination:[f64;2])->bool{(position[0]-destination[0])*(previous[0]-destination[0])<0.0||(position[1]-destination[1])*(previous[1]-destination[1])<0.0||distance(position,destination)<=9.0}
impl World{
 #[inline]fn fx(&self,id:UnitId)->Effects{self.effects[self.units[id].effects]}
 #[inline]fn vector(&self,id:Vec2Id)->[f64;2]{*self.vectors.get(id)}
 #[inline]fn component(&mut self,id:Vec2Id,index:usize,value:f64){self.vectors.set_component(id,index,value)}
 pub fn update_unit<H:Hooks>(&mut self,id:UnitId,dt:f64,h:&mut H)->Result{
  let mut terminate=false;
  if !self.units[id].is_alive()&&self.units[id].is_summoned&&self.units[id].delay_terminate_timer.is_some(){
   let timer=self.units[id].delay_terminate_timer.unwrap()-dt;self.units[id].delay_terminate_timer=Some(timer);
   terminate=timer<=0.0;
  }
  if terminate{h.terminate(self,id)?;return Ok(());}
  if self.local_bot&&self.units[id].is_alive(){h.debug_checks(self,id)?;}
  let mut speed=self.units[id].attribs.mspd;
  if self.units[id].is_boss&&speed< -75.0{speed= -75.0;}
  if let Some(skill)=self.units[id].current_skill{
   let view=self.skills[skill];
   match view.set_speeder.filter(|x|truthy(*x)){Some(value)=>{if value>0.0{speed=value;}},None=>speed=0.0}
   if Some(skill)==self.units[id].basic_skill{speed+=self.units[id].attribs.atkhast;}
   if view.lock_action_speeder{speed=0.0;}
  }else{speed=0.0;}
  let mut speeder=if speed>=0.0{(speed+100.0)/100.0}else{100.0/(100.0-speed)};
  if self.fx(id).frozen||self.fx(id).motionless{speeder=0.0;}
  self.units[id].speeder=speeder;let action_dt=dt*speeder;self.units[id].dt_action=action_dt;
  let mut finished=false;
  if self.units[id].action_name.as_ref().is_some_and(|x|!x.is_empty()){
   let mut elapsed=self.units[id].action_elapsed+action_dt;let duration=self.units[id].action_duration;
   if duration>0.0&&elapsed>duration{elapsed-=duration;if !self.units[id].action_loop{finished=true;h.action_finished(self,id)?;}}
   self.units[id].action_elapsed=elapsed;
  }
  if self.units[id].state==State::Fall{
   if let Some(delay)=self.units[id].fall_frozen_delay{
    let delay=delay-action_dt;self.units[id].fall_frozen_delay=Some(delay);
    if self.units[id].fall_frozen_time>0.0&&delay<=0.0{
     if let Some(buff)=h.add_buff(self,id,20,id)?{self.buffs[buff].timer=Some(self.units[id].fall_frozen_time);}
     self.units[id].fall_frozen_time=0.0;self.units[id].fall_frozen_delay=None;
    }
   }
  }
  if !self.units[id].is_alive(){return Ok(());}
  let movable=!self.fx(id).immobilize;
  let previous=self.units[id].previous_position;self.component(previous,0,self.vector(self.units[id].position)[0]);self.component(previous,1,self.vector(self.units[id].position)[1]);
  let mut ms_fix=self.units[id].attribs.ms_fix;
  if self.units[id].current_skill.is_some_and(|s|self.skills[s].lock_ms_fix){ms_fix=0.0;}
  let mut movement=max(0.05,1.0+ms_fix);if self.fx(id).frozen||self.fx(id).motionless{movement=0.0;}
  // edpMult returns a fresh, nonescaping vector; zero is an observable shared vector.
  let walking=if movable{let v=self.vector(self.units[id].walk_v);Some([v[0]*movement,v[1]*movement])}else{None};
  let knockup=self.units[id].knockup_v;let velocity=self.units[id].velocity;
  let ux=walking.map_or_else(||self.vector(self.zero)[0],|v|v[0]);self.component(velocity,0,ux+self.vector(knockup)[0]);
  let uy=walking.map_or_else(||self.vector(self.zero)[1],|v|v[1]);self.component(velocity,1,uy+self.vector(knockup)[1]);
  if !self.fx(id).motionless{
   if let Some(z_speed)=self.units[id].z_speed{
    let mut height=self.units[id].height+z_speed*dt;
    self.units[id].z_speed=Some(z_speed+(self.gravity*self.units[id].gravity_coef)*dt);
    if height<0.0{self.units[id].z_speed=Some(0.0);height=0.0;}self.units[id].height=height;
   }
  }
  if h.is_turn_based(self,id)?||self.fx(id).fix{self.units[id].direction=self.units[id].camp;}
  else{
   let ux=walking.map_or_else(||self.vector(self.zero)[0],|v|v[0]);let mut direction=0.0;
   if movable&&ux!=0.0{direction=ux;}
   else if let Some(skill)=self.units[id].current_skill{if let Some(target)=self.skills[skill].target{if !self.skills[skill].lock_direction{direction=self.vector(self.units[target].position)[0]-self.vector(self.units[id].position)[0];}}}
   if direction*self.units[id].direction<0.0{self.units[id].direction*= -1.0;}
  }
  if self.units[id].knockup_time>0.0{
   self.units[id].knockup_time-=dt;
   if let Some(accel)=self.units[id].knockup_accel{let a=self.vector(accel);if truthy(a[0])||truthy(a[1]){let v=self.units[id].knockup_v;self.component(v,0,self.vector(v)[0]+self.vector(accel)[0]*dt);self.component(v,1,self.vector(v)[1]+self.vector(accel)[1]*dt);}}
   if self.units[id].knockup_time<=0.0&&self.units[id].knock_state{
    let walk=self.vector(self.units[id].walk_v);self.units[id].velocity=self.vectors.insert(walk);self.units[id].knockup_v=self.vectors.insert([0.0,0.0]);self.units[id].knockup_accel=None;self.units[id].knock_state=false;
    if !self.units[id].knock_not_fall{h.fall(self,id)?;}self.units[id].knock_not_fall=false;
   }
  }
  let rect=h.stage_rect(self)?;
  if !self.units[id].walk_ignore_rect{
   let step=if truthy(dt){dt}else{0.125};
   for (bound,upper) in [(rect.max_x,true),(rect.min_x,false)]{
    let p=self.vector(self.units[id].position)[0];let v=self.vector(velocity);
    if if upper{p+v[0]*step>bound&&v[0]>0.0}else{p+v[0]*step<bound&&v[0]<0.0}{
     let new_x=(bound-p)/step;let mut ratio=new_x/v[0];if ratio.abs()>1.0{ratio/=ratio.abs();}
     self.component(velocity,0,new_x);self.component(velocity,1,self.vector(velocity)[1]*ratio);
    }
   }
  }
  let position=self.units[id].position;self.component(position,0,self.vector(position)[0]+self.vector(velocity)[0]*dt);
  let position=self.units[id].position;self.component(position,1,self.vector(position)[1]+self.vector(velocity)[1]*dt);
  let p=self.vector(self.units[id].previous_position);let before=[or_zero(p[0]),or_zero(p[1])];
  if let Some(target)=self.units[id].force_destination{if crossed(self.vector(self.units[id].position),before,self.vector(target)){self.units[id].force_destination=None;}}
  if let Some(target)=self.units[id].destination{if crossed(self.vector(self.units[id].position),before,self.vector(target)){self.units[id].destination=None;}}
  let haste=self.units[id].attribs.hast;let cd_dt=dt*if haste>0.0{(100.0+haste)/100.0}else{100.0/(100.0-haste)};
  let attack_haste=(100.0+max(-80.0,self.units[id].attribs.atkhast))/100.0;self.units[id].global_cd-=cd_dt*attack_haste;
  let action_name=self.units[id].action_name.clone();let mut index=0;
  while index<self.units[id].skills.len(){let skill=self.units[id].skills[index];let skill_cd=if h.skill_is_basic(self,skill)?{cd_dt*attack_haste}else{cd_dt};let skill=self.units[id].skills[index];h.update_skill(self,skill,action_dt,skill_cd,dt)?;index+=1;}
  if finished&&action_name==self.units[id].action_name&&self.units[id].state==State::Attack{let skill=self.units[id].current_skill.ok_or("Cannot read properties of null (reading 'onPhaseFinished')")?;h.phase_finished(self,skill)?;}
  let effects=self.units[id].effects;
  if self.freeze_level==0.0{if self.effects[effects].disable_ai{h.cast_when_controlled(self,id)?;}else{h.update_ai(self,id,dt)?;}}
  else if h.is_pet(self,id)?&&!self.units[id].frozen_model&&!self.effects[effects].disable_ai{h.update_ai(self,id,dt)?;}
  h.recheck_manual(self,id)?;
  index=0;
  while index<self.units[id].buffs.len(){
   let buff=self.units[id].buffs[index];let mut removed_one=false;
   if !self.fx(id).stop_buff||h.buff_has_effect(self,buff,"stopBuff")?{let length=self.units[id].buffs.len();h.update_buff(self,buff,dt)?;removed_one=length==self.units[id].buffs.len()+1;}
   if self.buffs[buff].clear_on_caster_death{if let Some(caster)=self.buffs[buff].caster{if !self.units[caster].is_alive(){self.buffs[buff].timer=Some(-1.0);}}}
   if !removed_one{index+=1;}
  }
  if !self.units[id].is_alive(){return Ok(());}
  let mut regen=self.units[id].attribs.mpr;let target=h.transfer_mp_target(self,id)?;
  regen*=1.0+self.units[target].attribs.all_mp_ratio+or_zero(self.units[target].attribs.pr_mp_ratio/100.0);
  h.set_mp(self,target,self.units[target].mp+regen*dt,id)?;
  if !self.fx(id).no_hpr{
   index=0;while index<self.units[id].buffs.len(){let buff=self.units[id].buffs[index];h.buff_hpr_damage(self,buff,dt)?;index+=1;}
   let mut regen=self.units[id].attribs.hpr;let mut target=id;
   if regen>0.0{target=h.transfer_hp_target(self,id)?;regen*=max(0.0,or_zero(self.units[target].attribs.heal)/100.0+1.0);}
   if self.units[target].is_alive()&&(regen<0.0||!self.fx(target).unheal){regen*=max(0.0,1.0+self.units[target].attribs.dot_ratio);h.set_hp(self,target,self.units[target].hp+regen*dt)?;if regen>0.0{h.add_restore(self,target,regen*dt)?;}}
   else if self.units[target].is_alive()&&regen>0.0&&self.fx(target).unheal{
    index=0;while index<self.units[id].buffs.len(){let buff=self.units[id].buffs[index];let count=self.buffs[buff].unheal_counter;let active=count.is_some_and(truthy);if h.buff_has_effect(self,buff,"unheal")?&&!active{break;}if active{let value=self.buffs[buff].unheal_counter.ok_or("source unheal counter disappeared")?;self.buffs[buff].unheal_counter=Some(value-1.0);break;}index+=1;}
   }
  }
  if self.units[id].hp==0.0&&self.units[id].is_alive(){self.units[id].hp=1.0;}
  if self.units[id].thump_resistance_level>0.0{if let Some(time)=self.units[id].thump_resistance_reduce{let time=time-dt;self.units[id].thump_resistance_reduce=Some(time);if time<=0.0{self.units[id].thump_resistance_reduce=Some(2.0);self.units[id].thump_resistance_level-=1.0;}}}
  let position=self.vector(self.units[id].position);if position[0].abs()>23333.0||position[1].abs()>23333.0{let fixed=h.fix_position(self,self.units[id].position)?;self.units[id].position=fixed;}
  if let Some(time)=self.units[id].enter_delay_timer{if time>0.0{self.units[id].enter_delay_timer=Some(time-dt);}}
  Ok(())
 }
}
