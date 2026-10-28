# Full-battle comparisons for the four new helpers

After the NEXT frozen full20/3 Node comparison passes, run
`benchmark-program-new-helpers.mjs --repository PATH --baseline FULL.json` to
prepare one derivative native binary from its eight verified release libraries.
Add `--run --result RESULTS.json` only after the serial timing slot is released.
No core or original battle source is rebuilt or edited by this tool.

The default variants are all-on, parser-off, buff-off, dataobj-off,
prototype-off and all-four-helpers-off. Select a subset with repeated --variant
or comma-separated --variants. --trials reverses ordering on alternate trials.
Every variant explicitly keeps primary numeric arrays, ordinary own Set,
dynamic own reads and Fx hashing enabled. Captured name layout and copy reuse
stay identical in the shared libraries. All switches are assigned before host
installation and original source module initialization.

Each process completes the unchanged three warmups and twenty measured battles.
The driver compares the full non-timing source report, raw terminal state bits,
totalCallbacks and complete host tape against the passing Node reference.
Input/library hashes and the completed build proof are checked before and after;
GC collections must equal ceil(23 / manifest cadence). Timing uses the original
measured wall boundaries. Fixed-fixture rates do not qualify random full-scene
5v5 behavior,20k-battle parity or10k/sec performance.

Only after the original run returns, stderr records
`FAST_BUFF_PERCENT:<attempts>:<hits>`. Admission counters cover the entire Runtime,
including initialization and warmups; they are not measured-window-only counts.
The tool verifies one marker after the measurement end, exact safe integer
counts, hits <= attempts and zero counters for buff-off. Source reports and
callback counters remain unchanged. Eight configuration and rejection tests pass
with `node --test tools/rust-port/tests/helper-component-ab.test.mjs`.
