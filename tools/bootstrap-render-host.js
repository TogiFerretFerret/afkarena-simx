/* Stateful rendering-device boundary. Execute after the original Cocos Class
 * implementation. Native device objects preserve identity, scene attachment,
 * positions, scales, visibility and requested actions. Asset-dependent answers
 * require registered source metadata; unknown geometry/timelines fail closed.
 */
(function (host) {
    var cc = host.cc;
    var device = host.bootstrapHost;
    if (!cc || !cc.Class || !device) throw new Error("Render host requires Cocos Class and bootstrapHost");
    var nodes = [];
    var assets = Object.create(null);
    function output(kind, args) { device.recordEvent(kind, args); }
    function missing(kind, resource) { throw new Error("Missing source render " + kind + ": " + resource); }
    function pair(value, y) {
        if (typeof value === "number") return { x: value, y: y };
        if (value && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
        throw new Error("Invalid rendering-device position");
    }
    cc.p = function (x, y) { return typeof x === "object" ? { x: x.x, y: x.y } : { x: x, y: y }; };
    cc.size = function (width, height) { return typeof width === "object" ? { width: width.width, height: width.height } : { width: width, height: height }; };
    cc.rect = function (x, y, width, height) { return { x: x, y: y, width: width, height: height }; };
    cc.color = function (r, g, b, a) { return { r: r, g: g, b: b, a: a === undefined ? 255 : a }; };
    cc.affineTransformMakeIdentity = function () { return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }; };
    cc.supportSpineSelectLoad = function () { return false; };
    cc.sys.isObjectValid = function (object) {
        if (object === null || object === undefined) return false;
        if (typeof object !== "object" && typeof object !== "function") return false;
        if (typeof object.deviceNodeId !== "number") missing("native object liveness", Object.prototype.toString.call(object));
        return !object._destroyed;
    };
    cc.Node = cc.Class.extend({
        ctor: function () {
            this.deviceNodeId = nodes.length;
            nodes.push(this);
            this.x = 0; this.y = 0; this.width = 0; this.height = 0;
            this._scaleX = 1; this._scaleY = 1; this._visible = true;
            this._anchorX = 0; this._anchorY = 0; this._rotation = 0; this._opacity = 255;
            this._localZOrder = 0; this._parent = null; this._children = [];
            this._removed = false; this._destroyed = false; this._runningActions = [];
            output("node_create", [this.deviceNodeId]);
        },
        setPosition: function (value, y) { var p = pair(value, y); this.x = p.x; this.y = p.y; output("node_position", [this.deviceNodeId, this.x, this.y]); },
        setPositionX: function (x) { this.x = x; output("node_x", [this.deviceNodeId, x]); },
        setPositionY: function (y) { this.y = y; output("node_y", [this.deviceNodeId, y]); },
        getPosition: function () { return { x: this.x, y: this.y }; },
        getPositionX: function () { return this.x; }, getPositionY: function () { return this.y; },
        setScale: function (x, y) { this._scaleX = x; this._scaleY = y === undefined ? x : y; output("node_scale", [this.deviceNodeId, this._scaleX, this._scaleY]); },
        setScaleX: function (x) { this._scaleX = x; output("node_scale_x", [this.deviceNodeId, x]); },
        setScaleY: function (y) { this._scaleY = y; output("node_scale_y", [this.deviceNodeId, y]); },
        getScale: function () { if (this._scaleX !== this._scaleY) throw new Error("Nonuniform scale requires source caller axis"); return this._scaleX; },
        getScaleX: function () { return this._scaleX; }, getScaleY: function () { return this._scaleY; },
        setVisible: function (value) { this._visible = !!value; output("node_visible", [this.deviceNodeId, this._visible]); },
        isVisible: function () { return this._visible; }, isJsVisible: function () { return this._visible; },
        setContentSize: function (value, height) { this.width = typeof value === "number" ? value : value.width; this.height = typeof value === "number" ? height : value.height; },
        getContentSize: function () { return { width: this.width, height: this.height }; },
        setAnchorPoint: function (value, y) { var p = pair(value, y); this._anchorX = p.x; this._anchorY = p.y; },
        getAnchorPoint: function () { return { x: this._anchorX, y: this._anchorY }; },
        setRotation: function (value) { this._rotation = value; }, getRotation: function () { return this._rotation; },
        setOpacity: function (value) { this._opacity = value; }, getOpacity: function () { return this._opacity; },
        setColor: function (value) { this._color = { r: value.r, g: value.g, b: value.b }; },
        getColor: function () { return this._color || { r: 255, g: 255, b: 255 }; },
        setLocalZOrder: function (value) { this._localZOrder = value; }, getLocalZOrder: function () { return this._localZOrder; },
        addChild: function (child, order, tag) {
            if (!child || child === this) throw new Error("Invalid child device node");
            if (child._parent) child.removeFromParent();
            child._parent = this; child._removed = false;
            if (order !== undefined) child._localZOrder = order;
            if (tag !== undefined) child._tag = tag;
            this._children.push(child); output("node_add_child", [this.deviceNodeId, child.deviceNodeId]);
        },
        removeFromParent: function () { if (this._parent) { var children = this._parent._children; var index = children.indexOf(this); if (index !== -1) children.splice(index, 1); } this._parent = null; this._removed = true; output("node_remove", [this.deviceNodeId]); },
        removeFromParentAndCleanup: function () { this.removeFromParent(); },
        destroy: function () { this.removeAllChildren(); this.removeFromParent(); this._destroyed = true; output("node_destroy", [this.deviceNodeId]); },
        getParent: function () { return this._parent; }, getChildren: function () { return this._children.slice(); },
        getChildrenCount: function () { return this._children.length; },
        setTag: function (value) { this._tag = value; }, getTag: function () { return this._tag; },
        setName: function (value) { this._nodeName = value; }, getName: function () { return this._nodeName; },
        setUserData: function (value) { this._userData = value; }, getUserData: function () { return this._userData; },
        getChildByTag: function (tag) { for (var i = 0; i < this._children.length; i++) if (this._children[i]._tag === tag) return this._children[i]; return null; },
        removeChildByTag: function (tag) { var child = this.getChildByTag(tag); if (child) child.removeFromParent(); },
        removeChild: function (child) { if (child && child._parent === this) child.removeFromParent(); },
        removeAllChildren: function () { while (this._children.length) this._children[this._children.length - 1].removeFromParent(); },
        setCascadeOpacityEnabled: function (value) { this._cascadeOpacityEnabled = !!value; },
        setCascadeColorEnabled: function (value) { this._cascadeColorEnabled = !!value; },
        setAutoReleaseEnabled: function (value) { this._autoReleaseEnabled = !!value; },
        retain: function () { this._retains = (this._retains || 0) + 1; },
        release: function () { if (!this._retains) throw new Error("Unbalanced device node release"); this._retains--; },
        getBoundingBox: function () { return missing("bounding geometry", this.deviceNodeId); },
        convertToWorldSpace: function () { return missing("world transform", this.deviceNodeId); },
        convertToNodeSpace: function () { return missing("inverse world transform", this.deviceNodeId); },
        runAction: function (action) { return missing("action timeline", action && action.name); },
        stopAllActions: function () { this._runningActions = []; output("node_stop_actions", [this.deviceNodeId]); }
    });
    cc.Node.create = function () { return new cc.Node(); };
    cc.Sprite = cc.Node.extend({
        ctor: function () { this._super(); this._texture = null; this._textureRect = null; },
        init: function () { this._initialized = true; return true; },
        initWithTexture: function (texture, rect) {
            if (!texture) missing("sprite texture", this.deviceNodeId);
            this._texture = texture;
            if (!rect || typeof rect.width !== "number" || typeof rect.height !== "number") missing("sprite texture rectangle", this.deviceNodeId);
            this._textureRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            this.setContentSize(rect.width, rect.height);
            return true;
        },
        getTexture: function () { return this._texture; },
        setBlendFunc: function (source, destination) { this._blendFunc = { source: source, destination: destination }; }
    });
    cc.Sprite.create = function (frame) {
        var sprite = new cc.Sprite();
        sprite.init();
        if (frame !== undefined) {
            if (!frame || typeof frame.getTexture !== "function" || typeof frame.getRect !== "function") missing("sprite frame geometry", frame);
            sprite.initWithTexture(frame.getTexture(), frame.getRect());
        }
        return sprite;
    };
    cc.spriteFrameCache = { getSpriteFrame: function (name) { return missing("sprite atlas frame geometry", name); } };
    cc.loader = {
        getRes: function (path) { return assets[path]; },
        release: function (path) { delete assets[path]; output("asset_release", [path]); }
    };
    var Skeleton = cc.Node.extend({
        ctor: function (resource, atlas) {
            this._super();
            if (!assets[resource] || !assets[atlas]) missing("asset metadata", resource + ", " + atlas);
            this._resource = resource; this._atlas = atlas; this._tracks = Object.create(null);
            this._completeListener = null; this._eventListener = null;
        },
        setCompleteListener: function (callback) { this._completeListener = callback; },
        setEventListener: function (callback) { this._eventListener = callback; },
        setAnimation: function (track, name, loop) {
            var metadata = assets[this._resource].animations && assets[this._resource].animations[name];
            if (!metadata || typeof metadata.duration !== "number") missing("animation duration", this._resource + ":" + name);
            var entry = { trackIndex: track, animation: { name: name, duration: metadata.duration }, loop: !!loop, trackTime: 0 };
            this._tracks[track] = entry; output("skeleton_action", [this.deviceNodeId, track, name, !!loop]); return entry;
        },
        update: function (elapsed) { if (elapsed !== 0) missing("animation event timeline", this._resource); },
        findBone: function (name) { return missing("bone geometry", this._resource + ":" + name); },
        findSlot: function (name) { return missing("slot geometry", this._resource + ":" + name); },
        setTimeScale: function (value) { this._timeScale = value; },
        setBonesToSetupPose: function () { output("skeleton_setup_pose", [this.deviceNodeId]); },
        setSlotsToSetupPose: function () { output("skeleton_setup_slots", [this.deviceNodeId]); }
    });
    host.sp = { SkeletonAnimation: { createWithBinaryFile: function (resource, atlas, scale) { var node = new Skeleton(resource, atlas); node.setScale(scale); return node; } } };
    device.render = {
        nodes: nodes, assets: assets,
        registerAsset: function (path, sourceMetadata) {
            if (!sourceMetadata || typeof sourceMetadata !== "object") throw new Error("Asset requires source metadata");
            assets[path] = sourceMetadata;
        },
        snapshotState: function () { return { nodes: nodes, assets: assets }; }
    };
})(globalThis);
