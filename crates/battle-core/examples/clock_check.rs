use battle_core::clock::{Event, LocalClock, Observer};
use std::io::{self, BufRead, Write};

#[derive(Default)]
struct Recorder { events: Vec<String> }
impl Observer for Recorder {
    fn observe(&mut self, event: Event, clock: &LocalClock) {
        let kind = match event {
            Event::Entered => "enter",
            Event::NextTickWritten => "next_tick_write",
            Event::TickIntervalWritten => "tick_interval_write",
            Event::CallbackEntered => "callback_enter",
            Event::CallbackReturned => "callback_return",
            Event::Returned => "return",
        };
        self.events.push(format!("{{\"kind\":\"{}\",\"next_tick\":\"{:016x}\",\"tick_interval\":\"{:016x}\"}}",kind,clock.next_tick.to_bits(),clock.tick_interval.to_bits()));
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let words: Vec<_> = line.split_whitespace().collect();
        assert_eq!(words.len(), 6);
        let number = |i| f64::from_bits(u64::from_str_radix(words[i],16).expect("binary64 input"));
        let mut clock = LocalClock { next_tick: number(0), tick_interval: number(1) };
        let elapsed = number(2);
        let mode: u32 = words[3].parse().expect("callback mode");
        assert!(mode <= 3);
        let (next_value,interval_value)=(number(4),number(5));
        let mut recorder = Recorder::default();
        let mut callback_count=0;
        clock.update_traced_with(elapsed,&mut recorder,|clock,observer|{
            callback_count+=1;
            if mode & 1 != 0 {
                clock.next_tick=next_value;
                observer.observe(Event::NextTickWritten,clock);
            }
            if mode & 2 != 0 {
                clock.tick_interval=interval_value;
                observer.observe(Event::TickIntervalWritten,clock);
            }
        });
        writeln!(output,"{{\"events\":[{}],\"callback_count\":{}}}",recorder.events.join(","),callback_count)?;
    }
    output.flush()
}
