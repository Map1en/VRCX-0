use super::*;

fn local_entry(id: &str) -> AppLauncherEntry {
    AppLauncherEntry {
        id: id.to_string(),
        enabled: true,
        name: "Tool".to_string(),
        kind: AppLauncherEntryKind::LocalApp,
        scope: AppLauncherScope::All,
        target: "C:\\Tools\\Tool.exe".to_string(),
        args: String::new(),
        launch_delay_seconds: 0,
        run_policy: AppLauncherRunPolicy::Always,
        stop_policy: AppLauncherStopPolicy::KeepRunning,
        process_name: None,
        working_directory: None,
    }
}

#[test]
fn app_launcher_scope_filter_matches_desktop_and_vr() {
    assert!(scope_matches(AppLauncherScope::All, false));
    assert!(scope_matches(AppLauncherScope::All, true));
    assert!(scope_matches(AppLauncherScope::Desktop, false));
    assert!(!scope_matches(AppLauncherScope::Desktop, true));
    assert!(!scope_matches(AppLauncherScope::Vr, false));
    assert!(scope_matches(AppLauncherScope::Vr, true));
}

#[test]
fn app_launcher_sanitizes_steam_close_policy() {
    let mut entry = local_entry("steam");
    entry.kind = AppLauncherEntryKind::SteamApp;
    entry.target = "438100".to_string();
    entry.args = "--ignored".to_string();
    entry.working_directory = Some("C:\\Temp".to_string());
    entry.stop_policy = AppLauncherStopPolicy::CloseByVrcx;

    let entries = normalize_app_launcher_entries(vec![entry]);
    assert_eq!(entries[0].stop_policy, AppLauncherStopPolicy::KeepRunning);
    assert!(entries[0].args.is_empty());
    assert_eq!(entries[0].working_directory, None);
}

#[test]
fn app_launcher_untracked_close_fallback_excludes_steam_client() {
    let mut cacher_entry = local_entry("cacher");
    cacher_entry.target = if cfg!(windows) {
        "D:\\SteamLibrary\\steamapps\\common\\VRCVideoCacher\\VRCVideoCacher.exe"
    } else {
        "/home/user/.local/share/Steam/steamapps/common/VRCVideoCacher/VRCVideoCacher"
    }
    .to_string();
    let cacher_run = new_run("run-cacher", &cacher_entry, false);

    assert_eq!(
        process_name_from_target_for_platform(
            r"D:\SteamLibrary\steamapps\common\VRCVideoCacher\VRCVideoCacher.exe",
            true
        )
        .as_deref(),
        Some("vrcvideocacher")
    );
    assert_eq!(
        process_name_for_run(&cacher_run).as_deref(),
        Some("vrcvideocacher")
    );
    assert!(should_close_untracked_matching_processes(
        process_name_for_run(&cacher_run).as_deref(),
        &[],
        &[]
    ));
    assert!(!should_close_untracked_matching_processes(
        process_name_for_run(&cacher_run).as_deref(),
        &[123],
        &[]
    ));
    assert!(!should_close_untracked_matching_processes(
        process_name_for_run(&cacher_run).as_deref(),
        &[],
        &[123]
    ));

    let mut steam_entry = local_entry("steam-local");
    steam_entry.target = if cfg!(windows) {
        "C:\\Program Files (x86)\\Steam\\steam.exe"
    } else {
        "/home/user/.local/share/Steam/steam"
    }
    .to_string();
    let steam_run = new_run("run-steam", &steam_entry, false);

    assert_eq!(
        process_name_from_target_for_platform("C:\\Program Files (x86)\\Steam\\steam.exe", true)
            .as_deref(),
        Some("steam")
    );
    assert_eq!(process_name_for_run(&steam_run).as_deref(), Some("steam"));
    assert!(!should_close_untracked_matching_processes(
        process_name_for_run(&steam_run).as_deref(),
        &[],
        &[]
    ));

    assert_eq!(
        process_name_from_target_for_platform("/home/user/.local/share/Steam/steam.sh", false)
            .as_deref(),
        Some("steam.sh")
    );
    assert!(!should_close_untracked_matching_processes(
        Some("steam.sh"),
        &[],
        &[]
    ));
}

