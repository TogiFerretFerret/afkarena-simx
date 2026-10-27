(function installStageBodyAttachmentProjection(proof) {
    var originalEnsure = ed.SpineActor.prototype._ensureSpineEffectComponent;
    if (Function.prototype.toString.call(originalEnsure) !== proof.ensureSource) throw new Error("Source body projection ensure-method proof changed");
    var states = new WeakMap();
    function fail(reason) { throw new Error("Unsupported source body attachment projection: " + reason); }
    function stage() {
        if (!ed.battleEngine || ed.battleEngine.mode !== "stage" || !ed.battleEngine.config || ed.battleEngine.config.mode !== "stage" || ed.useSpinePool) fail("stage/no-pool contract");
    }
    function verifyOwner(state) {
        stage();
        var owner = state.owner;
        if (owner._name !== "VegelfMini" || owner._curAction !== "atk" || owner._isLoop || owner._onEvent !== null || owner._onActionFinished !== null || owner._actionFinishedCallback || owner.model || owner._actionSequence.length) fail("standalone nonlooping VegelfMini atk owner");
    }
    function prepare(component, owner) {
        if (!component || component._heroName !== "VegelfMini" || states.has(component)) return;
        var originalGet = component.getFrameEffectData;
        if (Function.prototype.toString.call(originalGet) !== proof.getFrameEffectDataSource) fail("frame-effect factory proof changed");
        var state = { owner: owner, names: Object.create(null), admitted: false };
        states.set(component, state);
        component.getFrameEffectData = function (name, action) {
            verifyOwner(state);
            if (this._actionName !== "atk" || action !== "Start" || state.names[name]) fail("single frame-zero creation per attachment name");
            if (!state.admitted) {
                var rows = this._config && this._config.atk;
                if (!Array.isArray(rows) || rows.length !== 2 || this._preActionPlayedTime !== 0 || !(state.owner._playTimes > 0)) fail("first positive update of pinned two-attachment atk");
                var names = Object.create(null);
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    if (row.frame !== 0 || row.type !== 1 || row.life_delay || row.skin !== "all" || row.action !== "Start" || names[row.name] || proof.attachmentNames.indexOf(row.name) === -1 || ed.SkillAnimation[row.name]) fail("frame-zero unique root-only attachment schema");
                    names[row.name] = true;
                }
                state.allowedNames = names; state.admitted = true;
            }
            if (!state.allowedNames[name]) fail("unknown attachment");
            // Run the original factory/constructors/retain/events FIRST. In this
            // single-action schema each name is constructed once, so missing
            // private clip-end/cache timing cannot change later ClassManager IDs.
            var data = originalGet.call(this, name, action), effect = data && data.effect;
            if (!effect || Object.getPrototypeOf(effect) !== ed.SpineEffect.prototype || effect._spineEffectComponent || effect.model || effect._onEvent !== null || effect._onActionFinished !== null || effect._actionFinishedCallback || effect._effects.length) fail("private leaf effect without nested components or callbacks");
            state.names[name] = true;
            effect.update = function (elapsed) {
                verifyOwner(state);
                if (this.model || this._onEvent !== null || this._onActionFinished !== null || this._actionFinishedCallback || this._spineEffectComponent || this._effects.length) fail("body effect gained a logical callback/reference");
                bootstrapHost.recordEvent("projected_spine_body_update", [this.deviceNodeId, name, elapsed, this.sStartAction, this.sLoopAction]);
                // Only private physical attachment animation state is projected.
                // No substitute duration or fabricated completion is returned.
            };
            bootstrapHost.recordEvent("projected_spine_body_attach", [effect.deviceNodeId, owner._skeletonAnimation.deviceNodeId, name]);
            return data;
        };
    }
    ed.SpineActor.prototype._ensureSpineEffectComponent = function () {
        var result = originalEnsure.apply(this, arguments);
        if (this._name === "VegelfMini") prepare(this._spineEffectComponent, this);
        return result;
    };
    return { kind: "stage-VegelfMini-single-atk-physical-body-projection-v1", qualifiesForWholeBattleFidelity: false };
})
