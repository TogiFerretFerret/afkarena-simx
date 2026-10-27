//! Exact comparison schedule of pinned V8 13.6.233.17 ArrayTimSortImpl
//! for private dense, non-undefined work arrays with length <= 63.
//!
//! Source: third_party/v8/builtins/array-sort.tq, SHA-256
//! 2ac3d8fc187e4f5096afb153d018390e2b250cde3e36badafe89da3faeebe55e.
//! This translates CountAndMakeRun and BinaryInsertionSort, not a generic
//! stable-sort substitute. Receiver property access, undefined compaction,
//! ToNumber, comparator invocation, and writeback belong to the VM adapter.
//!
//! Original algorithm copyright (c) 2001–2018 Python Software Foundation;
//! all rights reserved. V8 implementation is based on CPython's TimSort.

/// Unsupported lengths fail before allocating or calling the comparator.
#[derive(Debug, PartialEq, Eq)]
pub enum SortError<E> { UnsupportedLength(usize), Comparator(E) }

/// Sort identity tokens in private work storage. The required comparator is
/// called with precisely V8's argument order; NaN behaves as +0, as in
/// SortCompareUserFn. Errors stop immediately and leave the input untouched.
/// There is deliberately no fallback to another sorting algorithm.
pub fn sort_tokens<E>(input: &[u32], mut compare: impl FnMut(u32, u32) -> Result<f64, E>) -> Result<Vec<u32>, SortError<E>> {
    if input.len() >= 64 { return Err(SortError::UnsupportedLength(input.len())); }
    let mut work = input.to_vec();
    if work.len() < 2 { return Ok(work); }
    let mut order = compare(work[1], work[0]).map_err(SortError::Comparator)?;
    let descending = order < 0.0;
    let mut run_length = 2;
    let mut previous = work[1];
    for index in 2..work.len() {
        let current = work[index];
        order = compare(current, previous).map_err(SortError::Comparator)?;
        // V8 normalizes comparator NaN to +0 before this branch. Testing
        // !(order < 0) rather than order >= 0 retains that normalization.
        if (descending && !(order < 0.0)) || (!descending && order < 0.0) { break; }
        previous = current;
        run_length += 1;
    }
    if descending { work[..run_length].reverse(); }
    // ComputeMinRunLength(n)==n for every accepted length. The sole run is
    // extended to the full length; MergeCollapse/ForceCollapse call no compares.
    for start in run_length..work.len() {
        let pivot = work[start];
        let (mut left, mut right) = (0, start);
        while left < right {
            let middle = left + ((right-left) >> 1);
            order = compare(pivot, work[middle]).map_err(SortError::Comparator)?;
            if order < 0.0 { right = middle; } else { left = middle+1; }
        }
        work.copy_within(left..start, left+1);
        work[left] = pivot;
    }
    Ok(work)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_large_input_without_comparison() {
        let result=sort_tokens(&[0;64],|_,_| -> Result<f64,()> {panic!("must not compare")});
        assert_eq!(result,Err(SortError::UnsupportedLength(64)));
    }
    #[test]
    fn nan_terminates_descending_run_like_positive_zero() {
        let mut calls=Vec::new();
        let sorted=sort_tokens(&[0,1,2],|a,b| -> Result<f64,()> {calls.push((a,b));Ok(if calls.len()==1 {-1.0}else{f64::NAN})}).unwrap();
        assert_eq!(calls,[(1,0),(2,1),(2,0)]);
        assert_eq!(sorted,[1,0,2]);
    }
    #[test]
    fn exceptions_preserve_input_and_stop_calls() {
        let input=[0,1,2];let mut calls=0;
        let result=sort_tokens(&input,|_,_|{calls+=1;Err::<f64,_>(17)});
        assert_eq!(result,Err(SortError::Comparator(17)));assert_eq!(input,[0,1,2]);assert_eq!(calls,1);
    }
}
