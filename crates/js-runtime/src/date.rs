//! Native Date execution. Stored time is clipped UTC milliseconds; local-time
//! APIs are admitted only in a verified UTC host domain, never a guessed zone.
use crate::{Runtime,Value,JsError,JsResult,ObjectKind};
use crate::closures::NativeFn;
use crate::env::EnvId;
use crate::value::{Hint,CONVERSION_NAN};
use battle_core::js_math as math;
use std::time::{SystemTime,UNIX_EPOCH};
const DAY:i64=86_400_000;
impl Runtime {
 pub fn install_date_builtins(&mut self)->JsResult<()> {
  let prototype=self.object();let constructor=self.native_function("Date",7,date_constructor)?;
  self.set_function_constructible(constructor,true)?;self.set_constructor_default_prototype(constructor,prototype)?;
  let key=self.string("prototype");self.define_data(constructor,key,prototype,false,false,false)?;
  let key=self.string("constructor");self.define_data(prototype,key,constructor,true,false,true)?;
  for(name,arity,code)in[("now",0,date_now as NativeFn),("parse",1,date_parse as NativeFn),("UTC",7,date_utc as NativeFn)]{let method=self.native_function(name,arity,code)?;let key=self.string(name);self.define_data(constructor,key,method,true,false,true)?;}
  for(name,arity,code)in[("getTime",0,date_get_time as NativeFn),("valueOf",0,date_get_time as NativeFn),("setTime",1,date_set_time as NativeFn),("toISOString",0,date_iso as NativeFn),("toJSON",1,date_json as NativeFn),("toString",0,date_string as NativeFn),("toUTCString",0,date_utc_string as NativeFn),("toDateString",0,date_date_string as NativeFn),("toTimeString",0,date_time_string as NativeFn)]{let method=self.native_function(name,arity,code)?;let key=self.string(name);self.define_data(prototype,key,method,true,false,true)?;}
  let key=self.string("toUTCString");let utc_string=self.get(prototype,key)?;let alias=self.string("toGMTString");self.define_data(prototype,alias,utc_string,true,false,true)?;
  for name in ["getUTCFullYear","getUTCMonth","getUTCDate","getUTCDay","getUTCHours","getUTCMinutes","getUTCSeconds","getUTCMilliseconds","getFullYear","getMonth","getDate","getDay","getHours","getMinutes","getSeconds","getMilliseconds","getTimezoneOffset","getYear"]{let method=self.native_function(name,0,date_component)?;let key=self.string(name);self.define_data(prototype,key,method,true,false,true)?;}
  for(name,arity)in[("setUTCFullYear",3),("setUTCMonth",2),("setUTCDate",1),("setUTCHours",4),("setUTCMinutes",3),("setUTCSeconds",2),("setUTCMilliseconds",1),("setFullYear",3),("setMonth",2),("setDate",1),("setHours",4),("setMinutes",3),("setSeconds",2),("setMilliseconds",1),("setYear",1),("toLocaleString",0),("toLocaleDateString",0),("toLocaleTimeString",0)]{let method=self.native_function(name,arity,date_unsupported)?;let key=self.string(name);self.define_data(prototype,key,method,true,false,true)?;}
  let key=self.string("Date");self.define_data(Value::Object(self.global_object),key,constructor,true,false,true)?;Ok(())
 }
}
fn arg(args:&[Value],index:usize)->Value{args.get(index).copied().unwrap_or(Value::Undefined)}
fn time(rt:&Runtime,value:Value)->JsResult<f64>{let id=rt.object_id(value)?;if let ObjectKind::Date(time)=rt.objects[id.0].kind{Ok(time)}else{Err(JsError::TypeError("this is not a Date object".into()))}}
fn clip(value:f64)->f64{if !value.is_finite()||value.abs()>8.64e15{CONVERSION_NAN}else{let value=value.trunc();if value==0.0{0.0}else{value}}}
fn wall_now()->JsResult<f64>{match SystemTime::now().duration_since(UNIX_EPOCH){Ok(duration)=>Ok(duration.as_millis()as f64),Err(error)=>Ok(-(error.duration().as_millis()as f64))}}
fn utc_domain()->JsResult<()> {
 let declared=std::env::var("TZ").ok();
 let utc=match declared.as_deref(){Some("UTC"|"Etc/UTC"|"GMT"|"Etc/GMT"|"UTC0"|"GMT0")=>true,Some("")=>true,Some(_)=>false,None=>std::fs::read_to_string("/etc/timezone").is_ok_and(|s|matches!(s.trim(),"UTC"|"Etc/UTC"|"GMT"|"Etc/GMT"))};
 if utc{Ok(())}else{Err(JsError::Unsupported("Date local-time operation requires a verified UTC host time zone".into()))}
}
fn date_now(_: &mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(wall_now()?))}
fn date_constructor(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{
 if !rt.is_construct_call(){utc_domain()?;return Ok(rt.string(&display(wall_now()?,Display::Full)?));}
 let value=match args.len(){0=>wall_now()?,1=>{
  if args[0].is_object()&&matches!(rt.objects[rt.object_id(args[0])?.0].kind,ObjectKind::Date(_)){time(rt,args[0])?}
  else{let primitive=rt.to_primitive(args[0],Hint::Default)?;if let Value::String(id)=primitive{parse(rt.string_units(id))?}else{clip(rt.to_number(primitive)?)}}
 },_=>{utc_domain()?;components(rt,args,false)?}};
 let id=rt.object_id(this)?;rt.objects[id.0].kind=ObjectKind::Date(clip(value));Ok(this)
}
fn date_get_time(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(time(rt,this)?))}
fn date_set_time(rt:&mut Runtime,this:Value,args:&[Value],_:EnvId)->JsResult<Value>{time(rt,this)?;let value=clip(rt.to_number(arg(args,0))?);let id=rt.object_id(this)?;rt.objects[id.0].kind=ObjectKind::Date(value);Ok(Value::Number(value))}
fn date_parse(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{let string=rt.to_string(arg(args,0))?;Ok(Value::Number(parse(rt.string_units(string))?))}
fn date_utc(rt:&mut Runtime,_:Value,args:&[Value],_:EnvId)->JsResult<Value>{Ok(Value::Number(components(rt,args,true)?))}
fn components(rt:&mut Runtime,args:&[Value],utc:bool)->JsResult<f64>{
 let mut values=[0.0;7];values[2]=1.0;
 for i in 0..7 {if i<args.len(){values[i]=rt.to_number(args[i])?}else if i==0{values[i]=rt.to_number(Value::Undefined)?}}
 if !utc{utc_domain()?;}
 if values.iter().any(|n|!n.is_finite()){return Ok(CONVERSION_NAN)}
 let mut year=values[0].trunc();if (0.0..=99.0).contains(&year){year+=1900.0}
 Ok(clip(make_date(year,values[1],values[2],values[3],values[4],values[5],values[6])?))
}
fn make_date(year:f64,month:f64,date:f64,hour:f64,minute:f64,second:f64,millisecond:f64)->JsResult<f64>{
 if [year,month,date,hour,minute,second,millisecond].iter().any(|n|!n.is_finite()){return Ok(CONVERSION_NAN)}
 if year.abs()>1_000_000.0||month.abs()>12_000_000.0||date.abs()>1_000_000_000.0{return Err(JsError::Unsupported("Date calendar components exceed proven integer domain".into()))}
 let month=month.trunc()as i64;let year=year.trunc()as i64+month.div_euclid(12);let month=month.rem_euclid(12)+1;
 let day=days_from_civil(year,month,1)+(date.trunc()as i64)-1;
 let clock=math::add(math::add(math::add(math::mul(hour.trunc(),3_600_000.0),math::mul(minute.trunc(),60_000.0)),math::mul(second.trunc(),1000.0)),millisecond.trunc());
 Ok(math::add(math::mul(day as f64,DAY as f64),clock))
}
fn days_from_civil(mut year:i64,month:i64,day:i64)->i64{year-=i64::from(month<=2);let era=year.div_euclid(400);let yoe=year-era*400;let doy=(153*(month+if month>2{-3}else{9})+2)/5+day-1;era*146097+yoe*365+yoe/4-yoe/100+doy-719468}
fn civil_from_days(day:i64)->(i64,i64,i64){let z=day+719468;let era=z.div_euclid(146097);let doe=z-era*146097;let yoe=(doe-doe/1460+doe/36524-doe/146096)/365;let mut year=yoe+era*400;let doy=doe-(yoe*365+yoe/4-yoe/100);let mp=(5*doy+2)/153;let day=doy-(153*mp+2)/5+1;let month=mp+if mp<10{3}else{-9};year+=i64::from(month<=2);(year,month,day)}
struct Parts{year:i64,month:i64,date:i64,weekday:i64,hour:i64,minute:i64,second:i64,millisecond:i64}
fn parts(time:f64)->Parts{let time=time as i64;let day=time.div_euclid(DAY);let rem=time.rem_euclid(DAY);let(year,month,date)=civil_from_days(day);Parts{year,month,date,weekday:(day+4).rem_euclid(7),hour:rem/3_600_000,minute:rem/60_000%60,second:rem/1000%60,millisecond:rem%1000}}
fn date_iso(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let n=time(rt,this)?;if !n.is_finite(){return Err(JsError::RangeError("Invalid time value".into()))}let p=parts(n);let year=if(0..=9999).contains(&p.year){format!("{:04}",p.year)}else{format!("{}{:06}",if p.year<0{"-"}else{"+"},p.year.abs())};Ok(rt.string(&format!("{year}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",p.month,p.date,p.hour,p.minute,p.second,p.millisecond)))}
fn date_json(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let object=rt.to_object(this)?;let primitive=rt.to_primitive(object,Hint::Number)?;if let Value::Number(n)=primitive{if !n.is_finite(){return Ok(Value::Null)}}let key=rt.string("toISOString");let method=rt.get(object,key)?;rt.call_value(method,object,&[])}
enum Display{Full,Date,Time,Utc}
fn display(time:f64,kind:Display)->JsResult<String>{if !time.is_finite(){return Ok("Invalid Date".into())}let p=parts(time);let weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];let months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];let year=if p.year<0{format!("-{:04}",p.year.abs())}else{format!("{:04}",p.year)};let date=format!("{} {} {:02} {year}",weekdays[p.weekday as usize],months[p.month as usize-1],p.date);let clock=format!("{:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",p.hour,p.minute,p.second);Ok(match kind{Display::Full=>format!("{date} {clock}"),Display::Date=>date,Display::Time=>clock,Display::Utc=>format!("{}, {:02} {} {year} {:02}:{:02}:{:02} GMT",weekdays[p.weekday as usize],p.date,months[p.month as usize-1],p.hour,p.minute,p.second)})}
fn date_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{utc_domain()?;Ok(rt.string(&display(time(rt,this)?,Display::Full)?))}
fn date_date_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{utc_domain()?;Ok(rt.string(&display(time(rt,this)?,Display::Date)?))}
fn date_time_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{utc_domain()?;Ok(rt.string(&display(time(rt,this)?,Display::Time)?))}
fn date_utc_string(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{Ok(rt.string(&display(time(rt,this)?,Display::Utc)?))}
fn date_component(rt:&mut Runtime,this:Value,_:&[Value],_:EnvId)->JsResult<Value>{let name=rt.call_stack.last().and_then(|id|rt.functions.get(id.0)).map(|f|f.name.clone()).unwrap_or_default();if !name.starts_with("getUTC"){utc_domain()?;}let n=time(rt,this)?;if !n.is_finite(){return Ok(Value::Number(CONVERSION_NAN))}let p=parts(n);let field=name.strip_prefix("getUTC").or_else(||name.strip_prefix("get")).unwrap_or("");let value=match field{"FullYear"=>p.year,"Year"=>p.year-1900,"Month"=>p.month-1,"Date"=>p.date,"Day"=>p.weekday,"Hours"=>p.hour,"Minutes"=>p.minute,"Seconds"=>p.second,"Milliseconds"=>p.millisecond,"TimezoneOffset"=>0,_=>return Err(JsError::Unsupported("unknown Date component".into()))};Ok(Value::Number(value as f64))}
fn date_unsupported(rt:&mut Runtime,_:Value,_:&[Value],_:EnvId)->JsResult<Value>{let name=rt.call_stack.last().and_then(|id|rt.functions.get(id.0)).map(|f|f.name.as_str()).unwrap_or("unknown");Err(JsError::Unsupported(format!("Date.prototype.{name} is not implemented")))}
fn parse(units:&[u16])->JsResult<f64>{
 if units.is_empty()||units=="Invalid Date".encode_utf16().collect::<Vec<_>>() {return Ok(CONVERSION_NAN)}
 if units.iter().any(|u|*u>127){return Err(JsError::Unsupported("Date.parse non-ISO input".into()))}
 let bytes=units.iter().map(|u|*u as u8).collect::<Vec<_>>();let mut p=0;
 fn digits(bytes:&[u8],p:&mut usize,count:usize)->Option<i64>{let mut number=0;for _ in 0..count{let b=*bytes.get(*p)?;if !b.is_ascii_digit(){return None}number=number*10+i64::from(b-b'0');*p+=1;}Some(number)}
 fn take(bytes:&[u8],p:&mut usize,c:u8)->bool{if bytes.get(*p)==Some(&c){*p+=1;true}else{false}}
 let sign=if take(&bytes,&mut p,b'+'){1}else if take(&bytes,&mut p,b'-'){-1}else{0};
 let Some(raw_year)=digits(&bytes,&mut p,if sign==0{4}else{6})else{return Err(JsError::Unsupported("Date.parse legacy/non-ISO format".into()))};
 if sign<0&&raw_year==0{return Ok(CONVERSION_NAN)}let year=raw_year*if sign==0{1}else{sign};let(mut month,mut day)=(1,1);
 if take(&bytes,&mut p,b'-'){let Some(m)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};month=m;if take(&bytes,&mut p,b'-'){let Some(d)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};day=d;}}
 if !(1..=12).contains(&month)||!(1..=31).contains(&day){return Ok(CONVERSION_NAN)}
 let(mut hour,mut minute,mut second,mut millisecond)=(0,0,0,0);let mut offset=0;
 if take(&bytes,&mut p,b'T'){
  let Some(h)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};hour=h;if !take(&bytes,&mut p,b':'){return Ok(CONVERSION_NAN)}let Some(m)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};minute=m;
  if take(&bytes,&mut p,b':'){let Some(s)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};second=s;if take(&bytes,&mut p,b'.'){let start=p;let mut count=0;while bytes.get(p).is_some_and(|b|b.is_ascii_digit()){if count<3{millisecond=millisecond*10+i64::from(bytes[p]-b'0')}p+=1;count+=1}if start==p{return Ok(CONVERSION_NAN)}for _ in count..3{millisecond*=10}}}
  if hour>24||minute>59||second>59||(hour==24&&(minute!=0||second!=0||millisecond!=0)){return Ok(CONVERSION_NAN)}
  if take(&bytes,&mut p,b'Z'){}else if matches!(bytes.get(p),Some(b'+'|b'-')){let direction=if bytes[p]==b'+'{1}else{-1};p+=1;let Some(h)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};if !take(&bytes,&mut p,b':'){return Err(JsError::Unsupported("Date.parse compact time-zone offset".into()))}let Some(m)=digits(&bytes,&mut p,2)else{return Ok(CONVERSION_NAN)};if h>23||m>59{return Ok(CONVERSION_NAN)}offset=direction*(h*60+m);}else{utc_domain()?;}
 }
 if p!=bytes.len(){return Err(JsError::Unsupported("Date.parse legacy/non-ISO suffix".into()))}
 let value=make_date(year as f64,(month-1)as f64,day as f64,hour as f64,minute as f64,second as f64,millisecond as f64)?;
 Ok(clip(math::sub(value,(offset*60_000)as f64)))
}
