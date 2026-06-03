use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedKind {
    Friend,
    Invite,
    Instance,
    Profile,
    Group,
    System,
    Media,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedSeverity {
    Normal,
    Important,
    Warning,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedRelation {
    #[default]
    None,
    Friend,
    Favorite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedLine {
    pub time_text: String,
    pub kind: FeedKind,
    #[serde(default)]
    pub actor_text: String,
    pub detail: String,
    #[serde(default)]
    pub relation: FeedRelation,
    pub severity: FeedSeverity,
}
