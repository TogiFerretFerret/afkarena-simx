#[path="../crates/battle-core/src/ai.rs"] mod ai;
use ai::*;
use std::io::{self,BufRead,Write};
fn opt(v:Option<usize>)->String{v.map(|v|v.to_string()).unwrap_or_else(||"null".into())}
fn code(v:ManualCast)->usize{match v{ManualCast::Undefined=>0,ManualCast::Null=>1,ManualCast::False=>2,ManualCast::Cast=>3,ManualCast::Trigger=>4}}
fn state(s:&AiControl)->String{format!("{{\"state\":{},\"fear\":{},\"fearTarget\":{},\"force\":{},\"destination\":{},\"manual\":{},\"manualSkill\":{},\"currentSkill\":{},\"turnbased\":{},\"target\":{},\"canCast\":{},\"willCast\":{},\"list\":{},\"lists\":{:?},\"ignore\":{:?}}}",match s.state{UnitAiState::Idle=>0,UnitAiState::Walk=>1,UnitAiState::Other=>2},s.fear,opt(s.fear_target),opt(s.force_destination),opt(s.destination),s.skills.manual,opt(s.skills.manual_skill),opt(s.skills.current_skill),s.skills.turnbased,opt(s.skills.target),code(s.skills.can_cast_manual),s.skills.will_cast_manual,s.skills.list,s.skills.lists,s.ignore_controllable)}
struct Hooks{calls:Vec<String>,mask:usize,count:usize,n:usize,search:Option<usize>,found:Option<usize>,answers:usize}
impl Hooks{
 fn call(&mut self,s:&mut AiControl,kind:&str,id:Option<usize>,target:Option<usize>)->bool{
  let before=state(s);let answer=(self.answers>>(self.count%16))&1!=0;self.count+=1;
  if self.mask&1!=0{s.skills.target=Some((s.skills.target.unwrap_or(0)+1)%7)}
  if self.mask&2!=0{s.skills.current_skill=Some((s.skills.current_skill.unwrap_or(0)+1)%self.n)}
  if self.mask&4!=0{s.skills.manual=!s.skills.manual}
  if self.mask&8!=0{s.skills.list=1-s.skills.list}
  if self.mask&16!=0{let l=self.count%2;let i=self.count%self.n;s.skills.lists[l][i]=(s.skills.lists[l][i]+1)%self.n}
  if self.mask&32!=0{s.skills.manual_skill=Some((s.skills.manual_skill.unwrap_or(0)+1)%self.n)}
  if self.mask&64!=0{s.skills.turnbased=!s.skills.turnbased}
  if self.mask&128!=0{s.force_destination=Some((s.force_destination.unwrap_or(0)+1)%7);s.destination=Some((s.destination.unwrap_or(0)+1)%7)}
  if self.mask&256!=0{let i=self.count%self.n;s.ignore_controllable[i]=!s.ignore_controllable[i]}
  if self.mask&512!=0{s.state=match s.state{UnitAiState::Idle=>UnitAiState::Walk,UnitAiState::Walk=>UnitAiState::Other,UnitAiState::Other=>UnitAiState::Idle};s.fear=!s.fear}
  self.calls.push(format!("{{\"kind\":\"{kind}\",\"id\":{},\"target\":{},\"answer\":{answer},\"before\":{before},\"after\":{}}}",opt(id),opt(target),state(s)));answer
 }
}
impl ControlHooks for Hooks{
 fn walk_away_from(&mut self,s:&mut AiControl,t:usize){self.call(s,"away",None,Some(t));}
 fn walk_to(&mut self,s:&mut AiControl,t:WalkArgument){let (kind,id)=match t{WalkArgument::Vector(i)=>("walkVector",i),WalkArgument::Unit(i)=>("walkUnit",i)};self.call(s,kind,None,Some(id));}
 fn search_target(&mut self,s:&mut AiControl,tb:bool)->Option<usize>{self.call(s,if tb{"searchTB"}else{"search"},None,None);self.search}
 fn find_skill_to_cast(&mut self,s:&mut AiControl)->Option<usize>{self.call(s,"find",None,None);self.found}
 fn cast_skill(&mut self,s:&mut AiControl,id:usize,t:Option<usize>){self.call(s,"cast",Some(id),t);}
 fn is_out_of_stage(&mut self,s:&mut AiControl)->bool{self.call(s,"outside",None,None)}
 fn idle(&mut self,s:&mut AiControl){self.call(s,"idle",None,None);}
 fn check_trigger(&mut self,s:&mut AiControl)->Option<bool>{Some(self.call(s,"check",None,None))}
 fn trigger(&mut self,s:&mut AiControl,id:usize){self.call(s,"trigger",Some(id),None);}
 fn can_cast_with_target(&mut self,s:&mut AiControl,id:usize,t:Option<usize>)->bool{self.call(s,"can",Some(id),t)}
 fn will_cast(&mut self,s:&mut AiControl,id:usize)->bool{self.call(s,"will",Some(id),None)}
}
fn int(i:&mut std::str::SplitWhitespace<'_>)->usize{i.next().unwrap().parse().unwrap()}
fn option(v:usize,sentinel:usize)->Option<usize>{if v==sentinel{None}else{Some(v)}}
fn main()->io::Result<()>{let mut out=io::BufWriter::new(io::stdout().lock());for line in io::stdin().lock().lines(){let line=line?;let mut i=line.split_whitespace();let kind=int(&mut i);let n=int(&mut i);let st=match int(&mut i){0=>UnitAiState::Idle,1=>UnitAiState::Walk,_=>UnitAiState::Other};let fear=int(&mut i)!=0;let fear_target=option(int(&mut i),7);let force_destination=option(int(&mut i),7);let destination=option(int(&mut i),7);let manual=int(&mut i)!=0;let manual_skill=option(int(&mut i),n);let current_skill=option(int(&mut i),n);let turnbased=int(&mut i)!=0;let target=option(int(&mut i),7);let can_cast_manual=match int(&mut i){0=>ManualCast::Undefined,1=>ManualCast::Null,2=>ManualCast::False,3=>ManualCast::Cast,_=>ManualCast::Trigger};let will_cast_manual=int(&mut i)!=0;let list=int(&mut i);let lists=(0..2).map(|_|(0..n).map(|_|int(&mut i)).collect()).collect();let ignore_controllable=(0..n).map(|_|int(&mut i)!=0).collect();let mut h=Hooks{mask:int(&mut i),answers:int(&mut i),search:option(int(&mut i),7),found:option(int(&mut i),n),calls:vec![],count:0,n};let mut s=AiControl{owner:0,state:st,fear,fear_target,force_destination,destination,skills:SkillSelection{lists,list,manual,manual_skill,current_skill,turnbased,target,can_cast_manual,will_cast_manual},ignore_controllable};if kind==0{update(&mut s,&mut h)}else{cast_skill_when_controlled(&mut s,&mut h)}writeln!(out,"{{\"state\":{},\"calls\":[{}]}}",state(&s),h.calls.join(","))?;}out.flush()}
