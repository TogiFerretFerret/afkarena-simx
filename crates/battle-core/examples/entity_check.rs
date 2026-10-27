use battle_core::entity::{Entity, Event, Observer, Vec2Arena};
use std::io::{self, BufRead, Write};

#[derive(Default)]
struct Recorder { events: Vec<String> }
impl Observer for Recorder {
    fn observe(&mut self, event: Event, arena: &Vec2Arena, entity: &Entity) {
        let kind = match event {
            Event::Entered => "enter", Event::PositionXWritten => "position_x_write",
            Event::PositionYWritten => "position_y_write", Event::DirectionWritten => "direction_write",
            Event::Returned => "return",
        };
        let vectors = arena.values().iter().map(|v| format!("[\"{:016x}\",\"{:016x}\"]", v[0].to_bits(), v[1].to_bits())).collect::<Vec<_>>().join(",");
        self.events.push(format!("{{\"kind\":\"{}\",\"direction\":\"{:016x}\",\"position\":{},\"velocity\":{},\"vectors\":[{}]}}",kind,entity.direction.to_bits(),entity.position.index(),entity.velocity.index(),vectors));
    }
}
fn number(hex: &str) -> f64 { f64::from_bits(u64::from_str_radix(hex,16).expect("binary64 hex")) }
fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let words: Vec<_> = line.split_whitespace().collect();
        assert!(words.len() >= 6 && (words.len() - 4) % 2 == 0);
        let mut arena = Vec2Arena::default();
        let ids: Vec<_> = words[4..].chunks_exact(2).map(|pair| arena.insert([number(pair[0]), number(pair[1])])).collect();
        let position = ids[words[0].parse::<usize>().expect("position handle")];
        let velocity = ids[words[1].parse::<usize>().expect("velocity handle")];
        let mut entity = Entity { position, velocity, direction: number(words[2]) };
        let mut recorder = Recorder::default();
        entity.update_with(&mut arena, number(words[3]), &mut recorder);
        writeln!(output, "{{\"events\":[{}]}}", recorder.events.join(","))?;
    }
    output.flush()
}
