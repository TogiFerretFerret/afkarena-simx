use battle_core::scheduler::{EntityId, Event, ListId, Record, Scheduler};
use std::fmt::Write as FmtWrite;
use std::io::{self, BufRead, Write as IoWrite};

#[derive(Clone, Copy, Debug)]
struct Action { kind: usize, a: usize, b: usize }
#[derive(Clone, Debug)]
struct Data { action: Action, updates: usize, used: bool }
fn next(words: &mut std::str::SplitWhitespace<'_>) -> usize { words.next().expect("missing input").parse().expect("integer") }
fn ids(values: impl IntoIterator<Item=usize>) -> String { format!("[{}]",values.into_iter().map(|x|x.to_string()).collect::<Vec<_>>().join(",")) }
fn state(world: &Scheduler<Data>) -> String {
    let groups=ids(world.groups.iter().map(|x|x.0));
    let lists=world.lists.iter().map(|l|ids(l.iter().map(|x|x.0))).collect::<Vec<_>>().join(",");
    let entities=world.entities.iter().map(|e|format!("{{\"frozen\":{},\"terminated\":{},\"updates\":{},\"used\":{}}}",e.frozen,e.terminated,e.data.updates,e.data.used)).collect::<Vec<_>>().join(",");
    format!("{{\"groups\":{},\"lists\":[{}],\"entities\":[{}]}}",groups,lists,entities)
}
fn main() -> io::Result<()> {
    let stdin=io::stdin();
    let mut output=io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line=line?;
        let mut words=line.split_whitespace();
        let n=next(&mut words);let l=next(&mut words);let g=next(&mut words);
        let mut world=Scheduler::default();
        for _ in 0..n {
            let frozen=next(&mut words)!=0;let terminated=next(&mut words)!=0;
            world.entities.push(Record{frozen,terminated,data:Data{action:Action{kind:0,a:0,b:0},updates:0,used:false}});
        }
        for entity in &mut world.entities { entity.data.action=Action{kind:next(&mut words),a:next(&mut words),b:next(&mut words)}; }
        for _ in 0..l {
            let count=next(&mut words);
            world.lists.push((0..count).map(|_|EntityId(next(&mut words))).collect());
        }
        world.groups=(0..g).map(|_|ListId(next(&mut words))).collect();
        assert!(words.next().is_none());
        let mut updates=vec![];let mut frames=vec![];
        world.run_with(|world,id| {
            updates.push(id.0);
            let data=&mut world.entities[id.0].data;
            data.updates+=1;
            if data.used { return; }
            data.used=true;
            let action=data.action;
            match action.kind {
                0=>{},
                1=>world.lists[action.a].push(EntityId(action.b)),
                2=>{if action.b<world.lists[action.a].len(){world.lists[action.a].remove(action.b);}},
                3=>world.groups[action.a]=ListId(action.b),
                4=>world.entities[action.a].terminated=true,
                5=>world.entities[action.a].frozen=true,
                6=>world.entities[action.a].frozen=false,
                7=>{world.lists[action.a].pop();},
                8=>world.lists[action.a].clear(),
                _=>panic!("unknown action"),
            }
        },|world,event|{
            let (kind,id)=match event{Event::BeforeUpdate(id)=>("before_update",id.0),Event::AfterUpdate(id)=>("after_update",id.0),Event::Filtered(group)=>("filter",group)};
            frames.push(format!("{{\"kind\":\"{}\",\"id\":{},\"state\":{}}}",kind,id,state(world)));
        });
        let snapshot=state(&world);
        let mut result=String::new();
        write!(&mut result,"{{\"updates\":{},\"frames\":[{}],{}",ids(updates),frames.join(","),&snapshot[1..]).unwrap();
        writeln!(output,"{}",result)?;
    }
    output.flush()
}
