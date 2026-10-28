# Isolated array property-storage reservation candidate

This candidate reserves physical property-vector and key-index capacity for the
known number of present elements before Runtime.array's existing insert loop.
It preserves holes (no physical None slots), keys, ordering, descriptors and raw
numeric bits. No callback is added or moved. It does not reserve storage for
holes or array length, and it does not allocate dense storage for sparse inputs.

When both retained capacities already cover the dense input length, it skips
the counting pass entirely. Otherwise it scans Some elements and reserves only
that count. Pooled objects already retain buffers, so benefit may be limited to
first-touch construction; sparse pooled inputs can still incur a counting pass.
The candidate must be measured rather than assumed faster.

Source is isolated atop frozen3f7bd22. A default-true runtime switch enables
same-binary OFF/ON comparisons. Light jobs=1 tests pass dense, sparse, all-hole,
max capacity patterns, exact NaN/-0 bits, own-key order and23 collection rounds.
Actual allocation/timing proof and original Unit.update A/B are prepared but
will wait for the live full build and real benchmark slots to finish. No main
runtime edits or speedup claim are made.
