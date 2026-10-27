Run `npm run verify:components` to build the Rust component runners with the pinned
toolchain and compare ten deterministic 20,000-case corpora against their original
JavaScript function bodies. No network access or tool installation is performed.
Local Rust under `work/toolchain/` is used when present; `RUSTC` overrides the path.
Every source checker runs with the exact profile in `config/source-oracle-runtime.json`:
Node v24.19.0, the pinned V8 build, Linux x64, `--jitless` and empty `NODE_OPTIONS`.
Profile mismatches fail before checks run. A failed suite writes a failure report
with its name and completed suites; an old success report is removed at startup.

The gate covers Unit update control, Skill update and deferred callback bodies, Buff update/HPR control,
damage primitives with bounded finite inputs, full takeDamage control, AI targeting,
movement, skill selection and full AI controller control flow, and immutable attribute
initialization. The individual reports describe the fixture mechanics and input domains. Comparisons retain numeric
bits, callback order and the state exposed by each component harness.

`npm run verify:components -- --diagnostics` additionally runs adversarial damage
inputs and counts NaN sign/payload differences. That diagnostic permits semantic NaN
equivalence and is explicitly excluded from the strict raw-bit gate. A successful
diagnostic does not establish bit equality.

The combined report is written to `work/component-verification-summary.json`, with
source hashes and toolchain versions. Reviewed reports are copied here for commits.
The earlier default-JIT result is archived as
`component-verification-unpinned-2026-10-27.json`; it does not establish qualification
against the pinned reference profile.
These component checks do not qualify full-battle fidelity or battles/second.
Composition into a native battle core remains separate work.
