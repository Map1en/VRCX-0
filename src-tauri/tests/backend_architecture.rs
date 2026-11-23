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

fn braced_body<'a>(source: &'a str, declaration: &str) -> &'a str {
    let tail = source
        .split_once(declaration)
        .map(|(_, tail)| tail)
        .unwrap_or_else(|| panic!("find declaration: {declaration}"));
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
    panic!("find closing brace for declaration: {declaration}");
}

fn contains_identifier(source: &str, identifier: &str) -> bool {
    source.match_indices(identifier).any(|(index, _)| {
        !source[index + identifier.len()..]
            .starts_with(|character: char| character == '_' || character.is_alphanumeric())
    })
}

fn identifier_end(text: &str) -> usize {
    text.find(|character: char| character != '_' && !character.is_alphanumeric())
        .unwrap_or(text.len())
}

fn persistence_leaves(source: &str) -> Vec<String> {
    const CRATE_PATH: &str = "vrcx_0_persistence::";
    let mut leaves = Vec::new();
    for (index, _) in source.match_indices(CRATE_PATH) {
        if source[..index]
            .ends_with(|character: char| character == '_' || character.is_alphanumeric())
        {
            continue;
        }
        let mut rest = &source[index + CRATE_PATH.len()..];
        collect_path_leaves(&mut rest, "", &mut leaves);
    }
    leaves
}

fn collect_path_leaves(rest: &mut &str, prefix: &str, leaves: &mut Vec<String>) {
    *rest = rest.trim_start();
    if let Some(group) = rest.strip_prefix('{') {
        *rest = group;
        loop {
            *rest = rest.trim_start();
            if let Some(after) = rest.strip_prefix('}') {
                *rest = after;
                return;
            }
            let before = rest.len();
            collect_path_leaves(rest, prefix, leaves);
            *rest = rest.trim_start();
            if let Some(after) = rest.strip_prefix(',') {
                *rest = after;
            } else if rest.len() == before || !rest.starts_with('}') {
                return;
            }
        }
    }
    let end = identifier_end(rest);
    if end == 0 {
        return;
    }
    let segment = &rest[..end];
    *rest = &rest[end..];
    let path = match (prefix.is_empty(), segment) {
        (_, "self") => prefix.to_string(),
        (true, _) => segment.to_string(),
        (false, _) => format!("{prefix}::{segment}"),
    };
    if let Some(after) = rest.strip_prefix("::") {
        *rest = after;
        collect_path_leaves(rest, &path, leaves);
        return;
    }
    if let Some(alias) = rest
        .trim_start()
        .strip_prefix("as")
        .filter(|after| after.starts_with(char::is_whitespace))
    {
        let alias = alias.trim_start();
        *rest = &alias[identifier_end(alias)..];
    }
    if !path.is_empty() {
        leaves.push(path);
    }
}

