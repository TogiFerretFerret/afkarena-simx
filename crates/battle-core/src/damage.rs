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

// Complete source takeDamage controller. The host owns the existing typed world;
// this layer introduces no second unit registry or copied battle state.
pub type DamageUnitId=usize;pub type DamageBuffId=usize;pub type DamageSkillId=usize;pub type DamageRageId=usize;
pub type DamageResult<T>=std::result::Result<T,String>;
#[derive(Clone,Copy,Debug,Default)]pub struct DamageAttributes{
 pub atk:f64,pub arm:f64,pub crit:f64,pub dcrit:f64,pub dpimu:f64,pub pimu:f64,pub dmimu:f64,pub mimu:f64,pub himu:f64,
 pub critp:f64,pub critd:f64,pub critplu:f64,pub hp:f64,
}
#[derive(Clone,Copy,Debug,Default)]pub struct DamageContext{
 pub defence_ignore_coefficient:Option<f64>,pub defence_ignore_damage_coefficient:Option<f64>,
 pub immunity_ignore_coefficient:Option<f64>,pub immunity_ignore_damage_coefficient:Option<f64>,
 /// Host-owned backing object for any source-specific extra context properties.
 pub extra:Option<usize>,
}
#[derive(Clone,Copy,Debug,PartialEq)]pub struct TakenDamage{pub lost:f64,pub critical:Option<bool>}
impl TakenDamage{fn zero()->Self{Self{lost:0.0,critical:None}}fn zero_critical(critical:bool)->Self{Self{lost:0.0,critical:Some(critical)}}}
#[derive(Clone,Copy,Debug,Eq,PartialEq)]pub enum ImmuneText{Immune,PhysicalImmune,MagicImmune}
#[derive(Clone,Copy,Debug,Eq,PartialEq)]pub enum PopupColor{Red,Blue}
#[derive(Clone,Debug)]pub enum DamageCallback{
 Immune{defender:DamageUnitId,text:ImmuneText,color:PopupColor},
 Suppression{defender:DamageUnitId},
 Number{defender:DamageUnitId,attacker:DamageUnitId,damage:f64,critical:bool,suppressed:bool},
}
#[derive(Clone,Debug)]pub enum DamagePopup{
 Text{text:&'static str,color:PopupColor,actor:Option<usize>},
 Number{label:&'static str,color:&'static str,actor:usize,critical:bool,direction:f64,scale:f64,number:f64},
}
/// Every game-mechanics call from takeDamage remains REQUIRED. The host must
/// dispatch actual hero/buff overrides; no default methods omit effects or RNG.
/// Plain-field accessors return current source state at each original read site.
pub trait TakeDamageHooks{
 type Extra:Copy;
 fn attrs(&self,unit:DamageUnitId)->&DamageAttributes;
 fn camp(&self,unit:DamageUnitId)->f64;
 fn hp(&self,unit:DamageUnitId)->f64;
 fn mp(&self,unit:DamageUnitId)->f64;
 fn player_camp(&self)->f64;
 fn enemy_camp(&self)->f64;
 fn debug_attack_ratio(&self)->f64;
 fn is_field_npc(&self,unit:DamageUnitId)->bool;
 fn can_critical_special(&self,unit:DamageUnitId)->bool;
 fn invulnerable(&self,unit:DamageUnitId)->bool;
 fn uncontrollable(&self,unit:DamageUnitId)->bool;
 fn multi_damaged_state(&self,unit:DamageUnitId)->bool;
 fn is_birth(&self,unit:DamageUnitId)->bool;
 fn is_fall(&self,unit:DamageUnitId)->bool;
 fn thump_condition(&self,unit:DamageUnitId)->Option<f64>;
 fn thump_resistance(&self,unit:DamageUnitId)->f64;
 fn mp_gain_rate(&self,unit:DamageUnitId)->f64;
 fn config_mode(&self)->&str;
 fn actor(&self,unit:DamageUnitId)->Option<usize>;
 fn position_x(&self,unit:DamageUnitId)->f64;
 fn skill_no_shield_coefficient(&self,skill:DamageSkillId)->Option<f64>;
 fn buff_count(&self,unit:DamageUnitId)->usize;
 fn buff_at(&self,unit:DamageUnitId,index:usize)->DamageBuffId;
 fn buff_make_damage_value(&self,buff:DamageBuffId)->f64;
 fn buff_damaged_value(&self,buff:DamageBuffId)->f64;
 fn buff_is_shield(&self,buff:DamageBuffId)->bool;
 fn rage(&self,unit:DamageUnitId)->Option<DamageRageId>;
 fn is_pet(&mut self,unit:DamageUnitId)->DamageResult<bool>;
 fn is_alive(&mut self,unit:DamageUnitId)->DamageResult<bool>;
 fn prior_make_damage(&mut self,buff:DamageBuffId,damage:f64,target:DamageUnitId,skill:Option<DamageSkillId>,kind:&str)->DamageResult<f64>;
 fn post_switch_type(&mut self,buff:DamageBuffId,damage:f64,target:DamageUnitId,skill:Option<DamageSkillId>,kind:&str,context:&mut DamageContext)->DamageResult<()>;
 fn probability_hooks(&mut self,probability:f64,attacker:Option<DamageUnitId>,defender:DamageUnitId,skill:Option<DamageSkillId>,kind:&str)->DamageResult<f64>;
 fn fix_probability(&mut self,probability:f64,camp:f64)->DamageResult<f64>;
 fn random(&mut self)->DamageResult<f64>;
 fn critical_coefficient(&mut self,attacker:DamageUnitId,defender:DamageUnitId)->DamageResult<f64>;
 fn after_immunity(&mut self,defender:DamageUnitId,damage:f64,immunity:f64)->DamageResult<f64>;
 fn level_suppress_coefficient(&self,unit:DamageUnitId)->f64;
 fn level_suppress_offset(&self,unit:DamageUnitId)->f64;
 fn level_suppress_a_to_b(&mut self,attacker:DamageUnitId,defender:DamageUnitId,offset:f64)->DamageResult<f64>;
 fn tag_damage(&mut self,defender:DamageUnitId,attacker:DamageUnitId,damage:f64)->DamageResult<f64>;
 fn magic_dodge(&mut self,defender:DamageUnitId,attacker:DamageUnitId,skill:Option<DamageSkillId>)->DamageResult<bool>;
 fn make_damage(&mut self,buff:DamageBuffId,damage:f64,target:DamageUnitId,skill:Option<DamageSkillId>,critical:bool,kind:&str,context:&mut DamageContext)->DamageResult<f64>;
 fn rage_make_damage(&mut self,rage:DamageRageId,attacker:DamageUnitId,damage:f64,target:DamageUnitId,skill:Option<DamageSkillId>,critical:bool)->DamageResult<f64>;
 fn on_damaged(&mut self,buff:DamageBuffId,damage:f64,kind:&str,attacker:DamageUnitId,critical:bool,magic_dodge:bool,skill:Option<DamageSkillId>)->DamageResult<f64>;
 fn warn_removed_buff(&mut self)->DamageResult<()>;
 fn local_bot(&self)->bool;
 fn on_damage_shield(&mut self,buff:DamageBuffId,damage:f64,kind:&str,attacker:DamageUnitId,critical:bool,magic_dodge:bool,skill:Option<DamageSkillId>)->DamageResult<f64>;
 fn rage_take_damage(&mut self,rage:DamageRageId,defender:DamageUnitId,damage:f64,kind:&str,attacker:DamageUnitId,critical:bool,magic_dodge:bool,skill:Option<DamageSkillId>)->DamageResult<f64>;
 fn final_damaged(&mut self,buff:DamageBuffId,damage:f64,kind:&str,attacker:DamageUnitId,critical:bool,skill:Option<DamageSkillId>)->DamageResult<f64>;
 fn rage_take_damage_final(&mut self,rage:DamageRageId,defender:DamageUnitId,damage:f64)->DamageResult<f64>;
 fn summon_hero(&mut self,attacker:DamageUnitId)->DamageResult<DamageUnitId>;
 fn success_make_damage(&mut self,summoner:DamageUnitId,defender:DamageUnitId,damage:f64,extra:Self::Extra)->DamageResult<()>;
 fn success_buff_damage(&mut self,buff:DamageBuffId,damage:f64,defender:DamageUnitId,kind:&str,skill:Option<DamageSkillId>,critical:bool,extra:Self::Extra)->DamageResult<()>;
 fn record_damage(&mut self,summoner:DamageUnitId,damage:f64,defender:DamageUnitId,skill:Option<DamageSkillId>)->DamageResult<()>;
 fn record_real_bear_damage(&mut self,defender:DamageUnitId,damage:f64,summoner:DamageUnitId)->DamageResult<()>;
 fn record_bear_damage(&mut self,defender:DamageUnitId,damage:f64)->DamageResult<()>;
 fn set_hp(&mut self,defender:DamageUnitId,hp:f64)->DamageResult<()>;
 fn die(&mut self,defender:DamageUnitId,attacker:DamageUnitId)->DamageResult<()>;
 fn fix_thump_condition(&mut self,threshold:f64,camp:f64)->DamageResult<f64>;
 fn multi_damaged(&mut self,defender:DamageUnitId)->DamageResult<()>;
 fn check_resistance(&mut self,defender:DamageUnitId,attacker:DamageUnitId)->DamageResult<bool>;
 fn thump(&mut self,defender:DamageUnitId)->DamageResult<()>;
 fn transfer_mp_target(&mut self,defender:DamageUnitId)->DamageResult<DamageUnitId>;
 fn fix_gain_mp(&mut self,amount:f64,source:MpSource,camp:f64)->DamageResult<f64>;
 fn set_mp(&mut self,target:DamageUnitId,mp:f64,attacker:DamageUnitId)->DamageResult<()>;
 fn unfreeze_actor(&mut self,defender:DamageUnitId,partial:bool)->DamageResult<()>;
 fn enqueue(&mut self,callback:DamageCallback)->DamageResult<()>;
 fn popup(&mut self,popup:DamagePopup)->DamageResult<()>;
 fn log_take_damage(&mut self,defender:DamageUnitId,base:f64,kind:&str,field:&str,attacker:DamageUnitId,critical_ratio:f64)->DamageResult<()>;
}

