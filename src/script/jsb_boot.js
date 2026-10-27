/*
 * Copyright (c) 2015-2017 Chukong Technologies Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var layer = null;

var __TRACEBACK__ = function( _js_log_buf )
{
	if (!layer)
	{
		var winSize = cc.director.getWinSize();
		var layer = ccui.Layout.create();
		layer.setBackGroundColorType(1);
		layer.setSwallowTouches(true);
		layer.setBackGroundColor(cc.color(0,0,0,255));
		layer.addTouchEventListener(function(sender, eventType){
			if (eventType === ccui.Widget.TOUCH_ENDED || eventType === ccui.Widget.TOUCH_CANCELED)
			{
				layer.removeFromParent(true);
				layer = null;
			}
		})
		layer.setAnchorPoint(cc.p(0.5,0.5));
		layer.setContentSize(winSize);
        if(ed){
		var scene = ed.getCurrentScene();
		scene.addChild(layer,1000000);
        }
		var label = cc.LabelTTF.create(_js_log_buf, "Arial", 24);
		label.setDimensions(cc.size(winSize.width,0));
		label.setPosition(cc.p(winSize.width/2, winSize.height/2))
		layer.label = label;
		layer.setPosition(cc.p(winSize.width/2,winSize.height/2))
	}

	layer.label.setString(_js_log_buf);
}


var __garbage_js_binded_object_count__ = 0;
var __garbage_collect_threshold__ = 20;
var __garbage_collect_total_time__ = 0;
var __garbage_collect_frame_times__ = 1;
var __garbage_collect_std_time__ = 90;
var __garbage_collect_interval__ = __garbage_collect_std_time__ / __garbage_collect_frame_times__;

cc.log = function () {
	// body...
	log(cc.formatStr(cc.formatStr.apply(cc, arguments)));
};


cc.isGCScene = function (argument) {
	// body...
	if (!cc.sys.jsb2)
	{
		return false;
	}

	if (ed && ed.isNonBattleScene())
		return true;

	return false;
};

cc.garbageCollect = function ( dt ) {
	// body...

	return;

	
	if (!cc.sys.jsb2 || !cc.isGCScene())
	{
		return;
	}

	__garbage_collect_total_time__ += dt;

	if (__garbage_collect_total_time__ >= __garbage_collect_interval__)
	{

		var currJSBindedObjectCount = cc.sys.getJSBindingObjectCount();
		if (currJSBindedObjectCount - __garbage_js_binded_object_count__ >= __garbage_collect_threshold__)
		{
			cc.sys.garbageCollect();
			__garbage_js_binded_object_count__ = cc.sys.getJSBindingObjectCount();

		}
		__garbage_collect_total_time__ -= __garbage_collect_interval__;
	}
};

//
// cocos2d boot
//
cc.appendLanguagedb = function(key,value){
	hg.languageDb[key] = value;
};

dsBridge = {
	call: function(name, obj) {
		if(typeof obj == 'string') {
			obj = {"msg":obj};
		}
		return hg.jsbDsbridge.getInstance().call(name, obj, JSON.stringify(obj));
	},

	isLowSystem: function (argument) {
		// body...

		var bridge = hg.jsbDsbridge.getInstance();

		if (bridge.isLowSystem)
			return bridge.isLowSystem();

		return false;
	}
};

__getCurrentStackTrace = function (argument) {
	// body...
	return new Error().stack;
};

var HD_RES = "_HD";
cc.isHDResource = function ( url, force) {
	// body...
	var bRet = false;

	if (!url || (!force && !cc.enableHD))
		return bRet;

	var index = url.indexOf(HD_RES);

	bRet = index >= 0;

	return bRet;
};

cc.enableHD = true;

cc.isHDOpened = function (argument) {
	// body...
	var hd_settings = window.localStorage.getItem("hgame_hd_settings");
	return hd_settings && hd_settings === "true";
};

/**
 * ASTC support
 * @returns {boolean|*}
 */
cc.isSupportAstc = function () {
    if (cc._supportAstc == null)
    {
        if (!cc.sys.jsb)
            cc._supportAstc = false;
        else if (cc.sys.os !== cc.sys.OS_ANDROID && cc.sys.os !== cc.sys.OS_IOS)
            cc._supportAstc = false;
        else if (cc.Director.isSupportAstc)
            cc._supportAstc = cc.Director.isSupportAstc();
        else
            cc._supportAstc = false;
    }
    return cc._supportAstc;
};

cc.deviceHeroExt = function(){
    // 支持astc的设备返回 fcasz
    if (cc.isSupportAstc())
        return "fcasz";

	return "fcapz";
};

cc.deviceUiExt = function(){
    if (cc.isSupportAstc())
        return "apz";

	return "ppz";
};

cc.devicePlistExt = function( url ){
    if (cc.isSupportAstc())
        return ".plist";

	return ".plist";
};

cc.deviceAtlasExt = function( url ){
    if (cc.isSupportAstc())
        return ".atlas";

    return ".atlas";
};

cc.supportDeviceImage = function (argument) {
	// body...
	return cc.sys.lz_device_image && cc.sys.supported_device_image && cc.game.enbaleDeviceImage;
};

cc.devicePictureExt = function( url )
{
	if (cc.supportDeviceImage())
	{
		if (cc.isDeviceImage(url))
			return cc.deviceImageExt();
	}

	return ".pvr";
};

cc.isPngOrJpgType =  function ( url ) {
	// body...
	return url && (url.endsWith(".png") || url.endsWith(".jpg"));
}

cc.getGameCdn = function(forceMainCdn)
{
	//cc.game.cdnSubPath
	if (cc.game.cdnSubPath === "" || forceMainCdn)
		return cc.game.cdn + "/" + cc.game.region + "/" + cc.game.version + "/";
	else
		return cc.game.cdn + "/" + cc.game.cdnSubPath + "/" + cc.game.region + "/" + cc.game.version + "/";
};

cc.getStandardCDN = function ( cdn ) {
	console.log("cdn res dir: " + cc.game.resDir);
	return cdn + cc.game.resDir + "/";
};

cc.getDownloadData = function()
{
	//base
	var backDownLoadList = ed.getBackDownLoad();

	var downLoadList = filterLanguageRes(backDownLoadList);

	//extra
	var extraList = cc.getExtraLocalList();
	downLoadList = downLoadList.concat(extraList);
	//if hd opened
	if (cc.enableHD && cc.isHDOpened())
	{
		var hdList = cc.getHDLocalList();
		downLoadList = downLoadList.concat(hdList);
	}

	var otherDownloadList = cc.getOtherDownloadList();
	downLoadList = downLoadList.concat(otherDownloadList);

	var traverseList = downLoadList;
	downLoadList = [];
	for (var i = 0; i < traverseList.length; i++) {
		var obj = traverseList[i];
		var config = cc.game.fileConfig[obj.path];
		if (!config)
			continue;

		if (obj.path.charAt(0) === "/")
			obj.path = obj.path.substring(1);

		downLoadList.push(obj);
	}

    //downLoadList = cc.filterOutDateFiles(downLoadList);
	cc.sortBackDownloadList(downLoadList);

	return downLoadList;
};

/**
 * 支持 astc 的设备上，选出 astc 资源
 * 不支持 astc 的设备上，去掉 astc 资源
 */
cc.filterAstcAssets = function (inputArr) {
    var outputArr = [];
    if (cc.isSupportAstc())
    {
        var exceptExtMap = {
            "fcapz": true,
            "fcatz": true,
            "lzap": true,
            "lzip": true,
            "ppz": true,
            "tpz": true,
        };

        for (var i = 0; i < inputArr.length; i++)
        {
            var fileName = inputArr[i];
            var index = fileName.lastIndexOf(".");
            var ext = fileName.substr(index + 1);
            if (!exceptExtMap[ext])
            {
                outputArr.push(inputArr[i]);
            }
        }
    }
    else
    {
        var exceptExtMap = {
            "fcasz": true,
            "lzas": true,
            "apz": true,
        };

        for (var i = 0; i < inputArr.length; i++)
        {
            var fileName = inputArr[i];
            var index = fileName.lastIndexOf(".");
            var ext = fileName.substr(index + 1);
            if (!exceptExtMap[ext])
            {
                outputArr.push(inputArr[i]);
            }
        }
    }
    return outputArr;
};

var targetFolderPriorityMap = {
	"res/ui/furniture": 4,
	"res/ui/avatar_frame": 4,
	"res/ui/hero_icon": 4,
	"res/ui/illustration_images": 4,
	"res/ui/item_icon": 4,
	"res/ui/nameplate": 4,
	"res/ui/signature": 4,
	"res/fcaz/hero":6,
	"res/ui/plist/raid_":6,
	"effect/eff_UI_raid_":6,
	"res/ui/panel/share": 8
};

// 此处增加apz，fcasz，lzas没有影响
var fileTypePriorityMap = {
	".tpz": 1,
	".ppz": 1,
    ".apz": 1,

	".fcapz": 2,
	".fcatz": 2,
    ".fcasz": 2,

	".lzap": 3,
	".lzip": 3,
    ".lzas": 3,

	".png": 5,
	".jpg": 5,

	".fsb": 7
};

cc.getBackDownloadPriority = function (filePath, priorityConfig) {
	for (var key in priorityConfig) {
		var config = priorityConfig[key];
		if (filePath.indexOf(config["FileName"]) > -1) {
			return (parseInt(config["Priority"]) - 10000);
		}
	}

	for(var key in targetFolderPriorityMap){
		if(filePath.indexOf(key) > -1){
			return parseInt(targetFolderPriorityMap[key]);
		}
	}

	var fileType = cc.path.extname(filePath);
	if(fileTypePriorityMap[fileType]){
		return parseInt(fileTypePriorityMap[fileType]);
	}

	return 99;
};

cc.preprocessPriorityMap = function (downLoadList) {
	var priorityMap = {};
	var priorityConfig = ed.lookupDataTable("PackageDownloadPopPriority");
	for (var i = 0; i < downLoadList.length; i++) {
		var path = downLoadList[i].path;
		var priority = cc.getBackDownloadPriority(path, priorityConfig);
		priorityMap[path] = priority;
	}
	return priorityMap;
},

cc.sortBackDownloadList = function(downLoadList){
	if(downLoadList && downLoadList.length > 0){
		var priorityMap = cc.preprocessPriorityMap(downLoadList);
		downLoadList.sort(function (a, b) {
			var priorityA = priorityMap[a.path];
			var priorityB = priorityMap[b.path];
			return priorityA - priorityB;
		});
	}
	/*for(var i = 0;i < downLoadList.length;i++){
		var tempPath = downLoadList[i].path;
		console.log("sortBackDownloadList: " + tempPath);
	}*/
};

cc.handleBackdownload = function (argument) {
	// body...

	if(cc.game.isReviewMode){
	    return;//审核模式，关闭后台下载
	}

	var list = cc.getHDBackdownloadList();
	var localList = cc.getHDLocalList();
	list = list.concat(localList);

	var resMgr = hg.ResourceManager.getInstance();
	if (resMgr.addDownloadTask)
		resMgr.addDownloadTask(list);

	//download launch
	cc.startDownload(true);
	ed.fireEvent("DOWNLOAD_UPDATE", true);

	console.log("handle hd resources finished: ", list.length);
};

cc.getHDBackdownloadList = function (argument)
{
	// body...
	var backDownLoadList = ed.getBackDownLoad();

	var retList = [];

	if(!backDownLoadList || backDownLoadList.length <= 0)
		return retList;

	for (var i = 0; i < backDownLoadList.length; i++) {
		var obj = backDownLoadList[i];
		if (cc.isHDResource(obj.path, true))
		{
			retList.push(obj);
		}
	}

	return retList;
};

cc.getHDLocalList = function (argument) {
	// body...

	var retList = [];

	var hdFile = "hdbackdownload.json";
	var extra = "extra";

	var fileContent = null;
	if (jsb.fileUtils.isFileExist(hdFile))
	{
		fileContent = require(hdFile)
	}

	if (fileContent)
	{
		retList = fileContent[extra] || [];
	}

	var extraFile = "extrabackdownload.json";
	var content = null;
	if (jsb.fileUtils.isFileExist(extraFile))
	{
		content = require(extraFile)
	}

	if (content)
	{
		var fileList = content[extra] || [];
		for (var i = 0; i < fileList.length; i++) {
			var obj = fileList[i];

			if(cc.isHDResource(obj.path, true))
			{
				retList.push(obj);
			}
		}
	}

	return retList;
};

//extra
cc.getExtraLocalList = function (argument) {
	// body...

	var retList = [];

	var extraFile = "extrabackdownload.json";
	var extra = "extra";

	var fileContent = null;
	if (jsb.fileUtils.isFileExist(extraFile))
	{
		fileContent = require(extraFile);
	}

	if (fileContent)
	{
		var fileList = fileContent[extra] || [];
		for (var i = 0; i < fileList.length; i++) {
			var obj = fileList[i];

			if(cc.isHDResource(obj.path, true))
				continue;

			retList.push(obj);
		}
	}

	return retList;
};

cc.getOtherDownloadList = function() {
	var ret = [];

	if(!jsb.fileUtils.isFileExist("res/font/hgame_font_digit.ttf")) {
		var path = "res/font/hgame_font_digit.zip";
		var config = cc.game.fileConfig[path] || {};
		ret.push({path: "res/font/hgame_font_digit.zip", size: config.size || 20000});
	}

	var lang = cc.game.sysLang;
	if (lang === "en" || lang === "cn" || lang === "zh" || lang === "jp")
	{
		var ft = "res/font/hgame_font_title_{0}.ttf".format([lang]);
		var path = "res/font/hgame_font_title_{0}.zip".format([lang]);
		if(!jsb.fileUtils.isFileExist(ft)) {
			var config = cc.game.fileConfig[path] || {};
			ret.push({path: path, size: config.size || 20000});
		}
	}

	return ret;
};

cc.getHDBackDownloadData = function (argument) {
	// body...

	var list = cc.getHDBackdownloadList();
	var localList = cc.getHDLocalList();
	list = list.concat(localList);

	var size = 0;
	for (var i = 0; i < list.length; i++) {
		var obj = list[i];
		if (cc.isHDResource(obj.path, true))
		{
			var utils = jsb.fileUtils;
			//var resMgr = hg.ResourceManager.getInstance();
			if(!utils.isFileExist(obj.path))
				size += obj.size;
		}
	}

	//bytes
	var RATE_M = 1024 * 1024;
	var RATE_K = 1024;

	var threshold = 1024 * 10;

	var currSuffix = "MB";
	var currRate = RATE_M;

	if (size <= threshold && size > 0)
	{
		currRate = RATE_K;
		currSuffix = "KB";
	}

	var currM = (size / currRate).toFixed(2);

	//bytes
	return { size: currM + currSuffix, show: size > 0};
};

cc.filterOutDateFiles = function(backlist) {
    // 谜团资源导致闪退问题，要放到线上最低版本是34(灰度35)以上
	var finalList = [];
	var downLoadList = backlist;
	for(var i=0;i<downLoadList.length;i++){
		var filePath = downLoadList[i].path;
		if(!filePath.match(".+?Mystic.+?\.(fcaz|fcapz|fcaiz|fcatz)")) {
			finalList.push(downLoadList[i]);
		}
	}
	return finalList;
};


cc.languageCodeWithHeroVoice = {//有英雄语音的语言code
    "cn": true,
    "zh": true,
    "en": true,
	"kr": true,
	"jp": true
};

function filterLanguageRes(backDownLoadList){
	var finalList = [];
	var heroVoiceType = "en";


	if(!backDownLoadList || backDownLoadList.length === 0){
		return finalList;
	}

	var lang = cc.game.sysLang;

	var resMgr = hg.ResourceManager.getInstance();

	if (resMgr.getCurrLanguage)
	{
		lang = resMgr.getCurrLanguage();

		console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>lang: " + lang);
	}

	if(cc.languageCodeWithHeroVoice[lang]){//当前使用语言有语音
		heroVoiceType = cc.game.sysLang;
	}

	var isHDOpened = cc.isHDOpened();

	for(var i=0;i < backDownLoadList.length;i++){
		var filePath = backDownLoadList[i].path;

		if(!isHDOpened && cc.isHDResource(filePath, true))
			continue;

		var list = cc.game.CONFIG_KEY.filterLangList;
		var j = 0;
		var isLan = false;
		while(j < list.length){
			var lan = list[j++];
			if(filePath.match("_"+lan+"[/.]")) {
				isLan = true;
				if(lan == heroVoiceType){

					finalList.push(backDownLoadList[i]);
				}
				break;
			}
		}
		if(!isLan){
			finalList.push(backDownLoadList[i]);
		}
	}
	return finalList;
};

cc.startDownload = function( ignoreCheck )
{
    var resMgr = hg.ResourceManager.getInstance();
	if (!ignoreCheck)
	{
		var isFinished = resMgr.isDownloadFinished();
		if (isFinished)
		{
            // 尝试唤起预下载
            if (cc.game.checkSupportPreDownload() && resMgr.isPreDownloadFinished && !resMgr.isPreDownloadFinished())
            {
                cc.reportPreDownload("start");
                resMgr.checkResumePreDownload();
            }

			return;
		}
	}

    if (cc.game.checkSupportPreDownload() && resMgr.pausePreDownload)
        resMgr.pausePreDownload(); // 停掉预下载

    resMgr.resumeDownload();
    resMgr.registerScriptHandler(function(curr, total, currBytes, totalBytes){
		var data = {
			curr: curr,
			total: total,
			currBytes: currBytes,
			totalBytes: totalBytes
		}
		ed.fireEvent("DOWNLOAD_EVENT", data);
	});

	//unzip
    resMgr.launchUnZip();
};

cc.startPreDownload = function( ignoreCheck )
{
    if (!cc.game.checkSupportPreDownload())
        return;

    var resMgr = hg.ResourceManager.getInstance();
    var isFinished = resMgr.isDownloadFinished();
    if (!isFinished)
        return;

    if (!ignoreCheck)
    {
        var isPreFinished = resMgr.isPreDownloadFinished();
        if (isPreFinished)
        {
            // window.localStorage.setItem("PRE_DOWNLOAD_STATUS", "end");
            return;
        }
    }

    cc.reportPreDownload("start");
    resMgr.checkResumePreDownload();
};

/**
 * 预下载打点
 * @param type "start" or "end"
 */
cc.reportPreDownload = function (type) {
    if (!cc.game.localNextVersion)
        return;

    var versionArr = cc.game.localNextVersion.split('.');
    ed.reportUserDataFormated("preload", [type, versionArr[1], cc.game.localNextVersion]);
};

cc.getTimeoutForRead = function()
{
	return cc.game.timeout || 60;
};

cc.logBugly = function(){
	// cc.log(cc.formatStr.apply(cc, arguments));
	if (dsBridge){
		dsBridge.call("log2bugly", cc.formatStr.apply(cc, arguments));
	}
};
cc.llhNetworkDiagnosis = function(url,isHttp){
	if(ed.LLHNetworkDiagnosis && ed.LLHNetworkDiagnosis.llhNetworkDiagnosis){
		ed.LLHNetworkDiagnosis.llhNetworkDiagnosis(url,isHttp);
	}
}

cc.isShowErrorPanel =  function()
{
	return cc.game.whitelistOpened;
};


cc.isPublicResource = function (argument) {
	// body...
	return cc.game.res_publish;
};

cc.fireEvent = function(eventName, data) {
    if(!eventName) return;
    ed.fireEvent(eventName);
};

/**
 * texture manager release
 */

cc.onFlyResManager = {
	addUrl:function(url, tag)
	{
		//empty of jsb
	},

	removeUrl:function(url, tag)
	{
		//empty of jsb
	},

	onModuleEnter:function(modulename)
	{
		//empty of jsb
	},

	onModuleExit:function(modulename)
	{
		//empty of jsb
	},

	releaseSound: function()
	{
		//empty of jsb
	},

	releaseHugePicture: function()
	{
		//empty of jsb
	},

	releaseFca: function()
	{
		//empty of jsb
	},

	releaseFcaz: function()
	{
		//empty of jsb
	},

	releaseFcaInfo: function()
	{
		//empty of jsb
	},

	releasePz: function()
	{
		//empty of jsb
	},

	releaseElement: function(list)
	{
		ed.cacheManger.tryRemove(list);
	}
};

//+++++++++++++++++++++++++something about async begin+++++++++++++++++++++++++++++++
/**
 * Async Pool class, a helper of cc.async
 * @param {Object|Array} srcObj
 * @param {Number} limit the limit of parallel number
 * @param {function} iterator
 * @param {function} onEnd
 * @param {object} target
 * @constructor
 */
cc.AsyncPool = function(srcObj, limit, iterator, onEnd, target){
	var self = this;
	self._srcObj = srcObj;
	self._limit = limit;
	self._pool = [];
	self._iterator = iterator;
	self._iteratorTarget = target;
	self._onEnd = onEnd;
	self._onEndTarget = target;
	self._results = srcObj instanceof Array ? [] : {};
	self._isErr = false;

	cc.each(srcObj, function(value, index){
		self._pool.push({index : index, value : value});
	});

	self.size = self._pool.length;
	self.finishedSize = 0;
	self._workingSize = 0;

	self._limit = self._limit || self.size;

	self.onIterator = function(iterator, target){
		self._iterator = iterator;
		self._iteratorTarget = target;
	};

	self.onEnd = function(endCb, endCbTarget){
		self._onEnd = endCb;
		self._onEndTarget = endCbTarget;
	};

	self._handleItem = function(){
		var self = this;
		if(self._pool.length == 0)
			return;                                                    //return directly if the array's length = 0
		if(self._workingSize >= self._limit)
			return;                                                         //return directly if the working size great equal limit number
		var item = self._pool.shift();
		var value = item.value, index = item.index;
		self._workingSize++;
		self._iterator.call(self._iteratorTarget, value, index,
			function(err){

				self.finishedSize++;
				self._workingSize--;

				if(err) {
					self._isErr = true;
				}

				var arr = Array.prototype.slice.call(arguments, 1);

				self._results[this.index] = arr[0];

				if (self.finishedSize === self.size) {
					if (self._onEnd)
					{
						var result = self._isErr ? "error" : null;
						self._onEnd.call(self._onEndTarget, result, self._results);
					}
					return;
				}

				self._handleItem();
				
			}.bind(item),
		self);
	};

	self.flow = function(){
		var self = this;
		if(self._pool.length === 0) {
			if(self._onEnd)
				self._onEnd.call(self._onEndTarget, null, []);
			return;
		}

		for(var i = 0; i < self._limit; i++)
			self._handleItem();
	}
};

/**
 * @class
 */
cc.async = /** @lends cc.async# */{
	/**
	 * Do tasks series.
	 * @param {Array|Object} tasks
	 * @param {function} [cb] callback
	 * @param {Object} [target]
	 * @return {cc.AsyncPool}
	 */
	series : function(tasks, cb, target){
		var asyncPool = new cc.AsyncPool(tasks, 1, function(func, index, cb1){
			func.call(target, cb1);
		}, cb, target);
		asyncPool.flow();
		return asyncPool;
	},

	/**
	 * Do tasks parallel.
	 * @param {Array|Object} tasks
	 * @param {function} cb callback
	 * @param {Object} [target]
	 * @return {cc.AsyncPool}
	 */
	parallel : function(tasks, cb, target){
		var asyncPool = new cc.AsyncPool(tasks, 0, function(func, index, cb1){
			func.call(target, cb1);
		}, cb, target);
		asyncPool.flow();
		return asyncPool;
	},

	/**
	 * Do tasks waterfall.
	 * @param {Array|Object} tasks
	 * @param {function} cb callback
	 * @param {Object} [target]
	 * @return {cc.AsyncPool}
	 */
	waterfall : function(tasks, cb, target){
		var args = [];
		var lastResults = [null];//the array to store the last results
		var asyncPool = new cc.AsyncPool(tasks, 1,
			function (func, index, cb1) {
				args.push(function (err) {
					args = Array.prototype.slice.call(arguments, 1);
					if(tasks.length - 1 === index) lastResults = lastResults.concat(args);//while the last task
					cb1.apply(null, arguments);
				});
				func.apply(target, args);
			}, function (err) {
				if (!cb)
					return;
				if (err)
					return cb.call(target, err);
				cb.apply(target, lastResults);
			});
		asyncPool.flow();
		return asyncPool;
	},

	/**
	 * Do tasks by iterator.
	 * @param {Array|Object} tasks
	 * @param {function|Object} iterator
	 * @param {function} [callback]
	 * @param {Object} [target]
	 * @return {cc.AsyncPool}
	 */
	map : function(tasks, iterator, callback, target){
		var locIterator = iterator;
		if(typeof(iterator) === "object"){
			callback = iterator.cb;
			target = iterator.iteratorTarget;
			locIterator = iterator.iterator;
		}
		var asyncPool = new cc.AsyncPool(tasks, 0, locIterator, callback, target);
		asyncPool.flow();
		return asyncPool;
	},

	/**
	 * Do tasks by iterator limit.
	 * @param {Array|Object} tasks
	 * @param {Number} limit
	 * @param {function} iterator
	 * @param {function} cb callback
	 * @param {Object} [target]
	 */
	mapLimit : function(tasks, limit, iterator, cb, target){
		var asyncPool = new cc.AsyncPool(tasks, limit, iterator, cb, target);
		asyncPool.flow();
		return asyncPool;
	}
};
//+++++++++++++++++++++++++something about async end+++++++++++++++++++++++++++++++++

//+++++++++++++++++++++++++something about path begin++++++++++++++++++++++++++++++++
/**
 * @class
 */
cc.path = /** @lends cc.path# */{
	normalizeRE: /[^\.\/]+\/\.\.\//,

	/**
	 * Join strings to be a path.
	 * @example
	 cc.path.join("a", "b.png");//-->"a/b.png"
	 cc.path.join("a", "b", "c.png");//-->"a/b/c.png"
	 cc.path.join("a", "b");//-->"a/b"
	 cc.path.join("a", "b", "/");//-->"a/b/"
	 cc.path.join("a", "b/", "/");//-->"a/b/"
	 * @returns {string}
	 */
	join: function () {
		var l = arguments.length;
		var result = "";
		for (var i = 0; i < l; i++) {
			result = (result + (result === "" ? "" : "/") + arguments[i]).replace(/(\/|\\\\)$/, "");
		}
		return result;
	},

	/**
	 * Get the ext name of a path.
	 * @example
	 cc.path.extname("a/b.png");//-->".png"
	 cc.path.extname("a/b.png?a=1&b=2");//-->".png"
	 cc.path.extname("a/b");//-->null
	 cc.path.extname("a/b?a=1&b=2");//-->null
	 * @param {string} pathStr
	 * @returns {*}
	 */
	extname: function (pathStr) {
		var temp = /(\.[^\.\/\?\\]*)(\?.*)?$/.exec(pathStr);
		return temp ? temp[1] : null;
	},

	/**
	 * Get the main name of a file name
	 * @param {string} fileName
	 * @returns {string}
	 */
	mainFileName: function(fileName){
		if(fileName){
		   var idx = fileName.lastIndexOf(".");
			if(idx !== -1)
			   return fileName.substring(0,idx);
		}
		return fileName;
	},

	/**
	 * Get the file name of a file path.
	 * @example
	 cc.path.basename("a/b.png");//-->"b.png"
	 cc.path.basename("a/b.png?a=1&b=2");//-->"b.png"
	 cc.path.basename("a/b.png", ".png");//-->"b"
	 cc.path.basename("a/b.png?a=1&b=2", ".png");//-->"b"
	 cc.path.basename("a/b.png", ".txt");//-->"b.png"
	 * @param {string} pathStr
	 * @param {string} [extname]
	 * @returns {*}
	 */
	basename: function (pathStr, extname) {
		var index = pathStr.indexOf("?");
		if (index > 0) pathStr = pathStr.substring(0, index);
		var reg = /(\/|\\\\)([^(\/|\\\\)]+)$/g;
		var result = reg.exec(pathStr.replace(/(\/|\\\\)$/, ""));
		if (!result) return null;
		var baseName = result[2];
		if (extname && pathStr.substring(pathStr.length - extname.length).toLowerCase() === extname.toLowerCase())
			return baseName.substring(0, baseName.length - extname.length);
		return baseName;
	},

	/**
	 * Get dirname of a file path.
	 * @example
	 * unix
	 cc.path.driname("a/b/c.png");//-->"a/b"
	 cc.path.driname("a/b/c.png?a=1&b=2");//-->"a/b"
	 cc.path.dirname("a/b/");//-->"a/b"
	 cc.path.dirname("c.png");//-->""
	 * windows
	 cc.path.driname("a\\b\\c.png");//-->"a\b"
	 cc.path.driname("a\\b\\c.png?a=1&b=2");//-->"a\b"
	 * @param {string} pathStr
	 * @returns {*}
	 */
	dirname: function (pathStr) {
		return pathStr.replace(/((.*)(\/|\\|\\\\))?(.*?\..*$)?/, '$2');
	},

	/**
	 * Change extname of a file path.
	 * @example
	 cc.path.changeExtname("a/b.png", ".plist");//-->"a/b.plist"
	 cc.path.changeExtname("a/b.png?a=1&b=2", ".plist");//-->"a/b.plist?a=1&b=2"
	 * @param {string} pathStr
	 * @param {string} [extname]
	 * @returns {string}
	 */
	changeExtname: function (pathStr, extname) {
		extname = extname || "";
		var index = pathStr.indexOf("?");
		var tempStr = "";
		if (index > 0) {
			tempStr = pathStr.substring(index);
			pathStr = pathStr.substring(0, index);
		}
		index = pathStr.lastIndexOf(".");
		if (index < 0) return pathStr + extname + tempStr;
		return pathStr.substring(0, index) + extname + tempStr;
	},
	/**
	 * Change file name of a file path.
	 * @example
	 cc.path.changeBasename("a/b/c.plist", "b.plist");//-->"a/b/b.plist"
	 cc.path.changeBasename("a/b/c.plist?a=1&b=2", "b.plist");//-->"a/b/b.plist?a=1&b=2"
	 cc.path.changeBasename("a/b/c.plist", ".png");//-->"a/b/c.png"
	 cc.path.changeBasename("a/b/c.plist", "b");//-->"a/b/b"
	 cc.path.changeBasename("a/b/c.plist", "b", true);//-->"a/b/b.plist"
	 * @param {String} pathStr
	 * @param {String} basename
	 * @param {Boolean} [isSameExt]
	 * @returns {string}
	 */
	changeBasename: function (pathStr, basename, isSameExt) {
		if (basename.indexOf(".") === 0) return this.changeExtname(pathStr, basename);
		var index = pathStr.indexOf("?");
		var tempStr = "";
		var ext = isSameExt ? this.extname(pathStr) : "";
		if (index > 0) {
			tempStr = pathStr.substring(index);
			pathStr = pathStr.substring(0, index);
		}
		index = pathStr.lastIndexOf("/");
		index = index <= 0 ? 0 : index + 1;
		return pathStr.substring(0, index) + basename + ext + tempStr;
	},
	//todo make public after verification
	_normalize: function(url){
		var oldUrl = url = String(url);

		//removing all ../
		do {
			oldUrl = url;
			url = url.replace(this.normalizeRE, "");
		} while(oldUrl.length !== url.length);
		return url;
	}
};

