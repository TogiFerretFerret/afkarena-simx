/* Explicit headless Linux device boundary, shared unchanged by Node and AOT.
 * Original game sound/config/callback functions execute normally. This adapter
 * records platform/device output and assigns stable audio IDs; it renders or
 * plays no physical media. It does not implement battle mechanics or RNG.
 */
(function (host) {
    var cc = host.cc || (host.cc = {});
    var events = [];
    var nextAudioId = 1;
    var effects = Object.create(null);
    var music = null;
    var effectVolume = 1;
    var musicVolume = 1;
    var storage = Object.create(null);
    var listeners = [];
    var nextListenerId = 1;
    var traceObserver = null;
    function event(kind, args) {
        var record = { kind: kind, args: Array.prototype.slice.call(args) };
        events.push(record);
        if (traceObserver) traceObserver(record, events.length - 1);
    }
    cc.sys = {
        os: "Linux", OS_LINUX: "Linux", OS_IOS: "iOS", OS_ANDROID: "Android", OS_WINDOWS: "Windows",
        jsb: false, isNative: false, isBrowser: false,
        platform: 101, DESKTOP_BROWSER: 101, WIN32: 0,
        localStorage: {
            getItem: function (key) { event("storage_get", arguments); return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
            setItem: function (key, value) { event("storage_set", arguments); storage[key] = String(value); },
            removeItem: function (key) { event("storage_remove", arguments); delete storage[key]; },
            clear: function () { event("storage_clear", arguments); storage = Object.create(null); }
        }
    };
    host.localStorage = cc.sys.localStorage;
    cc.winSize = { width: 1280, height: 720 };
    cc.audioEngine = {
        playEffect: function (file, loop) {
            var id = nextAudioId++;
            effects[id] = { file: file, loop: !!loop, paused: false };
            event("audio_play_effect", [id, file, !!loop]);
            return id;
        },
        stopEffect: function (id) { event("audio_stop_effect", arguments); delete effects[id]; },
        stopAllEffects: function () { event("audio_stop_all_effects", arguments); effects = Object.create(null); },
        pauseEffect: function (id) { event("audio_pause_effect", arguments); if (effects[id]) effects[id].paused = true; },
        resumeEffect: function (id) { event("audio_resume_effect", arguments); if (effects[id]) effects[id].paused = false; },
        pauseAllEffects: function () { event("audio_pause_all_effects", arguments); for (var id in effects) effects[id].paused = true; },
        resumeAllEffects: function () { event("audio_resume_all_effects", arguments); for (var id in effects) effects[id].paused = false; },
        setEffectsVolume: function (value) { event("audio_effects_volume", arguments); effectVolume = value; },
        getEffectsVolume: function () { return effectVolume; },
        playMusic: function (file, loop) { var id = nextAudioId++; music = { id: id, file: file, loop: !!loop, paused: false }; event("audio_play_music", [id, file, !!loop]); return id; },
        stopMusic: function () { event("audio_stop_music", arguments); music = null; },
        pauseMusic: function () { event("audio_pause_music", arguments); if (music) music.paused = true; },
        resumeMusic: function () { event("audio_resume_music", arguments); if (music) music.paused = false; },
        isMusicPlaying: function () { return music !== null && !music.paused; },
        setMusicVolume: function (value) { event("audio_music_volume", arguments); musicVolume = value; },
        getMusicVolume: function () { return musicVolume; }
    };
    cc.eventManager = {
        addCustomListener: function (name, callback, target) {
            var listener = { id: nextListenerId++, name: name, callback: callback, target: target };
            listeners.push(listener);
            event("event_listener_add", [listener.id, name]);
            return listener;
        },
        removeListener: function (listener) {
            event("event_listener_remove", [listener && listener.id]);
            var index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
        },
        dispatchCustomEvent: function (name, data) {
            event("event_dispatch", [name]);
            var current = listeners.slice();
            var message = { getUserData: function () { return data; }, getEventName: function () { return name; } };
            for (var i = 0; i < current.length; i++) if (current[i].name === name) {
                event("event_listener_before", [current[i].id, name]);
                current[i].callback.call(current[i].target, message);
                event("event_listener_after", [current[i].id, name]);
            }
        }
    };
    if (!cc.log) cc.log = function () { event("log", arguments); };
    host.bootstrapHost = {
        version: 1,
        audioEnabled: true,
        platform: "headless-linux-device-output",
        events: events,
        recordEvent: event,
        setTraceObserver: function (observer) {
            if (observer !== null && typeof observer !== "function") throw new Error("Invalid device trace observer");
            traceObserver = observer;
        },
        audioState: function () { return { nextAudioId: nextAudioId, effects: effects, music: music, effectVolume: effectVolume, musicVolume: musicVolume }; },
        snapshotState: function () {
            return { nextAudioId: nextAudioId, effects: effects, music: music,
                effectVolume: effectVolume, musicVolume: musicVolume, storage: storage,
                listeners: listeners, nextListenerId: nextListenerId,
                render: host.bootstrapHost.render ? host.bootstrapHost.render.snapshotState() : null };
        }
    };
})(globalThis);
