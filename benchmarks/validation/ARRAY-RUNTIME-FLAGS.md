This is an isolated experiment. `config/source-oracle-runtime.json` and simulator
semantics are unchanged; the existing two numeric storage differences still fail
under that active profile.

One supported flag combination removed the observed history dependence:

```text
--jitless --no-use-ic --no-lazy-feedback-allocation
```

It consistently returned positive canonical NaNs from the tested Number-array
literals, including payload and signaling inputs. That is an observation of the
source engine's stores, not normalization of captured values. The arithmetic
helpers and Rust Vec2 stores were not modified for this experiment.

The matrix ran 11 flag combinations in three fresh processes each. Four fixtures
included the exact original `ed.edpMult`, `ed.edpCompMult`, `ed.edpAdd`, plus an
arithmetic-free `function(a,b){return[a,b]}`. Each ran cold, after integer, double,
original/reversed witness, NaN-first and 20,000-call mixed histories, and with GC
between queries. Query order also reversed on the same literal sites. Inputs were
read back and asserted bit-identical, including signaling NaN payloads. Tagged
input arrays prevented experimental double-store behavior from changing the test
inputs. `--expose-gc` was an explicitly recorded test-only flag.

| Flags in addition to `--jitless` | History-dependent fixture/query groups, of 32 |
| --- | ---: |
| none | 6 |
| `--no-use-ic` | 20 |
| `--no-allocation-site-tracking` | 6 |
| `--no-use-ic --no-allocation-site-tracking` | 20 |
| `--no-lazy-feedback-allocation` | 4 |
| `--no-use-ic --no-lazy-feedback-allocation` | 0 |
| `--no-allocation-site-pretenuring` | 6 |
| `--no-use-ic --no-allocation-site-tracking --no-allocation-site-pretenuring` | 20 |
| `--no-unbox-double-arrays` | 6 |
| `--no-use-ic --no-unbox-double-arrays` | 20 |
| `--no-use-ic --no-lazy-feedback-allocation --no-unbox-double-arrays` | 0 |

All three processes agreed for every row. Disabling inline caching alone is
insufficient. Disabling array allocation tracking or double unboxing did not
provide an alternative solution in these fixtures.

The pinned upstream source supports the mechanism: `StoreInArrayLiteralIC::Store`
in `src/ic/ic.cc` sends `!v8_flags.use_ic` through `StoreOwnElement` and returns
before installing a fast handler. `FixedDoubleArray::set` in
`src/objects/fixed-array-inl.h` canonicalizes NaNs to the positive C++ quiet NaN.
`CreateLiteral` in `src/runtime/runtime-literals.cc` distinguishes missing feedback
vectors from tracked literal boilerplates. Eager feedback allocation removes that
additional starting-state difference in these tests. Source URLs and hashes are
recorded in the evidence.

The unchanged Rust numeric runner still has 36 raw NaN differences against this
experimental source profile, versus two under the active profile. Those extra
differences reflect the candidate's consistent positive array-store NaNs; this is
not a fidelity pass. The existing 20,000-case adversarial damage corpus remained
strictly bit-exact under the candidate flags without comparison normalization.

This provides a candidate for an explicitly versioned reference profile and a
source-matched Number-array store operation. Adopting it requires a separate
decision and renewed qualification; the experiment does not establish every V8
array allocation path or all battle semantics.

```sh
node tools/probe-array-runtime-flags.mjs
```

Full raw captures remain under ignored `work/array-runtime-flags/`; their hashes,
history differences and original source text are in the committed summary.
