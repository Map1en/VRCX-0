use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayFooter {
    pub left: String,
    pub center: String,
    pub right: String,
}
