pub use vrcx_0_core::game_process::GameProcessEvent;

pub trait GameProcessEventSink: Send + Sync {
    fn on_game_process_event(&self, event: GameProcessEvent) -> crate::Result<()>;
}
