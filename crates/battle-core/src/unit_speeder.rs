//! Callback-free action-speed block from the pinned original Unit.update.
//! Inputs describe already-validated canonical data reads; this module neither
//! reads VM objects nor dispatches callbacks. The continuation retains raw_dt.
use crate::js_math::{add,div,mul,sub,reference_fp_environment};

#[derive(Clone,Copy,Debug)]
pub struct SkillSpeed { pub set_speeder:Option<f64>,pub is_basic:bool,pub lock_action_speeder:bool }
#[derive(Clone,Copy,Debug)]
pub struct Input { pub mspd:f64,pub atkhast:f64,pub dt:f64,pub is_boss:bool,pub skill:Option<SkillSpeed>,pub frozen:bool,pub motionless:bool }
#[derive(Clone,Copy,Debug)]
pub struct Output { pub raw_dt:f64,pub speeder:f64,pub dt_action:f64 }
#[inline]fn truthy(value:f64)->bool { value!=0.0&&!value.is_nan() }

/// Exact arithmetic for the typed Unit controller, including Number NaNs.
#[inline]
pub fn calculate(input:Input)->Output {
 let mut speed=input.mspd;
 if input.is_boss&&speed< -75.0 {speed= -75.0;}
 if let Some(skill)=input.skill {
  match skill.set_speeder.filter(|value|truthy(*value)) {Some(value)=>{if value>0.0 {speed=value;}},None=>speed=0.0}
  if skill.is_basic {speed=add(speed,input.atkhast);}
  if skill.lock_action_speeder {speed=0.0;}
 } else {speed=0.0;}
 let mut speeder=if speed>=0.0 {div(add(speed,100.0),100.0)} else {div(100.0,sub(100.0,speed))};
 if input.frozen||input.motionless {speeder=0.0;}
 Output {raw_dt:input.dt,speeder,dt_action:mul(input.dt,speeder)}
}

/// Arithmetic admission only. The VM adapter must independently prove own data
/// slots, identities, writable outputs and an exact continuation before calling.
/// A rejection occurs before any VM write; never restart after earlier writes.
#[inline]
pub fn calculate_guarded(input:Input)->Option<Output> {
 if !reference_fp_environment()||![input.mspd,input.atkhast,input.dt].into_iter().all(f64::is_finite)||input.skill.and_then(|skill|skill.set_speeder).is_some_and(|value|!value.is_finite()) {return None;}
 let output=calculate(input);
 if output.speeder.is_nan()||output.dt_action.is_nan() {None} else {Some(output)}
}

#[cfg(test)]mod tests {
 use super::*;
 fn input()->Input {Input{mspd:0.0,atkhast:0.0,dt:0.125,is_boss:false,skill:Some(SkillSpeed{set_speeder:Some(-1.0),is_basic:true,lock_action_speeder:false}),frozen:false,motionless:false}}
 #[test]fn guarded_overflow_rejects_before_any_possible_write(){let mut x=input();x.mspd=f64::MAX;x.atkhast=f64::MAX;x.dt=0.0;assert!(calculate(x).dt_action.is_nan());assert!(calculate_guarded(x).is_none());}
 #[test]fn negative_zero_dt_and_frozen_positive_zero_are_preserved(){let mut x=input();x.dt=-0.0;x.frozen=true;let y=calculate_guarded(x).unwrap();assert_eq!(y.speeder.to_bits(),0);assert_eq!(y.dt_action.to_bits(),(-0.0_f64).to_bits());assert_eq!(y.raw_dt.to_bits(),(-0.0_f64).to_bits());}
 #[test]fn boss_clamp_precedes_basic_haste(){let mut x=input();x.mspd=-100.0;x.is_boss=true;x.atkhast=75.0;assert_eq!(calculate(x).speeder,1.0);}
}
