use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application::{add_remote_favorite, FavoriteRemoteAddInput, FavoriteRemoteMutationDeps};
use vrcx_0_application_core::vrchat_api::{self};
use vrcx_0_persistence::{
    favorites::{self as persistence_favorites, FavoriteRow as PersistenceFavoriteRow},
    social_aggregates,
};

use crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY;
use crate::server::VrcxMcpServer;

use super::common::{
    map_persistence_error, require_current_user_id, social_aggregates_result, structured_result,
};

#[tool_router(router = favorites_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[write·local] Add or remove a VRCX-0 LOCAL favorite for a world, friend, or avatar — local label only, no VRChat account change, no message to anyone; dry_run defaults to true. Use get_favorites to check duplicates first."
    )]
    async fn favorite_local(
        &self,
        Parameters(input): Parameters<FavoriteLocalParams>,
    ) -> Result<CallToolResult, String> {
        let dry_run = input.dry_run.unwrap_or(true);
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let result = social_aggregates::favorite_local(
            self.runtime.db.as_ref(),
            &owner_user_id,
            social_aggregates::FavoriteLocalInput {
                kind: input.kind,
                entity_id: input.entity_id,
                group: input.group,
                action: input.action.unwrap_or_else(|| "add".into()),
                dry_run,
            },
        );
        if !dry_run {
            if let Ok(output) = &result {
                self.runtime
                    .realtime_runtime
                    .notify_favorites_changed(&output.kind, true, false);
            }
        }
        social_aggregates_result(result)
    }

    #[tool(
        description = "[write·account] Add a world, friend, or avatar favorite to the signed-in VRChat ACCOUNT (tags like worlds1, group_0, or avatars1 required). Changes the real account; subject to group capacity limits; gated by a setting and dry_run defaults to true. Confirm before a real write. Never invites or messages anyone."
    )]
    async fn favorite_vrchat(
        &self,
        Parameters(input): Parameters<FavoriteVrchatParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.favorite_vrchat_output(input).await?)
    }

    #[tool(
        description = "[L1·query] List VRCX-0 local favorites. Omit kind or use all to list worlds, friends, and avatars; otherwise filter by world, friend, or avatar. Use before a favorite write to check duplicates."
    )]
    async fn get_favorites(
        &self,
        Parameters(input): Parameters<GetFavoritesParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_favorites_output(input)?)
    }
}

impl VrcxMcpServer {
    fn get_favorites_output(&self, input: GetFavoritesParams) -> Result<FavoritesOutput, String> {
        let requested_kind = parse_favorite_list_kind(input.kind.as_deref())?;
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let mut rows = Vec::new();
        for kind in requested_kind.canonical_kinds() {
            let values = persistence_favorites::favorite_list(
                self.runtime.db.as_ref(),
                Some(&owner_user_id),
                (*kind).into(),
            )
            .map_err(map_persistence_error)?;
            rows.extend(
                values
                    .iter()
                    .filter_map(|row| favorite_row_from_value(kind, row)),
            );
        }
        let summary = favorites_summary(requested_kind, rows.len());
        Ok(FavoritesOutput {
            rows,
            summary,
            caveats: vec![
                "Favorites are VRCX-0 local favorite rows and may differ from remote VRChat favorites until synced."
                    .into(),
            ],
        })
    }
    async fn favorite_vrchat_output(
        &self,
        input: FavoriteVrchatParams,
    ) -> Result<FavoriteVrchatOutput, String> {
        let kind = normalize_favorite_kind(&input.kind)?;
        let entity_id = input.entity_id.trim().to_string();
        let tags = input.tags.trim().to_string();
        if entity_id.is_empty() {
            return Err("favorite_vrchat requires entityId".into());
        }
        validate_favorite_entity_id(&kind, &entity_id)?;
        if tags.is_empty() {
            return Err(
                "favorite_vrchat requires tags such as worlds1, group_0, or avatars1".into(),
            );
        }
        let requested_write = !input.dry_run.unwrap_or(true);
        let writes_allowed = self
            .runtime
            .config
            .get_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)
            .unwrap_or(false);
        if !requested_write || !writes_allowed {
            return Ok(FavoriteVrchatOutput {
                kind,
                entity_id,
                tags,
                dry_run: true,
                status: None,
                response: None,
                caveats: vrchat_favorite_caveats(requested_write && !writes_allowed),
            });
        }

