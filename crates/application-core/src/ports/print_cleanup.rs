#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrintCleanupTrigger {
    pub user_id: String,
    pub endpoint: String,
    pub reason: String,
}

pub trait PrintCleanupInputSink: Send + Sync {
    fn schedule_print_cleanup(&self, trigger: PrintCleanupTrigger);
}

#[derive(Clone, Copy, Debug, Default)]
pub struct NoopPrintCleanupInputSink;

impl PrintCleanupInputSink for NoopPrintCleanupInputSink {
    fn schedule_print_cleanup(&self, _trigger: PrintCleanupTrigger) {}
}
