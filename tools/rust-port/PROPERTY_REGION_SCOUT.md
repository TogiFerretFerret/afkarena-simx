This is an effect/guard-plan inventory, not an optimizer. It does not run battles, execute source callbacks, change an AST, or emit an accelerated Rust body. The default scan is capped at twelve hot functions and 80,000 source UTF16 units; it reads exact source slices pinned by the retained nearest-source CPU matrix. Copy/config helpers already owned by other experiments are excluded.

Run `node tools/rust-port/scout-property-regions.mjs --repository /workspace/afkarena-simx`. The retained initial report used eight functions and 40,000-unit cap (12,428 units actually parsed). It found 32 disjoint maximal numeric/property expression islands. Every original unknown getter, call, write, coercion, allocation, control-flow boundary and global/captured binding remains explicit in the inventory.

The strongest initial source target is the Unit.update motion island:

```
this.position[0]+=m[0]*r,this.position[1]+=m[1]*r
```

Its source order is read position[0], read m[0], multiply, add, commit position[0], then the corresponding position[1] steps. The first candidate guard must prove this.position is own data containing a standard object/array, m is an eligible native local containing a standard object/array, both numeric leaves exist as own primitive Number data, both position leaves are writable, and r is a native-local Number. Primary numeric-array storage requires explicit virtual-own-slot support; treating absent dictionary entries as real slots is invalid. Holes, inherited/accessor descriptors, function mirrors, mapped arguments and other exotics must fall back.

Preflight checks must be side-effect free and happen exactly at the subtree's original evaluation point. They may cache locations, not Number values. All source reads and writes remain in order, including aliasing reads after writes. Physical alias between a written leaf and a cached object-valued prefix must reject the fast path. No getter/callback can run between the guard and commits. Any guard failure executes the original entire subtree before any source side effect. Preserve the existing compiler's f64, signed-zero, NaN, constant-folding and JS numeric helper semantics; do not introduce Rust reassociation, fast math or FMA. TRACE1 retains original IR and requires the fixed host diagnostics mode.

The equally sized knockup island ranks alongside motion statically, but knockup is conditional and may rarely execute. No dynamic admission count exists yet. Unit.update's 4.029% nearest property CPU is the upper bound for its entire body in the older profile; it is not a measurement of either island. The ranking score is only a heuristic. resetBuffApply has substantial property CPU but no eligible numeric island because its own body mainly dispatches methods; fusing across those calls would be unsound without separate clobber/identity proofs.

Before implementing a larger optimizer: count guard attempts/hits and fallback reasons on the unchanged full fixture, then prototype the single pinned motion region. Differential gates must cover setters/getters, missing/hole/prototype and descriptor changes, aliased arrays, non-Number/object coercions, raw NaNs/-0, mapped/exotic receivers and exact original fallback/error order. Only a full-battle A/B can establish the speed benefit.
