use vrcx_0_application_game::RuntimeSnapshot;
use vrcx_0_runtime_host::RuntimeHostContext;

pub trait VrOverlayRuntimeServices: Send + Sync {
    fn data(&self) -> &RuntimeHostContext;

    fn game_log_snapshot(&self) -> RuntimeSnapshot;
}