/// `field` None/empty reproduces a||"hp"; critical_ratio is Number-or-missing.
/// Other dynamic JS argument types must be converted by the source ABI first.
pub fn take_damage<H:TakeDamageHooks>(h:&mut H,defender:DamageUnitId,mut damage:f64,kind:&str,field:Option<&str>,attacker:Option<DamageUnitId>,critical_ratio:Option<f64>,skill:Option<DamageSkillId>,extra:H::Extra)->DamageResult<TakenDamage>{
 let field=field.filter(|s|!s.is_empty()).unwrap_or("hp");
 let mut ratio=critical_ratio.unwrap_or(f64::NAN);if ratio!=0.0&&!truthy(ratio){ratio=1.0;}
 if h.is_pet(defender)?{if attacker.is_none()||!h.is_pet(attacker.unwrap())?{return Ok(TakenDamage::zero())}}
 if !h.is_alive(defender)?{return Ok(TakenDamage::zero())}
 let require_attacker=||attacker.ok_or_else(||"source attacker property access on null/undefined".to_string());
 let mut index=0;
 if let Some(attacker)=attacker{while index<h.buff_count(attacker){let buff=h.buff_at(attacker,index);damage=h.prior_make_damage(buff,damage,defender,skill,kind)?;index+=1;}}
 let(mut attack,mut defence,mut crit,mut dcrit,mut immunity)=(f64::NAN,f64::NAN,f64::NAN,f64::NAN,f64::NAN);
 match kind{
  "AD"=>{attack=js_max(0.0,h.attrs(require_attacker()?).atk);defence=js_max(0.0,h.attrs(defender).arm);crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;let reduction=or_zero(h.attrs(require_attacker()?).dpimu);immunity=or_zero(h.attrs(defender).pimu-reduction);},
  "AP"=>{attack=js_max(0.0,h.attrs(require_attacker()?).atk);defence=js_max(0.0,h.attrs(defender).arm);crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;let reduction=or_zero(h.attrs(require_attacker()?).dmimu);immunity=or_zero(h.attrs(defender).mimu-reduction);},
  "Holy"=>{defence=0.0;crit=0.0;dcrit=h.attrs(defender).dcrit;immunity=or_zero(h.attrs(defender).himu);},
  "HolyCanCrit"=>{defence=0.0;crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;immunity=or_zero(h.attrs(defender).himu);},
  "Special"=>{attack=js_max(0.0,h.attrs(require_attacker()?).atk);defence=0.0;crit=0.0;dcrit=0.0;immunity=0.0;if h.can_critical_special(require_attacker()?){crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;}},
  "PET"=>{attack=js_max(0.0,h.attrs(require_attacker()?).atk);defence=js_max(0.0,h.attrs(defender).arm);crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;immunity=or_zero(h.attrs(defender).himu);},
  "NoMIMUAP"=>{attack=js_max(0.0,h.attrs(require_attacker()?).atk);defence=js_max(0.0,h.attrs(defender).arm);crit=h.attrs(require_attacker()?).crit;dcrit=h.attrs(defender).dcrit;let value=or_zero(h.attrs(defender).mimu);immunity=if truthy(value)&&value>=100.0{h.attrs(defender).mimu}else{0.0};},_=>{},
 }
 let mut context=DamageContext::default();index=0;
 if let Some(attacker)=attacker{while index<h.buff_count(attacker){let buff=h.buff_at(attacker,index);h.post_switch_type(buff,damage,defender,skill,kind,&mut context)?;index+=1;}}
 if defence>0.0&&context.defence_ignore_coefficient.is_some_and(|x|x>0.0){
  let old=defence;let ignored=js_max(0.0,js_min(context.defence_ignore_coefficient.unwrap(),1.0));defence*=1.0-ignored;
  if attack>0.0&&attack.is_finite(){let denominator=attack+3.0*defence;context.defence_ignore_damage_coefficient=Some(if denominator>0.0{(attack+3.0*old)/denominator}else{1.0});}
 }
 if immunity<100.0&&context.immunity_ignore_coefficient.is_some_and(|x|x>0.0){
  let ignored=js_max(0.0,js_min(context.immunity_ignore_coefficient.unwrap(),1.0));
  let base=match kind{"AD"=>js_max(0.0,or_zero(h.attrs(defender).pimu)),"AP"=>js_max(0.0,or_zero(h.attrs(defender).mimu)),_=>0.0};
  let old=immunity;immunity-=base*ignored;if base>0.0{let denominator=100.0-old;context.immunity_ignore_damage_coefficient=Some(if denominator>0.0{(100.0-immunity)/denominator}else{1.0});}
 }
 let probability=(crit-dcrit)*ratio/100.0;
 let probability=h.probability_hooks(probability,attacker,defender,skill,kind)?;
 let attacker=require_attacker()?;
 let probability=h.fix_probability(probability,h.camp(attacker))?;
 let mut critical=h.random()?<probability;if ratio>100.0{critical=true;}
 let crit_coefficient=h.critical_coefficient(attacker,defender)?;let multiplier=if critical{crit_coefficient}else{1.0};
 damage=js_max(0.0,damage);
 if h.is_field_npc(defender){return Ok(TakenDamage::zero())}
 let original=damage;let mut amount=0.0;
 if damage!=0.0{amount=if kind!="Holy"&&kind!="HolyCanCrit"{damage*attack/(attack+3.0*defence)}else{damage};}
 if amount<=0.0{return Ok(TakenDamage::zero())}
 if h.camp(defender)!=h.player_camp(){amount*=h.debug_attack_ratio();}amount*=multiplier;
 if immunity>=100.0{
  let color=if h.camp(defender)==h.enemy_camp(){PopupColor::Red}else{PopupColor::Blue};
  let physical=h.attrs(defender).pimu>=100.0;let magic=h.attrs(defender).mimu>=100.0;
  let text=if physical&&!magic{ImmuneText::PhysicalImmune}else if magic&&!physical{ImmuneText::MagicImmune}else{ImmuneText::Immune};
  h.enqueue(DamageCallback::Immune{defender,text,color})?;return Ok(TakenDamage::zero_critical(critical))
 }
 amount=h.after_immunity(defender,amount,immunity)?;
 if truthy(h.level_suppress_coefficient(attacker)){let offset=or_zero(h.level_suppress_offset(attacker));let coefficient=h.level_suppress_a_to_b(attacker,defender,offset)?;amount*=1.0+coefficient*h.level_suppress_coefficient(attacker);}
 amount=h.tag_damage(defender,attacker,amount)?;
 let mut magic_dodged=false;if h.magic_dodge(defender,attacker,skill)?{amount*=0.5;magic_dodged=true;h.enqueue(DamageCallback::Suppression{defender})?;}
 let mut extra_damage=0.0;index=0;
 while index<h.buff_count(attacker){let buff=h.buff_at(attacker,index);amount=h.make_damage(buff,amount,defender,skill,critical,kind,&mut context)?;extra_damage+=h.buff_make_damage_value(buff);index+=1;}
 if let Some(rage)=h.rage(attacker){amount=h.rage_make_damage(rage,attacker,amount,defender,skill,critical)?;}
 let mut damage_cursor=0;
 while damage_cursor<h.buff_count(defender){
  let buff=h.buff_at(defender,damage_cursor);damage_cursor+=1;let before=h.buff_count(defender);
  amount=h.on_damaged(buff,amount,kind,attacker,critical,magic_dodged,skill)?;extra_damage+=h.buff_damaged_value(buff);
  if before==h.buff_count(defender)+1{damage_cursor-=1;if h.local_bot(){h.warn_removed_buff()?;}}
  if amount==0.0{break}
 }
 amount+=extra_damage;
 let bypass_coefficient=skill.and_then(|id|h.skill_no_shield_coefficient(id)).filter(|x|*x>0.0).map_or(0.0,|x|js_min(1.0,x));
 let bypass=amount*bypass_coefficient;let mut shielded=amount-bypass;
 let mut shield_cursor=0;
 while shield_cursor<h.buff_count(defender){
  let buff=h.buff_at(defender,shield_cursor);shield_cursor+=1;
  if h.buff_is_shield(buff){
   let before=h.buff_count(defender);shielded=h.on_damage_shield(buff,shielded,kind,attacker,critical,magic_dodged,skill)?;
   // Source decrements damage_cursor (H), NOT shield_cursor (K). H is dead after
   // this loop; retaining it cannot affect list traversal or subsequent mechanics.
   if before==h.buff_count(defender)+1{damage_cursor=damage_cursor.wrapping_sub(1);}
   if shielded==0.0{break}
  }
 }
 let _=damage_cursor;
 amount=bypass+shielded;if amount<=0.0{return Ok(TakenDamage::zero_critical(critical))}
 let mut actual=amount;
 if let Some(rage)=h.rage(defender){actual=h.rage_take_damage(rage,defender,actual,kind,attacker,critical,magic_dodged,skill)?;}
 index=0;while index<h.buff_count(defender){let buff=h.buff_at(defender,index);index+=1;actual=h.final_damaged(buff,actual,kind,attacker,critical,skill)?;if actual==0.0{break}}
 if let Some(rage)=h.rage(defender){actual=h.rage_take_damage_final(rage,defender,actual)?;}
 let summoner=h.summon_hero(attacker)?;
 if actual>0.0{
  h.success_make_damage(summoner,defender,actual,extra)?;index=0;
  while index<h.buff_count(summoner){let buff=h.buff_at(summoner,index);h.success_buff_damage(buff,amount,defender,kind,skill,critical,extra)?;index+=1;}
 }
 let lost=js_min(h.hp(defender),actual);
 if attacker!=defender&&field=="hp"{
  if h.camp(summoner)!=h.camp(defender)&&lost>0.0{h.record_damage(summoner,lost,defender,skill)?;h.record_real_bear_damage(defender,lost,summoner)?;}
  let bear=js_max(lost,original);if bear>0.0{h.record_bear_damage(defender,bear)?;}
 }
 if field=="hp"{
  if !h.invulnerable(defender){h.set_hp(defender,h.hp(defender)-actual)?;}
  if h.hp(defender)==0.0{h.die(defender,attacker)?;}
  else{
   let mut threshold=0.08;
   if let Some(value)=h.thump_condition(defender){let value=if truthy(value){value/100.0}else{0.08};if !(value<=0.0){threshold=value;}}
   threshold+=0.035*or_zero(h.thump_resistance(defender));threshold=h.fix_thump_condition(threshold,h.camp(defender))?;
   let proportion=actual/h.attrs(defender).hp;
   if h.multi_damaged_state(defender){h.multi_damaged(defender)?;}
   else if !(proportion<=threshold)&&!h.is_birth(defender)&&!h.is_fall(defender)&&!h.uncontrollable(defender)&&!h.check_resistance(defender,attacker)?{h.thump(defender)?;}
   let mp=actual*h.mp_gain_rate(defender)/h.attrs(defender).hp;
   let target=h.transfer_mp_target(defender)?;let mp=h.fix_gain_mp(mp,MpSource::Victim,h.camp(target))?;h.set_mp(target,h.mp(target)+mp,attacker)?;
  }
 }
 h.unfreeze_actor(defender,true)?;
 let suppressed=damage<0.2*h.attrs(defender).hp&&h.config_mode()=="rt_pvp";
 h.enqueue(DamageCallback::Number{defender,attacker,damage:actual,critical,suppressed})?;
 h.log_take_damage(defender,damage,kind,field,attacker,ratio)?;
 Ok(TakenDamage{lost:actual,critical:Some(critical)})
}

