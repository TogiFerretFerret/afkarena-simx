//! Source-derived JavaScript execution support in Rust, without a JS VM.
pub mod value;
pub mod heap;
pub mod runtime;
pub mod env;
pub mod closures;
pub mod iterators;
pub use iterators::IteratorRecord;
pub mod builtins;
pub mod math;
pub mod json;
pub mod regex;
pub mod date;
pub mod host;
pub use value::{Value,StringId,ObjectId,FunctionId,JsError,JsResult,BinaryOp,UnaryOp};
pub use heap::{PropertyKey,KeyInput,Descriptor,PropertyKind,ObjectKind,ForInIterator};
pub use env::{EnvId,BindingRef};
pub use runtime::{Runtime,Completion};