#[test]
fn app_launcher_untracked_close_fallback_requires_matching_exe_path() {
    let windows_target = r"D:\SteamLibrary\steamapps\common\VRCVideoCacher\VRCVideoCacher.exe";
    assert_eq!(
        normalized_process_path_for_platform(
            r"\\?\D:/SteamLibrary/steamapps/common/VRCVideoCacher/VRCVideoCacher.exe",
            true
        ),
        normalized_process_path_for_platform(windows_target, true)
    );
    assert_eq!(
        normalized_process_path_for_platform(
            r"d:\steamlibrary\STEAMAPPS\common\VRCVideoCacher\VRCVideoCacher.exe",
            true
        ),
        normalized_process_path_for_platform(windows_target, true)
    );
    assert_ne!(
        normalized_process_path_for_platform(r"C:\Other\VRCVideoCacher.exe", true),
        normalized_process_path_for_platform(windows_target, true)
    );

    let linux_target = "/home/User/.local/share/Steam/steamapps/common/Tool/Tool.AppImage";
    assert_eq!(
        normalized_process_path_for_platform(linux_target, false),
        normalized_process_path_for_platform(linux_target, false)
    );
    assert_ne!(
        normalized_process_path_for_platform(
            "/home/user/.local/share/Steam/steamapps/common/Tool/Tool.AppImage",
            false
        ),
        normalized_process_path_for_platform(linux_target, false)
    );
}

#[test]
fn app_launcher_omits_empty_args_from_serialized_entries() {
    let entry = normalize_app_launcher_entries(vec![local_entry("local")])
        .into_iter()
        .next()
        .unwrap();
    let value = serde_json::to_value(entry).unwrap();

    assert!(value.get("args").is_none());
}

#[test]
fn app_launcher_normalization_makes_duplicate_ids_unique() {
    let first = local_entry("same");
    let second = local_entry("same");
    let entries = normalize_app_launcher_entries(vec![first, second]);

    assert_eq!(entries[0].id, "same");
    assert_eq!(entries[1].id, "same-1");
}

#[test]
fn app_launcher_json_invalid_config_falls_back_to_empty_entries() {
    let entries = deserialize_app_launcher_entries(serde_json::json!({ "bad": true }));
    assert!(entries.is_empty());
}

#[test]
fn app_launcher_json_round_trips_entries() {
    let entry = local_entry("local");
    let value = serde_json::to_value(vec![entry.clone()]).unwrap();
    assert_eq!(deserialize_app_launcher_entries(value), vec![entry]);
}

#[test]
fn app_launcher_run_policy_skips_when_process_is_running() {
    let mut entry = local_entry("local");
    entry.run_policy = AppLauncherRunPolicy::SkipIfRunning;
    entry.process_name = Some("Tool.exe".to_string());

    assert!(should_skip_entry(&entry, |name| name == "tool"));
    assert!(!should_skip_entry(&entry, |name| name == "other"));
}

#[test]
fn app_launcher_always_policy_does_not_skip_existing_process() {
    let entry = local_entry("local");
    assert!(!should_skip_entry(&entry, |_| true));
}

#[test]
fn app_launcher_stop_policy_uses_only_tracked_pids() {
    let mut run = new_run("run", &local_entry("local"), false);
    run.root_pid = Some(42);
    run.tracked_pids = vec![10, 42, 99];
    assert_eq!(tracked_stop_pids(&run), vec![10, 42, 99]);
}

#[test]
fn app_launcher_steam_url_uses_launch_scheme() {
    assert_eq!(
        steam_launch_url("438100"),
        Some("steam://launch/438100".to_string())
    );
    assert_eq!(steam_launch_url(""), None);
}

#[test]
fn app_launcher_picks_steam_url_shortcut() {
    let path = std::env::temp_dir().join(format!("vrcx-steam-shortcut-{}.url", now_timestamp()));
    std::fs::write(&path, "[InternetShortcut]\nURL=steam://rungameid/438100\n").unwrap();

    let picked = picked_app_launcher_target(&path).unwrap();
    let _ = std::fs::remove_file(&path);

    assert_eq!(picked.kind, AppLauncherEntryKind::SteamApp);
    assert_eq!(picked.target, "438100");
    assert_eq!(picked.process_name, None);
}

