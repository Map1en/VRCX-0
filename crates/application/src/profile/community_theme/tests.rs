use std::sync::Arc;

use tokio::sync::{Notify, Semaphore};
use vrcx_0_application_core::{Error, RuntimeEventBus};

use super::super::background_image::{
    BackgroundImageProviderId, BackgroundImageRemote, BackgroundImageRemoteFuture,
    BackgroundImageService, UnavailableBackgroundImageFileResolver,
};
use super::*;
use vrcx_0_application_core::MemoryConfigStore;

struct DelayedCommunityThemeRemote {
    manifest_started: Notify,
    release_manifest: Semaphore,
}

struct UnavailableBackgroundImageRemote;

impl BackgroundImageRemote for UnavailableBackgroundImageRemote {
    fn provider_image(
        &self,
        _provider_id: BackgroundImageProviderId,
    ) -> BackgroundImageRemoteFuture<
        '_,
        vrcx_0_contracts::background_image::BackgroundImageProviderImage,
    > {
        Box::pin(async { Err(Error::Custom("background image remote unavailable".into())) })
    }
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

    fn report_install<'a>(&'a self, _theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, bool> {
        Box::pin(async { Ok(true) })
    }
}

fn test_service(remote: Arc<dyn CommunityThemeRemote>) -> CommunityThemeService {
    let config = Arc::new(MemoryConfigStore::default());
    let event_bus = RuntimeEventBus::new();
    let background_image = BackgroundImageService::new(
        config.clone(),
        Arc::new(UnavailableBackgroundImageRemote),
        event_bus.clone(),
        Arc::new(UnavailableBackgroundImageFileResolver),
    );
    CommunityThemeService::new(config, remote, event_bus, background_image)
}

#[tokio::test]
async fn late_install_cannot_reverse_a_newer_disable_request() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    let service = test_service(remote.clone());
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

#[tokio::test]
async fn install_disable_enable_and_delete_preserve_theme_lifecycle() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    remote.release_manifest.add_permits(1);
    let service = test_service(remote);

    let installed = service
        .configure(CommunityThemeConfigureInput::Install {
            theme_id: "lifecycle-theme".into(),
        })
        .await
        .unwrap();
    assert!(installed.enabled);
    assert_eq!(
        installed
            .installed_theme
            .as_ref()
            .map(|theme| theme.theme_id.as_str()),
        Some("lifecycle-theme")
    );
    assert_eq!(installed.installed_themes.len(), 1);
    assert_eq!(
        installed.installed_css_snapshot,
        ":root { color-scheme: dark; }"
    );

    let disabled = service
        .configure(CommunityThemeConfigureInput::Disable)
        .await
        .unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.installed_theme.is_none());
    assert_eq!(disabled.installed_themes.len(), 1);

    let enabled = service
        .configure(CommunityThemeConfigureInput::Enable {
            theme_id: Some("lifecycle-theme".into()),
        })
        .await
        .unwrap();
    assert!(enabled.enabled);
    assert_eq!(
        enabled
            .installed_theme
            .as_ref()
            .map(|theme| theme.theme_id.as_str()),
        Some("lifecycle-theme")
    );

    let deleted = service
        .configure(CommunityThemeConfigureInput::Delete {
            theme_id: Some("lifecycle-theme".into()),
        })
        .await
        .unwrap();
    assert!(!deleted.enabled);
    assert!(deleted.installed_theme.is_none());
    assert!(deleted.installed_themes.is_empty());
}

#[tokio::test]
async fn override_css_persists_while_its_enabled_state_can_be_disabled() {
    let remote = Arc::new(DelayedCommunityThemeRemote::new());
    let service = test_service(remote);

    let configured = service
        .configure(CommunityThemeConfigureInput::SetOverride {
            css_text: ":root { --accent: red; }".into(),
        })
        .await
        .unwrap();
    assert_eq!(configured.override_css, ":root { --accent: red; }");
    assert!(configured.override_css_enabled);

    let disabled = service
        .configure(CommunityThemeConfigureInput::DisableOverride)
        .await
        .unwrap();
    assert_eq!(disabled.override_css, ":root { --accent: red; }");
    assert!(!disabled.override_css_enabled);

    let initialized = service.initialize().await.unwrap();
    assert_eq!(initialized.override_css, ":root { --accent: red; }");
    assert!(!initialized.override_css_enabled);
}

struct VersionedCommunityThemeRemote {
    version: std::sync::Mutex<String>,
}

