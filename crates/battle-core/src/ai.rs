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