#[test]
fn app_launcher_picks_local_exe_with_process_name() {
    let picked = picked_app_launcher_target("Overlay.exe").unwrap();

    assert_eq!(picked.kind, AppLauncherEntryKind::LocalApp);
    assert_eq!(picked.name, "Overlay");
    assert_eq!(picked.process_name, Some("Overlay".to_string()));
    assert_eq!(picked.working_directory, None);
}

#[test]
fn app_launcher_picks_shortcut_without_guessing_process_name() {
    let picked = picked_app_launcher_target("Overlay.lnk").unwrap();

    assert_eq!(picked.kind, AppLauncherEntryKind::LocalApp);
    assert_eq!(picked.name, "Overlay");
    assert_eq!(picked.process_name, None);
    assert_eq!(picked.working_directory, None);
}

#[test]
fn app_launcher_shortcut_skip_policy_requires_explicit_process_name() {
    let mut entry = local_entry("shortcut");
    entry.target = "Overlay.lnk".to_string();
    entry.run_policy = AppLauncherRunPolicy::SkipIfRunning;

    assert!(!should_skip_entry(&entry, |_| true));
}

#[test]
fn app_launcher_entries_set_applies_to_active_session() {
    let manager = AutoAppLaunchManager::new(true, Vec::new());
    manager.on_game_started(false);

    let snapshot = manager.set_entries(vec![local_entry("local")]);
    assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);

    let snapshot = manager.set_entries(Vec::new());
    assert!(snapshot.active_session.unwrap().runs.is_empty());
}

#[test]
fn app_launcher_disabling_entry_removes_active_session_run() {
    let manager = AutoAppLaunchManager::new(true, vec![local_entry("local")]);
    manager.on_game_started(false);

    let mut disabled = local_entry("local");
    disabled.enabled = false;
    let snapshot = manager.set_entries(vec![disabled]);

    assert!(snapshot.active_session.unwrap().runs.is_empty());
}

#[test]
fn app_launcher_global_disable_reenable_applies_to_active_session() {
    let manager = AutoAppLaunchManager::new(true, vec![local_entry("local")]);
    manager.on_game_started(false);

    let snapshot = manager.set_enabled(false);
    assert!(snapshot.active_session.as_ref().unwrap().runs.is_empty());

    let snapshot = manager.set_enabled(true);
    assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);
}

#[test]
fn app_launcher_enabling_after_disabled_game_start_applies_rules() {
    let manager = AutoAppLaunchManager::new(false, vec![local_entry("local")]);
    manager.on_game_started(false);

    let snapshot = manager.set_enabled(true);

    assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);
}

#[test]
fn app_launcher_steamvr_change_applies_vr_scope_to_active_session() {
    let mut desktop = local_entry("desktop");
    desktop.scope = AppLauncherScope::Desktop;
    let mut vr = local_entry("vr");
    vr.scope = AppLauncherScope::Vr;
    let manager = AutoAppLaunchManager::new(true, vec![desktop, vr]);
    manager.on_game_started(false);

    let snapshot = manager.snapshot();
    let session = snapshot.active_session.unwrap();
    assert!(!session.steamvr_running);
    assert_eq!(session.runs.len(), 1);
    assert_eq!(session.runs[0].entry_id, "desktop");

    manager.on_steamvr_changed(true);

    let snapshot = manager.snapshot();
    let session = snapshot.active_session.unwrap();
    assert!(session.steamvr_running);
    assert_eq!(session.runs.len(), 1);
    assert_eq!(session.runs[0].entry_id, "vr");
}

#[test]
fn app_launcher_game_start_with_steamvr_applies_vr_scope() {
    let mut desktop = local_entry("desktop");
    desktop.scope = AppLauncherScope::Desktop;
    let mut vr = local_entry("vr");
    vr.scope = AppLauncherScope::Vr;
    let manager = AutoAppLaunchManager::new(true, vec![desktop, vr]);

    manager.on_game_started(true);

    let snapshot = manager.snapshot();
    let session = snapshot.active_session.unwrap();
    assert!(session.steamvr_running);
    assert_eq!(session.runs.len(), 1);
    assert_eq!(session.runs[0].entry_id, "vr");
}

#[test]
fn app_launcher_args_split_preserves_quoted_values() {
    assert_eq!(
        split_command_line_args(r#"--flag "two words" \"literal\""#).unwrap(),
        vec!["--flag", "two words", r#""literal""#]
    );
    assert!(split_command_line_args(r#""unterminated"#).is_err());
}
