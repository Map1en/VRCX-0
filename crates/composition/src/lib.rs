mod composition;
mod context;
mod error;
mod group_order;
mod profile;
mod state;

pub use composition::{RuntimeHostComposition, RuntimeHostProfileExtension};
pub(crate) use context::RuntimeHostContext;
pub use context::RuntimeHostDesktopAssemblyDeps;
pub use error::{Error, Result};
pub use group_order::{GroupOrderSource, UnavailableGroupOrderSource};
pub use profile::RuntimeHostProfile;
pub use state::{
    BackendRuntimeCombinedSnapshot, CliLoginPrompt, CliTwoFactorChoice, RuntimeHostOptions,
    RuntimeHostState, RuntimeHostStateBuilder,
};
