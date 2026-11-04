use serde_json::Value;

use crate::Result;

pub trait ConfigStore: Send + Sync {
    fn get_raw(&self, key: &str) -> Result<Option<String>>;
    fn get_bool(&self, key: &str, default: bool) -> Result<bool>;
    fn get_string(&self, key: &str, default: &str) -> Result<String>;
    fn get_json(&self, key: &str, default: Value) -> Result<Value>;
    fn set_bool(&self, key: &str, value: bool) -> Result<()>;
    fn set_string(&self, key: &str, value: &str) -> Result<()>;
    fn set_json(&self, key: &str, value: &Value) -> Result<()>;
    fn remove(&self, key: &str) -> Result<()>;
    fn write_generation(&self) -> u64;
}
