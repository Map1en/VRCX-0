use super::*;

pub struct AutoAppLaunchManager {
    inner: Arc<Mutex<Inner>>,
}

impl Clone for AutoAppLaunchManager {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

pub(super) struct Inner {
    enabled: bool,
    entries: Vec<AppLauncherEntry>,
    pub(super) active_session: Option<AppLauncherSession>,
    pub(super) test_runs: Vec<AppLauncherRun>,
    generation: u64,
    next_id: u64,
}

impl AutoAppLaunchManager {
    pub fn new(enabled: bool, entries: Vec<AppLauncherEntry>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                enabled,
                entries: normalize_app_launcher_entries(entries),
                active_session: None,
                test_runs: Vec::new(),
                generation: 0,
                next_id: 0,
            })),
        }
    }

    pub fn snapshot(&self) -> AppLauncherSnapshot {
        let mut inner = self.inner.lock().unwrap();
        refresh_runs(&mut inner);
        inner.snapshot()
    }

    pub fn set_enabled(&self, enabled: bool) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.enabled = enabled;
            if enabled {
                reconcile_active_session_entries(&mut inner, self, &mut delayed);
            } else if let Some(session) = inner.active_session.as_mut() {
                session.runs.clear();
            }
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn set_entries(&self, entries: Vec<AppLauncherEntry>) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.entries = normalize_app_launcher_entries(entries);
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn on_game_started(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            let generation = inner.generation;
            let session_id = inner.next_prefixed_id("session");
            let started_at = now_timestamp();
            if !inner.enabled {
                inner.active_session = Some(AppLauncherSession {
                    id: session_id,
                    steamvr_running: is_steamvr_running,
                    started_at,
                    runs: Vec::new(),
                });
                return;
            }

            stop_close_by_vrcx_session(&mut inner);

            let entries: Vec<AppLauncherEntry> = inner
                .entries
                .iter()
                .filter(|entry| entry.enabled && scope_matches(entry.scope, is_steamvr_running))
                .cloned()
                .collect();

            inner.active_session = Some(AppLauncherSession {
                id: session_id.clone(),
                steamvr_running: is_steamvr_running,
                started_at,
                runs: Vec::new(),
            });

            for entry in entries {
                schedule_session_entry(
                    &mut inner,
                    self,
                    &mut delayed,
                    &session_id,
                    generation,
                    entry,
                );
            }
        }

        spawn_delayed_launches(delayed);
    }

    pub fn on_game_stopped(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.generation = inner.generation.saturating_add(1);
        stop_close_by_vrcx_session(&mut inner);
        inner.active_session = None;
    }

    pub fn on_steamvr_changed(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            let needs_reconcile = inner
                .active_session
                .as_ref()
                .is_some_and(|session| session.steamvr_running != is_steamvr_running);
            if !needs_reconcile {
                return;
            }
            inner.generation = inner.generation.saturating_add(1);
            if let Some(session) = inner.active_session.as_mut() {
                session.steamvr_running = is_steamvr_running;
            }
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
        }
        spawn_delayed_launches(delayed);
    }

    pub fn test_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(entry) = inner
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .cloned()
        else {
            return Err(format!("VRChat Startup Apps entry not found: {entry_id}"));
        };

        let run_id = inner.next_prefixed_id("test");
        let mut run = new_run(&run_id, &entry, true);
        launch_entry(&mut run, &entry);
        inner.test_runs.push(run);
        refresh_runs(&mut inner);
        Ok(inner.snapshot())
    }

    pub fn stop_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(run) = inner.test_runs.iter_mut().find(|run| run.id == run_id) else {
            return Err(format!("VRChat Startup Apps test run not found: {run_id}"));
        };
        stop_tracked_run(run);
        refresh_runs(&mut inner);
        Ok(inner.snapshot())
    }

    fn launch_delayed_session_entry(
        &self,
        session_id: &str,
        run_id: &str,
        entry: AppLauncherEntry,
        generation: u64,
    ) {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        let Some(session) = inner.active_session.as_ref() else {
            return;
        };
        if session.id != session_id {
            return;
        }
        let Some(run) = find_session_run_mut(&mut inner, run_id) else {
            return;
        };
        launch_entry(run, &entry);
    }
}

struct DelayedLaunch {
    manager: AutoAppLaunchManager,
    session_id: String,
    run_id: String,
    entry: AppLauncherEntry,
    generation: u64,
    delay_seconds: u32,
}

