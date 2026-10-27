/*
    @author maoxing
    date 2019/8/15
*/

window.ed = window.ed || {};

ed.configMap = {};

// web 端 region 注入：通过 URL 参数 ?region=gray|official|channel 覆盖 cc.game.region
// 不修改 game.json 文件本身
(function () {
    if (typeof cc === "undefined" || !cc.game || cc.sys.jsb) return;
    if (typeof window === "undefined" || !window.location) return;

    var match = (window.location.search || "").match(/[?&]region=([\w-]+)/);
    if (!match) return;
    var injectedRegion = match[1].toLowerCase();
    var allowed = { global: 1, gray: 1, official: 1, channel: 1 };
    if (!allowed[injectedRegion]) {
        console.warn("[region inject] invalid region: " + injectedRegion);
        return;
    }

    if (typeof cc.game._initConfig !== "function") {
        return;
    }
    var origInitConfig = cc.game._initConfig;
    cc.game._initConfig = function (config) {
        if (config && cc.game.CONFIG_KEY && cc.game.CONFIG_KEY.region) {
            console.log("[region inject] set cc.game.region from '" + config[cc.game.CONFIG_KEY.region] + "' to '" + injectedRegion + "'");
            config[cc.game.CONFIG_KEY.region] = injectedRegion;
        }
        return origInitConfig.apply(this, arguments);
    };
})();

ed.requireJson = function (jsonPath) {
    if (!cc.sys.jsb)
        return cc.loader.cache[jsonPath] || {};

    if (!cc.supportEncrypt())
        return require(jsonPath) || {};

    var fileName = cc.path.basename(jsonPath);
    if (!ed.Encrypt || !ed.Encrypt.isEncryptFile(fileName))
        return require(jsonPath) || {};

    return ed.Encrypt.decodeJson(jsonPath) || {};
};

ed.debugCsvTableMap = {
};

ed.loadConfigFile = function ( tbname ) {
    // body...

    if (ed.isTableLoaded(tbname))
        return;

    if (!tbname)
    {
        cc.log("[loadConfigFile] invalid file");
        return;
    }

    var csvJson = "";

    var regionSuffix = "";
    if(ed.loginMgr) {
        var region = ed.loginMgr.getRegion();
        if(region && region !== "") {
            region = region.replace("_rc", "");
            if(ed.regionTable && ed.regionTable[region] && ed.regionTable[region][tbname + "_" + region.toUpperCase()]) {
                regionSuffix = "_" + region.toUpperCase();
            }
        }
    }

    if (ed.isCommonFile(tbname))
    {
        // unzip path is srcmodule
        csvJson = "srcmodule/" + tbname + regionSuffix + ".json";
    } else {
        // language table dir is csvjson/lang/
        var lang = cc.game.sysLang + "/";
        csvJson = "csvjson/" + lang + tbname + regionSuffix + ".json";
    }

    if (cc.sys.jsb && cc.sys.os === cc.sys.OS_WINDOWS)
    {
        // jsb-Win 端
        var region = cc.game.region;
        //把regin首字母转成大写
        region = region.charAt(0).toUpperCase() + region.slice(1);
        var path = "csvjson/" + cc.game.sysLang + "/" + tbname + "_D" +  region + ".json";

        if (jsb.fileUtils.isFileExist(path))
        {
            csvJson = path;
            console.log("======================config_load path: " + path);
            console.log("======================config_load region: " + region);
        }
    } else if (!cc.sys.jsb) {
        //web 端：按 game.json 的 csvtable_<region> 列表登记决定是否重写到分表路径
        var webRegion = (cc.game.region || "").toString().toLowerCase();
        if (webRegion && webRegion !== "global" && cc.game.config && cc.game.config.jsList) {
            var regionList = cc.game.config.jsList["csvtable_" + webRegion];
            if (regionList) {
                var webSuffix = "_D" + webRegion.charAt(0).toUpperCase() + webRegion.slice(1);
                if (regionList.indexOf("csvjs/" + tbname + webSuffix + ".js") >= 0) {
                    csvJson = "csvjson/" + cc.game.sysLang + "/" + tbname + webSuffix + ".json";
                    console.log("======================config_load path: " + csvJson);
                    console.log("======================config_load region: " + webRegion);
                }
            }
        }
    }

    if (!cc.sys.jsb && ed.debugCsvTableMap[tbname]) {
        ed.configMap[tbname] = ed.getCSVData(tbname);
    }
    else if (cc.sys.jsb) {
        ed.configMap[tbname] = ed.requireJson(csvJson);
    }
    else {
        var xhr = cc.loader.getXMLHttpRequest();
        xhr.timeout = null;
        console.log("===========http request: " + csvJson);
        xhr.open("GET", csvJson, false);
        xhr.send(null);
        if (xhr.status === 200) {
            console.log("===========http request finished: " + csvJson);
            ed.configMap[tbname] = JSON.parse(xhr.responseText);
        }
    }

    var cache = ed.configMap[tbname];

    if (cache)
    {
        var ns = "ed";
        var table = tbname + "Table";

        if (tbname.indexOf("languageDb") >= 0)
        {
            ns = "hg";
            table = tbname;
        }

        window[ns] = window[ns] || {};
        window[ns][table] = cache[ns][table];
    }
};

