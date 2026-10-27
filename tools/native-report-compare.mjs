// Every field except timing is semantic. Host replay has separate tape checks.
export function semanticNativeReport(report){
  const {elapsedMs,battlesPerSecond,hostInputConsumption,...semantic}=report;
  return semantic;
}
export function firstDifference(actual,expected,path='$'){
  if(Object.is(actual,expected))return null;
  if(typeof actual!==typeof expected||actual===null||expected===null||typeof actual!=='object')return{path,actual,expected};
  if(Array.isArray(actual)!==Array.isArray(expected))return{path,reason:'array_type'};
  const actualKeys=Object.keys(actual).sort(),expectedKeys=Object.keys(expected).sort();
  if(JSON.stringify(actualKeys)!==JSON.stringify(expectedKeys))return{path:path+'.$keys',actual:actualKeys,expected:expectedKeys};
  for(const key of expectedKeys){const difference=firstDifference(actual[key],expected[key],path+'.'+key);if(difference)return difference;}
  return null;
}
export function compareNativeReports(actual,expected){return firstDifference(semanticNativeReport(actual),semanticNativeReport(expected));}
export function compareHostInputConsumption(actual,expected){
  if(!actual)return{path:'$.hostInputConsumption',actual,expected:'complete replay stats'};
  const clock=actual.clock;
  const checks={random:actual.random===expected.randomCount,clock:clock?.consumed===expected.clockCount,total:clock?.total===expected.clockCount,attempts:clock?.attempts===expected.clockCount,mode:clock?.mode==='replay',remaining:clock?.remaining===0,finished:clock?.finished===true,failure:clock?.failure===null};
  for(const [key,matched]of Object.entries(checks))if(!matched)return{path:'$.hostInputConsumption.'+key,actual,expected};
  return null;
}
