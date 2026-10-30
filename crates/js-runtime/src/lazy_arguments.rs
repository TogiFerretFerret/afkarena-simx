//! Active call arguments are owned, bounded by call depth, and removed on both
//! normal and abrupt return. Legacy sloppy f.arguments reads create fresh,
//! unmapped snapshots; they are distinct from lexical mapped arguments objects.
use crate::{Runtime,Value,FunctionId,EnvId,JsError,JsResult,ObjectKind};

// Frames retain indices, never a borrowed pointer into the growable shared
// stack. A recursive call can reallocate storage without invalidating a range.
#[derive(Clone,Copy)]
pub(crate) struct OriginalArguments { start:usize,length:usize }
impl OriginalArguments {
    fn new(start:usize,length:usize)->Self{Self{start,length}}
    fn values<'a>(&self,storage:&'a[Value])->&'a[Value]{&storage[self.start..self.start+self.length]}
}
#[derive(Clone,Copy)]
pub(crate) struct ArgumentsMetadata {
    env:EnvId,names:&'static [&'static str],raw_slots:&'static [bool],
}
pub(crate) struct ActiveArgumentsFrame {
    pub(crate) callee:FunctionId,original:OriginalArguments,metadata:Option<ArgumentsMetadata>,
}
impl ActiveArgumentsFrame {
    pub(crate) fn new(callee:FunctionId,start:usize,length:usize)->Self{Self{callee,original:OriginalArguments::new(start,length),metadata:None}}
}
// Only promoted mutable sloppy formals need a live mirror. The original raw
// argument stack and the 64-byte general activation frame stay unchanged.
#[derive(Clone,Copy)]
struct NativeParameterMirrorFrame {frame_index:usize,start:usize,indices:&'static[usize]}
#[derive(Default)]
pub(crate) struct NativeParameterMirrors {frames:Vec<NativeParameterMirrorFrame>,pub(crate) values:Vec<Value>}
impl Runtime {
    pub fn register_promoted_parameters(&mut self,indices:&'static[usize],values:&[Value])->JsResult<()>{
        if indices.len()!=values.len()||indices.windows(2).any(|pair|pair[0]>=pair[1]){return Err(JsError::Unsupported("invalid promoted parameter metadata".into()))}
        let frame_index=self.active_argument_frames.len().checked_sub(1).ok_or_else(||JsError::Unsupported("promoted parameters without a sloppy activation".into()))?;
        let frame=&self.active_argument_frames[frame_index];let metadata=frame.metadata.ok_or_else(||JsError::Unsupported("promoted parameters before argument metadata".into()))?;
        if self.call_stack.last()!=Some(&frame.callee)||indices.iter().any(|&index|index>=metadata.names.len()||!metadata.raw_slots[index])||self.native_parameter_mirrors.frames.last().is_some_and(|last|last.frame_index==frame_index){return Err(JsError::Unsupported("invalid promoted parameter activation".into()))}
        let start=self.native_parameter_mirrors.values.len();self.native_parameter_mirrors.values.extend_from_slice(values);self.native_parameter_mirrors.frames.push(NativeParameterMirrorFrame{frame_index,start,indices});Ok(())
    }
    #[inline]
    pub fn write_promoted_parameter(&mut self,slot:usize,value:Value)->JsResult<()>{
        let frame=self.native_parameter_mirrors.frames.last().ok_or_else(||JsError::Unsupported("promoted parameter write without mirror".into()))?;
        if frame.frame_index+1!=self.active_argument_frames.len()||self.call_stack.last()!=self.active_argument_frames.last().map(|f|&f.callee)||slot>=frame.indices.len(){return Err(JsError::Unsupported("invalid promoted parameter write".into()))}
        self.native_parameter_mirrors.values[frame.start+slot]=value;Ok(())
    }
    #[inline]
    pub(crate) fn finish_promoted_parameters(&mut self,frame_index:usize){
        if self.native_parameter_mirrors.frames.last().is_some_and(|frame|frame.frame_index==frame_index){let frame=self.native_parameter_mirrors.frames.pop().unwrap();self.native_parameter_mirrors.values.truncate(frame.start);}
    }
    /// Despite its historical name, this registers reflection metadata for both
    /// lazy and eager sloppy functions. It never creates a source object.
    pub fn register_lazy_arguments(&mut self,env:EnvId,names:&'static [&'static str],args:&[Value],raw_slots:&'static [bool])->JsResult<()> {
        if names.len()!=raw_slots.len(){return Err(JsError::Unsupported("argument reflection metadata length mismatch".into()))}
        let callee=self.call_stack.last().copied().ok_or_else(||JsError::Unsupported("arguments registration outside a source call".into()))?;
        let frame=self.active_argument_frames.last_mut().filter(|frame|frame.callee==callee).ok_or_else(||JsError::Unsupported("arguments registration without a sloppy activation".into()))?;
        if frame.original.length!=args.len(){return Err(JsError::Unsupported("argument reflection activation length mismatch".into()))}
        frame.metadata=Some(ArgumentsMetadata{env,names,raw_slots});Ok(())
    }
    /// Only the function's original own legacy property calls this hook. The
    /// descriptor attributes stay readonly/nonconfigurable while its value is
    /// computed anew for the innermost matching active invocation.
    pub(crate) fn active_function_arguments(&mut self,callee:FunctionId)->JsResult<Value>{
        let Some((frame_index,frame))=self.active_argument_frames.iter().enumerate().rev().find(|(_,frame)|frame.callee==callee)else{return Ok(Value::Null)};
        let mut values=frame.original.values(&self.original_argument_values).to_vec();let metadata=frame.metadata;
        if let Some(metadata)=metadata {
            for index in 0..values.len().min(metadata.names.len()) {
                let name=metadata.names[index];
                // Earlier duplicate formal slots are not the binding's actual
                // parameter slot; extra and missing arguments retain raw shape.
                if !metadata.raw_slots[index]&&!metadata.names[index+1..].contains(&name){values[index]=self.lookup(metadata.env,name)?;}
            }
        }
        if let Some(mirror)=self.native_parameter_mirrors.frames.iter().rev().find(|mirror|mirror.frame_index==frame_index){for(slot,&index)in mirror.indices.iter().enumerate(){if let Some(value)=values.get_mut(index){*value=self.native_parameter_mirrors.values[mirror.start+slot];}}}
        let object=self.object();let id=self.object_id(object)?;self.objects[id.0].kind=ObjectKind::Arguments;
        for(index,value)in values.into_iter().enumerate(){let key=self.string(&index.to_string());self.define_data(object,key,value,true,true,true)?;}
        let length_key=self.string("length");let frame=self.active_argument_frames.iter().rev().find(|frame|frame.callee==callee).ok_or_else(||JsError::Unsupported("legacy arguments frame disappeared".into()))?;let length=frame.original.length;
        self.define_data(object,length_key,Value::Number(length as f64),true,false,true)?;
        let callee_key=self.string("callee");self.define_data(object,callee_key,Value::Function(callee),true,false,true)?;
        Ok(object)
    }
}

