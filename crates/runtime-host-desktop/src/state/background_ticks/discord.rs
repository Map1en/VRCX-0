use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use serde_json::json;
use vrcx_0_application_game::{
    build_background_discord_presence_command, build_background_presence_facts,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState, BackgroundPresenceFactsInput,
    DiscordPresenceLabels,
};
use vrcx_0_host_desktop::discord_rpc::DiscordRpc;
use vrcx_0_i18n::{text, DiscordPresenceKey};
use vrcx_0_persistence::config::ConfigRepository;

use super::{
    background_capability_session, emit_background_error, emit_background_info_if_changed,
    emit_background_warning, remember_background_output_if_changed,
    BACKGROUND_DISCORD_CADENCE_SECONDS, BACKGROUND_DISCORD_PRESENCE_JOB,
};
use super::{BackgroundTickContext, LocalGameFacts};

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
#[derive(Default)]
pub(in crate::state) struct DiscordPresenceLabelCache {
    language: String,
    labels: Option<Arc<DiscordPresenceLabels>>,
}

impl DiscordPresenceLabelCache {
    pub(in crate::state) fn get(
        &mut self,
        config: &ConfigRepository,
    ) -> Arc<DiscordPresenceLabels> {
        let language = config
            .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
            .unwrap_or_else(|_| "en".into());
        self.get_for_language(&language)
    }

    fn get_for_language(&mut self, language: &str) -> Arc<DiscordPresenceLabels> {
        if self.labels.is_none() || self.language != language {
            self.labels = Some(Arc::new(discord_presence_labels(language)));
            self.language = language.to_string();
        }
        Arc::clone(
            self.labels
                .as_ref()
                .expect("Discord presence labels were initialized"),
        )
    }
}

fn discord_presence_labels(language: &str) -> DiscordPresenceLabels {
    let localized = |key| text(language, key);
    DiscordPresenceLabels {
        access_public: localized(DiscordPresenceKey::DiscordAccessPublic),
        access_invite_plus: localized(DiscordPresenceKey::DiscordAccessInvitePlus),
        access_invite: localized(DiscordPresenceKey::DiscordAccessInvite),
        access_friends: localized(DiscordPresenceKey::DiscordAccessFriends),
        access_friends_plus: localized(DiscordPresenceKey::DiscordAccessFriendsPlus),
        access_group: localized(DiscordPresenceKey::DiscordAccessGroup),
        group_access_public: localized(DiscordPresenceKey::DiscordAccessGroupPublic),
        group_access_plus: localized(DiscordPresenceKey::DiscordAccessGroupPlus),
        group_access_members: localized(DiscordPresenceKey::DiscordAccessGroupMembers),
        status_active: localized(DiscordPresenceKey::DiscordStatusActive),
        status_join_me: localized(DiscordPresenceKey::DiscordStatusJoinMe),
        status_ask_me: localized(DiscordPresenceKey::DiscordStatusAskMe),
        status_busy: localized(DiscordPresenceKey::DiscordStatusBusy),
        status_offline: localized(DiscordPresenceKey::DiscordStatusOffline),
        platform_desktop: localized(DiscordPresenceKey::DiscordPlatformDesktop),
        platform_vr: localized(DiscordPresenceKey::DiscordPlatformVr),
        private_world: localized(DiscordPresenceKey::DiscordPrivateWorld),
    }
}

