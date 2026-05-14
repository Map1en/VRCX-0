mod repository;
mod schema;
mod types;

pub use repository::{get_bool, get_json, get_string, set_bool, ConfigRepository};
#[allow(unused_imports)]
pub use types::ConfigKey;