impl ActiveArgumentsFrame {pub(crate) fn reachability_roots<'a>(&self,storage:&'a[Value])->(FunctionId,&'a[Value],Option<EnvId>){(self.callee,self.original.values(storage),self.metadata.map(|metadata|metadata.env))}}

#[cfg(test)]mod indexed_stack_tests{
 use super::*;
 fn same(a:Value,b:Value){match(a,b){(Value::Number(a),Value::Number(b))=>assert_eq!(a.to_bits(),b.to_bits()),_=>assert_eq!(a,b)}}
 fn original(rt:&Runtime)->Vec<Value>{let frame=rt.active_argument_frames.last().unwrap();frame.original.values(&rt.original_argument_values).to_vec()}
 fn thrower(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let saved=original(rt);assert_eq!(saved.len(),args.len());for(&a,&b)in saved.iter().zip(args){same(a,b)}Err(JsError::Throw(args[0]))}
 fn recursive(rt:&mut Runtime,_:Value,args:&[Value],env:EnvId)->JsResult<Value>{let saved=original(rt);let Value::Number(depth)=args[0]else{panic!()};let callee=*rt.call_stack.last().unwrap();let frame_count=rt.active_argument_frames.len();let value_count=rt.original_argument_values.len();if depth>0.0{let mut nested=args.to_vec();nested[0]=Value::Number(depth-1.0);nested.push(Value::Number(f64::from_bits(0xfff8000000000042)));rt.call(Value::Function(callee),Value::Undefined,&nested)?;assert_eq!(rt.active_argument_frames.len(),frame_count);assert_eq!(rt.original_argument_values.len(),value_count);}let fail=rt.lookup(env,"stackThrower")?;let error=rt.call(fail,Value::Undefined,&[args[1],Value::Undefined,Value::Null,Value::Bool(false),args[2],args[3],args[4]]).unwrap_err();let JsError::Throw(value)=error else{panic!()};same(value,args[1]);let after=original(rt);for(&a,&b)in saved.iter().zip(&after){same(a,b)}let first=rt.active_function_arguments(callee)?;let second=rt.active_function_arguments(callee)?;assert_ne!(first,second);for(index,&expected)in args.iter().enumerate(){let key=rt.string(&index.to_string());let actual=rt.get(first,key)?;same(actual,expected);}Ok(args[1])}
 #[test]fn recursive_ranges_survive_reallocation_nested_throws_and_fresh_legacy_snapshots(){let mut rt=Runtime::new();rt.diagnostics.enabled=false;let fail=rt.make_closure_with_flags(thrower,rt.global_env,0,"stackThrower",false,None);rt.declare(rt.global_env,"stackThrower",fail).unwrap();let f=rt.make_closure_with_flags(recursive,rt.global_env,0,"recursive",false,None);let object=rt.object();let args=[Value::Number(24.0),Value::Number(f64::from_bits(0x7ff0000000000042)),Value::Number(-0.0),Value::Number(f64::from_bits(0x7ff8000000000069)),object,fail];let value=rt.call(f,Value::Undefined,&args).unwrap();same(value,args[1]);assert!(rt.original_argument_values.is_empty()&&rt.active_argument_frames.is_empty()&&rt.call_stack.is_empty());let capacity=rt.original_argument_values.capacity();let _=rt.call(f,Value::Undefined,&args).unwrap();assert_eq!(rt.original_argument_values.capacity(),capacity);assert!(rt.original_argument_values.is_empty());let error=rt.call(fail,Value::Undefined,&args).unwrap_err();assert!(matches!(error,JsError::Throw(_)));assert!(rt.original_argument_values.is_empty()&&rt.active_argument_frames.is_empty()&&rt.call_stack.is_empty());}
 fn metadata(rt:&mut Runtime,_:Value,args:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);rt.declare(env,"x",args[1])?;rt.register_lazy_arguments(env,&["x","x","y"],args,&[false,false,true])?;rt.assign(env,"x",Value::Number(-0.0),false)?;let callee=*rt.call_stack.last().unwrap();let first=rt.active_function_arguments(callee)?;let values=[args[0],Value::Number(-0.0),args[2],args[3],args[4]];for(i,&expected)in values.iter().enumerate(){let key=rt.string(&i.to_string());same(rt.get(first,key)?,expected);}let key=rt.string("0");rt.set(first,key,Value::Number(9.0),true)?;let fresh=rt.active_function_arguments(callee)?;let key=rt.string("0");same(rt.get(fresh,key)?,args[0]);Ok(Value::Undefined)}
 #[test]fn duplicate_formals_raw_promoted_slots_and_extra_arguments_preserve_original_shape(){let mut rt=Runtime::new();let f=rt.make_closure_with_flags(metadata,rt.global_env,3,"metadata",false,None);let args=[Value::Number(f64::from_bits(0x7ff0000000000001)),Value::Number(3.0),Value::Number(f64::from_bits(0xfff8000000000042)),Value::Undefined,Value::Number(-0.0)];rt.call(f,Value::Undefined,&args).unwrap();assert!(rt.original_argument_values.is_empty()&&rt.active_argument_frames.is_empty());}
 fn untracked(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{assert!(rt.active_argument_frames.is_empty()&&rt.original_argument_values.is_empty());Ok(Value::Undefined)}
 #[test]fn strict_and_arrow_calls_do_not_push_shared_original_argument_storage(){let mut rt=Runtime::new();for(strict,arrow)in[(true,None),(false,Some(Value::Null))]{let f=rt.make_closure_with_flags(untracked,rt.global_env,0,"untracked",strict,arrow);rt.call(f,Value::Undefined,&[Value::Number(1.0);7]).unwrap();}assert_eq!(rt.original_argument_values.capacity(),0);assert_eq!(std::mem::size_of::<ActiveArgumentsFrame>(),64);assert_eq!(std::mem::size_of::<OriginalArguments>(),16);}
}

