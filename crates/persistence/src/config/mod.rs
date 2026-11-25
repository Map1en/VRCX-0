mod local;
mod obfuscation;
mod preserved;
mod repository;
mod schema;
mod types;

pub use local::{
    config_apply_mutations, config_list_values, config_remove_value, config_set_values,
};
pub use obfuscation::migrate_sensitive_config_obfuscation;
pub(crate) use preserved::{
    merge_preserved_config_into_restore, read_preserved_config, write_preserved_config,
};
pub use repository::{
    ensure_config_table, get_bool, get_json, get_raw, get_string, remove, set_bool, set_json,
    set_string, ConfigRepository,
};
pub use types::{resolve_config_key, ConfigKey, ConfigMutation, ConfigReadEntry, ConfigWriteEntry};
