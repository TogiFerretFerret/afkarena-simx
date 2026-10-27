#[path="../crates/battle-core/src/config.rs"] mod config;
use config::{Attributes,Contributions,AttributeObserver,Formula,ATTRIBUTE_COUNT,GROUP_COUNT};
use std::io::{self,BufRead,Write};
#[derive(Default)] struct Trace{records:Vec<String>,finish:Option<Attributes>}
impl AttributeObserver for Trace{
 fn record_formula(&mut self,attribute:usize,formula:Formula,value:f64){self.records.push(format!("{{\"attribute\":{},\"terms\":[{}],\"value\":\"{:016x}\"}}",attribute,formula.values().iter().map(|x|format!("\"{:016x}\"",x.to_bits())).collect::<Vec<_>>().join(","),value.to_bits()));}
 fn finish_static(&mut self,values:&Attributes){self.finish=Some(*values);}
}
fn encode(values:&Attributes)->String{format!("[{}]",values.iter().map(|x|format!("\"{:016x}\"",x.to_bits())).collect::<Vec<_>>().join(","))}
fn main()->io::Result<()>{assert_eq!(config::ATTRIBUTE_NAMES.len(),ATTRIBUTE_COUNT);assert_eq!(config::GROUP_NAMES.len(),GROUP_COUNT);let stdin=io::stdin();let mut out=io::BufWriter::new(io::stdout().lock());for line in stdin.lock().lines(){let line=line?;let mut words=line.split_whitespace();let trace=words.next().unwrap()=="1";let mut groups:[Vec<Attributes>;GROUP_COUNT]=std::array::from_fn(|_|vec![]);
 for group in &mut groups{let count=words.next().unwrap().parse::<usize>().unwrap();for _ in 0..count{let mut row=[0.0;ATTRIBUTE_COUNT];let entries=words.next().unwrap().parse::<usize>().unwrap();for _ in 0..entries{let index=words.next().unwrap().parse::<usize>().unwrap();let value=u64::from_str_radix(words.next().unwrap(),16).unwrap();row[index]=f64::from_bits(value);}group.push(row);}}
 assert!(words.next().is_none());let contributions=Contributions{groups:std::array::from_fn(|i|groups[i].as_slice())};let mut observer=Trace::default();let values=if trace{config::calculate_attributes_with(&contributions,&mut observer)}else{config::calculate_attributes(&contributions)};
 writeln!(out,"{{\"values\":{},\"formulas\":[{}],\"finished\":{}}}",encode(&values),observer.records.join(","),observer.finish.as_ref().map(encode).unwrap_or_else(||"null".into()))?;
 }out.flush()}