/**
 * 获取 CSV 数据
 * @param {string} tbname 表名
 * @returns {Object} 数据
 */
ed.getCSVData = function (tbname) {
    var csvJson = "csv/" + tbname + ".csv";
    var xhr = cc.loader.getXMLHttpRequest();
    xhr.timeout = null;
    xhr.open("GET", csvJson, false);
    xhr.send(null);
    if (xhr.status !== 200) {
        return {};
    }
    var csvData = xhr.responseText.split("\n");
    for (var i = 0; i < csvData.length; i++) {
        csvData[i] = csvData[i].replace("\r", "");
    }
    var keyList = [];
    var typeData = csvData[0].split(",");
    var keyData = csvData[1].split(",");
    for (var i = 0; i < typeData.length; i++) {
        if (typeData[i].indexOf("K") != -1) {
            keyList.push(keyData[i]);
        }
    }
    var dataList = [];
    for (var i = 2; i < csvData.length; i++) {
        if (!csvData[i]) {
            continue;
        }
        var dataInfo = {};
        var csvLine = csvData[i].split(",");
        for (var j = 0; j < csvLine.length; j++) {
            var type = typeData[j];
            var data = csvLine[j];
            if (type.indexOf("A") != -1) {
                var dataArray = data.split(";");
                if (type.indexOf("N") != -1) {
                    for (var k = 0; k < dataArray.length; k++) {
                        dataArray[k] = Number(dataArray[k]);
                    }
                }
                data = dataArray;
            }
            else if (type.indexOf("N") != -1) {
                data = Number(data);
            }
            dataInfo[keyData[j]] = data;
        }
        dataList.push(dataInfo);
    }
    // 通用多 key 组装：_actionGroupConfig[key0][key1][key2]... = 行数据（key 数量由 CSV 首行类型含 K 的列决定）
    var dataMap = {};
    for (var i = 0; i < dataList.length; i++) {
        var dataInfo = dataList[i];
        var current = dataMap;
        var numKeys = keyList.length;
        for (var k = 0; k < numKeys - 1; k++) {
            var keyVal = dataInfo[keyList[k]];
            if (!current[keyVal]) {
                current[keyVal] = {};
            }
            current = current[keyVal];
        }
        current[dataInfo[keyList[numKeys - 1]]] = dataInfo;
    }
    var tableKey = tbname + "Table";
    var edData = {
        ed: {
            [tableKey]: dataMap,
        },
    };
    console.log('%c csv data: ' + tbname, 'color: #008800; font-weight: bold;');
    return edData;
};

ed.isTableLoaded = function ( tbname ) {
    // body...
    return (tbname && ed.configMap[tbname]) ? true : false;
};

ed.getTableCache = function ( tbname ) {
    // body...
    if (tbname)
    {
        //load
        ed.loadConfigFile( tbname );
        ed.tableCacheCleanup.touch(tbname);
        var cache = ed.configMap[tbname];
        if (cache)
        {
            var ns = "ed";
            var table = tbname + "Table";

            if (tbname.indexOf("languageDb") >= 0)
            {
                ns = "hg";
                table = tbname;
            }

            return cache[ns][table];
        }
    }

    return null;
};

ed.isCommonFile = function ( tbname ) {
    // body...

    if( cc.sys.os === cc.sys.OS_WINDOWS )
    {
        return false;
    }
	
    if (!cc.game.config.src_publish) {
		// not publish mode
        return false;
    }

    if (!ed.csvwithlanguage)
    {
        cc.log("[config_load] invalid csvwithlanguage");
        return false;
    }

    return ed.csvwithlanguage[tbname + ".json"] ? false : true;
};

