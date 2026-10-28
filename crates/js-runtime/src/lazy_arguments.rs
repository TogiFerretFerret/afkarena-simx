//! Active call arguments are owned, bounded by call depth, and removed on both
//! normal and abrupt return. Legacy sloppy f.arguments reads create fresh,
//! unmapped snapshots; they are distinct from lexical mapped arguments objects.
use crate::{Runtime,Value,FunctionId,EnvId,JsError,JsResult,ObjectKind};

pub(crate) enum OriginalArguments {
    Inline{values:[Value;4],length:usize},
    Many(Vec<Value>),
}
impl OriginalArguments {
    fn new(args:&[Value])->Self{if args.len()<=4{let mut values=[Value::Undefined;4];values[..args.len()].copy_from_slice(args);Self::Inline{values,length:args.len()}}else{Self::Many(args.to_vec())}}
    fn values(&self)->&[Value]{match self{Self::Inline{values,length}=>&values[..*length],Self::Many(values)=>values}}
}
#[derive(Clone,Copy)]
pub(crate) struct ArgumentsMetadata {
    env:EnvId,names:&'static [&'static str],raw_slots:&'static [bool],
}
pub(crate) struct ActiveArgumentsFrame {
    pub(crate) callee:FunctionId,original:OriginalArguments,metadata:Option<ArgumentsMetadata>,
}
impl ActiveArgumentsFrame {
    pub(crate) fn new(callee:FunctionId,args:&[Value])->Self{Self{callee,original:OriginalArguments::new(args),metadata:None}}
}
impl Runtime {
    /// Despite its historical name, this registers reflection metadata for both
    /// lazy and eager sloppy functions. It never creates a source object.
    pub fn register_lazy_arguments(&mut self,env:EnvId,names:&'static [&'static str],args:&[Value],raw_slots:&'static [bool])->JsResult<()> {
        if names.len()!=raw_slots.len(){return Err(JsError::Unsupported("argument reflection metadata length mismatch".into()))}
        let callee=self.call_stack.last().copied().ok_or_else(||JsError::Unsupported("arguments registration outside a source call".into()))?;
        let frame=self.active_argument_frames.last_mut().filter(|frame|frame.callee==callee).ok_or_else(||JsError::Unsupported("arguments registration without a sloppy activation".into()))?;
        if frame.original.values().len()!=args.len(){return Err(JsError::Unsupported("argument reflection activation length mismatch".into()))}
        frame.metadata=Some(ArgumentsMetadata{env,names,raw_slots});Ok(())
    }
    /// Only the function's original own legacy property calls this hook. The
    /// descriptor attributes stay readonly/nonconfigurable while its value is
    /// computed anew for the innermost matching active invocation.
    pub(crate) fn active_function_arguments(&mut self,callee:FunctionId)->JsResult<Value>{
        let Some(frame)=self.active_argument_frames.iter().rev().find(|frame|frame.callee==callee)else{return Ok(Value::Null)};
        let mut values=frame.original.values().to_vec();let metadata=frame.metadata;
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
        let length_key=self.string("length");let frame=self.active_argument_frames.iter().rev().find(|frame|frame.callee==callee).ok_or_else(||JsError::Unsupported("legacy arguments frame disappeared".into()))?;let length=frame.original.values().len();
        self.define_data(object,length_key,Value::Number(length as f64),true,false,true)?;
        let callee_key=self.string("callee");self.define_data(object,callee_key,Value::Function(callee),true,false,true)?;
        Ok(object)
    }
}

impl ActiveArgumentsFrame {pub(crate) fn reachability_roots(&self)->(FunctionId,Vec<Value>,Option<EnvId>){(self.callee,self.original.values().to_vec(),self.metadata.map(|metadata|metadata.env))}}
