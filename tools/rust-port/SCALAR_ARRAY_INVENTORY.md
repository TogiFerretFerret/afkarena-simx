# Read-only scalar local array opportunity inventory

Run from a checkout containing the tool, using the prepared repository as input:

```sh
flock -s /workspace/afkarena-simx/work/native-timing.lock \
  node tools/rust-port/inventory-scalar-arrays.mjs \
  --root /workspace/afkarena-simx \
  --output /workspace/afkarena-simx/benchmarks/validation/scalar-array-opportunity-inventory.json
```

The tool parses all seven frozen source modules, verifies manifests and exact
function hashes, reuses native-binding analysis and the copied scalar-array
planner, then joins unit/function/hash identities to the signed-camp CPU matrix.
It does not lower functions, compile native code, execute battles or change a
production allowlist. A per-function hash is allowed only within the local
analysis call. The copied planner's hash is recorded in the report; its origin
and production pin remain explicit.

The retained inventory covers **22,986 functions and 11,512 syntactic array
allocation sites**. The existing planner admits arrays in **63 functions**.
Excluding the already selected Unit.B function leaves **62 candidates**.
Only one remaining function has samples in this fixed-fixture profile:
unit 0 / function 1688, two nearest-source and inclusive samples (**0.013%**).
The existing Unit.B pin is unit 0 / function 1818, with **6.258% nearest-source**
and **51.280% inclusive** CPU. Inclusive CPU includes callees and is not removable
array cost. Functions absent from sampled rows are marked null, not measured zero.

Ranking uses nearest-source samples, then inclusive samples, then static read
sites. This priority is a search aid, not an estimated speedup. Static counts
separate array sites, eligible declarations, indexed reads, length reads and
truthiness reads. Rejected functions retain counts without invented individual
failure reasons. Eligibility is the current planner's structural result;
compiler integration constraints and full semantic qualification remain separate.

This narrow planner's additional sampled coverage is small. Broader transformations
need new eligibility proofs and source/native differential tests before enabling
them. None of these counts establishes dynamic allocations saved, random-corpus
coverage, or complete-battle throughput.
