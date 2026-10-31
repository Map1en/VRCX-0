use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use vrcx_0_contracts::vrchat_device_login::{slowed_device_poll_interval, VrchatDeviceStatus};
use vrcx_0_contracts::vrchat_login::VrchatLoginFailureKind;
use vrcx_0_core::TwoFactorMethod;
use vrcx_0_logger_protocol::wire::{
    CredentialsRequest, DeviceLoginRequest, DeviceLoginState, SessionState, TwoFactorRequest,
};

use crate::app::{now_unix, now_unix_millis};
use crate::credentials::{CredentialVault, StoredCredentials};
use crate::profile_scan::ProfileScan;
use crate::recorder::{Recorder, RecorderExit, Segments};
use crate::runtime::{Presence, SessionInfo, Shared};
use crate::store::Store;
use crate::vrchat::{LoginOutcome, ProbeOutcome, TwoFactorOutcome, Vrchat};
use crate::webhook::Notifier;

const RELOGIN_DELAYS: [Duration; 3] = [
    Duration::from_secs(60),
    Duration::from_secs(10 * 60),
    Duration::from_secs(60 * 60),
];
const RATE_LIMIT_DELAY: Duration = Duration::from_secs(10 * 60);
const UNREACHABLE_RELOGIN_DELAY: Duration = Duration::from_secs(60);
const RESTART_BASE_DELAY: Duration = Duration::from_secs(30);
const RESTART_MAX_DELAY: Duration = Duration::from_secs(10 * 60);
const RECORDER_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_EXPIRED_WITHOUT_PASSWORD: &str =
    "VRChat session expired and no password is saved, so the logger will not sign in again by itself; sign in again from VRCX-0 with a QR code or password";
const SHUTTING_DOWN: &str = "logger session is shutting down";

struct PendingDevice {
    client: Arc<Vrchat>,
    account_id: String,
    device_code: String,
    interval: Duration,
    deadline: Instant,
}

enum Command {
    StartDeviceLogin {
        request: DeviceLoginRequest,
        reply: oneshot::Sender<Result<DeviceLoginState, String>>,
    },
    CancelDeviceLogin {
        reply: oneshot::Sender<()>,
    },
    SetCredentials {
        request: CredentialsRequest,
        reply: oneshot::Sender<Result<SessionState, String>>,
    },
    TwoFactor {
        request: TwoFactorRequest,
        reply: oneshot::Sender<Result<SessionState, String>>,
    },
    Unpair {
        reply: oneshot::Sender<()>,
    },
}

#[derive(Clone)]
pub struct SessionHandle {
    commands: mpsc::Sender<Command>,
}

impl SessionHandle {
    pub async fn set_credentials(
        &self,
        request: CredentialsRequest,
    ) -> Result<SessionState, String> {
        self.ask(|reply| Command::SetCredentials { request, reply })
            .await
            .ok_or_else(|| SHUTTING_DOWN.to_string())?
    }

    pub async fn two_factor(&self, request: TwoFactorRequest) -> Result<SessionState, String> {
        self.ask(|reply| Command::TwoFactor { request, reply })
            .await
            .ok_or_else(|| SHUTTING_DOWN.to_string())?
    }

    pub async fn unpair(&self) -> bool {
        self.ask(|reply| Command::Unpair { reply }).await.is_some()
    }

    pub async fn start_device_login(
        &self,
        request: DeviceLoginRequest,
    ) -> Result<DeviceLoginState, String> {
        self.ask(|reply| Command::StartDeviceLogin { request, reply })
            .await
            .ok_or_else(|| SHUTTING_DOWN.to_string())?
    }

    pub async fn cancel_device_login(&self) -> bool {
        self.ask(|reply| Command::CancelDeviceLogin { reply })
            .await
            .is_some()
    }

    async fn ask<R>(&self, command: impl FnOnce(oneshot::Sender<R>) -> Command) -> Option<R> {
        let (reply, response) = oneshot::channel();
        self.commands.send(command(reply)).await.ok()?;
        response.await.ok()
    }
}

