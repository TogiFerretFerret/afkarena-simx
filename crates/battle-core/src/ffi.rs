//! Narrow C boundary for the source-validated immutable attribute kernel.
//! This is bridge infrastructure, not a complete native battle implementation.
use crate::config::{self,AttributeObserver,Attributes,Contributions,Formula,GROUP_COUNT};
use std::{ffi::c_void,ptr,slice};

#[repr(C)]
#[derive(Clone,Copy)]
pub struct AttributeRows { pub rows:*const Attributes,pub count:usize }
pub type RecordFormula=unsafe extern "C" fn(*mut c_void,usize,*const f64,f64);
pub type FinishStatic=unsafe extern "C" fn(*mut c_void,*const f64);
struct Observer{context:*mut c_void,record:RecordFormula,finish:FinishStatic}
impl AttributeObserver for Observer{
 fn record_formula(&mut self,attribute:usize,formula:Formula,value:f64){
  let values=formula.values();
  // The observer may read these temporary arrays only for this call's duration.
  unsafe{(self.record)(self.context,attribute,values.as_ptr(),value)}
 }
 fn finish_static(&mut self,values:&Attributes){unsafe{(self.finish)(self.context,values.as_ptr())}}
}

/// Returns 0 on success, 1 for missing pointers/callbacks, 2 for invalid row
/// alignment/count, 3 for a non-reference floating-point environment.
/// Validation precedes all observers and output writes.
///
/// # Safety
/// `groups` points to ten readable descriptors; each nonempty descriptor points
/// to `count` initialized 47-double rows. `output` points to 47 writable doubles.
/// All buffers remain valid, and input rows remain immutable through both
/// callbacks. Output does not overlap inputs. Callbacks must return normally,
/// must not unwind, and must not retain temporary formula/value pointers.
/// No global state is shared: independent calls may execute concurrently.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn battle_calculate_attributes(
 groups:*const AttributeRows,output:*mut f64,context:*mut c_void,
 record:Option<RecordFormula>,finish:Option<FinishStatic>,
)->i32{
 let (Some(record),Some(finish))=(record,finish)else{return 1};
 if groups.is_null()||output.is_null(){return 1}
 if !groups.is_aligned()||!output.is_aligned(){return 2}
 if !crate::js_math::reference_fp_environment(){return 3}
 let descriptors=unsafe{slice::from_raw_parts(groups,GROUP_COUNT)};
 // Validate all groups before building any Rust slice or invoking user code.
 for group in descriptors{
  if group.count>isize::MAX as usize/size_of::<Attributes>(){return 2}
  if group.count!=0&&(group.rows.is_null()||!group.rows.is_aligned()){return 2}
 }
 let mut rows:[&[Attributes];GROUP_COUNT]=[&[];GROUP_COUNT];
 for (index,group) in descriptors.iter().enumerate(){
  if group.count!=0{rows[index]=unsafe{slice::from_raw_parts(group.rows,group.count)}}
 }
 let values=config::calculate_attributes_with(&Contributions{groups:rows},&mut Observer{context,record,finish});
 unsafe{ptr::copy_nonoverlapping(values.as_ptr(),output,values.len())};
 0
}