//+++++++++++++++++++++++++something about path end++++++++++++++++++++++++++++++++

cc.gameLogoLayer = cc.Layer.extend({

    ctor: function (argument) {
        // body...
        this._super();
        this.initView();
    },

    initView: function (argument) {
        // body...
        var root = new ccui.Widget();
        root.setAnchorPoint(cc.p(0, 0));

        var scene = cc.Scene.create();
        scene.setAnchorPoint(0.5, 0.5);
        scene.addChild(root, 10);

        scene.setColor(cc.color(255, 255, 255, 255));
        cc.director.runScene(scene);

       	var design_scale = 1;
        if(cc.game.widescreen)
        {
            var framesize = cc.view.getFrameSize();
            var designSize = cc.size(615,1024);
            var dvh = framesize.width/designSize.width*designSize.height;
            design_scale = framesize.height/dvh;
            root.setPosition(cc.p( designSize.width * (1 - design_scale ) * 0.5, designSize.height * ( 1 - design_scale ) * 0.5));
        }

        root.setScale(design_scale);

        var CC = cc.Node.create();
        this.addChild(CC);

        var view = null;
        var _winsize = cc.winSize;//Returns the size of the WebGL view in points.

        var width =  _winsize.width;
        var frame_width = width/design_scale;
        var layerColor = cc.LayerColor.create(cc.color(255, 255, 255, 255), _winsize.width/design_scale, _winsize.height);
        layerColor.setPosition(cc.p(-(frame_width - width)*0.5, 0));
        CC.addChild(layerColor);

		//lilith闪屏
        var videoURL = "res/opening/start_global.mp4";
        if (cc.sys.chn || cc.sys.os === cc.sys.OS_WINDOWS)
        {
        	videoURL = "res/opening/start.mp4";
        }
		var channelName = dsBridge.call("callApp", {msg: "getChannelName"});
		if (channelName == "vietnam"){
			videoURL = "res/opening/start_vietnam.mp4";
		}
		else if (channelName == "miracle"){
			videoURL = null; //TODO
		}

        if (videoURL &&jsb.fileUtils.isFileExist(videoURL))
        {
	        view = ccui.VideoView.create(videoURL);

	        var oldSize = view.getContentSize();
	        var displayHeight = _winsize.height;
	        var displayWidth = _winsize.width;
	        var newSize = _winsize;
	        if (displayHeight / oldSize.height * oldSize.width <= displayWidth) {
	            newSize = cc.size(displayHeight / oldSize.height * oldSize.width, displayHeight);
	        } else {
	            newSize = cc.size(displayWidth, displayWidth / oldSize.width * oldSize.height);
	        }

	        view.setContentSize(newSize);
	        view.setAnchorPoint(cc.p(0.5, 0.5));
	        view.setPosition(cc.p(_winsize.width/2, _winsize.height/2));
	        view.setLocalZOrder(12);
	        view.stop();

	        view.addEventListener(function (obj, eventType) {
	            // body...
	            if (eventType === 3)
	            {
	                this.onVideoComplete();
	            }
	        }.bind(this));

	        CC.addChild(view);
	        this._videoView = view;
	    }

        root.addChild(this);
    },

    onVideoComplete: function (argument) {
        // body...
        if (this._videoView)
        	this._videoView.stop();

        this.onEnd();
    },

    setCompleteListener: function ( listener ) {
        // body...
        this._completeListener = listener;
    },

    onEnd: function (argument) {
        // body...

        //revert sound
        if (cc.audioEngine && cc.audioEngine.setMusicVolume)
        	cc.audioEngine.setMusicVolume(0);

        if (this._completeListener)
            this._completeListener();
    },

    formatSound: function ( res ) {
    	// body...
    	var suffix = ".ogg";

    	var bGreater = cc.compareAppVersion("1.33.01");
    	if (bGreater)
    	{
    		suffix = ".fsb";
    		res = res.substr(0, res.length - 4 ) + suffix;
    	}

    	return res;
    },

    playSound: function (argument) {
    	// body...
	    var sound_res = "res/opening/start_global.ogg";
	    if (cc.sys.chn || cc.sys.os === cc.sys.OS_WINDOWS)
	    {
	    	sound_res = "res/opening/start.ogg";
	    }

	    sound_res = this.formatSound(sound_res);

	    if(cc.sys.os == cc.sys.OS_ANDROID){
	    	var mode = dsBridge.call("callApp",{
                msg:"getRingerMode"
        	});

	    	if (mode === "0" || mode === "1")
	    		return;
		}

	    if (cc.audioEngine && cc.audioEngine.setMusicVolume){
			var local = window.localStorage && window.localStorage.getItem('sound_setting');
			var v = 1.0;
			if(local){
				local = JSON.parse(local);
				for(var i in local)
				{
					var config = local[i];
					if(config["key"] === "music" ){
					    if (Number(config.value) === 0){
					        v = Number(config.value);
					    }else{
					        v = Number(config.value) || 1.0;
					    }
					}
				}
			}
			cc.audioEngine.setMusicVolume(v);
		}


	    var isExist = jsb.fileUtils.isFileExist(sound_res);
	    if(isExist)
	    	cc.audioEngine.playMusic(sound_res, false);
    },

    show: function (argument) {
        // body...

        if (this._videoView)
        {
        	this._videoView.play();
        	this.playSound();
        }
        else
        {
        	this.onEnd();
        }
    },
});

cc.gameLogoLayer.create = function (argument) {
    // body...
    return new cc.gameLogoLayer();
};

//+++++++++++++++++++++++++something about loader start+++++++++++++++++++++++++++
cc._queue = {};
cc.loader = {
	_resPath : "",
	_audioPath : "",
	_register : {},//register of loaders
	cache : {},//cache for data loaded
	_langPathCache : {},//cache for lang path
	_queue : {},
	_cbs: {},
	_delCbs: [],
	_isCheck: false,
	_toAddCbs: {},

	uiBinaryFileCache:{},//按照文件名为key，在bytebuffer中的位置、大小为value的字典
	uiPackageByteBuffer:null,//所有的csb文件成的一个包

	/**
	 * Get XMLHttpRequest.
	 * @returns {XMLHttpRequest}
	 */
	getXMLHttpRequest : function () {
		return new XMLHttpRequest();
	},


	//@MODE_BEGIN DEV

	_jsCache : {},//cache for js

	_getArgs4Js: function (args) {
		var a0 = args[0], a1 = args[1], a2 = args[2], results = ["", null, null];

		if (args.length === 1) {
			results[1] = a0 instanceof Array ? a0 : [a0];
		} else if (args.length === 2) {
			if (typeof a1 === "function") {
				results[1] = a0 instanceof Array ? a0 : [a0];
				results[2] = a1;
			} else {
				results[0] = a0 || "";
				results[1] = a1 instanceof Array ? a1 : [a1];
			}
		} else if (args.length === 3) {
			results[0] = a0 || "";
			results[1] = a1 instanceof Array ? a1 : [a1];
			results[2] = a2;
		} else throw new Error("arguments error to load js!");
		return results;
	},

	isLoading: function (url) {
		return (cc._queue[url] !== undefined);
	},

	/**
	 * Load js files.
	 * @param {?string=} baseDir   The pre path for jsList.
	 * @param {array.<string>} jsList    List of js path.
	 * @param {function} cb        Callback function
	 *
	 *      If the arguments.length == 2, then the baseDir turns to be "".
	 * @returns {*}
	 */
	loadJs: function (baseDir, jsList, cb) {
		var self = this, localJsCache = self._jsCache,
			args = self._getArgs4Js(arguments);
		baseDir = args[0];
		jsList = args[1];
		cb = args[2];
		var ccPath = cc.path;
		for(var i = 0, li = jsList.length; i < li; ++i){
			require(ccPath.join(baseDir, jsList[i]));
		}
		if(cb) cb();
	},
	/**
	 * Load js width loading image.
	 *
	 * @param {string} [baseDir]
	 * @param {array} jsList
	 * @param {function} [cb]
	 */
	loadJsWithImg : function(baseDir, jsList, cb){
		this.loadJs.apply(this, arguments);
	},

	//@MODE_END DEV

	/**
	 * Load a single resource as txt.
	 * @param {!string} url
	 * @param {function} cb arguments are : err, txt
	 */
	loadTxt : function(url, cb){
		hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
			cb && cb(error,null);
		});
	},

	loadJson : function(url, cb){
		hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
			cb && cb(error, null);
		});
	},

	loadCsv: function(table_name, cb)
	{
		if (!table_name)
		{
			return;
		}

		var file = table_name + ".bin";
		hg.ZipManager.getInstance().load("/csvbin/csvbin_"  + cc.game.region + "_"  + cc.game.sysLang + ".zip", function(fileName, data, size, isLast){
			if (fileName === file )
			{
				ed.dealCsvFile(table_name, data);
				cb && cb();
			}
		}, file);
	},

	loadCha: function(url , cb)
	{
		hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
			cb && cb(error, null);
		});
	},

	loadZip: function(url, ext, cb) {
		url = cc.loader.getUrl('', url);
		if (ext === "bin")
		{
			hg.ZipManager.getInstance().load(url, function(fileName, data, size, isLast){
				var ext = cc.path.extname(fileName);
				var filename = cc.path.mainFileName(fileName);
				if(ext == ".bin"){
					ed.dealCsvFile(filename, data);
					if (isLast)
					{
						cc.log("bin load finish!");
						cb(null, null);
					}
				}
			});
		}
		else
		{
			hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
				if (error)
				{
					cb && cb(error, null);
					return;
				}

				var plists = [];
				//list
				for (var i = 0; i < fileList.length; i++) {
					var fileName = fileList[i];
					if (fileName.endsWith(cc.devicePlistExt(fileName)))
					{
						if (!cc.supportAsyncManipulation2()) {
							cc.log("[loadZip] load plist: ", fileName);
							if (fileName.indexOf("res/fca/") === -1) {
								cc.spriteFrameCache.addSpriteFrames(fileName);
							}
						}
						else
							plists.push(fileName);
					}
				}

				if (cc.supportAsyncManipulation2() && plists.length > 0)
				{
					var total = plists.length;
					var curr = 0;

					for (var i = 0; i < plists.length; i++) {
						var url = plists[i];
						cc.log("[loadZip] load plist: ", url);
						cc.spriteFrameCache.addSpriteFramesWithFileAsync(url, function (argument) {
						    // body...
						    curr++;

						    if (curr >= total)
						    	cb && cb(error, null);
						});
					}
				}
				else
					cb && cb(error, null);
			});
		}
	},

	loadCsb: function(url, cb){
		hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
			cb && cb(error,null);
		});
	},

	/**
	 * Load a single image.
	 * @param {!string} url
	 * @param {object} [option]
	 * @param {function} cb
	 * @returns {Image}
	 */
	loadImg: function (url, option, cb){
		var l = arguments.length;
		if(l == 2) cb = option;

		if (cc.isPngOrJpgType(url))
		{
			var spriteFrame = cc.spriteFrameCache.getSpriteFrame(url);
			if (spriteFrame)
			{
				cb && cb(null, null);
				return;
			}
		}

		hg.ResourceManager.getInstance().loadResourceFile(url, function(error, fileList){
			cb && cb(error, null);
		});
	},

	/**
	 * Load binary data by url.
	 * @param {String} url
	 * @param {Function} cb
	 */
	loadBinary : function(url, cb){
		cb(null, jsb.fileUtils.getDataFromFile(url));
	},
	loadBinarySync : function(url){
		return jsb.fileUtils.getDataFromFile(url);
	},

	/**
	 * Iterator function to load res
	 * @param {object} item
	 * @param {number} index
	 * @param {function} [cb]
	 * @returns {*}
	 * @private
	 */
	_loadResIterator: function (item, index, cb) {
		var self = this, url = null;
		var type = item.type;
		if (type) {
			type = "." + type.toLowerCase();
			url = item.src ? item.src : item.name + type;
		} else {
			url = item;
			type = cc.path.extname(url);
		}

		//自定义头像没有后缀名特殊处理
		if(type == null) {
			type = ".png";
		}

		var obj = self.cache[url];
		if (obj)
		{
			cc.addResCbs(url, null, obj, cb);
			return;
		}
		var loader = null;
		if (type) {
			loader = self._register[type.toLowerCase()];
		}

		if (!loader) {
			cc.error("loader for [" + type + "] not exists!");
			cc.log("loader for [" + type + "] not exists!");
			cc.addResCbs(url, "error", null, cb);
			return;
		}
		var basePath = loader.getBasePath ? loader.getBasePath() : self.resPath;
		var realUrl = self.getUrl(basePath, url);

		loader.load(realUrl, url, item, function (err, data) {
			cc.addResCbs(url, err, data, cb);
		});
	},

	/**
	 * Get url with basePath.
	 * @param {string} basePath
	 * @param {string} [url]
	 * @returns {*}
	 */
	getUrl: function (basePath, url) {
		var self = this, langPathCache = self._langPathCache, path = cc.path;
		if (basePath !== undefined && url === undefined) {
			url = basePath;
			var type = path.extname(url);
			type = type ? type.toLowerCase() : "";
			var loader = self._register[type];
			if (!loader)
				basePath = self.resPath;
			else
				basePath = loader.getBasePath ? loader.getBasePath() : self.resPath;
		}
		url = cc.path.join(basePath || "", url);
		if (url.match(/[\/(\\\\)]lang[\/(\\\\)]/i)) {
			if (langPathCache[url])
				return langPathCache[url];
			var extname = path.extname(url) || "";
			url = langPathCache[url] = url.substring(0, url.length - extname.length) + "_" + cc.sys.language + extname;
		}
		return url;
	},

	/**
	 * Load resources then call the callback.
	 * @param {string} resources
	 * @param {function} [option] callback or trigger
	 * @param {function|Object} [loadCallback]
	 * @return {cc.AsyncPool}
	 */
	load : function(resources, option, loadCallback){
		var self = this;
		var len = arguments.length;
		if(len === 0)
			throw new Error("arguments error!");

		if(len === 3){
			if(typeof option === "function"){
				if(typeof loadCallback === "function")
					option = {trigger : option, cb : loadCallback };
				else
					option = { cb : option, cbTarget : loadCallback};
			}
		}else if(len === 2){
			if(typeof option === "function")
				option = {cb : option};
		}else if(len === 1){
			option = {};
		}

		if(!(resources instanceof Array))
			resources = [resources];
		var asyncPool = new cc.AsyncPool(
			resources, 0,
			function (value, index, AsyncPoolCallback, aPool) {
				self._loadResIterator(value, index, function (err) {
					var arr = Array.prototype.slice.call(arguments, 1);
					if (option.trigger)
						option.trigger.call(option.triggerTarget, arr[0], aPool.size, aPool.finishedSize);   //call trigger
					AsyncPoolCallback(err, arr[0]);
				});
			},
			option.cb, option.cbTarget);
		asyncPool.flow();
		return asyncPool;
	},

	/**
	 * <p>
	 *     Loads alias map from the contents of a filename.                                        <br/>
	 *                                                                                                                 <br/>
	 *     @note The plist file name should follow the format below:                                                   <br/>
	 *     <?xml version="1.0" encoding="UTF-8"?>                                                                      <br/>
	 *         <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">  <br/>
	 *             <plist version="1.0">                                                                               <br/>
	 *                 <dict>                                                                                          <br/>
	 *                     <key>filenames</key>                                                                        <br/>
	 *                     <dict>                                                                                      <br/>
	 *                         <key>sounds/click.wav</key>                                                             <br/>
	 *                         <string>sounds/click.caf</string>                                                       <br/>
	 *                         <key>sounds/endgame.wav</key>                                                           <br/>
	 *                         <string>sounds/endgame.caf</string>                                                     <br/>
	 *                         <key>sounds/gem-0.wav</key>                                                             <br/>
	 *                         <string>sounds/gem-0.caf</string>                                                       <br/>
	 *                     </dict>                                                                                     <br/>
	 *                     <key>metadata</key>                                                                         <br/>
	 *                     <dict>                                                                                      <br/>
	 *                         <key>version</key>                                                                      <br/>
	 *                         <integer>1</integer>                                                                    <br/>
	 *                     </dict>                                                                                     <br/>
	 *                 </dict>                                                                                         <br/>
	 *              </plist>                                                                                           <br/>
	 * </p>
	 * @param {String} filename  The plist file name.
	 * @param {Function} cb     callback
	 */
	loadAliases : function(url, cb){
		jsb.fileUtils.loadFilenameLookup(url);
		if(cb) cb();
	},

	/**
	 * Register a resource loader into loader.
	 * @param {string} extNames
	 * @param {function} loader
	 */
	register: function (extNames, loader) {
		if (!extNames || !loader) return;
		var self = this;
		if (typeof extNames === "string")
			return this._register[extNames.trim().toLowerCase()] = loader;
		for (var i = 0, li = extNames.length; i < li; i++) {
			self._register["." + extNames[i].trim().toLowerCase()] = loader;
		}
	},

	/**
	 * Get resource data by url.
	 * @param url
	 * @returns {*}
	 */
	getRes : function(url){
		return this.cache[url]
	},

	/**
	 * Release the cache of resource by url.
	 * @param url
	 */
	release: function (url) {
		var cache = this.cache;
		delete cache[url];
	},

	/**
	 * Resource cache of all resources.
	 */
	releaseAll: function () {
		var locCache = this.cache;
		for (var key in locCache)
			delete locCache[key];
	}
};
cc.defineGetterSetter(cc.loader, "resPath", function(){
	return this._resPath;
}, function(resPath){
	this._resPath = resPath || "";
	jsb.fileUtils.addSearchPath(this._resPath);
});
cc.defineGetterSetter(cc.loader, "audioPath", function(){
	return this._audioPath;
}, function(audioPath){
	this._audioPath = audioPath || "";
	jsb.fileUtils.addSearchPath(this._audioPath);
});

//+++++++++++++++++++++++++something about loader end+++++++++++++++++++++++++++++

/**
 * A string tool to construct a string with format string.
 * for example:
 *      cc.formatStr("a: %d, b: %b", a, b);
 *      cc.formatStr(a, b, c);
 * @returns {String}
 */
cc.formatStr = function(){
	var args = arguments;
	var l = args.length;
	if (l < 1) return '';
	var REGEXP_NUM_OR_STR = /(%d)|(%s)/;

	var i = 1;
	var str = args[0];
	var hasSubstitution = typeof str === 'string' && REGEXP_NUM_OR_STR.test(str);
	if (hasSubstitution) {
		var REGEXP_STR = /%s/;
		for (; i < l; ++i) {
			var arg = args[i];
			var regExpToTest = typeof arg === 'number' ? REGEXP_NUM_OR_STR : REGEXP_STR;
			if (regExpToTest.test(str))
				str = str.replace(regExpToTest, arg);
			else
				str += ' ' + arg;
		}
	}
	else {
		if (l > 1) {
			for (; i < l; ++i) {
				str += ' ' + args[i];
			}
		}
		else {
			str = '' + str;
		}
	}
	return str;
};


//+++++++++++++++++++++++++Engine initialization function begin+++++++++++++++++++++++++++

// Define singleton objects
cc.director = cc.Director.getInstance();
cc.director._actionManager = cc.director.getActionManager();
cc.director._scheduler = cc.director.getScheduler();


cc.winSize = cc.director.getWinSize();
// cc.userDefault = cc.UserDefault.getInstance();

cc.view = cc.director.getOpenGLView();
cc.view.getDevicePixelRatio = cc.view.getRetinaFactor;
cc.view.convertToLocationInView = function (tx, ty, relatedPos) {
	var _devicePixelRatio = cc.view.getDevicePixelRatio();
	return {x: _devicePixelRatio * (tx - relatedPos.left), y: _devicePixelRatio * (relatedPos.top + relatedPos.height - ty)};
};
cc.view.enableRetina = function(enabled) {};
cc.view.isRetinaEnabled = function() {
	var sys = cc.sys;
	return (sys.os == sys.OS_IOS || sys.os == sys.OS_OSX) ? true : false;
};
cc.view.adjustViewPort = function() {};
cc.view.resizeWithBrowserSize = function () {return;};
cc.view.setResizeCallback = function() {return;};
cc.view.enableAutoFullScreen = function () {return;};
cc.view.isAutoFullScreenEnabled = function() {return true;};
cc.view._setDesignResolutionSize = cc.view.setDesignResolutionSize;
cc.view.setDesignResolutionSize = function(width,height,resolutionPolicy){
	cc.view._setDesignResolutionSize(width,height,resolutionPolicy);
	cc.winSize = cc.director.getWinSize();
	cc.visibleRect.init();
};
cc.view.setRealPixelResolution = cc.view.setDesignResolutionSize;
cc.view.setResolutionPolicy = function(resolutionPolicy){
	var size = cc.view.getDesignResolutionSize();
	cc.view.setDesignResolutionSize(size.width,size.height,resolutionPolicy);
};
cc.view.getCanvasSize = cc.view.getFrameSize;
cc.view.getVisibleSizeInPixel = cc.view.getVisibleSize;
cc.view.getVisibleOriginInPixel = cc.view.getVisibleOrigin;
cc.view.setContentTranslateLeftTop = function(){return;};
cc.view.getContentTranslateLeftTop = function(){return null;};
cc.view.setFrameZoomFactor = function(){return;};
cc.view.setOrientation = function () {};
cc.DENSITYDPI_DEVICE = "device-dpi";
cc.DENSITYDPI_HIGH = "high-dpi";
cc.DENSITYDPI_MEDIUM = "medium-dpi";
cc.DENSITYDPI_LOW = "low-dpi";
cc.view.setTargetDensityDPI = function() {};
cc.view.getTargetDensityDPI = function() {return cc.DENSITYDPI_DEVICE;};

cc.eventManager = cc.director.getEventDispatcher();

cc.eventManager._addCustomListener = cc.eventManager.addCustomListener;

window.hg = window.hg || {};
hg.eventManager_enabled = true;

var systemEvents= [
	"event_renderer_recreated",
	"event_js_renderer_recreated",
	"game_on_hide",
	"game_on_show",
	"game_on_resize",
	"DOWNLOAD_UPDATE",
];

cc.eventManager.addCustomListener = function(eventName, callback, target)
{
	if (!cc.sys.supported_eventmanager || !hg.eventManager_enabled || systemEvents.indexOf(eventName) >= 0)
	{
		return cc.eventManager._addCustomListener(eventName, callback);
	}

	return hg.eventManager.addCustomListener(eventName, callback);
};

cc.eventManager._getListeners = function( listenerId )
{
	var bRet = cc.eventManager.hasEventListener(listenerId);

	if (hg.eventManager_enabled && !bRet)
	{
		bRet = hg.eventManager.hasEventListener(listenerId);
	}

	return bRet ? {}: undefined;
};

cc.eventManager._removeListener = cc.eventManager.removeListener;
cc.eventManager.removeListener = function ( listener ) {
	// body...
	if (!hg.eventManager_enabled || (listener instanceof cc.EventListener))
	{
		this._removeListener(listener);
	}
	else
	{
		if (hg && hg.eventManager && hg.eventManager.removeListener)
		{
			hg.eventManager.removeListener(listener);
		}
	}
};

cc.audioEngine = cc.AudioEngine.getInstance();
cc.audioEngine.end = function(){
	this.stopMusic();
	this.stopAllEffects();
};
cc.audioEngine.features = {
	MULTI_CHANNEL: true,
	AUTOPLAY: true
};

// cc.configuration = cc.Configuration.getInstance();

cc.textureCache = cc.director.getTextureCache();
cc.TextureCache.prototype._addImageAsync = cc.TextureCache.prototype.addImageAsync;
cc.TextureCache.prototype.addImageAsync = function(url, cb, target) {
	var localTex = null;
	cc.loader.loadImg(url, function(err, tex) {
		if (err) tex = null;
		if (cb) {
			cb.call(target, tex);
		}
		localTex = tex;
	});
	return localTex;
};
// Fix for compatibility with old APIs
cc.TextureCache.prototype._addImage = cc.TextureCache.prototype.addImage;
cc.TextureCache.prototype.addImage = function(url, cb, target) {
	if (typeof cb === "function") {
		return this.addImageAsync(url, cb, target);
	}
	else {
		if (cb) {
			return this._addImage(url, cb);
		}
		else {
			return this._addImage(url);
		}
	}
};

cc.textureCache.handleLoadedTexture = function(fileName, img)
{
	cc.log("[handleLoadedTexture] jsb is empty");
};


cc.getProgram = function(shaderName) {
	cc._programs = cc._programs || {};
	cc._programsData = cc._programsData || {};
	return cc._programs[shaderName];
};

cc.addProgram = function(program, shaderName, data) {
	var prev = cc.getProgram(shaderName);
	if( prev === program )
		return;

	if(prev) {
		prev.release();
	}

	if (program)
		program.retain();
	cc._programs[shaderName] = program;
	cc._programsData[shaderName] = data;
};

cc.clearProgram = function() {
	var keys = Object.keys(cc._programs || {});
	for (var i= 0,len=keys.length; i<len; i++) {
		var program = cc._programs[keys[i]];
		if(program)
			program.release();
	}
	cc._programs = {};
};

cc.resetProgram = function() {
	var keys = Object.keys(cc._programs || {});
	for (var i= 0,len=keys.length; i<len; i++) {
		var shaderName = keys[i];
		var program = cc._programs[shaderName];
		var data = cc._programsData[shaderName];
		if(program) {
			program.reset();
			program.initWithString(data[0], data[1]);
			program.link();
			program.updateUniforms();
			if(shaderName === "StoneShader") {
				program.setUniformLocationF32("CC_brightRate",1);
			}
		}
	}
};

cc.shaderDataCache = {};
cc.shaderCache = cc.ShaderCache.getInstance();
cc.shaderCache.loadProgram = function(shaderName, callback, noCache)
{
	var program = cc.getProgram(shaderName);
	if (program && !noCache){
		if (callback){
			callback(program);
		}
		//cc.log("ShaderCache contains " + shaderName +" in it's container");
		return program;
	}

	var func = function (data) {
		var program = cc.GLProgram.createWithByteArrays(data[0], data[1]);

		if(!noCache) {
			cc.addProgram(program, shaderName, data);
		}

		if (callback){
			callback(program);
		}
	};

	if(cc.shaderDataCache[shaderName]) {
		func(cc.shaderDataCache[shaderName]);
	} else {
		var path = "res/shader/" + shaderName;
		cc.loader.load([path + ".vsh", path + ".fsh"], function(err, data){
			cc.log("load shader: " + shaderName);
			cc.shaderDataCache[shaderName] = data;
			func(data);
		});
	}
};

// cc.animationCache = cc.AnimationCache.getInstance();
cc.spriteFrameCache = cc.SpriteFrameCache.getInstance();

// cc.plistParser = cc.PlistParser.getInstance();

// File utils (Temporary, won't be accessible)
cc.fileUtils = cc.FileUtils.getInstance();
cc.fileUtils.setPopupNotify(false);

cc.screen = {
	init: function() {},
	fullScreen: function() {
		return true;
	},
	requestFullScreen: function(element, onFullScreenChange) {
		onFullScreenChange.call();
	},
	exitFullScreen: function() {
		return false;
	},
	autoFullScreen: function(element, onFullScreenChange) {
		onFullScreenChange.call();
	}
};

