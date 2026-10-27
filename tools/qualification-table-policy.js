/* Shared qualification-only policy: explicitly mutable tables stay ordinary VM
 * objects and are exported in full; all other table writes fail closed. */
(function(host){
 "use strict";
 host.installQualificationTablePolicy=function(options){
  options=options||{};
  var boundary=host.installQualificationTableMembrane(options),mutable=Object.create(null),names=new Set(options.mutableTables||[]);
  names.forEach(function(name){if(typeof name!=='string'||!name)throw new Error('Mutable table policy requires named tables');});
  return{
   wrap:function(root,info){
    if(names.has(info.name)){
     if(Object.prototype.hasOwnProperty.call(mutable,info.name)&&mutable[info.name]!==root)throw new Error('Mutable table root replaced: '+info.name);
     mutable[info.name]=root;return root;
    }
    return boundary.wrap(root,info);
   },
   immutableMetadata:boundary.immutableMetadata,
   assertClean:boundary.assertClean,
   mutableRoots:function(){return mutable;},
   stats:function(){var stats=boundary.stats();stats.mutableTables=Object.keys(mutable);return stats;}
  };
 };
})(globalThis);
