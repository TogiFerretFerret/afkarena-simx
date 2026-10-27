window.updateloadingMsg = function(input) {//调用一次，说明下载完成一次
    if(window.wx || cc.sys.jsb) {
        return;
    }
    window.indexLoading.finishOneDownloadPhase();
};

window.indexLoading = {
    maxPhase:20,//进入游戏的阶段数，每收到一个input即为一个阶段完成
    displayCurrentPhase:1,//展示的当前下载第几阶段
    downloadFinishedPhase:0,//下载完成阶段数。每收到一次update，算一个“下载完成阶段数”

    timer:null,
    frameRate:30,//30毫秒
    growingSpeed:0.1,//正常涨幅

    fastSpeed:0.3,
    slowSpeed:0.005,
    stopSpeed:0,

    curPercent:0,
    start:function(){
        if(window.wx ||  cc.sys.jsb) {
            return;
        }
        "use strict";
        this.displayCurrentPhase = 1;//应该是当前进度
        this.downloadFinishedPhase = 0;

        this.startProgressBarGrowing();
    },
    finishOneDownloadPhase:function(){
        "use strict";
        this.downloadFinishedPhase++;
    },
    setGrowingSpeed:function(){//根据当前“展示完成数”、“下载完成数”、“总数”、当前进度，去判断growingSpeed
        "use strict";
        var self=this;
        var displayFinishPhase = self.displayCurrentPhase-1;//展示完成的进度为显示进度-1
        if(displayFinishPhase < self.downloadFinishedPhase){//可以快速涨
            self.growingSpeed = self.fastSpeed;//快速
        }else if(displayFinishPhase == self.downloadFinishedPhase){//可能是0 0初始状态，可能是13 13中间状态，可能是16 16结束状态
            if(displayFinishPhase < self.maxPhase){//中间状态
                if(self.curPercent<0.6){
                    self.growingSpeed = self.growingSpeed;//正常
                }else if(self.curPercent<0.9){
                    self.growingSpeed = self.slowSpeed;//慢速
                }else{
                    self.growingSpeed = self.stopSpeed;//停止，等待
                }
            }else if(displayFinishPhase == self.maxPhase){//完成
                self.growingSpeed = self.stopSpeed;//停止
            }
        }else{
            if(displayFinishPhase < self.maxPhase){//中间状态
                if(self.curPercent<0.6){
                    self.growingSpeed = self.growingSpeed;//正常
                }else if(self.curPercent<0.9){
                    self.growingSpeed = self.slowSpeed;//慢速
                }else{
                    self.growingSpeed = self.stopSpeed;//停止，等待
                }
            }else if(displayFinishPhase == self.maxPhase){//完成
                self.growingSpeed = self.stopSpeed;//停止
            }
        }
    },
    startProgressBarGrowing:function(){
        "use strict";
        var self = this;
        this.timer = setInterval(function(){//进度条涨的函数。
            self.setGrowingSpeed();
            self.curPercent+=self.growingSpeed;
            if(self.curPercent>=1){
                self.curPercent=1;
            }
            var isAr = window.isArabic();
            var dir = "leftToRight";
            if(isAr){
                dir = "rightToLeft";
            }
            self.setLoadingBarProgress(self.curPercent, dir);
            self.setLoadingText();
            if(self.curPercent>=1){
                if(self.displayCurrentPhase<self.maxPhase){
                    self.displayCurrentPhase++;
                    self.curPercent=0;
                }
            }
        },self.frameRate);
    },
    setLoadingBarProgress:function(percent, dir){//根据进度设置样式。percent:0.1, dir leftToRight rightToLeft
        "use strict";
        var bar = document.getElementById("bar");
        var styleText = bar.getAttribute("style");
        var styleTextArr = styleText.split(';');
        var newStyleText = "";
        var maxWidth;
        for(var i=0;i<styleTextArr.length;i++){
            var singleStyle = styleTextArr[i];
            if(singleStyle.length>0){
                if(singleStyle.indexOf("width: ")>-1){
                    var widthIndex =singleStyle.indexOf("width: ");
                    var widthNum = singleStyle.substring(widthIndex + 7, singleStyle.length-2);
                    maxWidth = parseInt(widthNum);
                }
                if(singleStyle.indexOf("clip: rect")>-1){
                    var progressWidth = percent * maxWidth;
                    if(dir === "leftToRight"){

                    }else{
                        progressWidth = (1 - percent) * maxWidth;
                    }
                    var rectIndex = singleStyle.indexOf("clip: rect");
                    var rectStr = singleStyle.substring(rectIndex + 11, singleStyle.length-1);//"0px 90px 20px 10px"上右下左
                    var rectStrArr = rectStr.split('px');
                    var up;
                    var right;
                    var down;
                    var left;
                    for(var i=0;i<rectStrArr.length;i++){
                        var pixelStr = rectStrArr[i];//" 90"
                        if(pixelStr.length>0){
                            if(i==0){//上
                                up = parseInt(pixelStr);
                            }else if(i==1){
                                right = parseInt(pixelStr);
                            }else if(i==2){
                                down = parseInt(pixelStr);
                            }else if(i==3){
                                left = parseInt(pixelStr);
                            }
                        }
                    }
                    if(dir === "leftToRight"){
                        singleStyle = "clip: rect(" + up + "px " + progressWidth + "px " + down + "px " + left + "px)";
                    }else{
                        singleStyle = "clip: rect(" + up + "px " + maxWidth + "px " + down + "px " + progressWidth + "px)";
                    }

                }
                newStyleText += singleStyle + ";";
            }
        }
        bar.setAttribute("style",newStyleText);
    },
    setLoadingText:function(){
        "use strict";
        var self=this;
        var loadingText = document.getElementById("loadingText");
        if(loadingText){
            var text = self.displayCurrentPhase+"/"+self.maxPhase;
            var originText = loadingText.innerHTML;
            if(originText != text){
                loadingText.innerHTML = text;
            }
        }
    },
    destroyTimer:function(){
        "use strict";
        var self=this;
        if(self.timer){
            clearInterval(self.timer);
        }
    }
};

