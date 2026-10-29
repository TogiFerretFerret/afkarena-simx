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
impl Runtime {
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
        let Some(frame)=self.active_argument_frames.iter().rev().find(|frame|frame.callee==callee)else{return Ok(Value::Null)};
        let mut values=frame.original.values(&self.original_argument_values).to_vec();let metadata=frame.metadata;
        if let Some(metadata)=metadata {
            for index in 0..values.len().min(metadata.names.len()) {
                let name=metadata.names[index];
                // Earlier duplicate formal slots are not the binding's actual
                // parameter slot; extra and missing arguments retain raw shape.
                if !metadata.raw_slots[index]&&!metadata.names[index+1..].contains(&name){values[index]=self.lookup(metadata.env,name)?;}
            }
        }
        let object=self.object();let id=self.object_id(object)?;self.objects[id.0].kind=ObjectKind::Arguments;
        for(index,value)in values.into_iter().enumerate(){let key=self.string(&index.to_string());self.define_data(object,key,value,true,true,true)?;}
        let length_key=self.string("length");let frame=self.active_argument_frames.iter().rev().find(|frame|frame.callee==callee).ok_or_else(||JsError::Unsupported("legacy arguments frame disappeared".into()))?;let length=frame.original.length;
        self.define_data(object,length_key,Value::Number(length as f64),true,false,true)?;
        let callee_key=self.string("callee");self.define_data(object,callee_key,Value::Function(callee),true,false,true)?;
        Ok(object)
    }
}

impl ActiveArgumentsFrame {pub(crate) fn reachability_roots<'a>(&self,storage:&'a[Value])->(FunctionId,&'a[Value],Option<EnvId>){(self.callee,self.original.values(storage),self.metadata.map(|metadata|metadata.env))}}
