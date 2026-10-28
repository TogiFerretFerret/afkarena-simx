# Combined own-property candidates

The isolated combined candidate enables guarded dynamic own-data physical slot
hints and direct writable ordinary own-data Set. Each retains its runtime switch.

The combined runtime passes 55 library tests, 26 integration tests, and pinned
Node source comparisons covering 36 dynamic-slot, 40 coercion, 24 reflection and
40 arguments cases. Reports retain complete input hashes and raw-bit outputs in
`benchmarks/validation/rust-own-wave-combined*.json`.

The dynamic read candidate previously improved the unchanged source Buff
attribute fixture by 1.193x. The writable Set candidate's longer 10,000-update
paired run measured 0.981x with substantial variation, so its earlier short
1.109x result does not establish a repeatable speed improvement. Neither number
qualifies complete battle throughput. Full-workload comparison remains required.

The next combined source adds primary small numeric Array storage and canonical
ID hashing for mapped argument bindings. With all three candidate switches on,
59 library and 26 integration tests pass, including 23 real source-guarded GC
safepoints with raw numeric bits and dead object-ID reuse. The generated Array
gate passes 70 OFF/ON observations, and 40 argument source cases pass.
See `rust-own-primary-combined*.json` for exact runtime hashes and reports.

Broader source gates on that same frozen runtime also pass: 20,000 typed-array
cases, 40 coercion, 24 reflection, 14 Array constructor, 22 Array.from and 34 JSON
cases. `rust-own-primary-broad*.json` retains reports with separate immutable
output, input and harness archives, verified against their hashes.
