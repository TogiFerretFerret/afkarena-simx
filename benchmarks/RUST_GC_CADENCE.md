# Native battle GC cadence experiment

All four runs match every non-timing field and the complete host-input tape in the pinned Node 20-battle/three-warmup reference. Each uses the same binary, frozen qualified game libraries, and unchanged runner FunctionDeclaration source. Cadence 1 also rebinds the runner, providing the fair control for this experiment.

| Collect every battles | Actual collections | Battles/sec | Relative to cadence 1 | Observed HWM GiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 23 | 0.582754 | 1.000× | 2.535 |
| 2 | 12 | 0.656969 | 1.127× | 3.009 |
| 4 | 6 | 0.661762 | 1.136× | 3.656 |
| 8 | 3 | 0.708450 | 1.216× | 4.636 |

These are one sequential trial per cadence. Cadence 8 is fastest here but adds about 2.10 GiB over the control. Its memory use does not qualify four parallel workers. Cadence 2 offers a smaller memory increase. The derivative runner's layout differs from the original qualified program; its cadence-1 rate is therefore the comparison baseline, rather than the original program's 0.632731 battles/sec.

The tool compiles only the original runner declaration with all nine compiler fast paths unchanged. It installs the selected declaration in the original global environment after units 0–5 and before unchanged unit 6. It asserts identical function name, arity and Function.prototype.toString output. The frozen-module AST audit finds exactly its original declaration and direct call, with no runner-name string literals. This is a closed fixture audit, not a general proof about computed reflective aliases in arbitrary programs. Original game function libraries are reused unchanged.

The source, generated Rust, UTF-16 pools, compiler settings, rustc command, host wrapper and library hashes are retained in the [execution preparation](validation/rust-gc-cadence-execution-preparation.json). The [completed comparisons](results/2026-10-28-gc-cadence.json) retain each complete report and resource monitor. The separate [strict marker audit](results/2026-10-28-gc-cadence.strict-audit.json) binds exact collection counts to compressed stderr and the result hash. All runs exit zero and complete the original clock tape; no mechanics or callbacks are skipped.

Reproduce only after reserving an actual timing slot and completing a frozen release build:

```sh
node tools/rust-port/benchmark-gc-cadence.mjs \
  --baseline benchmarks/validation/rust-program-allocation-wave-full.json \
  --output benchmarks/validation/rust-gc-cadence-review-preparation.json \
  --result benchmarks/results/rust-gc-cadence-review.json --run
```

Omit `--run` to prepare and link without simulating battles. Each child has an 8 GiB observed RSS limit and a 120-second timeout. The tool checks expected collection counts 23/12/6/3, exact source/host reports and unchanged build inputs. Fixed-fixture results do not qualify random full-scene battles, 20,000 battles or the 10,000 battles/sec goal.
