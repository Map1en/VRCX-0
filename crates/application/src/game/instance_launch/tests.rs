use super::*;

use serde::Deserialize;
use vrcx_0_application_core::{CallRecorder, ScriptedResults};
use vrcx_0_contracts::vrchat_api::vrchat_response;
use vrcx_0_core::presence::PresenceKind;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;

struct MockApi {
    short_name_calls: CallRecorder<(String, String, String)>,
    self_invite_calls: CallRecorder<(String, String, String, String)>,
    short_name_status: i32,
    short_name_body: String,
    self_invite_status: i32,
    self_invite_body: String,
}

impl Default for MockApi {
    fn default() -> Self {
        Self {
            short_name_calls: CallRecorder::default(),
            self_invite_calls: CallRecorder::default(),
            short_name_status: 200,
            short_name_body: r#"{"shortName":"resolvedTok"}"#.to_string(),
            self_invite_status: 200,
            self_invite_body: "{}".to_string(),
        }
    }
}

impl InstanceLaunchHttpClient for MockApi {
    fn instance_short_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            self.short_name_calls.record((
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
            ));
            Ok(vrchat_response(
                self.short_name_status,
                self.short_name_body.clone(),
            ))
        })
    }

    fn self_invite<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
        short_name: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            self.self_invite_calls.record((
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                short_name.to_string(),
            ));
            Ok(vrchat_response(
                self.self_invite_status,
                self.self_invite_body.clone(),
            ))
        })
    }
}

struct MockLaunchPipe {
    calls: CallRecorder<String>,
    results: ScriptedResults<bool>,
}

impl MockLaunchPipe {
    fn with_results(results: Vec<bool>) -> Self {
        Self {
            calls: CallRecorder::default(),
            results: ScriptedResults::new(results),
        }
    }
}

impl InstanceLaunchPipe for MockLaunchPipe {
    fn try_open_vrchat_launch_url(
        &self,
        launch_url: &str,
    ) -> vrcx_0_application_core::Result<bool> {
        self.calls.record(launch_url.to_string());
        Ok(self.results.next())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GateParityBatch {
    current_user_id: String,
    current_invite_location: String,
    is_game_running: bool,
    friend_user_ids: Vec<String>,
    closed_locations: Vec<String>,
    targets: Vec<GateParityTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GateParityTarget {
    key: String,
    user_id: String,
    location: String,
    presence_kind: PresenceKind,
    is_current_user: bool,
    expected: GateParityExpected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GateParityExpected {
    can_join: bool,
    can_open_in_game: bool,
    can_self_invite: bool,
    can_request_invite: bool,
    can_invite: bool,
}

#[tokio::test]
async fn auto_join_stops_after_launch_pipe_success() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![true]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)".to_string(),
            short_name: "tok123".to_string(),
            mode: InstanceLaunchMode::Auto,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::Opened);
    assert_eq!(
        launch_pipe.calls.snapshot().as_slice(),
        ["vrchat://launch?id=wrld_test:12345~hidden(usr_owner)&shortName=tok123"]
    );
    assert!(api.short_name_calls.is_empty());
    assert!(api.self_invite_calls.is_empty());
}

#[tokio::test]
async fn auto_join_self_invites_after_launch_pipe_false() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![false]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)".to_string(),
            short_name: "tok123".to_string(),
            mode: InstanceLaunchMode::Auto,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::SelfInvited);
    assert_eq!(
        api.self_invite_calls.snapshot().as_slice(),
        [(
            VRCHAT_API_DEFAULT_ENDPOINT.to_string(),
            "wrld_test".to_string(),
            "12345~hidden(usr_owner)".to_string(),
            "tok123".to_string()
        )]
    );
}

#[tokio::test]
async fn open_only_returns_failed_without_self_invite_fallback() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![false]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)".to_string(),
            short_name: "tok123".to_string(),
            mode: InstanceLaunchMode::OpenOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        outcome,
        InstanceLaunchOutcome::Failed {
            reason: "VRChat launch pipe did not accept the URL.".to_string()
        }
    );
    assert!(api.self_invite_calls.is_empty());
}

#[tokio::test]
async fn self_invite_only_skips_launch_pipe() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)".to_string(),
            short_name: "tok123".to_string(),
            mode: InstanceLaunchMode::SelfInviteOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::SelfInvited);
    assert!(launch_pipe.calls.is_empty());
    assert_eq!(api.self_invite_calls.len(), 1);
}

