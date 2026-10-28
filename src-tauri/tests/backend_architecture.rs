use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::OnceLock;

use cargo_metadata::DependencyKind;
use cargo_metadata::MetadataCommand;

fn workspace_file(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must be inside the workspace")
        .join(path)
}

fn rust_sources_below(path: &str) -> Vec<PathBuf> {
    let mut pending = vec![workspace_file(path)];
    let mut sources = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).expect("read architecture source directory") {
            let path = entry.expect("read architecture source entry").path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                sources.push(path);
            }
        }
    }
    sources
}

fn dependency_names(package_name: &str, kind: DependencyKind) -> BTreeSet<String> {
    static METADATA: OnceLock<cargo_metadata::Metadata> = OnceLock::new();
    let metadata = METADATA.get_or_init(|| {
        MetadataCommand::new()
            .manifest_path(workspace_file("Cargo.toml"))
            .no_deps()
            .exec()
            .expect("read Cargo workspace metadata")
    });
    let package = metadata
        .packages
        .iter()
        .find(|package| package.name.as_str() == package_name)
        .unwrap_or_else(|| panic!("find Cargo package {package_name}"));
    package
        .dependencies
        .iter()
        .filter(|dependency| dependency.kind == kind)
        .map(|dependency| dependency.name.clone())
        .collect()
}

fn normal_dependency_names(package_name: &str) -> BTreeSet<String> {
    dependency_names(package_name, DependencyKind::Normal)
}

fn development_dependency_names(package_name: &str) -> BTreeSet<String> {
    dependency_names(package_name, DependencyKind::Development)
}

fn named_struct_body<'a>(source: &'a str, declaration: &str) -> &'a str {
    let tail = source
        .split_once(declaration)
        .map(|(_, tail)| tail)
        .unwrap_or_else(|| panic!("find struct declaration: {declaration}"));
    let mut depth = 1_u32;
    for (index, character) in tail.char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return &tail[..index];
                }
            }
            _ => {}
        }
    }
    panic!("find closing brace for struct declaration: {declaration}");
}

fn contains_identifier(source: &str, identifier: &str) -> bool {
    source.match_indices(identifier).any(|(index, _)| {
        !source[index + identifier.len()..]
            .starts_with(|character: char| character == '_' || character.is_alphanumeric())
    })
}

#[test]
fn vrchat_commands_do_not_access_transport_implementation_directly() {
    for path in rust_sources_below("src-tauri/src/commands/vrchat") {
        let source = std::fs::read_to_string(&path).expect("read VRChat command source");
        assert!(
            !source.contains("VrchatApiRequest"),
            "VRChat transport request type leaked into Tauri command {}",
            path.display()
        );
    }
}

#[test]
fn tauri_shell_does_not_depend_on_concrete_infrastructure_crates() {
    let dependencies = normal_dependency_names("vrcx-0");
    for forbidden in [
        "vrcx-0-persistence",
        "vrcx-0-vrchat-client",
        "vrcx-0-integrations",
        "vrcx-0-media",
        "vrcx-0-outbound-adapters",
    ] {
        assert!(
            !dependencies.contains(forbidden),
            "Tauri inbound adapter depends on concrete infrastructure crate {forbidden}"
        );
    }
}

#[test]
fn composition_state_does_not_leak_through_public_fields_or_deref() {
    let desktop_state =
        std::fs::read_to_string(workspace_file("crates/runtime-host-desktop/src/state.rs"))
            .expect("read desktop runtime host state");
    assert!(!desktop_state.contains("impl Deref for DesktopRuntimeHostState"));

    let context = std::fs::read_to_string(workspace_file("crates/composition/src/context.rs"))
        .expect("read runtime host context");
    let context_fields = named_struct_body(&context, "pub(crate) struct RuntimeHostContext {");
    assert!(!context_fields
        .lines()
        .any(|line| line.trim().starts_with("pub ")));

    let runtime_state = std::fs::read_to_string(workspace_file(
        "crates/composition/src/state/runtime_host_state.rs",
    ))
    .expect("read runtime host state");
    let runtime_builder_fields =
        named_struct_body(&runtime_state, "pub struct RuntimeHostStateBuilder {");
    assert!(
        !runtime_builder_fields
            .lines()
            .any(|line| line.trim().starts_with("pub ")),
        "runtime host builder publicly exposes mutable composition graph fields"
    );
    let runtime_state_fields = named_struct_body(&runtime_state, "pub struct RuntimeHostState {");
    assert!(!runtime_state_fields
        .lines()
        .any(|line| line.trim().starts_with("pub ")));
}

