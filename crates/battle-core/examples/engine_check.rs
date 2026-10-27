use battle_core::engine::{Battle,Hooks,Outcome};
use battle_core::scheduler::{EntityId,ListId,Record};
use std::io::{self,BufRead,Write};
use std::sync::Arc;
fn num(v:f64)->String{format!("\"{:016x}\"",v.to_bits())}
fn optional(v:Option<f64>)->String{v.map(num).unwrap_or_else(||"null".into())}
fn ids(xs:impl IntoIterator<Item=usize>)->String{format!("[{}]",xs.into_iter().map(|x|x.to_string()).collect::<Vec<_>>().join(","))}
fn state(s:&Battle<u8>)->String{
    let mut fields=vec![format!("\"running\":{}",s.running),format!("\"will_restart_game\":{}",s.will_restart_game),format!("\"mode\":\"{}\"",s.mode),format!("\"config_mode\":{}",s.config_mode.as_ref().map(|x|format!("\"{}\"",x)).unwrap_or_else(||"null".into())),format!("\"special_time_limit\":{}",optional(s.special_time_limit)),format!("\"limit_dead_count\":{}",optional(s.limit_dead_count))];
    for (k,v) in [("freeze_level",s.freeze_level),("ignore_level",s.ignore_level),("time_limit",s.time_limit),("time_skill_add",s.time_skill_add),("tick_interval",s.tick_interval),("ticks",s.ticks),("enemy_hero_dead_count",s.enemy_hero_dead_count),("player_hero_dead_count",s.player_hero_dead_count),("alive_enemy_count",s.alive_enemy_count),("alive_player_count",s.alive_player_count)]{fields.push(format!("\"{}\":{}",k,num(v)));}
    fields.push(format!("\"groups\":{}",ids(s.entities.groups.iter().map(|x|x.0))));
    fields.push(format!("\"lists\":[{}]",s.entities.lists.iter().map(|l|ids(l.iter().map(|x|x.0))).collect::<Vec<_>>().join(",")));
    fields.push(format!("\"entities\":[{}]",s.entities.entities.iter().map(|e|format!("{{\"frozen\":{},\"terminated\":{}}}",e.frozen,e.terminated)).collect::<Vec<_>>().join(",")));
    format!("{{{}}}",fields.join(","))
}
const MODES:[&str;6]=["stage","rt_pvp","deep_stage","halloween","race_dream","none"];
struct Fixture{events:Vec<String>,rt:f64,deep:f64,max:bool,max_value:f64,weather_interval:Option<f64>,restart_mode:usize,stop:bool}
impl Fixture{fn event(&mut self,b:&Battle<u8>,kind:&str){self.events.push(format!("{{\"kind\":\"{}\",\"state\":{}}}",kind,state(b)));}}
impl Hooks<u8> for Fixture{
    fn weather_update(&mut self,b:&mut Battle<u8>,_:f64){self.event(b,"weather_update");if let Some(v)=self.weather_interval{b.tick_interval=v;}}
    fn tick_operation(&mut self,b:&mut Battle<u8>){self.event(b,"tick_operation");if self.stop{b.running=false;}}
    fn tick_rage_objects(&mut self,b:&mut Battle<u8>,_:f64){self.event(b,"tick_rage_objects");}
    fn update_entity(&mut self,b:&mut Battle<u8>,id:EntityId,_:f64){
        self.event(b,&format!("update_entity:{}",id.0));
        match b.entities.entities[id.0].data{
            1=>b.alive_enemy_count-=1.0,2=>b.alive_player_count-=1.0,3=>b.will_restart_game=true,
            4=>b.entities.entities[id.0].terminated=true,5=>b.mode=Arc::from("race_dream"),
            6=>b.tick_interval*=2.0,7=>{let next=(id.0+1)%b.entities.entities.len();b.entities.entities[next].frozen=true;},_=>{}}
    }
    fn check_victory_time_fix(&mut self,b:&mut Battle<u8>,id:EntityId){self.event(b,&format!("race_fix:{}",id.0));}
    fn check_push(&mut self,b:&mut Battle<u8>,_:f64){self.event(b,"check_push");}
    fn restart(&mut self,b:&mut Battle<u8>){self.event(b,"restart");if self.restart_mode<6{b.config_mode=if self.restart_mode==5{None}else{Some(Arc::from(MODES[self.restart_mode]))};}}
    fn rtpvp_death_limit(&mut self,b:&mut Battle<u8>)->f64{self.event(b,"rt_limit");self.rt}
    fn deep_stage_death_limit(&mut self,b:&mut Battle<u8>)->f64{self.event(b,"deep_limit");self.deep}
    fn is_halloween_mode(&mut self,b:&mut Battle<u8>,m:Option<&str>)->bool{self.event(b,"is_halloween");m==Some("halloween")}
    fn check_halloween_end(&mut self,b:&mut Battle<u8>){self.event(b,"halloween_end");}
    fn uses_max_ticks(&mut self,b:&mut Battle<u8>,_:Option<&str>)->bool{self.event(b,"uses_max_ticks");self.max}
    fn max_ticks(&mut self,b:&mut Battle<u8>,_:Option<&str>)->f64{self.event(b,"max_ticks");self.max_value}
    fn on_battle_end(&mut self,b:&mut Battle<u8>,outcome:Outcome){self.event(b,match outcome{Outcome::Victory=>"end:victory",Outcome::Defeat=>"end:defeat",Outcome::Timeout=>"end:timeout"});b.running=false;}
    fn format_log(&mut self,b:&mut Battle<u8>)->String{self.event(b,"format_log");"tick".into()}
    fn append_log(&mut self,b:&mut Battle<u8>,text:&str){assert_eq!(text,"tick");self.event(b,"append_log");}
}
struct Input<'a>(std::str::SplitWhitespace<'a>);
impl Input<'_>{fn int(&mut self)->usize{self.0.next().unwrap().parse().unwrap()}fn number(&mut self)->f64{f64::from_bits(u64::from_str_radix(self.0.next().unwrap(),16).unwrap())}}
fn main()->io::Result<()>{
    let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines(){let line=line?;let mut i=Input(line.split_whitespace());let mut b=Battle::default();
        b.running=i.int()!=0;b.mode=Arc::from(MODES[i.int()]);let mode=i.int();b.config_mode=if mode==5{None}else{Some(Arc::from(MODES[mode]))};
        b.freeze_level=i.number();b.ignore_level=i.number();b.time_limit=i.number();b.time_skill_add=i.number();let has=i.int()!=0;let v=i.number();b.special_time_limit=has.then_some(v);b.tick_interval=i.number();b.ticks=i.number();b.will_restart_game=i.int()!=0;let has=i.int()!=0;let v=i.number();b.limit_dead_count=has.then_some(v);b.enemy_hero_dead_count=i.number();b.player_hero_dead_count=i.number();b.alive_enemy_count=i.number();b.alive_player_count=i.number();
        let rt=i.number();let deep=i.number();let max=i.int()!=0;let max_value=i.number();let has=i.int()!=0;let v=i.number();let weather_interval=has.then_some(v);let restart_mode=i.int();let stop=i.int()!=0;
        let n=i.int();for _ in 0..n{let frozen=i.int()!=0;let terminated=i.int()!=0;let action=i.int() as u8;b.entities.entities.push(Record{frozen,terminated,data:action});}
        b.entities.lists.push((0..n).map(EntityId).collect());b.entities.groups.push(ListId(0));assert!(i.0.next().is_none());
        let mut h=Fixture{events:vec![],rt,deep,max,max_value,weather_interval,restart_mode,stop};b.tick(&mut h);
        writeln!(out,"{{\"events\":[{}],\"final\":{}}}",h.events.join(","),state(&b))?;
    }out.flush()
}
