//! Content-checked cache of canonical IDs for frequently repeated short names.
//! Entries own their bytes. Caller buffers may be reused or mutated after an
//! intern call; neither pointer identity nor a borrowed lifetime is cached.
use crate::StringId;

const MAX_BYTES:usize=24;
const SLOTS:usize=64;
#[derive(Clone,Copy)]
struct Entry { bytes:[u8;MAX_BYTES],length:u8,id:Option<StringId> }
impl Entry { const EMPTY:Self=Self{bytes:[0;MAX_BYTES],length:0,id:None}; }
pub(crate) struct ShortStrings { entries:[Entry;SLOTS] }
impl Default for ShortStrings {fn default()->Self{Self{entries:[Entry::EMPTY;SLOTS]}}}
impl ShortStrings {
    #[inline]
    fn slot(bytes:&[u8])->usize {
        let length=bytes.len();
        let first=bytes.first().copied().unwrap_or(0)as u32;
        let middle=bytes.get(length/2).copied().unwrap_or(0)as u32;
        let last=bytes.last().copied().unwrap_or(0)as u32;
        let fingerprint=first|(middle<<8)|(last<<16)|((length as u32)<<24);
        (fingerprint.wrapping_mul(0x9e37_79b1)>>26)as usize
    }
    #[inline]
    pub(crate) fn get(&self,text:&str)->Option<StringId>{
        let bytes=text.as_bytes();if bytes.len()>MAX_BYTES{return None}
        let entry=&self.entries[Self::slot(bytes)];
        if entry.length as usize==bytes.len()&&entry.bytes[..bytes.len()]==*bytes{entry.id}else{None}
    }
    #[inline]
    pub(crate) fn remember(&mut self,text:&str,id:StringId){
        let bytes=text.as_bytes();if bytes.len()>MAX_BYTES{return}
        let entry=&mut self.entries[Self::slot(bytes)];entry.bytes[..bytes.len()].copy_from_slice(bytes);entry.length=bytes.len()as u8;entry.id=Some(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_content_comparison_prevents_same_slot_wrong_hits(){
        // All interior characters except the middle are deliberately absent
        // from the slot hint. Exact comparison still distinguishes every name.
        let mut cache=ShortStrings::default();
        let a="aaaxaaa";let b="abaxaaa";
        assert_eq!(ShortStrings::slot(a.as_bytes()),ShortStrings::slot(b.as_bytes()));
        cache.remember(a,StringId(3));assert_eq!(cache.get(a),Some(StringId(3)));assert_eq!(cache.get(b),None);
        cache.remember(b,StringId(4));assert_eq!(cache.get(a),None);assert_eq!(cache.get(b),Some(StringId(4)));
    }
}
