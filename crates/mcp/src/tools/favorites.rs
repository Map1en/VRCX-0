use std::collections::BTreeMap;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application::favorites::FavoriteRemoteAddInput;
use vrcx_0_application_core::FavoriteEntityKind;
use vrcx_0_contracts::social_aggregates::{self, FavoriteAction};
use vrcx_0_contracts::vrchat_api;
use vrcx_0_contracts::FavoriteRow as PersistenceFavoriteRow;

use crate::server::VrcxMcpServer;

use super::common::{map_application_query_error, require_current_user_id, structured_result};

#[tool_router(router = favorites_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[write·local] Add or remove a VRCX-0 LOCAL favorite for a world, friend, or avatar — local label only, no VRChat account change, no message to anyone; dry_run defaults to true. Use get_favorites to check duplicates first."
    )]
    async fn favorite_local(
        &self,
        Parameters(input): Parameters<FavoriteLocalParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.favorite_local_output(input)?)
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
        description = "[L1·query] List VRCX-0 local favorites, newest first, with per-group counts for every favorite. Omit kind or use all to list worlds, friends, and avatars; otherwise filter by world, friend, or avatar. Before a favorite write, pass entityId to check that exact entity for duplicates."
    )]
    async fn get_favorites(
        &self,
        Parameters(input): Parameters<GetFavoritesParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_favorites_output(input)?)
    }
}

impl VrcxMcpServer {
    fn favorite_local_output(
        &self,
        input: FavoriteLocalParams,
    ) -> Result<social_aggregates::FavoriteOutput, String> {
        self.runtime
            .favorite_mutations
            .mutate_local(
                "MCP local favorite mutation",
                social_aggregates::FavoriteLocalInput {
                    kind: normalize_favorite_kind(&input.kind)?,
                    entity_id: input.entity_id,
                    group: input.group,
                    action: parse_favorite_action(input.action.as_deref())?,
                    dry_run: input.dry_run.unwrap_or(true),
                },
            )
            .map_err(map_favorite_local_error)
    }

