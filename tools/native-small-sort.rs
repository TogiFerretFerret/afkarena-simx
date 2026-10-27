//! C ABI bridge: callbacks report exceptions as status; Rust never unwinds or
//! permits a VM longjmp across its frames. Tokens reference a C++ GC root array.
#[cfg(not(simx_full_sort))]
#[path="../crates/battle-core/src/v8_small_sort.rs"]mod sorting;
#[cfg(simx_full_sort)]
#[path="../crates/battle-core/src/v8_tim_sort.rs"]mod sorting;
use std::ffi::c_void;
type Compare=unsafe extern "C" fn(*mut c_void,u32,u32,*mut f64)->i32;
#[unsafe(no_mangle)]
pub unsafe extern "C" fn battle_v8_small_sort(tokens:*mut u32,count:usize,context:*mut c_void,compare:Compare)->i32{
 let limit=if cfg!(simx_full_sort){4096}else{63};
 if count>limit{return 2}if tokens.is_null()||context.is_null(){return 3}
 let input=unsafe{std::slice::from_raw_parts(tokens,count)};
 let result=sorting::sort_tokens(input,|a,b|{let mut number=0.0;let status=unsafe{compare(context,a,b,&mut number)};if status==0{Ok(number)}else{Err(status)}});
 match result{Ok(sorted)=>{unsafe{std::ptr::copy_nonoverlapping(sorted.as_ptr(),tokens,count)};0},Err(sorting::SortError::Comparator(_))=>1,
 #[cfg(not(simx_full_sort))]
 Err(sorting::SortError::UnsupportedLength(_))=>2}
}
