export function* fullSortCorpus(guildLevels,{count=20000}={}){
 let state=0xf17ecafe;const draw=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
 function valuesFor(n,shape){
  if(shape===15&&n===guildLevels.length)return guildLevels.slice();
  if(shape===8||shape===9||shape===13){let out=[],runs=shape===8?[65,33,64,32,97,48,129]:shape===9?[233,144,89,55,34,33,32]:[17,91,33,63,128,32,65,34];let at=0,r=0;while(at<n){const length=Math.min(runs[r++%runs.length],n-at),base=(n-at)*4;for(let i=0;i<length;i++)out.push(base+i);at+=length;}return out;}
  return Array.from({length:n},(_,i)=>{const d=draw();switch(shape){case 0:return d%97;case 1:return i;case 2:return n-i;case 3:return 0;case 4:return i%3===0?NaN:i%3===1?Infinity:-Infinity;case 5:return i%2?-0:0;case 6:return Math.floor(i/8)%2?-i:i;case 7:return(d-2147483648)/1024;case 10:return i<Math.floor(n/2)?i+Math.floor(n/2):i-n;case 11:{const half=Math.floor(n/2),j=i<half?i:i-half;return Math.floor(j/16)*32+j%16+(i<half?0:16);}case 12:return i<n/2?i:n-i;case 14:return i%31;default:return i%115;}});
 }
 for(let id=0;id<count;id++){
  const small=id<1000,directed=id>=1000&&id<2874,guild=id>=2874&&id<2880;
  const n=small?id%64:directed?64+(id-1000)%937:guild?guildLevels.length:id%10===0?64+draw()%937:64+draw()%193;
  const mode=directed?Math.floor((id-1000)/937):guild?0:id%12;
  const shape=guild?15:(id+Math.floor(id/12))%16,seed=draw();
  const throwAt=directed||guild?0:id%7===0?1+draw()%Math.max(1,Math.floor(n*Math.log2(Math.max(2,n)))):0;
  const tokenMod=!directed&&!guild&&id%5===0?Math.ceil(n/2):0;
  yield{id,n,mode,shape,seed,throwAt,tokenMod,values:valuesFor(n,shape),label:small?'small-regression':guild?'original-guild-115':directed?'every-length-64-through-1000':'merge-gallop-inconsistent'};
 }
}
export function fullSortReference(test){
 const{n,mode,seed,throwAt,tokenMod,values}=test;let rng=seed,calls=[];
 const input=Array.from({length:n},(_,i)=>tokenMod?i%tokenMod:i),array=input.slice();
 const rank=id=>(id%4===0?1000:0)+(id%5===0?100:0)+(id%7===0?10:0);
 function compare(a,b){calls.push([a,b]);if(calls.length===throwAt)throw new Error('throw:'+throwAt);const x=values[a],y=values[b];switch(mode){case 0:return x-y;case 1:return y-x;case 2:return-1;case 3:return 1;case 4:return 0;case 5:return NaN;case 6:return rank(a)+(x-y<0?1:-1)-rank(b);case 7:rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;rng>>>=0;return .5-rng/4294967296;case 8:return a%3===b%3?0:(a%3+1)%3===b%3?-1:1;case 9:return calls.length%2===0?-1:1;case 10:return x<y?-Infinity:Infinity;case 11:return calls.length%3===0?NaN:x-y;}}
 let status='ok';try{array.sort(compare);}catch(e){status=e.message;}
 return{status,output:array,calls,rng};
}
