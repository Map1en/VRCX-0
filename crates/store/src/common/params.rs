use std::collections::HashMap;

pub type DbParams = HashMap<String, serde_json::Value>;

#[derive(Default)]
pub struct ParamsBuilder {
    params: DbParams,
}

impl ParamsBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(mut self, name: &str, value: impl Into<serde_json::Value>) -> Self {
        self.params.insert(param_name(name), value.into());
        self
    }

    pub fn build(self) -> DbParams {
        self.params
    }
}

fn param_name(name: &str) -> String {
    if name.starts_with('@') {
        name.to_string()
    } else {
        format!("@{name}")
    }
}
