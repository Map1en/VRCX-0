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

#[test]
fn vrchat_commands_do_not_access_transport_implementation_directly() {
    for path in rust_sources_below("src-tauri/src/commands/vrchat") {
        let source = std::fs::read_to_string(&path).expect("read VRChat command source");
        for transport in ["VrchatApiRequest", "vrcx_0_vrchat_client"] {
            assert!(
                !source.contains(transport),
                "VRChat transport implementation {transport} leaked into Tauri command {}",
                path.display()
            );
        }
    }
}

#[test]
fn vrchat_remote_adapter_preserves_structured_host_errors() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/runtime-host-desktop/src/vrchat_remote.rs",
    ))
    .expect("read desktop VRChat remote adapter");
    assert!(
        !source.contains("Error::Custom(error.to_string())"),
        "desktop VRChat adapter must not flatten structured host errors into strings"
    );
}

#[test]
fn application_remote_facade_uses_explicit_exports() {
    let source = std::fs::read_to_string(workspace_file("crates/application/src/remote/mod.rs"))
        .expect("read application remote facade");
    assert!(
        !source.contains("pub use input::*"),
        "application remote facade must explicitly name its public contract"
    );
}

#[test]
fn local_commands_do_not_access_persistence_directly() {
    for path in rust_sources_below("src-tauri/src/commands/local") {
        let source = std::fs::read_to_string(&path).expect("read local command source");
        assert!(
            !source.contains("vrcx_0_persistence"),
            "local inbound adapter accesses persistence directly: {}",
            path.display()
        );
    }
}

#[test]
fn owner_id_is_owned_by_the_shared_semantic_kernel() {
    let core = std::fs::read_to_string(workspace_file("crates/core/src/owner.rs"))
        .expect("read shared owner primitive");
    let persistence =
        std::fs::read_to_string(workspace_file("crates/persistence/src/ownership.rs"))
            .expect("read persistence owner adapter");
    assert!(core.contains("pub struct OwnerId"));
    assert!(!persistence.contains("pub struct OwnerId"));
    for path in rust_sources_below("crates") {
        let source = std::fs::read_to_string(&path).expect("read backend source");
        assert!(
            !source.contains("vrcx_0_persistence::OwnerId"),
            "backend consumer imports OwnerId from persistence: {}",
            path.display()
        );
    }
}

#[test]
fn owner_lookup_does_not_run_schema_ddl_on_the_read_path() {
    let source = std::fs::read_to_string(workspace_file("crates/persistence/src/ownership.rs"))
        .expect("read persistence owner adapter");
    let lookup = source
        .split("fn owner_row_id_lookup")
        .nth(1)
        .and_then(|tail| tail.split("fn owner_table_exists").next())
        .expect("find owner row lookup body");
    assert!(!lookup.contains("ensure_owner_table"));
    assert!(!lookup.contains("CREATE TABLE"));
}

#[test]
fn composition_state_does_not_leak_through_public_fields_or_deref() {
    let app_state = std::fs::read_to_string(workspace_file("src-tauri/src/state.rs"))
        .expect("read Tauri application state");
    assert!(!app_state.contains("impl Deref for AppState"));
    assert!(!app_state.contains("pub runtime: DesktopRuntimeHostState"));

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
fn desktop_composition_does_not_expose_runtime_state_escape_hatch() {
    let desktop_state =
        std::fs::read_to_string(workspace_file("crates/runtime-host-desktop/src/state.rs"))
            .expect("read desktop runtime host state");
    assert!(
        !desktop_state.contains("pub fn runtime_state("),
        "desktop composition exposes the complete RuntimeHostState graph"
    );
    assert!(
        !desktop_state.contains("pub game: Arc<GameRuntimeBundle>")
            && !desktop_state.contains("pub desktop: Arc<DesktopRuntimeBundle>"),
        "desktop composition exposes its concrete service bundles"
    );
    for path in rust_sources_below("src-tauri/src") {
        let source = std::fs::read_to_string(&path).expect("read Tauri source");
        assert!(
            !source.contains("runtime_state()"),
            "Tauri code reaches through desktop feature APIs into RuntimeHostState: {}",
            path.display()
        );
        assert!(
            !source.contains("runtime_host().desktop") && !source.contains("runtime_host().game"),
            "Tauri code reaches into a concrete desktop service bundle: {}",
            path.display()
        );
    }
}

#[test]
fn headless_inbound_adapter_does_not_reach_into_runtime_context() {
    let source = std::fs::read_to_string(workspace_file("crates/headless/src/main.rs"))
        .expect("read headless runtime source");
    assert!(
        !source.contains("runtime_context()"),
        "headless inbound adapter reaches through the host facade into the complete context"
    );
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
                && !source.contains("RuntimeHostDesktopAssemblyDeps"),
            "desktop execution module receives the complete runtime context: {}",
            path.display()
        );
    }
}

