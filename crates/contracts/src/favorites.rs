use serde::{Deserialize, Serialize};
use vrcx_0_core::FavoriteEntityKind;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum VrchatFavoriteType {
    Avatar,
    World,
    VrcPlusWorld,
    Friend,
}

impl VrchatFavoriteType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::World => "world",
            Self::VrcPlusWorld => "vrcPlusWorld",
            Self::Friend => "friend",
        }
    }

    pub fn from_remote_type(value: &str) -> Option<Self> {
        match value.trim() {
            "avatar" => Some(Self::Avatar),
            "world" => Some(Self::World),
            "vrcPlusWorld" => Some(Self::VrcPlusWorld),
            "friend" => Some(Self::Friend),
            _ => None,
        }
    }
}

impl From<FavoriteEntityKind> for VrchatFavoriteType {
    fn from(value: FavoriteEntityKind) -> Self {
        match value {
            FavoriteEntityKind::Avatar => Self::Avatar,
            FavoriteEntityKind::World => Self::World,
            FavoriteEntityKind::Friend => Self::Friend,
        }
    }
}

impl From<VrchatFavoriteType> for FavoriteEntityKind {
    fn from(value: VrchatFavoriteType) -> Self {
        match value {
            VrchatFavoriteType::Avatar => Self::Avatar,
            VrchatFavoriteType::World | VrchatFavoriteType::VrcPlusWorld => Self::World,
            VrchatFavoriteType::Friend => Self::Friend,
        }
    }
}

impl From<VrchatFavoriteType> for vrcx_0_core::FavoriteChangeScope {
    fn from(value: VrchatFavoriteType) -> Self {
        FavoriteEntityKind::from(value).into()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteGroup {
    pub id: i64,
    pub kind: FavoriteEntityKind,
    pub name: String,
    pub shared: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRow {
    pub created_at: String,
    pub group_id: i64,
    pub group_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
}

impl FavoriteRow {
    pub fn new(
        kind: FavoriteEntityKind,
        created_at: String,
        entity_id: String,
        group_id: i64,
        group_name: String,
    ) -> Self {
        let mut row = Self {
            created_at,
            group_id,
            group_name,
            user_id: None,
            avatar_id: None,
            world_id: None,
        };
        match kind {
            FavoriteEntityKind::Friend => row.user_id = Some(entity_id),
            FavoriteEntityKind::Avatar => row.avatar_id = Some(entity_id),
            FavoriteEntityKind::World => row.world_id = Some(entity_id),
        }
        row
    }

    pub fn entity_id(&self) -> &str {
        self.user_id
            .as_deref()
            .or(self.avatar_id.as_deref())
            .or(self.world_id.as_deref())
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupCollection {
    pub id: String,
    pub name: String,
    pub group_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupFavoritesSnapshot {
    pub collections: Vec<SavedGroupCollection>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupCollectionCreateInput {
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupCollectionDeleteInput {
    pub collection_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupFavoriteAddInput {
    pub collection_id: String,
    pub group_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedGroupFavoriteRemoveInput {
    pub group_id: String,
}