/**
 * @type {Object}
 * @name jsb.fileUtils
 * jsb.fileUtils is the native file utils singleton object,
 * please refer to Cocos2d-x API to know how to use it.
 * Only available in JSB
 */
jsb.fileUtils = cc.fileUtils;
delete cc.FileUtils;
delete cc.fileUtils;

/**
 * @type {Object}
 * @name jsb.reflection
 * jsb.reflection is a bridge to let you invoke Java static functions.
 * please refer to this document to know how to use it: http://www.cocos2d-x.org/docs/manual/framework/html5/v3/reflection/en
 * Only available on Android platform
 */
jsb.reflection = {
	callStaticMethod : function(){
		cc.log("not supported on current platform");
	}
};


var _initSys = function () {
	/**
	 * System variables
	 * @namespace
	 * @name cc.sys
	 */
	cc.sys = window.sys || {};
	var sys = cc.sys;

	/**
	 * English language code
	 * @memberof cc.sys
	 * @name LANGUAGE_ENGLISH
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_ENGLISH = "en";

	/**
	 * Chinese language code
	 * @memberof cc.sys
	 * @name LANGUAGE_CHINESE
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_CHINESE = "zh";

	/**
	 * French language code
	 * @memberof cc.sys
	 * @name LANGUAGE_FRENCH
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_FRENCH = "fr";

	/**
	 * Italian language code
	 * @memberof cc.sys
	 * @name LANGUAGE_ITALIAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_ITALIAN = "it";

	/**
	 * German language code
	 * @memberof cc.sys
	 * @name LANGUAGE_GERMAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_GERMAN = "de";

	/**
	 * Spanish language code
	 * @memberof cc.sys
	 * @name LANGUAGE_SPANISH
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_SPANISH = "es";

	/**
	 * Spanish language code
	 * @memberof cc.sys
	 * @name LANGUAGE_DUTCH
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_DUTCH = "du";

	/**
	 * Russian language code
	 * @memberof cc.sys
	 * @name LANGUAGE_RUSSIAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_RUSSIAN = "ru";

	/**
	 * Korean language code
	 * @memberof cc.sys
	 * @name LANGUAGE_KOREAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_KOREAN = "ko";

	/**
	 * Japanese language code
	 * @memberof cc.sys
	 * @name LANGUAGE_JAPANESE
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_JAPANESE = "ja";

	/**
	 * Hungarian language code
	 * @memberof cc.sys
	 * @name LANGUAGE_HUNGARIAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_HUNGARIAN = "hu";

	/**
	 * Portuguese language code
	 * @memberof cc.sys
	 * @name LANGUAGE_PORTUGUESE
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_PORTUGUESE = "pt";

	/**
	 * Arabic language code
	 * @memberof cc.sys
	 * @name LANGUAGE_ARABIC
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_ARABIC = "ar";

	/**
	 * Norwegian language code
	 * @memberof cc.sys
	 * @name LANGUAGE_NORWEGIAN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_NORWEGIAN = "no";

	/**
	 * Polish language code
	 * @memberof cc.sys
	 * @name LANGUAGE_POLISH
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_POLISH = "pl";

	/**
	 * Turkish language code
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.LANGUAGE_TURKISH = "tr";

	/**
	 * Ukrainian language code
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.LANGUAGE_UKRAINIAN = "uk";

	/**
	 * Romanian language code
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.LANGUAGE_ROMANIAN = "ro";

	/**
	 * Bulgarian language code
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.LANGUAGE_BULGARIAN = "bg";

	/**
	 * Unknown language code
	 * @memberof cc.sys
	 * @name LANGUAGE_UNKNOWN
	 * @constant
	 * @type {Number}
	 */
	sys.LANGUAGE_UNKNOWN = "unknown";

	/**
	 * @memberof cc.sys
	 * @name OS_IOS
	 * @constant
	 * @type {string}
	 */
	sys.OS_IOS = "iOS";
	/**
	 * @memberof cc.sys
	 * @name OS_ANDROID
	 * @constant
	 * @type {string}
	 */
	sys.OS_ANDROID = "Android";
	/**
	 * @memberof cc.sys
	 * @name OS_WINDOWS
	 * @constant
	 * @type {string}
	 */
	sys.OS_WINDOWS = "Windows";
	/**
	 * @memberof cc.sys
	 * @name OS_MARMALADE
	 * @constant
	 * @type {string}
	 */
	sys.OS_MARMALADE = "Marmalade";
	/**
	 * @memberof cc.sys
	 * @name OS_LINUX
	 * @constant
	 * @type {string}
	 */
	sys.OS_LINUX = "Linux";
	/**
	 * @memberof cc.sys
	 * @name OS_BADA
	 * @constant
	 * @type {string}
	 */
	sys.OS_BADA = "Bada";
	/**
	 * @memberof cc.sys
	 * @name OS_BLACKBERRY
	 * @constant
	 * @type {string}
	 */
	sys.OS_BLACKBERRY = "Blackberry";
	/**
	 * @memberof cc.sys
	 * @name OS_OSX
	 * @constant
	 * @type {string}
	 */
	sys.OS_OSX = "OS X";
	/**
	 * @memberof cc.sys
	 * @name OS_WP8
	 * @constant
	 * @type {string}
	 */
	sys.OS_WP8 = "WP8";
	/**
	 * @memberof cc.sys
	 * @name OS_WINRT
	 * @constant
	 * @type {string}
	 */
	sys.OS_WINRT = "WINRT";
	/**
	 * @memberof cc.sys
	 * @name OS_UNKNOWN
	 * @constant
	 * @type {string}
	 */
	sys.OS_UNKNOWN = "Unknown";

	/**
	 * @memberof cc.sys
	 * @name UNKNOWN
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.UNKNOWN = -1;
	/**
	 * @memberof cc.sys
	 * @name WIN32
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.WIN32 = 0;
	/**
	 * @memberof cc.sys
	 * @name LINUX
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.LINUX = 1;
	/**
	 * @memberof cc.sys
	 * @name MACOS
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.MACOS = 2;
	/**
	 * @memberof cc.sys
	 * @name ANDROID
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.ANDROID = 3;
	/**
	 * @memberof cc.sys
	 * @name IOS
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.IPHONE = 4;
	/**
	 * @memberof cc.sys
	 * @name IOS
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.IPAD = 5;
	/**
	 * @memberof cc.sys
	 * @name BLACKBERRY
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.BLACKBERRY = 6;
	/**
	 * @memberof cc.sys
	 * @name NACL
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.NACL = 7;
	/**
	 * @memberof cc.sys
	 * @name EMSCRIPTEN
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.EMSCRIPTEN = 8;
	/**
	 * @memberof cc.sys
	 * @name TIZEN
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.TIZEN = 9;
	/**
	 * @memberof cc.sys
	 * @name WINRT
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.WINRT = 10;
	/**
	 * @memberof cc.sys
	 * @name WP8
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.WP8 = 11;
	/**
	 * @memberof cc.sys
	 * @name MOBILE_BROWSER
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.MOBILE_BROWSER = 100;
	/**
	 * @memberof cc.sys
	 * @name DESKTOP_BROWSER
	 * @constant
	 * @default
	 * @type {Number}
	 */
	sys.DESKTOP_BROWSER = 101;

	sys.BROWSER_TYPE_WECHAT = "wechat";
	sys.BROWSER_TYPE_ANDROID = "androidbrowser";
	sys.BROWSER_TYPE_IE = "ie";
	sys.BROWSER_TYPE_QQ = "qqbrowser";
	sys.BROWSER_TYPE_MOBILE_QQ = "mqqbrowser";
	sys.BROWSER_TYPE_UC = "ucbrowser";
	sys.BROWSER_TYPE_360 = "360browser";
	sys.BROWSER_TYPE_BAIDU_APP = "baiduboxapp";
	sys.BROWSER_TYPE_BAIDU = "baidubrowser";
	sys.BROWSER_TYPE_MAXTHON = "maxthon";
	sys.BROWSER_TYPE_OPERA = "opera";
	sys.BROWSER_TYPE_OUPENG = "oupeng";
	sys.BROWSER_TYPE_MIUI = "miuibrowser";
	sys.BROWSER_TYPE_FIREFOX = "firefox";
	sys.BROWSER_TYPE_SAFARI = "safari";
	sys.BROWSER_TYPE_CHROME = "chrome";
	sys.BROWSER_TYPE_LIEBAO = "liebao";
	sys.BROWSER_TYPE_QZONE = "qzone";
	sys.BROWSER_TYPE_SOUGOU = "sogou";
	sys.BROWSER_TYPE_UNKNOWN = "unknown";

	/*
		Is jsb version?
		* @memberof cc.sys
		* @name isNative
		* @type {Boolean}
	*/
	sys.jsb = true;


	sys.jsb1 = !sys.jsb2;

	/**
	 * Is native ? This is set to be true in jsb auto.
	 * @memberof cc.sys
	 * @name isNative
	 * @type {Boolean}
	 */
	sys.isNative = true;

	/**
	 * Indicate the running platform
	 * @memberof cc.sys
	 * @name platform
	 * @type {Number}
	 */
	var platform = sys.platform = __getPlatform();

	/**
	 * Indicate whether system is mobile system
	 * @memberof cc.sys
	 * @name isMobile
	 * @type {Boolean}
	 */
	sys.isMobile = (platform === sys.ANDROID ||
					platform === sys.IPAD ||
					platform === sys.IPHONE ||
					platform === sys.WP8 ||
					platform === sys.TIZEN ||
					platform === sys.BLACKBERRY) ? true : false;

	sys._application = cc.Application.getInstance();

	/**
	 * Indicate the current language of the running system
	 * @memberof cc.sys
	 * @name language
	 * @type {String}
	 */
	sys.language = (function(){
		var language = sys._application.getCurrentLanguage();
		var code = sys._application.getCurrentLanguageCode();
		console.log("-----系统language：" + language);
		console.log("-----系统语言：" + code);

		//如果不支持就返回原code
		if(code.indexOf("vi") > -1) {
			return "vi";
		}
		if(code.match(/TW|tw|HK|hk|MO|mo|Hant/)) {
			return "tw";
		}
		if(code.indexOf("JP") > -1 || code.indexOf("ja") > -1) {
			return "jp";
		}
		if(code.indexOf("in") > -1) {
			return "id";
		}
		if(code.indexOf("TH") > -1 || code.indexOf("th") > -1) {
			return "th";
		}
		if(code.indexOf("KO") > -1 || code.indexOf("kr") > -1) {
			return "kr";
		}

		switch(language){
			case 0: return sys.LANGUAGE_ENGLISH;
			case 1: return sys.LANGUAGE_CHINESE;
			case 2: return sys.LANGUAGE_FRENCH;
			case 3: return sys.LANGUAGE_ITALIAN;
			case 4: return sys.LANGUAGE_GERMAN;
			case 5: return sys.LANGUAGE_SPANISH;
			case 6: return sys.LANGUAGE_DUTCH;
			case 7: return sys.LANGUAGE_RUSSIAN;
			case 8: return sys.LANGUAGE_KOREAN;
			case 9: return sys.LANGUAGE_JAPANESE;
			case 10: return sys.LANGUAGE_HUNGARIAN;
			case 11: return sys.LANGUAGE_PORTUGUESE;
			case 12: return sys.LANGUAGE_ARABIC;
			case 13: return sys.LANGUAGE_NORWEGIAN;
			case 14: return sys.LANGUAGE_POLISH;
			case 15: return sys.LANGUAGE_TURKISH;
			case 16: return sys.LANGUAGE_UKRAINIAN;
			case 17: return sys.LANGUAGE_ROMANIAN;
			case 18: return sys.LANGUAGE_BULGARIAN;
			default : return sys._application.getCurrentLanguageCode(); //如果不支持就返回原code
		}
	})();

	/**
	 * Indicate the running os name
	 * @memberof cc.sys
	 * @name os
	 * @type {String}
	 */
	sys.os = __getOS();

	/**
	 * Indicate the running browser type
	 * @memberof cc.sys
	 * @name browserType
	 * @type {String}
	 */
	sys.browserType = null; //null in jsb

	/**
	 * Indicate the running browser version
	 * @memberof cc.sys
	 * @name browserVersion
	 * @type {Number}
	 */
	sys.browserVersion = null; //null in jsb

	/**
	 * Indicate the real pixel resolution of the whole game window
	 * @memberof cc.sys
	 * @name windowPixelResolution
	 * @type {Number}
	 */
	sys.windowPixelResolution = cc.view.getFrameSize();

	/**
	 * The capabilities of the current platform
	 * @memberof cc.sys
	 * @name capabilities
	 * @type {Object}
	 */
	var capabilities = sys.capabilities = {
		"canvas": false,
		"opengl": true
	};
	if( sys.isMobile ) {
		capabilities["accelerometer"] = true;
		capabilities["touches"] = true;
		if (platform === sys.WINRT || platform === sys.WP8) {
			capabilities["keyboard"] = true;
		}
	} else {
		// desktop
		capabilities["keyboard"] = true;
		capabilities["mouse"] = true;
		// winrt can't suppot mouse in current version
		if (platform === sys.WINRT || platform === sys.WP8)
		{
			capabilities["touches"] = true;
			capabilities["mouse"] = false;
		}
	}

	/**
	 * Forces the garbage collection, only available in JSB
	 * @memberof cc.sys
	 * @name garbageCollect
	 * @function
	 */
	sys.garbageCollect = function() {
		//会有卡顿
		// __jsc__.garbageCollect();
	};

	sys.releaseJSBindingObject = function (argument) {
		// body...
		__jsc__.releaseJSBindingObject();
	};


	sys.getJSBindingObjectCount = function (argument) {
		// body...

		if (cc.sys.jsb2)
		{
			return __jsc__.getJSBindingObjectCount();
		}

		return 0;
	};

	/**
	 * Dumps rooted objects, only available in JSB
	 * @memberof cc.sys
	 * @name dumpRoot
	 * @function
	 */
	sys.dumpRoot = function() {
		__jsc__.dumpRoot();
	};

	/**
	 * Restart the JS VM, only available in JSB
	 * @memberof cc.sys
	 * @name restartVM
	 * @function
	 */
	sys.restartVM = function() {
		__restartVM();
	};

	/**
	 * Clean a script in the JS VM, only available in JSB
	 * @memberof cc.sys
	 * @name cleanScript
	 * @param {String} jsfile
	 * @function
	 */
	sys.cleanScript = function(jsFile) {
		__cleanScript(jsFile);
	};

	/**
	 * Check whether an object is valid,
	 * In web engine, it will return true if the object exist
	 * In native engine, it will return true if the JS object and the correspond native object are both valid
	 * @memberof cc.sys
	 * @name isObjectValid
	 * @param {Object} obj
	 * @return {boolean} Validity of the object
	 * @function
	 */
	sys.isObjectValid = function(obj) {
		return __isObjectValid(obj);
	};

	/**
	 * Dump system informations
	 * @memberof cc.sys
	 * @name dump
	 * @function
	 */
	sys.dump = function () {
		var self = this;
		var str = "";
		str += "isMobile : " + self.isMobile + "\r\n";
		str += "language : " + self.language + "\r\n";
		str += "browserType : " + self.browserType + "\r\n";
		str += "capabilities : " + JSON.stringify(self.capabilities) + "\r\n";
		str += "os : " + self.os + "\r\n";
		str += "platform : " + self.platform + "\r\n";
		cc.log(str);
	};

	/**
	 * Open a url in browser
	 * @memberof cc.sys
	 * @name openURL
	 * @param {String} url
	 */
	sys.openURL = function(url){
		sys._application.openURL(url);
	};

	sys.now = function () {
		return Date.now();
	};

	// JS to Native bridges
	// if(window.JavascriptJavaBridge && cc.sys.os == cc.sys.OS_ANDROID){
	//     jsb.reflection = new JavascriptJavaBridge();
	//     cc.sys.capabilities["keyboard"] = true;
	// }
	// else if(window.JavaScriptObjCBridge && (cc.sys.os == cc.sys.OS_IOS || cc.sys.os == cc.sys.OS_OSX)){
	//     jsb.reflection = new JavaScriptObjCBridge();
	// }

	sys.HighPERF = "HIGHT_PERF";//2G<=total memory

	sys.MediumPERF = "MEDIUM_PERF";//1G<=total memory<2G

	sys.LowPERF = "LOW_PERF";//total memory<1G

	sys.VeryLowPERF = "VERY_LOW_PERF";

	sys.devicePERF = sys.LowPERF;//default as LowPERF
};
_initSys();

/**
 * Init Debug setting.
 * @function
 */
cc._initDebugSetting = function (mode) {
	var ccGame = cc.game;
	var bakLog = cc._cocosplayerLog || console.log || log;
	cc.log = cc.warn = cc.error = cc.assert = function () {};

	console.log = function () {};
	console.error = function () {};
	console.warn = function () {};

	if (mode > ccGame.DEBUG_MODE_NONE && !cc.sys.supported_disable_log) {
		console.log = function () {
			bakLog(cc.formatStr.apply(null, arguments));
		};
		console.error = function () {
			bakLog("ERROR :  " + cc.formatStr.apply(cc, arguments));
		};
		console.warn = function () {
			bakLog("WARN :  " + cc.formatStr.apply(cc, arguments));
		};

		cc.error = console.error;
		cc.assert = function (cond, msg) {
			if (!cond && msg) {
				var args = [];
				for (var i = 1; i < arguments.length; i++)
					args.push(arguments[i]);
				console.log("Assert: " + cc.formatStr.apply(cc, args));
			}
		};
		if (mode != ccGame.DEBUG_MODE_ERROR && mode != ccGame.DEBUG_MODE_ERROR_FOR_WEB_PAGE) {
			cc.warn = console.warn;
		}
		if (mode == ccGame.DEBUG_MODE_INFO || mode == ccGame.DEBUG_MODE_INFO_FOR_WEB_PAGE) {
			cc.log = console.log;
		}
	}
};

cc._engineLoaded = false;

cc.initEngine = function (config, cb) {
	require("script/jsb.js");
	cc._renderType = cc.game.RENDER_TYPE_OPENGL;
	cc._initDebugSetting(config[cc.game.CONFIG_KEY.debugMode]);
	cc._engineLoaded = true;
	//config downlaoder manager
	if (cb) cb();
};

cc.getSysLang = function()
{
	return cc.game.sysLang;
};

cc.getLangFont = function() {
	return ed.font;
};

cc.getSysLan = function(){
	return cc.game.sysLang;
} ;
function checkCSVTableExist(languageCode, isPublish){
	var tempIsPublis = isPublish || cc.game.src_publish;
	if(!tempIsPublis){
		return true;//debug版直接返回true
	}
	var isExist = false;
	if(cc.sys.jsb2){
        var languageDbExist = findTableRes(languageCode, "languageDb");
        var skillExist = findTableRes(languageCode, "Skill");
        var unitExist = findTableRes(languageCode, "Unit");
        console.log("languageDbExist: " + languageDbExist + ", skillExist: " + skillExist + ", unitExist: " + unitExist);
        isExist = languageDbExist && skillExist && unitExist;
	}else{
        var filePath = "srcmodule/csvtable_"+languageCode+".jsc";
        isExist = jsb.fileUtils.isFileExist(filePath);
	}

	return isExist;
};

function findTableRes(languageCode, tableName) {
	var path = "";
	var isFileExist = false;
	if(cc.supportEncrypt()){
		path = "csvjson/" + languageCode + "/" + tableName + ".jsone";
		console.log("Find table path: " + path);
		isFileExist = jsb.fileUtils.isFileExist(path);
	}else{
		path = "csvjson/" + languageCode + "/" + tableName + ".jsonc";
		console.log("Find table path: " + path);
		isFileExist = jsb.fileUtils.isFileExist(path);
		if(!isFileExist){
			path = "csvjson/" + languageCode + "/" + tableName + ".json";
			isFileExist = jsb.fileUtils.isFileExist(path);
		}
	}

	return isFileExist;
}

function _getSysLang(config) {
	var CONFIG_KEY = cc.game.CONFIG_KEY;
    var region = config[CONFIG_KEY.region];
    console.log("region:" + region);
    cc.sys.chn = ("official" == region ||
                "channel" == region ||
                "chn" == region);

    cc.game.enbaleDeviceImage = config[CONFIG_KEY.enbaleDeviceImage];

	// 发布版本全局变量
	cc.game.version = cc.sys.jsb2 ? "v2" : "v1";//config[CONFIG_KEY.version];
	cc.game.src_publish = config[CONFIG_KEY.src_publish];
	cc.game.res_publish = config[CONFIG_KEY.res_publish];
	cc.game.activityMode = config[CONFIG_KEY.activityMode];
	cc.game.enbaleDeviceImage = config[CONFIG_KEY.enbaleDeviceImage];
	cc.game.retryTimes = config[CONFIG_KEY.retryTimes];
    cc.game.region = config[CONFIG_KEY.region];
	cc.game.timeout = config[CONFIG_KEY.timeout];
	cc.game.serverThreshold = config[CONFIG_KEY.cdn_check_threshold];
	cc.game.cdnSubPath = config[CONFIG_KEY.cdnSubPath] || "";
	cc.game.config = config;
    
	var langList = CONFIG_KEY.langList || [];
	var langMap = CONFIG_KEY.langMap || {};
	if(cc.sys.chn) {
		langMap.zh = "zh";
		return "zh";
	}

	var ret = dsBridge.call("callApp", {msg: "getPlatformName"});
	var channelName = dsBridge.call("callApp", {msg: "getChannelName"});
	if(ret == "lilith_vietnam" || channelName == "vietnam") {
		return "vn";
	}

	console.log("game.json里的语言：" + config[CONFIG_KEY.sysLang]);
	if(config[CONFIG_KEY.sysLang] === "kr" || config[CONFIG_KEY.sysLang] === "jp" || config[CONFIG_KEY.sysLang] === "vn") {
		return config[CONFIG_KEY.sysLang];
	}

	var checkSupport = function(lang, list) {
		for(var i = 0; i < list.length; i++) {
			var code = list[i];
			if(code === lang) {
				return true;
			}
		}
		return false;
	};
	var value = window.localStorage.getItem("HgameSysLang");
	console.log("本地存储的HgameSysLang:"+value);
	if(value && value !== "" && checkSupport(value, langList)) {
		var isFileExist = checkCSVTableExist(value, config["src_publish"]);
		console.log("本地"+ value + " jsc文件是否存在:"+isFileExist);
		if(isFileExist){
			return value;
		}
	}

	var lang = cc.sys.language;
	console.log("手机系统语言：" + lang);

    //阿拉伯语言正式上的时候记得删除
    if(lang === "ar") {
        lang = "en";
        console.log("系统语言为ar暂不支持默认，更改为：" + lang);
    }

	if(lang && langMap[lang] && checkSupport(langMap[lang], langList) && checkCSVTableExist(langMap[lang], config["src_publish"])) {
        console.log("可以使用手机系统语言：" + lang);
		return langMap[lang];
	}

	return config[CONFIG_KEY.sysLang];
};

cc.checkWIFIIsWS = function (ssid) {
	var CONFIG_KEY = cc.game.CONFIG_KEY;
	var wList = CONFIG_KEY.w_wifi_list || [];
	for(var key in wList) {
		if(ssid === wList[key]) {
			return true;
		}
	}
	return false;
};

cc.override_game_config = function (cfg) {
	if(!cfg) return;

	//催更版本修改
	if (cfg.urgent_appversion) {
		cc.game.lastAppVersion = cfg.urgent_appversion;
		console.log("urgent_appversion:" + cc.game.lastAppVersion);
	}

	//提审版本号修改
	var channelId = ed.platformCfg.getChannelID();
	var reviewVersion = "1.10.0";
    var reviewMd5; // 提审版本 md5文件的md5

	if (cc.inPackageLimitBVersion)
	{
		var channelInfo = cc.inPackageLimitBVersion[channelId];
		if(channelInfo) {
			cc.game.review_host = channelInfo["review"] || "ws://hgame-tva-rev.lilithgame.com:10000";
			var channelname = channelInfo["channelname"];
			if(cfg[channelname]) {
				reviewVersion = cfg[channelname];
                var md5KeyName = cc.supportSplitFilesizeJson() ? "checkversionSplitMd5" : "checkversionMd5";
                reviewMd5 = cfg[md5KeyName];
			}
		}
	}

	console.log("review Version: " + reviewVersion + " app Version:" + ed.getAppVersion() + " channelId:" + channelId);

	var notM1Device =  ed.platformMgr.isRunningAtM1Device() != "True";
	if((reviewVersion == ed.getAppVersion()) && notM1Device){
		cc.game.isReviewMode = true;
		cc.game.region = "rev_" + cc.game.region;
	}

	//提审服修改
	if (cfg.review_host) {
		cc.game.review_host = cfg.review_host;
		console.log("review_host:" + cc.game.review_host);
	}
	console.log("isReviewMode:"+cc.game.isReviewMode+" region:"+cc.game.region+" review_host:"+cc.game.review_host);

    // 提审下载修改
    if (cc.game.isReviewMode)
    {
        // 更新 md5 文件的md5
        if (reviewMd5)
        {
            cc.game.checkversionMd5 = reviewMd5;
            cc.game.updateVersionMd5();

            // 校验一下 md5
            var md5File = cc.getCheckversionZipName();
            var curMd5 = jsb.getMD5Hash(md5File);
            if (curMd5 !== reviewMd5)
            {
                // 强制删除 md5 文件，触发重新下载
                var fullPath = jsb.fileUtils.fullPathForFilename(md5File);
                jsb.fileUtils.removeFile(fullPath);
            }

            cc.game.reviewMd5 = reviewMd5;
            console.log("ReviewMode new md5: " + reviewMd5);
            // 强制刷新一下http下载地址
            cc.game.setDownloadedVersionInfo();
        }
    }
};

//+++++++++++++++++++++++++something about CCGame begin+++++++++++++++++++++++++++

/**
 * An object to boot the game.
 * @class
 * @name cc.game
 */
