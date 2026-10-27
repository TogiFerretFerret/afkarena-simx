//! Source-ordered AI targeting. Geometry and list references use stable indices so
//! source aliases survive field replacement. No target sorting or distance reduction
//! is substituted for the original ordered scan.

#[derive(Clone, Copy, Debug, Default)]
pub struct TargetUnit {
    pub position: usize,
    pub camp: f64,
    pub foe_camp: f64,
    pub is_unit: bool,
    pub alive: bool,
    pub untargetable: bool,
    pub low_priority: bool,
    pub taunted: bool,
    pub pursue: bool,
    pub force_target: Option<usize>,
}
#[derive(Clone, Copy, Debug)]
pub enum BasicShape { Rectangle { arg1: f64 }, Other }
#[derive(Clone, Debug)]
pub struct AiWorld {
    pub units: Vec<TargetUnit>,
    pub vectors: Vec<[f64; 2]>,
    pub lists: Vec<Vec<usize>>,
    pub owner: usize,
    pub alive_list: usize,
    pub shape: BasicShape,
    pub math_huge: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct TargetResult { pub target: Option<usize>, pub distance_squared: f64 }

pub trait TargetHooks {
    fn is_alive(&mut self, world: &mut AiWorld, target: usize) -> bool;
    fn basic_shape(&mut self, world: &mut AiWorld) -> BasicShape;
    fn alive_units(&mut self, world: &mut AiWorld, camp: f64) -> usize;
    fn target_in_basic_range(&mut self, world: &mut AiWorld, target: usize) -> bool;
}

pub fn search_target<H: TargetHooks>(world: &mut AiWorld, hooks: &mut H) -> TargetResult {
    let owner=world.owner;
    if world.units[owner].taunted || world.units[owner].pursue {
        if let Some(target)=world.units[owner].force_target {
            if world.units[target].camp==world.units[owner].foe_camp && world.units[target].is_unit && hooks.is_alive(world,target)
                && (!world.units[target].untargetable || world.units[owner].taunted) {
                let a=world.vectors[world.units[target].position];
                let b=world.vectors[world.units[owner].position];
                let x=a[0]-b[0];let y=a[1]-b[1];
                return TargetResult{target:Some(target),distance_squared:x*x+y*y};
            }
        }
    }
    let mut distance=world.math_huge;
    let mut target=None;
    let mut in_range=false;
    let mut low_priority=true;
    let shape=hooks.basic_shape(world);
    let origin=world.units[owner].position;
    let camp=world.units[owner].foe_camp;
    let list=hooks.alive_units(world,camp);
    let length=world.lists[list].len();
    for index in 0..length {
        let candidate=world.lists[list][index];
        if candidate!=owner && !world.units[candidate].untargetable {
            if !low_priority && world.units[candidate].low_priority { continue; }
            let mut position=world.vectors[world.units[candidate].position];
            if let BasicShape::Rectangle{arg1}=shape {
                let sign=if world.vectors[origin][0]>=position[0] {1.0}else{-1.0};
                position[0]+=sign*arg1*0.8;
            }
            let x=world.vectors[origin][0]-position[0];
            let y=world.vectors[origin][1]-position[1];
            let candidate_distance=x*x+y*y;
            let candidate_in_range=hooks.target_in_basic_range(world,candidate);
            if (candidate_in_range && !in_range) || (candidate_distance<distance && candidate_in_range==in_range)
                || (low_priority && !world.units[candidate].low_priority) {
                distance=candidate_distance;
                target=Some(candidate);
                low_priority=world.units[candidate].low_priority;
                in_range=candidate_in_range;
            }
        }
    }
    TargetResult{target,distance_squared:distance}
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Hooks { calls:Vec<usize>, ranges:Vec<bool> }
    impl TargetHooks for Hooks {
        fn is_alive(&mut self,w:&mut AiWorld,id:usize)->bool{w.units[id].alive}
        fn basic_shape(&mut self,w:&mut AiWorld)->BasicShape{w.shape}
        fn alive_units(&mut self,w:&mut AiWorld,_:f64)->usize{w.alive_list}
        fn target_in_basic_range(&mut self,_:&mut AiWorld,id:usize)->bool{self.calls.push(id);self.ranges[id]}
    }
    fn fixture()->AiWorld{AiWorld{units:(0..4).map(|i|TargetUnit{position:i,camp:if i==0{1.0}else{-1.0},foe_camp:-1.0,is_unit:true,alive:true,..TargetUnit::default()}).collect(),vectors:vec![[0.0,0.0],[1.0,0.0],[1.0,0.0],[9.0,0.0]],lists:vec![vec![1,2,3]],owner:0,alive_list:0,shape:BasicShape::Other,math_huge:f64::MAX}}
    #[test]fn equal_distance_retains_earlier_candidate(){let mut w=fixture();let mut h=Hooks{calls:vec![],ranges:vec![false;4]};assert_eq!(search_target(&mut w,&mut h).target,Some(1));assert_eq!(h.calls,[1,2,3]);}
    #[test]fn normal_priority_replaces_in_range_low_priority_target(){let mut w=fixture();w.units[1].low_priority=true;w.units[2].low_priority=true;let mut h=Hooks{calls:vec![],ranges:vec![false,true,true,false]};assert_eq!(search_target(&mut w,&mut h).target,Some(3));}
    #[test]fn taunt_bypasses_untargetable_but_pursue_does_not(){let mut w=fixture();w.units[0].force_target=Some(3);w.units[0].taunted=true;w.units[3].untargetable=true;let mut h=Hooks{calls:vec![],ranges:vec![false;4]};assert_eq!(search_target(&mut w,&mut h).target,Some(3));assert!(h.calls.is_empty());w.units[0].taunted=false;w.units[0].pursue=true;assert_eq!(search_target(&mut w,&mut h).target,Some(1));}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManualCast { Undefined, Null, False, Cast, Trigger }
#[derive(Clone, Debug)]
pub struct SkillSelection {
    pub lists: Vec<Vec<usize>>,
    pub list: usize,
    pub manual: bool,
    pub manual_skill: Option<usize>,
    pub current_skill: Option<usize>,
    pub turnbased: bool,
    pub target: Option<usize>,
    pub can_cast_manual: ManualCast,
    pub will_cast_manual: bool,
}
pub trait SkillHooks {
    fn can_cast_with_target(&mut self,state:&mut SkillSelection,skill:usize,target:Option<usize>)->bool;
    fn can_cast_turnbased_target(&mut self,state:&mut SkillSelection,skill:usize,target:Option<usize>)->bool;
    fn will_cast(&mut self,state:&mut SkillSelection,skill:usize)->bool;
    fn cast_skill_special_turnbased(&mut self,state:&mut SkillSelection);
    fn can_trigger(&mut self,state:&mut SkillSelection,skill:usize)->bool;
    fn will_trigger(&mut self,state:&mut SkillSelection,skill:usize)->bool;
}

/// ed.Ai.findSkillToCast caches the original list reference and length, but reloads
/// manual/turnbased flags and target before each call. A false turnbased willCast
/// falls through to the ordinary cast test, potentially calling willCast twice.
pub fn find_skill_to_cast<H:SkillHooks>(state:&mut SkillSelection,hooks:&mut H)->Option<usize>{
    let list=state.list;let length=state.lists[list].len();
    for index in 0..length{
        let skill=state.lists[list][index];
        if state.manual&&Some(skill)==state.manual_skill{
            let target=state.target;
            if hooks.can_cast_with_target(state,skill,target){
                state.can_cast_manual=ManualCast::Cast;
                state.will_cast_manual=hooks.will_cast(state,skill);
            }
        }else{
            let target=state.target;
            if state.turnbased&&hooks.can_cast_turnbased_target(state,skill,target)&&hooks.will_cast(state,skill){
                hooks.cast_skill_special_turnbased(state);return Some(skill);
            }
            let target=state.target;
            if hooks.can_cast_with_target(state,skill,target)&&hooks.will_cast(state,skill){return Some(skill);}
        }
    }
    None
}

/// ed.Ai.checkTrigger deliberately repeats canTrigger calls. Hooks may change
/// state or return a different result each time; the calls are not memoized.
pub fn check_trigger<H:SkillHooks>(state:&mut SkillSelection,hooks:&mut H)->Option<bool>{
    let skill=state.current_skill;
    if !state.manual||skill.is_some_and(|skill|hooks.can_trigger(state,skill)){
        if let Some(skill)=skill{
            if state.manual&&hooks.can_trigger(state,skill){
                state.can_cast_manual=ManualCast::Trigger;
                state.will_cast_manual=hooks.will_trigger(state,skill);
            }else if hooks.can_trigger(state,skill)&&hooks.will_trigger(state,skill){return Some(true);}
        }
    }else if state.can_cast_manual==ManualCast::Trigger{
        state.can_cast_manual=ManualCast::Null;
        state.will_cast_manual=false;
    }
    None
}

#[derive(Clone, Copy, Debug)]
pub struct StageRect{pub min_x:f64,pub max_x:f64,pub min_y:f64,pub max_y:f64}
#[derive(Clone, Copy, Debug)]
pub enum WalkArgument{Unit(usize),Vector(usize)}
#[derive(Clone, Debug)]
pub struct MovementWorld{
    pub ai:AiWorld,
    pub building:bool,
    pub immobilize:bool,
    pub force_destination:Option<usize>,
    pub destination:Option<usize>,
    pub turnbased:bool,
    pub attack_range:f64,
}
pub trait MovementHooks{
    fn idle(&mut self,world:&mut MovementWorld);
    fn basic_shape(&mut self,world:&mut MovementWorld)->BasicShape;
    fn stage_rect(&mut self,world:&mut MovementWorld,turnbased:bool)->StageRect;
    fn is_mode_turnbased(&mut self,world:&mut MovementWorld)->bool;
    fn target_in_basic_range(&mut self,world:&mut MovementWorld,target:usize)->bool;
    fn is_out_of_stage(&mut self,world:&mut MovementWorld)->bool;
    /// The original Unit.walkTowards reads its argument's elements and does not
    /// retain or mutate the argument array; this value interface relies on that.
    fn walk_towards(&mut self,world:&mut MovementWorld,destination:[f64;2]);
}
#[inline]
fn js_max(a:f64,b:f64)->f64{
    if a.is_nan()||b.is_nan(){return f64::NAN;}
    if a==0.0&&b==0.0{return if a.is_sign_positive()||b.is_sign_positive(){0.0}else{-0.0};}
    if a>b{a}else{b}
}
#[inline]
fn js_min(a:f64,b:f64)->f64{
    if a.is_nan()||b.is_nan(){return f64::NAN;}
    if a==0.0&&b==0.0{return if a.is_sign_negative()||b.is_sign_negative(){-0.0}else{0.0};}
    if a<b{a}else{b}
}

pub fn walk_away_from<H:MovementHooks>(world:&mut MovementWorld,target:usize,hooks:&mut H){
    if world.building||world.immobilize{hooks.idle(world);return;}
    let owner=world.ai.owner;
    let position=world.ai.vectors[world.ai.units[owner].position];
    let other=world.ai.vectors[world.ai.units[target].position];
    let x=if position[0]>=other[0]{1.0}else{-1.0};
    hooks.walk_towards(world,[position[0]+x,position[1]+0.0]);
}

pub fn walk_to<H:MovementHooks>(world:&mut MovementWorld,argument:WalkArgument,hooks:&mut H){
    if world.building||world.immobilize{hooks.idle(world);return;}
    let shape=hooks.basic_shape(world);
    let (unit,borrowed,mut destination)=match argument{
        WalkArgument::Unit(id)=>{
            let mut position=world.ai.vectors[world.ai.units[id].position];
            if let BasicShape::Rectangle{arg1}=shape{
                let owner=world.ai.owner;
                let difference=world.ai.vectors[world.ai.units[owner].position][0]-position[0];
                let sign=if difference>0.0{1.0}else{-1.0};
                position[0]+=sign*arg1*0.8;
            }
            (Some(id),None,position)
        },
        WalkArgument::Vector(id)=>(None,Some(id),world.ai.vectors[id]),
    };
    if world.force_destination.is_some()||world.destination.is_some(){hooks.walk_towards(world,destination);return;}
    let rect=hooks.stage_rect(world,world.turnbased);
    if let Some(id)=borrowed{destination=world.ai.vectors[id];}
    // Argument vectors are clamped in place in the source. Unit positions are
    // copied first, so they are never clamped through the source object reference.
    destination[0]=js_min(rect.max_x-1.0,js_max(rect.min_x+1.0,destination[0]));
    destination[1]=js_min(rect.max_y-1.0,js_max(rect.min_y+1.0,destination[1]));
    if let Some(id)=borrowed{world.ai.vectors[id]=destination;}
    let owner=world.ai.owner;
    let position=world.ai.vectors[world.ai.units[owner].position];
    let x=destination[0]-position[0];let y=destination[1]-position[1];let distance=x*x+y*y;
    let turnbased=hooks.is_mode_turnbased(world);
    let in_range=if matches!(shape,BasicShape::Rectangle{..})||turnbased{
        unit.is_some_and(|target|hooks.target_in_basic_range(world,target))
    }else{distance<=world.attack_range*world.attack_range};
    if in_range&&!hooks.is_out_of_stage(world){hooks.idle(world);return;}
    if let Some(id)=borrowed{destination=world.ai.vectors[id];}
    hooks.walk_towards(world,destination);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnitAiState{Idle,Walk,Other}
#[derive(Clone, Debug)]
pub struct AiControl{
    pub owner:usize,
    pub state:UnitAiState,
    pub fear:bool,
    pub fear_target:Option<usize>,
    pub force_destination:Option<usize>,
    pub destination:Option<usize>,
    pub skills:SkillSelection,
    pub ignore_controllable:Vec<bool>,
}
/// All source calls remain explicit. An adapter can bind these to the native
/// targeting/movement/selection functions and Skill world without virtual dispatch.
pub trait ControlHooks{
    fn walk_away_from(&mut self,state:&mut AiControl,target:usize);
    fn walk_to(&mut self,state:&mut AiControl,target:WalkArgument);
    fn search_target(&mut self,state:&mut AiControl,turnbased:bool)->Option<usize>;
    fn find_skill_to_cast(&mut self,state:&mut AiControl)->Option<usize>;
    fn cast_skill(&mut self,state:&mut AiControl,skill:usize,target:Option<usize>);
    fn is_out_of_stage(&mut self,state:&mut AiControl)->bool;
    fn idle(&mut self,state:&mut AiControl);
    fn check_trigger(&mut self,state:&mut AiControl)->Option<bool>;
    fn trigger(&mut self,state:&mut AiControl,skill:usize);
    fn can_cast_with_target(&mut self,state:&mut AiControl,skill:usize,target:Option<usize>)->bool;
    fn will_cast(&mut self,state:&mut AiControl,skill:usize)->bool;
}

pub fn update<H:ControlHooks>(state:&mut AiControl,hooks:&mut H){
    if matches!(state.state,UnitAiState::Idle|UnitAiState::Walk){
        if state.fear{
            if let Some(target)=state.fear_target{hooks.walk_away_from(state,target);return;}
        }
        if let Some(destination)=state.force_destination{hooks.walk_to(state,WalkArgument::Vector(destination));return;}
        if let Some(destination)=state.destination{hooks.walk_to(state,WalkArgument::Vector(destination));return;}
        let target=hooks.search_target(state,state.skills.turnbased);
        state.skills.target=target;
        if let Some(skill)=hooks.find_skill_to_cast(state){hooks.cast_skill(state,skill,target);}
        else if let Some(target)=target{hooks.walk_to(state,WalkArgument::Unit(target));}
        else if hooks.is_out_of_stage(state){hooks.walk_to(state,WalkArgument::Unit(state.owner));}
        else{hooks.idle(state);}
    }else if hooks.check_trigger(state).unwrap_or(false){
        let skill=state.skills.current_skill.expect("source current_skill.trigger would fail for null/undefined");
        hooks.trigger(state,skill);
    }
}

pub fn cast_skill_when_controlled<H:ControlHooks>(state:&mut AiControl,hooks:&mut H){
    if state.force_destination.is_some()||state.destination.is_some()||state.skills.current_skill.is_some(){return;}
    let target=hooks.search_target(state,false);
    state.skills.target=target;
    let list=state.skills.list;let length=state.skills.lists[list].len();
    let mut selected=None;
    for index in 0..length{
        let skill=state.skills.lists[list][index];
        if state.ignore_controllable[skill]{
            if state.skills.manual&&Some(skill)==state.skills.manual_skill{
                let current_target=state.skills.target;
                if hooks.can_cast_with_target(state,skill,current_target){
                    state.skills.can_cast_manual=ManualCast::Cast;
                    state.skills.will_cast_manual=hooks.will_cast(state,skill);
                }
            }else{
                let current_target=state.skills.target;
                if hooks.can_cast_with_target(state,skill,current_target)&&hooks.will_cast(state,skill){selected=Some(skill);break;}
            }
        }
    }
    if let Some(skill)=selected{hooks.cast_skill(state,skill,target);}
}
