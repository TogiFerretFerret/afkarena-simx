use battle_core::numeric;
use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let words: Vec<_> = line.split_whitespace().collect();
        assert_eq!(words.len(), 4);
        let values: Vec<_> = words.iter().map(|s| {
            f64::from_bits(u64::from_str_radix(s, 16).expect("binary64 hex input"))
        }).collect();
        let a = [values[0], values[1]];
        let b = [values[2], values[3]];
        let mid = numeric::midpoint(a, b);
        let add = numeric::add(a, b);
        let subtract = numeric::subtract(a, b);
        let multiply = numeric::multiply_scalar(a, b[0]);
        let components = numeric::multiply_components(a, b);
        let outputs = [numeric::distance_squared(a, b), numeric::length_squared(a),
            numeric::dot(a, b), numeric::cross(a, b), mid[0], mid[1],
            add[0], add[1], subtract[0], subtract[1], multiply[0], multiply[1],
            components[0], components[1]];
        for (i, value) in outputs.iter().enumerate() {
            if i != 0 { write!(out, " ")?; }
            write!(out, "{:016x}", value.to_bits())?;
        }
        writeln!(out)?;
    }
    out.flush()
}
