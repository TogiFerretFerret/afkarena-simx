The two remaining numeric-kernel NaN bit differences are V8 array storage behavior,
separate from the arithmetic operand-order issue fixed in `js_math`.

Under the pinned `--jitless` profile, a plain `function(a,b){return[a,b]}` can return
different NaN bits for identical input bits depending on earlier calls. The probe
warms the literal site with zero, signed zero, fractional and infinite values. It
then calls the same function twice with `fff8000000000000` and Infinity. The first
result contains `7ff8000000000000`; the next contains `fff8000000000000`. The input
bits are explicitly checked to be identical. There is no arithmetic in that
function and no normalization in the probe.

The actual original `ed.edpMult` similarly returns a positive NaN for `0*Infinity`
on one call while a scalar version returns the hardware negative NaN; the next
array call retains the negative NaN. Original source hashes are checked.

The pinned V8 source has different store implementations consistent with this
observation: `FixedDoubleArray::set` in `fixed-array-inl.h` replaces NaNs with
`std::numeric_limits<double>::quiet_NaN()`, whereas the fast store in
`keyed-store-generic.cc` uses `Float64SilenceNaN`. The probe records links and the
observed outputs; it does not claim to exhaustively model V8 inline-cache and
allocation transitions.

Generated Rust arithmetic now uses source-ordered `js_math` helpers. Generation
and its tests pass, and the 20,324-case check still has exactly two raw differences:
case 9, outputs 10 and 12, both array-element positive versus negative NaN. All
other 284,534 outputs match raw bits. `--strict-bits` still fails visibly. The
semantic diagnostic counts the two mismatches without modifying either value.

A stateless `[f64;2]` return cannot reproduce a source function whose output bits
depend on hidden VM storage history. No case-index special case, blanket NaN
canonicalization, or warmup that hides the mismatch has been added. Full raw-bit
qualification for this adversarial storage domain requires an explicit compatible
array/VM-state model or a source-proven domain that excludes these NaNs.

```sh
NODE_OPTIONS='' node --jitless tools/probe-array-nan-storage.mjs
node tools/lower-numeric.mjs --check
NODE_OPTIONS='' node --jitless tools/check-numeric.mjs PATH_TO_NUMERIC_CHECK --strict-bits
```
