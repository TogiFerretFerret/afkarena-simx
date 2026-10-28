function(name){
    if(__nativeTables===null){
      if(__nativeTableText===null){if(typeof hermescli!=='object'||typeof hermescli.loadFile!=='function')throw new Error('External table IO requires hermescli.loadFile host binding');__nativeTableText=__nativeDecodeUTF8(hermescli.loadFile(__nativeTablePath));}
      __nativeTables=JSON.parse(__nativeTableText).tables;__nativeTableText=null;
    }
    if(!Object.prototype.hasOwnProperty.call(__nativeTables,name))throw new Error('Missing native source table: '+name);if(typeof __nativeTableBoundary!=='undefined'){if(!Object.prototype.hasOwnProperty.call(__nativeWrappedTables,name))__nativeWrappedTables[name]=__nativeTableBoundary.wrap(__nativeTables[name],{name:name});return __nativeWrappedTables[name];}return __nativeTables[name];
  }