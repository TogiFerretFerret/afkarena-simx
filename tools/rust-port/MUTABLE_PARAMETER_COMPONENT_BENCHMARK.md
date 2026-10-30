# Mutable formal parameter component benchmark

The proposed Babel pass moves reassigned formal parameters into Rust locals, keeps a live mirror for legacy `function.arguments` observations, and can eliminate an otherwise necessary activation environment. These tests compare compiler flag OFF/ON with **one identical updated Runtime library and one executable per observer mode**. This does not measure the Runtime changes against the old Runtime.

The hot original `Buff.ctor` is source-pinned to `3ca99406ed04bd3655bb5bb11c776e1286bd122d21e218003629e6d3d83144b6` (profile unit 0/function 1610). Both modes execute the same original constructor, table lookup, copy and data-object helpers. The surrounding component fixture supplies explicit `getDuration`, owner and caster callbacks; it does not include the Cocos class wrapper or full battle mechanics. Eight actual SkillBuff rows are selected. Every result is checked against pinned Node v24.19.0/V8 13.6.233.17 with `--jitless`, including ordered field observations, callback events and raw float bits.

The OFF/ON constructor manifests confirm that formal `e` becomes a mirrored native mutable parameter and activation elision changes false→true. A separate counted executable instruments generated environment creation and binding declarations; the timing executable has none of those API counters.

| Cohort | Calls per trial | Trials per flag | OFF total seconds | ON total seconds | OFF/ON speed ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial Buff | 2,000 | 3 | 0.357590 | 0.390370 | 0.9160× |
| Longer Buff repeat | 10,000 | 3 | 1.883560 | 2.017875 | 0.9334× |

The longer repeat alternated OFF/ON, ON/OFF, OFF/ON under an exclusive OS timing lease. Individual ratios were 0.9949×, 1.0827× and 0.7573×. The counted execution reduced environments 30,001→20,001 and function binding cells 50,000→40,000 per 10,000 constructors. This allocation reduction did **not** establish a throughput improvement. The sample is small and variable; it is insufficient to claim a statistically significant regression either. Hold production promotion until positive evidence exists.

Initial Unit.update and drain controls admitted no newly mutable parameters: their respective ratios were 0.9809× and 0.9281×, with identical environment/cell counts. They serve as semantic and measurement controls, not evidence that this parameter pass accelerated those functions.

Evidence:

- `benchmarks/results/2026-10-30T17-50-42.014Z-mutable-parameter-components.json`: initial three-component cohort; gzip archives retain every output and pinned expected snapshot.
- `benchmarks/results/2026-10-30T17-53-07.236Z-mutable-parameter-components.json`: longer Buff-only repeat, exact admission manifests, 256 archived generated/compiler/runtime inputs and binary/driver/library hashes.

Reproduction requires checkout of `candidate/mutable-parameter-benchmark` at
`92901d3`, which retains the candidate compiler, Runtime and benchmark tools.
Only this report and its evidence archives are published on main; the parameter
optimization remains unmerged. Use the candidate Runtime's matching release
library/dependencies:

```sh
MUTABLE_BUFF_COPIES=10000 flock -s /workspace/afkarena-simx/work/native-timing.lock node tools/rust-port/prepare-mutable-parameter-components.mjs
flock -x /workspace/afkarena-simx/work/native-timing.lock node --jitless tools/rust-port/run-mutable-parameter-components.mjs --buff-only
node tools/rust-port/seal-mutable-parameter-component-evidence.mjs benchmarks/results/<new-report>.json
```

This is a component experiment. It establishes no whole-battle speed, no new full event-trace qualification and no 10,000 battles/second milestone.
