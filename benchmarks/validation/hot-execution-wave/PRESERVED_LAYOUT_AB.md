# Matched preserved layout A/B

The new hot execution wave completed the same original 20 measured battles and three warmups 1.05315 times as fast as the preserved old layout binary on the current host: 0.684899 to 0.721301 battles/second. Both complete reports, raw-bit state and host tapes matched the current pinned Node reference; each observed 12 collections.

This is one ordered OLD→NEW cohort. The old and new executables use byte-identical wall-wrapper and host sources and the same rustc flags. The old executable is the SHA-pinned historical static ELF; the new wrapper links the eight current fully qualified libraries. No core recompilation occurred during preparation. Historical old source qualification is preserved separately from current source qualification.

The new four-worker run completed 80 faithful battles at 2.09932 aggregate battles/second. The fresh original serial executable measured 0.68655 battles/second. Runtime enabled flags were observed true, but actual source helper domain/getter admission counters were both zero. These measurements do not establish the requested 10,000 battles/second target.

Artifacts: `benchmarks/results/2026-10-30-preserved-layout-ab.json` and adjacent compressed stdout/stderr, preparation, wrapper, host and tool archives.
