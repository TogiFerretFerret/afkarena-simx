//! Exact decimal native index conversion. Never passes usize through f64.
use crate::{Runtime,StringId};
impl Runtime {
 pub(crate) fn intern_usize_decimal(&mut self,mut index:usize)->StringId{
  // A positive binary integer has no more decimal digits than binary bits.
  // One final digit also handles zero, with no sign or leading zeroes.
  let mut units=[0u16;usize::BITS as usize];let mut start=units.len();
  loop{start-=1;units[start]=48+(index%10)as u16;index/=10;if index==0{break}}
  self.intern_utf16(&units[start..])
 }
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn full_usize_decimal_spelling_matches_display_and_canonical_identity(){let mut rt=Runtime::new();for index in[0,1,9,10,99,100,255,256,257,65535,4294967294,4294967295,usize::MAX]{let text=index.to_string();let expected=rt.intern(&text);assert_eq!(rt.intern_usize_decimal(index),expected);let actual=rt.intern_usize_decimal(index);assert_eq!(rt.string_text(actual),text);}if usize::BITS>53{for index in[(1usize<<53)-1,1usize<<53,(1usize<<53)+1]{let id=rt.intern_usize_decimal(index);assert_eq!(rt.string_text(id),index.to_string());}}}
}
