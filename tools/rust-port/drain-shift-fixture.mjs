import{sourceNativeDrain}from'./source-native-drain.mjs';
export const drainShiftFixture=`var ed={clientCall_list:[],clientCallCount:0},events=[],snapshots=0;${sourceNativeDrain}
var scene={snapshot:function(callback){snapshots++;events.push(callback?"after:"+callback.id:"before");}};
function callback(index){var fn=function(){events.push("call:"+index);};fn.id=index;return fn;}
function resetBench(){ed.clientCall_list=[];events=[];snapshots=0;}
function benchmarkDrain(rounds,width){for(var frame=0;frame<rounds;frame++){ed.clientCall_list=[];for(var i=0;i<width;i++)ed.clientCall_list.push(callback(frame*width+i));__nativeDrain.call(scene);}}
function snapshotBench(){return JSON.stringify({events:events,snapshots:snapshots,clientCallCount:ed.clientCallCount,pending:ed.clientCall_list.length});}resetBench();`;
