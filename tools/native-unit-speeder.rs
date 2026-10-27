// Stable native adapter to the existing, source-tested arithmetic kernel.
#[path="../crates/battle-core/src/js_math.rs"] mod js_math;
#[path="../crates/battle-core/src/unit_speeder.rs"] mod unit_speeder;
#[unsafe(no_mangle)]
pub unsafe extern "C" fn battle_unit_speeder(input:*const f64,flags:u32,output:*mut f64)->u8 {
 let n=unsafe{std::slice::from_raw_parts(input,4)};
 let value=unit_speeder::Input{mspd:n[0],atkhast:n[1],dt:n[2],is_boss:flags&1!=0,
  skill:if flags&2!=0 {Some(unit_speeder::SkillSpeed{set_speeder:if flags&64!=0{Some(n[3])}else{None},is_basic:flags&4!=0,lock_action_speeder:flags&8!=0})}else{None},
  frozen:flags&16!=0,motionless:flags&32!=0};
 let Some(result)=unit_speeder::calculate_guarded(value) else{return 0};
 let target=unsafe{std::slice::from_raw_parts_mut(output,3)};
 target.copy_from_slice(&[result.raw_dt,result.speeder,result.dt_action]);1
}
