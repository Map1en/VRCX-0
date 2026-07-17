use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{collapse_whitespace, interpolate, text, OverlayMessageKey};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMessage {
    key: OverlayMessageKey,
    params: BTreeMap<String, String>,
}

pub fn render_overlay_message(language: &str, message: &OverlayMessage) -> String {
    let template = text(language, message.key());
    collapse_whitespace(&interpolate(&template, message.params()))
}

impl OverlayMessage {
    pub fn key(&self) -> OverlayMessageKey {
        self.key
    }

    pub fn params(&self) -> &BTreeMap<String, String> {
        &self.params
    }

    pub(crate) fn new<const N: usize>(
        key: OverlayMessageKey,
        params: [(&'static str, String); N],
    ) -> Self {
        Self {
            key,
            params: params
                .into_iter()
                .map(|(name, value)| (name.to_string(), value))
                .collect(),
        }
    }
}
