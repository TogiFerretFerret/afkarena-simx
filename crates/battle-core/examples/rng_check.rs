use battle_core::rng::{BattleRng, Event, Observer, Snapshot};
use std::io::{self, BufRead, Write};

#[derive(Default)]
struct Recorder { events: Vec<String> }
impl Observer for Recorder {
    fn observe(&mut self, event: Event, snapshot: Snapshot) {
        let tag = match event { Event::InvalidSeed => "error", Event::Seeded(_) => "seed", Event::Random(_) => "rand" };
        self.events.push(format!("{}:{:016x}:{:016x}", tag, snapshot.state.to_bits(), snapshot.initial_seed.unwrap().to_bits()));
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    // Keep one instance across commands so reseeding observes the previous state.
    let mut rng = BattleRng::default();
    for line in stdin.lock().lines() {
        let input = f64::from_bits(u64::from_str_radix(line?.trim(), 16).expect("seed bits"));
        let mut recorder = Recorder::default();
        rng.seed_with(input, &mut recorder);
        write!(output, "{:016x}", rng.snapshot().state.to_bits())?;
        for _ in 0..32 {
            let before = rng.snapshot().state.to_bits();
            let peek = rng.peek();
            assert_eq!(rng.snapshot().state.to_bits(), before);
            let value = rng.next_with(&mut recorder);
            write!(output, " {:016x} {:016x} {:016x}", peek.to_bits(), value.to_bits(), rng.snapshot().state.to_bits())?;
        }
        write!(output, " | {}", recorder.events.join(" "))?;
        writeln!(output)?;
    }
    output.flush()
}