fn spawn_delayed_launches(delayed: Vec<DelayedLaunch>) {
    for launch in delayed {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(u64::from(launch.delay_seconds)));
            launch.manager.launch_delayed_session_entry(
                &launch.session_id,
                &launch.run_id,
                launch.entry,
                launch.generation,
            );
        });
    }
}

fn schedule_session_entry(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
    session_id: &str,
    generation: u64,
    entry: AppLauncherEntry,
) {
    let run_id = inner.next_prefixed_id("run");
    let delay = entry.launch_delay_seconds;
    push_session_run(inner, new_run(&run_id, &entry, false));
    if delay == 0 {
        if let Some(run) = find_session_run_mut(inner, &run_id) {
            launch_entry(run, &entry);
        }
    } else if let Some(run) = find_session_run_mut(inner, &run_id) {
        run.status = AppLauncherRunStatus::Waiting;
        delayed.push(DelayedLaunch {
            manager: manager.clone(),
            session_id: session_id.to_string(),
            run_id,
            entry,
            generation,
            delay_seconds: delay,
        });
    }
}

fn reconcile_active_session_entries(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
) {
    if !inner.enabled {
        if let Some(session) = inner.active_session.as_mut() {
            session.runs.clear();
        }
        return;
    }
    let Some(session) = inner.active_session.as_ref() else {
        return;
    };
    let steamvr_running = session.steamvr_running;
    let session_id = session.id.clone();
    let generation = inner.generation;
    let desired_entries: Vec<AppLauncherEntry> = inner
        .entries
        .iter()
        .filter(|entry| entry.enabled && scope_matches(entry.scope, steamvr_running))
        .cloned()
        .collect();

    if let Some(session) = inner.active_session.as_mut() {
        session.runs.retain_mut(|run| {
            let Some(entry) = desired_entries
                .iter()
                .find(|entry| entry.id == run.entry_id)
            else {
                return false;
            };
            if matches!(run.status, AppLauncherRunStatus::Waiting) {
                return false;
            }
            if run.entry_signature != entry_signature(entry) {
                return false;
            }
            run.entry_name = entry.name.clone();
            run.stop_policy = entry.stop_policy.clone();
            true
        });
    }

    let active_entry_ids: HashSet<String> = inner
        .active_session
        .as_ref()
        .map(|session| {
            session
                .runs
                .iter()
                .map(|run| run.entry_id.clone())
                .collect()
        })
        .unwrap_or_default();

    for entry in desired_entries {
        if !active_entry_ids.contains(&entry.id) {
            schedule_session_entry(inner, manager, delayed, &session_id, generation, entry);
        }
    }
}

impl Inner {
    fn next_prefixed_id(&mut self, prefix: &str) -> String {
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}-{}-{}", now_timestamp(), self.next_id)
    }

    fn snapshot(&self) -> AppLauncherSnapshot {
        AppLauncherSnapshot {
            enabled: self.enabled,
            entries: self.entries.clone(),
            active_session: self.active_session.clone(),
            test_runs: self.test_runs.clone(),
        }
    }
}

pub(super) fn new_run(id: &str, entry: &AppLauncherEntry, test: bool) -> AppLauncherRun {
    AppLauncherRun {
        id: id.to_string(),
        entry_id: entry.id.clone(),
        entry_name: entry.name.clone(),
        kind: entry.kind.clone(),
        target: entry.target.clone(),
        status: AppLauncherRunStatus::Waiting,
        stop_policy: entry.stop_policy.clone(),
        test,
        root_pid: None,
        tracked_pids: Vec::new(),
        started_at: None,
        finished_at: None,
        error: None,
        skipped_reason: None,
        entry_signature: entry_signature(entry),
    }
}

pub(super) fn entry_signature(entry: &AppLauncherEntry) -> String {
    format!(
        "{:?}\u{1f}{}\u{1f}{}\u{1f}{}",
        entry.kind,
        entry.target,
        entry.args,
        entry.working_directory.as_deref().unwrap_or_default()
    )
}

fn push_session_run(inner: &mut Inner, run: AppLauncherRun) {
    if let Some(session) = inner.active_session.as_mut() {
        session.runs.push(run);
    }
}

fn find_session_run_mut<'a>(inner: &'a mut Inner, run_id: &str) -> Option<&'a mut AppLauncherRun> {
    inner
        .active_session
        .as_mut()?
        .runs
        .iter_mut()
        .find(|run| run.id == run_id)
}
