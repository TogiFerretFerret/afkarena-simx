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