window.destroyLoadingView = function(){
    window.indexLoading.destroyTimer();
    var div = document.getElementById("cocosLoadingContainer");
    var alpha = 100;
    var changeOpacity = function(obj, iTarget){
        var timer = null;
        clearInterval(timer);
        var speed = -10;
        timer = setInterval(function(){
            if(alpha == iTarget){
                clearInterval(timer);

                document.body.removeChild(div);
            }else{
                alpha += speed;
                obj.style.opacity = alpha/100;
                obj.style.filter = "alpha(opacity=" + alpha + ")";
            }
        }, 40);
    };
    var changeOpacityCSS = function(obj){
        var styleText = "-webkit-transition: opacity 1s linear; -moz-transition: opacity 1s linear;-o-transition: opacity 1s linear; transition: opacity 1s linear; opacity:0;"
        obj.setAttribute("style", styleText);
    };
    if(div){
        changeOpacity(div,0);
        //changeOpacityCSS(div);
        //document.body.removeChild(div);
        //div.setAttribute("style","display:none");
    }
    var loadingStyle = document.getElementById("loadingStyle");
    if(loadingStyle){
        document.head.removeChild(loadingStyle);
    }
};


if (!cc.sys.jsb)
{
    window.indexLoading.start();
}

// 0、确认下载资源类型txt、png、jpg、json、js、proto、zip、fcaz、pz、jsonz、cha
// 1、普通下载，查看资源是否已经加入队列，如果加入则跳过，否则加入到最后。
// 2、插队下载，查看资源是否已经加入队列，如果加入则删除，之后将资源加入到队列头部。
// 3、每帧更新，从队列头部取 SINGLE_TASK_COUNT 个资源加入正在加载的列表中。
// 4、当任务完成之后，通知所有任务，有资源完成了，并从正在加载的列表中去除。
// 5、这个类只管理下载任务，不管理下载内容缓存，下载内容需要取cc.loader.cache里查询。

/**
 * 任务类，一个task包含若干需要下载的资源，当所有资源完成后回调。
 */
var SINGLE_TASK_COUNT = 6;      // 每帧开始任务数量（降低并发数避免ERR_INSUFFICIENT_RESOURCES）
var MAX_TASK_COUNT = 6;        // 最多同时开始多少任务（降低并发数避免ERR_INSUFFICIENT_RESOURCES）
var identifier = 0;
if(window.wx) {
    SINGLE_TASK_COUNT = 4;  // 微信环境进一步降低
}
if(cc.sys.jsb) {
    SINGLE_TASK_COUNT = 9999;  // 原生环境保持不变
}

