//! Isolated immutable IR candidate for the pinned skill range parser.
//! VM admission/materialization is deliberately external; this is not enabled.
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeOp { pub mode_token: usize, pub lower: u32, pub upper: u32 }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseIr { pub modes: Vec<usize>, pub ranges: Vec<RangeOp> }

fn decimal(token: &str) -> Option<u32> {
    if token.is_empty() || token.len() > 9 || !token.bytes().all(|c| c.is_ascii_digit()) { return None; }
    Some(token.bytes().fold(0, |n, c| n * 10 + u32::from(c - b'0')))
}
fn mode(token: &str) -> bool {
    !token.is_empty() && token.bytes().all(|c| c.is_ascii_lowercase() || c == b'_')
}
/// Returns no IR for coercing/ambiguous/warning paths. No VM reads or effects.
/// Prototype collisions and intrinsic identity are separate mandatory VM guards.
pub fn parse(tokens: &[String]) -> Option<ParseIr> {
    if tokens.is_empty() || tokens.len() > 512 { return None; }
    let mut ir = ParseIr { modes: Vec::new(), ranges: Vec::new() };
    let mut i = 0;
    while i < tokens.len() {
        if !mode(&tokens[i]) { return None; }
        let index = i;
        ir.modes.push(index);
        i += 1;
        let first = ir.ranges.len();
        while i < tokens.len() && decimal(&tokens[i]).is_some() {
            let lower = decimal(&tokens[i])?;
            let upper = decimal(tokens.get(i + 1)?)?;
            ir.ranges.push(RangeOp { mode_token: index, lower, upper });
            i += 2;
        }
        if first == ir.ranges.len() { return None; }
    }
    Some(ir)
}

/// Private bounded cache; callers borrow immutable IR, never a shared JS result.
pub struct Cache { entries: VecDeque<(Vec<String>, ParseIr)>, pub hits: usize, pub misses: usize }
impl Cache {
    pub fn new() -> Self { Self { entries: VecDeque::new(), hits: 0, misses: 0 } }
    pub fn lookup(&mut self, tokens: &[String]) -> Option<&ParseIr> {
        if let Some(index) = self.entries.iter().position(|(key, _)| key == tokens) {
            self.hits += 1;
            return Some(&self.entries[index].1);
        }
        self.misses += 1;
        let ir = parse(tokens)?;
        if self.entries.len() == 64 { self.entries.pop_front(); }
        self.entries.push_back((tokens.to_vec(), ir));
        Some(&self.entries.back().unwrap().1)
    }
}
