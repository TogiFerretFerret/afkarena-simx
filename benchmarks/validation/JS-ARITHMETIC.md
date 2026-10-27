The 348 adversarial damage mismatches came from the final compound addition in
`ed.fixProbability`: the left operand carried a positive NaN while `Math.min`
returned a negative NaN. The pinned source selected the right payload; ordinary
Rust selected the left. LLVM may commute floating addition/multiplication even
without fast-math because Rust does not promise NaN payload propagation.

`js_math::{add,mul,sub,div}` now use explicit scalar SSE instructions with the
observed operand order. Add/multiply select the right NaN operand; subtract/divide
select the left. Sign and payload are retained, and signaling NaNs are quieted by
the instruction. Arithmetic invalid operations generate the hardware NaN. This
does not replace arbitrary NaNs with a canonical value. `Math.min/max` retain their
separately observed source canonical-NaN and signed-zero behavior.

The helpers reject unsupported compilation targets. Their execution contract is
Linux x86_64 with reference MXCSR control bits `0x1f80`: masked exceptions,
nearest-even rounding and gradual underflow. `reference_fp_environment()` checks
that contract once at an execution boundary; it ignores sticky exception status.

The operation probe compares original JavaScript operator bodies, normal Rust,
both SSE operand orders and the final helpers. It tests all pairs of 85 directed
values, including positive/negative quiet and signaling NaNs with different
payloads, plus 10,000 random binary64 pairs. All 103,350 helper outputs matched the
pinned source bits. Ordinary Rust add/multiply each differed in 5,394 cases in
this build. This is an observed pinned machine profile, not a language-level proof
covering every runtime or all possible bit patterns.

Reproduce with the pinned Rust compiler:

```sh
rustc --edition=2024 -O -Awarnings tools/probe-f64-ops.rs -o work/probe-f64-ops
NODE_OPTIONS='' node --jitless tools/probe-f64-ops.mjs work/probe-f64-ops
```

Damage primitives now retain source expression grouping through these helpers.
The strict original 20,000-case adversarial corpus passes all 120,000 numeric
outputs, callback order and RNG consumption without normalizing NaNs. Full
takeDamage remains separately checked under its fixture domain; other core
modules do not automatically acquire these arithmetic semantics from this change.