#[tokio::test]
async fn self_invite_prefers_explicit_short_name_over_location_token() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)&shortName=staleLocationToken".to_string(),
            short_name: "freshExplicitToken".to_string(),
            mode: InstanceLaunchMode::SelfInviteOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::SelfInvited);
    assert_eq!(
        api.self_invite_calls.snapshot().as_slice(),
        [(
            VRCHAT_API_DEFAULT_ENDPOINT.to_string(),
            "wrld_test".to_string(),
            "12345~hidden(usr_owner)".to_string(),
            "freshExplicitToken".to_string()
        )]
    );
}

#[tokio::test]
async fn self_invite_uses_location_token_when_explicit_short_name_is_empty() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)&shortName=locationToken".to_string(),
            short_name: String::new(),
            mode: InstanceLaunchMode::SelfInviteOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::SelfInvited);
    assert_eq!(
        api.self_invite_calls.snapshot().as_slice(),
        [(
            VRCHAT_API_DEFAULT_ENDPOINT.to_string(),
            "wrld_test".to_string(),
            "12345~hidden(usr_owner)".to_string(),
            "locationToken".to_string()
        )]
    );
}

#[tokio::test]
async fn invalid_join_location_returns_failed_outcome() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "private".to_string(),
            short_name: "".to_string(),
            mode: InstanceLaunchMode::Auto,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        outcome,
        InstanceLaunchOutcome::Failed {
            reason: "Unable to open this instance in VRChat.".to_string()
        }
    );
    assert!(launch_pipe.calls.is_empty());
    assert!(api.self_invite_calls.is_empty());
}

#[tokio::test]
async fn self_invite_api_error_maps_to_failed_outcome() {
    let api = MockApi {
        self_invite_status: 403,
        self_invite_body: r#"{"error":{"message":"No invite permission"}}"#.to_string(),
        ..MockApi::default()
    };
    let launch_pipe = MockLaunchPipe::with_results(vec![]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345~hidden(usr_owner)".to_string(),
            short_name: "tok123".to_string(),
            mode: InstanceLaunchMode::SelfInviteOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        outcome,
        InstanceLaunchOutcome::Failed {
            reason: "No invite permission".to_string()
        }
    );
}

#[tokio::test]
async fn public_launch_resolves_short_name_even_when_token_is_provided() {
    let api = MockApi::default();
    let launch_pipe = MockLaunchPipe::with_results(vec![true]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345".to_string(),
            short_name: "providedTok".to_string(),
            mode: InstanceLaunchMode::OpenOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::Opened);
    assert_eq!(api.short_name_calls.len(), 1);
    assert_eq!(
        launch_pipe.calls.snapshot().as_slice(),
        ["vrchat://launch?id=wrld_test:12345&shortName=resolvedTok"]
    );
}

#[tokio::test]
async fn launch_url_omits_short_name_when_none_is_available() {
    let api = MockApi {
        short_name_body: "{}".to_string(),
        ..MockApi::default()
    };
    let launch_pipe = MockLaunchPipe::with_results(vec![true]);
    let outcome = join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        InstanceLaunchInput {
            location: "wrld_test:12345".to_string(),
            short_name: "".to_string(),
            mode: InstanceLaunchMode::OpenOnly,
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome, InstanceLaunchOutcome::Opened);
    assert_eq!(
        launch_pipe.calls.snapshot().as_slice(),
        ["vrchat://launch?id=wrld_test:12345"]
    );
}

