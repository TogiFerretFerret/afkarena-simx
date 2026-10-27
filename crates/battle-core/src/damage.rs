//! Source-derived damage arithmetic. JS Math.min/max are implemented explicitly:
//! Rust f64::min/max suppress NaNs and have different signed-zero behavior.
//! The NaN encoding matches the pinned x64 V8 oracle; see damage-translation.json.
#[inline] pub fn truthy(x:f64)->bool{x!=0.0&&!x.is_nan()}
#[inline] pub fn or_zero(x:f64)->f64{if truthy(x){x}else{0.0}}
#[inline] pub fn js_max(a:f64,b:f64)->f64{
    if a.is_nan()||b.is_nan(){return f64::from_bits(0xfff8000000000000)}
    if a==b {if a==0.0{return if a.is_sign_negative()&&b.is_sign_negative(){-0.0}else{0.0}}return a}
    if a>b{a}else{b}
}
#[inline] pub fn js_min(a:f64,b:f64)->f64{
    if a.is_nan()||b.is_nan(){return f64::from_bits(0xfff8000000000000)}
    if a==b {if a==0.0{return if a.is_sign_negative()||b.is_sign_negative(){-0.0}else{0.0}}return a}
    if a<b{a}else{b}
}
#[inline]pub fn critical_coefficient(attacker_critp:f64,defender_critd:f64,attacker_critplu:f64)->f64{
    let mut result=2.0;result+=1.0*(attacker_critp-defender_critd)/100.0;
    let mut maximum=2.9;maximum+=or_zero(attacker_critplu/100.0);
    maximum=js_max(maximum,1.1);js_min(maximum,js_max(1.1,result))
}
#[inline]pub fn lost_after_immunity(damage:f64,immunity:f64)->f64{js_max(1.0,damage*(100.0-immunity)/100.0)}
#[derive(Clone,Copy,Debug,Default)]pub struct ProbabilityFix{
    pub cap_up:f64,pub ratio_up:f64,pub ratio_down:f64,pub cap_down:f64,
}
#[inline]pub fn fix_probability(mut p:f64,stage_fix:f64,camp:f64,player_camp:f64,row:ProbabilityFix)->f64{
    let stage_fix=or_zero(stage_fix);if !truthy(stage_fix){return p}
    let sign=if camp==player_camp{1.0}else{-1.0};
    if sign*stage_fix>0.0{p+=js_min((1.0-p)*row.ratio_up,row.cap_up*row.ratio_up*p)}
    else if sign*stage_fix<0.0{p-=js_min((1.0-p)*row.ratio_down,row.cap_down*p)}p
}
#[derive(Clone,Copy,Debug,Eq,PartialEq)]pub enum MpSource{Caster,Victim,Other}
#[derive(Clone,Copy,Debug,Default)]pub struct MpFix{
    pub start_seconds:f64,pub player_caster:f64,pub player_victim:f64,pub enemy_caster:f64,pub enemy_victim:f64,
}
#[inline]pub fn fix_gain_mp(mut amount:f64,stage_fix:f64,ticks:f64,camp:f64,player_camp:f64,source:MpSource,row:MpFix)->f64{
    if !truthy(or_zero(stage_fix)){return amount}
    if ticks<8.0*row.start_seconds{return amount}
    let mut ratio=0.0;
    if camp==player_camp{if source==MpSource::Caster{ratio=row.player_caster}else if source==MpSource::Victim{ratio=row.player_victim}}
    else if source==MpSource::Caster{ratio=row.enemy_caster}else if source==MpSource::Victim{ratio=row.enemy_victim}
    amount*=1.0+ratio;amount
}
#[inline]pub fn dodge_probability(defender_dodge:f64,attacker_hit:f64)->f64{
    let advantage=js_max(0.0,defender_dodge-attacker_hit);advantage/(100.0+advantage)
}
/// Call ordering is part of the source contract: bypasses consume no RNG; physical
/// dodge draws BEFORE fixing probability (the draw is the comparison's left
/// operand); magic dodge does not invoke that fix.
pub trait DodgeHooks{
    fn fix_probability(&mut self,probability:f64,camp:f64)->f64;
    fn random(&mut self)->f64;
}
#[inline]pub fn check_dodge<H:DodgeHooks>(no_dodge:bool,attacker_is_ad:bool,defender_dodge:f64,attacker_hit:f64,defender_camp:f64,h:&mut H)->bool{
    if no_dodge{return false}if !attacker_is_ad{return false}
    let probability=dodge_probability(defender_dodge,attacker_hit);
    let draw=h.random();let probability=h.fix_probability(probability,defender_camp);draw<probability
}
#[inline]pub fn check_magic_dodge<H:DodgeHooks>(attacker_is_ap:bool,defender_magic_dodge:f64,attacker_magic_hit:f64,h:&mut H)->bool{
    if !attacker_is_ap{return false}
    let probability=dodge_probability(defender_magic_dodge,attacker_magic_hit);h.random()<probability
}
#[derive(Clone,Copy,Debug,Default)]pub struct PowerInput{
    pub base:f64,pub per_level:f64,pub plus_ratio:f64,pub finally_damage_ratio:bool,
    pub has_plus_attr:bool,pub plus_attr:f64,pub level:f64,pub extra_damage_ratio:f64,
}
/// Buff enumeration is live: every length/index lookup must use the current
/// caster and current buff-list reference, since prior callbacks may replace them.
pub trait PowerHooks{
    type Buff:Copy;
    fn buff_count(&mut self)->usize;
    fn buff_at(&mut self,index:usize)->Self::Buff;
    fn on_calculate_power(&mut self,buff:Self::Buff,power:f64,source:usize,target:usize)->f64;
}
pub fn power<H:PowerHooks>(input:PowerInput,source:usize,target:usize,h:&mut H)->f64{
    let base=or_zero(input.base);let per_level=or_zero(input.per_level);let mut ratio=or_zero(input.plus_ratio);
    if input.finally_damage_ratio{ratio=1.0}
    let attr=if input.has_plus_attr{input.plus_attr}else{0.0};
    let mut power=or_zero(base+per_level*or_zero(input.level)+ratio*attr);
    let multiplier=1.0+or_zero(input.extra_damage_ratio);
    let mut index=0;while index<h.buff_count(){let buff=h.buff_at(index);power=h.on_calculate_power(buff,power,source,target);index+=1;}
    power*multiplier
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn math_helpers_preserve_nan_and_signed_zero_contract(){assert_eq!(js_max(-0.0,0.0).to_bits(),0.0_f64.to_bits());assert_eq!(js_min(-0.0,0.0).to_bits(),(-0.0_f64).to_bits());assert_eq!(js_max(f64::NAN,1.0).to_bits(),0xfff8000000000000);}
 struct Trace{events:Vec<&'static str>}
 impl DodgeHooks for Trace{fn fix_probability(&mut self,p:f64,_:f64)->f64{self.events.push("fix");p}fn random(&mut self)->f64{self.events.push("rand");0.5}}
 #[test]fn dodge_preserves_draw_count_and_probability_hook_order(){let mut h=Trace{events:vec![]};assert!(!check_dodge(true,true,100.0,0.0,1.0,&mut h));assert!(h.events.is_empty());assert!(!check_dodge(false,true,100.0,0.0,1.0,&mut h));assert_eq!(h.events,["rand","fix"]);h.events.clear();check_magic_dodge(true,100.0,0.0,&mut h);assert_eq!(h.events,["rand"]);}
 struct Buffs{lists:Vec<Vec<usize>>,active:usize,seen:Vec<usize>}
 impl PowerHooks for Buffs{type Buff=usize;fn buff_count(&mut self)->usize{self.lists[self.active].len()}fn buff_at(&mut self,i:usize)->usize{self.lists[self.active][i]}fn on_calculate_power(&mut self,b:usize,p:f64,_:usize,_:usize)->f64{self.seen.push(b);if b==0{self.active=1;}p+1.0}}
 #[test]fn power_rereads_replaced_buff_list(){let mut h=Buffs{lists:vec![vec![0,1],vec![2,3,4]],active:0,seen:vec![]};assert_eq!(power(PowerInput{base:10.0,..PowerInput::default()},0,1,&mut h),13.0);assert_eq!(h.seen,[0,3,4]);}
}
