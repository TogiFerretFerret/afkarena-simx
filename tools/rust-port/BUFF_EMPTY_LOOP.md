# Empty Buff loop shortcut

The source-pinned compiler hook already executes the complete original for
initializer, including debug/lock callbacks and exceptions. Its counter starts
at+0. When the captured limit is a Number and !(0<limit), the original body
executes zero times. The helper now returns before inspecting unused info,
caster, attribute maps or body descriptors. This includes both zeros, negative
numbers, negative infinity and NaN. Object/string limits retain the original
comparison and coercion callbacks. No Runtime fields change.

The expanded pinned Node gate passes40 cases/80 OFF-ON observations, including
unused null inputs, an active debug prefix, a length getter, prefix throws and
coercion fallback. This establishes source behavior for the added domain.
Throughput and full-battle admission remain unmeasured.