cc.game = /** @lends cc.game# */{
	DEBUG_MODE_NONE: 0,
	DEBUG_MODE_INFO: 1,
	DEBUG_MODE_WARN: 2,
	DEBUG_MODE_ERROR: 3,
	DEBUG_MODE_INFO_FOR_WEB_PAGE: 4,
	DEBUG_MODE_WARN_FOR_WEB_PAGE: 5,
	DEBUG_MODE_ERROR_FOR_WEB_PAGE: 6,

	EVENT_HIDE: "game_on_hide",
	EVENT_SHOW: "game_on_show",
	EVENT_RESIZE: "game_on_resize",

	RENDER_TYPE_CANVAS: 0,
	RENDER_TYPE_WEBGL: 1,
	RENDER_TYPE_OPENGL: 2,

	NETWORK_PING_ENABLED: true,

	_eventHide: null,
	_eventShow: null,

	/**
	 * Key of config
	 * @constant
	 * @type {Object}
	 */
	CONFIG_KEY: {
		width: "width",
		height: "height",
		engineDir: "engineDir",
		modules: "modules",
		debugMode: "debugMode",
		exposeClassName: "exposeClassName",
		showFPS: "showFPS",
		frameRate: "frameRate",
		id: "id",
		renderMode: "renderMode",
		jsList: "jsList",
		jsModuleList: "jsModuleList",
		jsModuleSplitList: "jsModuleSplitList",
		csvList: "csvList",
		src_publish: "src_publish",
		res_publish: "res_publish",
		sysLang: "sysLang",
		version: "version",
		cdn: "cdn",
		enablePatch: "enablePatch",
		region : "region",
		timeout: "timeout",
		cdnSubPath: "cdnSubPath",
		activityMode: "activityMode",
		cdn_check_threshold: "cdn_check_threshold",
		langList:["cn", "en", "tw", "fr", "ge", "po", "ru", "sp", "tr", "vn", "it", "pl", "id", "th", "kr", "jp", "ar"], //支持翻译的语言 en:"en", zh:"cn", fr:"fr", de:"ge", pt:"po", ru:"ru", es:"sp"
		filterLangList:["cn", "en", "tw", "fr", "ge", "po", "ru", "sp", "tr", "vn", "it", "pl", "id", "th", "kr", "jp", "ar", "zh"], //支持翻译的语言 en:"en", zh:"cn", fr:"fr", de:"ge", pt:"po", ru:"ru", es:"sp" zh:"zh"
		langMap: {en:"en", tw:"tw", zh:"cn", fr:"fr", de:"ge", pt:"po", ru:"ru", es:"sp", tr:"tr", vi:"vn", it:"it", pl:"pl", id:"id", th:"th", ko:"kr", jp:"jp", ar:"ar"},
		w_wifi_list:["Lilith-Release", "lilith-TEST-wifi", "Lilith_test_private", "lilith-Test-wifi", "Lilith-T403-Release"],
		enbaleDeviceImage: "enbaleDeviceImage",
		retryTimes: "retryTimes",
	},

	//备用CDN域名，以备主CDN解析不了。2018.12.17停服更新后生效
	additionalCDNList: [],


	//白名单列表
	_white_user_list : {
	    "48E34AC8-6055-4B36-AEBA-6D3810B2EFAA":"ok",    //李华的iPad mini
	    "9549A9E4-1121-4F3E-B61D-AD7DC2D063E8":"ok",    //李华的iphone6
	    "56B46DDC-3E3E-4BDF-B309-D8E41DEFC96C":"ok",    //狗哥的iphone7 plus
	    "B1B8D3B9-25E3-4E0D-AFD7-456859B684BC":"ok",    //君承的iPhone xr
	    "26D60413-DD2E-4087-A521-5BD790104D8F":"ok",    //谈振东的iphone xs max
	    "8054B83E-47B0-4CB8-AC18-D245B6573858":"ok",    //任轩的iphonex
	    "8D29EAE3-A920-4E05-99EB-E518BD68778B":"ok",    //君承的iPhone 6s
	    "7FDF2E5F-AFAC-451B-85E8-32D71484A3F5":"ok",    //杨贤敏的iPad
	    "AE42B05F-01CD-4B3D-A93E-405EA70C3338":"ok",    //谈振东的ipadmini4
	    "BC9D57EE-8BCA-4CC6-A698-BAB717C01465":"ok",    //吴俊的ipad pro
	    "324F73DE-FB6F-4499-B433-714A1B28FFDC":"ok",    //吴俊的iphone 8p
	    "E7DE44D0-B160-4D7C-BAD8-CE00BB6FD3A9":"ok",    //吴俊的iphoneX
	    "EFCAE3CC-B458-4C5B-9A88-416D5C3A6C39":"ok",    //崔启明iPhone8p
	    "50932A73-60D2-4B84-8E57-BB046C5109F7":"ok",    //戴垠真iPhone11
	    "003C1608-1AB5-455E-8A37-0727CCB4D3B6":"ok",    //戴垠真iPhone6SP
	    "714DD911-CE1E-4042-B4ED-47DF853C83C4":"ok",    //崔启鸣的iPhone X
	    "6E2D5011-534B-4FDC-B51E-00E2BA5102AB":"ok",    //崔启鸣的iPhone X
	    "9E13F1EE-7A6C-4C97-88CF-42C31D0DDD54":"ok",    //崔启鸣的iPhone X
	    "6B426290-38E3-473E-B671-B91CC062368D":"ok",    //张吉波ipad
	    "A97B6022-0D53-46F4-A5E9-279C87457766":"ok",    //iphone11
	    "1150D43F-7436-4D02-9629-7313E0C028DF":"ok",    //戴逸 iPhone
	    "271539C3-14A4-4453-B942-CC62A2599047":"ok",    //周坤 iPad
	    "AF87BA6E-1372-4BA7-BBAC-1565D07249FE":"ok",    //周坤 iphonex
	    "FF9A4AD9-FA2F-4F44-815C-8EC29CF9D111":"ok",    //任轩的iPhone SE
	    "FCDA90C1-7A01-4DCF-BA2C-FB355BA99D66":"ok",    //任轩的iPad air3
	    "24055F4A-B6BE-47B9-97EF-005DEC3FC666":"ok",    //罗欣的iPhone
	    "507FE12D-12B3-4F21-9ABD-7BEC625CE0B3":"ok",    //唐国文
	    "2B572CF4-A3BB-4F9E-9FA2-BB53994C2DE4":"ok",    //带根真
	    "9D72343D-9D69-4C02-B70E-31EF3B569A66":"ok",    //前端开发机iPhone10
	    "887517AC-7E5F-4372-9E9D-496857FA0D71":"ok",    //iPhone11promax
	    "252FE024-695F-4DDB-9610-82C6BED36A45":"ok",    //ipadmini4
	    "8925407C-7FF1-4AD5-9CF7-9DC738218AF1":"ok",    //iPhoneXS
	    "5B7883ED-1444-41BE-91A2-F78A71625626":"ok",    //崔启鸣的iPhonepro
	    "2E98E151-7CC7-4865-BC7B-727E99647A06":"ok",    //任轩的ipad
	    "CA53D21B-B12A-4E88-8A33-CE5DAC6DA2A4":"ok",    //任轩的ipad
	    "8FC896A2-BB76-4C31-B266-A4B47EAA5924":"ok",    //任轩的ipad
		"D149F95D-B4D2-4360-BBF3-38EEBF50BFCF":"ok",    //吴俊的iPhone X

	    "1566358598BE26700830154E9CAF43FC67529016CF":"ok",  //君承的iPad mini

		"783F110F-B6F8-4AA3-AF0B-E20A3036FC3A": "ok",   //iPhone6SP
		"8AD8C016-B063-47DD-B1B9-9445AFFBBB68": "ok",   //iPhone5S
		"556E49F0-BAC6-4B9B-8EC6-449AF10C3D71": "ok",   //iPhone12Pro
		"3EDC61D9-D9C4-4B99-A0BC-263C9D64B19E": "ok",   //iPad
		"0E002710-272D-41AD-A27F-D365C8D481BD": "ok",   //iPad Air(第四代)
		"6802535B-6E49-46F7-B388-22ED5153A78D": "ok",   //iPhone 7Plus（发行测试）
		"7DA57C22-30A5-455B-A19E-77BE764FAD8D": "ok",  	//君承
		"00008103-0011081C34E2001E": "ok", //MacBook Pro M1
		"D0005F84-4B7D-40CE-8B6B-4E8C42FB5659": "ok", //君承的iPhone12
		"249094D7-B824-46A4-956E-2A1DB7084CC3": "ok", //李亮的iPhone11
		"2D9A757C-D87F-4441-A6FD-69174D560710": "ok",  //吴佳俊的iPhonexr
		"EC89FC45-BE91-4E46-95EE-DCBD47C7A69F": "ok", //iPhone Xr（发行测试）
		"A190AA42-56A8-4314-B2E2-1CD4F2B28826": "ok", //iPhone 11ProMax（发行测试）
		"1ABC5931-930C-4A84-8B17-8C699E358797": "ok", //iPhone 11ProMax（发行测试）
		"B6762138-7948-4668-BFEE-D22329BC2F99": "ok", //iPhone 11ProMax（发行测试）
		"B44ACCE3-7C32-489E-932E-6699B39CC95B": "ok", //施凯华的Iphone XS
		"DBCC85EA-7B82-4016-93D0-E1064A1AB14E": "ok", //施凯华
		"FF9A4AD9-FA2F-4F44-815C-8EC29CF9D111": "ok", //任轩 iphone se
		"E5749F82-742F-4836-A141-6A668452C093": "ok", //杨坤的iPhone XR
		"A632AA27-E3CB-45C3-91D3-AADE8498B273": "ok", //杨坤的iPhone 6
		"BEB1A0D5-66DF-47E7-BA79-B9A663559AA0": "ok", //杨坤的iPhone 7 Plus
		"8D59869F-0258-4FAA-8744-A413F1939CF7": "ok", //杨坤的iPhone 8 Plus
		"63E806F4-0241-4670-9803-D345CD987EE0": "ok", //杨坤的iPad Air 2
		"ADCFA366-79B8-43E3-8419-F24118270929": "ok", //杨坤的iPhone 8 Plus
		"F3C0931E-F534-43F8-8D3A-1DA9018D8ECD": "ok", //发行的iPhone XR
		"02AE8BCD-234B-4F5E-884A-3408601C3563": "ok", //发行的iPhone 7plus
		"804822B1-3D4C-442C-B362-041D54F40DF5": "ok", //程威的iPadmini
		"599DE783-0D6B-459C-94EC-A5AEE2DE16C3": "ok", //曹伟欣的iPhone8
		"30D36729-DF9D-485A-936A-6A730AA8D5EA": "ok", //曹伟欣的iPhone13
		"C4594D67-2540-4593-ADE0-E7A9F939D531": "ok", //曹伟欣的iPhone7P
		"00008110-001A39EA34C2801E":"ok",//真真的iphone13pro
		"00008110-001459C91E42801E":"ok",//真真的iphone13mini
		"00008110-00126C360EC2801E":"ok",//真真的iPhone13
		"d0212524f38276d3113135b0169569ddcbf034ba":"ok",//真真的iphone6p
		"8ddd6b1abbc0d3a94bfb453d6009c3876fff6403":"ok",//真真的iphone5s
		"62BB7ABA-6963-4F0F-BBED-A1C9CF2A7961":"ok",//真真的iphone12
		"30EE8401-C20E-42D4-93F3-3979234634D2":"ok",//真真的iPad Air(第四代)
		"E4786AFE-3F85-4BEC-8E2A-1CE74C6E068C":"ok",//真真的iphone11
		"e345ec56b49b76ac3b08c75a7befeecbc891dca7":"ok",//真真的iphone 6s Plus
		"16328868222D8B51A8FE804BE485734C8E4527954B": "ok", //发行测试的iPhone 13
		"163464027065A31DC3F2054B779056CD2C3162D90E": "ok", //发行测试的iphone13pro
		"16360139356A4F100E26AA449C91E3BEA4D36D152A": "ok", //发行测试的iphone13promax
		"1635146849FDF1A974827B42F0AA21C754DFE043F3": "ok", //发行测试的iphone13mini
		"16490532641172E47AE6AD4A2EA9508FE2CA61005C": "ok", //发行测试的iphone11
		"72AF43B4-4D46-4D3C-91A9-9A47517E34F7": "ok", //发行测试的iPadAir(第四代)
		"164966121413586016943F42B680BEE925A20D35B7": "ok", //发行测试的iphoneSE
		"B60604DA-33B6-4C2F-8D24-46EC5B22F4BC": "ok", //发行测试的iphone8Plus
		"e693569d387b4e7fbd263d7e2c5ae655": "ok", //发行测试的iphone8
		"bcba7a38c38b4f3b961a031ada89ea80": "ok", //发行测试的iphone13pro
		"5b3fa92a18cb44c7a3818baebb15753d": "ok", //发行测试的iphone12mini
		"728fb861147646beb69247a0732735c2": "ok", //发行测试的iphone6p
		"5CBC4B6F-9745-47A5-87EE-994D88EB5F93": "ok", //成都郝琦的iPhone
		"424D053A-BF9E-4288-9AD0-C46FB7F829C8": "ok", //成都魏敏乐的iPhone
		"54D0EC2A-08F2-483F-A096-FA91E170836E": "ok", //吴俊的iPhoneX
		"B6541FF6-561A-4E1F-8BB0-F68A8BBD1932": "ok", //王湲媛的iPhone13
		"9655D42B-B57C-4FE6-A551-1CE077F525B0": "ok", //平台的iPhoneSE2
		"935166E6-1F90-4D56-AD0A-4767C67E0EC7": "ok", //平台的iPhone8
		"D623B068-1D50-40C8-A629-92F022A9A921": "ok", //平台的iPhoneX
		"424D053A-BF9E-4288-9AD0-C46FB7F829C8": "ok", //平台的iPhone11
		"BD42C4DF-ACFE-4F29-A1FF-2305A6A0F8AE": "ok", //平台的iPhoneSE
		"0D03805E-03C3-4893-9243-E55ED8DF455A": "ok", //
		"E6C08AAD-8892-461D-BC50-B279C99BFA62": "ok", //
		"C93C3B06-0692-4DEE-9DAB-C7EC0CEC1F48":"ok", //平台的iPad 第六代 ios14.6
		"868E9B37-978C-4FC6-A40B-49088B715A7A":"ok", //平台的iiphone6p ios12.5
		"19DB4ABC-E430-4A63-87BD-5B2C10C2E7A2":"ok", //平台的iiphone6sp ios14.2
		"7E4C719D-38AD-4802-8F4D-1F7A1B23A138":"ok", //平台的iiPhone X
		"8D054F84-C369-4183-970B-31C59EA1380F":"ok", //平台的iiphone 13 mini
		"CCF938C2-4166-45C4-A9A3-45C9CE5FB796":"ok", //平台的iPhone
		"E4346AC4-3053-4A4D-9A05-4DE24B4C0DAC":"ok", //平台的iPhone Xr
		"4708EE81-E91A-4158-9B89-CFE5B06B7AB0":"ok", //平台的iPhone 7p
		"d915bd76d5634320838f68f9fb48241d":"ok", // 发行测试
		"A4126240-76F1-4E8C-82AC-E712CD5849DC":"ok", // 发行测试iphone8
		"468D1DBC-C163-48D1-83FE-89949FA094B6":"ok", // 发行测试iphoneX
		"5AF0FF32-0F62-4E5E-AB02-565E9E8838E2":"ok", // 发行测试iphone12ProMax
		"8FEBF053-8981-4B51-9211-44A32B99D36A":"ok", // 发行测试iphone12
		"76F1F4F7-F19B-47DA-97B6-7B90B6C00766":"ok", // 发行测试iphone6s
		"E81F3D39-CCE2-4FEE-ABC4-2F9F40F6D4B2":"ok", // 发行测试iphoneXsmax
		"7CC75D0E-8B9A-4BE0-A3BF-A757CCE7CA33":"ok", // 发行测试iphone8p
		"B02F7408-A50D-4135-B8DA-7BED238662ED":"ok", // 发行测试iphone8p
		"A9CF7242-6307-4364-9678-BDCB544FE494":"ok", // 张昊的iPhone
		"A9DB9989-37E2-4488-9B7E-8B4AACD4AEB6":"ok", //
		"34839D55-CC31-4516-A0C0-415F8CAD15F3":"ok", //
		"5ECB2023-8D50-4340-930F-05CA001DFF1C":"ok", //
		"375B0104-F071-4F66-A180-163C63E73A9E":"ok", //
		"9FA873F6-EA10-4E0D-9E54-8B1D6EDFFB4D":"ok", //君承的iPhone11Pro1
		"569D7F8F-2634-40F5-A930-DF7087EAAD6D":"ok", //君承的iPhone11Pro2
		"27A1B091-DD54-47B8-B13F-237744911E0B":"ok", //君承的iPadair5
		"33333AB3-25FA-43EE-B568-D63945361BF5":"ok", //发行
		"B78AF63A-50E2-4FE0-B3EF-18FB4A28865D":"ok", //发行
		"E725373C-E59D-4DF9-8B31-CD9822FA76E5":"ok",
		"55FD38F8-77C5-41ED-A13C-14A45F7F6F85":"ok",
		"94495C03-1E19-4C5A-9E33-83FEB5A57715":"ok",//iphone13Pro max
		"BF2F2CB9-0380-4244-A173-DE87073BDDDD":"ok",//君承的iPhone7
		"A89F21EB-0C24-471C-9C61-921CB1778222":"ok",//刘洁的15 plus
		"B6762138-7948-4668-BFEE-D22329BC2F99":"ok",//刘洁的11 pro max
		"55F50481-74C6-4E0A-A5A5-BF8F1EF6BDCB":"ok",//iPhone 7p
		"5CD075A8-1FAC-4B73-AB8A-77F3788D89FB":"ok",//君承成都测试1
		"C8EBC0CC-D8B9-40F7-AF32-0077A4669FCF":"ok",//君承成都测试2
		"68B7D024-D578-4F3E-81B9-76B9B80E230F":"ok",//刘洁测试ipad pro 4
		"0525C386-8F05-492B-B7EC-2B4300DFC6D0":"ok",//刘洁测试iPhone XS Max
		"3D23EE90-E399-446B-B5A4-B0186AF3DBF9":"ok",//刘洁测试iPhone 11
		"EE44169F-606D-4C68-A2DE-8C6DA55643DF":"ok",//刘洁测试iPhone XR
		"EBCD391C-3AB8-44B8-A171-3BF8CCA24F5D":"ok",//刘洁测试iPhone 16Pro
		"0E3D63AE-1C73-4873-BEEC-6D7BFC109E90":"ok",//刘洁测试iPad Pro 13
		"7724CA92-7648-406D-BDD1-EB4B75203270":"ok",//平台测试陈向东
		"F9416987-EB6E-4232-A966-C106465EE62C":"ok",//平台测试的iOS
		"b94d144cf94eb4ebdcce1c26d03fb8887c108b":"ok",//平台测试的iOS
		"A4EAAD54-FD79-4935-8752-FF4A3EC92BED":"ok",//平台测试的iOS
		"05bd4f49b4034018ace933107a269326":"ok", //平台测试的iOS
		"cfb287b51c02438c97f267a0f880d7a8":"ok", //平台测试的iOS
		"62BB7ABA-6963-4F0F-BBED-C8C9CF2A7961":"ok", //平台测试的iOS
		"115A18F5-31FF-41B8-B4F8-24C413544102":"ok", //平台测试的iOS
		"BD42C4DF-ACFE-4F29-C8FF-2305A6A0F8AE":"ok", //平台测试的iOS
		"C12AB391-78C6-4BDF-B528-449C14A3D3F2":"ok", //平台测试的iOS
		"486bcf7b14e24c7fb4eca8faef3da75e":"ok", //平台测试的iOS
		"38B3F678-862A-4809-BD22-6D05B8E8D7CF":"ok", //平台测试的iOS
		"D2ECE95A-3234-4701-BA62-89E5BE9E2BD2":"ok", //平台测试的iOS
		"f46d437642e3416ea5a1d94f43afbf9d":"ok", //平台测试的iOS
		"07D9D03D-85F2-46ED-B1C9-689C79ABDA8D":"ok", //平台测试的iOS
		"8E7EA4FE-36A7-4BE6-A824-B0C6D5B9F50F":"ok", //平台测试的iOS
		"E9C59DBF-5234-491E-A30F-B50FE58E3378":"ok", //平台测试的iOS
		"69E0563F-CC06-4B02-B0BE-DE0E60CD5883":"ok", //平台测试的iOS
		"180E5061-A531-4F8E-AAA9-C30F531CAE36":"ok", //平台测试的iOS
		"FAA01D1D-082E-4E26-9485-79AE0DADE8E6":"ok",//平台测试的iOS
		"03783FAA-7358-406B-BF42-5C970B388EEE":"ok",//许超云的iOS
		"D96C27ED-C9B9-4A94-809D-C94D13B33C55":"ok",//许超云的iOS
		"B334BC89-7839-4B32-A3A6-72FEC5FB095A":"ok",//王星冉的iOS
		"BA7936FE-5592-4263-A2CB-22B71EDCDBDF":"ok",
		"95D4EDA3-49AC-4916-86DD-4CB345A31111":"ok",//黄用鑫的iOS
		"37B66073-9566-4550-A977-D05B0DF70767":"ok",//王星冉的iOS
		"A5BBCD45-3613-439F-87BC-91CB4CF8B1E6":"ok",//许超云的iOS
		"D7153E01-CEFF-4B44-8765-7E87E78CA0F0":"ok",//许超云的iOS
		"08959392-694B-4F73-B6FC-A8F75658A719":"ok",//黄用鑫的iOS
		"BB0AACD4-BAA5-4996-816A-013752A7E35A":"ok",//黄用鑫的iOS
		"A7595FC6-9968-4D91-8D0F-CD5BA70D7011":"ok",//黄用鑫的iOS
		"8C84D808-AEF9-4D9E-B4B0-2097CEFA9AB4":"ok",//黄用鑫的iOS
		"577B23F6-D26B-4E3E-AE5A-7705E1FC8637":"ok",//兼容组的iOS
		"3B5524AD-4E07-4501-8E09-CBCD40FE1605":"ok",//兼容组的iOS
		"817417E1-83B8-4969-A25E-B556C8FBE046":"ok",//兼容组的iOS
		"E7F13A88-7D61-4709-8BF6-059758BA30F3":"ok",//兼容组的iOS
		"BD425C46-F65A-43D2-9545-3E49F96DA5F2":"ok",//兼容组的iOS
		"DA3A123B-686C-4DAD-A569-8CD42640890F":"ok",//兼容组的iOS
		"029FA611-9E89-40DF-85F5-76290808E6E7":"ok",//兼容组的iOS
		"0CFA2648-3900-4A19-B28D-1CFEA2107B57":"ok",//兼容组的iOS
		"16BD8425-38D3-4627-924F-0736A9679CD5":"ok",//兼容组的iOS
		"2F6B8042-7D72-4F93-968E-543EBC443191":"ok",//兼容组的iOS
		"8D1769F1-4CB2-40B1-85FF-F677F1A4058E":"ok",//兼容组的iOS
		"6CB07FC5-D35E-4CF8-833A-1D073B1018CC":"ok",//兼容组的iOS
		"D598A54E-6C19-4D70-941E-CCCE451873AB":"ok",//兼容组的iOS
		"6EFEF979-D9FC-42B7-90F0-1CE7B2A9D236":"ok",//兼容组的iOS
		"2AD81C84-342F-4199-9564-9AB54DDBBA1B":"ok",//iPhone 13 mini
		"4C5AC361-6CB4-4062-BBDC-88A7888966B4":"ok",//iPhone 13 pro max
		"40661144-9283-4DDE-99DF-0BDC5FFA2121":"ok",//iPhone 15
		"CBF7DF72-0C8C-494C-80AC-81980E91667A":"ok",//iPhone 15 pro
		"8484337D-94BB-472A-8072-68A485B62765":"ok",//iPhone 16
		"1EBF3CDF-8857-4420-922B-2808F6FE0682":"ok",//iPhone 16 pro max
		"44B8F067-A8E1-44D0-AB64-3098037B8900":"ok",//许超云的iOS
		"BA50057B-01F8-43DE-BB21-FBE8AD20BA77":"ok",//兼容组的iOS
		"62DD0D6A-1260-494D-9B9D-7ABA024A4F1F":"ok",//兼容组的iOS
		"577B23F6-D26B-4E3E-AE5A-7705E1FC8637":"ok",//兼容组的iOS
		"ED79C2AE-9226-4CD7-8FB2-DF76D3C50A67":"ok",//兼容组的iOS
		"3B5524AD-4E07-4501-8E09-CBCD40FE1605":"ok",//兼容组的iOS
		"585B3F48-16E5-43A1-8806-74FBE2817352":"ok",//兼容组的iOS
		"7990F683-7FBC-453B-89AF-8F4AE410997D":"ok",//兼容组的iOS
		"D53F4531-007F-444A-93EC-F4364E4DC0D5":"ok",//兼容组的iOS
		"817417E1-83B8-4969-A25E-B556C8FBE046":"ok",//兼容组的iOS
		"E7F13A88-7D61-4709-8BF6-059758BA30F3":"ok",//兼容组的iOS
		"BD425C46-F65A-43D2-9545-3E49F96DA5F2":"ok",//兼容组的iOS
		"09A4A46E-AA8C-4D38-9A77-893D59AD7DD2":"ok",//兼容组的iOS
		"1B044B06-402C-48FB-8E01-5396382BD8F0":"ok",//兼容组的iOS
		"DA3A123B-686C-4DAD-A569-8CD42640890F":"ok",//兼容组的iOS
		"B9CFD926-CCD4-448A-834F-7CE2520AA0E1":"ok",//兼容组的iOS
		"D007787A-6F91-480C-9F26-779F55458DE5":"ok",//兼容组的iOS
		"029FA611-9E89-40DF-85F5-76290808E6E7":"ok",//兼容组的iOS
		"4D7C31CF-517C-4299-B15A-2D6DFD42C4B4":"ok",//兼容组的iOS
		"97C5ED5F-FC60-4116-A1DF-60750AE6E761":"ok",//兼容组的iOS
		"0CFA2648-3900-4A19-B28D-1CFEA2107B57":"ok",//兼容组的iOS
		"1568B3B6-4625-424A-86A9-A6F5FBF456F5":"ok",//兼容组的iOS
		"5487FAEC-0001-4CCF-9CAC-349FAD166162":"ok",//兼容组的iOS
		"674BAC93-F065-452C-BC80-728E4B9BCBE7":"ok",//兼容组的iOS
		"B11F7941-14EC-416C-8ABC-10E4E6EA2EB2":"ok",//兼容组的iOS
		"16BD8425-38D3-4627-924F-0736A9679CD5":"ok",//兼容组的iOS
		"2F6B8042-7D72-4F93-968E-543EBC443191":"ok",//兼容组的iOS
		"8D1769F1-4CB2-40B1-85FF-F677F1A4058E":"ok",//兼容组的iOS
		"6CB07FC5-D35E-4CF8-833A-1D073B1018CC":"ok",//兼容组的iOS
		"D598A54E-6C19-4D70-941E-CCCE451873AB":"ok",//兼容组的iOS
		"3CD74DB5-3220-4491-89D9-966B29D14688":"ok",//兼容组的iOS
		"820E6EEA-834C-48D6-894F-4B05B63A28A3":"ok",//兼容组的iOS
		"6EFEF979-D9FC-42B7-90F0-1CE7B2A9D236":"ok",//兼容组的iOS
		"EE3B4993-79EA-4953-B72F-C1E0395EA245":"ok",//兼容组的iOS
		"D59BA352-D3BE-4E15-8907-1BC370AB0A36":"ok",//兼容组的iOS
		"639E5628-95B6-495D-B394-6C8E80C3E031":"ok",//兼容组的iOS
		"D93A25B9-4371-48DC-8036-3F2BB838855A":"ok",//兼容组的iOS
		"8D6C2AEA-B22C-4286-9DC5-BE6C604613D6":"ok",//兼容组的iOS
		"1DE7259D-833D-40C1-BEC4-4C183AEB1F79a":"ok",//兼容组的iOS
		"614CB9BB-4362-482C-BB7F-7F90FF9E4F4C":"ok",//兼容组的iOS
		"744COFD9-73E7-4C58-B511-3CBC3E08FBE4":"ok",//兼容组的iOS
		"B04D49C1-0E19-44F1-9E62-94C10AD62A5A":"ok",//兼容组的iOS
		"45168BDB-B5FB-4472-AB75-C3BAC10EFCA7":"ok",//兼容组的iOS
		"ADBA9402-CF59-4B97-84E9-ABA1D5CF1827":"ok",//兼容组的iOS
		"C6A9907F-7AF6-4781-86C6-6CA273189F0C":"ok",//兼容组的iOS
		"93C8BBD5-5CAD-4340-8779-F00328735267":"ok",//兼容组的iOS
		"19EC96BA-7FFF-4EEA-9B48-BE4C07A7C07B":"ok",//兼容组的iOS
		"2E2E4BBE-07AC-4D2D-96C0-C19BE38C0168":"ok",//兼容组的iOS
		"B9C1C1FC-8EBE-4BB2-B1B9-9ECAAADB7384":"ok",//兼容组的iOS
		"D64A650D-B732-4576-BD5B-5139AD95306D":"ok",//兼容组的iOS
		"2BF54652-F291-4DF0-9469-B0443C7E7840":"ok",//兼容组的iOS
		"1C8327A6-AFF4-45B8-BD19-AE18908302E2":"ok",//兼容组的iOS
		"AD14B492-775B-4E8A-BD88-266257D2FCAB":"ok",//兼容组的iOS
		"F91BD632-F48D-4F3A-A15B-D90F3A00C22F":"ok",//兼容组的iOS
		"58AC5993-8FBA-40D3-B528-C70F6E868B10":"ok",//兼容组的iOS
		"44D7B4C5-92E5-4346-9CE6-CE5965580DE3":"ok",//兼容组的iOS
		"3D06C312-4EDB-48C1-9F75-89DAEC3E1FA1":"ok",//兼容组的iOS
		"893B3335-F7AC-4B3E-BC33-FD00439EB135":"ok",//兼容组的iOS
		"CDEEDDD0-51B9-4068-99EC-441DD2BD1A4E":"ok",//兼容组的iOS
		"852BF118-0DDC-4674-B24E-DD1COF14DA8A":"ok",//兼容组的iOS
		"5D643529-1B07-4F42-BDF3-4A5CC4634A3F":"ok",//兼容组的iOS
		"C195A0BA-E39A-4E82-868D-53ADA1611D1B":"ok",//兼容组的iOS
		"62B77F52-F4FC-4931-A03D-5885659ABDFA":"ok",//兼容组的iOS
		"509E30CC-89CF-469C-A9F9-2321B99A21D6":"ok",//兼容组的iOS
		"5B66FAF5-0A74-430F-9112-5E9236AB2A199":"ok",//兼容组的iOS
		"695FE3EC-44B9-48FB-920F-CE98CF54484F":"ok",//黄用鑫的iPhone
		"C0E1B92A-25A5-4DA8-9A09-7AA7E877B94E":"ok",//iPhone7p
		"A4183585-DC42-4998-B9C3-5A610E972948":"ok",//康申奥的手机
		"19068371-5082-41FC-A12C-A7DBEF44076D":"ok",//康申奥的手机
		"88E26E70-42B6-4CAB-B684-85A3D0FF7CE1":"ok",//康申奥的手机
		"8990319E-37AD-4E84-8A47-34CA491659DC":"ok",//QAIPADMINI5
		"40F64BCC-8C43-46EC-8C21-8181408C2055":"ok",//杨勇的IOS
		"7A4724E7-1A4A-465E-BD16-A4DB91681685":"ok",//程序的SE
		"66C27AA5-5EE3-43A0-A34B-9A6234E978D3":"ok",//kimi17pro
		"C70ADA8F-DC51-4AD4-8055-8F55C5C89F86":"ok",//kangipad10
		"A68F7427-A055-4A63-974D-08E9F370B1E1":"ok",//kangiphone17
		"823DF824-8997-4516-B919-272F87B284C7":"ok",//兼容测试组设备
		"1DE7259D-833D-40C1-BEC4-4C183AEB1F79":"ok",//兼容测试组设备
		"AF3D2D8D-808B-47CC-B611-93C6DDE5EF9B":"ok",//兼容测试组设备
		"852BF118-0DDC-4674-B24E-DD1C0F14DA8A":"ok",//兼容测试组设备
		"C195A08A-E39A-4E82-868D-53ADA1611D1B":"ok",//兼容测试组设备
		"3EED8B73-557B-4BB1-843A-EB8BB3F7D8228":"ok",//兼容测试组设备
		"EC4AB9A0-380F-4DB8-9EC7-B208CF5707A0":"ok",//兼容测试组设备
		"1651A078-0E91-45AD-8CAC-6A15940CD447":"ok",//兼容测试组设备
		"7119729D-3A93-49CB-9893-08441C24DBC2":"ok",//兼容测试组设备
		"5B66FAF5-0A74-430F-9112-5E9236AB2A19":"ok",//兼容测试组设备
		"744C0FD9-73E7-4C58-B511-3CBC3E08FBE4":"ok",//兼容测试组设备
		"A69A120E-069A-42FA-9BFE-2F96999C8CBF":"ok",//朱珊的手机
	},

	checkIsWhiteUser:function () {
	    if(cc.sys.OS_IOS == cc.sys.os) {
	        var idfa = dsBridge.call("callApp", {msg: "getIDFA"});
	        if(this._white_user_list[idfa] === "ok") {
	            return true;
	        }
	        var player_sign = window.localStorage.getItem("OPEN_WHITE_USER");
	        if("SU9T5YaF572R55m9MTAyNOWQjeWNleWQjumXqA==" == player_sign) {
	            return true;
	        }
	    }
	    return false;
	},

	// states
	_configLoaded: false,//whether config loaded
	_paused: false,//whether the game is paused
	_prepareCalled: false,//whether the prepare function has been called
	_prepared: false,//whether the engine has prepared

	_intervalId: null,//interval target of main

	//版本控制相关
	isReviewMode: false,
	_versionBigArea: "global",
	_versionMilestone: "v2",
	whitelistOpened: false,
	_whiteUserCodeLoaded: false,
	_mysticalCodeLoaded: false,
	_versionListLoaded: false,
	_patchListLoaded: false,
	_patchDownloadList: [],
	currentVersion:"hgame_v1.1.23.000005",
	update_progress: 0,
	retryCnt:0,
	retryVerify:0,
	first_host:"",
	second_host:"",
	third_host:"",
	cdn_list:"",
	review_host:"",
	extraBackdownLoadList: [],
	hdBackdownloadList: [],
	fileConfig: {},
	deviceImageModules: [],
	opennetlog: true,
	resDir:"rel",
    resNextDir: "rel_b",
	patch: "patches",
	patch_preffix: "patches_new",
	_isGameLaunched: false,
	/**
	 * Config of game
	 * @type {Object}
	 */
	config: null,

	/**
	 * Callback when the scripts of engine have been load.
	 * @type {Function}
	 */
	onStart: null,

	/**
	 * Callback when game exits.
	 * @type {Function}
	 */
	onStop: null,

	getIsGameLaunched:function(){
		return this._isGameLaunched;
	},

	setIsGameLaunched:function(bool){
		this._isGameLaunched = !!bool;
	},

//@Public Methods

//  @Game play control
	/**
	 * Set frameRate of game.
	 * @param frameRate
	 */
	setFrameRate: function (frameRate) {
		var self = this, config = self.config, CONFIG_KEY = self.CONFIG_KEY;
		config[CONFIG_KEY.frameRate] = frameRate;
		cc.director.setAnimationInterval(1.0/frameRate);
	},

	/**
	 * Run the game frame by frame.
	 */
	step: function () {
		cc.director.mainLoop();
	},

	/**
	 * Pause the game.
	 */
	pause: function () {
		this._paused = true;
		cc.director.pause();
	},

	/**
	 * Resume the game from pause.
	 */
	resume: function () {
		this._paused = false;
		cc.director.resume();
	},

	/**
	 * Check whether the game is paused.
	 */
	isPaused: function () {
		return this._paused;
	},

	/**
	 * Restart game.
	 */
	restart: function () {
		__restartVM();
	},

	/**
	 * End game, it will close the game window
	 */
	end: function () {
		close();
	},

//  @Game loading
	/**
	 * Prepare game.
	 * @param cb
	 */
	prepare: function (cb) {
		var self = this,
			config = self.config, 
			CONFIG_KEY = self.CONFIG_KEY;

		// Already prepared
		if (this._prepared) {
			if (cb) cb();
			return;
		}
		// Prepare called, but not done yet
		if (this._prepareCalled) {
			return;
		}
		// Prepare never called and engine ready
		if (cc._engineLoaded) {
			this._prepareCalled = true;

			var jsList = [];

			if (cc.sys.jsb2) {
				//csv file load
				var preloadList = [
					"languageDb",
				];

				for (var i = 0; i < preloadList.length; i++) {
					var tbname = preloadList[i];
					ed.loadConfigFile(tbname);
				}

				if (cc.game.config.src_publish && !this.isSrcMode()) {
					var jsModuleSplitList = config[CONFIG_KEY.jsModuleSplitList] || config[CONFIG_KEY.jsModuleList];
					if (!jsModuleSplitList) {
						jsModuleSplitList = [];
					}
					for (var i = 0; i < jsModuleSplitList.length; i++) {
						jsList.push("srcmodule/" + jsModuleSplitList[i] + ".js")
					}
				} else {
					var jsListWithModule = config[CONFIG_KEY.jsList];
					//src mode
					if (self.isSrcMode()) {
						jsListWithModule = cc.game.jsList;
					}
					var jsModuleList = config[CONFIG_KEY.jsModuleList];
					for (var i = 0; i < jsModuleList.length; i++) {
						jsList = jsList.concat(jsListWithModule[jsModuleList[i]])
					}
				}
			}


			cc.game.gamecodeJsList = jsList;
			cc.log(">> Loading game jslist", jsList.length);
			if (jsList) {                
				cc.loader.loadJsWithImg(jsList, function (err) {
					if (err) throw new Error(err);
					cc.log(">> Loading game jslist done!");

					cc.reportAppEvent("game_script_load_finished");

					if (cb) cb();
				});
			}
			else {

				cc.reportAppEvent("game_script_load_finished");

				if (cb) cb();
			}

			return;
		}

		// Engine not loaded yet
		cc.initEngine(this.config, function () {
			self.prepare(cb);
		});
	},

	/**
	 * Run game with configuration object and onStart function.
	 * @param {Object|Function} [config] Pass configuration object or onStart function
	 * @param {onStart} [onStart] onStart function to be executed after game initialized
	 */
	run: function (config, onStart) {
        console.log("cc.game.run");
		if (typeof config === 'function') {
			cc.game.onStart = config;
		}
		else {
			if (config) {
				cc.game.config = config;
			}
			if (typeof onStart === 'function') {
				cc.game.onStart = onStart;
			}
		}

		var data = cc.game.gameData;

		if (this.isSrcMode())
		{
			var srcPackData = require("game_debug.json");
			cc.game.jsList = srcPackData[cc.game.CONFIG_KEY.jsList] || [];
			data[cc.game.CONFIG_KEY.jsModuleList] = srcPackData[cc.game.CONFIG_KEY.jsModuleList] || [];
		}

		this._initConfig(data || {});

		this.prepare(cc.game.onStart && cc.game.onStart.bind(cc.game));
	},

	isSupportSrcMode: function (argument) {
		// body...
		return cc.supportEncrypt() && cc.game.whitelistOpened && cc.game.res_publish;
	},

	isSrcMode: function (argument) {
		// body...
		return this.isSupportSrcMode() && !cc.game._skip_src_mode;
	},

	loadingWhiteUserCode: function ( cb ) {
		// body...
		var self = this;

		var white_cb = function ( error ) {
			// body...
			if (error)
			{
				cc.log("[loadingWhiteUserCode] abandon src mode");
				cb && cb();
				return;
			}

			if (self.isSupportSrcMode())
			{
				self.setDownloadedVersionInfo();

				cc.game.loadSrcpack(function (argument) {
					// body...
					cb && cb();
				});
			}
			else
			{
				cc.log("[loadingWhiteUserCode] not src mode");
				cb && cb();
			}
		};

		if (self._checkisWhiteMode())
		{
			cc.log("loading white user");
			self._LoadWhiteUser(function( error ) {
				if(self.switchUnPatchMode()){
					cc.log("[switchUnPatchMode] success !!! ");
					cb && cb();
				}
				else{
				white_cb( error );
				}
			});
		}
		else
		{
			white_cb();
		}
	},
	switchUnPatchMode:function(){
		//白名单模式下，在hgame.txt同级位置 放一个hgameDebugPatch.txt 文件，支持内网不更新
		var debug = dsBridge.call("callApp", {msg: "checkDebugPatch"});
		cc.log("checkDebugPatch:" + debug);
		if(debug == "DebugPatch") {
			//忽略src_pack 文件包
			cc.game.isSupportSrcMode = function(){
				return false;
			};
			//不检查版本更新
			cc.game.checkVersion = function(){
				return false;
			};
			//更新流程走完后记住当前的版本，以便去掉hgameDebugPatch.txt在内网可以正常更新
			cc.game.rememberTheLastestVersion = function(){
				var version = cc.game.currentVersion;
				window.localStorage.setItem("_versionCurrent", version);
				var appver = ed.getAppVersion();
				window.localStorage.setItem("binaryAppVersion",appver);
			};
			return true;
		}
		return false;
	},

	removeSrcpack: function (argument) {
		// body...
		var src_zip = "src_pack.zip";
		var isExist = jsb.fileUtils.isFileExist(src_zip);
		if (isExist)
		{
			var fullPath = jsb.fileUtils.fullPathForFilename(src_zip);
			if (fullPath)
			{
				var bRemoved = jsb.fileUtils.removeFile(fullPath);
				if (bRemoved)
				{
					cc.log("removed old src_pack.zip, will load update it");
				}
			}
		}

		var res_version = src_zip + "." + this.getResVersion()
		var fullPath = jsb.fileUtils.fullPathForFilename(res_version);
		if (fullPath)
		{
			jsb.fileUtils.removeFile(fullPath);
		}
	},

	loadSrcpack: function ( cb ) {
		// body...

		//if exist return directly
		var src_zip = "src_pack.zip";
		var isExist = jsb.fileUtils.isFileExist(src_zip);
		if (isExist)
		{
			cb && cb();
			return;
		}

		cc.log("loading src_pack.zip");

		//cdn load
		var resMgr = hg.ResourceManager.getInstance();
		resMgr.loadResourceFile([src_zip], function(error, url, idx, isEnd){

		    if (error)
		    {
		        //if failed, skip src_pack mode
		        cc.game.setSkipSrcMode(true);
		        cc.log("[loadSrcpack] load src_pack.zip failed, skip src mode now");
		    }

		    if (isEnd)
		    {
		    	cc.log("[loadSrcpack] will use src mode");
		    	cc.sys.restartVM();
		    }
		});
	},

	prepareJson: function ( cb ) {
		// body...

		var self = this;

		//perform
		if (cc.supportJsonInitialized())
		{
			cc.log("initializing json");
		    hg.ResourceManager.getInstance().performConfig();
		}

		self.setDownloadedVersionInfo();
		
		var callback = function (argument) {
			// body...
			cc.game.vercontrol_log = T("jsb_boot_0_2137236122_0","正在初始化本地文件。");
			cb && cb();
		};

		setTimeout(function (argument) {
			// body...
			callback();
		}, 0);
	},

	versionControl: function(cb){
		var self = this;
		if(!self._isSetBuglyUid) {
			self._isSetBuglyUid = true;
			var buglyUid = window.localStorage.getItem("BuglyUid");
			buglyUid && dsBridge.call("callApp", {msg: "setBuglyUid",  uid: buglyUid});
		}

		var needUpdate = false;
		if (cc.game.config.enablePatch)
			needUpdate = true;

		if(!needUpdate) {
			this._loadConfiged = true;
			this._versionLoaded = true;
			this._patchUpdated = true;
			this._languageResChecked = true;
			this._md5Loaded = true;

			if (cc.sys.platform === cc.sys.WIN32) {
				// 不知道为啥之前!needUpdate的情况下不把_mysticalCodeLoaded置为true，开发环境有时候出现拉不到backdoor文件或者拉到backdoor报错的情况。
				// 这里只让win32平台不下载backdoor
				this._mysticalCodeLoaded = true;
			}
		}

		//ios审核模式
		if(cc.game.isReviewMode === true ||
			(cc.game.cdnSubPath !== "" && cc.game.cdnSubPath !== "renxuan")) {
			this._versionLoaded = true;
			this._patchUpdated = true;
			this._mysticalCodeLoaded = true;
			// this._md5Loaded = true;
		}

		if(!this._loadConfiged)
		{
		   this._loadConfig(function(){//下载cdn上的project.json文件，记录latestVersion
				self.versionControl(cb);
			});
			return ;
		}

		if(!this._networkChecked)
		{
			//check NetworkManager autoSwitch CDN
			cc.game.checkNetworkSetting();
			this._networkChecked = true;
		}

		if(!this._mysticalCodeLoaded){
			this._LoadMysticalCode(function () {
				self.versionControl(cb);
			});
			return;
		}

		//检查游戏版本切换逻辑
		if(!this._isCheckedGameResDir) {
			this._checkGameResDir(function () {
				self._isCheckedGameResDir = true;
				self.versionControl(cb);
			});
			return;
		}

		if(ed.checkAndBlockApp()) {//强更检查，是否重下app
			cc.reportAppEvent("game_force_update");
			return;
		}

		if(!this._serverStatusCheck)
		{
			cc.game.vercontrol_log = "";
			this._serverStatusCheck = true;
			var status = ed.checkAndShowServerStatus(
				function(){
					if (self._checkisWhiteMode())
					{
						self.versionControl(cb);
						return true;
					}
					else
						return false;
				}
			);
			if(status)
				return;
		}

		if(!this._languageResChecked){//多语言资源检查
			this._checkLanguageResUpdate(function () {
				cc.reportAppEvent("game_multi_lang_resource_check_finsihed");
				self.versionControl(cb);
			});
			return;
		}

        // 预下载检查
        if (this.checkSupportPreDownload() && !this.checkNextVersionRes)
        {
            self.loadNextProject(function () {
                self.versionControl(cb);
            });
            return;
        }

		if(!this._versionLoaded)
		{
			this._LoadVersion(function(){//patch检查
				var resMgr = hg.ResourceManager.getInstance();
				if (resMgr && resMgr.reloadConfig)
				{
					var tempHasPatchFile = self._hasPatchFile();

					if (!tempHasPatchFile)
					{
                		self._md5Loaded = true;
					}

					self.versionControl(cb);

                	return;
                }

                var tempHasPatchFile = self._hasPatchFile();
                self._md5Loaded = true;

				if(tempHasPatchFile){//有资源更新
                    console.log("has patch file to update");
                    self._md5Loaded = false;

                    var tempIsMD5FileLatest = self._isMD5InfoFileLatest();
                    console.log("tempIsMD5FileLatest: " + tempIsMD5FileLatest);
                    if(tempIsMD5FileLatest){//且md5文件是最新
                        console.log("md5 file is latest.");
                        self._md5Loaded = true;
                    }else{
                        console.log("md5 file is not latest.");
                    }
				}else{//无资源更新
                    console.log("no patch file to update");
				}
				
				self.versionControl(cb);
			});
			return;
		}

		//enable verify
		if (!this._enabledVerify)
		{
			this.performVerify();
			this._enabledVerify = true;
		}

        // 提审的backdoor设置md5时，才会强制更新md5文件；如果没有设置，则直接跳过
        if (cc.game.isReviewMode && !cc.game.reviewMd5)
        {
            this._md5Loaded = true;
        }

		if((!this._md5Loaded || this._forceUpdateMd5) && ed.compareAppVersion("1.23.01"))
		{
			this._loadMd5(function (argument) {

				var resMgr = hg.ResourceManager.getInstance();
				if (resMgr && resMgr.reloadConfig)
				{
					self.versionControl(cb)
					return;
				}

				self.saveMD5InfoFileVersion();
				ed.reloadGame();

			});
			return;
		}

		if (!this._md5Updated && !this._fileConfigLoaded)
		{
			this.performConfig();
			this._fileConfigLoaded = true;
		}

		//japan
		if (ed.isJapan())
		{
			if (!this._updateConfirmed)
			{
				this._updateCheckConfirmed(function (argument) {
					// body...
					self.versionControl(cb);
				});
				return;
			}
		}

        // 提审模式的backdoor设置md5时，需要重新下载csb，否则可能报错
        if (cc.game.isReviewMode && cc.game.reviewMd5 && !this.csbReviewUpdated)
        {
            this.updateCsbReview(function () {
                self.versionControl(cb);
            });
            return;
        }

		if(!this._patchUpdated)
		{
			this._updatePatch(function()
			{
				self.versionControl(cb);
			});
			return ;
		}

		if(!this._downloadInitialized)
		{
			this.performDownload();
			this._downloadInitialized = true;
		}

		this.enableEDFcaEffectNewObj();
		cb && cb();
	},

	/**
	 * 尝试修复 EDFcaEffect 内存泄露，true 开启
	 * 只在灰度开启，可以 backdoor
	 */
	enableEDFcaEffectNewObj: function () {
		if (!cc.sys.jsb)
			return;

		cc.log("[EDFcaCache] SetEDFcaEffectNewObj true");
		dsBridge.call("callApp", {
			msg: "SetEDFcaEffectNewObj",
			enable: "true"
		});
	},

	_checkisWhiteMode:function() {
		var self = this;

		if(cc.game.cdnSubPath !== ""){
			cc.log("disable loading wl.code when subcdn exist");
			cc.game.whitelistOpened = true;

			var CONFIG_KEY = cc.game.CONFIG_KEY
			var config = cc.game.gameData;
			if (config)
			{
				cc.game.cdn = config[CONFIG_KEY.cdn];
				cc.game._main_cdn_ = cc.game.cdn;
			}

			this.setErrorEnabled(true);
			ed.openDebug = true;
			return false;
		}

		var whiteUser = cc.game.checkIsWhiteUser();
		cc.log("whiteUser:" + whiteUser);
		if(whiteUser) {
			return true;
		}

		var debug = dsBridge.call("callApp", {msg: "checkDebugSwitch"});
		cc.log("checkDebugSwitch:" + debug);
		if(debug == "Debuggable") {
			return true;
		}
		var ssid = dsBridge.call("callApp", {msg: "getWIFISSID"});
		cc.log("WIFISSID:" + ssid);
		if(cc.checkWIFIIsWS(ssid)) {
			return true;
		}
	},

	_checkLanguageResUpdate:function(callback){//检查多语言更新
		var self = this;
        console.log("_checkLanguageResUpdate!!");

		var projectJsonConfig = self.config;
		var CONFIG_KEY = cc.game.CONFIG_KEY;
		var langList = CONFIG_KEY.langList || [];
		var langMap = CONFIG_KEY.langMap || {};
        if(cc.sys.chn) {
            console.log("国服不切语言");
        	langMap.zh = "zh";
            self._languageResChecked = true;
            this.rememberUserLanguage(projectJsonConfig[CONFIG_KEY.sysLang]);
            if(callback){
                callback();
            }
            return;
        }
		if(projectJsonConfig[CONFIG_KEY.sysLang] === "kr" || projectJsonConfig[CONFIG_KEY.sysLang] === "jp" || projectJsonConfig[CONFIG_KEY.sysLang] === "vn") {
			console.log("韩服日服越南不切语言");
			self._languageResChecked = true;
			this.rememberUserLanguage(projectJsonConfig[CONFIG_KEY.sysLang]);
			if(callback){
				callback();
			}
			return;
		}

		var checkSupport = function(lang, list) {
			for(var i = 0; i < list.length; i++) {
				var code = list[i];
				if(code === lang) {
					return true;
				}
			}
			return false;
		};


		var inGameLanguageSwitchCode = window.localStorage.getItem("InGameLanguageSwitch");
		console.log("InGameLanguageSwitch："+inGameLanguageSwitchCode);
		cc.game.vercontrol_log = T("jsb_boot_0_153_0", "正在检查语言包({0}/{1})").format(1,inGameLanguageSwitchCode);

		if(inGameLanguageSwitchCode){
			self._languageResChecked = true;
			this._languageResList = ed.getLanguageResListByCode(inGameLanguageSwitchCode);
			this._targetLanguageCode = inGameLanguageSwitchCode;//目标语言code，下载完语言包后设置
			if(callback){
				callback();
			}
			return;
		}

		var value = window.localStorage.getItem("HgameSysLang");
		if(value && value !== "" && checkSupport(value, langList)) {//有玩家设置的语言，且支持
			console.log("HgameSysLang value:"+value);
			self._languageResChecked = true;
			var isFileExist = checkCSVTableExist(value);
			if(!isFileExist){
				console.log("本地"+ value + " jsc文件不存在，设置下载");
				this._languageResList = ed.getLanguageResListByCode(value);
				this._targetLanguageCode = value;//目标语言code，下载完语言包后设置
			}
			if(callback){
				callback();
			}
		}else{//玩家没有设置语言 或 不支持
			var lang = cc.sys.language;//手机语言
			console.log("local phone language lang:"+lang);
			if(lang && langMap[lang] && checkSupport(langMap[lang], langList)) {//是支持的手机语言
				if(langMap[lang] === projectJsonConfig[CONFIG_KEY.sysLang]){//是母包基础语言时，保持
					self._languageResChecked = true;
					this.rememberUserLanguage(langMap[lang]);
					if(callback){
						callback();
					}
				}else{//不是母包基础语言，将要下载的语言包合并到patch文件中去下载
					self._languageResChecked = true;
					this._languageResList = ed.getLanguageResListByCode(langMap[lang]);
					this._targetLanguageCode = langMap[lang];//目标语言code，下载完语言包后设置
					if(callback){
						callback();
					}
				}
			}else{//是不支持的手机语言，直接走默认语言
				self._languageResChecked = true;
				this.rememberUserLanguage(projectJsonConfig[CONFIG_KEY.sysLang]);
				if(callback){
					callback();
				}
			}
		}
	},

	checkVersion: function(version1,version2)
	{
		if(version1 === version2)
			return false;

		var r1 = /v(\d+\.\d+\.\d+\.\d+)/.exec(version1);
		var r2 = /v(\d+\.\d+\.\d+\.\d+)/.exec(version2);
		if (r1 == null || r2 == null)
		{
			cc.logBugly("checkVersion error,r1 or r2 is null;");
			return false;
		}

		var ver_array1 = r1[1].split('.');
		var ver_array2 = r2[1].split('.');

		if (ver_array1.length != ver_array2.length)
		{
			cc.logBugly("checkVersion error,ver_array1.length != ver_array2.length");
			return false;
		}

		for(var i = 0 ; i < ver_array1.length; i++)
		{
			var v1 = parseInt(ver_array1[i]);
			var v2 = parseInt(ver_array2[i]);
			if(v1 < v2)
				return true;
			if(v1 > v2)
				return false;
		}

		return false;
	},

	_LoadVersion: function(cb)
	{
		console.log("_LoadVersion !!! ");
		cc.game.vercontrol_log = T("jsb_boot_2_746_0", "正在检查版本号");

		var getMilestoneStr =  function(version){
			var r = /v(\d+\.\d+\.\d+\.\d+)/.exec(version);
			var ver_array = r[1].split('.')
			var ret = "1.0";
			if (ver_array.length > 0){
				ret = ver_array[0] + "." + ver_array[1]
			}
			return ret
		};

		var self = this;
		var latest_version = cc.game.config.latestVersion;//cdn上project.json的最新版本号

		var nappver =  "v"+ed.getAppVersion()+".00000";//v1.25.08.00000
		var lappver = "v"+ (window.localStorage.getItem("binaryAppVersion") || "") + ".00000";//v.00000

		console.log("nappver: " + nappver);
        console.log("lappver: " + lappver);

		var curt_version = window.localStorage.getItem("_versionCurrent");
		if(ed.isGray()){
			if((!curt_version) || curt_version === "") {
				curt_version = cc.game.base_version;
			}
		}
		else{
			console.log("curt_version: " + curt_version);
			if(ed.compareBaseVersion(lappver,nappver)){
				curt_version = "";
			}

			console.log("curt_version: " + curt_version);
			console.log("cc.game.base_version: " + cc.game.base_version);
			if(ed.compareBaseVersion(curt_version,cc.game.base_version ))//本地存的版本是否小于等于project.json里的latestversion
			{
				curt_version = cc.game.base_version;
			}
		}



		this._versionMilestone = getMilestoneStr(latest_version);

		this.currentVersion = curt_version;

		cc.reportAppEvent("game_version_control_compare_finished");
        console.log("curt_version: " + curt_version);
        console.log("latest_version: " + latest_version);
		if (this.checkVersion(curt_version,latest_version))//当前版本和服务器最新版比较
		{
			cc.reportAppEvent("game_update_patch");
			var patch_file = curt_version  + "-" + latest_version  + ".patch";
            cc.game.patch_file = patch_file;

			cc.game.vercontrol_log = T("jsb_boot_3_369_0", "正在下载更新包({0}.{1}.{2})").format(this.getCurrCDNIndex(),cc.game.retryCnt+1,curt_version);
			cc.game.update_progress = (this.retryCnt / cc.game.retryTotal );

			var preffix = cc.supportPatchPreffix() ? cc.game.patch_preffix : cc.game.patch;
			patch_file = cc.getGameCdn() + preffix + "/" + patch_file;

			console.log("cc.game.patch_file:" + patch_file);
			console.log(cc.game.cdn);

			this._sendHttpRequest(patch_file, function (err, txt) {
				if(err) {
					console.log("----------> load " + err + "\t url：" + patch_file);

					cc.game.changeCurrCDN(3,cb);
				}
				else {

					//verify
					if (cc.supportMD5Verify())
					{
						cc.log(">>>>>>>>>>>>>>>>version verify");
						var bConsistent = cc.game.checkMD5(txt);
						if (!bConsistent)
						{
							if (self.retryVerify++ >=  cc.game.retryTimes)
							{
                            	ed && ed.netErrorDialog(3);
							}
							else
							{
								cc.logBugly("version verify failed");
								cb && cb();
							}

							return;
						}
					}

					console.log("------------>>>>version patch loaded");
					cc.game.vercontrol_log = T("jsb_boot_8_1095096220_0","下载更新包成功。");

					self.retryCnt = 0;
					self.retryVerify = 0;
					self._versionLoaded = true;

					var data = txt;
					if (cc.supportEncrypt()){
						data = jsb.inflate(txt);
					}

					data = JSON.parse(data);

					self.update_patch_file = data;

					cc.reportAppEvent("game_request_patch_succeed");

					self.revertGameCDN();

					cb && cb();
				}
			}, 120000);
		}
		else
		{
			cc.reportAppEvent("game_non_update_patch");

			console.log("current is latestVsersion !!! " );
			this._versionLoaded = true;
			cb && cb();
		}
	},

    _isMD5InfoFileLatest:function(){
		var isLatest = true;
		var localMD5Version = this.getMD5InfoFileVersion();
		console.log("localMD5Version: " + localMD5Version);
        console.log("cc.game.config.latestVersion: " + cc.game.config.latestVersion);
		if(ed.compareBaseVersion(localMD5Version, cc.game.config.latestVersion)){//v1 < v2 true. v1 >= v2 false.
            isLatest = false;
		}

		console.log("_isMD5InfoFileLatest: " + isLatest);
		return isLatest;
    },

    _hasPatchFile:function(){
        var files = this._getPatchFiles();
        return files.length > 0;
    },

    _getPatchFiles: function (argument) {
    	// body...
    	var patchFileList = [];

    	if(this.update_patch_file){
    	    var tempPatchFile = [];
    	    if(this.update_patch_file){
    	        for(var file in this.update_patch_file){
    	            tempPatchFile.push(file);
    	        }
    	        patchFileList = this.filterLoadRes(tempPatchFile, true);
    	        if(patchFileList.length <= 0){
    	            console.log("********No patch file after filter.********");
    	        }
    	    }
    	}

    	return patchFileList;
    },

	_getPatchFileList:function(){//patch list，过滤掉无关资源之后的最终列表
		var patchFileList = [];
        if(!this.update_patch_file && !this._languageResList){//不需要更新patch也不需要更新语言
        }else{
        	var tempPatchFile = [];
            if(this.update_patch_file){
                for(var file in this.update_patch_file){
                    tempPatchFile.push(file);
                }
            }
            if(this._languageResList){
                for(var i=0;i<this._languageResList.length;i++){
                    var tempFileName = this._languageResList[i];
                    if(this.update_patch_file){
                        var isInPatch = this.update_patch_file[tempFileName];
                        if(!isInPatch){
                            tempPatchFile.push(tempFileName);
                        }
                    }else{
                        tempPatchFile.push(tempFileName);
                    }
                }
			}

            patchFileList = this.filterLoadRes(tempPatchFile);
            if(patchFileList.length <= 0){
                console.log("all need file in backdown load !!! ");
			}
		}

		return patchFileList;
	},

	_updatePatch: function(cb)
	{
		console.log("_updatePatch !!! ");

        var preDownloadDoneVersion = window.localStorage.getItem("PreDownloadDoneVersion");
        var isPreDownloadDone = preDownloadDoneVersion ===  cc.game.config.latestVersion;
        if (isPreDownloadDone)
        {
            cc.game.vercontrol_log = T("jsb_boot_0_755_0", "正在校验更新文件");
        }
        else
        {
            cc.game.vercontrol_log = cc.game.patch_file || "";
        }

        var tempPatchFileList = this._getPatchFileList();
		if(tempPatchFileList.length <= 0){//不需要更新patch也不需要更新语言
			console.log("no need update return !!! ");
			this.rememberTheLastestVersion(cc.game.config.latestVersion);
			this._patchUpdated = true;
			cb && cb();
			return ;
		}

		var self = this;

		var len = tempPatchFileList.length;
		var cnt = 0;

		var patch_file_size_map = ed.getPatchFileSizeInfo();
		var totalSize = ed.getTotalSizeByList(tempPatchFileList, patch_file_size_map);
		var loaded_file = {};

		var downloadedSize = 0;
		cc.log("totalSize:"+totalSize+",len:"+len);
		self.failedDown = false;

		cc.reportAppEvent("game_update_patch_start");

		if(!ed.ingnoreProgress){
			hg.ResourceManager.getInstance().addProgressHandler(tempPatchFileList,function(url,size){
				loaded_file[url] = loaded_file[url] || 0;

                if (isPreDownloadDone)
                {
                    cc.game.vercontrol_log = T("jsb_boot_0_755_0", "正在校验更新文件");
                }
                else
                {
                    cc.game.vercontrol_log = (cc.game.patch_file || "") + ((size - loaded_file[url] > 200) ? "..." :"..") ;
                }
				downloadedSize -= loaded_file[url];
				downloadedSize += size;
				loaded_file[url] = size;

				var param = {
					maxSize: totalSize,
					downloadedSize:downloadedSize,
					fileName:url,
					isEnd:downloadedSize>=totalSize
				};
				self.update_progress = downloadedSize/totalSize;
				ed.fireEvent("PATCH_FILE_DOWNLOADED", param);
			});
		}

		for(var i = 0;i < tempPatchFileList.length;i++){
			cc.log("patch file to download: " + tempPatchFileList[i]);
		}

		this.startDownloadTime = new Date().getTime();
		this.usedDownloadTime = 0;

		cc.eventManager.addCustomListener(cc.game.EVENT_HIDE, function () {
			//监听设备切到后台事件，记录当前已用下载时间
			if(self.enabledBgDownload()) return; //设备开启了后台下载
			var appEnterBgTime = new Date().getTime();
			self.usedDownloadTime += (appEnterBgTime - self.startDownloadTime);
		});

		cc.eventManager.addCustomListener(cc.game.EVENT_SHOW, function () {
			//监听设备从后台切回前台事件，重置开始下载的时间
			if(self.enabledBgDownload()) return; //设备开启了后台下载
			self.startDownloadTime = new Date().getTime();
		});


		hg.ResourceManager.getInstance().loadResourceFile(tempPatchFileList,function(error,url,idx,isEnd){
			if(self.failedDown)
				return ;

			if(patch_file_size_map.hasOwnProperty(url)){
				var size = patch_file_size_map[url];
				if(size){
					downloadedSize -= loaded_file[url] || 0;
					downloadedSize += parseInt(size);
				}
			}

			if(error && (error != "")){
				url = url || "";
				console.log("loadResourceFile error !!! " + url);
				var dialog = ed.confirmDialog.create({
					okText: T("charge_mgr_8_1945829674_0","确认"),
					okCallback: function() {
						ed.playEffect("ClickBegin");
						ed.reloadGame();
					}
				});
				dialog.setLongListViewForLog();

                var svr_info = "device:{0}".format(ed.platformMgr.getDeviceId());
                svr_info += " ip:{0}".format(ed.platformMgr.getClientIP());
                svr_info += " times:{0}".format(ed.getServerTime());
                svr_info += " host:{0}".format(cc.getGameCdn());

				dialog.setString(T("jsb_boot_4_908239150_0","更新失败，请重试。\n") + url + "\n" + svr_info);
				dialog.getBgPanel().setTouchEnabled(false);
				dialog.getBgPanel().setSwallowTouches(false);
				dialog.show();
				self.failedDown = true;

				cc.reportAppEvent("game_update_patch_failed");

				//报错时上报cdn信息
				self.reportCDNDomainInfo(error);

				return ;
			}
			else if(ed.ingnoreProgress){
				if(patch_file_size_map.hasOwnProperty(url)){
					downloadedSize += patch_file_size_map[url];
				}else{
					downloadedSize += 200000;//200k
				}
				var param = {
					maxSize: totalSize,
					downloadedSize:downloadedSize,
					fileName:url,
					isEnd:isEnd
				};
				ed.fireEvent("PATCH_FILE_DOWNLOADED", param);
			}

			if(isEnd){
				cnt++;
				if(cnt == len){
					self.rememberPatchVersion(tempPatchFileList);
					self.rememberTheLastestVersion(cc.game.config.latestVersion);
					if(self._targetLanguageCode){
						self.rememberUserLanguage(self._targetLanguageCode);
					}
				}
				self._patchUpdated = true;

				cc.reportAppEvent("game_update_patch_succeed");

				cc.reportAppEvent("game_update_patch_restart");
				cc.game.vercontrol_log = T("jsb_boot_12_1304707736_0","下载完成。");

				self.endDownloadTime = new Date().getTime();
				self.usedDownloadTime += (self.endDownloadTime - self.startDownloadTime);
				self.downloadSpeed = (totalSize / 1024) / (self.usedDownloadTime / 1000);
				//下载完成时上报cdn信息
				self.reportCDNDomainInfo();

				self.removeSrcpack();

				ed && ed.reloadGame(0.2);
			}
			else{
				cnt++;
			}
		});
	},

	reportCDNDomainInfo: function(error){
		var domain_name = cc.getGameCdn();
		var ip_addr = ed.platformMgr.getClientIP() || " ";
		var regionName = ed.platformMgr.getRegionName() || " ";
		var hid = cc.getHGameLocalID() + "" || " ";
		if(error){
			ed.reportUserData("cdn_speed", [domain_name, ip_addr, " ", error, regionName, hid]);
		}
		else{
			var net_speed = Math.floor(this.downloadSpeed);
			ed.reportUserData("cdn_speed", [domain_name, ip_addr, net_speed, " ", regionName, hid]);
		}
	},

	enabledBgDownload: function(){
		var isIOS = (cc.sys.os === cc.sys.OS_IOS);//目前只有ios会开启后台下载

		var app = cc.Application.getInstance();
		var enabledBackGroundTask = app.isRunBackgroundTask(); //开启了后台任务功能

		var network = ed.getAppNetStatus();
		var isWifi = network && network.toLowerCase() !== "wifi"; //使用wifi才会后台下载

		var isValidRegion = ed.isKorea() || ed.isJapan() || ed.isTaiwan(); //只在日韩台生效

		return isIOS && enabledBackGroundTask && isWifi && isValidRegion;
	},

	filterPatchRes: function( list, bIgnoreSave )
	{
		var realList = [];

		if (!list)
			return realList;

		this.extraBackdownLoadList = [];
		this.hdBackdownloadList = [];

		//filter
		for (var i = 0; i < list.length; i++) {
			var url = list[i];

			if (cc.isHDResource(url, true))
			{
				this.hdBackdownloadList.push(url);
				continue;
			}

			if (url.endsWith(".ogg") || url.endsWith(".fsb"))
			{
				if(url.endsWith(".ogg")){
					if(ed.sound_manager.engineType === 4){

					}else{
						this.extraBackdownLoadList.push(url);
					}
				}
				if(url.endsWith(".fsb")){
					if(ed.sound_manager.engineType === 4){
						this.extraBackdownLoadList.push(url);
					}
				}
			}
			else
			{
				realList.push(url);
			}
		}


		if (!bIgnoreSave)
		{
			if (this.extraBackdownLoadList.length > 0)
			{
				cc.reportAppEvent("game_some_update_patch_resource_to_background_download");

				//backdownload
				this.saveExtraBackDownload();
			}

			if (this.hdBackdownloadList.length > 0)
			{
				cc.reportAppEvent("game_some_hd_update_patch_resource_to_background_download");

				//hd backdownload
				this.saveHDBackdownload();
			}
		}

		return realList;
	},

	filterLoadRes: function(list, bIgnoreSave)
	{
		cc.game.extRes = [];
		var filesExcludeOtherLanguage = this.filterCurrentLanguageRes(list);
		var filesExcludeOtherIMGType = ed.filterCurPlatformIMGResByFolder(filesExcludeOtherLanguage);
		var filesWithoutSound = this.filterPatchRes(filesExcludeOtherIMGType, bIgnoreSave);
		var finalResList = this.filterEncryptRes(filesWithoutSound);
        // 去掉预下载的文件
        finalResList = this.filterPreDownloadEnd(finalResList);

		return finalResList;
	},

	filterCurrentLanguageRes:function(list){//给一个列表，剔除不是当前语言的资源
		var curLanguageResCode = cc.game.sysLang;
		if(this._targetLanguageCode){
			console.log("filter patch file,find _targetLanguageCode："+this._targetLanguageCode);
			curLanguageResCode =this._targetLanguageCode;
		}else {
			console.log("filter patch file, no _targetLanguageCode");
		}
        var filesExcludeOtherLanguage = [];//不包含其他语言

		if(ed.compareAppVersion("1.23.01")){
			cc.log("more than 1.23");
            var baseLanguageResList = ed.getLanguageResByType("base");
            var curLanguageResList = ed.getLanguageResListByCode(curLanguageResCode);
            for(var i = 0; i < list.length; i++){//check base
                var fileInList = list[i];
                var isCurLanguageRes = true;//默认是当前语言的资源
                for(var j = 0; j < baseLanguageResList.length; j++){//判断是否语言资源
                    var tempFileStr = baseLanguageResList[j];
                    var isMatch = (fileInList === tempFileStr);
                    if(isMatch){//是一个语言资源
                    	var isInCurLanguageList = false;
                    	for(var k = 0; k < curLanguageResList.length;k++){
                    		var curFileStr = curLanguageResList[k];
                    		if(fileInList === curFileStr){
                                isInCurLanguageList = true;
                                break;
							}
						}
						if(!isInCurLanguageList){
                            isCurLanguageRes = false;
						}
                        break;
                    }else {

                    }
                }
                if(isCurLanguageRes){
                    filesExcludeOtherLanguage.push(fileInList);
                }
            }

            var fileExcludeMultilang = [];
            for(var i = 0;i < filesExcludeOtherLanguage.length;i++){
            	var fileInList = filesExcludeOtherLanguage[i];
            	if(fileInList.indexOf("resmultilang") !== -1){
            		var filePathArr = fileInList.split('/');
            		var resLanguage = filePathArr[1];
            		if(resLanguage === curLanguageResCode){
						var filePath = fileInList.replace("resmultilang/" + resLanguage, "res");
                        fileExcludeMultilang.push(filePath);
					}else{

					}
				}else{
                    fileExcludeMultilang.push(fileInList);
				}
			}
            filesExcludeOtherLanguage = [];
            for (var i = 0; i < fileExcludeMultilang.length; i++) {//去重
                if (filesExcludeOtherLanguage.indexOf(fileExcludeMultilang[i]) === -1) {
                    filesExcludeOtherLanguage.push(fileExcludeMultilang[i]);
                }
            }
		}else{//1.23.01以下，手动过滤。因为不会提前下载languageRes.json
            var filePathPrefixList = [
                "srcmodule/csvtable_",
                "res/ui/panel/battletext_",
                "res/ui/panel/language_",
                "res/ui/plist/battletext_",
                "res/ui/plist/language_",
                "res/font/hgame_font_"
            ];

            for(var i = 0; i < list.length; i++){
                var fileInList = list[i];
                var isCurLanguageRes = true;//默认是当前语言的资源
                for(var j = 0; j < filePathPrefixList.length; j++){//判断是否语言资源
                    var tempRegStr = filePathPrefixList[j];
                    var tempReg = new RegExp(tempRegStr);
                    var isMatch = tempReg.test(fileInList);
                    if(isMatch){//是一个语言资源
                        var curLanguageRegStr = tempRegStr + curLanguageResCode;
                        var curLanguageReg = new RegExp(curLanguageRegStr);
                        var isCurLanguageMatch = curLanguageReg.test(fileInList);
                        if(isCurLanguageMatch){
                        }else{
                            isCurLanguageRes = false;
                            if(fileInList === "res/font/hgame_font_default.ttf"){
                                isCurLanguageRes = true;
							}
                        }
                        break;
                    }else {

                    }
                }
                if(isCurLanguageRes){
                    filesExcludeOtherLanguage.push(fileInList);
                }
            }
		}

		var tempFileList = ed.filterCurrentPlatformLanguageRes(filesExcludeOtherLanguage);//提取当前平台资源ios android
		tempFileList = this.filterCurrentHeroVoice(tempFileList);
		filesExcludeOtherLanguage = tempFileList;

		return filesExcludeOtherLanguage;
	},

	/**
	 * 过滤掉heroVoiceLang以外的voice文件
	 * @param {*} list 
	 */
	filterCurrentHeroVoice: function(list){
		var finalList = [];
		if(!list || list.length === 0) return finalList;

		var heroVoiceType = cc.game.heroVoiceLang;
		for(var i=0;i<list.length;i++){
			var filePath = list[i];
			if(filePath.indexOf("res/sound/heroes_voice_") !== -1){
				if(filePath.indexOf("res/sound/heroes_voice_"+heroVoiceType) !== -1){
					finalList.push(list[i]);
				}
			}else if(filePath.indexOf("res/sound/npc_voice_") !== -1){
				if(filePath.indexOf("res/sound/npc_voice_" + heroVoiceType) !== -1){
					finalList.push(list[i]);
				}
			}else{
				finalList.push(list[i]);
			}
		}

		return finalList;
	},

	filterEncryptRes:function(givenList){
		var regexList = [];

		if(cc.supportEncrypt()){
			regexList.push(/csproto\/.+?\.zip(?!.)/i);
			regexList.push(/.+?\.jsc(?!.)/i);
			regexList.push(/.+?\.jsonc(?!.)/i);
			regexList.push(/srcmodule\/.+?\.zip(?!.)/i);
		}else{
			regexList.push(/csproto\/.+?\.zipe(?!.)/i);
			regexList.push(/.+?\.jse(?!.)/i);
			regexList.push(/.+?\.jsone(?!.)/i);
			regexList.push(/srcmodule\/.+?\.zipe(?!.)/i);
		}

		var tempFileList = [];
		for(var i = 0;i < givenList.length;i++){
			var fileInList = givenList[i];
			var isCurBinaryRes = true;
			for(var j = 0;j < regexList.length;j++){
				var tempReg = regexList[j];
				var isMatch = tempReg.test(fileInList);
				if(isMatch){
					isCurBinaryRes = false;
					continue;
				}else {

				}
			}
			if(isCurBinaryRes){
				tempFileList.push(fileInList);
			}
		}

		return tempFileList;
	},

	getMD5InfoFileVersion:function(){
        var tempVersion = window.localStorage.getItem("MD5FileVersion");
        if(!tempVersion){
            tempVersion = "afkarena_v0.0.00.00000";
		}
		return tempVersion;
	},

	saveMD5InfoFileVersion:function(){
        var latestVersion = cc.game.config.latestVersion;//afkarena_v1.26.01.67261
		console.log("MD5FileVersion save to: " + latestVersion);
        window.localStorage.setItem("MD5FileVersion", latestVersion);
	},

	rememberPatchVersion: function(fileList){
		if(!fileList)
			return;
		var key = "patchVersion";
		var jbno = cc.game.config.jenkinsBuildNo;
		var patchVer = window.localStorage.getItem(key);
		var pvjs = patchVer ? JSON.parse(patchVer) :{};
		var idx = 0;
		while(idx <fileList.length){
			var v = fileList[idx++];
			if(v.match("jsc$")){
				v = v.replace(/jsc$/,"js");
			}
			if(v.match(/srcmodule\/.+zip$/)){
				v = v.replace(/zip$/,"js");
				pvjs[v] = jbno;
			}
		}
		window.localStorage.setItem(key,JSON.stringify(pvjs));
	},

	rememberTheLastestVersion: function(version)
	{
		var lger= ed.compareBaseVersion(version,cc.game.currentVersion );
		if(lger)
			version = cc.game.currentVersion;
		window.localStorage.setItem("_versionCurrent", version);
		var appver = ed.getAppVersion();
		window.localStorage.setItem("binaryAppVersion",appver);
	},

	rememberUserLanguage:function(code){
		window.localStorage.setItem("HgameSysLang", code);
		window.localStorage.removeItem("InGameLanguageSwitch");//设置玩家语言，清除游戏内切换语言的languageCode标志位
	},

	_LoadWhiteUser: function (cb) {
		var self = this;

		var plat = cc.game.region;
		var ver = cc.game.version;
		var subCdnPath = ""
		if (cc.game.cdnSubPath !== ""){
			subCdnPath = cc.game.cdnSubPath + "/"
		}

		var suffix = "wl.code";
		if (cc.supportEncrypt())
			suffix = "wl.jse";

		var url = "http://hgame-update.lilithgame.com:8080/hdgame/" + subCdnPath + plat + "/" + ver + "/"+ suffix;//这是47.101.43.84，白名单模式下才能访问

		cc.log("----------> start load " + url);
		this._sendHttpRequest(url, function (err, txt) {
			if(err) {
				cc.log("request error: " + url + ", status: " + err.status + ", tag: " + err.tag + ", errorBuffer: " + err.errorBuffer);
				cb && cb(err);
			}
			else {
				//verify
				if (cc.supportMD5Verify())
				{
					cc.log(">>>>>>>>>>>>>>>>wl.code verify");
					var bConsistent = cc.game.checkMD5(txt);
					if (!bConsistent)
					{
						cc.log("wl.code verify failed");
						cb && cb(err);
						return;
					}
				}


				cc.log("------------>>>>wl.code loaded");
				self._whiteUserCodeLoaded = true;

				self.retryCnt = 0;
				self.retryVerify = 0;

				var data = txt;
				if (cc.supportEncrypt()){
					data = jsb.inflate(txt);
				}

				data = JSON.parse(data);

				if (data["wl_user"] == true) {
					self.whitelistOpened = true;
					self.setErrorEnabled(true);
					var wurl = data["url"];
					if(wurl)
					{
						cc.game.cdn = wurl;
						cc.game._main_cdn_ = cc.game.cdn;
						cc.game.cdn_settings = true;
					}
				}

				cb && cb(err);
			}
		}, 10000);
	},

	_LoadMysticalCode: function (cb) {
		var self = this;

		var suffix = "mystical.code";

		if (cc.supportEncrypt())
			suffix = "mystical.jse";

		var url = cc.getGameCdn(false) + suffix;


		cc.game.vercontrol_log = T("jsb_boot_7_377_0", "正在加载补丁文件({0}.{1})").format(this.getCurrCDNIndex() , cc.game.retryCnt+1);
		cc.game.update_progress = (this.retryCnt  /  cc.game.retryTotal );

		console.log("----------> start load " + url);
		this._sendHttpRequest(url, function (err, txt) {
			if(err) {
				console.log("----------> load " + err + "\t url：" + url);
				cc.game.changeCurrCDN(2,cb);
			}
			else {

				//verify
				if (cc.supportMD5Verify())
				{
					cc.log(">>>>>>>>>>>>>>>>mystical.code verify");
					var bConsistent = cc.game.checkMD5(txt);
					if (!bConsistent)
					{
						if (self.retryVerify++ >=  cc.game.retryTimes)
						{
                        	ed && ed.netErrorDialog(2);
						}
						else
						{
							var ret = cc.game.getMD5(txt);
							cc.logBugly("mystical.code verify failed. headerMd5:{0} dataMd5:{1}".format([ret.headerMd5, ret.dataMd5]));
							cb && cb();
						}

						return;
					}
				}

				cc.reportAppEvent("game_request_backdoor_succeed");

				self.retryCnt = 0;
				self.retryVerify = 0;
				self._mysticalCodeLoaded = true;
				console.log("------------>>>>mystical.code loaded");

				if (cc.supportEncrypt())
				{
					txt = jsb.inflate(txt);
				}

				new Function(txt)();

				self.revertGameCDN();

				cb && cb();

				//国服ios实名制模式开关
				if(cc.sys.chn && cc.sys.os === cc.sys.OS_IOS && ed.compareAppVersion("1.32.01")) {
					if(cc.game.isReviewMode == true) {
						ed.hplatform.instance.platformReviewLogin("YES");
					}
					else {
						ed.hplatform.instance.platformReviewLogin("NO");
					}
				}

				//backdoor version report
				cc.reportAppEvent("game_backdoor_version", ed.backDoorVersion);
			}
		}, 120000);
	},

	_checkGameResDir: function (cb) {
		var isNewReg = dsBridge.call("callApp", {msg: "isNewSeg"}) || "False"; // 是否为新注册玩家

		if (isNewReg === "True")
		{
			window.localStorage.setItem("SDK_IS_NEW_REG", "true", false, false);
		}

		if (!cc.sys.jsb) {
			cb();
			return;
		}
		var gameResDir = jsb.getGameResDir && jsb.getGameResDir();
		// windows jsb设置回hd
		if (cc.sys.platform !== cc.sys.WIN32 && gameResDir === "classic")
		{
			jsb.switchGameResDir && jsb.switchGameResDir("classic");
			ed.restartGame(0.2);
		}
		else
		{
			if (gameResDir !== "classic")
			{
				jsb.switchGameResDir && jsb.switchGameResDir("hd");
			}
			cb();
		}
	},

	_sendHttpRequest:function(url, callback, timeout) {
		var url = url;

		if (!cc.sys.supported_http_get_timestamp && !cc.sys.supported_http_get_timestamp2)
		{
			var timestamp = new Date().getTime();
			url = url + "?t=" + timestamp;
		}

		var request = new XMLHttpRequest();
		request.timeout = timeout || 10000;
		request.responseType = cc.supportEncrypt() ? "arraybuffer" : "text";

		request.open("GET", url, true);

		request.ontimeout = function(e) {

			if(!url.match("project.json")) {
				var error = "[_sendHttpRequest] request timeout: " + url;
				cc.logBugly(error);
			}
			cc.llhNetworkDiagnosis(url,true);
			callback("timeout", request);
		};

		request.onerror = function(e) {

			if(!url.match("project.json")) {
				var error = "[_sendHttpRequest] request error: " + url + ", status: " + e.status + ", tag: " + e.tag + ", errorBuffer: " + e.errorBuffer;
				cc.logBugly(error);
			}
			cc.llhNetworkDiagnosis(url,true);
			callback(e, request);
		};

		request.onreadystatechange = function() {

			if(request.readyState != 4) {
				callback("readyState error :" + request.readyState);
				return;
			}

			if(request.status === 200) {
				callback(null, request.response);
			} else {
				if(!url.match("project.json")) {
					var error = "[_sendHttpRequest] readyState error: " + url + ", statusCode = " + request.status;
					cc.logBugly(error);
				}
				callback("readyState error:" + request.status, request);
			}
		};

		request.send(null);
	},


	_loadCheckVersionMd5: function(cb){
		var self = this;
		var url = cc.getGameCdn() + cc.game.resDir + "/checkFile.md5";
		console.log("----------> start load _load checkFileMd5 " + url);
		this._sendHttpRequest(url, function (err, txt) {
			var data = null;
			if(err) {
				console.log("----------> load " + err.errorBuffer + "\t url：" + url);
				//0 means no response for various reasons, but not from server.
				//status code default is -1, means could not resolve the host or connect failed.
				//200<=status<300 means connect success or redirect. same as curl.perform.
				if(err.status === 0 || err.status === -1 || !(err.status>=200 && err.status<300)){
					cc.game.cdn = self.getNextCDNAddress();
					console.log("cdn url change to:"+cc.getGameCdn());
					self.setDownloadedVersionInfo();
				}
			}
			else {
				console.log("------------>>>>checkFile.md5 loaded");
				data = JSON.parse(txt);
			}
			cb && cb(data);
		}, 120000);
	},

	_loadConfig: function (cb) {
		// Load config
		// Already loaded
		var self = this;

		var suffix = cc.game.resDir + "/project.json";

		if (cc.supportEncrypt())
		{
			suffix = cc.game.resDir + "/project.jsone";
		}

		var url = cc.getGameCdn() + suffix;

		var status = "";
		var myDate = new Date();
		cc.game.startCDNTime = myDate.getTime();

		cc.game.vercontrol_log = T("jsb_boot_0_432385981_0","正在加载配置({0}.{1})").format(this.getCurrCDNIndex() ,cc.game.retryCnt+1);
		cc.game.update_progress = (this.retryCnt) /  (cc.game.retryTotal);

		console.log("----------> start load project config " + url);
		this._sendHttpRequest(url, function (err, txt) {
			if(err) {
				console.log("----------> load failed: " + err +  ", url：" + url);
				//0 means no response for various reasons, but not from server.
				//status code default is -1, means could not resolve the host or connect failed.
				//200<=status<300 means connect success or redirect. same as curl.perform.
				cc.game.changeCurrCDN(1,cb);
			}
			else {

				//verify
				if (cc.supportMD5Verify())
				{
					cc.log(">>>>>>>>>>>>>>>>project.json verify");
					var bConsistent = cc.game.checkMD5(txt);
					if (!bConsistent)
					{
						if (self.retryVerify++ >=  cc.game.retryTimes)
						{
                        	ed && ed.netErrorDialog(1);
						}
						else
						{
							var ret = cc.game.getMD5(txt);
							cc.logBugly("project.json verify failed. headerMd5:{0} dataMd5:{1}".format([ret.headerMd5, ret.dataMd5]));
							cb && cb();
						}

						return;
					}
				}

				status = "success";
				cc.reportCustomCDN(cc.getGameCdn(), status, cc.game.startCDNTime);

				cc.reportAppEvent("game_request_version_control_succeed");

				console.log("------------>>>>project.json loaded");

				var data = txt;
				if (cc.supportEncrypt()){
					data = jsb.inflate(txt);
				}

				data = JSON.parse(data);

				self._updateConfig(data);
				self._loadConfiged = true;
				self.retryCnt = 0;
				self.retryVerify = 0;
				self.revertGameCDN();
				cb && cb();
			}

		}, 10000);
	},

	_getChannelId: function(){
		//改天重构到协议定义里
		return ed.platformCfg.getChannelID();
	},

	_updateConfig: function (data) {
		if(data.limitBVersion){
			ed.channelLimiationBinaryVersion = data.limitBVersion
			console.log("current Rev, limit ver: ", ed.channelLimiationBinaryVersion[this._getChannelId() || "0"]["ver"])
		}
		else if (data.channelInfo){
			ed.channelLimiationBinaryVersion = data.channelInfo
		}

        cc.override_game_config(data);


        var isTestRevMode = dsBridge.call("callApp", {msg: "isTestRevMode"}) || "False";
        var isRunningAtM1Device = ed.platformMgr.isRunningAtM1Device() == "True"; //m1设备不进入审核模式
		if(!isRunningAtM1Device && isTestRevMode === "True"){
			cc.game.isReviewMode = true;
			var review_host = "ws://hgame-tva-rev.lilithgame.com:10000";
			var channelInfo = cc.inPackageLimitBVersion[this._getChannelId() || "0"]
			if (channelInfo){
				review_host = channelInfo["review"] || "ws://hgame-tva-rev.lilithgame.com:10000";
			}
			cc.game.review_host = review_host;
			cc.game.region = "rev_" + cc.game.region;
		}
		console.log("current Rev:", cc.game.isReviewMode, cc.game.region, cc.game.review_host, this._getChannelId());
		
		cc.game.config.latestVersion = data.latestVersion;
		cc.game.checkversionMd5 = cc.supportSplitFilesizeJson() ? data.checkversionSplitMd5 : data.checkversionMd5;

		this.setDownloadedVersionInfo();

		this.updateVersionMd5();
	},

	_initConfig: function (config) {
		var CONFIG_KEY = this.CONFIG_KEY;

		// Configs adjustment
		config[CONFIG_KEY.showFPS] = typeof config[CONFIG_KEY.showFPS] === 'undefined' ? true : config[CONFIG_KEY.showFPS];
		config[CONFIG_KEY.engineDir] = config[CONFIG_KEY.engineDir] || "frameworks/cocos2d-html5";
		if (config[CONFIG_KEY.debugMode] == null)
			config[CONFIG_KEY.debugMode] = 0;
		config[CONFIG_KEY.frameRate] = config[CONFIG_KEY.frameRate] || 60;
		if (config[CONFIG_KEY.renderMode] == null)
			config[CONFIG_KEY.renderMode] = 0;
		config[CONFIG_KEY.timeout] = config[CONFIG_KEY.timeout] || 10;

		this.config = config;

		_load(config);

		var displayStats = this.config[CONFIG_KEY.showFPS];

		var localStats = window.localStorage.getItem("displayStats");
		if (localStats)
			displayStats = true;

		cc.director.setDisplayStats(displayStats);

		cc.director.setAnimationInterval(1.0/this.config[CONFIG_KEY.frameRate]);
	},

	setDownloadedVersionInfo: function()
	{
		//setting cdn
		var resVersion = this.getResVersion();

		var cdn = cc.getGameCdn();

		cdn = cc.getStandardCDN(cdn);

		//check custom
		if (!cc.game.whitelistOpened)
		{
			var customCDN = window.localStorage.getItem("cdn_switch_value");
			if (customCDN)
			{
				if (customCDN.indexOf("/" + cc.game.version + "/") < 0)
				{
					window.localStorage.setItem("cdn_switch_value", "");

				}
				else
				{
					cdn = customCDN;
				}
			}
		}

		console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>change cdn: ", cdn);


		var info = {
			cdn: cdn,
			timeout: cc.game.timeout,
			resVersion: resVersion,
			patchsize: 2,
			silentsize: 3,
			retrytimes: cc.game.retryTimes,
		};

		var resMgr = hg.ResourceManager.getInstance();
		if (resMgr.setPatchModeParam)
		{
			var params = cc.game.patch_preffix + "/";
			resMgr.setPatchModeParam(params);
			resMgr.setPatchParamEnabled(true);
		}

		resMgr.setDownloadedVersionInfo(info);
	},

	getResVersion: function()
	{
		var latestVersion = cc.game.config.latestVersion;
		if (latestVersion)
		{
			var pos = latestVersion.lastIndexOf(".");
			if (pos >= 0)
			{
				return latestVersion.substr(pos + 1);
			}
		}

		return "000000";
	},

	saveHDBackdownload: function (argument) {
		// body...
		var resMgr = hg.ResourceManager.getInstance();

		//or higher
		if (!resMgr.addDownloadTask)
		{
			cc.log("the app version not matched");
			return;
		}

		var hdFile = "hdbackdownload.json";
		var extra = "extra";

		var fileContent = null;
		if (jsb.fileUtils.isFileExist(hdFile))
		{
			fileContent = require(hdFile)
		}

		var currList = {};
		var patch_file_size_map = ed && ed.getPatchFileSizeInfo() || {};

		var hdList = this.hdBackdownloadList || [];
		if (hdList && hdList.length > 0)
		{
			for (var i = 0; i < hdList.length; i++) {
				var url = hdList[i];

				if (!cc.isString(url))
					continue;

				var size = patch_file_size_map[url] || 200000;
				currList[url] = {
					path: url,
					size: size,
				};
			}
		}

		if (fileContent)
		{
			var preList = fileContent[extra];
			if (preList && preList.length > 0)
			{
				for (var i = 0; i < preList.length; i++) {
					var obj = preList[i];

					if (!obj.path || !obj.size)
						continue;

					if (!currList[obj.path])
					{
						currList[obj.path] = {
							path: obj.path,
							size: obj.size,
						};
					}
				}
			}
		}


		var finalList = [];
		for (var path in currList) {
			var obj = currList[path];
			finalList.push(obj);
		}

		if (finalList.length > 0)
		{
			var content = {
				extra: finalList,
			};

			var writablePath = jsb.fileUtils.getWritablePath();
			var appVersion = ed && ed.getAppVersion() || "";

			if (cc.sys.platform === cc.sys.WIN32)
			{
				appVersion = "windows";
			}

			var fullPath = writablePath + appVersion + "/extra/" + hdFile;

			var data = JSON.stringify(content);

			jsb.fileUtils.writeStringToFile(data, fullPath);
		}

		//push backdownload
		if (finalList.length > 0 && cc.enableHD && cc.isHDOpened())
		{
			console.log("hd resources addDownloadTask: ", finalList.length);
			resMgr.addDownloadTask(finalList);
		}
	},

	saveExtraBackDownload: function( )
	{

		var resMgr = hg.ResourceManager.getInstance();

		//or higher
		if (!resMgr.addDownloadTask)
		{
			cc.log("the app version not matched");
			return;
		}

		var extraFile = "extrabackdownload.json";
		var extra = "extra";

		var fileContent = null;
		if (jsb.fileUtils.isFileExist(extraFile))
		{
			fileContent = require(extraFile)
		}

		var currList = {};
		var patch_file_size_map = ed && ed.getPatchFileSizeInfo() || {};

		var extraList = this.extraBackdownLoadList || [];
		if (extraList && extraList.length > 0)
		{
			for (var i = 0; i < extraList.length; i++) {
				var url = extraList[i];

				if (!cc.isString(url))
					continue;

				var size = patch_file_size_map[url] || 200000;
				currList[url] = {
					path: url,
					size: size,
				};
			}
		}

		if (fileContent)
		{
			var preList = fileContent[extra];
			if (preList && preList.length > 0)
			{
				for (var i = 0; i < preList.length; i++) {
					var obj = preList[i];

					if (!obj.path || !obj.size)
						continue;

					if (!currList[obj.path])
					{
						currList[obj.path] = {
							path: obj.path,
							size: obj.size,
						};
					}
				}
			}
		}

		var finalList = [];
		for (var path in currList) {
			var obj = currList[path];
			finalList.push(obj);
		}

		if (finalList.length > 0)
		{
			var content = {
				extra: finalList,
			};

			var writablePath = jsb.fileUtils.getWritablePath();
			var appVersion = ed && ed.getAppVersion() || "";

			if (cc.sys.platform === cc.sys.WIN32)
			{
				appVersion = "windows";
			}

			var fullPath = writablePath + appVersion + "/extra/" + extraFile;

			var data = JSON.stringify(content);

			jsb.fileUtils.writeStringToFile(data, fullPath);
		}
	},

	changeCurrCDN: function ( step,cb ) {
		var error_info =[
			"",
			"game_request_project_failed",
			"game_request_backdoor_failed",
			"game_request_patch_failed",
			"game_request_md5file_failed"
		];

		if (cc.checkNetConnect()){
			// body...
			if (cc.game.whitelistOpened){
				cb&& cb();
				return true;
			}

			var MaxRetryCnt = 3;
			if(++this.retryCnt < MaxRetryCnt){
				cb&&cb();
				return true ;
			}

			if( cc.game.additionalCDNList.length <=0){
				ed && ed.netErrorDialog(step);
				cc.reportAppEvent(error_info[step]);
				return "error,cdn list is the last or emtpy!!!"
			}
			this.retryCnt = 0;

			var target = cc.game.additionalCDNList.shift();
			var keys = Object.keys(target);
			cc.game.cdn = keys[0];

			this.setDownloadedVersionInfo();
			cb&& cb();
		}
		else{
			//玩家手机没有网络
			ed && ed.netErrorDialog(7);
		}
	},

	revertGameCDN: function (argument) {
		// body...
	},

	getCurrCDNIndex: function ( type ) {
		return cc.game.retryTotal -  cc.game.additionalCDNList.length  + 1;
	},

	initlizeAppServer: function (argument) {
		// body...

		if (!hg.NetworkManager)
			return;

		//initialize
		var networkMgr = hg.NetworkManager.getInstance();
		networkMgr.setPingEnabled(false);
		
		networkMgr.setAutoSwitchThreshold(cc.game.serverThreshold || 15);
	},

	setAppServers: function () {
		// body...

		if (!hg.NetworkManager)
			return;

		//add server
		cc.game.addAppServer(cc.game.cdn, false);

		//extra

		var isWhite = cc.game.whitelistOpened;
		var isReviewMode = cc.game.isReviewMode;

		if (!isWhite)
		{
			var serverList = cc.game.additionalCDNList;
			for (var i = 0; i < serverList.length; i++) {
				var obj = serverList[i];
				for( var key in obj)
				{
					var isCritical = obj[key].critical;
					var server = key;
					cc.game.addAppServer(server, !isCritical);
				}
			}
		}
	},

	addAppServer: function ( cdn, isCritical) {
		// body...

		if (!cdn)
			return


		if (hg.NetworkManager)
		{
			var networkMgr = hg.NetworkManager.getInstance();

			var server = cdn + "/" + cc.game.region + "/" + cc.game.version + "/";
			if (cc.game.cdnSubPath !== "")
				server = cdn + "/" + cc.game.cdnSubPath + "/" + cc.game.region + "/" + cc.game.version + "/";

			server = cc.getStandardCDN(server);

			console.log(">>>>>>>>>>>>>>>>>>>>>>>>server: " + server);

			if (isCritical)
			{
				networkMgr.addOneSpecialServer(server);
			}
			else
			{
				networkMgr.addOneServer(server);
			}
		}
	},


	checkNetworkSetting: function (argument) {
		// body...
		cc.game.vercontrol_log = T("jsb_boot_18_611437596_0","正在检查网络环境。");
		if (!hg.NetworkManager)
			return;

		var isWhite = cc.game.whitelistOpened;
		var isReviewMode = cc.game.isReviewMode;

		var autoSwitch = false;

		if (!isWhite && !isReviewMode)
		{
			var isSetting = window.localStorage.getItem("cdn_switch_value");
			autoSwitch = isSetting ? false : true;
		}

		//add server
		cc.game.setAppServers();

		var networkMgr = hg.NetworkManager.getInstance();
		networkMgr.setAutoSwitchEnabled(autoSwitch);

		if (cc.game.NETWORK_PING_ENABLED)
		{
			networkMgr.forcePing();
		}
	},

	_loadMd5: function ( cb ) {
		// body...
		console.log("loading checkversion.zip");


		var str = T("jsb_boot_0_821458031_0","正在加载校验文件");
		str += "({0}.{1})".format([this.getCurrCDNIndex(), cc.game.retryCnt+1]);
		cc.game.vercontrol_log = str;

		var self = this;
		var loadFailed = false;

		var md5 = cc.getCheckversionZipName();

		var resMgr = hg.ResourceManager.getInstance();
		resMgr.loadResourceFile([md5],function(error,url,idx,isEnd){
			if(error){
				console.log("load checkversion.zip failed");

				cc.game.vercontrol_log = T("jsb_boot_8_547_0", "加载校验文件失败({0})").format([error]);

				loadFailed = true;

				cc.game.changeCurrCDN(4,cb);

				return ;
			}

			if(isEnd && !loadFailed){
				self._forceUpdateMd5 = false;
				self._md5Loaded = true;
				self.retryCnt = 0;
				self.retryVerify = 0;


				//reload
				if (resMgr.reloadConfig)
				{
					resMgr.reloadConfig();
				}

				self.updateVersionMd5();

				//update config
				self.performConfig();

				self._md5Updated = true;

				self.revertGameCDN();

				cb && cb();
			}
		});
	},

    // 提审模式的backdoor设置md5时，需要重新下载csb，否则可能报错
    updateCsbReview: function ( cb ) {
        if (!cc.game.isReviewMode)
            return;

        // body...
        console.log("loading updateCsbReview");

        var self = this;
        var loadFailed = false;
        var csbArr = ["res/csbPkg1.zip", "res/csbPkg2.zip", "res/csbPkg3.zip", "res/csbPkg4.zip", "res/csbPkg5.zip", "res/csbPkgOther.zip"];
        var resMgr = hg.ResourceManager.getInstance();
        resMgr.loadResourceFile(csbArr, function (error, url, idx, isEnd) {
            if (error)
            {
                loadFailed = true;

                cc.game.changeCurrCDN(4,cb);
                return;
            }

            if (isEnd && !loadFailed)
            {
                self.csbReviewUpdated = true;
                self.retryCnt = 0;
                self.retryVerify = 0;
                cb && cb();
            }
        });
    },

	performConfig: function (argument) {
		// body...

		//device image config
        // astc 默认开启，不再单独判断目录
        // cc.loadDeviceImageModules();

		//load allFileSize.json
		this.loadFileSizeConfig();







    },

	performVerify: function (argument) {
		// body...
		//enable verify
		if (cc.sys.supported_md5_verify)
		{
			var resMgr = hg.ResourceManager.getInstance();
			if (resMgr.setVerifyEnabled)
				resMgr.setVerifyEnabled(true);
		}
	},

	loadFileSizeConfig: function (argument) {
		// body...
		cc.game.fileConfig = {};

		if(cc.supportSplitFilesizeJson()){
			//load common
			var filename = "res/fileSizeCommon.json";
			var bufferContent = require(filename);
			cc.assert(bufferContent, "loadCommonFileSizeConfig failed");
			if (!bufferContent)
				return;

			cc.game.fileConfig = bufferContent;
			this.loadI18nFileSizeConfig(this._targetLanguageCode || cc.game.sysLang);
		}else{
			var fileName = "res/allFileSize.json";
			var bufferContent = require(fileName);
			cc.assert(bufferContent, "loadFileSizeConfig failed");

			if (!bufferContent)
				return;
			
			cc.game.fileConfig = bufferContent;
		}
	},

	loadI18nFileSizeConfig: function(lang){
		if(!cc.supportSplitFilesizeJson()) return;

		//load lang
		var filenameLang = "res/md5/fileSize_{0}.json".format(lang);
		cc.log("load splited filesize.json: " + filenameLang);
		var bufferContent = require(filenameLang);
		cc.assert(bufferContent, "load {0} failed".format(lang));
		if(!bufferContent) return;
		for(var key in bufferContent){
			cc.game.fileConfig[key] = bufferContent[key];
		}
		hg.ResourceManager.getInstance().loadI18nJson(lang);
	},

	repaireGame: function  (argument) {
		// body...
		if (!cc.sys.jsb)
			return;

		if (cc.sys.os === cc.sys.OS_IOS || cc.sys.os === cc.sys.OS_ANDROID){
			var repaired = window.localStorage.getItem("ios_repaire_game");
			if (repaired)
			{
				return;
			}

			var writePath = jsb.fileUtils.getWritablePath();
			var appVersion = ed && ed.getAppVersion() || "";
			var patch = writePath + "/" + appVersion + "/" + hg.patch + "/";

			if (jsb.fileUtils.removeDirectory)
			{
				jsb.fileUtils.removeDirectory(patch);
			}

			if (jsb.fileUtils.createDirectory)
			{
				jsb.fileUtils.createDirectory(patch);
			}

			//clear sqlite
			window.localStorage.setItem("_versionCurrent", "");
            window.localStorage.setItem("binaryAppVersion","");

			window.localStorage.setItem("ios_repaire_game", "true");

			ed && ed.reloadGame();
		}
	},

	performDownload: function (argument) {
		// body...

		if (!cc.supportDeviceImage())
			return;

		//back download init
		var resMgr = hg.ResourceManager.getInstance();
		if (resMgr.setDownloadManager)
		{
			resMgr.setDownloadManager();
		}
	},

	_updateCheckConfirmed: function ( cb ) {
		// body...
		var self = this;

		var patchList = this._getPatchFileList();
		var hasUpdate = patchList.length > 0;

		if (hasUpdate)
		{
			var patch_file_size_map = ed.getPatchFileSizeInfo();
			var totalSize = ed.getTotalSizeByList(patchList, patch_file_size_map);

			var size = "";
			var mb = 1000000;
			var kb = 1000;

			//MB
			if(totalSize > mb)
			{
			    size =  parseInt(totalSize*100/mb)/100 + "MB";
			}
			//KB
			else if(totalSize > kb)
			{
			    size =  parseInt(totalSize*100/kb)/100 + "KB";
			}
			//B
			else
			{
			    size =  parseInt(totalSize) + "B";
			}

			var text = "約{0}のダウンロードを行います。よろしいですか？";

			text = text.format([size]);

			var params = {
				title: "確認",
				text: text,
				okText:"はい",
				cancelText:"いいえ",
				modal: true,
				okCallback:function(){
					self._updateConfirmed = true;
					cb && cb();
				},
				cancelCallback:function(){
					self._updateConfirmed = true;
					ed && ed.quitGame();
				}
			};
            if(ed){
			var view = ed.confirmDialog.create(params);
			view.show();
            }
			return;
		}

		this._updateConfirmed = true;

		cb && cb();
	},

	checkMD5: function ( buffer ) {
		// body...

		 var bRet = true;

		if (!cc.supportMD5Verify() || !buffer)
			return bRet;

		var md5Data = jsb.inflateMD5(buffer);
		var headerMd5 = md5Data.header;
		var dataMd5 = md5Data.data;

		bRet = headerMd5 === dataMd5;

		return bRet;
	},

	getMD5: function ( buffer ) {
		var bRet = {headerMd5:"0", dataMd5:"0"};
		if (!cc.supportMD5Verify() || !buffer)
			return bRet;

		var md5Data = jsb.inflateMD5(buffer);
		bRet.headerMd5 = md5Data.header;
		bRet.dataMd5 = md5Data.data;
		return bRet;
	},

	updateVersionMd5: function (argument) {
		// body...
		if (cc.supportMD5Verify())
		{
			var md5 = cc.getCheckversionZipName();

			var resMgr = hg.ResourceManager.getInstance();
			resMgr.updateFileMD5(md5, cc.game.checkversionMd5);
		}
	},

	setForceUpdateMd5: function ( bForce ) {
		// body...
		this._forceUpdateMd5 = bForce;
	},

	setSkipSrcMode: function ( bSkipped ) {
		// body...
		this._skip_src_mode = bSkipped;
	},

	setErrorEnabled: function (enabled) {
		// body...
		var resMgr = hg.ResourceManager.getInstance();
		if (resMgr.setErrorEnabled)
			resMgr.setErrorEnabled(enabled || false);
	},


    /**************************************************
     * 预下载
     **************************************************/
    checkAndCreateDir: function (filePath) {
        var pos = filePath.lastIndexOf("/");
        if (pos === -1)
            return false;

        var path = filePath.substring(0, pos + 1);
        if (jsb.fileUtils.isDirectoryExist(path))
            return true;

        return jsb.fileUtils.createDirectory(path);
    },

    removeFileAndVersionFile: function (fileFullPath) {
        if (jsb.fileUtils.isFileExist(fileFullPath))
        {
            jsb.fileUtils.removeFile(fileFullPath);
        }

        var versionFile = fileFullPath + "." + this.getResVersion();
        if (jsb.fileUtils.isFileExist(versionFile))
        {
            jsb.fileUtils.removeFile(versionFile);
        }

        var versionTempFile = fileFullPath + "." + this.getResVersion() + ".hg-temp";
        if (jsb.fileUtils.isFileExist(versionTempFile))
        {
            jsb.fileUtils.removeFile(versionTempFile);
        }

        versionTempFile = fileFullPath + "." + this.getResVersion() + ".hg-unzipped";
        if (jsb.fileUtils.isFileExist(versionTempFile))
        {
            jsb.fileUtils.removeFile(versionTempFile);
        }
    },

    getNextResVersion: function(nextVersion)
    {
        if (nextVersion)
        {
            var pos = nextVersion.lastIndexOf(".");
            if (pos >= 0)
                return nextVersion.substring(pos);
        }
        return "000000";
    },

    /**
     * 是否支持预下载
     */
    checkSupportPreDownload: function () {
        //先全部屏蔽，由backdoor开启方便测试
        return false;

        /**
         * cc.game.supportPreDownload 只初始化一次，
         * 但可以通过 backdoor 强制设置
         */
        // if (cc.game.supportPreDownload == null)
        // {
        //     if (cc.game.isReviewMode) // 提审
        //     {
        //         cc.game.supportPreDownload = false;
        //     }
        //     else if (["gray", "Gray"].indexOf(cc.game.region) === -1) //只在灰度包开放
        //     {
        //         cc.game.supportPreDownload = false;
        //     }
        //     else if (!ed.compareAppVersion("1.115.01"))  // 115版本之前不支持
        //     {
        //         cc.game.supportPreDownload = false;
        //     }
        //     else
        //     {
        //         cc.game.supportPreDownload = true;
        //     }
        // }
        //
        // return cc.game.supportPreDownload;
    },

    /**
     * 获取下个版本的project文件
     */
    loadNextProject: function (callback) {
        var suffix = cc.game.resNextDir + "/project.json";
        if (cc.supportEncrypt())
            suffix = cc.game.resNextDir + "/project.jsone";

        var url = cc.getGameCdn() + suffix;

        var status = "";
        console.log("----------> PreLoadProjectState " + url);
        cc.game._sendHttpRequest(url, function (err, txt) {
            if(err)
            {
                console.log("----------> PreLoadProjectState failed: " + err +  ", url：" + url);
                //0 means no response for various reasons, but not from server.
                //status code default is -1, means could not resolve the host or connect failed.
                //200<=status<300 means connect success or redirect. same as curl.perform.
                if (txt && (txt.status != 200 || txt.status != 302))
                {
                    // 拉取cdn失败数据上报
                    status = "fail";

                    //report
                    //cc.reportCustomCDN(cc.getGameCdn(), status, (new Date()).getTime());
                }

                cc.reportAppEvent("game_request_version_control_failed");
            }
            else
            {
                //verify
                if (cc.supportMD5Verify())
                {
                    cc.log("----------> PreLoadProjectState project.json verify");
                    var bConsistent = cc.game.checkMD5(txt);
                    if (!bConsistent)
                    {
                        var ret = cc.game.getMD5(txt);
                        cc.logBugly("project.json verify failed. headerMd5:{0} dataMd5:{1}".format([ret.headerMd5, ret.dataMd5]));
                        return;
                    }
                }

                status = "success";
                //cc.reportAppEvent("game_request_version_control_succeed");
                console.log("----------> PreLoadProjectState project.json loaded");

                var data = txt;
                if (cc.supportEncrypt())
                    data = jsb.inflate(txt);

                data = JSON.parse(data);

                cc.game.config.nextVersion = data.latestVersion;
                console.log("----------> PreLoadProjectState nextVersion " + data.latestVersion);
                if (cc.game.config.nextVersion)
                {
					cc.game.config.nextLanguageResMd5 = data["languageResJsonMd5"];
					if (cc.supportEncrypt()){
						cc.game.config.nextLanguageResMd5 = data["languageResJsoneMd5"];
					}
                    this.checkNextVersion();
                }

                this.checkNextVersionRes = true;
                callback && callback();
            }
        }.bind(this), 10000);
    },

    removeNextDict: function () {
        // var suffix = "next/"; // + localNextVersion + "/";
        var dictName = jsb.fileUtils.getWritablePath() + "next/";
        if (jsb.fileUtils.isDirectoryExist(dictName))
        {
            jsb.fileUtils.removeDirectory(dictName);
            cc.log("remove localNextVersion done, " + dictName);
        }
    },

    checkNextVersion: function () {
        /**
         * 检查本地的 localNextVersion
         *      1、 localNextVersion 不存在
         *          localNextVersion不存在，则认为刚更新到支持预下载的版本 或者 本地资源目录已过时，则直接删除整个目录。（可能目录不存在）
         *      2、 localNextVersion < appLatestVersion
         *          如果 localNextVersion < appLatestVersion，则认为本地资源目录已过时，则直接删除整个目录（比如，预下载到一半，不再进入游戏，隔几个版本再登录）。
         *      3、 localNextVersion = appLatestVersion
         *          如果 localNextVersion = appLatestVersion，则认为预下载内容可以投入使用，将 next 目录的资源，移动到正常资源目录，同时MD5文件也要移动过去。
         *          文件移动到 patch 目录。移动文件时，不能异步处理。检查存储的目录，删除 timely 中对应的文件，清掉该文件的 fullpath 缓存。
         *          注意：只下载一半的资源，在正常下载流程中有可能是patch，也有可能在backdownload，不一定能断点续传，直接删了。PreDownload 用的是 hg-temp。
         *      4、 localNextVersion > appLatestVersion
         *          如果 localNextVersion > appLatestVersion，则说明需要检查预下载是否完成，如果未完成，需要记录下来。
         */
        var localNextVersion = window.localStorage.getItem("LocalNextVersion");
        var appLatestVersion = cc.game.config.latestVersion;
        if (!localNextVersion || ed.compareBaseVersion(localNextVersion, appLatestVersion))
        {
            // 不存在localNextVersion 或者 localNextVersion 已过时，直接删除 next 目录
            this.removeNextDict();
            this.localNextVersion = undefined;
        }
        else if (localNextVersion === appLatestVersion)
        {
            // localNextVersion 可用，直接替换到正式资源目录
            // 移动文件时，不能异步处理
            this.localNextVersion = undefined;
            var fileList = [];
            var suffix = "next/"; // + localNextVersion + "/";
            var writePath = jsb.fileUtils.getWritablePath();
            var dictName = writePath + suffix;

            if (!jsb.fileUtils.isDirectoryExist(dictName))
                return;

            // 存在next目录时，需要复制
            var appVersion = ed.getAppVersion(); // file目录里的版本号
            var patchPath = writePath + appVersion + "/patch/";
            var timelyPath = writePath + appVersion + "/timely/";
            var md5Path = writePath + appVersion + "/ResFileMd5/";
            var versionSuffix = this.getNextResVersion(appLatestVersion);

            this.nextCopyFileMap = {};
            jsb.fileUtils.listFilesRecursively(dictName, fileList);
            var resMgr = hg.ResourceManager.getInstance();
            var removeCount = 0;
            for (var i = 0; i < fileList.length; i++)
            {
                var fileName = fileList[i];
                if (fileName[fileName.length-1] !== "/" && fileName.lastIndexOf(".hg-temp") === -1)
                {
                    ++removeCount;

                    // 复制到正式资源目录，复制到 patch；如果 timely 中存在，则删除之
                    var curPatchFileName = fileName.replace(suffix, appVersion + "/patch/");
                    var curTimelyFileName = fileName.replace(suffix, appVersion + "/timely/");

                    this.removeFileAndVersionFile(curPatchFileName);
                    this.removeFileAndVersionFile(curTimelyFileName);

                    var resPos = fileName.indexOf("/res/");
                    var isRealFile = fileName.indexOf(versionSuffix) === -1; //版本号文件不检查散文件
                    if (resPos !== -1 && isRealFile)
                    {
                        // 删除解压后的散文件
                        var resFileName = fileName.substring(resPos+1);
                        var compressedFileArr = [];
                        resMgr.getCurrentFiles(resFileName, compressedFileArr);

                        for (var j = 0; j < compressedFileArr.length; j++)
                        {
                            var compFile = compressedFileArr[j];
                            var curPatchCompFileName = patchPath + compFile;
                            var curTimelyCompFileName = timelyPath + compFile;
                            if (jsb.fileUtils.isFileExist(curPatchCompFileName))
                            {
                                jsb.fileUtils.removeFile(curPatchCompFileName);
                                cc.log("remove compressedFileArr, " + curPatchCompFileName + ", include in " + curTimelyFileName);
                            }

                            if (jsb.fileUtils.isFileExist(curTimelyCompFileName))
                            {
                                jsb.fileUtils.removeFile(curTimelyCompFileName);
                                cc.log("remove compressedFileArr, " + curTimelyCompFileName + ", include in " + curTimelyFileName);
                            }
                        }

                        // 删除md5文件
                        var md5File = md5Path + resFileName + ".md5";
                        if (jsb.fileUtils.isFileExist(md5File))
                        {
                            jsb.fileUtils.removeFile(md5File);
                            cc.log("remove md5File done, " + md5File);
                        }

                        // 记录下载完成的文件
                        this.nextCopyFileMap[resFileName] = true;
                    }

                    // 创建目录，移动文件，patch
                    var result = this.checkAndCreateDir(curPatchFileName);
                    if (!result)
                        cc.log("checkAndCreateDir error, " + curPatchFileName);

                    jsb.fileUtils.renameFile(fileName, curPatchFileName);
                    //jsb.fileUtils.renameFile(fileName + versionSuffix, curPatchFileName + versionSuffix);
                    cc.log("move file, from " + fileName, ", to " + curPatchFileName);
                }
            }
            cc.log("copy localNextVersion done, " + dictName);

            // 复制完成后删除 next
            jsb.fileUtils.removeDirectory(dictName);
            window.localStorage.setItem("LocalNextVersion", "");
            cc.log("remove localNextVersion done, " + dictName);
            localNextVersion = undefined;

            // 由于这里删除了大量文件，需要强制清除一下路径缓存和文件MD5缓存
            if (removeCount)
            {
                jsb.fileUtils.purgeCachedEntries();
                resMgr.clearMd5Cache();
            }
        }
        else
        {
            // localNextVersion 有效，无法确定下载是否完成，需要后面检查下载
            // 需要比较 cdn 的 nextVersion
            this.localNextVersion = localNextVersion;
        }

        // 检查是否需要执行预下载
        /**
         * 检查 localNextVersion 和 cdnNextVersion ，触发下一次的预下载。
         *      localNextVersion 和 cdnNextVersion 都存在
         *          localNextVersion > cdnNextVersion 应该不可能
         *          localNextVersion = cdnNextVersion 常见，如果预下载没有完成，则继续执行；如果已结束，进入正常更新流程。
         *          localNextVersion < cdnNextVersion 预下载到一半，不再进入游戏，隔几个版本再登录。直接删除之前的资源，进入以 cdnNextVersion 为目标的预下载。
         *      不存在 localNextVersion，但存在 cdnNextVersion，常见，说明需要预下载
         *      存在 localNextVersion，但不存在 cdnNextVersion， 先啥也不干吧 //无法确定下载是否完成，需要检查预下载
         *      都不存在，啥也不干
         */
        var cdnNextVersion = cc.game.config.nextVersion;
        if (localNextVersion && cdnNextVersion)
        {
            if (ed.compareBaseVersion(localNextVersion, cdnNextVersion))
            {
                this.removeNextDict();
                this.localNextVersion = cdnNextVersion;
            }
            else if (localNextVersion === cdnNextVersion)
            {
                // 如果预下载没有完成，则继续执行；如果已结束，进入正常更新流程。
                this.localNextVersion = localNextVersion;
            }
            else
            {
                this.localNextVersion = undefined;
                cc.error("localNextVersion = " + localNextVersion + ", cdnNextVersion = " + cdnNextVersion);
            }
        }
        else
        {
            if (cdnNextVersion)
            {
                this.removeNextDict();

                // 为了防止意外，需要校验 cdn B 上的 nextVersion，是否比当前资源版本号大。
                if (ed.compareBaseVersion(appLatestVersion, cdnNextVersion))
                {
                    this.localNextVersion = cdnNextVersion;
                }
                else
                {
                    this.localNextVersion = undefined;
                }
            }
            else if (localNextVersion)
            {
                // 如果预下载没有完成，则继续执行；如果已结束，进入正常更新流程。
                this.localNextVersion = localNextVersion;
            }
            else
            {
                this.localNextVersion = undefined;
                cc.log("localNextVersion = " + localNextVersion + ", cdnNextVersion = " + cdnNextVersion);
            }
        }

        if (!this.localNextVersion)
            return;

        // 如果当前版本大于预下载版本，不需要执行预下载
        var curVersion = cc.game.base_version;
        if (!ed.compareBaseVersion(curVersion, this.localNextVersion))
        {
            console.log("loadNextVersionPatch: no patch, curVersion = " + curVersion + ", localNextVersion = " + this.localNextVersion);
            return;
        }

        // 下载语言包
        this.loadNextLangRes();
    },

    // addPreDownloadList: function () {
    //     /**
    //      * 预下载时机尝试 - 2，还没最终确定，放这里看看
    //      * 都结束时尝试唤起预下载
    //      */
    //     var resMgr = hg.ResourceManager.getInstance();
    //     if (resMgr.isAllFinished && resMgr.isAllFinished())
    //     {
    //         if (!this.localNextVersion)
    //             return;
    //
    //         this.loadNextSplitRes();
    //     }
    // },

    loadNextLangRes: function () {
		var md5 = cc.game.config.nextLanguageResMd5 || "";
		console.log("------------> loadNextLangResMd5:" + md5);
		if(md5.length > 5){
			md5 = md5.substring(0,5);
		}else{
			console.error("!!!! cc.game.config.nextLanguageResMd5 is wrong !!!!");
		}
        var suffix = cc.game.resNextDir + "/res/languageRes" + md5 + ".json";
        if (cc.supportEncrypt())
            suffix = cc.game.resNextDir + "/res/languageRes" + md5 + ".jsone";

        var url = cc.getGameCdn() + suffix;

        var status = "";
        console.log("----------> loadNextLangRes " + url);
        cc.game._sendHttpRequest(url, function (err, txt) {
            if(err)
            {
                console.log("----------> PreLoadProjectState failed: " + err +  ", url：" + url);
                //0 means no response for various reasons, but not from server.
                //status code default is -1, means could not resolve the host or connect failed.
                //200<=status<300 means connect success or redirect. same as curl.perform.
                if (txt && (txt.status != 200 || txt.status != 302))
                {
                    // 拉取cdn失败数据上报
                    status = "fail";

                    //report
                    //cc.reportCustomCDN(cc.getGameCdn(), status, (new Date()).getTime());
                }

                cc.reportAppEvent("game_request_version_control_failed");
            }
            else
            {
                //verify
                if (cc.supportMD5Verify())
                {
                    cc.log("----------> PreLoadProjectState project.json verify");
                    var bConsistent = cc.game.checkMD5(txt);
                    if (!bConsistent)
                    {
                        var ret = cc.game.getMD5(txt);
                        cc.logBugly("project.json verify failed. headerMd5:{0} dataMd5:{1}".format([ret.headerMd5, ret.dataMd5]));
                        return;
                    }
                }

                status = "success";
                //cc.reportAppEvent("game_request_version_control_succeed");
                console.log("----------> PreLoadProjectState languageRes.json loaded");

                var data = txt;
                if (cc.supportEncrypt())
                    data = jsb.inflate(txt);

                data = JSON.parse(data);

                var langAuxMap = {};
                for (var key in data)
                {
                    var extraData = data[key]["extra"];
                    if (extraData)
                        langAuxMap[key] = extraData;
                }

                hg.ResourceManager.getInstance().addLangConfigForPre(langAuxMap);

                // 下载patch
                this.loadNextVersionPatch();
            }
        }.bind(this), 10000);
    },

    performedDeviceImageForPre: function (url) {
        if (!url)
            return url;

        if (this.isDeviceImageForPre(url))
        {
            if (cc.isPngOrJpgType(url))
            {
                url = cc.path.changeExtname(url, cc.deviceImageExt())
            }
        }
        return url;
    },

    isDeviceImageForPre: function (url) {
        return cc.isSupportAstc();
    },

    // 过滤没有预下载的文件
    filterPreDownloadEnd: function (givenList) {
        if (!this.nextCopyFileMap)
            return givenList;

        var tempFileList = [];
        var searchMap = this.nextCopyFileMap;
        for (var i = 0; i < givenList.length; i++)
        {
            var fileName = givenList[i];
            if (searchMap[fileName] || searchMap[cc.performedDeviceImage(fileName)])
                continue;

            tempFileList.push(fileName);
        }

        return tempFileList;
    },

    /**
     * 这些资源下载时机在 PreDownload 之前，不能随便下载
     */
    isStartResource: function (fileName) {
        if (!this.startResourceArr)
        {
            this.startResourceArr = [
                "res/resource.json",
                "res/module.json",
                "res/effect.json",
                "res/panel.json",
                "res/hero.json",
                "res/spine.json",
                "res/particle.json",

                // "srcmodule/csvtable_",
                // "res/ui/panel/battletext_",
                // "res/ui/panel/language_",
                // "res/ui/plist/battletext_",
                // "res/ui/plist/language_",
                // "res/font/hgame_font_",
            ];

            if (cc.game.res_publish)
            {
                this.startResourceArr.push("res/csbPkg1.zip");
                this.startResourceArr.push("res/csbPkg2.zip");
                this.startResourceArr.push("res/csbPkg3.zip");
                this.startResourceArr.push("res/csbPkg4.zip");
                this.startResourceArr.push("res/csbPkg5.zip");
                this.startResourceArr.push("res/csbPkgOther.zip");
            }
        }

        var arr = this.startResourceArr || [];
        for (var i = 0; i < arr.length; i++)
        {
            if (fileName.indexOf(arr[i]) !== -1)
                return true;
        }

        return false;
    },

    /**
     * 获取下个版本的patch文件
     */
    loadNextVersionPatch: function () {
        if (!this.localNextVersion)
            return;

        var curVersion = cc.game.base_version;
        var patchFile = curVersion  + "-" + this.localNextVersion + ".patch";
        var prefix = cc.supportPatchPreffix() ? cc.game.patch_preffix : cc.game.patch;
        patchFile = cc.getGameCdn() + prefix +"/" + patchFile;
        console.log("loadNextVersionPatch: " + patchFile);
        this._sendHttpRequest(patchFile, function (err, txt) {
            if (err)
                return;

            console.log("------------>>>> loadNextVersionPatch patch loaded");
            var patchData = txt;
            if (cc.supportEncrypt())
                patchData = jsb.inflate(txt);

            var patchDataMap = JSON.parse(patchData);
            var patchList = [];
            var patchPrefixMap = {};
            for(var file in patchDataMap)
            {
                // srcmodule 暂时不加入
                if (file.indexOf("srcmodule/") !== -1)
                    continue;

                // var fileCfg = patchDataMap[file];
                // ！！！有些资源下载时机在 PreDownload 之前，比如 csbPkg，所以不能随便下载
                if (!this.isStartResource(file))
                {
                    patchList.push(file);
                }

                /**
                 * 下载设计这么奇怪，净整些离谱的问题
                 * 这里必须提前转换成设备图，后台下载的时候是异步处理的，DOWNLOAD_ST的 url 已经是转换过的，无法再知道原始的文件名了，
                 * 如果这里不提前转换，会导致设备图搜不到 url
                 */
                var realFileName = this.performedDeviceImageForPre(file);
                patchPrefixMap[realFileName] = patchDataMap[file]["md5"];
            }

            if (patchList.length === 0)
                return;

            var filesExcludeOtherLanguage = this.filterCurrentLanguageRes(patchList);
            var filesExcludeOtherIMGType = ed.filterCurPlatformIMGResByFolder(filesExcludeOtherLanguage);
            var filesWithoutSound = this.filterPatchRes(filesExcludeOtherIMGType, true);
            var finalResList = this.filterEncryptRes(filesWithoutSound);
            // 筛选astc文件
            if (finalResList.length === 0)
                return;

            var resMgr = hg.ResourceManager.getInstance();
            if (!resMgr.addPreDownloadTask)
                return;

            //记录下版本待更新文件的md5
            resMgr.addPatchMD5InfoForPre(patchPrefixMap);

            // 添加预下载任务
            resMgr.registerPreDownloadScriptHandler(function (curr, total, currBytes, totalBytes) {
                var data = {
                    curr: curr,
                    total: total,
                    currBytes: currBytes,
                    totalBytes: totalBytes
                }
                ed.fireEvent("PRE_DOWNLOAD_EVENT", data);

                if (curr >= total)
                {
                    window.localStorage.setItem("PreDownloadDoneVersion", cc.game.localNextVersion);
                }
            });

            var prefix = cc.supportPatchPreffix() ? cc.game.patch_preffix : cc.game.patch;
            var tempPos = this.localNextVersion.lastIndexOf('.');
            //prefix += "/" + curVersion.substring(10)  + "-" + this.localNextVersion.substring(10) + "/";
            resMgr.setPreDownloadPrefix(prefix);
            resMgr.setPreDownloadSuffix(this.localNextVersion.substring(tempPos));
            var finalPathArr = [];
            var nextCopyFileMap = this.nextCopyFileMap;
            for(var i = 0; i < finalResList.length; ++i)
            {
                var fileName = finalResList[i];
                // 是否已经下载过，大部分文件应该不需要设备图转换
                if (nextCopyFileMap)
                {
                    if (nextCopyFileMap[fileName] || nextCopyFileMap[this.performedDeviceImageForPre(fileName)])
                        continue;
                }

                var fileCfg = patchDataMap[fileName];
                if (fileCfg)
                {
                    finalPathArr.push({
                        path: fileName,
                        size: fileCfg.size
                    });
                }
                else
                {
                    if (!fileCfg)
                    {
                        cc.log("!!!! cannot find " + fileName);
                    }
                }
            }

            window.localStorage.setItem("LocalNextVersion", this.localNextVersion);
            resMgr.pausePreDownload();
            resMgr.addPreDownloadTask(finalPathArr);
        }.bind(this), 120000);
    },
};