#[cfg(test)]mod promoted_parameter_tests{
 use super::*;
 fn equal(a:Value,b:Value){match(a,b){(Value::Number(a),Value::Number(b))=>assert_eq!(a.to_bits(),b.to_bits()),_=>assert_eq!(a,b)}}

 fn strict_attempt(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{assert!(rt.write_promoted_parameter(0,Value::Null).is_err());Ok(Value::Undefined)}
 fn mirrored(rt:&mut Runtime,_:Value,args:&[Value],parent:EnvId)->JsResult<Value>{
  let env=rt.child_env(parent);rt.register_lazy_arguments(env,&["depth","a"],args,&[true,true])?;rt.register_promoted_parameters(&[1],&[args[1]])?;let frame_index=rt.active_argument_frames.len()-1;let original=rt.active_argument_frames[frame_index].original.values(&rt.original_argument_values).to_vec();
  let Value::Number(depth)=args[0]else{panic!()};let current=rt.object();let key=rt.string("bits");rt.define_data(current,key,Value::Number(f64::from_bits(0x7ff0000000000042)),true,true,true)?;rt.write_promoted_parameter(0,current)?;
  let callee=*rt.call_stack.last().unwrap();if depth>0.0{rt.call(Value::Function(callee),Value::Undefined,&[Value::Number(depth-1.0),args[1]])?;}
  let strict=rt.make_closure_with_flags(strict_attempt,env,0,"strictAttempt",true,None);rt.call(strict,Value::Undefined,&[])?;
  if depth==0.0{let marks=rt.native_battle_gc_marks(env,&[])?;for &value in &rt.native_parameter_mirrors.values{if let Value::Object(id)=value{assert!(marks.objects[id.0]);}}}
  let key=rt.string("bits");let Value::Number(bits)=rt.get(current,key)?else{panic!()};assert_eq!(bits.to_bits(),0x7ff0000000000042);
  let first=rt.active_function_arguments(callee)?;let key=rt.string("1");equal(rt.get(first,key)?,current);rt.set(first,key,Value::Number(99.0),true)?;let second=rt.active_function_arguments(callee)?;assert_ne!(first,second);let key=rt.string("1");equal(rt.get(second,key)?,current);
  for(&before,&after)in original.iter().zip(rt.active_argument_frames[frame_index].original.values(&rt.original_argument_values)){equal(before,after)}
  equal(rt.native_parameter_mirrors.values.last().copied().unwrap(),current);Ok(current)
 }
 #[test]fn mirror_recursion_keeps_originals_immutable_roots_current_values_and_reuses_capacity(){
  let mut rt=Runtime::new();rt.enable_native_battle_gc();let f=rt.make_closure(mirrored,rt.global_env,2,"mirrored");let original=rt.object();let args=[Value::Number(16.0),original];rt.call(f,Value::Undefined,&args).unwrap();assert!(rt.native_parameter_mirrors.values.is_empty()&&rt.native_parameter_mirrors.frames.is_empty());assert!(rt.original_argument_values.is_empty()&&rt.active_argument_frames.is_empty());let capacity=(rt.native_parameter_mirrors.values.capacity(),rt.native_parameter_mirrors.frames.capacity());rt.call(f,Value::Undefined,&args).unwrap();assert_eq!(capacity,(rt.native_parameter_mirrors.values.capacity(),rt.native_parameter_mirrors.frames.capacity()));assert_eq!(std::mem::size_of::<ActiveArgumentsFrame>(),64);
 }
 fn missing(rt:&mut Runtime,_:Value,args:&[Value],parent:EnvId)->JsResult<Value>{let env=rt.child_env(parent);rt.register_lazy_arguments(env,&["a"],args,&[true])?;rt.register_promoted_parameters(&[0],&[Value::Undefined])?;rt.write_promoted_parameter(0,Value::Number(-0.0))?;let callee=*rt.call_stack.last().unwrap();let snapshot=rt.active_function_arguments(callee)?;let length=rt.string("length");assert_eq!(rt.get(snapshot,length)?,Value::Number(0.0));let zero=rt.string("0");assert_eq!(rt.get(snapshot,zero)?,Value::Undefined);Err(JsError::Throw(Value::Number(f64::from_bits(0x7ff0000000000069))))}
 #[test]fn missing_actual_slots_do_not_appear_and_throw_cleans_mirrors(){let mut rt=Runtime::new();let f=rt.make_closure(missing,rt.global_env,1,"missing");let JsError::Throw(value)=rt.call(f,Value::Undefined,&[]).unwrap_err()else{panic!()};equal(value,Value::Number(f64::from_bits(0x7ff0000000000069)));assert!(rt.native_parameter_mirrors.values.is_empty()&&rt.native_parameter_mirrors.frames.is_empty());assert!(rt.original_argument_values.is_empty()&&rt.active_argument_frames.is_empty()&&rt.call_stack.is_empty());assert!(rt.register_promoted_parameters(&[0],&[Value::Null]).is_err());assert!(rt.write_promoted_parameter(0,Value::Null).is_err());}
}