#[test]
fn vrchat_commands_do_not_access_transport_implementation_directly() {
    for path in rust_sources_below("src-tauri/src/commands/vrchat") {
        let source = std::fs::read_to_string(&path).expect("read VRChat command source");
        assert!(
            !source
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .any(|word| word == "VrchatRequest"),
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
    let context_fields = braced_body(&context, "pub(crate) struct RuntimeHostContext {");
    assert!(!context_fields
        .lines()
        .any(|line| line.trim().starts_with("pub ")));

    let runtime_state = std::fs::read_to_string(workspace_file(
        "crates/composition/src/state/runtime_host_state.rs",
    ))
    .expect("read runtime host state");
    let runtime_builder_fields =
        braced_body(&runtime_state, "pub struct RuntimeHostStateBuilder {");
    assert!(
        !runtime_builder_fields
            .lines()
            .any(|line| line.trim().starts_with("pub ")),
        "runtime host builder publicly exposes mutable composition graph fields"
    );
    let runtime_state_fields = braced_body(&runtime_state, "pub struct RuntimeHostState {");
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
    let assembly_root = workspace_file("crates/runtime-host-desktop/src/state/assembly");
    for path in rust_sources_below("crates/runtime-host-desktop/src") {
        if path.ends_with("state.rs")
            || path.ends_with("tests.rs")
            || path.starts_with(&assembly_root)
        {
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
    for package in [
        "vrcx-0-core",
        "vrcx-0-contracts",
        "vrcx-0-runtime-event",
        "vrcx-0-vrchat-protocol",
    ] {
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

    let dependencies = normal_dependency_names("vrcx-0-vrchat-protocol");
    for forbidden in ["reqwest", "tokio", "tokio-tungstenite", "hyper-util"] {
        assert!(
            !dependencies.contains(forbidden),
            "vrcx-0-vrchat-protocol gained transport dependency {forbidden}"
        );
    }
    for source in rust_sources_below("crates/vrchat-protocol/src") {
        let text = std::fs::read_to_string(&source).expect("read vrchat protocol source");
        for forbidden in ["async fn", ".await", "tokio::", "reqwest::"] {
            assert!(
                !text.contains(forbidden),
                "vrchat protocol source uses {forbidden}; request construction stays synchronous \
                 and transport belongs to vrcx-0-vrchat-client: {}",
                source.display()
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
        "vrcx-0-vr-overlay-backend",
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
        "app__set_linux_rendering",
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

#[test]
fn expensive_tauri_operations_leave_the_async_workers() {
    let mut violations = Vec::new();
    for (path, name) in [
        ("host/window.rs", "app__set_startup"),
        ("host/window.rs", "restart_now"),
        ("host/shell.rs", "app__get_file_base64"),
        ("host/shell.rs", "app__write_config_file_with_cache_cleanup"),
        ("local/worlds.rs", "app__world_friend_visits"),
    ] {
        let source =
            std::fs::read_to_string(workspace_file(&format!("src-tauri/src/commands/{path}")))
                .expect("read command source");
        let signature = format!("async fn {name}(");
        let Some((_, function)) = source.split_once(&signature) else {
            violations.push(format!(
                "{name} must await its blocking work asynchronously"
            ));
            continue;
        };
        let body_start = function.find('{').expect("find function body");
        let body = braced_body(&function[body_start..], "{");
        if !body.contains("run_blocking(") {
            violations.push(format!(
                "{name} must offload synchronous IO, queries, or shutdown waits"
            ));
        }
    }
    assert!(violations.is_empty(), "{}", violations.join("\n"));
}

fn production_source(path: &std::path::Path) -> Option<String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let file_name = path.file_name()?.to_string_lossy();
    if normalized.contains("/tests/")
        || normalized.contains("test_support")
        || file_name == "tests.rs"
        || file_name.ends_with("_tests.rs")
    {
        return None;
    }
    let source = std::fs::read_to_string(path).expect("read production source");
    Some(match source.find("#[cfg(test)]\nmod ") {
        Some(index) => source[..index].to_string(),
        None => source,
    })
}

fn swallowed_error_statements(source: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().map(str::trim).collect();
    let mut statements = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if line.starts_with("let _ =") {
            let statement = lines[index..]
                .iter()
                .scan(false, |done, line| {
                    if *done {
                        return None;
                    }
                    *done = line.ends_with(';');
                    Some(*line)
                })
                .collect::<Vec<_>>()
                .join(" ");
            statements.push(statement);
        } else if line.ends_with(".ok();") {
            let start = lines[..index]
                .iter()
                .rposition(|line| line.ends_with(';') || line.ends_with('{') || line.ends_with('}'))
                .map_or(0, |position| position + 1);
            let statement = lines[start..=index].join(" ");
            if !statement.starts_with("let ") {
                statements.push(statement);
            }
        }
    }
    statements
}

#[test]
fn persistence_and_media_do_not_silently_drop_errors() {
    const BEST_EFFORT_CALLS: &[&str] = &[
        "remove_file(",
        "remove_file_if_exists(",
        "remove_dir(",
        "remove_dir_all(",
        "remove_sidecars(",
        ".send(",
        ".join()",
    ];
    const EXCEPTIONS: &[(&str, &str, &str)] = &[
        (
            "crates/persistence/src/screenshot_cache.rs",
            "let _ = conn.execute(",
            "thumbnail cache rows are bookkeeping for files on disk; a lost row only re-encodes or re-evicts a thumbnail",
        ),
        (
            "crates/media/src/image_cache.rs",
            "let _ = std::fs::write(&marker",
            "the touch marker only refreshes the directory mtime used for eviction order",
        ),
        (
            "crates/media/src/png.rs",
            ".seek(SeekFrom::Start(",
            "read-path seek; the read that follows reports the failure",
        ),
        (
            "crates/media/src/screenshot_metadata.rs",
            ".seek(std::io::SeekFrom::Start(0)).ok();",
            "read-path seek; the read that follows reports the failure",
        ),
        (
            "crates/media/src/screenshot_metadata.rs",
            "let _ = pf.restore(&original);",
            "restore only runs after the edit already failed and is reported as false",
        ),
    ];

    let mut used = BTreeSet::new();
    let mut violations = Vec::new();
    for crate_dir in ["crates/persistence/src", "crates/media/src"] {
        for path in rust_sources_below(crate_dir) {
            let Some(source) = production_source(&path) else {
                continue;
            };
            let relative = path
                .strip_prefix(workspace_file(""))
                .expect("source inside workspace")
                .to_string_lossy()
                .replace('\\', "/");
            for statement in swallowed_error_statements(&source) {
                if BEST_EFFORT_CALLS
                    .iter()
                    .any(|call| statement.contains(call))
                {
                    continue;
                }
                match EXCEPTIONS
                    .iter()
                    .position(|(file, snippet, _)| *file == relative && statement.contains(snippet))
                {
                    Some(index) => {
                        used.insert(index);
                    }
                    None => violations.push(format!("{relative}: {statement}")),
                }
            }
        }
    }
    for (index, (file, snippet, _)) in EXCEPTIONS.iter().enumerate() {
        if !used.contains(&index) {
            violations.push(format!("stale exception {file}: {snippet}"));
        }
    }
    assert!(
        violations.is_empty(),
        "persistence and media must return or log write errors instead of dropping them; fix the call or register it in EXCEPTIONS with a reason:\n{}",
        violations.join("\n")
    );
}

#[test]
fn swallowed_error_scan_reads_whole_statements() {
    let source = "let _ = conn.execute(\n    \"DELETE\",\n    [],\n);\nself.file\n    .seek(SeekFrom::Start(0))\n    .ok();\nlet format = guess(&raw).ok();\nlet _ = std::fs::remove_file(&temp);";
    assert_eq!(
        swallowed_error_statements(source),
        [
            "let _ = conn.execute( \"DELETE\", [], );",
            "self.file .seek(SeekFrom::Start(0)) .ok();",
            "let _ = std::fs::remove_file(&temp);",
        ]
    );
}

fn function_body<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    let start = source
        .match_indices(&format!("fn {name}"))
        .map(|(index, _)| index)
        .find(|index| source[index + 3 + name.len()..].starts_with(['(', '<']))?;
    let open = start + source[start..].find('{')?;
    Some(braced_body(&source[open + 1..], ""))
}

fn path_taking_commands() -> BTreeSet<String> {
    const PATH_SEGMENTS: &[&str] = &["path", "paths", "dir", "folder", "file", "files"];
    let mut commands = BTreeSet::new();
    for path in rust_sources_below("src-tauri/src/commands") {
        let source = std::fs::read_to_string(&path).expect("read command source");
        for (index, _) in source.match_indices("fn app__") {
            let signature = &source[index + 3..];
            let name = &signature[..identifier_end(signature)];
            let Some(open) = signature.find('(') else {
                continue;
            };
            let close = open + signature[open..].find(')').expect("command parameter list");
            let takes_path = signature[open + 1..close].split(',').any(|parameter| {
                let Some((parameter_name, parameter_type)) = parameter.split_once(':') else {
                    return false;
                };
                !parameter_type.contains("bool")
                    && parameter_name
                        .trim()
                        .split('_')
                        .any(|segment| PATH_SEGMENTS.contains(&segment))
            });
            if takes_path {
                commands.insert(name.to_string());
            }
        }
    }
    commands
}

#[test]
fn ipc_commands_that_take_paths_declare_where_the_path_is_checked() {
    const SCREENSHOTS: &str = "src-tauri/src/commands/host/screenshots.rs";
    const SHELL: &str = "src-tauri/src/commands/host/shell.rs";
    const DESKTOP_SCREENSHOTS: &str = "crates/runtime-host-desktop/src/screenshot.rs";
    const DESKTOP_MEDIA: &str = "crates/runtime-host-desktop/src/media.rs";
    const GUARDED: &[(&str, &str, &str, &str)] = &[
        (
            "app__add_screenshot_metadata",
            SCREENSHOTS,
            "app__add_screenshot_metadata",
            "ensure_screenshot_write_allowed",
        ),
        (
            "app__community_theme_debug_load_local_theme",
            "src-tauri/src/commands/host/theme_debug.rs",
            "app__community_theme_debug_load_local_theme",
            "ensure_host_read_allowed",
        ),
        (
            "app__copy_image_to_clipboard",
            "crates/host-desktop/src/clipboard.rs",
            "copy_image_to_clipboard",
            "validate_image_path",
        ),
        (
            "app__crop_all_prints",
            DESKTOP_MEDIA,
            "crop_all_prints",
            "ensure_write_allowed",
        ),
        (
            "app__crop_print_image",
            DESKTOP_MEDIA,
            "crop_print_image",
            "ensure_write_allowed",
        ),
        (
            "app__delete_screenshot_file",
            DESKTOP_SCREENSHOTS,
            "delete_file",
            "ensure_delete_allowed",
        ),
        (
            "app__delete_screenshot_metadata",
            SCREENSHOTS,
            "app__delete_screenshot_metadata",
            "ensure_screenshot_write_allowed",
        ),
        (
            "app__devkit_read_file",
            "src-tauri/src/commands/host/devkit.rs",
            "app__devkit_read_file",
            "ensure_host_read_allowed",
        ),
        (
            "app__ensure_screenshot_thumbnail",
            SCREENSHOTS,
            "app__ensure_screenshot_thumbnail",
            "ensure_screenshot_read_allowed",
        ),
        (
            "app__export_screenshots_zip",
            DESKTOP_SCREENSHOTS,
            "plan_export",
            "ensure_managed_screenshot",
        ),
        (
            "app__game_log_import",
            "src-tauri/src/commands/local/game_log.rs",
            "app__game_log_import",
            "ensure_host_read_allowed",
        ),
        (
            "app__get_extra_screenshot_data",
            SCREENSHOTS,
            "app__get_extra_screenshot_data",
            "ensure_screenshot_read_allowed",
        ),
        (
            "app__get_file_base64",
            "crates/host-desktop/src/shell_actions.rs",
            "file_base64",
            "BASE64_READABLE_IMAGE_EXTENSIONS",
        ),
        (
            "app__get_screenshot_folder_images",
            DESKTOP_SCREENSHOTS,
            "folder_images",
            "photos_root",
        ),
        (
            "app__get_screenshot_metadata",
            SCREENSHOTS,
            "app__get_screenshot_metadata",
            "ensure_screenshot_read_allowed",
        ),
        (
            "app__get_screenshot_share_facts",
            "crates/outbound-adapters/src/screenshots/share.rs",
            "facts",
            "photos_root",
        ),
        (
            "app__get_screenshots_by_file_names",
            DESKTOP_SCREENSHOTS,
            "by_file_names",
            "photos_root",
        ),
        (
            "app__local_test_avatar_delete",
            "crates/host-desktop/src/local_test_avatars.rs",
            "delete_in",
            "validate_file_name",
        ),
        (
            "app__open_folder_and_select_item",
            SHELL,
            "app__open_folder_and_select_item",
            "ensure_host_read_allowed",
        ),
        (
            "app__open_ugc_photos_folder",
            SHELL,
            "app__open_ugc_photos_folder",
            "ensure_host_read_allowed",
        ),
        (
            "app__pick_random_screenshot_in_folder_tree",
            DESKTOP_SCREENSHOTS,
            "random_path_in_folder_tree",
            "photos_root",
        ),
        (
            "app__plan_data_dir_migration",
            "crates/runtime-host-desktop/src/data_dir.rs",
            "plan",
            "prepare_app_data_dir_migration_target",
        ),
        (
            "app__profile_backup_run_manual",
            "crates/runtime-host-desktop/src/profile_backup.rs",
            "run_manual",
            "ensure_write_allowed",
        ),
        (
            "app__profile_restore_validate",
            "crates/runtime-host-desktop/src/profile_backup.rs",
            "validate_restore",
            "ensure_read_allowed",
        ),
        (
            "app__request_data_dir_migration",
            "crates/runtime-host-desktop/src/data_dir.rs",
            "request_migration",
            "self.plan(",
        ),
        (
            "app__save_emoji_to_file",
            DESKTOP_MEDIA,
            "save_ugc_category",
            "ensure_write_allowed",
        ),
        (
            "app__save_print_to_file",
            DESKTOP_MEDIA,
            "save_ugc_category",
            "ensure_write_allowed",
        ),
        (
            "app__save_sticker_to_file",
            DESKTOP_MEDIA,
            "save_ugc_category",
            "ensure_write_allowed",
        ),
        (
            "app__set_screenshot_favorite",
            DESKTOP_SCREENSHOTS,
            "set_favorite",
            "ensure_read_allowed",
        ),
        (
            "app__start_game_from_path",
            "crates/runtime-host-desktop/src/state.rs",
            "start_game_from_path",
            "ensure_vrchat_launch_path_allowed",
        ),
    ];
    const NOT_A_FILE_ACCESS: &[(&str, &str)] = &[
        (
            "app__file_metadata_get",
            "the argument is a VRChat file id or URL, not a local path",
        ),
        (
            "app__get_ugc_photo_location",
            "only resolves and returns a folder string; nothing is read or opened",
        ),
        (
            "app__open_background_image_files_selector_dialog",
            "the path only seeds the native picker; the user chooses the file",
        ),
        (
            "app__open_file_selector_dialog",
            "the path only seeds the native picker; the user chooses the file",
        ),
        (
            "app__open_folder_selector_dialog",
            "the path only seeds the native picker; the user chooses the folder",
        ),
        (
            "app__save_file_selector_dialog",
            "the path only seeds the native picker; the user chooses the target",
        ),
        (
            "app__save_vrc_reg_json_file",
            "the path only seeds the native picker; the user chooses the target",
        ),
    ];

    let registered: BTreeSet<String> = GUARDED
        .iter()
        .map(|(command, ..)| command.to_string())
        .chain(
            NOT_A_FILE_ACCESS
                .iter()
                .map(|(command, _)| command.to_string()),
        )
        .collect();
    assert_eq!(
        path_taking_commands(),
        registered,
        "every IPC command that takes a path must be registered with the function that checks it, or with the reason it does not touch the file system"
    );

    let mut violations = Vec::new();
    for (command, file, function, guard) in GUARDED {
        let source = std::fs::read_to_string(workspace_file(file)).expect("read guard source");
        match function_body(&source, function) {
            Some(body) if body.contains(guard) => {}
            Some(_) => violations.push(format!(
                "{command}: {file}::{function} no longer calls {guard}"
            )),
            None => violations.push(format!("{command}: {file} has no fn {function}")),
        }
    }
    assert!(violations.is_empty(), "{}", violations.join("\n"));
}

#[test]
fn realtime_host_takes_the_friend_owner_lock_before_state() {
    let mut functions_with_both = 0;
    let mut violations = Vec::new();
    for path in rust_sources_below("crates/application-realtime/src/realtime/service/host") {
        let Some(source) = production_source(&path) else {
            continue;
        };
        for (index, _) in source.match_indices("fn ") {
            let name = &source[index + 3..][..identifier_end(&source[index + 3..])];
            let Some(body) = function_body(&source[index..], name) else {
                continue;
            };
            let owner = body.find("lock_friend_owner()");
            let state = body
                .match_indices(".lock()")
                .map(|(position, _)| position)
                .find(|position| body[..*position].trim_end().ends_with("state"));
            if let (Some(owner), Some(state)) = (owner, state) {
                functions_with_both += 1;
                if state < owner {
                    violations.push(format!("{}: {name}", path.display()));
                }
            }
        }
    }
    assert!(
        functions_with_both > 0,
        "lock order scan found no function taking both locks"
    );
    assert!(
        violations.is_empty(),
        "the global lock order is friend owner -> feed owner -> state; these functions take state before the friend owner lock:\n{}",
        violations.join("\n")
    );
}

#[test]
fn persistence_leaves_expand_nested_use_groups() {
    let source = "use vrcx_0_persistence::{\n    assistant,\n    config::ConfigRepository,\n    activity::{self, activity_self_caches_invalidate},\n    DatabaseService,\n};";
    assert_eq!(
        persistence_leaves(source),
        [
            "assistant",
            "config::ConfigRepository",
            "activity",
            "activity::activity_self_caches_invalidate",
            "DatabaseService",
        ]
    );
}

#[test]
fn persistence_leaves_take_the_path_before_an_alias() {
    let source = "use vrcx_0_persistence::config as config_store;\nuse vrcx_0_persistence::{game_log as log, DatabaseService};";
    assert_eq!(
        persistence_leaves(source),
        ["config", "game_log", "DatabaseService"]
    );
}

#[test]
fn persistence_leaves_include_inline_qualified_calls() {
    let source = "if vrcx_0_persistence::config::get_bool(&self.db, \"gameLogDisabled\", false)? {}\nlet cache: OnceLock<vrcx_0_persistence::screenshot_cache::MetadataCacheDb> = OnceLock::new();\nlet my_vrcx_0_persistence::ignored = ();";
    assert_eq!(
        persistence_leaves(source),
        ["config::get_bool", "screenshot_cache::MetadataCacheDb"]
    );
}

#[test]
fn desktop_runtime_host_reaches_infrastructure_only_through_listed_modules() {
    const SOURCE_ROOT: &str = "crates/runtime-host-desktop/src";
    const PERSISTENCE_HANDLES: &[&str] = &["DatabaseService", "screenshot_cache::MetadataCacheDb"];
    const PERSISTENCE_QUERY_MODULES: &[&str] = &[
        "assistant_adapters.rs",
        "data_dir.rs",
        "feed_logger.rs",
        "game_log.rs",
        "game_log_import.rs",
        "game_state_store.rs",
        "instance_launch.rs",
        "integration_api.rs",
        "legacy_migration.rs",
        "mcp_adapters.rs",
        "notification/dispatcher.rs",
        "notification/indicator.rs",
        "state.rs",
    ];
    const VRCHAT_CLIENT_MODULES: &[&str] = &["privacy_lock.rs"];

    let root = workspace_file(SOURCE_ROOT);
    let mut persistence_queries = std::collections::BTreeMap::<String, BTreeSet<String>>::new();
    let mut vrchat_client_modules = BTreeSet::new();
    for path in rust_sources_below(SOURCE_ROOT) {
        let relative = path
            .strip_prefix(&root)
            .expect("desktop runtime source lives below its root")
            .to_string_lossy()
            .replace('\\', "/");
        let file_name = relative.rsplit('/').next().unwrap_or_default();
        if relative.starts_with("state/assembly/")
            || relative.starts_with("tests/")
            || relative.contains("/tests/")
            || file_name.ends_with("tests.rs")
            || file_name.ends_with("test_support.rs")
            || file_name == "assistant_llm_harness.rs"
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("read desktop runtime source");
        let queries: BTreeSet<String> = persistence_leaves(&source)
            .into_iter()
            .filter(|leaf| {
                !PERSISTENCE_HANDLES
                    .iter()
                    .any(|handle| leaf == handle || leaf.starts_with(&format!("{handle}::")))
            })
            .collect();
        if !queries.is_empty() {
            persistence_queries.insert(relative.clone(), queries);
        }
        if source.contains("vrcx_0_vrchat_client") {
            vrchat_client_modules.insert(relative);
        }
    }

    let unlisted_queries: Vec<String> = persistence_queries
        .iter()
        .filter(|(file, _)| !PERSISTENCE_QUERY_MODULES.contains(&file.as_str()))
        .flat_map(|(file, leaves)| {
            leaves.iter().map(move |leaf| {
                format!(
                    "{file}: vrcx_0_persistence::{leaf} — move this query behind an outbound adapter or add the file to PERSISTENCE_QUERY_MODULES"
                )
            })
        })
        .collect();
    assert!(
        unlisted_queries.is_empty(),
        "desktop runtime host reaches persistence queries directly:\n{}",
        unlisted_queries.join("\n")
    );

    let unlisted_vrchat_client: Vec<String> = vrchat_client_modules
        .iter()
        .filter(|file| !VRCHAT_CLIENT_MODULES.contains(&file.as_str()))
        .map(|file| {
            format!(
                "{file}: vrcx_0_vrchat_client — move this call behind an outbound adapter or add the file to VRCHAT_CLIENT_MODULES"
            )
        })
        .collect();
    assert!(
        unlisted_vrchat_client.is_empty(),
        "desktop runtime host reaches the VRChat client directly:\n{}",
        unlisted_vrchat_client.join("\n")
    );

    let stale_entries: Vec<String> = PERSISTENCE_QUERY_MODULES
        .iter()
        .filter(|file| !persistence_queries.contains_key(**file))
        .map(|file| {
            format!("{file}: no direct persistence query remains — remove it from PERSISTENCE_QUERY_MODULES")
        })
        .chain(
            VRCHAT_CLIENT_MODULES
                .iter()
                .filter(|file| !vrchat_client_modules.contains(**file))
                .map(|file| {
                    format!("{file}: no vrcx_0_vrchat_client use remains — remove it from VRCHAT_CLIENT_MODULES")
                }),
        )
        .collect();
    assert!(
        stale_entries.is_empty(),
        "desktop runtime host infrastructure allowlists must only shrink:\n{}",
        stale_entries.join("\n")
    );
}