function _load(config) {
	var self = this;
	var CONFIG_KEY = cc.game.CONFIG_KEY, engineDir = config[CONFIG_KEY.engineDir], loader = cc.loader;

	// 发布版本全局变量
	cc.game.version = cc.sys.jsb2 ? "v2" : "v1";//config[CONFIG_KEY.version];
	cc.game.src_publish = config[CONFIG_KEY.src_publish];
	cc.game.res_publish = config[CONFIG_KEY.res_publish];
	cc.game.activityMode = config[CONFIG_KEY.activityMode];
	cc.game.enbaleDeviceImage = config[CONFIG_KEY.enbaleDeviceImage];
	cc.game.retryTimes = config[CONFIG_KEY.retryTimes];

    cc.game.region = config[CONFIG_KEY.region];

    cc.sys.chn = ("official" == cc.game.region || 
                "channel" == cc.game.region || 
                "chn" == cc.game.region);

	console.log("cc.sys.chn --------->>>: "+cc.sys.chn );
	
	cc.game.sysLang = _getSysLang(config);
	console.log("当前使用的语言："+cc.game.sysLang);


	cc.game.timeout = config[CONFIG_KEY.timeout];
	cc.game.serverThreshold = config[CONFIG_KEY.cdn_check_threshold];
	cc.game.cdnSubPath = config[CONFIG_KEY.cdnSubPath] || "";
	cc.game.config = config;

	cc.game.first_host = config.first_host;
	cc.game.second_host = config.second_host;
	cc.game.third_host = config.third_host;
	cc.game.opennetlog = window.localStorage.getItem("OPEN_NET_LOG");


	cc.game.bt_svr_ver = config.bt_svr_ver;

	//skip src mode
	if (!cc.game.cdn_settings)
	{
		cc.game.cdn = config[CONFIG_KEY.cdn];
		cc.game._main_cdn_ = cc.game.cdn;
	}

	if (config.cdn_list.length > 0){
		cc.game.additionalCDNList = config.cdn_list;
	}
	else{
		console.log("->>>>>>>>>>>>>>> additionalCDNList is empty! ");
	}

	cc.game.retryTotal = cc.game.additionalCDNList.length;

	cc.game.base_version = config.latestVersion;

	if(cc.game.src_publish===true){
		console.log("[SRC Mode]: publish");
	}else {
		console.log("[SRC Mode]: dev");
	}
	if(cc.game.res_publish===true){
		console.log("[RES Mode]: publish");
	}else {
		console.log("[RES Mode]: dev");
	}
	console.log("[Base Version]: "+ cc.game.base_version);
	console.log("[System language]: " + cc.game.sysLang);
	console.log("[CDN]: "+ cc.game.cdn);
	console.log("[CDN subpath]: " + cc.game.cdnSubPath);

	//load serverconfig
	if (config["channelInfo"]){
		cc.inPackageLimitBVersion = config["channelInfo"];
	}

	//add server
	cc.game.initlizeAppServer();
}