#[test]
fn tauri_commands_only_receive_feature_facades_from_host_state() {
    for path in rust_sources_below("src-tauri/src/commands") {
        let source = std::fs::read_to_string(&path).expect("read Tauri command source");
        assert!(
            !source.contains("runtime_state()"),
            "Tauri inbound adapter reaches through a feature facade into composition state: {}",
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
fn application_context_public_api_does_not_reexport_outbound_implementations() {
    for root in [
        "crates/application/src",
        "crates/application-activity/src",
        "crates/application-core/src",
        "crates/application-game/src",
        "crates/application-realtime/src",
    ] {
        for path in rust_sources_below(root) {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains("test"))
            {
                continue;
            }
            if path == workspace_file("crates/application-core/src/vrchat_api.rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("read application source");
            for dependency in [
                "pub use vrcx_0_persistence",
                "pub use vrcx_0_vrchat_client",
                "pub use vrcx_0_integrations",
                "pub use vrcx_0_media",
                "pub type VrchatApiRequest = vrcx_0_vrchat_client",
                "pub type VrchatApiResponse = vrcx_0_vrchat_client",
                "pub type VrchatScope = vrcx_0_vrchat_client",
            ] {
                assert!(
                    !source.contains(dependency),
                    "application public API leaks outbound implementation {dependency}: {}",
                    path.display()
                );
            }
        }
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
fn group_calendar_application_uses_a_semantic_remote_port() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/application/src/social/group_calendar.rs",
    ))
    .expect("read group calendar application service");
    assert!(source.contains("pub trait GroupCalendarRemote: Send + Sync"));
    assert!(!source.contains("GroupCalendarRemoteRequests"));
    for infrastructure in [
        "WebClient",
        "VrchatApiRequest",
        "VrchatJsonResponse",
        "execute_api(",
    ] {
        assert!(
            !source.contains(infrastructure),
            "group calendar application service reaches into remote infrastructure {infrastructure}"
        );
    }
}

#[test]
fn vrc_status_application_uses_a_semantic_remote_port() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/application/src/profile/vrc_status.rs",
    ))
    .expect("read VRC status application service");
    assert!(source.contains("pub trait VrcStatusRemote: Send + Sync"));
    for infrastructure in [
        "WebClient",
        "ExternalApiScope",
        "vrc_status_json_get_input",
        "execute_external_api(",
    ] {
        assert!(
            !source.contains(infrastructure),
            "VRC status application service reaches into remote infrastructure {infrastructure}"
        );
    }
}

