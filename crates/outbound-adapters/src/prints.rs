use std::sync::Arc;

use serde_json::{json, Map, Value};
use vrcx_0_application::social::{
    PrintFavoritesStore, PrintRemote, PrintRemoteFuture, DEFAULT_AUTO_DELETE_PRINTS_LIMIT,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::maintenance::PRINT_FAVORITE_IDS_CONFIG_KEY;
use vrcx_0_persistence::DatabaseService;

const AUTO_DELETE_OLD_PRINTS_CONFIG_KEY: &str = "autoDeleteOldPrints";
const AUTO_DELETE_PRINTS_LIMIT_CONFIG_KEY: &str = "autoDeletePrintsLimit";
const PRINT_FAVORITE_IDS_BY_USER_CONFIG_KEY: &str = "autoDeletePrintsFavoriteIdsByUser";
#[derive(Clone)]
pub struct LocalPrintAdapter {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
}

impl LocalPrintAdapter {
    pub fn new(db: Arc<DatabaseService>, web: Arc<WebClient>) -> Self {
        Self { db, web }
    }

    fn stored_favorite_ids_by_user(&self) -> crate::Result<Map<String, Value>> {
        let stored = vrcx_0_persistence::config::get_json(
            &self.db,
            PRINT_FAVORITE_IDS_BY_USER_CONFIG_KEY,
            json!({}),
        )?;
        Ok(match stored {
            Value::Object(by_user) => by_user,
            _ => Map::new(),
        })
    }
}

impl PrintFavoritesStore for LocalPrintAdapter {
    fn auto_delete_enabled(&self) -> crate::Result<bool> {
        vrcx_0_persistence::config::get_bool(&self.db, AUTO_DELETE_OLD_PRINTS_CONFIG_KEY, false)
            .map_err(crate::Error::from)
    }

    fn auto_delete_limit(&self) -> crate::Result<String> {
        vrcx_0_persistence::config::get_string(
            &self.db,
            AUTO_DELETE_PRINTS_LIMIT_CONFIG_KEY,
            &DEFAULT_AUTO_DELETE_PRINTS_LIMIT.to_string(),
        )
        .map_err(crate::Error::from)
    }

    fn legacy_favorite_ids(&self) -> crate::Result<Value> {
        vrcx_0_persistence::config::get_json(&self.db, PRINT_FAVORITE_IDS_CONFIG_KEY, json!([]))
            .map_err(crate::Error::from)
    }

    fn favorite_ids(&self, user_id: &str) -> crate::Result<Option<Value>> {
        Ok(self.stored_favorite_ids_by_user()?.remove(user_id))
    }

    fn write_favorite_ids(&self, user_id: &str, ids: &Value) -> crate::Result<()> {
        let mut by_user = self.stored_favorite_ids_by_user()?;
        by_user.insert(user_id.to_string(), ids.clone());
        vrcx_0_persistence::config::set_json(
            &self.db,
            PRINT_FAVORITE_IDS_BY_USER_CONFIG_KEY,
            &Value::Object(by_user),
        )
        .map_err(crate::Error::from)
    }
}

impl PrintRemote for LocalPrintAdapter {
    fn list_prints<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
        count: i32,
    ) -> PrintRemoteFuture<'a> {
        let request = vrcx_0_vrchat_client::media::prints_get_input(
            endpoint.to_string(),
            user_id.to_string(),
            count,
        );
        Box::pin(async move { self.web.execute_api(request?, VrchatScope::Vrchat).await })
    }

    fn delete_print<'a>(&'a self, endpoint: &'a str, print_id: &'a str) -> PrintRemoteFuture<'a> {
        let request = vrcx_0_vrchat_client::media::print_delete_input(
            endpoint.to_string(),
            print_id.to_string(),
        );
        Box::pin(async move { self.web.execute_api(request?, VrchatScope::Vrchat).await })
    }
}