window.download_task = function() {
    this.identifier = identifier++;
    this.res_list = {};   // 当前任务需要下载的所有资源列表
    this.res_length = 0;
    this.pr = null;
    this.cb = null;
    this.result = ed.res.success;
}

download_task.prototype.create = function(list, pr, cb) {//downloadTask把list拆成{路径:true}存在res_list中,记录这组task的progress complete回调
    this.pr = pr;
    this.cb = cb;

    this.res_length = 0;
    var i = list.length;

    while(i--) {
        if (list[i])
        {
           if (!this.res_list[list[i]])
           {
               this.res_list[list[i]] = true;
               this.res_length++;
           } 
       }
    }
    
    this.max_length = this.res_length;
};

download_task.prototype.finish = function(path, result) {
    if (this.res_length <= 0) return;

    var res = this.res_list[path];
    if (res)
    {
        this.res_length--;
        this.res_list[path] = false;

        if (result === ed.res.error)
        {
            this.result = ed.res.error;
        }
    }


    if (this.pr !== null) {
        // console.log("single Task finish:" + path);
        this.pr(this.max_length, this.max_length - this.res_length);
    }
};

download_task.prototype.callFinishHandler = function( ) {
    if (this.res_length <= 0 && this.cb) {
        var cb = this.cb;
        this.cb = null;
        cb( this.result );
    }
}

download_task.prototype.isFinish = function() {
    return this.res_length <= 0;
};

download_task.prototype.getMaxLength = function() {
    return this.max_length;
};


/**
 * 队列类，将任务中的资源按顺序重组，以队列的顺序依次下载，最多同时下载 MAX_TASK_COUNT。
 */
window.download_queue = function() {
    this.reset();
}

download_queue.prototype.reset = function() {
    this.tasks = [];
    this.queue = [];
    this.queue_loading = [];
    this.state = "waiting"; // "loading"
    this.delCount = 0;
}

// 同时只有 MAX_TASK_COUNT 个任务可以下载，最多不超过 MAX_TASK_COUNT + SINGLE_TASK_COUNT
// 每次开始 SINGLE_TASK_COUNT 个任务

download_queue.prototype.start = function(){
    
    if (!cc.sys.jsb)
    {
        /*if(this.state == "loading"){
            return;
        }*/
    }

    this.update();
}

download_queue.prototype.next = function()
{
    this.state = "waiting";
    this.start();
}

download_queue.prototype.update = function() {
    if (this.queue.length == 0){
        this.state = "waiting";
        return;
    }
    this.state = "loading";
    var self = this;
    var min_size = Math.min(this.queue.length, SINGLE_TASK_COUNT);
    var paths = this.queue.splice(0, min_size);
    if (paths && paths.length > 0) {
        this.queue_loading = this.queue_loading.concat(paths);
        cc.loader.load(paths,
            function() {},
            function(result, data) {
                cc.addTaskCbs(paths, result);
                if(cc.sys.jsb){

                }else{
                    self.state = "waiting";
                    // self.start();
                }
                /*if (cc.sys.jsb) {
                    cc.addTaskCbs(paths, result);
                } else {
                    for (var key in paths) {
                        self.finish(paths[key], ed.res.success);
                    }
                    
                    self.state = "waiting";
                    self.start();
                }*/
            });
    }
};

download_queue.prototype.push = function(task) {
    for (var path in task.res_list) {
        var idx = this.queue.indexOf(path);
        if (idx < 0) this.queue.push(path);
    }
    this.tasks.push(task);
    this.start();
};

download_queue.prototype.hasTask = function() {
    return this.tasks.length - this.delCount > 0 ;
}

download_queue.prototype.insert = function(task) {//把task中的res_list中的东西，记在自己的queue里，用于下载。把task记在this.tasks里
    for (var path in task.res_list) {
        var idx = this.queue.indexOf(path);
        if (idx >= 0){
            this.queue.splice(idx, 1);
        }

        this.queue.unshift(path);
    }

    this.tasks.push(task);
    this.start();
};

