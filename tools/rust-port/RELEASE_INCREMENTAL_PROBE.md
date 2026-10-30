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