/// Executes the actual queued damage callback body. Actor absence follows source
/// conditions; it is never implemented as suppressing the callback itself.
pub fn execute_damage_callback<H:TakeDamageHooks>(h:&mut H,callback:DamageCallback)->DamageResult<()>{
 match callback{
  DamageCallback::Immune{defender,text,color}=>{let text=match text{ImmuneText::Immune=>"immune",ImmuneText::PhysicalImmune=>"physical_immune",ImmuneText::MagicImmune=>"magic_immune"};h.popup(DamagePopup::Text{text,color,actor:h.actor(defender)})?;},
  DamageCallback::Suppression{defender}=>{let color=if h.camp(defender)==h.enemy_camp(){PopupColor::Red}else{PopupColor::Blue};h.popup(DamagePopup::Text{text:"suppression",color,actor:h.actor(defender)})?;},
  DamageCallback::Number{defender,attacker,damage,critical,suppressed}=>{
   if let Some(actor)=h.actor(defender){if !suppressed{let number=(damage+0.5).floor();if number!=0.0{let label=if critical{"x-"}else{"-"};let color=if critical{"n_orange"}else{"n_white"};let direction=if h.position_x(attacker)>=h.position_x(defender){-1.0}else{1.0};h.popup(DamagePopup::Number{label,color,actor,critical,direction,scale:3.0,number})?;}}}
  },
 }Ok(())
}
