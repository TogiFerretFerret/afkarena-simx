//! Ordered live entity-list phase from ed.BattleEngine.tick.
//! Lists and entities use stable identities. Replacing a group field does not replace
//! the list reference already cached by the current iteration.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityId(pub usize);
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ListId(pub usize);

#[derive(Clone, Debug)]
pub struct Record<T> {
    pub frozen: bool,
    pub terminated: bool,
    pub data: T,
}

#[derive(Clone, Copy, Debug)]
pub enum Event {
    BeforeUpdate(EntityId),
    AfterUpdate(EntityId),
    Filtered(usize),
}

#[derive(Clone, Debug)]
pub struct Scheduler<T> {
    pub entities: Vec<Record<T>>,
    pub lists: Vec<Vec<EntityId>>,
    pub groups: Vec<ListId>,
}
impl<T> Default for Scheduler<T> {
    fn default() -> Self { Self { entities: vec![], lists: vec![], groups: vec![] } }
}
impl<T> Scheduler<T> {
    /// Domain: fixed group count/order during this phase; dense lists of valid IDs;
    /// plain boolean flags. Update callbacks may mutate/replace lists and flags.
    /// An update callback can extend execution indefinitely, just as in the JS.
    pub fn run_with<U, O>(&mut self, mut update: U, mut observe: O)
    where U: FnMut(&mut Self, EntityId), O: FnMut(&Self, Event) {
        let group_count = self.groups.len();
        for group in 0..group_count {
            let list = self.groups[group];
            let mut length = self.lists[list.0].len();
            let mut index = 0;
            while index < length {
                let id = self.lists[list.0][index];
                if !self.entities[id.0].frozen {
                    observe(self, Event::BeforeUpdate(id));
                    update(self, id);
                    observe(self, Event::AfterUpdate(id));
                }
                // JS reloads cached i.length after EVERY iteration, even a frozen one.
                length = self.lists[list.0].len();
                index += 1;
            }
            let filtered = self.lists[list.0][..length].iter().copied()
                .filter(|id| !self.entities[id.0].terminated).collect();
            let new_list = ListId(self.lists.len());
            self.lists.push(filtered);
            // Overwrites any group-field replacement performed during the update pass.
            self.groups[group] = new_list;
            observe(self, Event::Filtered(group));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> Record<()> { Record { frozen: false, terminated: false, data: () } }
    #[test]
    fn appended_entities_execute_in_the_same_pass() {
        let mut world = Scheduler { entities: vec![record(), record()], lists: vec![vec![EntityId(0)]], groups: vec![ListId(0)] };
        let mut updates = vec![];
        world.run_with(|world,id| { updates.push(id.0); if id.0==0 { world.lists[0].push(EntityId(1)); } }, |_,_| {});
        assert_eq!(updates, [0,1]);
    }
    #[test]
    fn replacing_group_does_not_replace_cached_list_and_is_overwritten_by_filter() {
        let mut world = Scheduler { entities: vec![record(),record()], lists: vec![vec![EntityId(0)],vec![EntityId(1)]], groups: vec![ListId(0)] };
        let mut updates = vec![];
        world.run_with(|world,id| { updates.push(id.0); world.groups[0]=ListId(1); }, |_,_| {});
        assert_eq!(updates,[0]);
        assert_eq!(world.groups,[ListId(2)]);
        assert_eq!(world.lists[2],[EntityId(0)]);
    }
    #[test]
    fn terminated_entity_still_updates_before_filter_and_removal_preserves_survivor_order() {
        let mut a=record(); a.terminated=true;
        let mut world = Scheduler { entities: vec![a,record()], lists: vec![vec![EntityId(0),EntityId(1)]], groups: vec![ListId(0)] };
        let mut updates=vec![];
        world.run_with(|_,id|updates.push(id.0),|_,_|{});
        assert_eq!(updates,[0,1]);
        assert_eq!(world.lists[world.groups[0].0],[EntityId(1)]);
    }
}