#[test]
fn user_dialog_tab_counts_application_uses_a_semantic_source() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/application/src/social/user_dialog_tab_counts.rs",
    ))
    .expect("read user dialog tab counts application service");
    assert!(source.contains("pub trait UserDialogTabCountsSource: Send + Sync"));
    for infrastructure in [
        "WebClient",
        "VrchatApiRequest",
        "VrchatJsonResponse",
        "execute_api(",
    ] {
        assert!(
            !source.contains(infrastructure),
            "user dialog tab counts application service reaches into remote infrastructure {infrastructure}"
        );
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
fn auth_application_uses_semantic_remote_operations() {
    for path in rust_sources_below("crates/application/src/auth") {
        let source = std::fs::read_to_string(&path).expect("read auth application source");
        for transport_contract in ["VrchatApiRequest", "VrchatScope", "AuthRemoteRequests"] {
            assert!(
                !source.contains(transport_contract),
                "auth application owns remote transport contract {transport_contract}: {}",
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
    let composition_root = std::fs::read_to_string(workspace_file("crates/composition/src/lib.rs"))
        .expect("read composition root");
    assert!(!composition_root.contains("pub use context::RuntimeHostContext"));

    let context = std::fs::read_to_string(workspace_file("crates/composition/src/context.rs"))
        .expect("read runtime host context");
    assert!(context.contains("pub(crate) struct RuntimeHostContext"));

    for path in rust_sources_below("crates/runtime-host-desktop/src") {
        let source = std::fs::read_to_string(&path).expect("read desktop runtime source");
        assert!(
            !source.contains("RuntimeHostContext"),
            "desktop host names the private composition context: {}",
            path.display()
        );
    }
}

#[test]
fn group_instances_owned_projection_marks_remote_entries_as_raw() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/application/src/game/background_capabilities/group_instances.rs",
    ))
    .expect("read group instances application slice");
    assert!(source.contains("pub instances: Option<Vec<RawJson>>"));
    assert!(!source.contains("pub instances: Option<Vec<Value>>"));
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
fn instance_join_command_is_only_an_inbound_adapter() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/vrchat/instances/service.rs",
    ))
    .expect("read instance command source");

    for forbidden_owner in [
        "struct TauriInstanceLaunchHttpClient",
        "struct TauriInstanceLaunchPipe",
        "fn should_focus_game_window",
    ] {
        assert!(
            !source.contains(forbidden_owner),
            "instance launch adapter ownership leaked into the Tauri command module: {forbidden_owner}"
        );
    }
}

#[test]
fn current_user_mutation_commands_are_only_inbound_adapters() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/vrchat/users/service.rs",
    ))
    .expect("read user command source");

    for forbidden_owner in [
        "AuthenticatedMutationContext::capture",
        "execute_current_user_api_then_invalidate",
        "current_user_update_input(",
        "current_user_badge_update_input(",
        "current_user_tags_add_input(",
        "current_user_tags_remove_input(",
        "profile_update_input(",
    ] {
        assert!(
            !source.contains(forbidden_owner),
            "current-user mutation ownership leaked into the Tauri command module: {forbidden_owner}"
        );
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
        assert!(
            !source.contains("from_host("),
            "runtime extracts its own dependencies from the host: {path}"
        );
    }
}

#[test]
fn tauri_commands_do_not_access_outbound_infrastructure_directly() {
    for path in rust_sources_below("src-tauri/src/commands") {
        let source = std::fs::read_to_string(&path).expect("read Tauri command source");
        for dependency in [
            "vrcx_0_persistence",
            "vrcx_0_vrchat_client",
            "vrcx_0_integrations",
            "vrcx_0_media",
        ] {
            assert!(
                !source.contains(dependency),
                "Tauri inbound adapter accesses outbound infrastructure {dependency}: {}",
                path.display()
            );
        }
    }
}

#[test]
fn runtime_session_and_now_playing_state_use_typed_projections() {
    let session = std::fs::read_to_string(workspace_file(
        "crates/application-core/src/ports/session.rs",
    ))
    .expect("read session projection source");
    assert!(session.contains("pub struct CurrentUserSnapshot(Arc<Value>)"));
    assert!(!session.contains("current_user_snapshot: Arc<Value>"));

    let identity = std::fs::read_to_string(workspace_file(
        "crates/application/src/auth/session_projection.rs",
    ))
    .expect("read identity session projection");
    assert!(identity.contains("current_user_snapshot: CurrentUserSnapshot"));
    assert!(!identity.contains("current_user_snapshot: Arc<Value>"));

    let desktop =
        std::fs::read_to_string(workspace_file("crates/runtime-host-desktop/src/context.rs"))
            .expect("read desktop context state");
    assert!(desktop.contains("Arc<Mutex<Arc<NowPlayingSnapshot>>>"));
    assert!(!desktop.contains("Arc<Mutex<Arc<Value>>>"));
}

