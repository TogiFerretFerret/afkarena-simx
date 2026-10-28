import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
export const sourceExpose=readFileSync(new URL('../../crates/js-runtime/src/native_expose.js',import.meta.url),'utf8');
if(createHash('sha256').update(sourceExpose).digest('hex')!=='9a6a28e97c4c79455e92d4ae1412375ca4c95f013494d0534b9cb779e1693911')throw Error('Expose source changed');
