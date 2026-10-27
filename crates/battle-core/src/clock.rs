//! Exact local-clock control flow from ed.BattleEngine.updateLocalBattleEngine.
//! A late update invokes tick once, then advances next_tick through repeated additions.
//! Replacing the additions with ceil/division changes rounding and is not assumed valid.

#[derive(Clone, Copy, Debug)]
pub struct LocalClock {
    pub next_tick: f64,
    pub tick_interval: f64,
}
#[derive(Clone, Copy, Debug)]
pub enum Event {
    Entered,
    NextTickWritten,
    TickIntervalWritten,
    CallbackEntered,
    CallbackReturned,
    Returned,
}
pub trait Observer {
    fn observe(&mut self, event: Event, clock: &LocalClock);
}
struct NoopObserver;
impl Observer for NoopObserver {
    #[inline(always)]
    fn observe(&mut self, _: Event, _: &LocalClock) {}
}
impl Default for LocalClock {
    fn default() -> Self { Self { next_tick: 0.0, tick_interval: 1.0 / 8.0 } }
}
impl LocalClock {
    /// As in the source, inputs/callbacks that keep next_tick <= 0 indefinitely do
    /// not terminate. Battle setup supplies a positive tick interval.
    #[inline]
    pub fn update_with<F: FnMut(&mut Self)>(&mut self, elapsed: f64, mut tick: F) {
        self.update_traced_with(elapsed, &mut NoopObserver, |clock, _| tick(clock));
    }

    /// Trace observers are nonthrowing and do not mutate the clock. A traced
    /// callback emits write events for its own field mutations.
    #[inline]
    pub fn update_traced_with<O: Observer, F: FnMut(&mut Self, &mut O)>(&mut self, elapsed: f64, observer: &mut O, mut tick: F) {
        observer.observe(Event::Entered, self);
        self.next_tick -= elapsed;
        observer.observe(Event::NextTickWritten, self);
        if self.next_tick <= 0.0 {
            observer.observe(Event::CallbackEntered, self);
            tick(self, observer);
            observer.observe(Event::CallbackReturned, self);
            while self.next_tick <= 0.0 {
                self.next_tick += self.tick_interval;
                observer.observe(Event::NextTickWritten, self);
            }
        }
        observer.observe(Event::Returned, self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_elapsed_calls_tick_once_then_advances_clock_repeatedly() {
        let mut clock=LocalClock::default();let mut ticks=0;
        clock.update_with(1.0, |_|ticks+=1);
        assert_eq!(ticks,1);
        assert_eq!(clock.next_tick.to_bits(),0.125_f64.to_bits());
    }
    #[test]
    fn callback_clock_mutation_is_visible_to_the_following_loop() {
        let mut clock=LocalClock::default();
        clock.update_with(0.5, |clock|{clock.next_tick=-0.2;clock.tick_interval=0.1;});
        assert_eq!(clock.next_tick.to_bits(),0.1_f64.to_bits());
    }
    #[test]
    fn nan_does_not_enter_the_tick_branch() {
        let mut clock=LocalClock::default();
        clock.update_with(f64::NAN, |_|panic!("source would not call tick"));
        assert!(clock.next_tick.is_nan());
    }
}
