#[path="../crates/battle-core/src/damage.rs"]mod damage;
#[path="../crates/battle-core/src/js_math.rs"]mod js_math;
#[path="../crates/battle-core/src/rng.rs"]mod rng;
use damage::*;use std::io::{self,BufRead,Write};
struct Host{fix:ProbabilityFix,stage:f64,rng:rng::BattleRng,events:Vec<&'static str>,draws:usize}
impl DodgeHooks for Host{fn fix_probability(&mut self,p:f64,camp:f64)->f64{self.events.push("fix");fix_probability(p,self.stage,camp,1.0,self.fix)}fn random(&mut self)->f64{self.events.push("rand");self.draws+=1;self.rng.next_f64()}}
struct Buffs{lists:Vec<Vec<usize>>,active:usize,seen:Vec<usize>,action:usize,used:bool}
impl PowerHooks for Buffs{type Buff=usize;fn buff_count(&mut self)->usize{self.lists[self.active].len()}fn buff_at(&mut self,i:usize)->usize{self.lists[self.active][i]}fn on_calculate_power(&mut self,b:usize,p:f64,source:usize,target:usize)->f64{assert_eq!((source,target),(3,7));self.seen.push(b);if !self.used{self.used=true;match self.action{1=>self.active=1,2=>self.lists[self.active].push(4),3=>{self.lists[self.active].remove(0);},_=>{}}}p+(b as f64+1.0)}}
fn main()->io::Result<()>{let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut words=line.split_whitespace();let mut n=vec![];for _ in 0..28{n.push(f64::from_bits(u64::from_str_radix(words.next().unwrap(),16).unwrap()));}let flags:Vec<usize>=words.map(|s|s.parse().unwrap()).collect();assert_eq!(flags.len(),7);
 let row=ProbabilityFix{cap_up:n[8],ratio_up:n[9],ratio_down:n[10],cap_down:n[11]};let mp_row=MpFix{start_seconds:n[14],player_caster:n[15],player_victim:n[16],enemy_caster:n[17],enemy_victim:n[18]};let source=match flags[5]{0=>MpSource::Caster,1=>MpSource::Victim,_=>MpSource::Other};
 let mut buffs=Buffs{lists:vec![vec![0,1],vec![2,3,4]],active:0,seen:vec![],action:flags[6],used:false};let power=power(PowerInput{base:n[19],per_level:n[20],plus_ratio:n[21],finally_damage_ratio:flags[0]!=0,has_plus_attr:flags[1]!=0,plus_attr:n[22],level:n[23],extra_damage_ratio:n[24]},3,7,&mut buffs);
 let values=[critical_coefficient(n[0],n[1],n[2]),lost_after_immunity(n[3],n[4]),fix_probability(n[5],n[6],n[7],1.0,row),fix_gain_mp(n[12],n[6],n[13],n[7],1.0,source,mp_row),dodge_probability(n[25],n[26]),power];
 let mut host=Host{fix:row,stage:n[6],rng:rng::BattleRng::default(),events:vec![],draws:0};host.rng.seed(n[27]);let dodge=check_dodge(flags[2]!=0,flags[3]!=0,n[25],n[26],n[7],&mut host);let magic=check_magic_dodge(flags[4]!=0,n[25],n[26],&mut host);
 writeln!(out,"{{\"values\":[{}],\"dodge\":{},\"magic\":{},\"rng\":\"{:016x}\",\"draws\":{},\"events\":[{}],\"buffs\":[{}]}}",values.iter().map(|x|format!("\"{:016x}\"",x.to_bits())).collect::<Vec<_>>().join(","),dodge,magic,host.rng.snapshot().state.to_bits(),host.draws,host.events.iter().map(|x|format!("\"{}\"",x)).collect::<Vec<_>>().join(","),buffs.seen.iter().map(|x|x.to_string()).collect::<Vec<_>>().join(","))?;
 }out.flush()}
