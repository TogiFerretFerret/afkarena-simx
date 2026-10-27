/* Host-clock inputs for the source oracle and AOT candidate.
 * This file is ordinary JavaScript: no Node imports or engine-specific APIs.
 * It records actual native host observations; replay never invents timestamps.
 * Instrumentation changes Date function identity/toString and patches the shared
 * prototype's constructor while installed. Load once per realm before source
 * initialization. See config/host-clock-contract.json for the precise boundary.
 */
(function (host) {
    "use strict";
    var active = null;
    var storage = new DataView(new ArrayBuffer(8));
    function numberBits(value) {
        storage.setFloat64(0, value, false);
        return storage.getUint32(0, false).toString(16).padStart(8, "0") +
            storage.getUint32(4, false).toString(16).padStart(8, "0");
    }
    function bitsNumber(bits) {
        storage.setUint32(0, parseInt(bits.slice(0, 8), 16), false);
        storage.setUint32(4, parseInt(bits.slice(8, 16), 16), false);
        return storage.getFloat64(0, false);
    }
    host.installOracleClock = function installOracleClock(options) {
        if (active !== null) throw new Error("oracle clock is already installed in this realm");
        options = options || {};
        var mode = options.mode;
        if (mode !== "record" && mode !== "replay") throw new Error("oracle clock mode must be record or replay");
        var input = options.tape === undefined ? [] : options.tape;
        if (!Array.isArray(input)) throw new Error("oracle clock tape must be an array");
        if (mode === "record" && input.length !== 0) throw new Error("record clock requires an empty output tape");
        var tape = mode === "record" ? input : input.map(function (entry, index) {
            if (!entry || typeof entry !== "object") throw new Error("invalid clock tape entry at " + index);
            if (entry.kind === "Date.call") {
                if (typeof entry.value !== "string") throw new Error("invalid Date.call value at " + index);
                return Object.freeze({ kind: entry.kind, value: entry.value });
            }
            if (entry.kind !== "Date.now" && entry.kind !== "Date.construct") throw new Error("invalid clock event kind at " + index);
            if (typeof entry.bits !== "string" || !/^[0-9a-f]{16}$/.test(entry.bits)) throw new Error("invalid clock numeric bits at " + index);
            return Object.freeze({ kind: entry.kind, bits: entry.bits });
        });
        if (mode === "replay") Object.freeze(tape);
        var OriginalDate = host.Date;
        if (typeof OriginalDate !== "function") throw new Error("native Date constructor is unavailable");
        var originalGlobal = Object.getOwnPropertyDescriptor(host, "Date");
        var originalConstructor = Object.getOwnPropertyDescriptor(OriginalDate.prototype, "constructor");
        var originalNowDescriptor = Object.getOwnPropertyDescriptor(OriginalDate, "now");
        var originalNow = OriginalDate.now;
        var originalGetTime = OriginalDate.prototype.getTime;
        var cursor = 0, attempts = 0, finished = false, restored = false, failure = null;
        var counts = { "Date.now": 0, "Date.construct": 0, "Date.call": 0 };
        function fail(message) {
            if (failure === null) failure = message;
            throw new Error(failure);
        }
        function before(kind) {
            attempts++;
            if (failure !== null) fail(failure);
            if (finished || restored) fail("clock observation after finish/restore: " + kind);
        }
        function record(kind, value) {
            var entry = kind === "Date.call" ? { kind: kind, value: value } : { kind: kind, bits: numberBits(value) };
            tape.push(Object.freeze(entry)); cursor++; counts[kind]++;
            return value;
        }
        function replay(kind) {
            if (cursor >= tape.length) fail("clock tape exhausted at " + cursor + " for " + kind);
            var entry = tape[cursor];
            if (entry.kind !== kind) fail("clock event kind mismatch at " + cursor + ": expected " + entry.kind + ", got " + kind);
            cursor++; counts[kind]++;
            return kind === "Date.call" ? entry.value : bitsNumber(entry.bits);
        }
        function Date(year, month, day, hour, minute, second, millisecond) {
            if (new.target === undefined) {
                before("Date.call");
                if (mode === "replay") return replay("Date.call");
                return record("Date.call", Reflect.apply(OriginalDate, this, arguments));
            }
            if (arguments.length !== 0) return Reflect.construct(OriginalDate, Array.prototype.slice.call(arguments), new.target);
            before("Date.construct");
            if (mode === "replay") return Reflect.construct(OriginalDate, [replay("Date.construct")], new.target);
            var value = Reflect.construct(OriginalDate, [], new.target);
            record("Date.construct", Reflect.apply(originalGetTime, value, []));
            return value;
        }
        // Concise methods are nonconstructible, matching native Date.now.
        var now = { now() {
            before("Date.now");
            if (mode === "replay") return replay("Date.now");
            return record("Date.now", Reflect.apply(originalNow, this, arguments));
        } }.now;
        for (var key of Reflect.ownKeys(OriginalDate)) {
            if (key === "prototype" || key === "now") continue;
            Object.defineProperty(Date, key, Object.getOwnPropertyDescriptor(OriginalDate, key));
        }
        Object.setPrototypeOf(Date, Object.getPrototypeOf(OriginalDate));
        Object.defineProperty(Date, "prototype", Object.getOwnPropertyDescriptor(OriginalDate, "prototype"));
        Object.defineProperty(Date, "now", Object.assign({}, originalNowDescriptor, { value: now }));
        var installed = false;
        try {
            Object.defineProperty(OriginalDate.prototype, "constructor", Object.assign({}, originalConstructor, { value: Date }));
            Object.defineProperty(host, "Date", Object.assign({}, originalGlobal || { writable: true, enumerable: false, configurable: true }, { value: Date }));
            installed = true;
        } finally {
            if (!installed) Object.defineProperty(OriginalDate.prototype, "constructor", originalConstructor);
        }
        function stats() {
            return { version: 1, mode: mode, attempts: attempts, consumed: cursor,
                total: tape.length, remaining: mode === "replay" ? tape.length - cursor : 0,
                counts: { "Date.now": counts["Date.now"], "Date.construct": counts["Date.construct"], "Date.call": counts["Date.call"] },
                finished: finished, restored: restored, failure: failure };
        }
        function finish() {
            if (failure !== null) fail(failure);
            if (mode === "record" && tape.length !== cursor) fail("record clock tape was externally mutated");
            if (mode === "replay" && cursor !== tape.length) fail("clock tape has " + (tape.length - cursor) + " unconsumed event(s)");
            finished = true;
            return stats();
        }
        function restore() {
            var error;
            try { finish(); } catch (caught) { error = caught; }
            if (!restored) {
                if (originalGlobal) Object.defineProperty(host, "Date", originalGlobal);
                else delete host.Date;
                Object.defineProperty(OriginalDate.prototype, "constructor", originalConstructor);
                restored = true; active = null;
            }
            if (error) throw error;
            return stats();
        }
        var controller = { tape: tape, stats: stats, finish: finish, restore: restore };
        active = controller;
        return controller;
    };
})(globalThis);
