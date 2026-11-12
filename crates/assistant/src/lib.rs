mod agent;
mod approvals;
mod charts;
mod choices;
mod config;
mod endpoints;
mod entities;
mod error;
mod events;
mod pending;
mod playbook;
mod ports;
mod runtime;
mod screenshots;
mod session;
#[cfg(test)]
mod test_support;

pub use approvals::{
    AssistantApproval, AssistantApprovalField, AssistantFavoriteGroup, AssistantFavoriteMoveItem,
    AssistantFavoriteMovePreview, AssistantFavoriteMoveStatus,
};
pub use choices::AssistantChoiceCandidate;
pub use config::PlaybookMode;
pub use endpoints::{
    resolve_reasoning_effort, AssistantRuntimeSelection, AssistantRuntimeStatus, EndpointStore,
    LlmEndpointDetectModelsInput, LlmEndpointDto, LlmEndpointUpsertInput, LlmTranslateInput,
};
pub use entities::{Entity, EntityKind};
pub use error::AssistantError;
pub use events::{
    AssistantApprovalRequestEvent, AssistantChoiceRequestEvent, AssistantDeltaEvent,
    AssistantDoneEvent, AssistantErrorEvent, AssistantToolCallEvent, AssistantToolResultEvent,
    AssistantTurnEntitiesEvent,
};
pub use ports::{
    AssistantConfig, AssistantConfigPort, AssistantLlmClient, AssistantLlmClientFactory,
    AssistantLlmClientFactoryPort, AssistantLlmClientInput, AssistantLlmClientPort,
    AssistantLlmError, AssistantLlmFuture, AssistantMessageInsert, AssistantPortError,
    AssistantPortResult, AssistantSessionPersistence, AssistantSessionPersistencePort,
    AssistantSessionRuntimeUpdate, AssistantSessionUpsert, AssistantSqliteErrorCategory,
    PersistedAssistantMessage, PersistedAssistantSession,
};
pub use runtime::{AssistantController, AssistantControllerDeps, SendResult};
pub use screenshots::AssistantScreenshots;
pub use session::{ActiveTurn, Message, Role, Session, SessionSummary, TurnStatus};
pub use vrcx_0_contracts::llm::{LlmEndpointDetectModelsResult, LlmModelReasoning};
