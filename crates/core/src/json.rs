use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(transparent)]
pub struct RawJson(pub Value);

impl RawJson {
    pub fn as_value(&self) -> &Value {
        &self.0
    }

    pub fn into_value(self) -> Value {
        self.0
    }
}

impl From<Value> for RawJson {
    fn from(value: Value) -> Self {
        Self(value)
    }
}
