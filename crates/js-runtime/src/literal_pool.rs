//! Bulk initialization of large string-only array literals. Literal entries have
//! no callbacks or coercions; own data definitions bypass prototype setters.
//! Source UTF-16 units are retained as little-endian static bytes, including lone
//! surrogates. Every execution still allocates one fresh intrinsic Array.
use crate::{Runtime,Value,JsError,JsResult};

impl Runtime {
    pub fn array_from_static_utf16(&mut self, items: &[&[u8]]) -> JsResult<Value> {
        if items.len() > u32::MAX as usize {
            return Err(JsError::RangeError("Invalid array length".into()));
        }
        let array = self.array(&[]);
        for (index, bytes) in items.iter().enumerate() {
            if bytes.len() % 2 != 0 {
                return Err(JsError::Unsupported("Invalid compiler UTF-16 literal bytes".into()));
            }
            let units = bytes.chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            let value = self.string_utf16(&units);
            let key = self.string(&index.to_string());
            self.define_data(array, key, value, true, true, true)?;
        }
        Ok(array)
    }
}
