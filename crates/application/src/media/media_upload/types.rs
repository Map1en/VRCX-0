use vrcx_0_persistence::DatabaseService;

use vrcx_0_application_core::WebClient;

pub struct LegacyMediaUploadDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
}

pub struct LegacyEntityImageUploadInput {
    pub endpoint: String,
    pub entity_id: String,
    pub image_url: String,
    pub base64_file: String,
    pub file_size_in_bytes: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub enum LegacyEntityImageKind {
    Avatar,
    World,
}

impl LegacyEntityImageKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Avatar => "Avatar",
            Self::World => "World",
        }
    }
}
