function __nativeExpose(owner,prefix){
    var keys=Object.create(null);
    for(var i=0;i<__nativeDefinitionNames.length;i++){var full=__nativeDefinitionNames[i];if(full.indexOf(prefix+'.')===0)keys[full.slice(prefix.length+1).split('.')[0]]=true;}
    Object.keys(keys).forEach(function(key){var name=prefix+'.'+key;
      if(key in owner){var descriptor=Object.getOwnPropertyDescriptor(owner,key);if(descriptor&&'value'in descriptor&&descriptor.value&&(typeof descriptor.value==='object'||typeof descriptor.value==='function'))__nativeExpose(descriptor.value,name);return;}
      Object.defineProperty(owner,key,{configurable:true,enumerable:true,get:function(){
        if(__nativeActive[name])throw new Error('Source dependency cycle at '+name);
        var factories=__nativeDefinitions[name];if(!factories)throw new Error('Unsupported scoped source definition: '+name);
        __nativeActive[name]=true;var value;
        try{for(var j=0;j<factories.length;j++){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});value=factories[j].call(__nativeGlobal);}
          Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});
          if(value&&(typeof value==='object'||typeof value==='function'))__nativeExpose(value,name);__nativeLoaded.push(name);return value;
        }finally{delete __nativeActive[name];}
      },set:function(value){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value:value});}});
    });
  }