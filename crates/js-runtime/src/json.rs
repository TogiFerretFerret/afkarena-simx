//! Native UTF-16 JSON parsing and serialization, without a JavaScript backend.
//! Replacer callbacks, getters and toJSON execute through generated Rust calls.
use crate::{Runtime,Value,JsError,JsResult,ObjectKind,ObjectId,StringId};
use crate::closures::NativeFn;
use crate::env::EnvId;

impl Runtime {
    pub fn install_json_builtins(&mut self)->JsResult<()> {
        let object=self.object();
        let id=self.object_id(object)?;self.objects[id.0].kind=ObjectKind::Json;
        for(name,arity,code)in[("parse",2,json_parse as NativeFn),("stringify",3,json_stringify as NativeFn)] {
            let function=self.native_function(name,arity,code)?;let key=self.string(name);
            self.define_data(object,key,function,true,false,true)?;
        }
        let key=self.string("JSON");self.define_data(Value::Object(self.global_object),key,object,true,false,true)?;
        Ok(())
    }
    pub fn json_parse(&mut self,text:Value,reviver:Value)->JsResult<Value> {
        let string=self.to_string(text)?;
        let units=self.string_units(string).to_vec();
        let mut parser=Parser{rt:self,units:&units,position:0};
        let result=parser.value(0)?;parser.space();
        if parser.position!=units.len(){return Err(parser.error("unexpected trailing JSON text"));}
        // Modern JSON.parse revivers receive a third context.source argument.
        // Do not quietly call a two-argument approximation of that interface.
        if reviver.is_callable(){return Err(JsError::Unsupported("JSON.parse reviver requires source-context-aware internalization".into()));}
        Ok(result)
    }
    pub fn json_stringify(&mut self,value:Value,replacer:Value,space:Value)->JsResult<Value> {
        let function=if replacer.is_callable(){Some(replacer)}else{None};
        let mut property_list=None;
        if function.is_none() && replacer.is_object() {
            let id=self.object_id(replacer)?;
            if let ObjectKind::Array{length,..}=self.objects[id.0].kind {
                if length>1_000_000{return Err(JsError::Unsupported("JSON replacer array resource bound".into()));}
                let mut properties=Vec::new();
                for index in 0..length {
                    let key=self.string(&index.to_string());let item=self.get(replacer,key)?;
                    let accepted=match item {Value::String(_)|Value::Number(_)=>true,Value::Object(_)|Value::Function(_)=>matches!(self.objects[self.object_id(item)?.0].kind,ObjectKind::BoxedString(_)|ObjectKind::BoxedNumber(_)),_=>false};
                    if accepted {let key=self.to_string(item)?;if !properties.contains(&key){properties.push(key);}}
                }
                property_list=Some(properties);
            }
        }
        let mut space=space;
        if space.is_object(){match self.objects[self.object_id(space)?.0].kind {ObjectKind::BoxedNumber(_)=>space=Value::Number(self.to_number(space)?),ObjectKind::BoxedString(_)=>space=Value::String(self.to_string(space)?),_=>{}}}
        let gap=match space {
            Value::Number(n)=>{let count=if n.is_nan()||n<=0.0{0}else if n>=10.0{10}else{n.trunc()as usize};vec![32_u16;count]},
            Value::String(id)=>self.string_units(id).iter().take(10).copied().collect(),_=>vec![],
        };
        let wrapper=self.object();let key=self.string("");self.define_data(wrapper,key,value,true,true,true)?;
        let mut state=Stringifier{rt:self,replacer:function,property_list,gap,indent:vec![],stack:vec![]};
        match state.property(key,wrapper,0)?{Some(units)=>Ok(Value::String(state.rt.intern_utf16(&units))),None=>Ok(Value::Undefined)}
    }
}
fn json_parse(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.json_parse(args.first().copied().unwrap_or(Value::Undefined),args.get(1).copied().unwrap_or(Value::Undefined))}
fn json_stringify(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{rt.json_stringify(args.first().copied().unwrap_or(Value::Undefined),args.get(1).copied().unwrap_or(Value::Undefined),args.get(2).copied().unwrap_or(Value::Undefined))}
struct Parser<'a,'b>{rt:&'a mut Runtime,units:&'b[u16],position:usize}
impl Parser<'_,'_>{
    fn error(&self,message:&str)->JsError {JsError::SyntaxError(format!("{message} at position {}",self.position))}
    fn space(&mut self){while self.units.get(self.position).is_some_and(|u|matches!(*u,9|10|13|32)){self.position+=1}}
    fn take(&mut self,unit:u16)->bool{if self.units.get(self.position)==Some(&unit){self.position+=1;true}else{false}}
    fn value(&mut self,depth:usize)->JsResult<Value>{
        if depth>512{return Err(JsError::Unsupported("JSON parse nesting resource bound".into()));}
        self.space();
        match self.units.get(self.position).copied(){
            Some(34)=>Ok(Value::String(self.string()?)),Some(123)=>self.object(depth+1),Some(91)=>self.array(depth+1),
            Some(116)=>{self.keyword("true")?;Ok(Value::Bool(true))},Some(102)=>{self.keyword("false")?;Ok(Value::Bool(false))},
            Some(110)=>{self.keyword("null")?;Ok(Value::Null)},Some(45|48..=57)=>self.number(),
            _=>Err(self.error("unexpected JSON token")),
        }
    }
    fn keyword(&mut self,word:&str)->JsResult<()> {for unit in word.encode_utf16(){if !self.take(unit){return Err(self.error("invalid JSON literal"));}}Ok(())}
    fn string(&mut self)->JsResult<StringId>{
        if !self.take(34){return Err(self.error("expected JSON string"));}
        let mut units=Vec::new();
        loop {
            let unit=*self.units.get(self.position).ok_or_else(||self.error("unterminated JSON string"))?;self.position+=1;
            match unit {
                34=>return Ok(self.rt.intern_utf16(&units)),
                92=>{let escape=*self.units.get(self.position).ok_or_else(||self.error("unterminated JSON escape"))?;self.position+=1;
                    let unit=match escape {34|47|92=>escape,98=>8,102=>12,110=>10,114=>13,116=>9,
                        117=>{let mut number=0;for _ in 0..4{let digit=*self.units.get(self.position).ok_or_else(||self.error("short JSON unicode escape"))?;self.position+=1;let digit=match digit{48..=57=>digit-48,65..=70=>digit-65+10,97..=102=>digit-97+10,_=>return Err(self.error("invalid JSON unicode escape"))};number=number*16+digit;}number},
                        _=>return Err(self.error("invalid JSON escape")),};units.push(unit);
                },
                0..=31=>return Err(self.error("unescaped JSON control character")),
                _=>units.push(unit),
            }
        }
    }
    fn number(&mut self)->JsResult<Value>{
        let start=self.position;self.take(45);
        if !self.take(48){let before=self.position;while self.units.get(self.position).is_some_and(|u|matches!(*u,48..=57)){self.position+=1}if self.position==before{return Err(self.error("invalid JSON number"));}}
        if self.take(46){let before=self.position;while self.units.get(self.position).is_some_and(|u|matches!(*u,48..=57)){self.position+=1}if self.position==before{return Err(self.error("invalid JSON fractional part"));}}
        if self.take(101)||self.take(69){if !self.take(43){self.take(45);}let before=self.position;while self.units.get(self.position).is_some_and(|u|matches!(*u,48..=57)){self.position+=1}if self.position==before{return Err(self.error("invalid JSON exponent"));}}
        let number=crate::value::string_to_number(&self.units[start..self.position]);Ok(Value::Number(number))
    }
    fn object(&mut self,depth:usize)->JsResult<Value>{
        self.position+=1;let object=self.rt.object();self.space();if self.take(125){return Ok(object)}
        loop {self.space();let key=Value::String(self.string()?);self.space();if !self.take(58){return Err(self.error("expected JSON colon"));}let value=self.value(depth)?;self.rt.define_data(object,key,value,true,true,true)?;self.space();if self.take(125){return Ok(object)}if !self.take(44){return Err(self.error("expected JSON comma"));}}
    }
    fn array(&mut self,depth:usize)->JsResult<Value>{
        self.position+=1;let array=self.rt.array(&[]);self.space();if self.take(93){return Ok(array)}let mut index=0usize;
        loop {let value=self.value(depth)?;let key=self.rt.string(&index.to_string());self.rt.define_data(array,key,value,true,true,true)?;index+=1;self.space();if self.take(93){return Ok(array)}if !self.take(44){return Err(self.error("expected JSON array comma"));}}
    }
}
struct Stringifier<'a>{rt:&'a mut Runtime,replacer:Option<Value>,property_list:Option<Vec<StringId>>,gap:Vec<u16>,indent:Vec<u16>,stack:Vec<ObjectId>}
impl Stringifier<'_>{
    fn property(&mut self,key:Value,holder:Value,depth:usize)->JsResult<Option<Vec<u16>>>{
        if depth>512{return Err(JsError::Unsupported("JSON stringify nesting resource bound".into()));}
        let mut value=self.rt.get(holder,key)?;
        if value.is_object(){let name=self.rt.string("toJSON");let method=self.rt.get(value,name)?;if method.is_callable(){value=self.rt.call_value(method,value,&[key])?;}}
        if let Some(replacer)=self.replacer{value=self.rt.call_value(replacer,holder,&[key,value])?;}
        if value.is_object(){match self.rt.objects[self.rt.object_id(value)?.0].kind{ObjectKind::BoxedNumber(_)=>value=Value::Number(self.rt.to_number(value)?),ObjectKind::BoxedString(_)=>value=Value::String(self.rt.to_string(value)?),ObjectKind::BoxedBoolean(b)=>value=Value::Bool(b),_=>{}}}
        match value {
            Value::Null=>Ok(Some(ascii("null"))),Value::Bool(v)=>Ok(Some(ascii(if v{"true"}else{"false"}))),
            Value::String(id)=>Ok(Some(quote(self.rt.string_units(id)))),
            Value::Number(n)=>{if !n.is_finite(){return Ok(Some(ascii("null")))}let id=self.rt.to_string(value)?;Ok(Some(self.rt.string_units(id).to_vec()))},
            Value::Undefined|Value::Function(_)=>Ok(None),
            Value::Object(id)=>{
                if self.stack.contains(&id){return Err(JsError::TypeError("Converting circular structure to JSON".into()));}
                self.stack.push(id);let stepback=self.indent.len();self.indent.extend_from_slice(&self.gap);
                let result=if let ObjectKind::Array{length,..}=self.rt.objects[id.0].kind{self.array(value,length,depth+1)}else{self.object(value,depth+1)};
                self.indent.truncate(stepback);self.stack.pop();result.map(Some)
            }
        }
    }
    fn object(&mut self,value:Value,depth:usize)->JsResult<Vec<u16>>{
        let keys=if let Some(list)=&self.property_list{list.iter().copied().map(Value::String).collect()}else{self.rt.own_keys(value,true)?};
        let mut parts=Vec::new();
        for key in keys {if let Some(body)=self.property(key,value,depth)?{let Value::String(id)=key else{unreachable!()};let mut part=quote(self.rt.string_units(id));part.push(58);if !self.gap.is_empty(){part.push(32)}part.extend(body);parts.push(part);}}
        Ok(self.join(123,125,parts))
    }
    fn array(&mut self,value:Value,length:u32,depth:usize)->JsResult<Vec<u16>>{
        if length>1_000_000{return Err(JsError::Unsupported("JSON array serialization resource bound".into()));}
        let mut parts=Vec::with_capacity(length as usize);
        for index in 0..length {let key=self.rt.string(&index.to_string());parts.push(self.property(key,value,depth)?.unwrap_or_else(||ascii("null")));}
        Ok(self.join(91,93,parts))
    }
    fn join(&self,start:u16,end:u16,parts:Vec<Vec<u16>>)->Vec<u16>{
        let mut output=vec![start];if parts.is_empty(){output.push(end);return output}
        if !self.gap.is_empty(){output.push(10);output.extend_from_slice(&self.indent)}
        for(index,part)in parts.into_iter().enumerate(){if index!=0{output.push(44);if !self.gap.is_empty(){output.push(10);output.extend_from_slice(&self.indent)}}output.extend(part);}
        if !self.gap.is_empty(){output.push(10);output.extend_from_slice(&self.indent[..self.indent.len()-self.gap.len()])}
        output.push(end);output
    }
}
fn ascii(text:&str)->Vec<u16>{text.bytes().map(u16::from).collect()}
fn quote(units:&[u16])->Vec<u16>{
    let mut output=vec![34];let mut index=0;
    while index<units.len(){let unit=units[index];index+=1;
        match unit {
            34|92=>{output.push(92);output.push(unit)},
            8=>output.extend(ascii("\\b")),9=>output.extend(ascii("\\t")),10=>output.extend(ascii("\\n")),12=>output.extend(ascii("\\f")),13=>output.extend(ascii("\\r")),
            0..=31=>output.extend(ascii(&format!("\\u{unit:04x}"))),
            0xd800..=0xdbff=>{if units.get(index).is_some_and(|u|matches!(*u,0xdc00..=0xdfff)){output.push(unit);output.push(units[index]);index+=1}else{output.extend(ascii(&format!("\\u{unit:04x}")))}}
            0xdc00..=0xdfff=>output.extend(ascii(&format!("\\u{unit:04x}"))),
            _=>output.push(unit),
        }
    }
    output.push(34);output
}
