use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::stream::{self, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::{RuntimeEventBus, WebClient};
use vrcx_0_core::time::now_iso;
use vrcx_0_integrations::community_theme as protocol;
use vrcx_0_integrations::external_api::ExternalApiScope;
use vrcx_0_persistence::{
    config::{self as config_store, ConfigMutation},
    DatabaseService,
};

use super::background_image::{
    BackgroundImageConfigureInput, BackgroundImageProjection, BackgroundImageService,
};
use crate::{Error, Result};

pub use protocol::{
    CommunityThemeAuthor, CommunityThemeCatalog, CommunityThemeManifest, CommunityThemeStatsById,
    CommunityThemeStatsEntry,
};

const KEY_ENABLED: &str = "VRCX_communityThemeEnabled";
const KEY_ID: &str = "VRCX_communityThemeId";
const KEY_VERSION: &str = "VRCX_communityThemeVersion";
const KEY_CSS_SNAPSHOT: &str = "VRCX_communityThemeCssSnapshot";
const KEY_OVERRIDE_CSS: &str = "VRCX_communityThemeOverrideCss";
const KEY_OVERRIDE_ENABLED: &str = "VRCX_communityThemeOverrideEnabled";
const KEY_INSTALL_METADATA: &str = "VRCX_communityThemeInstallMetadata";
const KEY_INSTALLED_THEMES: &str = "VRCX_communityThemeInstalledThemes";
const KEY_LEGACY_CATALOG_URL: &str = "VRCX_themeMarketplaceCatalogUrl";
const LEGACY_NASA_APOD_WALLPAPER_THEME_ID: &str = "nasa-apod-wallpaper";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeInstallMetadata {
    pub theme_id: String,
    pub theme_name: String,
    pub version: String,
    pub source_url: String,
    pub sha256: String,
    pub installed_at: String,
    pub updated_at: String,
    pub dark_mode: bool,
    pub accent_mode: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommunityThemeProjection {
    pub revision: u64,
    pub catalog_url: String,
    pub enabled: bool,
    pub installed_theme: Option<CommunityThemeInstallMetadata>,
    pub installed_themes: Vec<CommunityThemeInstallMetadata>,
    pub installed_css_snapshot: String,
    pub override_css: String,
    pub override_css_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommunityThemeConfigureInput {
    #[serde(rename_all = "camelCase")]
    Install {
        theme_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Enable {
        theme_id: Option<String>,
    },
    Disable,
    #[serde(rename_all = "camelCase")]
    Delete {
        theme_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetOverride {
        css_text: String,
    },
    DisableOverride,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommunityThemeInstalledRecord {
    #[serde(flatten)]
    metadata: CommunityThemeInstallMetadata,
    css_snapshot: String,
}

struct PersistedCommunityThemeState {
    records: Vec<CommunityThemeInstalledRecord>,
    active_record: Option<CommunityThemeInstalledRecord>,
    override_css: String,
    override_css_enabled: bool,
    legacy_apod_was_active: bool,
}

type CommunityThemeRemoteFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

trait CommunityThemeRemote: Send + Sync {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog>;
    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest>;
    fn load_css<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String>;
    fn load_stats(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeStatsById>;
    fn report_install<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, bool>;
}

struct WebCommunityThemeRemote {
    web: Arc<WebClient>,
}

impl WebCommunityThemeRemote {
    async fn execute(
        &self,
        input: vrcx_0_integrations::external_api::ExternalHttpRequestInput,
        max_response_bytes: usize,
        context: &str,
    ) -> Result<String> {
        let response = self
            .web
            .execute_external_api_limited(
                input,
                ExternalApiScope::CommunityTheme,
                max_response_bytes,
            )
            .await?;
        protocol::ensure_community_theme_response(
            response.status,
            &response.data,
            max_response_bytes,
            context,
        )
        .map_err(protocol_error)?;
        Ok(response.data)
    }
}

impl CommunityThemeRemote for WebCommunityThemeRemote {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog> {
        Box::pin(async move {
            let body = self
                .execute(
                    protocol::community_theme_catalog_input(),
                    protocol::COMMUNITY_THEME_CATALOG_MAX_BYTES,
                    "catalog",
                )
                .await?;
            let (schema_version, theme_ids) =
                protocol::parse_community_theme_catalog_index(&body).map_err(protocol_error)?;
            let themes = stream::iter(theme_ids)
                .map(|theme_id| async move { self.load_manifest(&theme_id).await })
                .buffered(8)
                .try_collect()
                .await?;
            Ok(CommunityThemeCatalog {
                source_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
                schema_version,
                themes,
            })
        })
    }

    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest> {
        Box::pin(async move {
            let input =
                protocol::community_theme_manifest_input(theme_id).map_err(protocol_error)?;
            let body = self
                .execute(
                    input,
                    protocol::COMMUNITY_THEME_MANIFEST_MAX_BYTES,
                    &format!("manifest {theme_id}"),
                )
                .await?;
            protocol::parse_community_theme_manifest(&body, theme_id).map_err(protocol_error)
        })
    }

    fn load_css<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String> {
        Box::pin(async move {
            let input = protocol::community_theme_css_input(theme_id).map_err(protocol_error)?;
            let body = self
                .execute(
                    input,
                    protocol::COMMUNITY_THEME_CSS_MAX_BYTES,
                    &format!("CSS {theme_id}"),
                )
                .await?;
            if body.trim().is_empty() {
                return Err(Error::Custom(format!(
                    "Community theme CSS is empty: {theme_id}."
                )));
            }
            Ok(body)
        })
    }

    fn load_stats(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeStatsById> {
        Box::pin(async move {
            let body = self
                .execute(
                    protocol::community_theme_stats_input(),
                    protocol::COMMUNITY_THEME_STATS_MAX_BYTES,
                    "stats",
                )
                .await?;
            protocol::parse_community_theme_stats(&body).map_err(protocol_error)
        })
    }

    fn report_install<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, bool> {
        Box::pin(async move {
            let input =
                protocol::community_theme_install_report_input(theme_id).map_err(protocol_error)?;
            let response = self
                .web
                .execute_external_api_limited(
                    input,
                    ExternalApiScope::CommunityTheme,
                    protocol::COMMUNITY_THEME_REPORT_MAX_BYTES,
                )
                .await?;
            Ok((200..300).contains(&response.status)
                && response.data.len() <= protocol::COMMUNITY_THEME_REPORT_MAX_BYTES)
        })
    }
}

struct CommunityThemeServiceInner {
    db: Arc<DatabaseService>,
    remote: Arc<dyn CommunityThemeRemote>,
    event_bus: RuntimeEventBus,
    background_image: BackgroundImageService,
    operation_lock: AsyncMutex<()>,
    operation_generation: AtomicU64,
    projection: Mutex<CommunityThemeProjection>,
    revision: AtomicU64,
}

#[derive(Clone)]
pub struct CommunityThemeService {
    inner: Arc<CommunityThemeServiceInner>,
}

impl CommunityThemeService {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        event_bus: RuntimeEventBus,
        background_image: BackgroundImageService,
    ) -> Self {
        Self::with_remote(
            db,
            Arc::new(WebCommunityThemeRemote { web }),
            event_bus,
            background_image,
        )
    }

    fn with_remote(
        db: Arc<DatabaseService>,
        remote: Arc<dyn CommunityThemeRemote>,
        event_bus: RuntimeEventBus,
        background_image: BackgroundImageService,
    ) -> Self {
        Self {
            inner: Arc::new(CommunityThemeServiceInner {
                db,
                remote,
                event_bus,
                background_image,
                operation_lock: AsyncMutex::new(()),
                operation_generation: AtomicU64::new(0),
                projection: Mutex::new(empty_projection()),
                revision: AtomicU64::new(0),
            }),
        }
    }

    pub fn projection(&self) -> CommunityThemeProjection {
        self.inner.projection.lock().unwrap().clone()
    }

    pub async fn initialize(&self) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        let state = load_persisted_state(&self.inner.db)?;
        let projection = projection_from_state(&state);
        let mut mutations = install_state_mutations(&state.records, state.active_record.as_ref())?;
        mutations.extend(override_state_mutations(
            &state.override_css,
            state.override_css_enabled,
        ));
        mutations.push(ConfigMutation::remove(KEY_LEGACY_CATALOG_URL));

        if state.legacy_apod_was_active {
            self.inner
                .background_image
                .migrate_legacy_nasa_apod_for_community_theme(mutations)?;
        } else if state.active_record.is_some() {
            self.inner
                .background_image
                .disable_for_community_theme(mutations)?;
        } else {
            config_store::config_apply_mutations(&self.inner.db, &mutations)?;
        }
        Ok(self.apply_projection(projection))
    }

    pub async fn load_catalog(&self) -> Result<CommunityThemeCatalog> {
        self.inner.remote.load_catalog().await
    }

    pub async fn load_stats(&self) -> Result<CommunityThemeStatsById> {
        self.inner.remote.load_stats().await
    }

    pub async fn report_install(&self, theme_id: &str) -> bool {
        if !protocol::is_community_theme_id(theme_id) {
            return false;
        }
        match self.inner.remote.report_install(theme_id).await {
            Ok(reported) => reported,
            Err(error) => {
                tracing::debug!(theme_id, error = %error, "failed to report community theme install");
                false
            }
        }
    }

    pub async fn configure(
        &self,
        input: CommunityThemeConfigureInput,
    ) -> Result<CommunityThemeProjection> {
        let operation = self.begin_configure_operation();
        match input {
            CommunityThemeConfigureInput::Install { theme_id } => {
                self.install(operation, &theme_id).await
            }
            CommunityThemeConfigureInput::Enable { theme_id } => {
                self.enable(operation, theme_id.as_deref()).await
            }
            CommunityThemeConfigureInput::Disable => self.disable(operation).await,
            CommunityThemeConfigureInput::Delete { theme_id } => {
                self.delete(operation, theme_id.as_deref()).await
            }
            CommunityThemeConfigureInput::SetOverride { css_text } => {
                self.set_override(operation, css_text).await
            }
            CommunityThemeConfigureInput::DisableOverride => self.disable_override(operation).await,
        }
    }

    pub async fn configure_background_image(
        &self,
        input: BackgroundImageConfigureInput,
    ) -> Result<BackgroundImageProjection> {
        let operation = self.begin_configure_operation();
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let projection = self.inner.background_image.configure(input).await?;
        if projection.enabled {
            self.reconcile_after_background_enable()?;
        }
        Ok(projection)
    }

    pub async fn refresh_background_image(&self, force: bool) -> Result<BackgroundImageProjection> {
        let operation = self.begin_configure_operation();
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let projection = self.inner.background_image.refresh(force).await?;
        if projection.enabled {
            self.reconcile_after_background_enable()?;
        }
        Ok(projection)
    }

    async fn install(&self, operation: u64, theme_id: &str) -> Result<CommunityThemeProjection> {
        if !protocol::is_community_theme_id(theme_id) {
            return Err(Error::Custom(format!(
                "Invalid community theme id: {theme_id}."
            )));
        }
        let (manifest, css_snapshot) = futures_util::try_join!(
            self.inner.remote.load_manifest(theme_id),
            self.inner.remote.load_css(theme_id)
        )?;
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        let previous = state
            .records
            .iter()
            .find(|record| record.metadata.theme_id == theme_id);
        let now = now_iso();
        let metadata = CommunityThemeInstallMetadata {
            theme_id: manifest.id.clone(),
            theme_name: manifest.name,
            version: manifest.version,
            source_url: protocol::community_theme_asset_url(
                theme_id,
                protocol::COMMUNITY_THEME_CSS_FILE_NAME,
            )
            .map_err(protocol_error)?,
            sha256: hex::encode(Sha256::digest(css_snapshot.as_bytes())),
            installed_at: previous
                .map(|record| record.metadata.installed_at.clone())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
            dark_mode: manifest.dark_mode,
            accent_mode: manifest.accent_mode,
        };
        let active_record = CommunityThemeInstalledRecord {
            metadata,
            css_snapshot,
        };
        merge_install_record(&mut state.records, active_record.clone());
        let mutations = install_state_mutations(&state.records, Some(&active_record))?;
        self.inner
            .background_image
            .disable_for_community_theme(mutations)?;
        state.active_record = Some(active_record);
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn enable(
        &self,
        operation: u64,
        theme_id: Option<&str>,
    ) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        let target_theme_id = theme_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                state
                    .active_record
                    .as_ref()
                    .map(|record| record.metadata.theme_id.as_str())
            })
            .or_else(|| {
                state
                    .records
                    .first()
                    .map(|record| record.metadata.theme_id.as_str())
            });
        let Some(target_theme_id) = target_theme_id else {
            return Ok(self.projection());
        };
        let Some(active_record) = state
            .records
            .iter()
            .find(|record| record.metadata.theme_id == target_theme_id)
            .cloned()
        else {
            return Ok(self.projection());
        };
        let mutations = install_state_mutations(&state.records, Some(&active_record))?;
        self.inner
            .background_image
            .disable_for_community_theme(mutations)?;
        state.active_record = Some(active_record);
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn disable(&self, operation: u64) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        state.active_record = None;
        let mutations = install_state_mutations(&state.records, None)?;
        config_store::config_apply_mutations(&self.inner.db, &mutations)?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn delete(
        &self,
        operation: u64,
        theme_id: Option<&str>,
    ) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        let target_theme_id = theme_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                state
                    .active_record
                    .as_ref()
                    .map(|record| record.metadata.theme_id.as_str())
            })
            .map(ToOwned::to_owned);
        let Some(target_theme_id) = target_theme_id else {
            return Ok(self.projection());
        };
        state
            .records
            .retain(|record| record.metadata.theme_id != target_theme_id);
        if state
            .active_record
            .as_ref()
            .is_some_and(|record| record.metadata.theme_id == target_theme_id)
        {
            state.active_record = None;
        }
        let mutations = install_state_mutations(&state.records, state.active_record.as_ref())?;
        config_store::config_apply_mutations(&self.inner.db, &mutations)?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn set_override(
        &self,
        operation: u64,
        css_text: String,
    ) -> Result<CommunityThemeProjection> {
        if css_text.len() > protocol::COMMUNITY_THEME_CSS_MAX_BYTES {
            return Err(Error::Custom(
                "Community theme override CSS is too large.".into(),
            ));
        }
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        state.override_css = css_text;
        state.override_css_enabled = !state.override_css.trim().is_empty();
        config_store::config_apply_mutations(
            &self.inner.db,
            &override_state_mutations(&state.override_css, state.override_css_enabled),
        )?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    async fn disable_override(&self, operation: u64) -> Result<CommunityThemeProjection> {
        let _operation = self.inner.operation_lock.lock().await;
        self.ensure_configure_operation(operation)?;
        let mut state = load_persisted_state(&self.inner.db)?;
        state.override_css_enabled = false;
        config_store::config_apply_mutations(
            &self.inner.db,
            &[ConfigMutation::set(KEY_OVERRIDE_ENABLED, "false")],
        )?;
        Ok(self.apply_projection(projection_from_state(&state)))
    }

    fn reconcile_after_background_enable(&self) -> Result<()> {
        let state = load_persisted_state(&self.inner.db)?;
        self.apply_projection(projection_from_state(&state));
        Ok(())
    }

    fn begin_configure_operation(&self) -> u64 {
        self.inner
            .operation_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    fn ensure_configure_operation(&self, operation: u64) -> Result<()> {
        if self.inner.operation_generation.load(Ordering::Acquire) == operation {
            Ok(())
        } else {
            Err(Error::Custom(
                "Community theme operation was superseded by a newer request.".into(),
            ))
        }
    }

    fn apply_projection(
        &self,
        mut projection: CommunityThemeProjection,
    ) -> CommunityThemeProjection {
        projection.revision = self
            .inner
            .revision
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1);
        *self.inner.projection.lock().unwrap() = projection.clone();
        self.inner.event_bus.emit(projection.clone());
        projection
    }
}

fn empty_projection() -> CommunityThemeProjection {
    CommunityThemeProjection {
        revision: 0,
        catalog_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
        enabled: false,
        installed_theme: None,
        installed_themes: Vec::new(),
        installed_css_snapshot: String::new(),
        override_css: String::new(),
        override_css_enabled: false,
    }
}

fn load_persisted_state(db: &DatabaseService) -> Result<PersistedCommunityThemeState> {
    let enabled = config_store::get_bool(db, KEY_ENABLED, false)?;
    let active_theme_id = config_store::get_string(db, KEY_ID, "")?;
    let legacy_metadata_value = config_store::get_json(db, KEY_INSTALL_METADATA, Value::Null)?;
    let legacy_metadata = normalize_install_metadata(&legacy_metadata_value);
    let legacy_css_snapshot = config_store::get_string(db, KEY_CSS_SNAPSHOT, "")?;
    let installed_value = config_store::get_json(db, KEY_INSTALLED_THEMES, Value::Null)?;
    let mut records = installed_value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(normalize_install_record)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(metadata) = legacy_metadata.clone() {
        if !legacy_css_snapshot.trim().is_empty() {
            merge_install_record(
                &mut records,
                CommunityThemeInstalledRecord {
                    metadata,
                    css_snapshot: legacy_css_snapshot,
                },
            );
        }
    }
    records.retain(is_current_install_record);
    let legacy_apod_was_active = enabled
        && (active_theme_id == LEGACY_NASA_APOD_WALLPAPER_THEME_ID
            || legacy_metadata
                .as_ref()
                .is_some_and(|metadata| metadata.theme_id == LEGACY_NASA_APOD_WALLPAPER_THEME_ID));
    records.retain(|record| record.metadata.theme_id != LEGACY_NASA_APOD_WALLPAPER_THEME_ID);
    let active_record = enabled
        .then(|| {
            records
                .iter()
                .find(|record| record.metadata.theme_id == active_theme_id)
                .or_else(|| {
                    legacy_metadata.as_ref().and_then(|metadata| {
                        records
                            .iter()
                            .find(|record| record.metadata.theme_id == metadata.theme_id)
                    })
                })
                .cloned()
        })
        .flatten();
    let override_css = config_store::get_string(db, KEY_OVERRIDE_CSS, "")?;
    let override_css_enabled = !override_css.trim().is_empty()
        && config_store::get_raw(db, KEY_OVERRIDE_ENABLED)?.is_none_or(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "\"true\""
            )
        });
    Ok(PersistedCommunityThemeState {
        records,
        active_record,
        override_css,
        override_css_enabled,
        legacy_apod_was_active,
    })
}

fn normalize_install_record(value: &Value) -> Option<CommunityThemeInstalledRecord> {
    let metadata = normalize_install_metadata(value)?;
    let css_snapshot = config_text(value.get("cssSnapshot"));
    if css_snapshot.trim().is_empty() {
        return None;
    }
    Some(CommunityThemeInstalledRecord {
        metadata,
        css_snapshot,
    })
}

fn normalize_install_metadata(value: &Value) -> Option<CommunityThemeInstallMetadata> {
    let entry = value.as_object()?;
    let theme_id = config_text(entry.get("themeId"));
    let theme_name = config_text(entry.get("themeName"));
    let version = config_text(entry.get("version"));
    if theme_id.is_empty()
        || theme_name.is_empty()
        || version.is_empty()
        || !protocol::is_community_theme_id(&theme_id)
    {
        return None;
    }
    Some(CommunityThemeInstallMetadata {
        theme_id,
        theme_name,
        version,
        source_url: config_text(entry.get("sourceUrl")),
        sha256: config_text(entry.get("sha256")),
        installed_at: config_text(entry.get("installedAt")),
        updated_at: config_text(entry.get("updatedAt")),
        dark_mode: entry.get("darkMode").and_then(Value::as_bool) != Some(false),
        accent_mode: entry.get("accentMode").and_then(Value::as_bool) == Some(true)
            || entry.get("accentMode").and_then(Value::as_str) == Some("app"),
    })
}

fn is_current_install_record(record: &CommunityThemeInstalledRecord) -> bool {
    protocol::community_theme_asset_url(
        &record.metadata.theme_id,
        protocol::COMMUNITY_THEME_CSS_FILE_NAME,
    )
    .is_ok_and(|source_url| source_url == record.metadata.source_url)
}

fn merge_install_record(
    records: &mut Vec<CommunityThemeInstalledRecord>,
    record: CommunityThemeInstalledRecord,
) {
    if let Some(existing) = records
        .iter_mut()
        .find(|existing| existing.metadata.theme_id == record.metadata.theme_id)
    {
        *existing = record;
    } else {
        records.push(record);
    }
}

fn install_state_mutations(
    records: &[CommunityThemeInstalledRecord],
    active_record: Option<&CommunityThemeInstalledRecord>,
) -> Result<Vec<ConfigMutation>> {
    let mut mutations = vec![ConfigMutation::set(
        KEY_ENABLED,
        active_record.is_some().to_string(),
    )];
    if records.is_empty() {
        mutations.push(ConfigMutation::remove(KEY_INSTALLED_THEMES));
    } else {
        mutations.push(ConfigMutation::set(
            KEY_INSTALLED_THEMES,
            serde_json::to_string(records)?,
        ));
    }
    match active_record {
        Some(record) => {
            mutations.extend([
                ConfigMutation::set(KEY_ID, &record.metadata.theme_id),
                ConfigMutation::set(KEY_VERSION, &record.metadata.version),
                ConfigMutation::set(KEY_CSS_SNAPSHOT, &record.css_snapshot),
                ConfigMutation::set(
                    KEY_INSTALL_METADATA,
                    serde_json::to_string(&record.metadata)?,
                ),
            ]);
        }
        None => {
            mutations.extend([
                ConfigMutation::remove(KEY_ID),
                ConfigMutation::remove(KEY_VERSION),
                ConfigMutation::remove(KEY_CSS_SNAPSHOT),
                ConfigMutation::remove(KEY_INSTALL_METADATA),
            ]);
        }
    }
    Ok(mutations)
}

fn override_state_mutations(css_text: &str, enabled: bool) -> Vec<ConfigMutation> {
    vec![
        ConfigMutation::set(KEY_OVERRIDE_CSS, css_text),
        ConfigMutation::set(KEY_OVERRIDE_ENABLED, enabled.to_string()),
    ]
}

fn projection_from_state(state: &PersistedCommunityThemeState) -> CommunityThemeProjection {
    CommunityThemeProjection {
        revision: 0,
        catalog_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
        enabled: state.active_record.is_some(),
        installed_theme: state
            .active_record
            .as_ref()
            .map(|record| record.metadata.clone()),
        installed_themes: state
            .records
            .iter()
            .map(|record| record.metadata.clone())
            .collect(),
        installed_css_snapshot: state
            .active_record
            .as_ref()
            .map(|record| record.css_snapshot.clone())
            .unwrap_or_default(),
        override_css: state.override_css.clone(),
        override_css_enabled: state.override_css_enabled,
    }
}

fn config_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn protocol_error(error: protocol::CommunityThemeProtocolError) -> Error {
    Error::Custom(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tokio::sync::{Notify, Semaphore};
    use vrcx_0_persistence::storage::StorageService;

    use super::super::background_image::UnavailableBackgroundImageFileResolver;
    use super::*;

    struct DelayedCommunityThemeRemote {
        manifest_started: Notify,
        release_manifest: Semaphore,
    }

    impl DelayedCommunityThemeRemote {
        fn new() -> Self {
            Self {
                manifest_started: Notify::new(),
                release_manifest: Semaphore::new(0),
            }
        }
    }

    impl CommunityThemeRemote for DelayedCommunityThemeRemote {
        fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog> {
            Box::pin(async {
                Ok(CommunityThemeCatalog {
                    source_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
                    schema_version: 1,
                    themes: Vec::new(),
                })
            })
        }

        fn load_manifest<'a>(
            &'a self,
            theme_id: &'a str,
        ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest> {
            Box::pin(async move {
                self.manifest_started.notify_one();
                self.release_manifest
                    .acquire()
                    .await
                    .expect("manifest release semaphore should remain open")
                    .forget();
                Ok(CommunityThemeManifest {
                    id: theme_id.into(),
                    name: "Delayed theme".into(),
                    version: "1.0.0".into(),
                    author: CommunityThemeAuthor {
                        name: "Test".into(),
                        github: "test".into(),
                        url: None,
                    },
                    description: String::new(),
                    tags: Vec::new(),
                    tested_with: String::new(),
                    remote_assets: false,
                    dark_mode: true,
                    accent_mode: false,
                    preview_url: String::new(),
                    readme_url: String::new(),
                })
            })
        }

        fn load_css<'a>(&'a self, _theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String> {
            Box::pin(async { Ok(":root { color-scheme: dark; }".into()) })
        }

        fn load_stats(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeStatsById> {
            Box::pin(async { Ok(CommunityThemeStatsById::new()) })
        }

        fn report_install<'a>(
            &'a self,
            _theme_id: &'a str,
        ) -> CommunityThemeRemoteFuture<'a, bool> {
            Box::pin(async { Ok(true) })
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-community-theme-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn test_service(remote: Arc<dyn CommunityThemeRemote>) -> (TestDir, CommunityThemeService) {
        let dir = TestDir::new("superseded-install");
        let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
        let storage = StorageService::new(&dir.0.join("storage.json")).unwrap();
        let web = Arc::new(
            WebClient::new(
                &storage,
                db.as_ref(),
                "wss://pipeline.vrchat.cloud".into(),
                env!("CARGO_PKG_VERSION"),
            )
            .unwrap(),
        );
        let event_bus = RuntimeEventBus::new();
        let background_image = BackgroundImageService::new(
            Arc::clone(&db),
            web,
            event_bus.clone(),
            Arc::new(UnavailableBackgroundImageFileResolver),
        );
        (
            dir,
            CommunityThemeService::with_remote(db, remote, event_bus, background_image),
        )
    }

    #[tokio::test]
    async fn late_install_cannot_reverse_a_newer_disable_request() {
        let remote = Arc::new(DelayedCommunityThemeRemote::new());
        let (_dir, service) = test_service(remote.clone());
        let install_service = service.clone();
        let install = tokio::spawn(async move {
            install_service
                .configure(CommunityThemeConfigureInput::Install {
                    theme_id: "delayed-theme".into(),
                })
                .await
        });

        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            remote.manifest_started.notified(),
        )
        .await
        .expect("install should begin downloading its manifest");
        let disabled = service
            .configure(CommunityThemeConfigureInput::Disable)
            .await
            .unwrap();
        remote.release_manifest.add_permits(1);

        let error = install.await.unwrap().unwrap_err();
        assert!(error.to_string().contains("superseded"));
        assert!(!disabled.enabled);
        assert!(!service.projection().enabled);
        assert!(service.projection().installed_themes.is_empty());
    }
}
