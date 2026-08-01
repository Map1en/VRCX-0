use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::vrchat_api::favorites::{
    favorite_avatars_get_input, favorite_worlds_get_input,
};
use vrcx_0_application_core::vrchat_api::groups::user_groups_get_input;
use vrcx_0_application_core::vrchat_api::worlds::world_list_by_user_get_input;
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_persistence::memos::{memo_list_user_notes, memo_list_users};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{ApiJsonResponse, ApiScope, HttpApiRequestInput};

use crate::{get_my_avatars, Error, MyAvatarsDeps, MyAvatarsInput, Result};

const WORLD_PAGE_SIZE: i64 = 50;
const FAVORITE_PAGE_SIZE: i64 = 300;
const MAX_PAGES_PER_SOURCE: usize = 50;

#[derive(Clone)]
pub struct QuickSearchCatalogDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub auth_scope: RuntimeAuthScope,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchCatalogSnapshot {
    pub status: String,
    pub detail: String,
    pub own_avatars: Vec<Value>,
    pub favorite_avatars: Vec<Value>,
    pub own_worlds: Vec<Value>,
    pub favorite_worlds: Vec<Value>,
    pub groups: Vec<Value>,
    pub user_memos: Vec<Value>,
    pub user_notes: Vec<Value>,
}

struct QuickSearchRemoteCatalog {
    own_avatars: Vec<Value>,
    favorite_avatars: Vec<Value>,
    own_worlds: Vec<Value>,
    favorite_worlds: Vec<Value>,
    groups: Vec<Value>,
    failures: usize,
}

pub async fn load_quick_search_catalog(
    deps: QuickSearchCatalogDeps,
) -> Result<QuickSearchCatalogSnapshot> {
    let command = "app__quick_search_catalog_get";
    let scope = require_active_scope(&deps.auth_scope)?;
    deps.diagnostics
        .record_command(command, "running", "Loading quick search catalog.");

    let remote = load_quick_search_remote_catalog(&deps, &scope).await;

    let user_memos = memo_list_users(deps.db.as_ref())
        .map_err(Error::from)
        .and_then(serialize_rows);
    let user_notes = memo_list_user_notes(deps.db.as_ref(), scope.current_user_id.clone())
        .map_err(Error::from)
        .and_then(serialize_rows);
    ensure_scope_matches(&deps.auth_scope, &scope)?;

    let mut failures = remote.failures;
    let user_memos = rows_or_empty(user_memos, &mut failures);
    let user_notes = rows_or_empty(user_notes, &mut failures);
    let partial = failures > 0;
    let detail = if partial {
        format!("{failures} search source(s) failed to load.")
    } else {
        String::new()
    };
    deps.diagnostics.record_command(
        command,
        if partial { "partial" } else { "ok" },
        if partial {
            detail.clone()
        } else {
            "Quick search catalog loaded.".into()
        },
    );
    deps.sync.record(
        "quickSearch",
        if partial { "partial" } else { "ready" },
        if partial {
            detail.clone()
        } else {
            "Quick search catalog loaded.".into()
        },
        0,
    );

    Ok(QuickSearchCatalogSnapshot {
        status: if partial { "partial" } else { "ready" }.into(),
        detail,
        own_avatars: remote.own_avatars,
        favorite_avatars: remote.favorite_avatars,
        own_worlds: remote.own_worlds,
        favorite_worlds: remote.favorite_worlds,
        groups: remote.groups,
        user_memos,
        user_notes,
    })
}

async fn load_quick_search_remote_catalog(
    deps: &QuickSearchCatalogDeps,
    scope: &RuntimeAuthScopeSnapshot,
) -> QuickSearchRemoteCatalog {
    let my_avatars_deps = MyAvatarsDeps {
        db: deps.db.as_ref(),
        web: deps.web.as_ref(),
        auth_scope: &deps.auth_scope,
        expected_scope: scope.clone(),
    };
    let own_avatars = get_my_avatars(&my_avatars_deps, MyAvatarsInput::default());
    let own_worlds = collect_pages(
        deps,
        scope,
        QuickSearchRemoteSource::OwnWorlds,
        WORLD_PAGE_SIZE,
    );
    let favorite_avatars = collect_pages(
        deps,
        scope,
        QuickSearchRemoteSource::FavoriteAvatars,
        FAVORITE_PAGE_SIZE,
    );
    let favorite_worlds = collect_pages(
        deps,
        scope,
        QuickSearchRemoteSource::FavoriteWorlds,
        FAVORITE_PAGE_SIZE,
    );
    let groups = fetch_user_groups(deps, scope);
    let (own_avatars, own_worlds, favorite_avatars, favorite_worlds, groups) = tokio::join!(
        own_avatars,
        own_worlds,
        favorite_avatars,
        favorite_worlds,
        groups
    );
    let mut failures = 0;
    QuickSearchRemoteCatalog {
        own_avatars: rows_or_empty(own_avatars, &mut failures),
        favorite_avatars: rows_or_empty(favorite_avatars, &mut failures),
        own_worlds: rows_or_empty(own_worlds, &mut failures),
        favorite_worlds: rows_or_empty(favorite_worlds, &mut failures),
        groups: rows_or_empty(groups, &mut failures),
        failures,
    }
}