pub fn spawn(
    store: Arc<Store>,
    vault: Arc<CredentialVault>,
    presence: Arc<Presence>,
    shared: Arc<Shared>,
    notifier: Arc<Notifier>,
    profile_scan: Arc<ProfileScan>,
) -> SessionHandle {
    let (commands, receiver) = mpsc::channel(16);
    let (exits, exit_receiver) = mpsc::unbounded_channel();
    let supervisor = Supervisor {
        store,
        vault,
        presence,
        shared,
        notifier,
        profile_scan,
        exits,
        client: None,
        pending: None,
        recorder: None,
        generation: 0,
        wake: None,
        restart_delay: RESTART_BASE_DELAY,
        device: None,
        device_wake: None,
    };
    tokio::spawn(supervisor.run(receiver, exit_receiver));
    SessionHandle { commands }
}

struct ActiveRecorder {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
    started: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Wake {
    Relogin { attempt: usize },
    RestartRecorder,
}

#[derive(Debug, PartialEq)]
enum ReloginNext {
    Authenticated(String),
    AwaitTwoFactor(Vec<TwoFactorMethod>),
    Stop(String),
    Retry { attempt: usize, delay: Duration },
}

fn after_relogin(outcome: LoginOutcome, attempt: usize) -> ReloginNext {
    match outcome {
        LoginOutcome::Authenticated { account_id } => ReloginNext::Authenticated(account_id),
        LoginOutcome::TwoFactorRequired { methods } => ReloginNext::AwaitTwoFactor(methods),
        LoginOutcome::Failed {
            reason,
            kind:
                VrchatLoginFailureKind::InvalidCredentials
                | VrchatLoginFailureKind::TwoFactorUnavailable,
        } => ReloginNext::Stop(reason),
        LoginOutcome::RateLimited => ReloginNext::Retry {
            attempt,
            delay: RATE_LIMIT_DELAY,
        },
        LoginOutcome::Network { .. } => ReloginNext::Retry {
            attempt,
            delay: UNREACHABLE_RELOGIN_DELAY,
        },
        LoginOutcome::Failed { reason, .. } => match after_transient_failure(attempt, &reason) {
            Ok((attempt, delay)) => ReloginNext::Retry { attempt, delay },
            Err(reason) => ReloginNext::Stop(reason),
        },
    }
}

fn after_transient_failure(attempt: usize, reason: &str) -> Result<(usize, Duration), String> {
    RELOGIN_DELAYS
        .get(attempt + 1)
        .map(|delay| (attempt + 1, *delay))
        .ok_or_else(|| {
            format!(
                "automatic re-login failed {} times: {reason}",
                RELOGIN_DELAYS.len()
            )
        })
}

struct Supervisor {
    store: Arc<Store>,
    vault: Arc<CredentialVault>,
    presence: Arc<Presence>,
    shared: Arc<Shared>,
    notifier: Arc<Notifier>,
    profile_scan: Arc<ProfileScan>,
    exits: mpsc::UnboundedSender<(u64, RecorderExit)>,
    client: Option<Arc<Vrchat>>,
    pending: Option<CredentialsRequest>,
    recorder: Option<ActiveRecorder>,
    generation: u64,
    wake: Option<(Instant, Wake)>,
    restart_delay: Duration,
    device: Option<PendingDevice>,
    device_wake: Option<Instant>,
}

impl Supervisor {
    async fn run(
        mut self,
        mut commands: mpsc::Receiver<Command>,
        mut exits: mpsc::UnboundedReceiver<(u64, RecorderExit)>,
    ) {
        self.resume().await;
        loop {
            let wake_at = self.wake.map(|(at, _)| at);
            tokio::select! {
                command = commands.recv() => match command {
                    Some(command) => self.handle(command).await,
                    None => {
                        self.stop_recorder().await;
                        return;
                    }
                },
                Some((generation, exit)) = exits.recv() => {
                    if generation == self.generation {
                        if let Some(active) = self.recorder.take() {
                            self.on_recorder_exit(exit, active.started).await;
                        }
                    }
                }
                () = sleep_until(wake_at) => {
                    if let Some((_, wake)) = self.wake.take() {
                        self.on_wake(wake).await;
                    }
                }
                () = sleep_until(self.device_wake) => {
                    self.device_wake = None;
                    self.poll_device().await;
                }
            }
        }
    }