    fn get_favorites_output(&self, input: GetFavoritesParams) -> Result<FavoritesOutput, String> {
        let requested_kind = parse_favorite_list_kind(input.kind.as_deref())?;
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let entity_id = input
            .entity_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let mut rows = Vec::new();
        for kind in requested_kind.canonical_kinds() {
            let values = self
                .runtime
                .favorites_queries
                .favorite_list(&owner_user_id, *kind)
                .map_err(map_application_query_error)?;
            rows.extend(
                values
                    .iter()
                    .filter_map(|row| favorite_row_from_value(*kind, row))
                    .filter(|row| entity_id.is_none_or(|entity_id| row.entity_id == entity_id)),
            );
        }
        let total_rows = rows.len();
        let mut group_counts = BTreeMap::<(String, String), usize>::new();
        for row in &rows {
            *group_counts
                .entry((row.kind.clone(), row.group.clone()))
                .or_default() += 1;
        }
        rows.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        rows.truncate(input.limit.unwrap_or(50).clamp(1, 500) as usize);
        let truncated = rows.len() < total_rows;
        let mut summary = favorites_summary(requested_kind, total_rows);
        if requested_kind.canonical_kinds().len() > 1 {
            let by_kind = requested_kind
                .canonical_kinds()
                .iter()
                .map(|kind| {
                    let count = group_counts
                        .iter()
                        .filter(|((row_kind, _), _)| row_kind == kind.as_str())
                        .map(|(_, count)| count)
                        .sum::<usize>();
                    format!("{} {count}", kind.as_str())
                })
                .collect::<Vec<_>>()
                .join(", ");
            summary.push_str(&format!(" By kind: {by_kind}."));
        }
        if truncated {
            summary.push_str(&format!(
                " Showing the {} newest; groups counts every favorite.",
                rows.len()
            ));
        }
        Ok(FavoritesOutput {
            rows,
            groups: group_counts
                .into_iter()
                .map(|((kind, group), count)| FavoriteGroupCount { kind, group, count })
                .collect(),
            total_rows,
            truncated,
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
        validate_favorite_entity_id(kind, &entity_id)?;
        if tags.is_empty() {
            return Err(
                "favorite_vrchat requires tags such as worlds1, group_0, or avatars1".into(),
            );
        }
        let requested_write = !input.dry_run.unwrap_or(true);
        let writes_allowed = self.runtime.vrchat_writes_allowed();
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

        let response = self
            .runtime
            .favorite_mutations
            .add_remote(
                "MCP remote favorite mutation",
                FavoriteRemoteAddInput {
                    kind: kind.into(),
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

fn map_favorite_local_error(error: vrcx_0_application_core::Error) -> String {
    match error {
        vrcx_0_application_core::Error::PersistenceInvalidData(message) => message,
        error @ (vrcx_0_application_core::Error::Database(_)
        | vrcx_0_application_core::Error::Sqlite { .. }
        | vrcx_0_application_core::Error::Io(_)
        | vrcx_0_application_core::Error::Json(_)) => {
            tracing::warn!("MCP social query failed: {error}");
            "internal data error while reading local VRCX-0 data".into()
        }
        error => error.to_string(),
    }
}

fn finish_remote_favorite_write(
    kind: FavoriteEntityKind,
    entity_id: String,
    tags: String,
    response: vrchat_api::VrchatResponse,
) -> FavoriteVrchatOutput {
    let status = response.status;
    let policy = vrchat_api::classify_vrchat_response(status);
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
    /// Only this world, friend, or avatar id (wrld_/usr_/avtr_), e.g. to check
    /// for a duplicate before a write.
    entity_id: Option<String>,
    /// Newest favorites to list (default 50, max 500); groups always counts all.
    limit: Option<i64>,
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
    fn canonical_kinds(self) -> &'static [FavoriteEntityKind] {
        match self {
            Self::All => &[
                FavoriteEntityKind::World,
                FavoriteEntityKind::Friend,
                FavoriteEntityKind::Avatar,
            ],
            Self::World => &[FavoriteEntityKind::World],
            Self::Friend => &[FavoriteEntityKind::Friend],
            Self::Avatar => &[FavoriteEntityKind::Avatar],
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
    groups: Vec<FavoriteGroupCount>,
    total_rows: usize,
    truncated: bool,
    summary: String,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteGroupCount {
    kind: String,
    group: String,
    count: usize,
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
    kind: FavoriteEntityKind,
    entity_id: String,
    tags: String,
    dry_run: bool,
    status: Option<i32>,
    response: Option<Value>,
    caveats: Vec<String>,
}
fn normalize_favorite_kind(kind: &str) -> Result<FavoriteEntityKind, String> {
    // The tool description lists "worlds, friends, or avatars", so models often
    // pass the plural (and sometimes "user(s)" for friends). Accept those and
    // map them to the canonical singular form.
    let lowered = kind.trim().to_ascii_lowercase();
    let canonical = match lowered.strip_suffix('s').unwrap_or(&lowered) {
        "world" => FavoriteEntityKind::World,
        "friend" | "user" => FavoriteEntityKind::Friend,
        "avatar" => FavoriteEntityKind::Avatar,
        _ => return Err("favorite kind must be world, friend, or avatar".into()),
    };
    Ok(canonical)
}

fn parse_favorite_action(action: Option<&str>) -> Result<FavoriteAction, String> {
    match action.unwrap_or("add").trim().to_ascii_lowercase().as_str() {
        "add" => Ok(FavoriteAction::Add),
        "remove" => Ok(FavoriteAction::Remove),
        _ => Err("favorite action must be add or remove".into()),
    }
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
    Ok(match canonical {
        FavoriteEntityKind::World => FavoriteListKind::World,
        FavoriteEntityKind::Friend => FavoriteListKind::Friend,
        FavoriteEntityKind::Avatar => FavoriteListKind::Avatar,
    })
}

fn validate_favorite_entity_id(kind: FavoriteEntityKind, entity_id: &str) -> Result<(), String> {
    if entity_id.starts_with(kind.entity_id_prefix()) {
        Ok(())
    } else {
        Err(format!(
            "favorite_vrchat {} entityId must start with {}",
            kind.as_str(),
            kind.entity_id_prefix()
        ))
    }
}

fn favorite_row_from_value(
    kind: FavoriteEntityKind,
    row: &PersistenceFavoriteRow,
) -> Option<FavoriteRow> {
    let entity_id = row.entity_id().to_string();
    if entity_id.is_empty() {
        return None;
    }
    Some(FavoriteRow {
        kind: kind.as_str().to_string(),
        entity_id,
        group: row.group_name.clone(),
        created_at: row.created_at.clone(),
    })
}

fn favorites_summary(kind: FavoriteListKind, count: usize) -> String {
    let noun = if count == 1 { "favorite" } else { "favorites" };
    format!("Found {count} VRCX-0 local {noun}{}.", kind.summary_scope())
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
    use vrcx_0_core::OwnerId;

    use super::*;

    #[test]
    fn local_tool_adapter_preserves_dry_run_and_real_write_semantics() {
        let (_dir, runtime, event_bus) =
            crate::test_support::test_runtime_with_event_bus("favorites-local", "usr_self")
                .expect("test runtime");
        let favorites_queries = std::sync::Arc::clone(&runtime.favorites_queries);
        let server = VrcxMcpServer::new(runtime);

        let dry_run = server
            .favorite_local_output(FavoriteLocalParams {
                kind: "friend".into(),
                entity_id: "usr_friend".into(),
                group: "Close".into(),
                action: Some("add".into()),
                dry_run: None,
            })
            .unwrap();
        assert!(dry_run.dry_run);
        assert_eq!(dry_run.affected_rows, 0);
        assert!(favorites_queries
            .favorite_list(&OwnerId::new("usr_self"), FavoriteEntityKind::Friend)
            .unwrap()
            .is_empty());
        assert!(event_bus.take_events_for_test().is_empty());

        let written = server
            .favorite_local_output(FavoriteLocalParams {
                kind: "friend".into(),
                entity_id: "usr_friend".into(),
                group: "Close".into(),
                action: Some("add".into()),
                dry_run: Some(false),
            })
            .unwrap();
        assert!(!written.dry_run);
        assert_eq!(written.affected_rows, 1);
        assert_eq!(
            favorites_queries
                .favorite_list(&OwnerId::new("usr_self"), FavoriteEntityKind::Friend)
                .unwrap()
                .len(),
            1
        );
        let events = event_bus.take_events_for_test();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "favoritesChanged");
        assert_eq!(events[0].payload["local"], true);
        assert_eq!(events[0].payload["remote"], false);
        assert_eq!(events[0].payload["requiresRefresh"], true);
    }

    #[test]
    fn accepts_singular_plural_and_user_synonym() {
        for input in ["world", "worlds", "World"] {
            assert_eq!(
                normalize_favorite_kind(input).unwrap(),
                FavoriteEntityKind::World
            );
        }
        for input in ["friend", "friends", "user", "users"] {
            assert_eq!(
                normalize_favorite_kind(input).unwrap(),
                FavoriteEntityKind::Friend
            );
        }
        for input in ["avatar", "avatars"] {
            assert_eq!(
                normalize_favorite_kind(input).unwrap(),
                FavoriteEntityKind::Avatar
            );
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
            &[
                FavoriteEntityKind::World,
                FavoriteEntityKind::Friend,
                FavoriteEntityKind::Avatar,
            ]
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
                FavoriteEntityKind::World,
                "wrld_test".into(),
                "worlds1".into(),
                vrchat_api::VrchatResponse {
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