download_queue.prototype.finish = function(path, result) {
    var idx = this.queue_loading.indexOf(path);
    while(idx >= 0)
    {
        this.queue_loading.splice(idx, 1);
        idx = this.queue_loading.indexOf(path);
    }

    var i = this.tasks.length;
    while(i--) {
        var task = this.tasks[i];
        task.finish(path, result);
    }

    var delArr = [];

    for (var j = 0; j < this.tasks.length; j++) {
        var task = this.tasks[j];
        if (task.isFinish())
        {
            this.delCount++;
            delArr.push(task);
        }
    }

    for(var k = 0; k < delArr.length; k ++) {
        var index = this.tasks.indexOf(delArr[k]);
        this.tasks.splice(index, 1);
    }

    this.delCount = 0;

    var firstError = null;
    for(var m = 0; m < delArr.length; m ++) {
        try {
            delArr[m].callFinishHandler();
        }
        catch(error) {
            firstError = firstError || error;
        }
    }

    if(firstError) {
        throw firstError;
    }
};

download_queue.prototype.getTasksTotalLength = function(){
    var tempLength = 0;
    for(var i=0;i<this.tasks.length;i++){
        var task = this.tasks[i];
        tempLength += task.getMaxLength();
    }
    return tempLength;
};


/**
 * 管理类，外部访问接口
 */
window.download_manager = function() {
    this.queue = new download_queue();
    this.errInfo = {};
};

download_manager.prototype.reset = function() {
    this.queue.reset();
}
download_manager.prototype.push = function(res_list, pr, cb) {
    var task = new download_task();
    task.create(res_list, pr, cb);
    this.queue.push(task);
    return task;
}

download_manager.prototype.hasTask = function() {
    return this.queue.hasTask();
}

download_manager.prototype.isWaiting = function() {
    return this.queue.state === "waiting";
}

download_manager.prototype.pushLow = function(res_list, pr, cb){
    this.insert(res_list, pr, cb);
}

download_manager.prototype.insert = function(res_list, pr, cb) {//一次insert，new一个downloadTask
    var task = new download_task();
    task.create(res_list, pr, cb);
    this.queue.insert(task);
    return task;
}

download_manager.prototype.finish = function(path, result) {

    if (path)
    {
        this.errInfo[path] = result;
    }

    this.queue.finish(path, result);
}

download_manager.prototype.update = function() {
    // this.queue.update();
};

download_manager.prototype.getTotalTaskNumber = function() {//拿到队列中的最大长度
    var tempLength = 0;
    tempLength = this.queue.getTasksTotalLength();
    return tempLength;
};

download_manager.prototype.start = function()
{
    this.queue.next();
};

download_manager.prototype.getError = function ( url ) {
    // body...
    if (!url)
        return "";

    return this.errInfo[url] || "";
};

window.g_dlmgr = new download_manager();


/**
 * Created by zhouxun on 2018/1/31.
 */
window.testChinese = function(test){
    var reg = new RegExp("[\\u4E00-\\u9FFF]+","g");
    return reg.test(test);
};

window.testNoTrans = function(test){
    return test.indexOf("不用翻译") === -1;
};

// 预编译正则表达式，避免每次调用都创建新对象
var REGEX_MAX_TAG = /<max:[^>]*>/g;

window._T = function(text) {
    if (!hg || !hg.languageDb) {
        return text;
    }

    text = text.replace(REGEX_MAX_TAG, '')
    var ret = ""
    ret = hg.languageDb[text || ""];

    if ((text != "" && (ret === null || ret === "" || ret === undefined) && testChinese(text) && testNoTrans(text))){
        var isTextKeyExist = hg.languageDb.hasOwnProperty(text);
        //languageDb里没key,说明拉词条就有问题
        if(!isTextKeyExist){
            return "@@" + text;
        }
        //languageDb里有key,但是没有对应的value,说明有词条但本地化pm还没发翻译
        else{
            return "$$" + text;
        }

    }
    else if(ret == undefined)
        return text;
    else if(ret =="" && text != "")
        return text;
    else{
        if(!cc.sys.jsb){
            ret = ret.replace(/""/g, '"')
        }
        if (testChinese(ret))
            ret = ret.replace(/\\t/g, "    ")
        else
            ret = ret.replace(/\\t/g, "  ")
        return ret;
    }
};

window.T = function(key, str){
    return _T(str);
};

window.H = function(str){
    return "**" + str;
};
