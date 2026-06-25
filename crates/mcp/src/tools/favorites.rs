use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application::vrchat_api::{self, favorites::favorite_add_input, VrchatScope};
use vrcx_0_persistence::{favorites as persistence_favorites, social_aggregates};

use crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY;
use crate::server::VrcxMcpServer;

use super::common::{map_persistence_error, social_aggregates_result, structured_result};

#[tool_router(router = favorites_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "Add or remove a VRCX-0 local favorite for a world, friend, or avatar; dry_run defaults to true."
    )]
    async fn favorite_local(
        &self,
        Parameters(input): Parameters<FavoriteLocalParams>,
    ) -> Result<CallToolResult, String> {
        social_aggregates_result(social_aggregates::favorite_local(
            self.runtime.db.as_ref(),
            social_aggregates::FavoriteLocalInput {
                kind: input.kind,
                entity_id: input.entity_id,
                group: input.group,
                action: input.action.unwrap_or_else(|| "add".into()),
                dry_run: input.dry_run.unwrap_or(true),
            },
        ))
    }

    #[tool(
        description = "Add a world, friend, or avatar favorite to the signed-in VRChat account; dry_run defaults to true."
    )]
    async fn favorite_vrchat(
        &self,
        Parameters(input): Parameters<FavoriteVrchatParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.favorite_vrchat_output(input).await?)
    }

    #[tool(description = "List VRCX-0 local favorites for worlds, friends, or avatars.")]
    async fn get_favorites(
        &self,
        Parameters(input): Parameters<GetFavoritesParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_favorites_output(input)?)
    }
}

impl VrcxMcpServer {
    fn get_favorites_output(&self, input: GetFavoritesParams) -> Result<FavoritesOutput, String> {
        let kind = normalize_favorite_kind(&input.kind)?;
        let rows = persistence_favorites::favorite_list(self.runtime.db.as_ref(), kind.clone())
            .map_err(map_persistence_error)?
            .into_iter()
            .filter_map(|row| favorite_row_from_value(&kind, &row))
            .collect();
        Ok(FavoritesOutput {
            rows,
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

        let endpoint = self.runtime.current_endpoint();
        let (_, _, request) =
            favorite_add_input(endpoint, kind.clone(), entity_id.clone(), tags.clone())
                .map_err(|error| error.to_string())?;
        let response = vrchat_api::execute_api_command(
            self.runtime.web.as_ref(),
            self.runtime.db.as_ref(),
            &self.runtime.diagnostics,
            &self.runtime.sync,
            "mcp__favorite_vrchat",
            request,
            VrchatScope::Vrchat,
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(FavoriteVrchatOutput {
            kind,
            entity_id,
            tags,
            dry_run: false,
            status: Some(response.status),
            response: Some(response.raw),
            caveats: vrchat_favorite_caveats(false),
        })
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
    kind: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoritesOutput {
    rows: Vec<FavoriteRow>,
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

fn favorite_row_from_value(kind: &str, row: &Value) -> Option<FavoriteRow> {
    let metadata = favorite_kind_metadata(kind)?;
    let entity_id = row
        .get(metadata.entity_id_key)
        .and_then(Value::as_str)?
        .to_string();
    Some(FavoriteRow {
        kind: kind.to_string(),
        entity_id,
        group: row
            .get("groupName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        created_at: row
            .get("created_at")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

struct FavoriteKindMetadata {
    entity_id_key: &'static str,
    entity_id_prefix: &'static str,
}

fn favorite_kind_metadata(kind: &str) -> Option<FavoriteKindMetadata> {
    match kind {
        "world" => Some(FavoriteKindMetadata {
            entity_id_key: "worldId",
            entity_id_prefix: "wrld_",
        }),
        "friend" => Some(FavoriteKindMetadata {
            entity_id_key: "userId",
            entity_id_prefix: "usr_",
        }),
        "avatar" => Some(FavoriteKindMetadata {
            entity_id_key: "avatarId",
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
}