#[test]
fn task_supervisor_closes_registration_before_shutdown_waits() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/application-core/src/task_supervisor.rs",
    ))
    .expect("read task supervisor source");
    assert!(source.contains("pub enum TaskSpawnOutcome"));
    assert!(source.contains("pub struct TaskStopReport"));
    assert!(source.contains("lifecycle.accepting_tasks = false"));
}

#[test]
fn openai_translation_coordination_is_application_owned() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application/src/discovery/translation.rs",
    ))
    .expect("read translation use case");
    let command = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/application/translation.rs",
    ))
    .expect("read translation command");
    assert!(application.contains("pub trait OpenAiTranslationPort"));
    assert!(application.contains("pub async fn complete_translation"));
    assert!(!command.contains("TranslationDispatch"));
    assert!(!command.contains("LlmTranslateInput"));
}

#[test]
fn external_api_transport_errors_reach_diagnostics_and_sync_recording() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/runtime-host-desktop/src/external_api.rs",
    ))
    .expect("read external API runtime");
    assert!(source.contains(".and_then(|(status, data)|"));
    assert!(!source.contains("self.web.execute_external(request).await?"));
}

#[test]
fn application_has_no_system_catch_all_context() {
    let system_dir = workspace_file("crates/application/src/system");
    assert!(
        !system_dir.exists(),
        "application system catch-all must be decomposed into owning feature contexts: {}",
        system_dir.display()
    );
    let application_root = std::fs::read_to_string(workspace_file("crates/application/src/lib.rs"))
        .expect("read application root");
    assert!(
        !application_root.contains("mod system;")
            && !application_root.contains("pub mod system;")
            && !application_root.contains("pub use system::"),
        "application root must not retain the decomposed system facade"
    );
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
fn database_upgrade_commands_do_not_own_recovery_policy() {
    let source = std::fs::read_to_string(workspace_file("src-tauri/src/commands/database.rs"))
        .expect("read database upgrade commands");
    for forbidden in [
        "database_upgrade_failure_token",
        "log_interrupted_database_upgrade",
        "flush_pending_upgrade_failure_telemetry",
        "ANONYMOUS_USAGE_TELEMETRY_CONFIG_KEY",
        "start_fresh_database",
    ] {
        assert!(
            !source.contains(forbidden),
            "database upgrade policy remains in the Tauri inbound adapter: {forbidden}"
        );
    }
}

#[test]
fn legacy_migration_commands_do_not_own_migration_policy() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/host/legacy_migration.rs",
    ))
    .expect("read legacy migration commands");
    for forbidden in [
        "discover_supported_legacy_source",
        "validate_legacy_source",
        "legacy_migration_unavailable_reason",
        "ensure_legacy_vrcx_process_allows_migration",
        "stage_legacy_migration",
    ] {
        assert!(
            !source.contains(forbidden),
            "legacy migration policy remains in the Tauri inbound adapter: {forbidden}"
        );
    }
}

#[test]
fn registry_backup_commands_do_not_own_export_or_import_policy() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/application/registry_backup.rs",
    ))
    .expect("read registry backup commands");
    for forbidden in [
        ".find(|backup| backup.key == key)",
        "registry_backup_export_json",
        "backup.name.trim()",
        "shell_actions::write_string_file",
        "vrchat_registry::read_reg_json_file",
        "registry_backup_import_json",
    ] {
        assert!(
            !source.contains(forbidden),
            "registry backup policy remains in the Tauri inbound adapter: {forbidden}"
        );
    }
}

