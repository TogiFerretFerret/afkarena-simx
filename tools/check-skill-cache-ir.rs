#[path="native-skill-cache-ir.rs"] mod skill_cache_ir;
use std::io::{self, BufRead};
fn main() {
    let mut cache = skill_cache_ir::Cache::new();
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let tokens: Vec<String> = if line == "~" { Vec::new() } else { line.split(',').map(|word| {
            let words: Vec<u16> = word.as_bytes().chunks(4).map(|chunk| u16::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap()).collect();
            String::from_utf16(&words).unwrap_or_else(|_| "\u{fffd}".to_string())
        }).collect() };
        if let Some(ir) = cache.lookup(&tokens) {
            println!("{{\"modes\":{:?},\"ranges\":[{}]}}", ir.modes,
                ir.ranges.iter().map(|r| format!("[{},{},{}]", r.mode_token, r.lower, r.upper)).collect::<Vec<_>>().join(","));
        } else { println!("null"); }
    }
    eprintln!("{{\"cacheHits\":{},\"cacheMisses\":{}}}",cache.hits,cache.misses);
}
