# Primitive ToString stack conversion

`value.rs` already formats numbers in Ryu's stack buffer. It then allocated a
UTF16 Vec on every conversion, including canonical interner hits. The candidate
widens ASCII into a 32-unit stack array and passes its borrowed slice to the same
UTF16 interner. Number formatting, canonical IDs and first-miss storage remain
unchanged. Undefined, null and boolean keywords use the same helper. An exact
Unicode/long-text fallback preserves the original conversion path.

The candidate passes 48 runtime library tests and 79,026 raw/value/string
comparisons; 90 existing tagged-number remainder cases remain unsupported.

A same-binary component benchmark alternates both paths over 18 warmed number
keys, including signed zero, NaN, infinities, denormals and exponent boundaries.
Across one million calls per sample the old UTF16 collection performs 1,666,663
allocation/reallocation calls; the stack path performs zero. Canonical ID
checksums match in every sample. Timing ratios are 1.206x and 1.247x. These are
component figures, not battles/sec or full-battle qualification. All samples and
the exact benchmark source are retained in `rust-number-string-stack-component`.