    async fn resume(&mut self) {
        let credentials = match self.vault.load() {
            Ok(Some(credentials)) => credentials,
            Ok(None) => return,
            Err(error) => {
                tracing::error!(error = %error, "failed to read stored credentials");
                return;
            }
        };
        let client = match Vrchat::new(Some(&credentials.cookies)) {
            Ok(client) => Arc::new(client),
            Err(error) => {
                tracing::error!(error, "failed to create the VRChat client");
                return;
            }
        };
        self.client = Some(client.clone());
        self.shared.update(|info| {
            info.account_id = Some(credentials.account_id.clone());
            info.password_saved = credentials.password.is_some();
        });
        self.set_state(SessionState::LoggingIn);
        match client.probe(&credentials.account_id).await {
            ProbeOutcome::Valid => self.start_recorder(credentials.account_id),
            ProbeOutcome::Invalid { reason } => self.session_lost(reason),
            ProbeOutcome::Unreachable { reason } => {
                tracing::warn!(
                    reason,
                    "VRChat is unreachable; recording will keep retrying"
                );
                self.shared.update(|info| info.last_error = Some(reason));
                self.start_recorder(credentials.account_id);
            }
        }
    }

    async fn handle(&mut self, command: Command) {
        match command {
            Command::SetCredentials { request, reply } => {
                let result = self.set_credentials(request).await;
                let _ = reply.send(result);
            }
            Command::TwoFactor { request, reply } => {
                let result = self.two_factor(request).await;
                let _ = reply.send(result);
            }
            Command::Unpair { reply } => {
                self.reset(None).await;
                let _ = reply.send(());
            }
            Command::StartDeviceLogin { request, reply } => {
                let result = self.start_device_login(request).await;
                let _ = reply.send(result);
            }
            Command::CancelDeviceLogin { reply } => {
                self.finish_device(None);
                let _ = reply.send(());
            }
        }
    }

    async fn start_device_login(
        &mut self,
        request: DeviceLoginRequest,
    ) -> Result<DeviceLoginState, String> {
        self.finish_device(None);
        let client = Arc::new(Vrchat::new(None)?);
        let authorization = client.request_device_authorization().await?;
        let state = DeviceLoginState::Waiting {
            expires_at: authorization.expires_at_unix_millis(now_unix_millis()),
            verification_url: authorization.verification_url,
        };
        self.device_wake = Some(Instant::now() + authorization.interval);
        self.device = Some(PendingDevice {
            client,
            account_id: request.account_id,
            device_code: authorization.device_code,
            interval: authorization.interval,
            deadline: Instant::now() + authorization.expires_in,
        });
        self.shared
            .update(|info| info.device_login = Some(state.clone()));
        Ok(state)
    }

    async fn poll_device(&mut self) {
        let Some(device) = self.device.as_ref() else {
            return;
        };
        if Instant::now() >= device.deadline {
            self.finish_device(Some(DeviceLoginState::Expired));
            return;
        }
        let client = device.client.clone();
        let status = client.device_status(device.device_code.clone()).await;
        let Some(device) = self.device.as_mut() else {
            return;
        };
        match status {
            None | Some(VrchatDeviceStatus::Pending) => {
                self.device_wake = Some(Instant::now() + device.interval);
            }
            Some(VrchatDeviceStatus::SlowDown) => {
                device.interval = slowed_device_poll_interval(device.interval);
                self.device_wake = Some(Instant::now() + device.interval);
            }
            Some(VrchatDeviceStatus::Approved) => {
                let expected_account_id = device.account_id.clone();
                self.complete_device_login(client, &expected_account_id)
                    .await;
            }
            Some(VrchatDeviceStatus::Expired) => {
                self.finish_device(Some(DeviceLoginState::Expired));
            }
            Some(VrchatDeviceStatus::Denied) => {
                self.finish_device(Some(DeviceLoginState::Failed {
                    reason: "The login was denied on the other device.".into(),
                }))
            }
            Some(VrchatDeviceStatus::Failed { reason }) => {
                self.finish_device(Some(DeviceLoginState::Failed { reason }));
            }
        }
    }

    async fn complete_device_login(&mut self, client: Arc<Vrchat>, expected_account_id: &str) {
        let reason = match client.complete_device_login().await {
            LoginOutcome::Authenticated { account_id } if account_id != expected_account_id => {
                client.logout().await;
                "The approved VRChat account is not the account signed in to VRCX-0".to_string()
            }
            LoginOutcome::Authenticated { account_id } => {
                self.reset(Some(client)).await;
                self.finish_login(
                    CredentialsRequest {
                        username: String::new(),
                        password: String::new(),
                        save_password: false,
                    },
                    account_id,
                );
                return;
            }
            LoginOutcome::TwoFactorRequired { .. } => {
                "VRChat still requires two-factor verification; sign in with a password instead"
                    .to_string()
            }
            LoginOutcome::Failed { reason, .. } | LoginOutcome::Network { reason } => reason,
            LoginOutcome::RateLimited => "VRChat is rate limiting logins; try again later".into(),
        };
        self.finish_device(Some(DeviceLoginState::Failed { reason }));
    }

