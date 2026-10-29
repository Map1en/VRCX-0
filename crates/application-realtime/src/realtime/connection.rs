use futures_util::future::BoxFuture;

use std::sync::Arc;

use tokio::sync::watch;

use super::{
    RealtimeSessionContext, RealtimeTransportTermination, RealtimeWsMessagePayload,
    RealtimeWsStatus,
};

pub type RealtimeTransportFuture = BoxFuture<'static, RealtimeTransportTermination>;

pub trait RealtimeMessageSink: Send + Sync {
    fn handle_realtime_transport_status(
        &self,
        _generation: u64,
        _session_generation: u64,
        _session: &RealtimeSessionContext,
        _status: RealtimeWsStatus,
    ) {
    }

    fn handle_realtime_ws_message(
        &self,
        generation: u64,
        session_generation: u64,
        session: &RealtimeSessionContext,
        payload: &RealtimeWsMessagePayload,
    );
}

pub trait RealtimeTransport: Send + Sync {
    fn run(
        &self,
        message_sink: Arc<dyn RealtimeMessageSink>,
        client_run_id: u64,
        generation: u64,
        session_generation: u64,
        session: RealtimeSessionContext,
        cancel_rx: watch::Receiver<u64>,
    ) -> RealtimeTransportFuture;

    fn verify_liveness(&self) {}
}
