//! Guarded specialization of the exact emitted table-loader source. This is
//! deliberately not Rust UTF-8 decoding: the source accepts malformed sequences
//! and only rejects a truncated sequence, with its own UTF-16 bit operations.
use crate::{Runtime,Value,EnvId,ObjectKind,JsError,JsResult};
use crate::binary::TypedArrayKind;

fn source_units(bytes:&[u8])->Result<Vec<u16>,()> {
 let mut out=Vec::with_capacity(bytes.len());let mut i=0;
 while i<bytes.len(){let a=bytes[i]as i32;i+=1;let code;
  if a<128{code=a;}
  else if a>=194&&a<224{if i>=bytes.len(){return Err(())}code=((a&31)<<6)|(bytes[i]as i32&63);i+=1;}
  else if a<240{if i+1>=bytes.len(){return Err(())}code=((a&15)<<12)|((bytes[i]as i32&63)<<6)|(bytes[i+1]as i32&63);i+=2;}
  else{if i+2>=bytes.len(){return Err(())}let high=((a&7)<<18)|((bytes[i]as i32&63)<<12)|((bytes[i+1]as i32&63)<<6)|(bytes[i+2]as i32&63);i+=3;let adjusted=high-65536;out.push((55296+(adjusted>>10))as u16);code=56320+(adjusted&1023);}
  out.push(code as u16);
 }
 Ok(out)
}

impl Runtime {
 pub fn try_native_decode_utf8(&mut self,bytes:Value,parent:EnvId)->JsResult<Option<Value>>{
  if !self.utf8_loader_intrinsics_intact(bytes,parent){return Ok(None)}
  let id=self.object_id(bytes)?;
  let ObjectKind::TypedArray{buffer,byte_offset,length,kind:TypedArrayKind::Uint8}=self.objects[id.0].kind else{return Ok(None)};
  let decoded=source_units(&self.buffers[buffer.0].bytes[byte_offset..byte_offset+length]);
  match decoded{
   Ok(units)=>Ok(Some(self.string_utf16(&units))),
   Err(())=>{let constructor=self.lookup(parent,"Error")?;let message=self.string("Truncated UTF8");let error=self.construct(constructor,&[message])?;Err(JsError::Throw(error))}
  }
 }
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn preserves_permissive_source_bit_operations(){
  assert_eq!(source_units(b"hello\0"),Ok(vec![104,101,108,108,111,0]));
  assert_eq!(source_units(&[0xc2,0x41]),Ok(vec![0x81]));
  assert_eq!(source_units(&[0x80,0x80,0x80]),Ok(vec![0]));
  assert_eq!(source_units(&[0xed,0xa0,0x80]),Ok(vec![0xd800]));
  assert_eq!(source_units(&[0xf0,0x80,0x80,0x80]),Ok(vec![0xd7c0,0xdc00]));
  assert_eq!(source_units(&[0xf0,0x9f,0x98,0x80]),Ok(vec![0xd83d,0xde00]));
  for bytes in [&[0xc2][..],&[0xe0][..],&[0xe0,0x80][..],&[0xff,0x80,0x80][..]]{assert_eq!(source_units(bytes),Err(()));}
 }
}
