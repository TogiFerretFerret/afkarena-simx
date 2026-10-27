//! Exact local-clock control flow from ed.BattleEngine.updateLocalBattleEngine.
//! A late update invokes tick once, then advances next_tick through repeated additions.
//! Replacing the additions with ceil/division changes rounding and is not assumed valid.

#[derive(Clone, Copy, Debug)]
pub struct LocalClock {
    pub next_tick: f64,
    pub tick_interval: f64,
}
impl Default for LocalClock {
    fn default() -> Self { Self { next_tick: 0.0, tick_interval: 1.0 / 8.0 } }
}
impl LocalClock {
    /// As in the source, inputs/callbacks that keep next_tick <= 0 indefinitely do
    /// not terminate. Battle setup supplies a positive tick interval.
    #[inline]
    pub fn update_with<F: FnMut(&mut Self)>(&mut self, elapsed: f64, mut tick: F) {
        self.next_tick -= elapsed;
        if self.next_tick <= 0.0 {
            tick(self);
            while self.next_tick <= 0.0 { self.next_tick += self.tick_interval; }
        }
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
