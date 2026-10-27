//! Numeric RNG semantics for ed.srand, ed.rand and ed.randDontChangeSeed.
//! See config/rng-translation.json for the supported execution domain.

const MULTIPLIER: f64 = 25.0;
const MODULUS: f64 = 34359738337.0; // Math.pow(2, 35) - 31; exactly representable.

#[derive(Clone, Copy, Debug)]
pub struct Snapshot {
    pub state: f64,
    pub initial_seed: Option<f64>,
}

#[derive(Clone, Copy, Debug)]
pub enum Event {
    InvalidSeed,
    Seeded(f64),
    Random(f64),
}

/// Nonthrowing, nonreentrant observer; JS string rendering is outside this adapter.
pub trait Observer {
    fn observe(&mut self, event: Event, snapshot: Snapshot);
}

pub struct NoopObserver;
impl Observer for NoopObserver {
    #[inline(always)]
    fn observe(&mut self, _: Event, _: Snapshot) {}
}

#[derive(Clone, Debug)]
pub struct BattleRng {
    state: f64,
    initial_seed: Option<f64>,
}

impl Default for BattleRng {
    fn default() -> Self { Self { state: 1.0, initial_seed: None } }
}

impl BattleRng {
    #[inline]
    pub fn snapshot(&self) -> Snapshot {
        Snapshot { state: self.state, initial_seed: self.initial_seed }
    }

    #[inline]
    pub fn seed(&mut self, input: f64) { self.seed_with(input, &mut NoopObserver); }

    #[inline]
    pub fn seed_with<O: Observer>(&mut self, input: f64, observer: &mut O) {
        // ed.init_battle_seed is set before the guard and both callbacks.
        self.initial_seed = Some(input);
        let mut seed = input;
        // Number truthiness: NaN, +0 and -0 are false; infinities are true.
        if seed == 0.0 || seed.is_nan() {
            observer.observe(Event::InvalidSeed, self.snapshot());
            seed = 1.0;
        }
        let seed = ((MODULUS - seed) / seed).floor();
        // The original invokes its log BEFORE assigning random_seed.
        observer.observe(Event::Seeded(seed), self.snapshot());
        self.state = seed;
    }

    #[inline]
    pub fn peek(&self) -> f64 { (self.state * MULTIPLIER % MODULUS) / MODULUS }

    #[inline]
    pub fn next_f64(&mut self) -> f64 { self.next_with(&mut NoopObserver) }

    #[inline]
    pub fn next_with<O: Observer>(&mut self, observer: &mut O) -> f64 {
        let state = self.state * MULTIPLIER % MODULUS;
        let result = state / MODULUS;
        // ed.rand assigns random_seed BEFORE logging.
        self.state = state;
        observer.observe(Event::Random(result), self.snapshot());
        result
    }
}