    fn finish_device(&mut self, state: Option<DeviceLoginState>) {
        self.device = None;
        self.device_wake = None;
        self.shared.update(|info| info.device_login = state);
    }

    async fn set_credentials(
        &mut self,
        request: CredentialsRequest,
    ) -> Result<SessionState, String> {
        let client = Arc::new(Vrchat::new(None)?);
        match client
            .login(request.username.clone(), request.password.clone())
            .await
        {
            LoginOutcome::Authenticated { account_id } => {
                self.reset(Some(client)).await;
                self.finish_login(request, account_id);
            }
            LoginOutcome::TwoFactorRequired { methods } => {
                self.reset(Some(client)).await;
                self.pending = Some(request);
                self.await_two_factor(&methods);
            }
            LoginOutcome::Failed { reason, .. } | LoginOutcome::Network { reason } => {
                return Err(reason);
            }
            LoginOutcome::RateLimited => {
                return Err("VRChat is rate limiting logins; try again later".into());
            }
        }
        Ok(self.state())
    }

    async fn two_factor(&mut self, request: TwoFactorRequest) -> Result<SessionState, String> {
        let (Some(client), true) = (
            self.client.clone(),
            matches!(self.state(), SessionState::AwaitingTwoFactor { .. })
                && self.pending.is_some(),
        ) else {
            return Err("no two-factor verification is pending".into());
        };
        match client
            .verify_two_factor(&request.method, request.code)
            .await
        {
            TwoFactorOutcome::Retry { error } => Err(error),
            TwoFactorOutcome::Login(LoginOutcome::Authenticated { account_id }) => {
                if let Some(pending) = self.pending.take() {
                    self.finish_login(pending, account_id);
                }
                Ok(self.state())
            }
            TwoFactorOutcome::Login(LoginOutcome::TwoFactorRequired { methods }) => {
                self.await_two_factor(&methods);
                Ok(self.state())
            }
            TwoFactorOutcome::Login(LoginOutcome::Failed { reason, .. }) => {
                self.pending = None;
                Ok(self.fail(reason))
            }
            TwoFactorOutcome::Login(LoginOutcome::Network { reason }) => Err(reason),
            TwoFactorOutcome::Login(LoginOutcome::RateLimited) => {
                Err("VRChat is rate limiting verification; try again later".into())
            }
        }
    }

    async fn reset(&mut self, client: Option<Arc<Vrchat>>) {
        self.stop_recorder().await;
        self.wake = None;
        self.pending = None;
        self.device = None;
        self.device_wake = None;
        self.client = client;
        self.restart_delay = RESTART_BASE_DELAY;
        if let Err(error) = self.vault.clear() {
            tracing::error!(error = %error, "failed to clear stored credentials");
        }
        self.shared.update(|info| *info = SessionInfo::default());
    }

    async fn on_recorder_exit(&mut self, exit: RecorderExit, started: Instant) {
        let RecorderExit::AuthFailed(reason) = exit else {
            return;
        };
        tracing::warn!(
            reason,
            "realtime authentication failed; checking the session"
        );
        let (Some(client), Some(account_id)) = (self.client.clone(), self.account_id()) else {
            return;
        };
        if started.elapsed() >= RESTART_MAX_DELAY {
            self.restart_delay = RESTART_BASE_DELAY;
        }
        match client.probe(&account_id).await {
            ProbeOutcome::Invalid { reason } => self.session_lost(reason),
            ProbeOutcome::Valid => self.restart_later(reason),
            ProbeOutcome::Unreachable { reason } => self.restart_later(reason),
        }
    }

    fn restart_later(&mut self, reason: String) {
        self.shared.update(|info| info.last_error = Some(reason));
        self.set_state(SessionState::Reconnecting);
        self.schedule(self.restart_delay, Wake::RestartRecorder);
        self.restart_delay = (self.restart_delay * 2).min(RESTART_MAX_DELAY);
    }

