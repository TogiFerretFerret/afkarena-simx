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
        // Odd multiplication is a permutation of the full u64 domain. Sequential
        // IDs spread over bucket bits and upper control fingerprints in one mul.
        // Full key equality remains authoritative; this affects lookup cost only.
        self.0 = (id as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
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

#[cfg(test)]mod fibonacci_contract_tests{
 use super::*;use std::collections::{HashMap,HashSet};
 #[test]fn sequential_extreme_and_strided_keys_remain_distinct_and_lookup_exact(){let mut fingerprints=[0usize;128];let mut hashes=HashSet::new();for id in 0..16_384usize{let mut hash=IdHasher::default();hash.write_usize(id);assert!(hashes.insert(hash.finish()));fingerprints[(hash.finish()>>57)as usize]+=1;}assert!(fingerprints.iter().all(|count|*count>=120&&*count<=136));for stride in[1usize,16,64,1024]{let mut actual=HashMap::<usize,u64,IdBuildHasher>::default();let mut expected=HashMap::new();for n in 0..512usize{let key=n.wrapping_mul(stride);assert_eq!(actual.insert(key,n as u64),expected.insert(key,n as u64));}for n in(0..512usize).step_by(3){let key=n.wrapping_mul(stride);assert_eq!(actual.remove(&key),expected.remove(&key));}for n in 0..512usize{let key=n.wrapping_mul(stride);assert_eq!(actual.get(&key),expected.get(&key));}for key in[usize::MAX,usize::MAX-1,1usize<<(usize::BITS-1)]{assert_eq!(actual.insert(key,u64::MAX),expected.insert(key,u64::MAX));assert_eq!(actual.get(&key),expected.get(&key));}}}
 #[test]fn compound_byte_write_contract_is_unchanged(){let mut split=IdHasher::default();split.write_usize(17);split.write(b"ab");split.write(b"cd");let mut whole=IdHasher::default();whole.write_usize(17);whole.write(b"abcd");assert_eq!(split.finish(),whole.finish());let mut reference=(17u64).wrapping_mul(0x9e3779b97f4a7c15);for byte in b"abcd"{reference=(reference^u64::from(*byte)).wrapping_mul(0x100000001b3);}assert_eq!(whole.finish(),reference);let mut tuples=HashMap::<(usize,usize),u64,IdBuildHasher>::default();let mut expected=HashMap::new();for first in 0..128usize{for last in 0..8usize{assert_eq!(tuples.insert((first,last),first as u64),expected.insert((first,last),first as u64));}}for(key,value)in expected{assert_eq!(tuples.get(&key),Some(&value));}}
}