ed.loadAllTable = function (tableList, callback) {
    var paths = [];
    var lang = cc.game.sysLang + "/";
    for(var i = 0; i < tableList.length; i ++) {
        var tbname = tableList[i];
        var path = "csvjson/" + lang + tbname + ".json";
        paths.push(path);
    }

    cc.loader.load(paths, function (err, data) {
        for(var i = 0; i < tableList.length; i ++) {
            var tbname = tableList[i];
            ed.configMap[tbname] = data[i];
            var cache = ed.configMap[tbname];
            if (cache)
            {
                var ns = "ed";
                var table = tbname + "Table";

                if (tbname.indexOf("languageDb") >= 0)
                {
                    ns = "hg";
                    table = tbname;
                }

                window[ns] = window[ns] || {};
                window[ns][table] = cache[ns][table];
            }
        }

        callback && callback();
    });
};

ed.tableCacheCleanup = {
    // 记录普通表的剩余缓存时间；功能关闭时不追踪，避免高配设备产生额外清理行为。
    timeMap: {},
    ttlSeconds: 120,
    enabled: false,
    lastPreBattleResult: null,

    // 永久保护表：不进入 TTL 计时，也不会被任何表缓存清理流程释放。
    permanentWhiteList: {
        "Backflow": true,
        "Charge": true,
        "ChargeGoods": true,
        "ClientCsvMask": true,
        "languageDb": true,
        "UnitPuppet": true,
        "AnimDuration": true,
        "Activity": true,
        "ParamOpenCondition": true,
        "Sidebar": true,
        "BattlePass": true,
        "ActivityBanner": true,
        "TaskLine": true,
        "CommunityIpActivity": true,
        "Community": true,
        "Trigger": true,
        "ActivitySidebar": true,
        "Param": true,
        "VIP": true,
        "ParamHiden": true,
        "UnitTag": true,
        "UnitGS": true,
        "AssistStageParam": true,
        "SoundFcaActionList": true,
        "AnimAtkFrame": true,
        "SoundAnim": true,
        "SoundEffect": true
    },

    // 进战保护表：只在进战批量清理时跳过并刷新 TTL，战后仍可按常规定时流程释放。
    preBattleWhiteList: {
        "UnitPortrait": true,
        "ParamSceneMode": true,
        "Skin": true,
        "UnitQuality": true,
        "PetLevelAttribute": true,
        "UnitRes": true,
        "ArtifactRank": true,
        "Mitama": true,
        "MitamaAffixIdx": true,
        "MitamaLevel": true,
        "MitamaAffixAttr": true,
        "MitamaParam": true,
        "AstrolabeTag": true,
        "Troop": true,
        "TotemNode": true,
        "TotemNodeSpecial": true,
        "TotemNodeLv": true,
        "TotemTotalLv": true,
        "UnitRank": true,
        "UnitLevel": true,
        "SignaturePower": true,
        "HomelandConfig": true,
        "Signature": true,
        "SignatureLevel": true,
        "Astrolabe": true,
        "DragonStelaLevel": true,
        "HomelandHeroTagProperty": true,
        "HomelandAstrolabeTagProperty": true,
        "HomelandHeroIDTagProperty": true,
        "HomelandHeroIDTagAdvancedProperty": true,
        "UnitTexas": true,
        "WarEffect": true,
        "PetJobLevel": true,
        "Epitagh": true,
        "EpitaghMaster": true,
        "SkillBuff": true,
        "EquipResonate": true,
        "MitamaBasicAttr": true,
        "UnitPeriod": true,
        "TipsLongPress": true,
        "UnitQualityLevel": true,
        "TotemStarColor": true,
        "SoundTimelineActionList": true,
        "UnitSkinComponentSet": true
    },

    // 切换清理策略时重建计时状态，确保已加载的表也能从完整 TTL 开始计时。
    setEnabled: function(enabled) {
        this.enabled = !!enabled;
        if(!this.enabled) {
            this.timeMap = {};
            return;
        }

        var tableNames = Object.keys(ed.configMap);
        for(var i = 0; i < tableNames.length; i++) {
            var tableName = tableNames[i];
            if(ed.configMap[tableName]) {
                this.touch(tableName);
            }
        }
    },

    // 永久保护范围同时包含客户端固定白名单和服务器补丁表。
    isProtected: function(name) {
        if(this.permanentWhiteList[name]) {
            return true;
        }

        var clientCsvMask = ed.configMap && ed.configMap.ClientCsvMask;
        var clientCsvMaskTable = clientCsvMask && clientCsvMask.ed && clientCsvMask.ed.ClientCsvMaskTable;
        return !!(clientCsvMaskTable && clientCsvMaskTable[name]);
    },

    // 普通表每次被访问后刷新 TTL，永久保护表则从计时集合中移除。
    touch: function(name) {
        if(!this.enabled) {
            return;
        }

        if(this.isProtected(name)) {
            delete this.timeMap[name];
        } else {
            this.timeMap[name] = this.ttlSeconds;
        }
    },

    addPermanentWhiteList: function(tbname) {
        this.permanentWhiteList[tbname] = true;
        delete this.timeMap[tbname];
    },

    // 同时断开配置原始缓存和运行时快捷引用；外部已持有的对象引用不在这里强制释放。
    remove: function(tbname) {
        if(!tbname || this.isProtected(tbname)) {
            return false;
        }

        if(ed.configMap) {
            ed.configMap[tbname] = null;
        }
        if(tbname.indexOf("languageDb") >= 0) {
            if(typeof hg !== "undefined") {
                hg[tbname] = null;
            }
        } else {
            ed[tbname + "Table"] = null;
        }
        delete this.timeMap[tbname];
        return true;
    },

    // 按剩余 TTL 从小到大批量清理，并返回实际删除结果供运行时回归检查。
    clearByRemainingTime: function(maxRemainingSeconds, maxRemoveCount, reason) {
        var cleanup = this;
        var threshold = Number(maxRemainingSeconds);
        var removeLimit = Number(maxRemoveCount);
        var result = {
            enabled: cleanup.enabled,
            reason: reason || "",
            maxRemainingSeconds: threshold,
            removedCount: 0,
            removedTables: []
        };
        if(!cleanup.enabled) {
            return result;
        }

        var keys = Object.keys(cleanup.timeMap);
        if(!isFinite(removeLimit) || removeLimit < 0) {
            removeLimit = keys.length;
        } else {
            removeLimit = Math.floor(removeLimit);
        }
        keys.sort(function(a, b) {
            return Number(cleanup.timeMap[a]) - Number(cleanup.timeMap[b]);
        });

        for(var i = 0; i < keys.length; i++) {
            var tbname = keys[i];
            // 永久保护表不参与倒计时，发现残留记录时直接移除计时项。
            if(cleanup.isProtected(tbname)) {
                delete cleanup.timeMap[tbname];
                continue;
            }
            // 进战仍可能读取的表保留，并恢复完整 TTL，避免战斗加载阶段立即到期。
            if(reason === "before_battle" && cleanup.preBattleWhiteList[tbname]) {
                cleanup.timeMap[tbname] = cleanup.ttlSeconds;
                continue;
            }
            if(result.removedCount >= removeLimit || Number(cleanup.timeMap[tbname]) > threshold) {
                continue;
            }
            if(cleanup.remove(tbname)) {
                result.removedCount++;
                result.removedTables.push(tbname);
            }
        }
        return result;
    },

    // 进战前只清理近期未使用的普通表，默认阈值为剩余 TTL 60 秒。
    clearBeforeBattle: function(maxRemainingSeconds) {
        var threshold = typeof maxRemainingSeconds === "number" ? maxRemainingSeconds : 60;
        return this.clearByRemainingTime(
            threshold,
            Object.keys(this.timeMap).length,
            "before_battle"
        );
    },

    // 常规定时流程每 10 秒调用一次，每轮最多释放一张已经到期的表。
    checkExpired: function() {
        if(!this.enabled) {
            return;
        }

        var removeTableList = [];
        var removeCnt = 1;
        var keys = Object.keys(this.timeMap);
        for(var i = 0; i < keys.length; i ++) {
            var key = keys[i];
            if(this.isProtected(key)) {
                delete this.timeMap[key];
                continue;
            }
            this.timeMap[key] -= 10;
            if(removeCnt > 0 && this.timeMap[key] <= 0) {
                removeTableList.push(key);
                removeCnt --;
            }
        }

        for(var j = 0; j < removeTableList.length; j ++) {
            var tbname = removeTableList[j];
            if(this.remove(tbname)) {
                console.log("remove useless table:" + tbname);
            }
        }
    }
};

ed.isConfigExist = function (tbname) {
    // body...

    var bRet = true;

    if (cc.sys.jsb)
    {
        if (!tbname)
            bRet = false;

        var ext = ".jsonc";

        if (cc.supportEncrypt())
            ext = ".jsone";

        if (cc.sys.os === cc.sys.OS_WINDOWS)
        {
            ext = ".json";
        }

        var path = "";
        if (ed.isCommonFile(tbname))
        {
            // unzip path is srcmodule
            path = "srcmodule/" + tbname + ext;
        } else {
            // language table dir is csvjson/lang/
            var lang = cc.game.sysLang + "/";
            path = "csvjson/" + lang + tbname + ext;
        }

        bRet = jsb.fileUtils.isFileExist(path);

        if (cc.sys.os === cc.sys.OS_WINDOWS)
        {
            path = "csvjson/" + cc.game.sysLang + "/" + tbname + "_D" +  cc.game.region + ext;

            if (jsb.fileUtils.isFileExist(path))
            {
                bRet = true;
            }
        }
    }

    return bRet;
};