    async fn on_wake(&mut self, wake: Wake) {
        match wake {
            Wake::RestartRecorder => {
                if let Some(account_id) = self.account_id() {
                    self.start_recorder(account_id);
                }
            }
            Wake::Relogin { attempt } => self.relogin(attempt).await,
        }
    }

    async fn relogin(&mut self, attempt: usize) {
        let credentials = match self.vault.load() {
            Ok(credentials) => credentials,
            Err(error) => {
                tracing::error!(error = %error, "failed to read stored VRChat credentials");
                match after_transient_failure(attempt, &error.to_string()) {
                    Ok((attempt, delay)) => self.schedule_relogin(attempt, delay),
                    Err(reason) => self.stop_unattended(reason),
                }
                return;
            }
        };
        let (
            Some(StoredCredentials {
                username,
                password: Some(password),
                ..
            }),
            Some(client),
        ) = (credentials, self.client.clone())
        else {
            self.stop_unattended(SESSION_EXPIRED_WITHOUT_PASSWORD.into());
            return;
        };
        self.set_state(SessionState::LoggingIn);
        self.shared
            .update(|info| info.relogin_attempts = u32::try_from(attempt + 1).unwrap_or(u32::MAX));
        client.clear_session();
        let outcome = client.login(username.clone(), password.clone()).await;
        let pending = CredentialsRequest {
            username,
            password,
            save_password: true,
        };
        match after_relogin(outcome, attempt) {
            ReloginNext::Authenticated(account_id) => self.finish_login(pending, account_id),
            ReloginNext::AwaitTwoFactor(methods) => {
                self.pending = Some(pending);
                self.await_two_factor(&methods);
                let methods: Vec<&str> = methods.iter().map(TwoFactorMethod::as_str).collect();
                self.notifier.two_factor_required(&methods.join(", "));
            }
            ReloginNext::Stop(reason) => self.stop_unattended(reason),
            ReloginNext::Retry { attempt, delay } => self.schedule_relogin(attempt, delay),
        }
    }

    fn schedule_relogin(&mut self, attempt: usize, delay: Duration) {
        self.set_state(SessionState::Reconnecting);
        self.schedule(delay, Wake::Relogin { attempt });
    }

    fn session_lost(&mut self, reason: String) {
        tracing::warn!(reason, "VRChat session is no longer valid");
        if !self.shared.snapshot().password_saved {
            self.stop_unattended(SESSION_EXPIRED_WITHOUT_PASSWORD.into());
            return;
        }
        self.shared.update(|info| info.last_error = Some(reason));
        self.set_state(SessionState::Reconnecting);
        self.schedule(RELOGIN_DELAYS[0], Wake::Relogin { attempt: 0 });
    }

    fn finish_login(&mut self, pending: CredentialsRequest, account_id: String) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let credentials = StoredCredentials {
            username: pending.username,
            password: pending.save_password.then_some(pending.password),
            account_id: account_id.clone(),
            cookies: client.cookies(),
        };
        if let Err(error) = self.vault.save(&credentials) {
            tracing::error!(error = %error, "failed to store credentials");
        }
        self.pending = None;
        self.restart_delay = RESTART_BASE_DELAY;
        self.shared.update(|info| {
            info.account_id = Some(account_id.clone());
            info.password_saved = credentials.password.is_some();
            info.last_login_at = Some(now_unix());
            info.last_error = None;
            info.relogin_attempts = 0;
        });
        tracing::info!("logged in to VRChat");
        self.notifier.recovered();
        self.start_recorder(account_id);
    }

