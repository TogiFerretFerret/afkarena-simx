//! Bounded commit plans for source-proven callback-free numeric regions.
use crate::{Runtime,ObjectId,PropertyKey,Value};
// Reusable bounded transaction for callback-free numeric regions. Reads observe
// earlier staged writes, so aliasing basis/target preserves source loop order.
pub(crate) struct NumericWritePlan<const N:usize>{writes:[Option<(usize,PropertyKey,f64)>;N],len:usize}
impl<const N:usize> NumericWritePlan<N>{
 pub(crate) fn new()->Self{Self{writes:[None;N],len:0}}
 pub(crate) fn read(&self,key:PropertyKey)->Option<f64>{self.writes[..self.len].iter().rev().flatten().find(|(_,k,_)|*k==key).map(|(_,_,v)|*v)}
 pub(crate) fn push(&mut self,slot:usize,key:PropertyKey,value:f64)->bool{if self.len==N{return false}self.writes[self.len]=Some((slot,key,value));self.len+=1;true}
 pub(crate) fn commit(self,rt:&mut Runtime,target:ObjectId){for(slot,key,value)in self.writes.into_iter().flatten(){assert!(rt.objects[target.0].set_existing_data_slot(slot,key,Value::Number(value)),"validated descriptor")}}
}