#[test]
fn profile_restore_command_does_not_decide_restart_policy() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/application/profile_backup.rs",
    ))
    .expect("read profile backup commands");
    assert!(
        !source.contains("outcome.validation.is_some()"),
        "profile restore restart policy remains in the Tauri inbound adapter"
    );
}

#[test]
fn startup_bootstrap_command_does_not_assemble_the_snapshot() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/host/startup_bootstrap.rs",
    ))
    .expect("read startup bootstrap command");
    for forbidden in [
        "config_list_values",
        "current_host_capabilities",
        "app__system_language",
        "app__system_culture",
    ] {
        assert!(
            !source.contains(forbidden),
            "startup bootstrap orchestration remains in the Tauri inbound adapter: {forbidden}"
        );
    }
}

#[test]
fn auth_config_commands_do_not_own_cache_policy() {
    let source = std::fs::read_to_string(workspace_file(
        "src-tauri/src/commands/vrchat/auth/service.rs",
    ))
    .expect("read VRChat auth commands");
    for forbidden in ["cached_vrchat_config", "clear_cached_vrchat_config"] {
        assert!(
            !source.contains(forbidden),
            "VRChat config cache policy remains in the Tauri inbound adapter: {forbidden}"
        );
    }
}

#[test]
fn composition_does_not_own_feature_runtime_policy() {
    let source = std::fs::read_to_string(workspace_file("crates/composition/src/lib.rs"))
        .expect("read composition root");
    for forbidden in [
        "mod authenticated_runtime;",
        "mod note_export;",
        "mod shared_collection_import;",
        "pub mod telemetry;",
        "pub mod notification;",
    ] {
        assert!(
            !source.contains(forbidden),
            "feature runtime policy remains in the composition root: {forbidden}"
        );
    }
    for path in rust_sources_below("crates/composition/src") {
        let source = std::fs::read_to_string(&path).expect("read composition source");
        for forbidden in [
            "fn run_social_baseline_refresh_core(",
            "struct RuntimeGroupInstancesProjection",
            "struct AuthenticatedSessionProjection",
            "struct AuthenticatedSessionSnapshot",
            "fn authenticate_non_interactive_saved_user(",
            "let fallback_available =",
            "struct BackgroundAuthRecoveryContext",
            "fn normalize_recovery_reason(",
            "trait SecretStartupActions",
            "fn run_secret_startup(",
        ] {
            assert!(
                !source.contains(forbidden),
                "feature policy remains in composition: {forbidden}: {}",
                path.display()
            );
        }
    }
}

#[test]
fn activity_warmup_policy_is_application_owned() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application-activity/src/activity_warmup.rs",
    ))
    .expect("read activity warmup application slice");
    assert!(application.contains("pub trait ActivitySessionWarmupStore"));
    assert!(application.contains("pub struct ActivityWarmupRuntime"));

    for path in rust_sources_below("crates/composition/src") {
        let source = std::fs::read_to_string(&path).expect("read composition source");
        for forbidden in [
            "activity_self_sessions_warmup(",
            "fn claim_activity_warmup_generation(",
            "fn activity_warmup_scope_matches(",
        ] {
            assert!(
                !source.contains(forbidden),
                "activity warmup policy remains in composition: {forbidden}: {}",
                path.display()
            );
        }
    }
}

#[test]
fn background_auth_recovery_state_machine_is_application_owned() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application/src/auth/background_auth_recovery.rs",
    ))
    .expect("read background auth recovery slice");
    assert!(application.contains("pub trait BackgroundAuthRecoveryActions"));
    assert!(application.contains("pub struct BackgroundAuthRecoveryOrchestrator"));

    let composition = std::fs::read_to_string(workspace_file(
        "crates/composition/src/state/background_auth.rs",
    ))
    .expect("read background auth composition adapter");
    for forbidden in [
        "auth_webhook_should_recover(",
        "AtomicFlagGuard::try_acquire(",
    ] {
        assert!(
            !composition.contains(forbidden),
            "background auth recovery state machine remains in composition: {forbidden}"
        );
    }
    assert!(composition.contains(".background_auth_recovery"));
    assert!(composition.contains(".recover("));
}

