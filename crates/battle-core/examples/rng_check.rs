use battle_core::rng::{BattleRng, Event, Observer, Snapshot};
use std::io::{self, BufRead, Write};

#[derive(Default)]
struct Recorder { events: Vec<String> }
impl Observer for Recorder {
    fn observe(&mut self, event: Event, snapshot: Snapshot) {
        let (tag, value) = match event {
            Event::InitialSeedWritten(x) => ("initial_seed_write", Some(x)),
            Event::InvalidSeed => ("invalid_seed_callback", None),
            Event::FallbackSeed(x) => ("fallback_seed", Some(x)),
            Event::SeedComputed(x) => ("seed_computed", Some(x)),
            Event::SeedLogValue(x) => ("seed_log_value", Some(x)),
            Event::Seeded(x) => ("seed_log_callback", Some(x)),
            Event::StateWritten(x) => ("state_write", Some(x)),
            Event::NextStateComputed(x) => ("next_state_computed", Some(x)),
            Event::RandomComputed(x) => ("random_computed", Some(x)),
            Event::RandomLogValue(x) => ("random_log_value", Some(x)),
            Event::Random(x) => ("random_log_callback", Some(x)),
            Event::Peek(x) => ("peek", Some(x)),
            Event::Returned(x) => ("return", Some(x)),
            Event::ReturnedUndefined => ("return_undefined", None),
        };
        let optional = |v: Option<f64>| v.map_or_else(|| "-".into(), |x| format!("{:016x}", x.to_bits()));
        self.events.push(format!("{}:{}:{:016x}:{}", tag, optional(value), snapshot.state.to_bits(), optional(snapshot.initial_seed)));
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    let mut rng = BattleRng::default();
    for line in stdin.lock().lines() {
        let input = f64::from_bits(u64::from_str_radix(line?.trim(), 16).expect("seed bits"));
        let mut recorder = Recorder::default();
        rng.seed_with(input, &mut recorder);
        for _ in 0..32 {
            rng.peek_with(&mut recorder);
            rng.next_with(&mut recorder);
        }
        writeln!(output, "{}", recorder.events.join(" "))?;
    }
    output.flush()
}
