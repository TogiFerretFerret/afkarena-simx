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

impl Runtime {
    /// The address is only a lookup hint for a `'static` literal. The stored ID
    /// always comes from the canonical content interner on its first encounter.
    /// Encoding tags prevent UTF-8 and UTF-16 constants from sharing a key.
    pub fn static_identifier_id(&mut self,text:&'static str)->crate::StringId{match self.static_string(text){Value::String(id)=>id,_=>unreachable!("static literals are strings")}}
    pub fn static_string(&mut self, text: &'static str) -> Value {
        let key = (0, text.as_ptr() as usize, text.len());
        let id = match self.static_literal_strings.get(&key).copied() {
            Some(id) => id,
            None => {
                let id = self.intern(text);
                self.static_literal_strings.insert(key, id);
                id
            }
        };
        Value::String(id)
    }

    pub fn static_string_utf16(&mut self, units: &'static [u16]) -> Value {
        let key = (1, units.as_ptr() as usize, units.len());
        let id = match self.static_literal_strings.get(&key).copied() {
            Some(id) => id,
            None => {
                let id = self.intern_utf16(units);
                self.static_literal_strings.insert(key, id);
                id
            }
        };
        Value::String(id)
    }
}
