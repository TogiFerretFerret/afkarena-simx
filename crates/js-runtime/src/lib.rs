//! Source-derived JavaScript execution support in Rust, without a JS VM.
pub mod value;
pub mod heap;
pub mod runtime;
pub mod env;
pub mod closures;
pub use value::{Value,StringId,ObjectId,FunctionId,JsError,JsResult};
pub use heap::{PropertyKey,KeyInput,Descriptor,PropertyKind,ObjectKind,ForInIterator};
pub use env::{EnvId,BindingRef};
pub use runtime::{Runtime,Completion};
