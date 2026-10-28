# Ordinary writable data updates

This isolated candidate checks an existing own data property immediately after
the original key coercion in `Runtime::set`. For an ordinary nonfunction object
with no mapped argument cells, a writable data descriptor permits replacing its
value directly. The physical key is checked against the canonical requested key.
The descriptor flags, property order, prototype and extensibility stay intact.

Key coercion runs first because its callbacks can replace the descriptor.
Accessors, missing or readonly properties, functions, arrays, mapped arguments,
boxed primitives and other object kinds use the existing implementation.

`ordinary_set_fast_path_enabled` selects the path independently in one binary.
The branch defaults to enabled in this candidate. Main promotion requires full
battle comparison and a measured gain.

Validation:

- 53 existing library tests and four directed tests pass. Directed cases run
  both modes and cover descriptor flags, nonextensible objects, inherited
  setters, readonly assignments, key coercion that installs a setter, mapped
  arguments, array length and raw NaN/signed-zero bits.
- The pinned JS comparisons pass 40 coercion, 24 reflection and 40 argument cases.
  An initial reflection launcher used the wrong filename; its failed launch and
  the corrected successful run are retained.
- Three alternating pairs of 3,000 original `Unit.update` calls match all 45,068
  ordered events and selected state per trial. Aggregate throughput is
  15,229 versus 16,883 updates/sec, an observed 1.109x ratio. The fixture uses
  opt-level 3, 64 codegen units and no LTO, matching the full build profile.

These are component measurements. Full battle qualification remains pending.