#[derive(Clone, Copy)]
enum QuickSearchRemoteSource {
    OwnWorlds,
    FavoriteAvatars,
    FavoriteWorlds,
}

async fn collect_pages(
    deps: &QuickSearchCatalogDeps,
    scope: &RuntimeAuthScopeSnapshot,
    source: QuickSearchRemoteSource,
    page_size: i64,
) -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    for page in 0..=MAX_PAGES_PER_SOURCE {
        ensure_scope_matches(&deps.auth_scope, scope)?;
        let offset = (page as i64) * page_size;
        let request = match source {
            QuickSearchRemoteSource::OwnWorlds => {
                let (_, request) = world_list_by_user_get_input(
                    scope.endpoint.clone(),
                    scope.current_user_id.clone(),
                    page_size,
                    offset,
                    "updated".into(),
                    "descending".into(),
                    "all".into(),
                )?;
                request
            }
            QuickSearchRemoteSource::FavoriteAvatars => {
                favorite_avatars_get_input(scope.endpoint.clone(), page_size, offset, String::new())
            }
            QuickSearchRemoteSource::FavoriteWorlds => favorite_worlds_get_input(
                scope.endpoint.clone(),
                page_size,
                offset,
                String::new(),
                String::new(),
                String::new(),
            ),
        };
        let page_rows = execute_rows(deps, scope, request).await?;
        let count = page_rows.len();
        if page == MAX_PAGES_PER_SOURCE {
            if count == 0 {
                return Ok(rows);
            }
            return Err(Error::Custom(
                "Quick search source pagination exceeded the safety limit.".into(),
            ));
        }
        rows.extend(page_rows);
        if count < page_size as usize {
            return Ok(rows);
        }
    }
    Ok(rows)
}

async fn fetch_user_groups(
    deps: &QuickSearchCatalogDeps,
    scope: &RuntimeAuthScopeSnapshot,
) -> Result<Vec<Value>> {
    let (_, request) =
        user_groups_get_input(scope.endpoint.clone(), scope.current_user_id.clone())?;
    let mut rows = execute_rows(deps, scope, request).await?;
    for row in &mut rows {
        let Some(object) = row.as_object_mut() else {
            continue;
        };
        let Some(group_id) = object
            .get("groupId")
            .and_then(Value::as_str)
            .filter(|group_id| !group_id.is_empty())
            .map(str::to_owned)
        else {
            continue;
        };
        object.insert("id".into(), Value::String(group_id));
    }
    Ok(rows)
}

async fn execute_rows(
    deps: &QuickSearchCatalogDeps,
    scope: &RuntimeAuthScopeSnapshot,
    request: HttpApiRequestInput,
) -> Result<Vec<Value>> {
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db.as_ref())
        .await?;
    ensure_scope_matches(&deps.auth_scope, scope)?;
    let response = ApiJsonResponse {
        status: response.status,
        json: serde_json::from_str::<Value>(&response.data)?,
    };
    if !(200..300).contains(&response.status) || response.has_error_field() {
        return Err(Error::Custom(format!(
            "Quick search source request failed: {}",
            response.error_message_or("VRChat API request failed")
        )));
    }
    Ok(response.json.as_array().cloned().unwrap_or_default())
}

fn serialize_rows<T: Serialize>(rows: Vec<T>) -> Result<Vec<Value>> {
    let value = serde_json::to_value(rows)?;
    Ok(value.as_array().cloned().unwrap_or_default())
}

fn rows_or_empty(result: Result<Vec<Value>>, failures: &mut usize) -> Vec<Value> {
    match result {
        Ok(rows) => rows,
        Err(error) => {
            *failures += 1;
            tracing::debug!(error = %error, "quick search source failed");
            Vec::new()
        }
    }
}

fn require_active_scope(auth_scope: &RuntimeAuthScope) -> Result<RuntimeAuthScopeSnapshot> {
    crate::scope_gate::require_active_scope(auth_scope, "Quick search catalog")
}

fn ensure_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_scope_matches(auth_scope, expected, "Quick search catalog")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_sources_increment_the_partial_count() {
        let mut failures = 0;
        let rows = rows_or_empty(Err(Error::Custom("failed".into())), &mut failures);
        assert!(rows.is_empty());
        assert_eq!(failures, 1);
    }
}