//+++++++++++++++++++++++++something about CCGame end+++++++++++++++++++++++++++++

// Original bind in Spidermonkey v33 will trigger object life cycle track issue in our memory model and cause crash
Function.prototype.bind = function (oThis) {
	if (!cc.isFunction(this)) {
		// closest thing possible to the ECMAScript 5
		// internal IsCallable function
		throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
	}

	var aArgs = Array.prototype.slice.call(arguments, 1),
		fToBind = this,
		fNOP = function () {},
		fBound = function () {
			return fToBind.apply(this instanceof fNOP && oThis
				? this
				: oThis,
				aArgs.concat(Array.prototype.slice.call(arguments)));
		};

	fNOP.prototype = this.prototype;
	fBound.prototype = new fNOP();

	return fBound;
};

jsb.urlRegExp = new RegExp(
	"^" +
		// protocol identifier
		"(?:(?:https?|ftp)://)" +
		// user:pass authentication
		"(?:\\S+(?::\\S*)?@)?" +
		"(?:" +
			// IP address dotted notation octets
			// excludes loopback network 0.0.0.0
			// excludes reserved space >= 224.0.0.0
			// excludes network & broacast addresses
			// (first & last IP address of each class)
			"(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])" +
			"(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}" +
			"(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))" +
		"|" +
			// host name
			"(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)" +
			// domain name
			"(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*" +
			// TLD identifier
			"(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))" +
		"|" +
			"(?:localhost)" +
		")" +
		// port number
		"(?::\\d{2,5})?" +
		// resource path
		"(?:/\\S*)?" +
	"$", "i"
);

