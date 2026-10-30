# Property paths from the qualified layout profile

This analysis replays 2,663 archived CPU samples, validates the stack archive, profile, demangler and exact original function source hashes, and assigns each selected **self** sample to its nearest source caller. It does not infer dynamic property keys or cache hit/miss reasons from a sampled stack. The report contains exact source, static member sites and receiver/key expressions; static occurrence × caller-sample scores are ranking heuristics only.

The target leaves are literal read 240 samples (9.01%), generic get 168 (6.31%), and Object::own 208 (7.81%). Their 616 samples are disjoint. Inlining attributes some work to enclosing symbols. 63 target samples map to source functions absent from the archived source metadata and remain unclassified rather than guessed.

| Nearest source function | Literal / get / own samples | Observed combined self budget |
| --- | ---: | ---: |
| Unit.update | 28 / 17 / 12 | 2.140% |
| Buff percent loop, function 1613 | 8 / 10 / 13 | 1.164% |
| copyObj | 7 / 7 / 14 | 1.051% |
| createDataObj, function 178 | 0 / 10 / 14 | 0.901% |
| SBD.atk4_resetBuffApply | 7 / 9 / 3 | 0.713% |
| Buff fixed loop, function 1614 | 6 / 9 / 4 | 0.713% |
| Buff.applyEffect | 4 / 5 / 8 | 0.638% |

These are sampled work budgets for **all** selected operations in each function, not projected speedups or a proof that every sample concerns attributes. Inclusive Unit.update 49.49% and addBuff 33.35% are unsuitable as attribute-only budgets: most work is in callees.

## Concrete next guard candidates

1. **Two-index dynamic own-data hints per canonical key, before descriptor routing.** The exact fixed loop reads `e[o]` where `e=this.info`, then reads/writes `t[o]` where `t=this.owner.attribs`. The percent loop additionally reads `this.owner.attribs[_]` or `this.caster_attribs[_]`. The existing dynamic cache keeps one physical slot per key for every receiver; these source paths demonstrably use the same keys across independently constructed records. This makes slot disagreement a concrete hypothesis. A second remembered physical index would still require the existing fresh `data_slot(index,key)` validation; it must never cache values or weaken accessor/function/arguments guards. The two Buff loops together have 50 selected self samples, **1.878% of this profile**, as the observed maximum budget before separating any eligible accesses. No collision rate has been measured. Count first-index hits, second-index hits and descriptor fallbacks in a component build before adoption.

2. **Primitive leaf copy admission, under the existing copy preflight.** Original copy source reads `e.constructor`, `Object.keys(e)`, `r[i]` and `e[a]`, then writes `t[a]`. Copy contributes 28 selected self samples, **1.051%**, while createDataObj adds 24, **0.901%**, with its `t[r]`, `this[n]`, `e[n]` and stack arrays. None proves a 47-number attribute receiver. The current helper's finite-number restriction can reject otherwise flat primitive leaf records; source recursion only occurs for truthy `typeof value === "object"`. Strings, booleans, null/undefined and Function identity are concrete eligibility categories to count. Nonempty arrays and recursive objects need their own proof and must not be silently dropped. Root's separate array-admission observer is the required evidence before a bulk-array path.

3. **Effect-table own-data and absent-key routing, separate from attribute records.** Buff.applyEffect aliases `t=this.owner.buff_effects`; its dynamic `t[e]`, `negative_effects[e]`, `effect_inclusions[e]`, and `t[n[i]]` coexist with literal `uncontrollable`, `taunted`, `pursue`, and `fearTarget`. Observed selected budget is **0.638%**. Unit.update also reads multiple effect flags. These are boolean/missing-key tables, so an attribute-number-only representation cannot cover them by source identity alone. A missing-key fast path must still prove the complete prototype lookup and preserve accessors/errors; source text alone does not authorize skipping it. Count own data versus absent-own/prototype-hit before choosing a negative-lookup design.

Unit.update's 2.140% budget contains many position/velocity numeric array sites, but primary numeric reads/writes already have a separately qualified implementation. Do not count that budget again as new DenseAttrs opportunity. Buff percent-loop specialization is also already present in this profile; nearest-source samples do not establish whether they arise from preflight, fallback or retained callbacks.

## Required next diagnostic fields

For a component-only variant, count literal and dynamic lookups separately: cached own-data success; no learned index; index/key mismatch; object/function/arguments/kind rejection; primary numeric array versus ordinary record; accessor; missing own property with prototype data/accessor/miss; and post-get learning. Group by pinned original source site and record only aggregate counts. Never infer a miss reason by performing a second observable lookup. Preserve diagnostic callback points and avoid introducing this instrumentation into a throughput run.

Reproduce with `node tools/rust-port/analyze-property-paths.mjs /workspace/afkarena-simx OUTPUT.json`. Output committed at `benchmarks/validation/literal-cold-split/property-path-attribution.json`. No runtime source, generated battle code or full-build input was changed for this analysis. The sampled profile predates the latest literal cold split and primary numeric access integration, so refresh attribution after the next qualified full build before forecasting whole-battle impact.
