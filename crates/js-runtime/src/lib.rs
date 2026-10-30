//! Source-derived JavaScript execution support in Rust, without a JS VM.
pub mod value;
pub mod heap;
pub mod arguments_map;
pub mod property_slots;
pub mod id_hash;
pub mod runtime;
pub mod env;
pub mod closures;
mod lazy_arguments;
pub mod literal_pool;
pub mod iterators;
pub use iterators::IteratorRecord;
pub mod builtins;
pub mod math;
pub mod json;
pub mod regex;
pub mod date;
pub mod host;
pub mod errors;
pub mod binary;
pub mod collections;
pub mod reflection_bootstrap;
pub mod strings;
pub mod array_from;
pub mod diagnostics;
pub mod numeric_bootstrap;
pub use binary::{BufferId,TypedArrayKind};
pub use value::{Value,StringId,ObjectId,FunctionId,JsError,JsResult,BinaryOp,UnaryOp};
pub use heap::{PropertyKey,KeyInput,Descriptor,PropertyKind,ObjectKind,ForInIterator};
pub use env::{EnvId,BindingRef};
pub use runtime::{Runtime,Completion};

pub mod utf8_guard;
pub mod utf8_loader;
pub mod copy_obj;
pub mod override_dispatch;
pub mod class_dispatch;

pub mod reachability;

pub mod battle_gc;

// Generated guarded arithmetic uses the same pinned helpers as Runtime::binary.
pub use battle_core::js_math as numeric_arithmetic;

pub mod expose_scan;

pub mod string_hash;
pub use string_hash::StringHashMode;

pub mod index_keys;

pub mod dense_array_shift;

mod dynamic_slots;

mod stage_range_parser;
mod buff_attribute_loop;

pub mod stored_property;
mod battle_mode_limit;

#[cfg(test)]mod primary_numeric_access_tests;