pub(in crate::state) async fn run_background_discord_tick(
    context: &BackgroundTickContext<'_>,
    discord_rpc: &Arc<DiscordRpc>,
    discord_state: &mut BackgroundDiscordPresenceState,
    last_discord_output: &mut Option<String>,
    labels: &DiscordPresenceLabels,
    friend_user_ids: &HashSet<String>,
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Running background Discord presence.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_DISCORD_PRESENCE_JOB,
            "Background Discord presence is waiting for an authenticated session.",
            BACKGROUND_DISCORD_CADENCE_SECONDS,
        );
        return;
    };
    let local_game = LocalGameFacts::from_context(context);
    let favorite_world_groups_by_key = HashMap::new();
    let game_state_store =
        crate::game_state_store::PersistenceGameStateStore::new(Arc::clone(context.db));
    let background_remote = crate::background_remote::DesktopBackgroundRemoteApi::new(
        Arc::clone(context.web),
        Arc::clone(context.world_cache),
    );
    let facts = match build_background_presence_facts(
        &game_state_store,
        BackgroundPresenceFactsInput {
            session,
            is_game_running: local_game.is_game_running,
            is_steamvr_running: local_game.is_steamvr_running,
            is_game_no_vr: local_game.is_game_no_vr,
            last_game_started_at: local_game.last_game_started_at,
            game_log_snapshot: local_game.game_log_snapshot,
            now_playing: local_game.now_playing,
            friend_user_ids,
            favorite_friend_groups_by_key,
            favorite_world_groups_by_key: &favorite_world_groups_by_key,
        },
    ) {
        Ok(facts) => facts,
        Err(error) => {
            let detail = format!("Discord presence facts failed: {error}.");
            if remember_background_output_if_changed(last_discord_output, &detail) {
                tracing::warn!(error = %error, "background Discord facts build failed");
                emit_background_error(context.event_bus, context.backend_runtime, detail);
            }
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };
    let command = match build_background_discord_presence_command(
        &game_state_store,
        &background_remote,
        &facts,
        labels,
        discord_state,
        false,
    )
    .await
    {
        Ok(command) => command,
        Err(error) => {
            let detail = format!("Discord presence compose failed: {error}.");
            if remember_background_output_if_changed(last_discord_output, &detail) {
                tracing::warn!(error = %error, "background Discord presence compose failed");
                emit_background_error(context.event_bus, context.backend_runtime, detail);
            }
            context
                .background_jobs
                .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
            return;
        }
    };

    let detail = match command {
        BackgroundDiscordPresenceCommand::Noop { detail } => detail,
        BackgroundDiscordPresenceCommand::Clear { detail } => {
            let rpc = Arc::clone(discord_rpc);
            match tokio::task::spawn_blocking(move || rpc.clear()).await {
                Ok(Ok(())) => {
                    discord_state.apply_clear_result();
                    emit_background_info_if_changed(
                        context.event_bus,
                        context.backend_runtime,
                        last_discord_output,
                        format!("Discord presence cleared: {detail}"),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_clear_failure();
                    let detail = format!("Discord clear failed: {error}.");
                    if remember_background_output_if_changed(last_discord_output, &detail) {
                        tracing::warn!(error = %error, "background Discord clear failed");
                        emit_background_warning(context.event_bus, context.backend_runtime, detail);
                    }
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_clear_failure();
                    let detail = format!("Discord clear task failed: {error}.");
                    if remember_background_output_if_changed(last_discord_output, &detail) {
                        tracing::warn!(error = %error, "background Discord clear task failed");
                        emit_background_error(context.event_bus, context.backend_runtime, detail);
                    }
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
        BackgroundDiscordPresenceCommand::SetAssets { payload } => {
            let detail = payload.detail.clone();
            let rpc = Arc::clone(discord_rpc);
            let rpc_payload = json!({
                "appId": payload.app_id,
                "activity": payload.activity.clone(),
            });
            match tokio::task::spawn_blocking(move || rpc.set_assets(rpc_payload)).await {
                Ok(Ok(result)) => {
                    discord_state.apply_set_assets_result(&payload, result);
                    emit_background_info_if_changed(
                        context.event_bus,
                        context.backend_runtime,
                        last_discord_output,
                        format!("Discord activity sent: {detail}"),
                    );
                    detail
                }
                Ok(Err(error)) => {
                    discord_state.apply_set_assets_result(&payload, false);
                    let detail = format!("Discord SetAssets failed: {error}.");
                    if remember_background_output_if_changed(last_discord_output, &detail) {
                        tracing::warn!(error = %error, "background Discord SetAssets failed");
                        emit_background_warning(context.event_bus, context.backend_runtime, detail);
                    }
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
                Err(error) => {
                    discord_state.apply_set_assets_result(&payload, false);
                    let detail = format!("Discord SetAssets task failed: {error}.");
                    if remember_background_output_if_changed(last_discord_output, &detail) {
                        tracing::warn!(error = %error, "background Discord SetAssets task failed");
                        emit_background_error(context.event_bus, context.backend_runtime, detail);
                    }
                    context
                        .background_jobs
                        .mark_failed(BACKGROUND_DISCORD_PRESENCE_JOB, error.to_string());
                    return;
                }
            }
        }
    };
    context
        .background_jobs
        .mark_completed(BACKGROUND_DISCORD_PRESENCE_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_DISCORD_PRESENCE_JOB,
        "Next background Discord presence tick is waiting.",
        BACKGROUND_DISCORD_CADENCE_SECONDS,
    );
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{remember_background_output_if_changed, DiscordPresenceLabelCache};

    #[test]
    fn discord_presence_labels_are_reused_until_the_language_changes() {
        let mut cache = DiscordPresenceLabelCache::default();

        let first = cache.get_for_language("en");
        let second = cache.get_for_language("en");
        let japanese = cache.get_for_language("ja");

        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&second, &japanese));
        assert_ne!(first.private_world, japanese.private_world);
    }

    #[test]
    fn repeated_discord_failure_is_suppressed_until_output_changes() {
        let mut last_detail = None;

        assert!(remember_background_output_if_changed(
            &mut last_detail,
            "Discord SetAssets failed: pipe closed."
        ));
        assert!(!remember_background_output_if_changed(
            &mut last_detail,
            "Discord SetAssets failed: pipe closed."
        ));
        assert!(remember_background_output_if_changed(
            &mut last_detail,
            "Discord activity sent: VRChat"
        ));
        assert!(remember_background_output_if_changed(
            &mut last_detail,
            "Discord SetAssets failed: pipe closed."
        ));
    }
}