impl VersionedCommunityThemeRemote {
    fn new(version: &str) -> Self {
        Self {
            version: std::sync::Mutex::new(version.into()),
        }
    }

    fn publish(&self, version: &str) {
        *self.version.lock().unwrap() = version.into();
    }

    fn manifest(&self, theme_id: &str) -> CommunityThemeManifest {
        CommunityThemeManifest {
            id: theme_id.into(),
            name: theme_id.into(),
            version: self.version.lock().unwrap().clone(),
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
        }
    }
}

impl CommunityThemeRemote for VersionedCommunityThemeRemote {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog> {
        Box::pin(async {
            Ok(CommunityThemeCatalog {
                source_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
                schema_version: 1,
                themes: vec![self.manifest("theme-a"), self.manifest("theme-b")],
            })
        })
    }

    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest> {
        Box::pin(async move { Ok(self.manifest(theme_id)) })
    }

    fn load_css<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String> {
        Box::pin(async move {
            Ok(format!(
                ".{theme_id} {{ --version: '{}'; }}",
                self.version.lock().unwrap()
            ))
        })
    }

    fn load_stats(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeStatsById> {
        Box::pin(async { Ok(CommunityThemeStatsById::new()) })
    }

    fn report_install<'a>(&'a self, _theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, bool> {
        Box::pin(async { Ok(true) })
    }
}

async fn install_theme(service: &CommunityThemeService, theme_id: &str) {
    service
        .configure(CommunityThemeConfigureInput::Install {
            theme_id: theme_id.into(),
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn update_check_reports_only_newer_catalog_versions() {
    let remote = Arc::new(VersionedCommunityThemeRemote::new("v1.2.0"));
    let service = test_service(remote.clone());
    install_theme(&service, "theme-a").await;

    remote.publish("1.1.9");
    service.check_for_updates().await;
    assert!(service.projection().updates.is_empty());

    remote.publish("1.10.0");
    service.check_for_updates().await;
    assert_eq!(
        service.projection().updates,
        vec![CommunityThemeUpdate {
            theme_id: "theme-a".into(),
            installed_version: "v1.2.0".into(),
            latest_version: "1.10.0".into(),
        }]
    );
}

#[tokio::test]
async fn update_refreshes_the_snapshot_without_changing_which_theme_is_active() {
    let remote = Arc::new(VersionedCommunityThemeRemote::new("1.0.0"));
    let service = test_service(remote.clone());
    install_theme(&service, "theme-b").await;
    install_theme(&service, "theme-a").await;
    remote.publish("1.1.0");
    service.check_for_updates().await;
    assert_eq!(service.projection().updates.len(), 2);

    let updated_inactive = service
        .configure(CommunityThemeConfigureInput::Update {
            theme_id: "theme-b".into(),
        })
        .await
        .unwrap();
    assert_eq!(
        updated_inactive
            .installed_theme
            .as_ref()
            .map(|theme| theme.theme_id.as_str()),
        Some("theme-a")
    );
    assert_eq!(
        updated_inactive.installed_css_snapshot,
        ".theme-a { --version: '1.0.0'; }"
    );
    assert_eq!(
        updated_inactive
            .updates
            .iter()
            .map(|update| update.theme_id.as_str())
            .collect::<Vec<_>>(),
        vec!["theme-a"]
    );

    let updated_active = service
        .configure(CommunityThemeConfigureInput::Update {
            theme_id: "theme-a".into(),
        })
        .await
        .unwrap();
    assert!(updated_active.enabled);
    assert_eq!(
        updated_active
            .installed_theme
            .as_ref()
            .map(|theme| theme.version.as_str()),
        Some("1.1.0")
    );
    assert_eq!(
        updated_active.installed_css_snapshot,
        ".theme-a { --version: '1.1.0'; }"
    );
    assert!(updated_active.updates.is_empty());

    let initialized = service.initialize().await.unwrap();
    assert_eq!(
        initialized.installed_css_snapshot,
        ".theme-a { --version: '1.1.0'; }"
    );
    assert!(initialized.updates.is_empty());
}

#[tokio::test]
async fn update_rejects_themes_that_are_not_installed() {
    let remote = Arc::new(VersionedCommunityThemeRemote::new("1.0.0"));
    let service = test_service(remote);

    let error = service
        .configure(CommunityThemeConfigureInput::Update {
            theme_id: "theme-a".into(),
        })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("not installed"));
    assert!(service.projection().installed_themes.is_empty());
}
