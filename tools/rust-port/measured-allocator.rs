// Diagnostic wrapper only. Counts requested bytes, not resident memory or peak
// live bytes. Counting is enabled after the first wallNow and disabled before
// the second, so source loading, warmups, reporting and teardown are excluded.
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
struct MeasuredAllocator;
#[global_allocator]
static ALLOCATOR: MeasuredAllocator = MeasuredAllocator;
static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCS: AtomicU64 = AtomicU64::new(0);
static ALLOC_BYTES: AtomicU64 = AtomicU64::new(0);
static DEALLOCS: AtomicU64 = AtomicU64::new(0);
static DEALLOC_BYTES: AtomicU64 = AtomicU64::new(0);
static REALLOCS: AtomicU64 = AtomicU64::new(0);
static REALLOC_OLD_BYTES: AtomicU64 = AtomicU64::new(0);
static REALLOC_NEW_BYTES: AtomicU64 = AtomicU64::new(0);
unsafe impl GlobalAlloc for MeasuredAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() && COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
            ALLOC_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        }
        pointer
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc_zeroed(layout) };
        if !pointer.is_null() && COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
            ALLOC_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        if COUNTING.load(Ordering::Relaxed) {
            DEALLOCS.fetch_add(1, Ordering::Relaxed);
            DEALLOC_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        }
        unsafe { System.dealloc(pointer, layout) }
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(pointer, layout, size) };
        if !result.is_null() && COUNTING.load(Ordering::Relaxed) {
            REALLOCS.fetch_add(1, Ordering::Relaxed);
            REALLOC_OLD_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
            REALLOC_NEW_BYTES.fetch_add(size as u64, Ordering::Relaxed);
        }
        result
    }
}
fn allocation_boundary(ordinal: u32) {
    if ordinal == 0 {
        COUNTING.store(true, Ordering::Relaxed);
    } else {
        COUNTING.store(false, Ordering::Relaxed);
        eprintln!("MEASURED_ALLOCATIONS:{{\"allocations\":{},\"allocatedBytes\":{},\"deallocations\":{},\"deallocatedBytes\":{},\"reallocations\":{},\"reallocatedOldBytes\":{},\"reallocatedNewBytes\":{}}}",
            ALLOCS.load(Ordering::Relaxed), ALLOC_BYTES.load(Ordering::Relaxed),
            DEALLOCS.load(Ordering::Relaxed), DEALLOC_BYTES.load(Ordering::Relaxed),
            REALLOCS.load(Ordering::Relaxed), REALLOC_OLD_BYTES.load(Ordering::Relaxed),
            REALLOC_NEW_BYTES.load(Ordering::Relaxed));
    }
}
