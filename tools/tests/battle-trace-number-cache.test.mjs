import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';

const uncached=`    function bits(value) {
        data.setFloat64(0, value, false);
        return data.getUint32(0, false).toString(16).padStart(8, "0") + data.getUint32(4, false).toString(16).padStart(8, "0");
    }
`;
test('bounded number memoization preserves complete raw-bit graph against uncached encoder',async()=>{
  const source=await readFile(new URL('../battle-trace-portable.js',import.meta.url),'utf8');
  const start=source.indexOf('    // Number Map equality'),end=source.indexOf('    var typedArrayBrand',start);
  assert.ok(start>=0&&end>start);
  const baseline=source.slice(0,start)+uncached+source.slice(end);
  const hexes=['0000000000000000','8000000000000000','7ff0000000000000','fff0000000000000','7ff0000000000001','fff0000000000001','7ff8000000000001','fff8000000000001'];
  let state=0x13579bdf;
  for(let i=0;i<20000;i++){
    state=(Math.imul(state,1664525)+1013904223)>>>0;const high=state;
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    hexes.push(high.toString(16).padStart(8,'0')+state.toString(16).padStart(8,'0'));
  }
  const contexts=[baseline,source].map(text=>{
    const context=createContext({hexes});runInContext(text,context);
    runInContext(`var values=[],d=new DataView(new ArrayBuffer(8));for(var i=0;i<hexes.length;i++){d.setUint32(0,parseInt(hexes[i].slice(0,8),16),false);d.setUint32(4,parseInt(hexes[i].slice(8),16),false);values.push(d.getFloat64(0,false));}var capture=installGraphCapture();`,context);return context;
  });
  for(let pass=0;pass<3;pass++){
    const graphs=contexts.map(context=>runInContext('JSON.stringify(capture.snapshot({root:values}))',context));
    assert.equal(graphs[1],graphs[0],`pass ${pass}, including cache eviction`);
    for(const context of contexts)runInContext('values[0]=-0;values[1]=0;d.setUint32(0,0xfff80001,false);d.setUint32(4,17,false);values[2]=d.getFloat64(0,false);',context);
  }
});
