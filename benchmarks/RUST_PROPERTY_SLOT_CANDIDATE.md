# Guarded own-data property slot candidate

Branch `candidate/property-slots` adds source-generated literal read sites with
per-runtime vectors of canonical property keys and physical property slots.
The cache stores **locations, never property values**. A hit loads the current
value only after checking the receiver's kind, physical slot's key and Data
descriptor. Deletion, reinsertion, accessor replacement and alternate layouts
therefore fall back naturally. Prototype lookups remain on the existing path.

Eligible receivers are ordinary objects and arrays represented as object
values. Function objects also carry a private physical tag, so function aliases
cannot accidentally cache a legacy dynamic `arguments` slot. Arguments objects,
typed arrays, boxed strings and other exotic kinds are excluded.

Each generated read owns a distinct Rust static site with a lazily allocated
atomic ticket. Compiler ordinals may reset across functions or modules without
sharing cache keys. Each runtime owns its own cache entries and canonical IDs.
A hit performs no HashMap lookup or string interning. First use interns the
literal; a miss follows the original `Runtime.get`, including getters, throws
and prototype traversal. Raw diagnostic read recording remains present.

Only noncomputed literal member reads are changed. Writes and deletes retain
the normal runtime path; computed-key coercion remains unchanged. The compiler
retains original source text for function reflection.

## Original Unit.update results

Both variants execute the **same generated entry** in the same release binary,
with the cache disabled or enabled on fresh runtimes. All fixture callbacks,
raw-bit formatting and ordered event observers remain enabled. Five warmup
updates and reset precede each timed controller call.

| Updates per variant | Cache OFF updates/sec | Cache ON updates/sec | Observed ratio |
| --- | ---: | ---: | ---: |
| 9,000 | 8,312 | 9,341 | 1.124x |
| 30,000 | 8,320 | 10,128 | 1.217x |

Every trial matched the independent source oracle's event sequence and selected
state bits: 45,068 events for each 3,000-update trial, and 150,220 for each
10,000-update trial. The original game method body is unchanged.

These shared-host runs overlap other work. They are provisional component
results, **not battles/sec**, sustained isolated speedups or full-battle
qualification. The candidate has not been integrated into the main simulator.
Cold cache growth, whole-program code size and complete-battle behavior still
need measurement before promotion.

- [Shorter paired run](results/2026-10-28T18-46-40.451Z-rust-unit-update-property-slots.json)
- [Longer paired run](results/2026-10-28T18-48-56.739Z-rust-unit-update-property-slots.json)
- [19 generated source mutation and module-isolation cases](validation/rust-generated-property-slots.json)

The directed gate runs identical generated entries with cache OFF and ON and
compares both against source JS. It covers live values, delete/reinsert,
accessor replacement, inherited getters, prototype mutation, alternating
layouts, exotics, method receivers, getter mutation followed by throw and raw
negative-zero bits. Its two-module test compiles separate scripts with reset
function/site ordinals, then executes both on the same runtime.

Additional checks passed: 80 generated expression cases, 40 arguments/capture
cases, 26 runtime library tests, 8 heap tests and 3 slot-specific runtime tests.
The runtime tests also exercise physical function aliases, per-runtime interner
differences and shared-site alternating object layouts.

```sh
node --jitless tools/rust-port/check-property-slots.mjs
node --jitless tools/rust-port/benchmark-unit-update-property-slots.mjs --updates 10000
```
