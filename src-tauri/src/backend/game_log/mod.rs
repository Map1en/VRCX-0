mod deps;
mod ingest;
mod instance_media;
mod lifecycle;
mod runtime_state;
mod screenshot;
mod service;
mod video;

pub(crate) use deps::BackendDeps;
pub use service::GameLogBackend;