jsb.getHttpRelativeUrl = function(url)
{
	var http = "http://";
	var https = "https://";
	if (url.indexOf(http) > -1)
	{
		url = url.substr(http.length);
	}
	else if (url.indexOf(https) > -1)
	{
		url = url.substr(https.length);
	}

	var pos = url.indexOf("/");
	if (pos > -1)
	{
		url = url.substr(pos + 1);
	}
	return url;
};

cc.supportEncrypt = function (argument) {
	// body...
	return cc.sys.encrypt_enabled && jsb.isEncryptEnabled();
};

cc.supportSplitFilesizeJson = function(){
	// return false;
	return cc.sys.supported_split_allfilesize;
};

//是否支持ios 广告追踪权限开启的相关api（检查权限是否开启，拉起游戏的ios设置界面）
cc.supportIOSAdTrackGuide = function() {
	return cc.sys.supported_ios_ad_track_guide;
}

cc.supportFcaEffectPool = function() {
	return cc.sys.supported_fca_effect_pool;
}

cc.supportUDP = function() {
	return cc.sys.supported_udp;
}

cc.supportFmodRecord = function() {
	return cc.sys.supported_fmod_record;
}

cc.supportSpineSelectLoad = function() {
	return cc.sys.supported_spine_select_load;
}

_setCurrLanguage = function () {
    // body...
    var data = require("game.json");
    var lang = _getSysLang(data);

    cc.game.gameData = data;

    cc.game.sysLang = lang;
	hg.ResourceManager.getInstance().setCurrLanguage(lang);
	if(cc.supportSplitFilesizeJson()){
		hg.ResourceManager.getInstance().loadI18nJson(lang);
	}
};

