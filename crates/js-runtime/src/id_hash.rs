//! Hashing for internal, canonical integer IDs. JS enumeration order belongs to
//! the heap's ordered property vector, never to this lookup-only table.
use std::hash::{BuildHasherDefault, Hasher};

pub type IdBuildHasher = BuildHasherDefault<IdHasher>;

#[derive(Default)]
pub struct IdHasher(u64);

impl Hasher for IdHasher {
    #[inline]
    fn finish(&self) -> u64 { self.0 }

    #[inline]
    fn write_usize(&mut self, id: usize) {
        // A bijective mixer distributes consecutive interned IDs across both
        // hashbrown's bucket bits and its upper-seven-bit control fingerprints.
        let mut value = (id as u64).wrapping_add(0x9e37_79b9_7f4a_7c15);
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        self.0 = value ^ (value >> 31);
    }

    fn write(&mut self, bytes: &[u8]) {
        // Keep the Hasher contract usable for compound callers, although this
        // table's PropertyKey(StringId(usize)) always uses write_usize once.
        for &byte in bytes { self.0 = (self.0 ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[test]
    fn integer_lookup_matches_standard_table_after_replacements_and_deletes() {
        let mut optimized = HashMap::<usize, u64, IdBuildHasher>::default();
        let mut reference = HashMap::new();
        let mut state = 0x7a4d_23b8_51e6_0901u64;
        for step in 0..100_000u64 {
            state ^= state << 13; state ^= state >> 7; state ^= state << 17;
            let key = (state as usize) & 4095;
            match state >> 62 {
                0 => assert_eq!(optimized.remove(&key), reference.remove(&key)),
                1 => assert_eq!(optimized.get(&key), reference.get(&key)),
                _ => assert_eq!(optimized.insert(key, step), reference.insert(key, step)),
            }
        }
        assert_eq!(optimized.len(), reference.len());
        for (key, value) in reference { assert_eq!(optimized.get(&key), Some(&value)); }
    }
}