        let response = add_remote_favorite(
            &FavoriteRemoteMutationDeps {
                db: self.runtime.db.as_ref(),
                web: self.runtime.web.as_ref(),
                diagnostics: &self.runtime.diagnostics,
                sync: &self.runtime.sync,
                realtime: &self.runtime.realtime_runtime,
            },
            FavoriteRemoteAddInput {
                endpoint: self.runtime.current_endpoint(),
                kind: kind.clone(),
                entity_id: entity_id.clone(),
                tags: tags.clone(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(finish_remote_favorite_write(
            kind, entity_id, tags, response,
        ))
    }
}

fn finish_remote_favorite_write(
    kind: String,
    entity_id: String,
    tags: String,
    response: vrchat_api::VrchatApiResponse,
) -> FavoriteVrchatOutput {
    let status = response.status;
    let policy = vrchat_api::classify_api_response(status);
    FavoriteVrchatOutput {
        kind,
        entity_id,
        tags,
        dry_run: false,
        status: Some(status),
        response: Some(serde_json::json!({
            "status": status,
            "data": response.data,
            "policy": policy,
        })),
        caveats: vrchat_favorite_caveats(false),
    }
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FavoriteLocalParams {
    kind: String,
    entity_id: String,
    group: String,
    action: Option<String>,
    dry_run: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FavoriteVrchatParams {
    kind: String,
    entity_id: String,
    tags: String,
    dry_run: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct GetFavoritesParams {
    /// Filter by one favorite kind. Omit or use `all` to return every kind.
    #[serde(default)]
    #[schemars(with = "Option<FavoriteListKind>")]
    kind: Option<String>,
}

#[derive(Clone, Copy, Debug, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum FavoriteListKind {
    All,
    World,
    Friend,
    Avatar,
}

impl FavoriteListKind {
    fn canonical_kinds(self) -> &'static [&'static str] {
        match self {
            Self::All => &["world", "friend", "avatar"],
            Self::World => &["world"],
            Self::Friend => &["friend"],
            Self::Avatar => &["avatar"],
        }
    }

    fn summary_scope(self) -> &'static str {
        match self {
            Self::All => " across worlds, friends, and avatars",
            Self::World => " for worlds",
            Self::Friend => " for friends",
            Self::Avatar => " for avatars",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoritesOutput {
    rows: Vec<FavoriteRow>,
    summary: String,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteRow {
    kind: String,
    entity_id: String,
    group: String,
    created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteVrchatOutput {
    kind: String,
    entity_id: String,
    tags: String,
    dry_run: bool,
    status: Option<i32>,
    response: Option<Value>,
    caveats: Vec<String>,
}
fn normalize_favorite_kind(kind: &str) -> Result<String, String> {
    // The tool description lists "worlds, friends, or avatars", so models often
    // pass the plural (and sometimes "user(s)" for friends). Accept those and
    // map them to the canonical singular form.
    let lowered = kind.trim().to_ascii_lowercase();
    let canonical = match lowered.strip_suffix('s').unwrap_or(&lowered) {
        "world" => "world",
        "friend" | "user" => "friend",
        "avatar" => "avatar",
        _ => return Err("favorite kind must be world, friend, or avatar".into()),
    };
    Ok(canonical.to_string())
}

fn parse_favorite_list_kind(kind: Option<&str>) -> Result<FavoriteListKind, String> {
    let Some(kind) = kind else {
        return Ok(FavoriteListKind::All);
    };
    let lowered = kind.trim().to_ascii_lowercase();
    if matches!(lowered.as_str(), "all" | "favorite" | "favorites") {
        return Ok(FavoriteListKind::All);
    }
    let canonical = normalize_favorite_kind(&lowered).map_err(|_| {
        "invalid argument `kind`: expected all, world, friend, or avatar".to_string()
    })?;
    Ok(match canonical.as_str() {
        "world" => FavoriteListKind::World,
        "friend" => FavoriteListKind::Friend,
        "avatar" => FavoriteListKind::Avatar,
        _ => unreachable!("normalize_favorite_kind returns a canonical favorite kind"),
    })
}

fn validate_favorite_entity_id(kind: &str, entity_id: &str) -> Result<(), String> {
    let metadata =
        favorite_kind_metadata(kind).ok_or("favorite kind must be world, friend, or avatar")?;
    if entity_id.starts_with(metadata.entity_id_prefix) {
        Ok(())
    } else {
        Err(format!(
            "favorite_vrchat {kind} entityId must start with {}",
            metadata.entity_id_prefix
        ))
    }
}

fn favorite_row_from_value(kind: &str, row: &PersistenceFavoriteRow) -> Option<FavoriteRow> {
    favorite_kind_metadata(kind)?;
    let entity_id = row.entity_id().to_string();
    if entity_id.is_empty() {
        return None;
    }
    Some(FavoriteRow {
        kind: kind.to_string(),
        entity_id,
        group: row.group_name.clone(),
        created_at: row.created_at.clone(),
    })
}

fn favorites_summary(kind: FavoriteListKind, count: usize) -> String {
    let noun = if count == 1 { "favorite" } else { "favorites" };
    format!("Found {count} VRCX-0 local {noun}{}.", kind.summary_scope())
}

struct FavoriteKindMetadata {
    entity_id_prefix: &'static str,
}

fn favorite_kind_metadata(kind: &str) -> Option<FavoriteKindMetadata> {
    match kind {
        "world" => Some(FavoriteKindMetadata {
            entity_id_prefix: "wrld_",
        }),
        "friend" => Some(FavoriteKindMetadata {
            entity_id_prefix: "usr_",
        }),
        "avatar" => Some(FavoriteKindMetadata {
            entity_id_prefix: "avtr_",
        }),
        _ => None,
    }
}
fn vrchat_favorite_caveats(blocked_by_setting: bool) -> Vec<String> {
    let mut caveats = vec![
        "This writes to the signed-in VRChat account only when dry_run is false.".into(),
        "VRChat favorite groups have capacity limits and API failures are returned as-is.".into(),
    ];
    if blocked_by_setting {
        caveats.push(
            "A real write was requested but VRChat writes are disabled; enable them in VRCX-0 settings first."
                .into(),
        );
    }
    caveats
}
#[cfg(test)]
mod favorite_kind_tests {
    use super::*;

    #[test]
    fn accepts_singular_plural_and_user_synonym() {
        for input in ["world", "worlds", "World"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "world");
        }
        for input in ["friend", "friends", "user", "users"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "friend");
        }
        for input in ["avatar", "avatars"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "avatar");
        }
    }

    #[test]
    fn rejects_unknown_kind() {
        assert!(normalize_favorite_kind("group").is_err());
        assert!(normalize_favorite_kind("").is_err());
    }

    #[test]
    fn favorite_list_kind_defaults_to_all_and_accepts_plural_aliases() {
        let missing: GetFavoritesParams = serde_json::from_str("{}").unwrap();
        let missing_kind = parse_favorite_list_kind(missing.kind.as_deref()).unwrap();
        assert!(matches!(missing_kind, FavoriteListKind::All));
        assert_eq!(
            missing_kind.canonical_kinds(),
            &["world", "friend", "avatar"]
        );

        for (input, expected) in [
            (r#"{"kind":"worlds"}"#, FavoriteListKind::World),
            (r#"{"kind":"users"}"#, FavoriteListKind::Friend),
            (r#"{"kind":"avatars"}"#, FavoriteListKind::Avatar),
            (r#"{"kind":"ALL"}"#, FavoriteListKind::All),
        ] {
            let parsed: GetFavoritesParams = serde_json::from_str(input).unwrap();
            let parsed_kind = parse_favorite_list_kind(parsed.kind.as_deref()).unwrap();
            assert_eq!(parsed_kind.canonical_kinds(), expected.canonical_kinds());
        }
    }

    #[test]
    fn favorite_list_kind_rejects_unknown_values_as_invalid_arguments() {
        let parsed: GetFavoritesParams = serde_json::from_str(r#"{"kind":"group"}"#).unwrap();
        let error = parse_favorite_list_kind(parsed.kind.as_deref())
            .expect_err("unknown favorite kinds must not be accepted");

        assert!(error.contains("invalid argument"));
    }

    #[test]
    fn favorites_summary_echoes_the_requested_scope() {
        assert_eq!(
            favorites_summary(FavoriteListKind::All, 3),
            "Found 3 VRCX-0 local favorites across worlds, friends, and avatars."
        );
        assert_eq!(
            favorites_summary(FavoriteListKind::Friend, 1),
            "Found 1 VRCX-0 local favorite for friends."
        );
    }

    #[test]
    fn remote_write_output_classifies_http_status() {
        for (status, expected_ok) in [
            (200, true),
            (204, true),
            (302, false),
            (401, false),
            (429, false),
            (500, false),
        ] {
            let output = finish_remote_favorite_write(
                "world".into(),
                "wrld_test".into(),
                "worlds1".into(),
                vrchat_api::VrchatApiResponse {
                    status,
                    data: "{}".into(),
                },
            );

            assert_eq!(output.status, Some(status));
            let response = output.response.as_ref().unwrap();
            assert_eq!(response["status"], status);
            assert_eq!(
                response["policy"]["class"] == "ok",
                expected_ok,
                "status {status}"
            );
        }
    }
}
