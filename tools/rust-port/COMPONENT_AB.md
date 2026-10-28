# Full-battle component comparison

`benchmark-program-components.mjs` prepares a single native driver linked against the eight libraries from a completed, passing full-battle baseline. With `--run`, separate processes execute the original twenty measured battles and three warmups for each selected configuration. No runner declaration or source battle count changes.

The default variants are:

| Variant | Primary numeric arrays | Ordinary own writes | Dynamic own reads |
| --- | --- | --- | --- |
| `all-on` | on | on | on |
| `primary-off` | off | on | on |
| `ownset-off` | on | off | on |
| `all-new-off` | off | off | off |
| `ownread-off` (optional) | on | on | off |

All variants explicitly use Fx string hashing. Literal length, numeric key cache, index strings, dense shift and existing literal-property slots must remain enabled; the driver asserts these constructor defaults. Only the three new public switches are assigned. This compares new implementations within the same runtime layout; it does not undo representation overhead introduced by that layout.

The manifest must prove native GC safety and provide a positive integer cadence. Expected collections are `ceil(23 / cadence)`, so a cadence-two build requires twelve collections, rather than the old hardcoded twenty-three. Each full report, raw terminal number bits, callback accounting, RNG and complete host tape must match the accepted Node report. The original frozen build proof is checked before linking, after linking and after all measurements. Tool inputs, sources, preparation, host, binary and selected libraries are checked for changes. Compilation logs, wrapper, host, per-process reports and diagnostics are archived.

After the new full baseline passes and other compiler/profile workloads stop:

```sh
node tools/rust-port/benchmark-program-components.mjs --run \
  --baseline benchmarks/validation/NEW-PASSING-FULL.json \
  --output benchmarks/validation/component-ab-preparation.json \
  --result benchmarks/results/component-ab.json
```

Omit `--run` to compile and archive preparation without executing battles. Do not prepare against an unfinished build or a baseline whose frozen input proof is no longer current. `--repository /absolute/repository` supports an isolated tooling checkout. `--variant all-on --variant ownread-off`, or `--variants all-on,ownread-off`, selects configurations. Unknown, duplicated or missing names fail closed.

`--trials 2` repeats every selected configuration and reverses order on alternating trials. Aggregate throughput is completed battles divided by total measured seconds per variant. The result records individual timings and ratios of all-on throughput to every selected configuration. One trial is a component diagnostic, not a confidence interval or random full-scene qualification. This tool has been syntax checked and its configuration guards tested; actual full-workload execution awaits the new baseline.