#[test]
fn tauri_app_state_keeps_feature_graph_private() {
    let source = std::fs::read_to_string(workspace_file("src-tauri/src/state.rs"))
        .expect("read Tauri application state");
    for field in [
        "runtime",
        "mcp_controller",
        "database_upgrade",
        "favorite_details",
        "group_moderation_batches",
        "friend_log_name_resolutions",
        "user_dialog_tab_counts",
        "quick_search",
    ] {
        assert!(
            !source.contains(&format!("pub {field}:")),
            "Tauri application state publicly exposes feature graph field {field}"
        );
    }
    assert!(!source.contains("impl Deref for AppState"));
}

#[test]
fn desktop_composition_does_not_expose_concrete_service_bundles() {
    let desktop_state =
        std::fs::read_to_string(workspace_file("crates/runtime-host-desktop/src/state.rs"))
            .expect("read desktop runtime host state");
    assert!(
        !desktop_state.contains("pub game: Arc<GameRuntimeBundle>")
            && !desktop_state.contains("pub desktop: Arc<DesktopRuntimeBundle>"),
        "desktop composition exposes its concrete service bundles"
    );
    for path in rust_sources_below("src-tauri/src") {
        let source = std::fs::read_to_string(&path).expect("read Tauri source");
        assert!(
            !contains_identifier(&source, "runtime_host().desktop")
                && !contains_identifier(&source, "runtime_host().game"),
            "Tauri code reaches into a concrete desktop service bundle: {}",
            path.display()
        );
    }
}

#[test]
fn overlay_runtime_receives_feature_dependencies_instead_of_host_context() {
    let dependencies = normal_dependency_names("vrcx-0-overlay-runtime");
    assert!(!dependencies.contains("vrcx-0-composition"));
    for path in rust_sources_below("crates/overlay-runtime/src") {
        let source = std::fs::read_to_string(&path).expect("read overlay runtime source");
        assert!(
            !source.contains("RuntimeHostContext") && !source.contains("vrcx_0_composition"),
            "overlay runtime reaches into the complete host graph: {}",
            path.display()
        );
    }
}

