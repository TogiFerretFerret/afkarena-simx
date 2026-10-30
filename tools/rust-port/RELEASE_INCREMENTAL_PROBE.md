# Release incremental compilation: small dependency experiment

A real generated Unit.update fixture was rebuilt against an isolated copy of the
runtime with opt-level 3, 64 codegen units, LTO disabled and no fast-math flags.
The two configurations differed in `CARGO_INCREMENTAL` and
`CARGO_PROFILE_RELEASE_INCREMENTAL`. Builds used one Cargo job and the shared
native timing lease. Times are one contended observation per stage.

| Stage | Plain release | Incremental release |
| --- | ---: | ---: |
| Cold build including dependencies | 26.278 s | 31.023 s |
| Unchanged rebuild | 0.021 s | 0.018 s |
| Private runtime helper body change | 17.023 s | 3.414 s |

The changed helper is the private Number.isFinite implementation. Testing the
binary64 exponent bit mask is equivalent to `f64::is_finite`, including signed
zero, infinities and both NaN classes. Public signatures and storage layouts
remain unchanged. This is a small unrelated private-body edit; edits to inlined
hot helpers or widely used public layouts can invalidate substantially more.

Cargo invokes rustc for both runtime and generated fixture after the edit in
both configurations. Incremental rustc retains the generated fixture's **17
CGU object inode/hash pairs** in the new cache session. Previous sessions remain
in the raw object inventory: total object counts there must not be described as
the number of newly reused codegen units. The warm dependent rebuild is about
**4.99× faster**, while the incremental cold build is about **18.1% slower**.

Each of six build stages executes the same fixture with both existing literal
cache modes. All **964 ordered events and selected state/raw-bit observations
per execution** agree across builds. These are native baseline/mutation checks,
not a new Node corpus or complete-battle qualification. Execution times are not
reported as simulator throughput.

## Reproduce in an isolated worktree

```sh
flock -s /workspace/afkarena-simx/work/native-timing.lock \
  node tools/rust-port/probe-release-incremental.mjs \
  --reference-root /workspace/afkarena-simx
```

The script must run outside the reference repository: it modifies its own
workspace manifest and private helper temporarily, then restores the helper.
It uses the prepared generated fixture under the reference repository's
`work/candidate-function-own-data-literals` tree. Retained evidence includes
Cargo verbose output, callback/state observations and exact source snapshots.
Measured target caches are removed after preserving final executables and
metadata; the reference/main target is untouched.

## Full-workspace decision

This supports a bounded larger pilot for **private-body-only edits**. It does
not demonstrate that a 553-crate rebuild becomes five times faster. Rustc must
still load/check dependency metadata, parse generated crates and load query
caches. A public API/layout change or compiler-generated MIR change has a
different invalidation footprint.

The experiment did not create a full-world incremental cache. Query dep-graphs,
CGU objects and retained sessions add storage per crate. Current approximately
1 GiB free space is insufficient headroom for enabling this speculatively in
the shared full-world target; reclaim/reserve several GiB, measure a bounded
larger pilot and its peak bytes, then decide. Preserve the existing qualified
release separately. Explicitly record both environment switches in provenance;
the current build wrapper records `CARGO_PROFILE_*` but not the standalone
`CARGO_INCREMENTAL` variable. No main release profile change is made here.

[Detailed results and source/archive hashes](../../benchmarks/validation/release-incremental-probe.json).

## Bounded eight-generated-crate pilot

A second run adds eight **unchanged actual generated unit-0 part crates**, their
original dependency chain and the exact source-pool crate. It uses the same
runtime, original Unit fixture, private-body mutation and flags. These early
unit-0 crates are a bounded sample; the pilot does not execute their complete
program initialization or a full battle.

| Stage | Plain release | Incremental release |
| --- | ---: | ---: |
| Cold build | 60.672 s | 57.925 s |
| Unchanged | 0.020 s | 0.018 s |
| Private runtime helper body edit | 47.900 s | 5.831 s |

The private-body warm rebuild is **8.21× faster** in this single contended pair.
Cargo still invokes rustc across the dependent chain. Each of the eight actual
part crates reuses all **eight CGU objects**, proven by inode and SHA equality
in the newly created cache session: **64/64** in total. Old-session entries are
excluded from that count. Every fixture event/state observation still matches.
This measures compilation reuse; it is not a simulator speedup.

Unique-inode target storage is 44.7 MiB for plain release, 243.5 MiB for the
incremental cold build and 363.8 MiB after the private edit. The incremental
portion grows from 202.0 to 322.3 MiB because previous query-cache sessions
remain. The report records object bytes and query/graph/other bytes for every
crate, deduplicating hardlinks; logical directory totals alone overcount.

Across the eight sampled parts, mean incremental cache is 12.71 MB cold and
23.76 MB after the edit. The currently prepared workspace lists 554 part
entries. A simple linear illustration is **6.56 GiB cold / 12.26 GiB after an
edit for part caches alone**, excluding linked artifacts and other crates.
This is not a full-world measurement or a safe upper bound: crate sizes differ,
these are early unit-0 parts, and cache eviction/session retention can change
storage. Four GiB free does not support enabling this blindly across the world.

The result supports a larger pilot or more storage, with explicit incremental
provenance. It covers one private body edit with unchanged APIs/layouts. Changes
to generated source, codegen flags, compiler versions or public record layouts
have different invalidation patterns and are not measured here.

```sh
flock -s /workspace/afkarena-simx/work/native-timing.lock \
  node tools/rust-port/probe-release-incremental.mjs \
  --reference-root /workspace/afkarena-simx --parts 8
```

[Bounded result, per-crate bytes, new-session CGU reuse and archived inputs](../../benchmarks/validation/release-incremental-bounded-probe.json).
