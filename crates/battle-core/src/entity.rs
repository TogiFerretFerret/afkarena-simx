//! Source-mapped ed.Entity.update for Number-valued plain vec2 arrays.
//! Stable handles preserve aliases between position and velocity, including across entities.
//! See config/entity-translation.json for the translation boundary and provenance.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Vec2Id(usize);
impl Vec2Id {
    pub fn index(self) -> usize { self.0 }
}

#[derive(Clone, Debug, Default)]
pub struct Vec2Arena {
    values: Vec<[f64; 2]>,
}
impl Vec2Arena {
    pub fn insert(&mut self, value: [f64; 2]) -> Vec2Id {
        let id = Vec2Id(self.values.len());
        self.values.push(value);
        id
    }
    #[inline]
    pub fn get(&self, id: Vec2Id) -> &[f64; 2] { &self.values[id.0] }
    #[inline]
    fn set_component(&mut self, id: Vec2Id, component: usize, value: f64) {
        self.values[id.0][component] = value;
    }
    pub fn values(&self) -> &[[f64; 2]] { &self.values }
}

#[derive(Clone, Debug)]
pub struct Entity {
    pub position: Vec2Id,
    pub velocity: Vec2Id,
    pub direction: f64,
}

#[derive(Clone, Copy, Debug)]
pub enum Event {
    Entered,
    PositionXWritten,
    PositionYWritten,
    DirectionWritten,
    Returned,
}

/// Observers inspect state without mutating it or reentering the update.
pub trait Observer {
    fn observe(&mut self, event: Event, arena: &Vec2Arena, entity: &Entity);
}
struct NoopObserver;
impl Observer for NoopObserver {
    #[inline(always)]
    fn observe(&mut self, _: Event, _: &Vec2Arena, _: &Entity) {}
}

impl Entity {
    #[inline]
    pub fn update(&mut self, arena: &mut Vec2Arena, dt: f64) {
        self.update_with(arena, dt, &mut NoopObserver);
    }

    #[inline]
    pub fn update_with<O: Observer>(&mut self, arena: &mut Vec2Arena, dt: f64, observer: &mut O) {
        observer.observe(Event::Entered, arena, self);
        // JS var t=this.position,a=this.velocity captures references, not vector copies.
        let position = self.position;
        let velocity = self.velocity;
        let old_x = arena.get(position)[0];
        let delta_x = arena.get(velocity)[0] * dt;
        arena.set_component(position, 0, old_x + delta_x);
        observer.observe(Event::PositionXWritten, arena, self);
        let old_y = arena.get(position)[1];
        let delta_y = arena.get(velocity)[1] * dt;
        arena.set_component(position, 1, old_y + delta_y);
        observer.observe(Event::PositionYWritten, arena, self);
        // Reload velocity after the writes: it may alias position.
        if arena.get(velocity)[0] * self.direction < 0.0 {
            self.direction = -self.direction;
            observer.observe(Event::DirectionWritten, arena, self);
        }
        observer.observe(Event::Returned, arena, self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliased_velocity_observes_the_position_write_before_direction_test() {
        let mut arena = Vec2Arena::default();
        let shared = arena.insert([2.0, 3.0]);
        let mut entity = Entity { position: shared, velocity: shared, direction: -1.0 };
        entity.update(&mut arena, 0.5);
        assert_eq!(*arena.get(shared), [3.0, 4.5]);
        assert_eq!(entity.direction, 1.0);
    }

    #[test]
    fn updated_alias_can_reverse_the_branch_decision() {
        let mut arena = Vec2Arena::default();
        let shared = arena.insert([2.0, 3.0]);
        let mut entity = Entity { position: shared, velocity: shared, direction: 1.0 };
        entity.update(&mut arena, -2.0);
        assert_eq!(*arena.get(shared), [-2.0, -3.0]);
        assert_eq!(entity.direction, -1.0);
    }
}