#[test]
fn desktop_execution_modules_do_not_receive_the_complete_runtime_context() {
    for path in rust_sources_below("crates/runtime-host-desktop/src") {
        if path.ends_with("state.rs") || path.ends_with("tests.rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("read desktop runtime source");
        assert!(
            !source.contains("RuntimeHostContext")
                && !source.contains("RuntimeHostDesktopAssemblyDeps")
                && !source.contains("vrcx_0_composition::RuntimeHostState"),
            "desktop execution module receives the complete runtime context: {}",
            path.display()
        );
    }
}

#[test]
fn application_public_api_is_grouped_by_feature_context() {
    let source = std::fs::read_to_string(workspace_file("crates/application/src/lib.rs"))
        .expect("read application root");
    let flattened_exports = source
        .lines()
        .filter(|line| line.trim_start().starts_with("pub use "))
        .collect::<Vec<_>>();
    assert!(
        flattened_exports.is_empty(),
        "application root retains flattened exports instead of context APIs: {flattened_exports:?}"
    );
    for context in [
        "auth",
        "avatars",
        "collections",
        "discovery",
        "favorites",
        "game",
        "media",
        "profile",
        "remote",
        "social",
        "telemetry",
    ] {
        assert!(
            source.contains(&format!("pub mod {context};")),
            "application context is not public: {context}"
        );
    }
}

#[test]
fn application_contexts_do_not_expose_concrete_infrastructure_fields() {
    for root in [
        "crates/application/src",
        "crates/application-activity/src",
        "crates/application-core/src",
        "crates/application-game/src",
        "crates/application-realtime/src",
    ] {
        for path in rust_sources_below(root) {
            let source = std::fs::read_to_string(&path).expect("read application source");
            for line in source.lines() {
                let Some(public_member) = line.trim_start().strip_prefix("pub ") else {
                    continue;
                };
                let Some(colon_index) = public_member.find(':') else {
                    continue;
                };
                let field_name = public_member[..colon_index].trim();
                if field_name.is_empty()
                    || !field_name
                        .chars()
                        .all(|character| character == '_' || character.is_ascii_alphanumeric())
                {
                    continue;
                }
                for infrastructure in [
                    "DatabaseService",
                    "WebClient",
                    "ConfigRepository",
                    "StorageService",
                ] {
                    assert!(
                        !line.contains(infrastructure),
                        "application context exposes concrete infrastructure {infrastructure}: {}: {line}",
                        path.display()
                    );
                }
            }
        }
    }
}

#[test]
fn application_features_do_not_own_web_transport() {
    for path in rust_sources_below("crates/application/src") {
        let source = std::fs::read_to_string(&path).expect("read application source");
        for infrastructure in ["WebClient", "execute_api(", "execute_external_api("] {
            assert!(
                !source.contains(infrastructure),
                "application feature owns web transport {infrastructure}: {}",
                path.display()
            );
        }
    }
}

#[test]
fn shared_contracts_stay_synchronous_data_and_protocol_only() {
    for package in ["vrcx-0-contracts", "vrcx-0-runtime-event"] {
        let dependencies = normal_dependency_names(package);
        for forbidden in ["tokio", "tokio-util", "async-trait", "futures"] {
            assert!(
                !dependencies.contains(forbidden),
                "shared contract crate {package} gained async runtime dependency {forbidden}"
            );
        }
    }

    for path in ["crates/contracts/src", "crates/runtime-event/src"] {
        for source in rust_sources_below(path) {
            let text = std::fs::read_to_string(&source).expect("read shared contract source");
            for forbidden in ["async fn", ".await", "tokio::"] {
                assert!(
                    !text.contains(forbidden),
                    "shared contract source uses {forbidden}; contracts stay synchronous data and \
                     protocol only, orchestration belongs to application crates: {}",
                    source.display()
                );
            }
        }
    }
}

#[test]
fn shared_application_contracts_are_infrastructure_free() {
    for package in ["vrcx-0-core", "vrcx-0-contracts", "vrcx-0-runtime-event"] {
        let dependencies = normal_dependency_names(package);
        for forbidden in [
            "vrcx-0-persistence",
            "vrcx-0-vrchat-client",
            "vrcx-0-integrations",
            "vrcx-0-media",
            "tauri",
            "vrcx-0-host-desktop",
        ] {
            assert!(
                !dependencies.contains(forbidden),
                "shared application contract depends on infrastructure {forbidden}: {package}"
            );
        }
    }
}

#[test]
fn application_crates_do_not_depend_on_outbound_implementations() {
    let forbidden_dependencies = [
        "vrcx-0-persistence",
        "vrcx-0-vrchat-client",
        "vrcx-0-integrations",
        "vrcx-0-media",
        "vrcx-0-host-desktop",
        "rusqlite",
        "tauri",
    ];
    for package in [
        "vrcx-0-application-core",
        "vrcx-0-application-activity",
        "vrcx-0-application-game",
        "vrcx-0-application-realtime",
        "vrcx-0-application",
    ] {
        let dependencies = normal_dependency_names(package);
        for forbidden in forbidden_dependencies {
            assert!(
                !dependencies.contains(forbidden),
                "application crate depends on outbound implementation {forbidden}: {package}"
            );
        }
    }

    for root in [
        "crates/application-core/src",
        "crates/application-activity/src",
        "crates/application-game/src",
        "crates/application-realtime/src",
        "crates/application/src",
    ] {
        for path in rust_sources_below(root) {
            let source = std::fs::read_to_string(&path).expect("read application source");
            for forbidden in [
                "vrcx_0_persistence",
                "vrcx_0_vrchat_client",
                "vrcx_0_integrations",
                "vrcx_0_media",
                "vrcx_0_host_desktop",
                "rusqlite",
                "tauri::",
            ] {
                assert!(
                    !source.lines().any(|line| {
                        let line = line.trim();
                        // Stable log targets may retain the previous owner's module path.
                        line.contains(forbidden)
                            && !(line.starts_with("target: \"") && line.ends_with("\","))
                    }),
                    "application source imports outbound implementation {forbidden}: {}",
                    path.display()
                );
            }
        }
    }
}

#[test]
fn application_business_tests_do_not_depend_on_concrete_storage() {
    let dependencies = development_dependency_names("vrcx-0-application");
    for forbidden in ["rusqlite", "vrcx-0-outbound-adapters", "vrcx-0-persistence"] {
        assert!(
            !dependencies.contains(forbidden),
            "application business tests depend on concrete storage {forbidden}"
        );
    }
}

#[test]
fn runtime_host_context_is_compile_time_private_to_composition() {
    let context = std::fs::read_to_string(workspace_file("crates/composition/src/context.rs"))
        .expect("read runtime host context");
    assert!(context.contains("pub(crate) struct RuntimeHostContext"));
}

#[test]
fn application_public_remote_json_is_marked_as_an_explicit_raw_boundary() {
    for root in [
        "crates/application/src",
        "crates/application-activity/src",
        "crates/application-core/src",
        "crates/application-game/src",
        "crates/application-realtime/src",
    ] {
        for path in rust_sources_below(root) {
            let source = std::fs::read_to_string(&path).expect("read application source");
            for line in source.lines() {
                let line = line.trim_start();
                assert!(
                    !(line.starts_with("pub ")
                        && !line.starts_with("pub fn ")
                        && !line.starts_with("pub async fn ")
                        && line.contains(':')
                        && line.contains("Value")),
                    "public application JSON fields must use RawJson at their explicit boundary: {}: {line}",
                    path.display()
                );
            }
        }
    }
}

#[test]
fn mcp_and_assistant_do_not_construct_from_complete_host_state() {
    for path in [
        "crates/mcp/src/runtime.rs",
        "crates/assistant/src/runtime.rs",
    ] {
        let source = std::fs::read_to_string(workspace_file(path)).expect("read runtime source");
        assert!(
            !source.contains("RuntimeHostState"),
            "runtime depends on the complete host service graph: {path}"
        );
    }
}

#[test]
fn runtime_event_contract_stays_narrow_for_integration_api() {
    let dependencies = normal_dependency_names("vrcx-0-runtime-event");
    let allowed = BTreeSet::from([
        "serde".to_string(),
        "specta".to_string(),
        "vrcx-0-core".to_string(),
    ]);
    assert!(
        dependencies.is_subset(&allowed),
        "runtime event contract gained dependencies outside {allowed:?}: {dependencies:?}"
    );

    let integration_api = normal_dependency_names("vrcx-0-integration-api");
    assert!(
        integration_api.contains("vrcx-0-runtime-event"),
        "integration-api must reach runtime event payloads through the narrow contract crate"
    );
    for forbidden in ["vrcx-0-contracts", "vrcx-0-application-core", "vrcx-0-core"] {
        assert!(
            !integration_api.contains(forbidden),
            "integration-api depends on {forbidden}; keep its contract surface narrow"
        );
    }
}

#[test]
fn feed_logger_stays_free_of_the_desktop_stack() {
    let logger = normal_dependency_names("vrcx-0-logger");
    for forbidden in [
        "vrcx-0-host-desktop",
        "vrcx-0-runtime-host-desktop",
        "vrcx-0-overlay-runtime",
        "vrcx-0-vr-overlay",
    ] {
        assert!(
            !logger.contains(forbidden),
            "feed logger depends on {forbidden}; it must build as a headless Linux binary"
        );
    }

    let protocol = normal_dependency_names("vrcx-0-logger-protocol");
    assert!(
        protocol
            .iter()
            .all(|dependency| !dependency.starts_with("vrcx-0-")),
        "logger protocol is shared with the desktop app and must not depend on workspace crates"
    );
}

#[test]
fn mcp_and_assistant_depend_only_on_application_capabilities() {
    for package in ["vrcx-0-mcp", "vrcx-0-assistant"] {
        let dependencies = normal_dependency_names(package);
        for forbidden in [
            "vrcx-0-persistence",
            "vrcx-0-vrchat-client",
            "vrcx-0-integrations",
            "vrcx-0-media",
            "vrcx-0-host-desktop",
            "rusqlite",
            "tauri",
        ] {
            assert!(
                !dependencies.contains(forbidden),
                "inbound use-case consumer depends on outbound implementation {forbidden}: {package}"
            );
        }
    }
}

#[test]
fn blocking_tauri_commands_are_limited_to_the_main_thread_allowlist() {
    const MAIN_THREAD_COMMANDS: &[&str] = &[
        "app__auth_failure_notification_show",
        "app__confirm_linux_rendering",
        "app__desktop_notification",
        "app__devkit_panic",
        "app__ensure_main_window",
        "app__exit_application",
        "app__get_clipboard",
        "app__get_linux_rendering",
        "app__get_sidebar_auto_hide",
        "app__language_changed",
        "app__open_devtools",
        "app__refresh_tray_menu",
        "app__restart_application",
        "app__set_linux_rendering",
        "app__set_startup",
        "app__set_taskbar_overlay_notification",
        "app__set_tray_icon_notification",
    ];

    let mut blocking = BTreeSet::new();
    for path in rust_sources_below("src-tauri/src/commands") {
        let source = std::fs::read_to_string(&path).expect("read command source");
        let lines: Vec<&str> = source.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let signature = lines[index + 1..]
                .iter()
                .map(|candidate| candidate.trim_start())
                .find(|candidate| !candidate.starts_with("#["))
                .unwrap_or_default();
            if let Some(name) = signature.strip_prefix("pub fn ") {
                let name = name.split(['(', '<']).next().unwrap_or_default();
                blocking.insert(name.to_string());
            }
        }
    }

    let allowed: BTreeSet<String> = MAIN_THREAD_COMMANDS
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(
        blocking, allowed,
        "blocking Tauri commands run on the main thread; mark the command #[tauri::command(async)], make it an async fn that offloads through commands::blocking::run_blocking, or add it to the allowlist"
    );
}