//setting current language
_setCurrLanguage();

//device image
cc.isDeviceImage = function ( url ) {
    return cc.isSupportAstc();
};

cc.deviceImageExt = function (argument) {
    // 支持astc的设备返回 lzas
    if (cc.isSupportAstc())
        return ".lzas";

	// body...
	if (cc.sys.os === cc.sys.OS_ANDROID)
		return ".lzap";
	else if (cc.sys.os === cc.sys.OS_IOS)
		return ".lzip";
	else
		return ".lzap";
};

cc.performedDeviceImage = function (url) {
	// body...
	if (!url)
		return url;

	if (cc.isDeviceImage(url))
	{
		if (cc.isPngOrJpgType(url))
		{
			url = cc.path.changeExtname(url, cc.deviceImageExt())
		}
	}

	return url;
};

cc.filterDeviceImage = function (url) {
	// body...
	var bRet = false;

	if (!url)
		return bRet;

    // 此处增加lzas没有影响
	if(url.endsWith(".lzap") || url.endsWith(".lzip") || url.endsWith(".lzas"))
		bRet = true;

	return bRet;
};

//device image
if (cc.supportDeviceImage())
{
    var config = {
        lzpvr: ".pvr",
    };

    config.lzpvr = cc.deviceImageExt();

    //format config
    var resMgr = hg.ResourceManager.getInstance();
    resMgr.setFormatConfig(config);

   	//enabled device image
 	var enabled = cc.game.enbaleDeviceImage;
 	if (cc.sys.os === sys.OS_WINDOWS)
 	{
 		enabled = true;
 	}
 	else if (cc.sys.os === sys.OS_IOS)
 	{
 		enabled &= cc.sys.supported_ios_device_image;
 	}

   	resMgr.setDeviceImageEnabled(enabled);

   	//static
    // astc 默认开启，不再单独判断目录
   	// cc.loadStaticDeviceImageModules();
}

//patch preffix
cc.supportPatchPreffix = function (argument) {
	// body...
	return cc.sys.supported_patch_preffix;
};


//enabled encrypt
if(cc.sys.encrypt_enabled)
{
	jsb.setEncryptEnabled(cc.sys.os !== cc.sys.OS_WINDOWS);
}

//encrpt
if (cc.supportEncrypt())
{
	var resMgr = hg.ResourceManager.getInstance();

	//config
	resMgr.addRedirectConfig("jsc", "jse");
	resMgr.addRedirectConfig("jsonc", "jsone");
	resMgr.addRedirectConfig("zip", "zipe");
	resMgr.addRedirectConfig("json", "jsone");

	//details
	resMgr.addRedirectDetail("zip", ["srcmodule"]);
}

/*********************************************************/
cc.reportCustomCDN = function(cdn, status, startTime) {
	var myDate = new Date();
	var endTime = myDate.getTime();
	var useTime = endTime - startTime;
	if(startTime > 0 && useTime <= 15000) {
		var userStr = cdn + ";" + status + ";" + useTime; //当前使用的CDN - 结果 - 用时
		if(cc.sys.os === cc.sys.OS_WINDOWS) {
			return;
		}
		cc.reportAppEvent("network_cdn", userStr);
	}
};
cc.checkNetConnect = function(){
    var netStatus = dsBridge.call("callApp", {msg: "getAppNetStatus"}) || "UNKNOWN";
    var connect = true;
    if(cc.sys.os === cc.sys.OS_IOS){
        if((netStatus !== "wifi") && (netStatus !== "wwan"))
            connect = false;
    }
    else if(cc.sys.os === cc.sys.OS_ANDROID){
        if((netStatus !== "WIFI") && (netStatus !== "2G")
            && (netStatus !== "3G") && (netStatus !== "4G"))
            connect = false;
    }
    return connect;
};

cc.getHGameLocalID = function () {
	var key = "hgameid";
	var hid = window.localStorage.getItem(key);
	if(hid) {
		return hid;
	}
	else {
		hid = "";
		var len = 24;
		var charstr = "abcdefghijklmnopqrstuvwxyz0123456789";
		var maxLen = charstr.length;
		for (var i = 0; i < len; i++) {
			var cStr = charstr.charAt(Math.floor(Math.random()*maxLen));
			if(cStr) {
				hid = hid + "" + cStr;
			}
			else {
				hid += "a";
			}
		}

		window.localStorage.setItem(key, hid);
		return hid;
	}
};

cc.reportAppEvent = function (event, userdata) {
	if(cc.sys.os === cc.sys.OS_WINDOWS) {
		return;
	}
	var user_unique_id = ""; //info1用户唯一标识
	if (ed && ed.platformMgr) {
		var platform = ed.platformMgr.getPlatformName() || "";
		var tempPlatform = ed.loginMgr.getServerPlatform();
		if(tempPlatform) {
			platform = tempPlatform;
		}
		platform = platform + "-"
		var region = (ed.loginMgr.getRegion() || "") + "-";
		user_unique_id = region + (ed.netHelper.getServerID() || "") + ";" + (ed.player.getUid() || "") + ";" + platform + (ed.platformMgr.getAppUid() || "");
	}
	var action = event; //info2玩家行为
	var hid = cc.getHGameLocalID() + ""; //info3玩家的hgame Id
	var detail = (userdata + "") || ""; //info4 参数
	var ext = "afkarena_launch_report_event"; //info4 参数
	var data = [user_unique_id, action, hid, detail, ext];
	event = "login_steps";
	lilithApi.report(event,data)
};

//timeline
cc.supportTimeline = function (argument) {
	// body...
	return jsb.timeline;
};

//md5 verify
cc.supportMD5Verify = function (argument) {
	// body...
	return cc.sys.supported_md5_verify && cc.supportEncrypt();
};


if (cc.supportMD5Verify())
{
	var resMgr = hg.ResourceManager.getInstance();

	//config
	resMgr.addVerifyConfig("jse");
	resMgr.addVerifyConfig("jsone");
}

cc.supportAudioVolume = function (argument) {
	// body...
	return cc.sys.supported_audio_volume;
};

cc.supportNetworkDiagnosis = function (argument) {
	// body...
	return cc.sys.supported_network_diagnosis;
};

cc.supportDirectoryClean = function (argument) {
	// body...
	return cc.sys.supported_directory_clean;
};

if (cc.supportDirectoryClean())
{
	var resMgr = hg.ResourceManager.getInstance();

	//config
	resMgr.addRemoveDirectory("res/fca");
	resMgr.addRemoveDirectory("res/ui/plist");
};

cc.supportMD5Download = function (argument) {
	// body...
	return cc.sys.supported_md5_download;
};

cc.supportAsyncManipulation = function (argument) {
	// body...
	return cc.sys.supported_async_manipulation;
};

cc.supportAsyncManipulation2 = function (argument) {
	// body...
	return cc.sys.supported_async_manipulation2;
};

if (cc.supportAsyncManipulation())
{
	cc.spriteFrameCache.setAsyncRemoveEnabled(true);
}

cc.getCheckversionZipName = function() {
	if(cc.supportSplitFilesizeJson()){
		var md5 = "checkversionSplit.zip";
		if (cc.supportEncrypt())
		{
			md5 = "checkversionSplit.zipe";
		}
		return md5;
	}else{
		var md5 = "checkversion.zip";
		if (cc.supportEncrypt())
		{
			md5 = "checkversion.zipe";
		}
		
		return md5;
	}
}

cc.wrapEncrypt = function(filename){
	if (cc.sys.jsb && cc.supportEncrypt()){
		filename += "e";
	}
	return filename;
}

cc.isI18nFileSizeJsonExist = function(lang){
	var i18nFile = cc.wrapEncrypt("res/md5/fileSize_" + lang + ".json");
	return jsb.fileUtils.isFileExist(i18nFile);
}

cc.isAllFileSizeJsonExist = function(){
	if(cc.supportSplitFilesizeJson()){
		//common
		var commonFile = cc.wrapEncrypt("res/fileSizeCommon.json");
		//i18n
		return jsb.fileUtils.isFileExist(commonFile) && cc.isI18nFileSizeJsonExist(cc.game.sysLang);
	}else{
		var allFileSizeJson = cc.wrapEncrypt("res/allFileSize.json");
		return jsb.fileUtils.isFileExist(allFileSizeJson);
	}
}

cc.supportFcaAudio = function (argument) {
	// body...
	return cc.sys.supported_fca_audio;
};

cc.compareAppVersion =  function ( comVer ) {
	// body...
	var bGreater = true;

	var appVer = "";

	if (cc.sys.os === cc.sys.OS_IOS || cc.sys.os === cc.sys.OS_ANDROID)
	{
		var obj = {msg: "getCurrnetAppVersion"};
		appVer = hg.jsbDsbridge.getInstance().call("callApp", obj, JSON.stringify(obj));
	}

	var len = Math.min(comVer.length, appVer.length);
	comVer = comVer.substr(0, len);
	comVer = Number(comVer.replace(".", ""));

	appVer = appVer.substr(0,len);
	appVer = Number(appVer.replace(".", ""));

	if(typeof appVer != "number")
	{
	    bGreater =  false;
	}
	else
	{
		if(appVer >= comVer)
		    bGreater= true;
		else
			bGreater = false;
	}

	return bGreater;
};

cc.supportSplashVideo = function (argument) {
	// body...
	return cc.sys.supported_splash_video;
};

cc.supportGlobalVideo = function (argument) {
	// body...
	return cc.sys.supported_global_video;
};

cc.supportSplashVideoChannel = function (argument) {
	// body...
	if (cc.sys.chn || cc.sys.os === cc.sys.OS_WINDOWS)
		return true;

	var channelNameToPKGName = ed.channelNameToPKGName;
	var channelEnum = ed.platformChannelIDEnum;
	var _p_configs = ed._p_configs;

	var packageName = cc.game.packageName;
	var channelName = dsBridge.call("callApp", {msg: "getChannelName"});
	if(channelName && channelNameToPKGName[channelName])
	{
	    packageName = channelNameToPKGName[channelName];
	}

	var cfg = _p_configs[packageName] || {};
	var channelId = cfg.channel_id || "0";

	var exclusiveChannel = [
		channelEnum.APPSTORE_TAIWAN_CHANNEL_ID,
		channelEnum.GOOGLEPLAY_TAIWAN_CHANNEL_ID,
		channelEnum.GOOGLEPLAY_TAIWAN_MYCARD_CHANNEL_ID,
		channelEnum.UNI_ABROAD_CHANNEL_ID,
		channelEnum.APPSTORE_VIETNAM_CHANNEL_ID,
		channelEnum.GOOGLEPLAY_VIETNAM_CHANNEL_ID
	];

	var index = exclusiveChannel.indexOf(channelId);
	return  index < 0 && cc.supportGlobalVideo();
};

cc.getDeviceInfo = function ( callback ) {
	// body...

	require("res/platformConfig.js");

	if (cc.sys.os === cc.sys.OS_ANDROID || cc.sys.os === cc.sys.OS_WINDOWS || !cc.supportGlobalVideo())
	{
		callback();
		return;
	}

	hg.SDKInterface.setCallback("getDeviceInfo", function(data, app_id){

		data = JSON.parse(data);

	    cc.game.device_info = {
	    	data: data,
	    	app_id: app_id,
	    };

	    //package name
	    cc.game.packageName = data["package_name"] || "";

	    if(cc.sys.os === cc.sys.OS_IOS) {
	        cc.game.packageName = data["pack_name"] || "";
	    }

	    callback();
	});
	
	var MSG_CODE_GET_DEVICE_INFO = 7;
	hg.SDKInterface.sendMessage(MSG_CODE_GET_DEVICE_INFO);
};

cc.supportLogoVideo = function (argument) {
	// body...
	return cc.supportSplashVideo() && cc.sys.isFirtLaunch && cc.supportSplashVideoChannel() && ccui.VideoView;
};

cc.supportJsonInitialized = function (argument) {
	// body...
	return cc.sys.supported_json_initialized;
};

cc.supportLocaleCompare = function (argument) {
	// body...
	return cc.sys.supported_locale_compare;
};


//login handler
cc.registerLogin = function (argument) {
	// body...

	hg.SDKInterface.setCallback("login", function(status, appUid, appToken, clientIp) {
	    cc.log("login clientIp:" + clientIp);

	    var data = {
	    	status: status,
	    	appUid: appUid,
	    	appToken: appToken, 
	    	clientIp: clientIp,
	    };

	    cc.game.loginData = data;
	});
};

cc.registerLogin();
