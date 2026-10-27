#[path="../crates/battle-core/src/v8_tim_sort.rs"] mod v8_tim_sort;
use std::io::{self,BufRead};
fn main(){for line in io::stdin().lock().lines(){let line=line.unwrap();let mut words=line.split_whitespace();let mode:u32=words.next().unwrap().parse().unwrap();let mut rng:u32=words.next().unwrap().parse().unwrap();let throw_at:usize=words.next().unwrap().parse().unwrap();let token_mod:u32=words.next().unwrap().parse().unwrap();let values:Vec<f64>=words.map(|s|f64::from_bits(u64::from_str_radix(s,16).unwrap())).collect();let input:Vec<u32>=(0..values.len() as u32).map(|i|if token_mod==0{i}else{i%token_mod}).collect();let mut calls=Vec::new();let rank=|id:u32|{(if id%4==0{1000}else{0})+(if id%5==0{100}else{0})+(if id%7==0{10}else{0})};let result=v8_tim_sort::sort_tokens(&input,|a,b|{calls.push((a,b));if calls.len()==throw_at{return Err(throw_at)}let x=values[a as usize];let y=values[b as usize];Ok(match mode{
0=>x-y,1=>y-x,2=>-1.0,3=>1.0,4=>0.0,5=>f64::NAN,
6=>(rank(a)+(if x-y<0.0{1}else{-1})-rank(b)) as f64,
7=>{rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;0.5-(rng as f64/4294967296.0)},
8=>{if a%3==b%3{0.0}else if (a%3+1)%3==b%3{-1.0}else{1.0}},
9=>if calls.len()%2==0{-1.0}else{1.0},10=>if x<y{f64::NEG_INFINITY}else{f64::INFINITY},
11=>if calls.len()%3==0{f64::NAN}else{x-y},_=>panic!("mode")})});let (status,output)=match result{Ok(v)=>("ok".to_string(),v),Err(v8_tim_sort::SortError::Comparator(n))=>(format!("throw:{n}"),input)};println!("{{\"status\":\"{}\",\"output\":{:?},\"calls\":[{}],\"rng\":{}}}",status,output,calls.iter().map(|(a,b)|format!("[{a},{b}]")).collect::<Vec<_>>().join(","),rng);}}