#[test]
fn authenticated_session_maintenance_lifecycle_is_application_owned() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application/src/auth/authenticated_session_maintenance.rs",
    ))
    .expect("read authenticated session maintenance slice");
    assert!(application.contains("pub struct AuthenticatedSessionMaintenanceRuntime"));

    let composition =
        std::fs::read_to_string(workspace_file("crates/composition/src/state/startup.rs"))
            .expect("read composition startup");
    for forbidden in [
        "AUTHENTICATED_SESSION_MAINTENANCE_DELAY",
        "authenticated_session_maintenance_scope_matches(",
        "run_authenticated_session_maintenance(",
    ] {
        assert!(
            !composition.contains(forbidden),
            "authenticated session maintenance lifecycle remains in composition: {forbidden}"
        );
    }
}

#[test]
fn social_maintenance_runtime_policy_is_application_owned() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application/src/social/social_maintenance.rs",
    ))
    .expect("read social maintenance application runtime");
    assert!(application.contains("pub trait SocialMaintenanceActions"));
    assert!(application.contains("pub struct SocialMaintenanceRuntime"));

    let composition =
        std::fs::read_to_string(workspace_file("crates/composition/src/state/background.rs"))
            .expect("read composition background adapter");
    for forbidden in [
        "favorite_groups_initialized",
        "let mut next_social",
        "tokio::time::sleep",
        "BACKGROUND_CURRENT_USER_CADENCE_SECONDS",
    ] {
        assert!(
            !composition.contains(forbidden),
            "social maintenance runtime policy remains in composition: {forbidden}"
        );
    }
}

#[test]
fn authenticated_session_storage_initialization_uses_an_application_port() {
    let application = std::fs::read_to_string(workspace_file(
        "crates/application/src/auth/authenticated_session_storage.rs",
    ))
    .expect("read authenticated session storage port");
    assert!(application.contains("pub trait AuthenticatedSessionStorage"));
    assert!(application.contains("pub fn initialize_authenticated_session_storage"));

    let composition =
        std::fs::read_to_string(workspace_file("crates/composition/src/state/startup.rs"))
            .expect("read composition startup adapter");
    assert!(!composition.contains("vrcx_0_persistence::maintenance::user_tables_ensure"));
}

#[test]
fn architecture_dependency_rules_use_cargo_metadata() {
    let source = std::fs::read_to_string(workspace_file("src-tauri/tests/backend_architecture.rs"))
        .expect("read architecture test source");
    assert!(source.contains("cargo_metadata::MetadataCommand"));
    let legacy_helper = ["fn manifest_", "dependency_section("].concat();
    assert!(!source.contains(&legacy_helper));
}

#[test]
fn saved_group_favorites_rules_are_application_owned() {
    let source = std::fs::read_to_string(workspace_file(
        "crates/runtime-host-desktop/src/local_data.rs",
    ))
    .expect("read local data facade");
    for forbidden in [
        "vrcx_0_persistence::saved_group_favorites",
        "Saved group collection name is required",
        "Saved group favorite requires a canonical group ID",
        "fn saved_group_owner(",
    ] {
        assert!(
            !source.contains(forbidden),
            "saved group rule remains in desktop host: {forbidden}"
        );
    }
}

#[test]
fn activity_page_persistence_does_not_own_page_policy() {
    for path in rust_sources_below("crates/persistence/src/activity_page") {
        let source = std::fs::read_to_string(&path).expect("read activity storage source");
        for forbidden in [
            "fn activity_page_view_build(",
            "fn window_bounds(",
            "fn is_reusable(",
            "fn series_bucket_for_range(",
            "serving stale cache",
            "TOP_WORLD_LIMIT",
            "COMPANION_LIMIT",
            "FADING_LIMIT",
        ] {
            assert!(
                !source.contains(forbidden),
                "activity page policy remains in {}: {forbidden}",
                path.display()
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