    fn start_recorder(&mut self, account_id: String) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.generation += 1;
        let generation = self.generation;
        let (stop, stop_rx) = watch::channel(false);
        let recorder = Recorder {
            client,
            account_id,
            store: self.store.clone(),
            presence: self.presence.clone(),
            shared: self.shared.clone(),
            credentials: self.vault.clone(),
            profile_scan: self.profile_scan.clone(),
            notifier: self.notifier.clone(),
            segments: Arc::new(Mutex::new(Segments::default())),
        };
        let exits = self.exits.clone();
        let task = tokio::spawn(async move {
            let exit = recorder.run(stop_rx).await;
            let _ = exits.send((generation, exit));
        });
        self.recorder = Some(ActiveRecorder {
            stop,
            task,
            started: Instant::now(),
        });
        self.set_state(SessionState::Reconnecting);
    }

    async fn stop_recorder(&mut self) {
        self.generation += 1;
        let Some(active) = self.recorder.take() else {
            return;
        };
        let _ = active.stop.send(true);
        let abort = active.task.abort_handle();
        if tokio::time::timeout(RECORDER_STOP_TIMEOUT, active.task)
            .await
            .is_err()
        {
            abort.abort();
        }
    }

    fn schedule(&mut self, delay: Duration, wake: Wake) {
        self.wake = Some((Instant::now() + delay, wake));
    }

    fn stop_unattended(&mut self, reason: String) {
        self.notifier.session_stopped(&reason);
        self.fail(reason);
    }

    fn fail(&mut self, reason: String) -> SessionState {
        tracing::warn!(reason, "VRChat login stopped");
        self.shared
            .update(|info| info.last_error = Some(reason.clone()));
        self.set_state(SessionState::LoginFailed { reason });
        self.state()
    }

    fn await_two_factor(&self, methods: &[TwoFactorMethod]) {
        self.set_state(SessionState::AwaitingTwoFactor {
            methods: methods
                .iter()
                .map(|method| method.as_str().to_string())
                .collect(),
        });
    }

    fn set_state(&self, state: SessionState) {
        self.shared.update(|info| info.state = state);
    }

    fn state(&self) -> SessionState {
        self.shared.snapshot().state
    }

    fn account_id(&self) -> Option<String> {
        self.shared.snapshot().account_id
    }
}

async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use vrcx_0_logger_protocol::wire::ErrorResponse;

    use super::*;
    use crate::test_support::{fresh_app, Desktop};

    fn failed(kind: VrchatLoginFailureKind) -> LoginOutcome {
        LoginOutcome::Failed {
            reason: "nope".into(),
            kind,
        }
    }

    fn network_failure() -> LoginOutcome {
        LoginOutcome::Network {
            reason: "offline".into(),
        }
    }

    #[test]
    fn a_wrong_vrchat_password_stops_relogin_immediately() {
        assert_eq!(
            after_relogin(failed(VrchatLoginFailureKind::InvalidCredentials), 0),
            ReloginNext::Stop("nope".into())
        );
    }

    #[test]
    fn transient_login_failures_retry_with_growing_delays_then_stop() {
        let first = after_relogin(failed(VrchatLoginFailureKind::Other), 0);
        let second = after_relogin(failed(VrchatLoginFailureKind::Other), 1);
        let ReloginNext::Retry {
            attempt: 1,
            delay: first_delay,
        } = first
        else {
            panic!("first failure should retry, got {first:?}");
        };
        let ReloginNext::Retry {
            attempt: 2,
            delay: second_delay,
        } = second
        else {
            panic!("second failure should retry, got {second:?}");
        };

        assert!(second_delay > first_delay);
        assert!(matches!(
            after_relogin(failed(VrchatLoginFailureKind::Other), 2),
            ReloginNext::Stop(_)
        ));
    }

    #[test]
    fn an_unreachable_or_failing_vrchat_keeps_retrying_without_spending_a_relogin_attempt() {
        assert_eq!(
            after_relogin(network_failure(), 2),
            ReloginNext::Retry {
                attempt: 2,
                delay: UNREACHABLE_RELOGIN_DELAY
            }
        );
    }

    #[test]
    fn vrchat_rate_limits_wait_without_spending_a_relogin_attempt() {
        assert_eq!(
            after_relogin(LoginOutcome::RateLimited, 1),
            ReloginNext::Retry {
                attempt: 1,
                delay: RATE_LIMIT_DELAY
            }
        );
    }

    #[test]
    fn a_two_factor_challenge_during_relogin_waits_for_the_desktop() {
        assert_eq!(
            after_relogin(
                LoginOutcome::TwoFactorRequired {
                    methods: vec![TwoFactorMethod::Totp]
                },
                0
            ),
            ReloginNext::AwaitTwoFactor(vec![TwoFactorMethod::Totp])
        );
    }

    #[tokio::test]
    async fn a_two_factor_code_without_a_pending_login_is_refused() {
        let desktop = Desktop::new(&fresh_app());

        let (status, error): (_, ErrorResponse) = desktop
            .call(
                "/two-factor",
                &TwoFactorRequest {
                    method: "totp".into(),
                    code: "123456".into(),
                },
            )
            .await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert!(!error.message.is_empty());
        assert_eq!(desktop.status().await.session, SessionState::NoCredentials);
    }
}
