//! Paired component diagnostic. Reference is the former primitive Number path.
use js_runtime::{Runtime,Value};
use std::alloc::{GlobalAlloc,Layout,System};
use std::sync::atomic::{AtomicU64,Ordering};
struct Count;static ALLOCS:AtomicU64=AtomicU64::new(0);
unsafe impl GlobalAlloc for Count {unsafe fn alloc(&self,l:Layout)->*mut u8 {ALLOCS.fetch_add(1,Ordering::Relaxed);unsafe{System.alloc(l)}}unsafe fn dealloc(&self,p:*mut u8,l:Layout){unsafe{System.dealloc(p,l)}}unsafe fn realloc(&self,p:*mut u8,l:Layout,n:usize)->*mut u8{ALLOCS.fetch_add(1,Ordering::Relaxed);unsafe{System.realloc(p,l,n)}}}
#[global_allocator]static A:Count=Count;
fn main(){let values=[0.0,-0.0,1.0,2.0,10.0,255.0,65535.0,4294967294.0,0.1,-1.5,1e-7,1e21,f64::MIN_POSITIVE,f64::MAX,f64::from_bits(1),f64::NAN,f64::INFINITY,f64::NEG_INFINITY];
for round in 0..2 {for step in 0..2 {let stack=(step+round)%2==1;let mut rt=Runtime::new();for n in values{rt.to_string(Value::Number(n)).unwrap();}let before=ALLOCS.load(Ordering::Relaxed);let start=std::time::Instant::now();let mut checksum=0usize;for i in 0..1_000_000 {let n=std::hint::black_box(values[i%values.len()]);let id=if stack {rt.to_string(Value::Number(n)).unwrap()}else{let mut b=ryu_js::Buffer::new();rt.intern_utf16(&b.format(n).encode_utf16().collect::<Vec<_>>())};checksum=checksum.wrapping_add(std::hint::black_box(id.0));}let elapsed=start.elapsed().as_nanos();let allocations=ALLOCS.load(Ordering::Relaxed)-before;println!("{{\"round\":{round},\"stack\":{stack},\"calls\":1000000,\"elapsedNs\":{elapsed},\"allocations\":{allocations},\"checksum\":{checksum}}}");}}}
