/* Shared qualification-only policy: explicitly mutable tables stay ordinary VM
 * objects and are exported in full; all other table writes fail closed. */
(function(host){
 "use strict";
 host.installQualificationTablePolicy=function(options){
  options=options||{};
  var boundary=host.installQualificationTableMembrane(options),capsule=options.trackMutable?host.installQualificationMutableTableCapsule(options):null,mutable=Object.create(null),mutableRaw=Object.create(null),names=new Set(options.mutableTables||[]);
  names.forEach(function(name){if(typeof name!=='string'||!name)throw new Error('Mutable table policy requires named tables');});
  return{
   wrap:function(root,info){
    if(names.has(info.name)){
     if(Object.prototype.hasOwnProperty.call(mutable,info.name)){
      if(mutableRaw[info.name]!==root&&mutable[info.name]!==root)throw new Error('Mutable table root replaced: '+info.name);
      return mutable[info.name];
     }
     mutableRaw[info.name]=root;var exposed=capsule?capsule.wrap(root,info):root;mutable[info.name]=exposed;return exposed;
    }
    return boundary.wrap(root,info);
   },
   immutableMetadata:function(value){return boundary.immutableMetadata(value)||(capsule?capsule.immutableMetadata(value):null);},
   assertClean:function(){boundary.assertClean();if(capsule)capsule.assertClean();return true;},
   mutableRoots:function(){return mutable;},
   stats:function(){var stats=boundary.stats();stats.mutableTables=Object.keys(mutable);if(capsule)stats.mutableCapsule=capsule.stats();return stats;}
  };
 };
})(globalThis);
