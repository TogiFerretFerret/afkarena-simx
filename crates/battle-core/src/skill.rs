//! Source-derived ed.Skill timeline control. All unresolved mechanics are required
//! host hooks; no attack, RNG, audio, actor or callback body is silently skipped.
//! Numeric timers/indices stay binary64, and reference states retain null/undefined.
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct SkillId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct UnitId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct PhaseId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct EventId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct SoundId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)] pub struct InfoId(pub usize);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Number { Undefined, Null, Value(f64) }
impl Number {
    pub fn value(self) -> Option<f64> { if let Self::Value(x)=self {Some(x)} else {None} }
    fn or_zero(self) -> f64 { self.value().filter(|x|truthy(*x)).unwrap_or(0.0) }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Reference<T> { Undefined, Null, Value(T) }
impl<T:Copy> Reference<T> { pub fn value(self)->Option<T>{if let Self::Value(x)=self{Some(x)}else{None}} }
#[inline] fn truthy(x:f64)->bool{x!=0.0&&!x.is_nan()}
fn index(x:f64)->Option<usize>{if x>=0.0&&x.is_finite()&&x.fract()==0.0&&x<(usize::MAX as f64){Some(x as usize)}else{None}}

#[derive(Clone,Debug)] pub struct TimelineEvent { pub time:f64, pub attack:bool }
#[derive(Clone,Debug)] pub struct Sound { pub delay:f64, pub name:String }
#[derive(Clone,Debug,Default)] pub struct Phase {
    pub events:Vec<Option<EventId>>, pub sounds:Vec<Option<SoundId>>, pub action_name:String,
}
#[derive(Clone,Debug)] pub struct Info {
    pub cd:f64, pub global_cd:f64, pub cost_mp:f64,
    pub launch_effect:Option<String>, pub launch_delay:Number,
    pub launch_z_order:Number, pub launch_fix_x:Number, pub launch_fix_y:Number,
}
impl Default for Info {fn default()->Self{Self{cd:0.0,global_cd:0.0,cost_mp:0.0,launch_effect:None,launch_delay:Number::Undefined,launch_z_order:Number::Undefined,launch_fix_x:Number::Undefined,launch_fix_y:Number::Undefined}}}
#[derive(Clone,Debug)] pub struct Unit {
    pub manually_casting:bool, pub current_skill:Reference<SkillId>,
    pub morph:bool, pub actor:Option<usize>, pub global_cd:f64, pub mp:f64, pub pet_mp:f64,
}
impl Default for Unit {fn default()->Self{Self{manually_casting:false,current_skill:Reference::Null,morph:false,actor:None,global_cd:0.0,mp:0.0,pet_mp:0.0}}}
#[derive(Clone,Debug)] pub struct Skill {
    pub info:InfoId,pub caster:UnitId,pub target:Reference<UnitId>,pub lock_target:Reference<UnitId>,
    pub cd_remaining:f64,pub unfreeze_time:Number,pub launch_effect_delay:Number,
    pub casting:bool,pub current_phase_elapsed:f64,pub current_phase:Reference<PhaseId>,
    pub phase_list:Vec<Option<PhaseId>>,pub current_phase_idx:f64,
    pub next_event:Reference<EventId>,pub next_event_idx:f64,
    pub next_sound:Reference<SoundId>,pub next_sound_idx:f64,
    pub attack_counter:f64,pub is_update:bool,pub play_sound:bool,
}
impl Skill {pub fn new(info:InfoId,caster:UnitId)->Self{Self{info,caster,target:Reference::Null,lock_target:Reference::Null,cd_remaining:0.0,unfreeze_time:Number::Value(999.0),launch_effect_delay:Number::Undefined,casting:false,current_phase_elapsed:0.0,current_phase:Reference::Null,phase_list:vec![],current_phase_idx:0.0,next_event:Reference::Null,next_event_idx:0.0,next_sound:Reference::Null,next_sound_idx:0.0,attack_counter:0.0,is_update:true,play_sound:true}}}
#[derive(Clone,Debug)] pub enum Callback {
    LaunchEffect { skill:SkillId, effect:String, z_order:f64, offset:[f64;2] },
    LaunchSound { skill:SkillId, sound:Option<String> },
    NextSound { skill:SkillId, elapsed:f64 },
}
#[derive(Clone,Debug,PartialEq)] pub enum Error { MissingPhase, MissingEvent, MissingSound, MissingSkill, MissingUnit, MissingInfo, Host(String) }
pub type Result<T=()> = std::result::Result<T,Error>;

