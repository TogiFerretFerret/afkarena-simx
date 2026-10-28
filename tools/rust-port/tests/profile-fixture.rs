// Profiler control smoke fixture only. This does not simulate battles.
fn burn() {
    let mut value = 7u64;
    for _ in 0..100_000_000 {
        value = std::hint::black_box(value.wrapping_mul(6364136223846793005).wrapping_add(1));
    }
    std::hint::black_box(value);
}
fn main() {
    eprintln!("unit_start:0");
    burn();
    eprintln!("unit_finished:0");
    eprintln!("unit_start:6");
    burn();
    burn();
    eprintln!("unit_finished:6");
    println!("{{\"profileFixture\":true}}");
}
