# Qualified next-batch integration

This isolated branch combines immutable native parameters/zero-cell activations,
physical function tags, hoisted canonical environment-name IDs, the exact-source
exposure scan helper and opt-in GC cadence. Existing native variables, operand
snapshots, numeric guards, literal keys, property slots, source guards, mapped
arguments and GC roots remain enabled. **Default GC cadence remains 1.**

The exposure helper keeps its parameter and local cells environment-backed;
the GC root driver also remains environment-backed. Hoisted environment IDs
work in independent split helpers and coexist with native parameter references.

Two issues were caught before main integration:

- Forced helper splitting exposed a missing false default in raw argument-slot
  metadata. An absent native-parameter map serialized an undefined mask as an
  empty array. The compiler now emits explicit false, with a structural
  regression and the complete rejected source gate retained.
- Exposure scan guards now reject sparse logical lengths larger than physical
  storage before allocating their temporary vector. Two maximum-length sparse
  arrays verify fallback and the original early TypeError behavior.

Final stable-source gates pass: 40 arguments, 47 closures, 40 control-flow,
80 expressions, 63 environment-ID variants including forced splitting,
28 exposure variants, 38 native-local/operand snapshots, 19 property slots and
six directed native-parameter reflection cases. The GC cadence fixture matches
all source report fields for disabled/1/4 cadence, with 69 frames and 120
callbacks; collection counts are 0/23/6. Generator smoke tests preserve default
1, accept 4 and reject five invalid values. All 42 Rust library and four slot/GC
tests pass. Structural activation, argument-policy, exposure and cadence tests
also pass.

See [the combined evidence index](validation/rust-next-batch-integration.json)
and [retained split-mask failure](validation/rust-combined-env-name-keys-rejected-before-split-mask-fix.json).

This is compiler/runtime integration qualification, not a new battle throughput
measurement. A full native rebuild and complete source-oracle battle comparison
are still required. Component improvements cannot be multiplied into a battle
speed claim. No random/full-scene or 20,000-battle qualification is claimed.