#[derive(Clone,Debug)] pub struct World {
    pub skills:Vec<Skill>, pub units:Vec<Unit>, pub phases:Vec<Phase>, pub events:Vec<TimelineEvent>,
    pub sounds:Vec<Sound>,pub infos:Vec<Info>,
    pub callback_queues:Vec<VecDeque<Callback>>,pub active_queue:usize,pub mode:String,
}
impl Default for World {fn default()->Self{Self{skills:vec![],units:vec![],phases:vec![],events:vec![],sounds:vec![],infos:vec![],callback_queues:vec![VecDeque::new()],active_queue:0,mode:"stage".into()}}}

/// Source methods remain explicit and may mutate any live world record. A hook
/// error aborts at the same call boundary; it is never converted into a no-op.
pub trait Hooks {
    fn update_tb(&mut self,w:&mut World,id:SkillId,action_dt:f64,cd_dt:f64,raw_dt:f64)->Result;
    fn check_region(&mut self,w:&mut World,id:SkillId)->Result;
    fn unfreeze(&mut self,w:&mut World)->Result;
    fn on_attack_frame(&mut self,w:&mut World,id:SkillId)->Result;
    fn get_unit_scale(&mut self,w:&mut World,unit:UnitId)->Result<f64>;
    fn lookup_launch_sound(&mut self,w:&mut World,effect:&str)->Result<Option<String>>;
    fn add_effect(&mut self,w:&mut World,actor:usize,effect:&str,z:f64,offset:[f64;2])->Result;
    fn play_effect(&mut self,w:&mut World,sound:&str)->Result;
    fn interrupt(&mut self,w:&mut World,id:SkillId)->Result;
    fn set_action(&mut self,w:&mut World,id:SkillId,action:&str)->Result;
    fn finish(&mut self,w:&mut World,id:SkillId)->Result;
    fn select_target(&mut self,w:&mut World,id:SkillId,target:Reference<UnitId>)->Result;
    fn fix_enemy_cd(&mut self,w:&mut World,id:SkillId,cd:f64)->Result<f64>;
    fn log_skill_start(&mut self,w:&mut World,id:SkillId)->Result;
    fn skill_start_event(&mut self,w:&mut World,caster:UnitId,id:SkillId)->Result;
    fn is_pet(&mut self,w:&mut World,caster:UnitId)->Result<bool>;
    fn set_pet_mp(&mut self,w:&mut World,caster:UnitId,mp:f64)->Result;
    fn set_mp(&mut self,w:&mut World,caster:UnitId,mp:f64,source:UnitId)->Result;
}
impl World {
    fn skill(&self,id:SkillId)->Result<&Skill>{self.skills.get(id.0).ok_or(Error::MissingSkill)}
    fn caster(&self,id:SkillId)->Result<UnitId>{Ok(self.skill(id)?.caster)}
    fn phase(&self,id:SkillId)->Result<PhaseId>{self.skill(id)?.current_phase.value().ok_or(Error::MissingPhase)}
    fn enqueue(&mut self,callback:Callback){self.callback_queues[self.active_queue].push_back(callback)}
    fn event_at(&self,phase:PhaseId,i:f64)->Result<Reference<EventId>>{
        let list=&self.phases.get(phase.0).ok_or(Error::MissingPhase)?.events;
        Ok(index(i).and_then(|i|list.get(i).copied().flatten()).map(Reference::Value).unwrap_or(Reference::Undefined))
    }
    fn sound_at(&self,phase:PhaseId,i:f64)->Result<Reference<SoundId>>{
        let list=&self.phases.get(phase.0).ok_or(Error::MissingPhase)?.sounds;
        Ok(index(i).and_then(|i|list.get(i).copied().flatten()).map(Reference::Value).unwrap_or(Reference::Undefined))
    }
    pub fn update<H:Hooks>(&mut self,id:SkillId,action_dt:f64,cd_dt:f64,raw_dt:f64,h:&mut H)->Result{
        self.skill(id)?;
        if self.mode=="act_raid_monster"||self.mode=="act_raid_monster_endless"{return h.update_tb(self,id,action_dt,cd_dt,raw_dt)}
        h.check_region(self,id)?;
        self.skills[id.0].cd_remaining-=cd_dt;
        if let Some(value)=self.skills[id.0].unfreeze_time.value(){
            self.skills[id.0].unfreeze_time=Number::Value(value-action_dt);
            let caster=self.caster(id)?;
            if self.units.get(caster.0).ok_or(Error::MissingUnit)?.manually_casting&&value-action_dt<=0.0{
                self.units[caster.0].manually_casting=false;h.unfreeze(self)?;
            }
        }
        if let Some(value)=self.skills[id.0].launch_effect_delay.value(){
            if truthy(value){self.skills[id.0].launch_effect_delay=Number::Value(value-action_dt)}
        }
        let caster=self.caster(id)?;
        if self.skills[id.0].casting&&self.units.get(caster.0).ok_or(Error::MissingUnit)?.current_skill==Reference::Value(id){
            let elapsed=self.skills[id.0].current_phase_elapsed+action_dt;
            self.skills[id.0].current_phase_elapsed=elapsed;
            let mut event=self.skills[id.0].next_event;
            loop{
                let Some(event_id)=event.value() else{break};
                let entry=self.events.get(event_id.0).ok_or(Error::MissingEvent)?;
                if !(elapsed>=entry.time){break}
                if entry.attack{h.on_attack_frame(self,id)?;}
                if !self.skills[id.0].casting{break}
                let next=self.skills[id.0].next_event_idx+1.0;
                event=self.event_at(self.phase(id)?,next)?;
                self.skills[id.0].next_event_idx=next;
                self.skills[id.0].next_event=event;
            }
            if self.skills[id.0].launch_effect_delay.value().is_some_and(|x|x<=0.0){
                self.skills[id.0].launch_effect_delay=Number::Null;
                let info_id=self.skills[id.0].info;
                let effect=self.infos.get(info_id.0).ok_or(Error::MissingInfo)?.launch_effect.clone();
                if let Some(effect)=effect.filter(|s|!s.is_empty()){
                    let caster=self.caster(id)?;
                    h.get_unit_scale(self,caster)?;
                    // info.LaunchEffect* are re-read after getUnitScale, as in the source.
                    let info=&self.infos[self.skills[id.0].info.0];
                    let z_order=info.launch_z_order.value().filter(|x|truthy(*x)).unwrap_or(-1.0);
                    let offset=[info.launch_fix_x.or_zero(),info.launch_fix_y.or_zero()];
                    self.enqueue(Callback::LaunchEffect{skill:id,effect:effect.clone(),z_order,offset});
                    let sound=h.lookup_launch_sound(self,&effect)?;
                    self.enqueue(Callback::LaunchSound{skill:id,sound});
                }
            }
            self.enqueue(Callback::NextSound{skill:id,elapsed});
        }
        Ok(())
    }
    pub fn start_phase<H:Hooks>(&mut self,id:SkillId,phase_index:f64,h:&mut H)->Result{
        let caster=self.caster(id)?;
        if self.units.get(caster.0).ok_or(Error::MissingUnit)?.morph{return h.interrupt(self,id)}
        let phase=index(phase_index-1.0).and_then(|i|self.skills[id.0].phase_list.get(i).copied().flatten()).ok_or(Error::MissingPhase)?;
        self.skills[id.0].current_phase_idx=phase_index;
        self.skills[id.0].current_phase=Reference::Value(phase);
        self.skills[id.0].current_phase_elapsed=0.0;
        self.skills[id.0].next_event_idx=0.0;
        self.skills[id.0].next_sound_idx=0.0;
        self.skills[id.0].next_event=self.event_at(phase,0.0)?;
        self.skills[id.0].next_sound=self.sound_at(phase,0.0)?;
        let action=self.phases[phase.0].action_name.clone();h.set_action(self,id,&action)
    }
    pub fn on_phase_finished<H:Hooks>(&mut self,id:SkillId,h:&mut H)->Result{
        let phase_index=self.skill(id)?.current_phase_idx;
        if phase_index==self.skills[id.0].phase_list.len() as f64{h.finish(self,id)}else{self.start_phase(id,phase_index+1.0,h)}
    }
    pub fn start<H:Hooks>(&mut self,id:SkillId,target:Reference<UnitId>,h:&mut H)->Result{
        let info_id=self.skill(id)?.info;
        self.skills[id.0].target=target;h.select_target(self,id,target)?;
        let cd=self.infos.get(info_id.0).ok_or(Error::MissingInfo)?.cd;
        let cd=h.fix_enemy_cd(self,id,cd)?;
        self.skills[id.0].cd_remaining=cd;
        self.skills[id.0].casting=true;self.skills[id.0].lock_target=Reference::Null;self.skills[id.0].attack_counter=0.0;
        self.start_phase(id,1.0,h)?;
        self.skills[id.0].is_update=true;h.log_skill_start(self,id)?;
        h.skill_start_event(self,self.caster(id)?,id)?;
        let caster=self.caster(id)?;
        self.units[caster.0].global_cd=self.infos[info_id.0].global_cd;
        if h.is_pet(self,caster)?{
            let mp=self.units[caster.0].pet_mp-self.infos[info_id.0].cost_mp;h.set_pet_mp(self,caster,mp)?;
        }else{
            let mp=self.units[caster.0].mp-self.infos[info_id.0].cost_mp;h.set_mp(self,caster,mp,caster)?;
        }
        self.skills[id.0].launch_effect_delay=Number::Value(self.infos[info_id.0].launch_delay.or_zero());
        Ok(())
    }
    /// Captures the queue identity once, matching `var t=ed.clientCall_list`.
    /// Replacing active_queue during a callback does not change the drained queue.
    pub fn drain_current<H:Hooks>(&mut self,h:&mut H)->Result{
        let queue=self.active_queue;
        while let Some(callback)=self.callback_queues[queue].pop_front(){self.execute_callback(callback,h)?;}
        Ok(())
    }
    pub fn execute_callback<H:Hooks>(&mut self,callback:Callback,h:&mut H)->Result{
        match callback{
            Callback::LaunchEffect{skill,effect,z_order,offset}=>{
                let caster=self.caster(skill)?;
                if let Some(actor)=self.units.get(caster.0).ok_or(Error::MissingUnit)?.actor{h.add_effect(self,actor,&effect,z_order,offset)?;}
            },
            Callback::LaunchSound{skill,sound}=>{
                if let Some(sound)=sound.filter(|s|!s.is_empty()){
                    if self.skill(skill)?.play_sound{h.play_effect(self,&sound)?;}
                }
            },
            Callback::NextSound{skill,elapsed}=>{
                if let Some(sound)=self.skill(skill)?.next_sound.value(){
                    let sound=self.sounds.get(sound.0).ok_or(Error::MissingSound)?;
                    if elapsed>sound.delay&&self.skills[skill.0].play_sound{
                        let name=sound.name.clone();h.play_effect(self,&name)?;
                        let next=self.skills[skill.0].next_sound_idx+1.0;
                        self.skills[skill.0].next_sound_idx=next;
                        self.skills[skill.0].next_sound=self.sound_at(self.phase(skill)?,next)?;
                    }
                }
            },
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[derive(Default)]struct Host{events:Vec<String>,action:u8,used:bool}
    impl Hooks for Host{
        fn update_tb(&mut self,_:&mut World,_:SkillId,_:f64,_:f64,_:f64)->Result{self.events.push("tb".into());Ok(())}
        fn check_region(&mut self,_:&mut World,_:SkillId)->Result{self.events.push("region".into());Ok(())}
        fn unfreeze(&mut self,_:&mut World)->Result{self.events.push("unfreeze".into());Ok(())}
        fn on_attack_frame(&mut self,w:&mut World,id:SkillId)->Result{
            self.events.push("attack".into());
            if !self.used{self.used=true;match self.action{
                1=>w.skills[id.0].casting=false,
                2=>w.skills[id.0].current_phase=Reference::Value(PhaseId(1)),
                3=>w.skills[id.0].next_event_idx+=1.0,
                _=>{},
            }}Ok(())
        }
        fn get_unit_scale(&mut self,_:&mut World,_:UnitId)->Result<f64>{self.events.push("scale".into());Ok(1.0)}
        fn lookup_launch_sound(&mut self,_:&mut World,_:&str)->Result<Option<String>>{self.events.push("lookup".into());Ok(Some("launch".into()))}
        fn add_effect(&mut self,_:&mut World,_:usize,_:&str,_:f64,_:[f64;2])->Result{self.events.push("effect".into());Ok(())}
        fn play_effect(&mut self,w:&mut World,sound:&str)->Result{
            self.events.push(format!("sound:{sound}"));
            if self.action==4{w.skills[0].next_sound_idx=1.0;}
            if sound=="swap"{w.active_queue=1;w.enqueue(Callback::LaunchSound{skill:SkillId(0),sound:Some("new".into())});}
            Ok(())
        }
        fn interrupt(&mut self,_:&mut World,_:SkillId)->Result{self.events.push("interrupt".into());Ok(())}
        fn set_action(&mut self,_:&mut World,_:SkillId,name:&str)->Result{self.events.push(format!("action:{name}"));Ok(())}
        fn finish(&mut self,_:&mut World,_:SkillId)->Result{self.events.push("finish".into());Ok(())}
        fn select_target(&mut self,w:&mut World,id:SkillId,_:Reference<UnitId>)->Result{self.events.push("select".into());if self.action==5{w.skills[id.0].info=InfoId(1);}Ok(())}
        fn fix_enemy_cd(&mut self,_:&mut World,_:SkillId,cd:f64)->Result<f64>{self.events.push("cd".into());Ok(cd)}
        fn log_skill_start(&mut self,_:&mut World,_:SkillId)->Result{self.events.push("log".into());Ok(())}
        fn skill_start_event(&mut self,_:&mut World,_:UnitId,_:SkillId)->Result{self.events.push("start_event".into());Ok(())}
        fn is_pet(&mut self,_:&mut World,_:UnitId)->Result<bool>{self.events.push("is_pet".into());Ok(false)}
        fn set_pet_mp(&mut self,_:&mut World,_:UnitId,_:f64)->Result{Err(Error::Host("unexpected pet".into()))}
        fn set_mp(&mut self,w:&mut World,id:UnitId,mp:f64,_:UnitId)->Result{self.events.push("mp".into());w.units[id.0].mp=mp;Ok(())}
    }
    fn world()->World{
        let mut w=World::default();w.infos.push(Info::default());w.units.push(Unit{current_skill:Reference::Value(SkillId(0)),..Unit::default()});
        w.events=vec![TimelineEvent{time:0.0,attack:true},TimelineEvent{time:0.1,attack:true},TimelineEvent{time:0.0,attack:false}];
        w.sounds=vec![Sound{delay:0.0,name:"first".into()},Sound{delay:0.1,name:"second".into()},Sound{delay:0.2,name:"third".into()}];
        w.phases=vec![Phase{events:vec![Some(EventId(0)),Some(EventId(1))],sounds:vec![Some(SoundId(0)),Some(SoundId(1)),Some(SoundId(2))],action_name:"attack".into()},Phase{events:vec![Some(EventId(2)),None],sounds:vec![],action_name:"other".into()}];
        let mut s=Skill::new(InfoId(0),UnitId(0));s.phase_list=vec![Some(PhaseId(0)),Some(PhaseId(1))];s.current_phase=Reference::Value(PhaseId(0));s.casting=true;s.next_event=Reference::Value(EventId(0));s.next_sound=Reference::Value(SoundId(0));w.skills.push(s);w
    }
    #[test]fn attack_callback_stopping_cast_keeps_current_event_but_still_queues_sound(){
        let mut w=world();let mut h=Host{action:1,..Host::default()};w.update(SkillId(0),0.2,0.1,0.125,&mut h).unwrap();
        assert_eq!(h.events,["region","attack"]);assert_eq!(w.skills[0].next_event_idx,0.0);assert!(!w.skills[0].casting);assert_eq!(w.callback_queues[0].len(),1);
    }
    #[test]fn live_phase_is_reread_after_attack(){
        let mut w=world();let mut h=Host{action:2,..Host::default()};w.update(SkillId(0),0.2,0.1,0.125,&mut h).unwrap();
        assert_eq!(h.events,["region","attack"]);assert_eq!(w.skills[0].next_event,Reference::Undefined);assert_eq!(w.skills[0].next_event_idx,1.0);
    }
    #[test]fn deferred_sound_uses_live_index_after_audio_callback(){
        let mut w=world();let mut h=Host{action:4,..Host::default()};w.update(SkillId(0),0.2,0.1,0.125,&mut h).unwrap();
        assert!(!h.events.iter().any(|s|s.starts_with("sound")));w.drain_current(&mut h).unwrap();
        assert_eq!(w.skills[0].next_sound_idx,2.0);assert_eq!(w.skills[0].next_sound,Reference::Value(SoundId(2)));
    }
    #[test]fn drain_captures_original_queue_identity(){
        let mut w=world();w.callback_queues.push(VecDeque::new());w.enqueue(Callback::LaunchSound{skill:SkillId(0),sound:Some("swap".into())});w.enqueue(Callback::LaunchSound{skill:SkillId(0),sound:Some("old".into())});
        let mut h=Host::default();w.drain_current(&mut h).unwrap();assert_eq!(h.events,["sound:swap","sound:old"]);assert_eq!(w.callback_queues[1].len(),1);
    }
    #[test]fn start_captures_original_info_reference_across_select_target(){
        let mut w=world();w.infos[0]=Info{cd:3.0,global_cd:2.0,cost_mp:10.0,launch_delay:Number::Value(0.5),..Info::default()};w.infos.push(Info{cd:99.0,global_cd:99.0,cost_mp:99.0,..Info::default()});w.units[0].mp=100.0;
        let mut h=Host{action:5,..Host::default()};w.start(SkillId(0),Reference::Null,&mut h).unwrap();assert_eq!(w.skills[0].cd_remaining,3.0);assert_eq!(w.units[0].mp,90.0);assert_eq!(w.units[0].global_cd,2.0);assert_eq!(w.skills[0].launch_effect_delay,Number::Value(0.5));
    }
}
