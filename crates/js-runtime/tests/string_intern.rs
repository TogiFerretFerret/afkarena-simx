use js_runtime::{Runtime,Value};

#[test]
fn canonical_ids_survive_both_entry_orders_and_caller_buffer_reuse(){
    let mut rt=Runtime::new();
    for text in ["","a","\0","a\0b","ASCII_name","é","💩","a💩é\0z","abcdefghijklmnopqrstuvwx","abcdefghijklmnopqrstuvwxy"] {
        let units=text.encode_utf16().collect::<Vec<_>>();
        let from_units=rt.string_utf16(&units);let id=rt.intern(text);
        assert_eq!(from_units,Value::String(id));assert_eq!(rt.string_units(id),units);
        let mut owned=text.to_owned();assert_eq!(rt.intern(&owned),id);
        owned.clear();owned.push_str("different buffer bytes");
        let different=rt.intern(&owned);assert_ne!(different,id);
        assert_eq!(rt.intern(text),id);
    }
    let lone=rt.string_utf16(&[0xd800]);let replacement=rt.string("�");
    assert_ne!(lone,replacement);
    let surrogate_pair=rt.string_utf16(&[0xd83d,0xdca9]);
    assert_eq!(surrogate_pair,rt.string("💩"));
}

#[test]
fn collisions_dynamic_names_and_properties_preserve_exact_utf16(){
    let mut rt=Runtime::new();let object=rt.object();
    // Interior bytes vary while length/first/middle/last slot hint stays fixed.
    for n in 0..400u32 {
        let text=format!("a{n:04}xaaaaa");let id=rt.intern(&text);
        rt.define_data(object,id,Value::Number(n as f64),true,true,true).unwrap();
    }
    for n in 0..400u32 {
        let text=format!("a{n:04}xaaaaa");let id=rt.intern(&text);
        assert_eq!(rt.string_units(id),text.encode_utf16().collect::<Vec<_>>());
        assert_eq!(rt.get(object,id).unwrap(),Value::Number(n as f64));
    }
    let keys=rt.own_keys(object,true).unwrap();assert_eq!(keys.len(),400);
    for (n,key)in keys.into_iter().enumerate(){assert_eq!(key,rt.string(&format!("a{n:04}xaaaaa")));}
}