#[test]
fn gate_batch_evaluates_basic_invite_permissions() {
    let output = evaluate_instance_action_gates(InstanceActionGatesBatchInput {
        current_user_id: "usr_me".to_string(),
        current_invite_location: "wrld_hidden:12345~hidden(usr_owner)".to_string(),
        is_game_running: true,
        friend_user_ids: vec!["usr_friend".to_string()],
        closed_locations: vec!["wrld_closed:1".to_string()],
        targets: vec![
            InstanceActionGateTarget {
                key: "public-online".to_string(),
                user_id: "usr_public".to_string(),
                location: "wrld_public:12345".to_string(),
                presence_kind: PresenceKind::Online,
                is_current_user: false,
            },
            InstanceActionGateTarget {
                key: "friends-stranger".to_string(),
                user_id: "usr_stranger".to_string(),
                location: "wrld_friends:12345~friends(usr_stranger)".to_string(),
                presence_kind: PresenceKind::Online,
                is_current_user: false,
            },
            InstanceActionGateTarget {
                key: "closed".to_string(),
                user_id: "usr_closed".to_string(),
                location: "wrld_closed:1".to_string(),
                presence_kind: PresenceKind::Online,
                is_current_user: false,
            },
        ],
    });

    assert!(output.targets[0].can_join);
    assert!(output.targets[0].can_open_in_game);
    assert!(output.targets[0].can_self_invite);
    assert!(output.targets[0].can_request_invite);
    assert!(output.targets[0].can_invite);
    assert!(!output.targets[1].can_self_invite);
    assert!(!output.targets[2].can_join);
}

#[test]
fn gate_batch_matches_shared_frontend_parity_cases() {
    let cases: Vec<GateParityBatch> = serde_json::from_str(include_str!(
        "../../../../../src/shared/utils/instanceActionGateParityCases.json"
    ))
    .unwrap();

    for case in cases {
        let output = evaluate_instance_action_gates(InstanceActionGatesBatchInput {
            current_user_id: case.current_user_id,
            current_invite_location: case.current_invite_location,
            is_game_running: case.is_game_running,
            friend_user_ids: case.friend_user_ids,
            closed_locations: case.closed_locations,
            targets: case
                .targets
                .iter()
                .map(|target| InstanceActionGateTarget {
                    key: target.key.clone(),
                    user_id: target.user_id.clone(),
                    location: target.location.clone(),
                    presence_kind: target.presence_kind,
                    is_current_user: target.is_current_user,
                })
                .collect(),
        });
        let expected: Vec<InstanceActionGates> = case
            .targets
            .into_iter()
            .map(|target| InstanceActionGates {
                key: target.key,
                can_join: target.expected.can_join,
                can_open_in_game: target.expected.can_open_in_game,
                can_self_invite: target.expected.can_self_invite,
                can_request_invite: target.expected.can_request_invite,
                can_invite: target.expected.can_invite,
            })
            .collect();
        assert_eq!(output.targets, expected);
    }
}

#[test]
fn check_can_invite_requires_non_standard_private_location_to_match_current_location() {
    let closed_locations = HashSet::new();
    let location = "wrld_hidden:12345~hidden(usr_owner)";
    let parsed = parse_location(location);

    assert!(!check_can_invite(
        location,
        &parsed,
        "usr_me",
        "wrld_other:12345",
        &closed_locations
    ));
    assert!(check_can_invite(
        location,
        &parsed,
        "usr_me",
        location,
        &closed_locations
    ));
}

#[test]
fn gate_batch_blocks_open_but_not_invite_when_game_is_not_running() {
    let output = evaluate_instance_action_gates(InstanceActionGatesBatchInput {
        current_user_id: "usr_me".to_string(),
        current_invite_location: "wrld_public:12345".to_string(),
        is_game_running: false,
        friend_user_ids: vec![],
        closed_locations: vec![],
        targets: vec![InstanceActionGateTarget {
            key: "friend".to_string(),
            user_id: "usr_friend".to_string(),
            location: "wrld_public:12345".to_string(),
            presence_kind: PresenceKind::Online,
            is_current_user: false,
        }],
    });

    assert!(output.targets[0].can_join);
    assert!(!output.targets[0].can_open_in_game);
    assert!(output.targets[0].can_invite);
}

#[test]
fn gate_batch_allows_join_for_non_online_presence_but_not_request_invite() {
    let output = evaluate_instance_action_gates(InstanceActionGatesBatchInput {
        current_user_id: "usr_me".to_string(),
        current_invite_location: "wrld_public:12345".to_string(),
        is_game_running: true,
        friend_user_ids: vec![],
        closed_locations: vec![],
        targets: vec![InstanceActionGateTarget {
            key: "active-friend".to_string(),
            user_id: "usr_friend".to_string(),
            location: "wrld_public:12345".to_string(),
            presence_kind: PresenceKind::Active,
            is_current_user: false,
        }],
    });

    assert!(output.targets[0].can_join);
    assert!(output.targets[0].can_self_invite);
    assert!(output.targets[0].can_open_in_game);
    assert!(!output.targets[0].can_request_invite);
}
