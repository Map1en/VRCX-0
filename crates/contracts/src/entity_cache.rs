use compact_str::CompactString;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::ReleaseStatus;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntityInput {
    #[serde(default)]
    pub id: Value,
    #[serde(default)]
    pub author_id: Value,
    #[serde(default)]
    pub author_name: Value,
    #[serde(default)]
    pub created_at: Value,
    #[serde(default)]
    pub description: Value,
    #[serde(default)]
    pub image_url: Value,
    #[serde(default)]
    pub name: Value,
    #[serde(default)]
    pub release_status: Value,
    #[serde(default)]
    pub thumbnail_image_url: Value,
    #[serde(default)]
    pub updated_at: Value,
    #[serde(default)]
    pub version: Value,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCacheOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub description: String,
    pub image_url: String,
    pub name: String,
    #[specta(type = String)]
    pub release_status: ReleaseStatus,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    pub version: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    #[specta(type = String)]
    pub created_at: CompactString,
    pub description: String,
    pub image_url: String,
    pub name: String,
    #[specta(type = String)]
    pub release_status: ReleaseStatus,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    #[specta(type = String)]
    pub updated_at: CompactString,
    pub version: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadataOutput {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub avatar_name: Option<String>,
}

impl FileMetadataOutput {
    pub fn new(id: String, name: String, owner_id: String) -> Self {
        let avatar_name = vrcx_0_core::avatar::avatar_name_from_file_name(&name);
        Self {
            id,
            name,
            owner_id,
            avatar_name,
        }
    }

    pub fn from_vrchat_file(value: &Value) -> Option<Self> {
        let id = value.trimmed_text("id");
        if !id.starts_with("file_") {
            return None;
        }
        Some(Self::new(
            id,
            value.trimmed_text("name"),
            value.trimmed_text("ownerId"),
        ))
    }
}

#[cfg(test)]
mod file_metadata_tests {
    use serde_json::json;

    use super::FileMetadataOutput;

    #[test]
    fn parses_avatar_image_files_and_derives_the_avatar_name() {
        let file = FileMetadataOutput::from_vrchat_file(&json!({
            "id": "file_1234abcd-0000-1111-2222-abcdefabcdef",
            "name": "Avatar - Rurune_春 - Image - 2022․3․22f1_1_standalonewindows_Release",
            "ownerId": "usr_author",
            "versions": [{ "created_at": "2024-01-01T00:00:00.000Z" }]
        }))
        .unwrap();

        assert_eq!(file.avatar_name.as_deref(), Some("Rurune_春"));
        assert_eq!(file.owner_id, "usr_author");
    }

    #[test]
    fn custom_icons_are_not_avatar_images() {
        let file = FileMetadataOutput::from_vrchat_file(&json!({
            "id": "file_1234abcd-0000-1111-2222-abcdefabcdef",
            "name": "file_1234abcd-0000-1111-2222-abcdefabcdef_camera_user_icon",
            "ownerId": "usr_self"
        }))
        .unwrap();

        assert_eq!(file.avatar_name, None);
    }

    #[test]
    fn rejects_payloads_without_a_file_id() {
        assert!(FileMetadataOutput::from_vrchat_file(&json!({ "name": "x" })).is_none());
        assert!(FileMetadataOutput::from_vrchat_file(&json!({ "id": "avtr_x" })).is_none());
    }
}
