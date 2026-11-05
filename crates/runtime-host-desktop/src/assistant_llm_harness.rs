use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::OpenFlags;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use vrcx_0_application_core::RuntimeEventSink;
use vrcx_0_assistant::{
    AssistantController, AssistantLlmClient, AssistantLlmClientFactory,
    AssistantLlmClientFactoryPort, AssistantLlmClientInput, AssistantLlmClientPort,
    AssistantLlmError, AssistantLlmFuture, LlmEndpointDetectModelsInput, LlmEndpointUpsertInput,
    PlaybookMode, Role,
};
use vrcx_0_composition::{RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState};
use vrcx_0_contracts::llm::{
    AssistantTurn, ChatMessage, FunctionCall, LlmEndpointDetectModelsResult, LlmRequestOptions,
    ToolCall, ToolDefinition,
};
use vrcx_0_core::OwnerId;
use vrcx_0_mcp::McpCaller;
use vrcx_0_persistence::game_log::{write_batch, GameLogJoinLeaveEntry, GameLogWriteBatch};
use vrcx_0_platform::app_paths::{resolve_app_data_dir, AppDataDirResolution, AppDataDirSource};

use crate::state::{assistant_controller_deps_for, mcp_runtime_for};

const TURN_TIMEOUT: Duration = Duration::from_secs(240);
// Kana inside a quoted display name must not pass for a Japanese reply.
const JAPANESE_MIN_HIRAGANA: usize = 20;
const WRITE_TOOLS: [&str; 3] = ["favorite_local", "favorite_vrchat", "set_friend_note"];

struct HarnessChatbox;

impl vrcx_0_mcp::McpChatboxPort for HarnessChatbox {
    fn state(&self) -> vrcx_0_application_core::Result<Value> {
        Err(harness_chatbox_unavailable())
    }

    fn update_config(&self, _config: Value) -> vrcx_0_application_core::Result<Value> {
        Err(harness_chatbox_unavailable())
    }

    fn send(&self, _text: String) -> vrcx_0_application_core::Result<Value> {
        Err(harness_chatbox_unavailable())
    }

    fn set_afk(&self, _afk: bool) -> vrcx_0_application_core::Result<Value> {
        Err(harness_chatbox_unavailable())
    }
}

fn harness_chatbox_unavailable() -> vrcx_0_application_core::Error {
    vrcx_0_application_core::Error::Custom("Chatbox is not available in the harness".into())
}

fn harness_chatbox() -> vrcx_0_mcp::McpChatbox {
    Arc::new(HarnessChatbox)
}

struct HarnessEnv(HashMap<String, String>);

impl HarnessEnv {
    fn load() -> Self {
        let local = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.env.local");
        let values = std::fs::read_to_string(local)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().split_once('='))
            .filter(|(key, _)| !key.starts_with('#'))
            .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
            .collect();
        Self(values)
    }

    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key)
            .ok()
            .or_else(|| self.0.get(key).cloned())
            .filter(|value| !value.is_empty())
    }

    fn require(&self, key: &str) -> String {
        self.get(key)
            .unwrap_or_else(|| panic!("set {key} in the environment or .env.local"))
    }
}

struct ScratchDir(PathBuf);

impl ScratchDir {
    fn new(kind: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        Self(std::env::temp_dir().join(format!(
            "vrcx-0-assistant-{kind}-{}-{nonce}",
            std::process::id()
        )))
    }

    async fn remove_when_released(self) {
        for _ in 0..40 {
            if std::fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        println!("could not remove the snapshot at {}", self.0.display());
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct ChannelSink(UnboundedSender<(String, Value)>);

impl RuntimeEventSink for ChannelSink {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.0.send((event.to_string(), payload));
    }
}

#[derive(Default)]
struct LlmMeter {
    requests: AtomicUsize,
    prompt_chars: AtomicUsize,
}

impl LlmMeter {
    fn record(&self, messages: &[ChatMessage], tools: &[ToolDefinition]) {
        let tool_chars: usize = tools
            .iter()
            .map(|tool| {
                tool.name.chars().count()
                    + tool.description.chars().count()
                    + tool.parameters.to_string().chars().count()
            })
            .sum();
        let message_chars = serde_json::to_string(messages)
            .map(|text| text.chars().count())
            .unwrap_or_default();
        self.requests.fetch_add(1, Ordering::Relaxed);
        self.prompt_chars
            .fetch_add(message_chars + tool_chars, Ordering::Relaxed);
    }

    fn reading(&self) -> (usize, usize) {
        (
            self.requests.load(Ordering::Relaxed),
            self.prompt_chars.load(Ordering::Relaxed),
        )
    }
}

struct MeteredFactory(AssistantLlmClientFactory, Arc<LlmMeter>);

impl AssistantLlmClientFactoryPort for MeteredFactory {
    fn create(
        &self,
        input: AssistantLlmClientInput,
    ) -> Result<Arc<dyn AssistantLlmClientPort>, AssistantLlmError> {
        Ok(Arc::new(MeteredLlm(
            self.0.create(input)?,
            Arc::clone(&self.1),
        )))
    }
}

struct MeteredLlm(AssistantLlmClient, Arc<LlmMeter>);

impl AssistantLlmClientPort for MeteredLlm {
    fn list_models(&self) -> AssistantLlmFuture<'_, LlmEndpointDetectModelsResult> {
        self.0.list_models()
    }

    fn complete_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        options: &'a LlmRequestOptions,
    ) -> AssistantLlmFuture<'a, String> {
        self.1.record(messages, &[]);
        self.0.complete_chat(messages, options)
    }

    fn stream_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        tools: &'a [ToolDefinition],
        options: &'a LlmRequestOptions,
        on_text: Box<dyn FnMut(&str) + Send + 'a>,
    ) -> AssistantLlmFuture<'a, AssistantTurn> {
        self.1.record(messages, tools);
        let turn = self.0.stream_chat(messages, tools, options, on_text);
        if !tools.is_empty() {
            return turn;
        }
        Box::pin(async move {
            let turn = turn.await;
            if let Ok(turn) = &turn {
                println!("intent classifier replied: {:?}", turn.content);
            }
            turn
        })
    }
}

#[derive(Default)]
struct TurnLog {
    session_id: String,
    tool_calls: Vec<String>,
    tool_arguments: Vec<String>,
    failed_tools: Vec<String>,
    choices: usize,
    answer: String,
    error: Option<String>,
    metrics: TurnMetrics,
}

#[derive(Clone, Default)]
struct TurnMetrics {
    llm_requests: usize,
    prompt_chars: usize,
    tool_result_chars: usize,
    elapsed: Duration,
}

impl TurnLog {
    fn print(&self, node: &str, question: &str) {
        println!("\n=== {node} ===\nQ: {question}");
        println!("tools: {:?}", self.tool_calls);
        for (name, arguments) in self.tool_calls.iter().zip(&self.tool_arguments) {
            println!("  {name} {arguments}");
        }
        println!(
            "metrics: llm_requests={} prompt_chars={} tool_result_chars={} secs={:.1}",
            self.metrics.llm_requests,
            self.metrics.prompt_chars,
            self.metrics.tool_result_chars,
            self.metrics.elapsed.as_secs_f64()
        );
        if !self.failed_tools.is_empty() {
            println!("failed tool results: {:?}", self.failed_tools);
        }
        if self.choices > 0 {
            println!("choice cards answered: {}", self.choices);
        }
        match &self.error {
            Some(error) => println!("ERROR: {error}"),
            None => println!("A: {}", self.answer),
        }
    }
}

struct NodeRun {
    round: usize,
    node: String,
    tool_calls: Vec<String>,
    metrics: TurnMetrics,
}

struct Failure {
    round: usize,
    node: String,
    problem: String,
}

struct Harness {
    controller: AssistantController,
    events: UnboundedReceiver<(String, Value)>,
    failures: Vec<Failure>,
    meter: Arc<LlmMeter>,
    runs: Vec<NodeRun>,
    round: usize,
}

impl Harness {
    async fn ask(
        &mut self,
        node: &str,
        session_id: Option<String>,
        locale: &str,
        question: &str,
    ) -> TurnLog {
        let tool_chars_before = session_id
            .as_deref()
            .map_or(0, |session_id| self.tool_result_chars(session_id));
        let (requests_before, prompt_chars_before) = self.meter.reading();
        let started = Instant::now();
        let sent = self
            .controller
            .send_message(session_id, question.to_string(), Some(locale.into()))
            .await
            .expect("send_message");
        let mut log = TurnLog {
            session_id: sent.session_id.clone(),
            ..TurnLog::default()
        };
        let deadline = tokio::time::Instant::now() + TURN_TIMEOUT;
        loop {
            let Ok(Some((event, payload))) =
                tokio::time::timeout_at(deadline, self.events.recv()).await
            else {
                log.error = Some(format!("no answer within {TURN_TIMEOUT:?}"));
                break;
            };
            if payload["turnId"] != json!(sent.turn_id) {
                continue;
            }
            match event.as_str() {
                "assistantToolCall" => {
                    log.tool_calls
                        .push(payload["name"].as_str().unwrap_or_default().to_string());
                    log.tool_arguments
                        .push(payload["args"].as_str().unwrap_or_default().to_string());
                }
                "assistantToolResult" if payload["ok"] != json!(true) => log
                    .failed_tools
                    .push(payload["summary"].as_str().unwrap_or_default().to_string()),
                "assistantChoiceRequest" => {
                    log.choices += 1;
                    let picked = payload["candidates"][0]["userId"]
                        .as_str()
                        .map(str::to_string);
                    self.controller.answer_choice(
                        &sent.session_id,
                        payload["choiceId"].as_str().unwrap_or_default(),
                        picked,
                    );
                }
                "assistantDelta" => {
                    let text = payload["text"].as_str().unwrap_or_default();
                    if payload["replace"] == json!(true) {
                        log.answer = text.to_string();
                    } else {
                        log.answer.push_str(text);
                    }
                }
                "assistantDone" => break,
                "assistantError" => {
                    log.error = Some(format!("{} {}", payload["code"], payload["message"]));
                    break;
                }
                _ => {}
            }
        }
        let (requests_after, prompt_chars_after) = self.meter.reading();
        log.metrics = TurnMetrics {
            llm_requests: requests_after - requests_before,
            prompt_chars: prompt_chars_after - prompt_chars_before,
            tool_result_chars: self
                .tool_result_chars(&log.session_id)
                .saturating_sub(tool_chars_before),
            elapsed: started.elapsed(),
        };
        self.runs.push(NodeRun {
            round: self.round,
            node: node.to_string(),
            tool_calls: log.tool_calls.clone(),
            metrics: log.metrics.clone(),
        });
        log.print(node, question);
        self.check(node, log.error.is_none(), "turn ended with an error");
        self.check(node, !log.answer.trim().is_empty(), "answer is empty");
        self.check(
            node,
            !exposes_user_id(&log.answer),
            "answer exposes a raw usr_ id",
        );
        self.check(
            node,
            !log.answer
                .match_indices("VRCX")
                .any(|(start, _)| !log.answer[start + 4..].starts_with("-0")),
            "the answer calls the app VRCX instead of VRCX-0",
        );
        if locale == "ja" {
            self.check(
                node,
                log.answer
                    .chars()
                    .filter(|c| ('\u{3041}'..='\u{309f}').contains(c))
                    .count()
                    >= JAPANESE_MIN_HIRAGANA,
                "a Japanese question was not answered in Japanese",
            );
        }
        log
    }

    fn tool_result_chars(&self, session_id: &str) -> usize {
        self.controller
            .get_session(session_id)
            .ok()
            .flatten()
            .map(|session| {
                session
                    .messages
                    .iter()
                    .filter_map(|message| message.tool_content.as_deref())
                    .map(|content| content.chars().count())
                    .sum()
            })
            .unwrap_or_default()
    }

    fn passed(&self, round: usize, node: &str) -> bool {
        !self
            .failures
            .iter()
            .any(|failure| failure.round == round && failure.node == node)
    }

    fn report(&self, path: Option<&Path>, baseline: Option<&Path>) {
        println!(
            "\n| round | node | passed | tool calls | LLM requests | prompt chars | tool result chars | secs |"
        );
        println!("|---|---|---|---|---|---|---|---|");
        for run in &self.runs {
            println!(
                "| {} | {} | {} | {} | {} | {} | {} | {:.1} |",
                run.round + 1,
                run.node,
                self.passed(run.round, &run.node),
                run.tool_calls.len(),
                run.metrics.llm_requests,
                run.metrics.prompt_chars,
                run.metrics.tool_result_chars,
                run.metrics.elapsed.as_secs_f64()
            );
        }

        let mut nodes: Vec<&str> = Vec::new();
        for run in &self.runs {
            if !nodes.contains(&run.node.as_str()) {
                nodes.push(&run.node);
            }
        }
        let summary: Vec<Value> = nodes
            .into_iter()
            .map(|node| {
                let runs: Vec<&NodeRun> = self.runs.iter().filter(|run| run.node == node).collect();
                let passed = runs
                    .iter()
                    .filter(|run| self.passed(run.round, node))
                    .count();
                json!({
                    "node": node,
                    "runs": runs.len(),
                    "passed": passed,
                    "medianToolCalls": median(runs.iter().map(|run| run.tool_calls.len() as f64)),
                    "medianPromptChars": median(runs.iter().map(|run| run.metrics.prompt_chars as f64)),
                    "medianSecs": median(runs.iter().map(|run| run.metrics.elapsed.as_secs_f64())),
                })
            })
            .collect();
        println!("\n| node | passed | median tool calls | median prompt chars | median secs |");
        println!("|---|---|---|---|---|");
        for row in &summary {
            println!(
                "| {} | {}/{} | {} | {} | {:.1} |",
                row["node"].as_str().unwrap_or_default(),
                row["passed"],
                row["runs"],
                row["medianToolCalls"],
                row["medianPromptChars"],
                row["medianSecs"].as_f64().unwrap_or_default()
            );
        }
        let regressions = baseline
            .map(|baseline| compare_with_baseline(&summary, baseline))
            .unwrap_or_default();

        let Some(path) = path else {
            return;
        };
        let runs: Vec<Value> = self
            .runs
            .iter()
            .map(|run| {
                json!({
                    "round": run.round + 1,
                    "node": run.node,
                    "passed": self.passed(run.round, &run.node),
                    "tools": run.tool_calls,
                    "llmRequests": run.metrics.llm_requests,
                    "promptChars": run.metrics.prompt_chars,
                    "toolResultChars": run.metrics.tool_result_chars,
                    "secs": run.metrics.elapsed.as_secs_f64(),
                })
            })
            .collect();
        let failures: Vec<Value> = self
            .failures
            .iter()
            .map(|failure| {
                json!({ "round": failure.round + 1, "node": failure.node, "problem": failure.problem })
            })
            .collect();
        let body = json!({
            "summary": summary,
            "runs": runs,
            "failures": failures,
            "regressions": regressions,
        });
        std::fs::write(path, serde_json::to_string_pretty(&body).unwrap())
            .unwrap_or_else(|error| panic!("write the report to {}: {error}", path.display()));
        println!("report written to {}", path.display());
    }

    fn check(&mut self, node: &str, passed: bool, problem: &str) {
        if !passed {
            self.failures.push(Failure {
                round: self.round,
                node: node.to_string(),
                problem: problem.to_string(),
            });
        }
    }
}

struct Rig {
    scratch: ScratchDir,
    runtime: RuntimeHostState,
    harness: Harness,
}

impl Rig {
    fn runtime(scratch: &ScratchDir) -> RuntimeHostState {
        let app_data = scratch.0.join("app-data");
        RuntimeHostState::new(RuntimeHostOptions {
            realtime_origin: "http://localhost:9000".into(),
            launched_from_autostart: false,
            app_data_dir: AppDataDirResolution {
                current_dir: app_data.clone(),
                default_dir: app_data.clone(),
                persisted_dir: None,
                cli_dir: Some(app_data),
                source: AppDataDirSource::Cli,
            },
            app_version: "0.0.0-harness".into(),
            profile: RuntimeHostProfile::HeadlessData,
            database_maintenance_cache_dir: None,
            task_executor: None,
        })
        .expect("start headless runtime")
    }

    async fn start(
        scratch: ScratchDir,
        runtime: RuntimeHostState,
        llm_factory: impl FnOnce(AssistantLlmClientFactory) -> AssistantLlmClientFactory,
    ) -> Self {
        let (sender, events) = unbounded_channel();
        runtime
            .desktop_assembly()
            .event_bus()
            .set_sink(ChannelSink(sender));
        let meter = Arc::new(LlmMeter::default());
        let mut deps = assistant_controller_deps_for(&runtime, harness_chatbox());
        deps.llm_factory = Arc::new(MeteredFactory(
            llm_factory(deps.llm_factory),
            Arc::clone(&meter),
        ));
        let controller = AssistantController::new(deps)
            .await
            .expect("assistant controller");
        Self {
            scratch,
            runtime,
            harness: Harness {
                controller,
                events,
                failures: Vec::new(),
                meter,
                runs: Vec::new(),
                round: 0,
            },
        }
    }

    fn sign_in(runtime: &RuntimeHostState, user_id: &str) {
        runtime
            .desktop_assembly()
            .auth_scope()
            .set(user_id, "https://api.vrchat.cloud/api/1");
    }

    async fn finish(self) {
        let Self {
            scratch,
            runtime,
            harness,
        } = self;
        let Harness {
            controller,
            failures,
            ..
        } = harness;
        drop(controller);
        runtime.stop_runtime_tasks();
        drop(runtime);
        scratch.remove_when_released().await;
        let failures: Vec<String> = failures
            .iter()
            .map(|failure| {
                format!(
                    "round {} {}: {}",
                    failure.round + 1,
                    failure.node,
                    failure.problem
                )
            })
            .collect();
        assert!(failures.is_empty(), "failures:\n{}", failures.join("\n"));
    }
}

fn compare_with_baseline(summary: &[Value], baseline: &Path) -> Vec<String> {
    let text = std::fs::read_to_string(baseline)
        .unwrap_or_else(|error| panic!("read the baseline {}: {error}", baseline.display()));
    let baseline: Value = serde_json::from_str(&text).expect("parse the baseline report");
    let before: HashMap<&str, &Value> = baseline["summary"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["node"].as_str()?, row)))
        .collect();
    let rate = |row: &Value| {
        row["passed"].as_f64().unwrap_or_default() / row["runs"].as_f64().unwrap_or(1.0).max(1.0)
    };
    let grew = |now: f64, then: f64, floor: f64| now >= then * 1.5 && now - then >= floor;
    let mut regressions = Vec::new();
    println!(
        "\n| node | pass rate before → now | median tool calls before → now | median prompt chars before → now | flag |"
    );
    println!("|---|---|---|---|---|");
    for row in summary {
        let node = row["node"].as_str().unwrap_or_default();
        let Some(then) = before.get(node) else {
            println!("| {node} | new | | | |");
            continue;
        };
        let calls = (
            then["medianToolCalls"].as_f64().unwrap_or_default(),
            row["medianToolCalls"].as_f64().unwrap_or_default(),
        );
        let chars = (
            then["medianPromptChars"].as_f64().unwrap_or_default(),
            row["medianPromptChars"].as_f64().unwrap_or_default(),
        );
        let mut flags = Vec::new();
        if rate(row) < rate(then) {
            flags.push("pass rate dropped");
        }
        if grew(calls.1, calls.0, 1.0) {
            flags.push("tool calls grew");
        }
        if grew(chars.1, chars.0, 10_000.0) {
            flags.push("prompt grew");
        }
        println!(
            "| {node} | {:.0}% → {:.0}% | {} → {} | {} → {} | {} |",
            rate(then) * 100.0,
            rate(row) * 100.0,
            calls.0,
            calls.1,
            chars.0,
            chars.1,
            flags.join(", ")
        );
        regressions.extend(flags.into_iter().map(|flag| format!("{node}: {flag}")));
    }
    if !regressions.is_empty() {
        println!(
            "REGRESSIONS against the baseline:\n{}",
            regressions.join("\n")
        );
    }
    regressions
}

fn median(values: impl Iterator<Item = f64>) -> f64 {
    let mut values: Vec<f64> = values.collect();
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

fn exposes_user_id(text: &str) -> bool {
    text.match_indices("usr_").any(|(start, _)| {
        let id = &text[start + 4..];
        id.get(..8)
            .is_some_and(|hex| hex.chars().all(|c| c.is_ascii_hexdigit()))
            && id.get(8..).is_some_and(|rest| rest.starts_with('-'))
    })
}

struct Snapshot {
    scratch: ScratchDir,
    runtime: RuntimeHostState,
    database: PathBuf,
    user_id: String,
}

impl Snapshot {
    fn take(env: &HarnessEnv, kind: &str) -> Self {
        let source_dir = env
            .get("VRCX0_HARNESS_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                resolve_app_data_dir()
                    .expect("resolve data dir")
                    .current_dir
            });
        let scratch = ScratchDir::new(kind);
        let database = scratch.0.join("app-data").join("VRCX-0.sqlite3");
        std::fs::create_dir_all(database.parent().unwrap()).unwrap();
        snapshot_database(&source_dir.join("VRCX-0.sqlite3"), &database);
        let screenshot_cache = source_dir.join("metadataCache.db");
        if screenshot_cache.is_file() {
            snapshot_database(
                &screenshot_cache,
                &database.with_file_name("metadataCache.db"),
            );
        }

        let runtime = Rig::runtime(&scratch);
        let user_id = env.get("VRCX0_HARNESS_USER_ID").unwrap_or_else(|| {
            runtime
                .desktop_assembly()
                .config_store()
                .get_string("lastUserLoggedIn", "")
                .unwrap_or_default()
        });
        assert!(
            !user_id.is_empty(),
            "no signed-in account in the database; set VRCX0_HARNESS_USER_ID"
        );
        Rig::sign_in(&runtime, &user_id);
        Self {
            scratch,
            runtime,
            database,
            user_id,
        }
    }
}

fn snapshot_database(source: &Path, target: &Path) {
    let connection =
        rusqlite::Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open the source database read-only");
    connection
        .execute("VACUUM INTO ?1", [target.to_string_lossy()])
        .expect("snapshot the source database");
}

fn name_fragments(database: &Path) -> Vec<String> {
    let connection =
        rusqlite::Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open the snapshot");
    let mut statement = connection
        .prepare(
            "SELECT display_name FROM gamelog_join_leave WHERE trim(user_id) <> ''
             GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 40",
        )
        .expect("prepare name query");
    let names: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .expect("query names")
        .filter_map(Result::ok)
        .collect();
    let mut fragments = BTreeSet::new();
    for name in names {
        let chars: Vec<char> = name.trim().chars().collect();
        for length in [2, 3] {
            if chars.len() > length {
                fragments.insert(chars[..length].iter().collect::<String>());
            }
        }
    }
    fragments
        .into_iter()
        .filter(|fragment| !fragment.trim().is_empty())
        .collect()
}

async fn find_ambiguous_fragment(
    runtime: &RuntimeHostState,
    database: &Path,
) -> Option<(String, Vec<String>)> {
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(
        runtime,
        harness_chatbox(),
        McpCaller::Assistant,
    ))
    .await
    .expect("spawn probe tools");
    for fragment in name_fragments(database).into_iter().take(60) {
        let arguments = Map::from_iter([("user".to_string(), json!(fragment))]);
        let Ok(outcome) = tools.call_tool("get_companions_of", Some(arguments)).await else {
            continue;
        };
        let structured = outcome.structured.unwrap_or_default();
        let names: Vec<String> = structured["candidates"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|candidate| candidate["displayName"].as_str())
            .map(str::to_string)
            .collect();
        if names.len() >= 2 {
            return Some((fragment, names));
        }
    }
    None
}

async fn top_fading_friend(runtime: &RuntimeHostState) -> Option<String> {
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(
        runtime,
        harness_chatbox(),
        McpCaller::Assistant,
    ))
    .await
    .expect("spawn probe tools");
    let outcome = tools.call_tool("get_fading_friends", None).await.ok()?;
    outcome.structured?["rows"][0]["displayName"]
        .as_str()
        .map(str::to_string)
}

fn utc_stamp(time: chrono::DateTime<chrono::Utc>) -> String {
    time.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

async fn month_minutes(runtime: &RuntimeHostState) -> Option<i64> {
    use chrono::Datelike;
    let today = chrono::Local::now().date_naive();
    let from = utc_midnight(today.with_day(1)?)?;
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(
        runtime,
        harness_chatbox(),
        McpCaller::Assistant,
    ))
    .await
    .expect("spawn probe tools");
    let arguments = Map::from_iter([(
        "timeWindow".to_string(),
        json!({ "from": from, "to": utc_stamp(chrono::Utc::now()) }),
    )]);
    let outcome = tools
        .call_tool("get_my_activity", Some(arguments))
        .await
        .ok()?;
    outcome.structured?["totalMinutes"].as_i64()
}

struct Truth {
    week: Option<Vec<String>>,
    seven_days: Option<Vec<String>>,
    recent: Vec<String>,
    month_minutes: Option<i64>,
    world: Option<WorldTruth>,
    screenshots: Option<ScreenshotTruth>,
}

struct ScreenshotTruth {
    top_person_id: String,
    top_person_name: String,
}

struct WorldTruth {
    id: String,
    name: String,
    total_minutes: i64,
    top_people: Vec<String>,
}

impl Truth {
    async fn take(sql: &SnapshotSql, runtime: &RuntimeHostState) -> Self {
        use chrono::Datelike;
        let now = chrono::Utc::now();
        let to = utc_stamp(now);
        let today = chrono::Local::now().date_naive();
        let week_start = utc_midnight(
            today - chrono::Days::new(u64::from(today.weekday().num_days_from_monday())),
        );
        let rolling =
            |days: i64| sql.top_names(&utc_stamp(now - chrono::Duration::days(days)), &to);
        let mut recent: Vec<String> = [7, 14, 30]
            .into_iter()
            .filter_map(rolling)
            .flatten()
            .collect();
        recent.sort();
        recent.dedup();
        Self {
            week: week_start.and_then(|from| sql.top_names(&from, &to)),
            seven_days: rolling(7),
            recent,
            month_minutes: month_minutes(runtime).await,
            world: sql.most_visited_world(),
            screenshots: sql.top_screenshot_person(),
        }
    }
}

async fn play_screenshots(harness: &mut Harness, truth: &ScreenshotTruth) {
    let ranking = harness
        .ask("screenshot_people", None, "zh-CN", "我和谁拍的照最多？")
        .await;
    harness.check(
        "screenshot_people",
        ranking
            .tool_calls
            .iter()
            .any(|name| name == "summarize_screenshots"),
        "the ranking question did not use summarize_screenshots",
    );
    harness.check(
        "screenshot_people",
        ranking.answer.contains(&truth.top_person_name),
        "the answer missed the person in the most screenshots",
    );

    let mention = format!(
        "[@{}](vrcx-0://user/open?id={})",
        truth.top_person_name, truth.top_person_id
    );
    let together = harness
        .ask(
            "screenshot_together",
            None,
            "zh-CN",
            &format!("找找我和 {mention} 最近的合照"),
        )
        .await;
    harness.check(
        "screenshot_together",
        together
            .tool_calls
            .iter()
            .zip(&together.tool_arguments)
            .any(|(name, args)| {
                name == "search_screenshots" && args.contains(&truth.top_person_id)
            }),
        "the mention did not reach search_screenshots by id",
    );
    harness.check(
        "screenshot_together",
        !together.answer.contains(".png"),
        "the answer listed screenshot file names",
    );
}

async fn play_world_profile(harness: &mut Harness, world: &WorldTruth) {
    let mention = format!("[@{}](vrcx-0://world/open?id={})", world.name, world.id);
    let visits = harness
        .ask(
            "world_visits",
            None,
            "zh-CN",
            &format!("最近几次去 {mention} 都和谁在一起"),
        )
        .await;
    harness.check(
        "world_visits",
        visits.tool_calls.len() <= 6,
        "the answer drilled visit by visit instead of reading recentVisits",
    );
    harness.check(
        "world_visits",
        visits
            .tool_calls
            .iter()
            .zip(&visits.tool_arguments)
            .any(|(name, args)| name == "get_world_profile" && args.contains(&world.id)),
        "the world mention did not reach get_world_profile by id",
    );
    harness.check(
        "world_visits",
        world.top_people.is_empty() || names_any(&visits.answer, &world.top_people),
        "the answer missed the people met there most",
    );

    let popularity = harness
        .ask(
            "world_popularity",
            Some(visits.session_id.clone()),
            "zh-CN",
            &format!("{mention} 热门吗，有多少人收藏"),
        )
        .await;
    harness.check(
        "world_popularity",
        popularity.error.is_none() && !popularity.answer.trim().is_empty(),
        "no answer about the world's popularity",
    );

    let by_name = harness
        .ask(
            "world_by_name",
            None,
            "zh-CN",
            &format!("我在 {} 一共待了多久？", world.name),
        )
        .await;
    harness.check(
        "world_by_name",
        mentions_duration(&by_name.answer, world.total_minutes),
        "the answer missed the total time spent in the world",
    );
}

fn names_any(answer: &str, names: &[String]) -> bool {
    names.iter().any(|name| answer.contains(name.as_str()))
}

fn mentions_duration(answer: &str, minutes: i64) -> bool {
    let chars: Vec<char> = answer.chars().collect();
    let mut values = Vec::new();
    let mut number = String::new();
    for (index, c) in chars
        .iter()
        .copied()
        .chain(std::iter::once(' '))
        .enumerate()
    {
        let thousands = c == ','
            && !number.is_empty()
            && chars.get(index + 1).is_some_and(char::is_ascii_digit);
        if c.is_ascii_digit() || (c == '.' && !number.is_empty()) {
            number.push(c);
        } else if !thousands && !number.is_empty() {
            if let Ok(value) = number.trim_end_matches('.').parse::<f64>() {
                values.push(value);
            }
            number.clear();
        }
    }
    let hours = minutes as f64 / 60.0;
    values
        .iter()
        .any(|value| (value - hours).abs() <= 1.0 || (value - minutes as f64).abs() <= 2.0)
}

fn reads_as_english(answer: &str) -> bool {
    let words: Vec<String> = answer
        .split(|c: char| !c.is_ascii_alphabetic())
        .map(str::to_ascii_lowercase)
        .collect();
    ["the", "you", "with", "and", "your"]
        .iter()
        .filter(|word| words.iter().any(|candidate| candidate == *word))
        .count()
        >= 2
}

#[tokio::test]
#[ignore = "calls a real LLM against a snapshot of the local VRCX-0 database; set VRCX0_HARNESS_LLM_BASE_URL, VRCX0_HARNESS_LLM_MODEL and VRCX0_HARNESS_LLM_API_KEY (env or .env.local)"]
async fn assistant_answers_key_questions_with_a_real_llm() {
    let env = HarnessEnv::load();
    let api_key = env.require("VRCX0_HARNESS_LLM_API_KEY");
    let base_url = env.require("VRCX0_HARNESS_LLM_BASE_URL");
    let model = env.require("VRCX0_HARNESS_LLM_MODEL");
    let Snapshot {
        scratch,
        runtime,
        database,
        user_id,
    } = Snapshot::take(&env, "harness");
    let playbook_mode = match env.get("VRCX0_HARNESS_PLAYBOOK").as_deref() {
        Some("guided") => PlaybookMode::Guided,
        Some("open") => PlaybookMode::Open,
        _ => PlaybookMode::Auto,
    };
    let rounds = env
        .get("VRCX0_HARNESS_REPEAT")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let report = env.get("VRCX0_HARNESS_REPORT").map(PathBuf::from);
    let baseline = env.get("VRCX0_HARNESS_BASELINE").map(PathBuf::from);
    let sql = SnapshotSql::open(&database, &user_id);
    let scenarios = Scenarios {
        only: env.get("VRCX0_HARNESS_ONLY"),
        ambiguous: find_ambiguous_fragment(&runtime, &database).await,
        fading_top: top_fading_friend(&runtime).await,
        window: custom_window_case(&sql),
        truth: Truth::take(&sql, &runtime).await,
    };
    drop(sql);
    let mut rig = Rig::start(scratch, runtime, |default| default).await;
    let harness = &mut rig.harness;

    let endpoint = harness
        .controller
        .endpoint_upsert(LlmEndpointUpsertInput {
            id: None,
            name: "SiliconFlow".into(),
            base_url,
            api_key: Some(api_key),
            models: Vec::new(),
            model_reasoning: None,
        })
        .expect("save endpoint");
    let detected = harness
        .controller
        .endpoint_detect_models(LlmEndpointDetectModelsInput {
            id: Some(endpoint.id.clone()),
            base_url: None,
            api_key: None,
            persist: Some(true),
        })
        .await
        .expect("detect models");
    println!("detected {} models; using {model}", detected.models.len());
    assert!(
        detected.models.contains(&model),
        "{model} is not offered by this endpoint"
    );
    harness
        .controller
        .set_default_runtime(Some(endpoint.id.clone()), Some(model), false, playbook_mode)
        .expect("select runtime");

    for round in 0..rounds {
        harness.round = round;
        if rounds > 1 {
            println!("\n##### round {} of {rounds} #####", round + 1);
        }
        scenarios.play(harness).await;
    }

    harness.report(report.as_deref(), baseline.as_deref());
    let _ = harness.controller.endpoint_delete(&endpoint.id);
    rig.finish().await;
}

struct WindowCase {
    question: String,
    top_names: Vec<String>,
}

struct Scenarios {
    only: Option<String>,
    ambiguous: Option<(String, Vec<String>)>,
    fading_top: Option<String>,
    window: Option<WindowCase>,
    truth: Truth,
}

impl Scenarios {
    fn runs(&self, scenario: &str) -> bool {
        self.only
            .as_deref()
            .is_none_or(|only| only.split(',').any(|name| name.trim() == scenario))
    }

    async fn play(&self, harness: &mut Harness) {
        self.play_known(harness).await;
        if self.runs("custom_window") {
            match &self.window {
                Some(case) => {
                    let log = harness
                        .ask("custom_window", None, "zh-CN", &case.question)
                        .await;
                    harness.check(
                        "custom_window",
                        case.top_names
                            .iter()
                            .any(|name| log.answer.contains(name.as_str())),
                        "the answer missed the top companion of the asked dates",
                    );
                }
                None => println!("\n=== custom_window ===\nskipped"),
            }
        }
        if self.runs("en_recent") {
            let log = harness
                .ask(
                    "en_recent",
                    None,
                    "en",
                    "Who have I spent the most time with over the last 7 days?",
                )
                .await;
            harness.check(
                "en_recent",
                reads_as_english(&log.answer),
                "an English question was not answered in English",
            );
            match &self.truth.seven_days {
                Some(names) => harness.check(
                    "en_recent",
                    names_any(&log.answer, names),
                    "the answer missed the top companion of the last 7 days",
                ),
                None => println!("en_recent: no co-presence in the last 7 days"),
            }
        }
        if self.runs("screenshots") {
            match &self.truth.screenshots {
                Some(truth) => play_screenshots(harness, truth).await,
                None => {
                    println!("\n=== screenshots ===\nskipped: no screenshot with other players")
                }
            }
        }
        if self.runs("world_profile") {
            match &self.truth.world {
                Some(world) => play_world_profile(harness, world).await,
                None => println!(
                    "
=== world_profile ===
skipped: no world visited twice"
                ),
            }
        }
    }

    async fn play_known(&self, harness: &mut Harness) {
        let runs = |scenario: &str| self.runs(scenario);
        if runs("weekly") {
            let weekly = harness
                .ask("weekly_top", None, "zh-CN", "这周我和谁一起玩得最多？")
                .await;
            harness.check(
                "weekly_top",
                !weekly.tool_calls.is_empty(),
                "answered without reading any data",
            );
            match &self.truth.week {
                Some(names) => harness.check(
                    "weekly_top",
                    names_any(&weekly.answer, names),
                    "the answer missed this week's top companion",
                ),
                None => println!("weekly_top: no co-presence this week, so no name to check"),
            }

            let follow_up = harness
                .ask(
                    "follow_up",
                    Some(weekly.session_id.clone()),
                    "zh-CN",
                    "那这些人里，有没有最近和我变疏远的？",
                )
                .await;
            harness.check(
                "follow_up",
                !follow_up.tool_calls.is_empty(),
                "follow-up did not read any data",
            );
        }

        if runs("ja_recent") {
            let ja_recent = harness
                .ask(
                    "ja_recent",
                    None,
                    "ja",
                    "最近いちばんよく一緒に遊んでいるフレンドは誰？",
                )
                .await;
            harness.check(
                "ja_recent",
                !ja_recent.tool_calls.is_empty(),
                "answered without reading any data",
            );
            harness.check(
                "ja_recent",
                self.truth.recent.is_empty() || names_any(&ja_recent.answer, &self.truth.recent),
                "the answer named none of the top companions of the last 7, 14 or 30 days",
            );
        }

        if runs("unknown_person") {
            harness
                .ask(
                    "unknown_person",
                    None,
                    "ja",
                    "Zyxwv Qprst さんとはどんな関係？",
                )
                .await;
        }

        match self.ambiguous.as_ref().filter(|_| runs("ambiguous_name")) {
            Some((fragment, candidates)) => {
                let question = format!("{fragment} はいつも誰と遊んでる？");
                let picked = harness.ask("ambiguous_name", None, "ja", &question).await;
                let asked_in_text = candidates
                    .iter()
                    .filter(|name| picked.answer.contains(name.as_str()))
                    .count()
                    >= 2;
                harness.check(
                    "ambiguous_name",
                    picked.choices > 0 || asked_in_text,
                    "an ambiguous name was neither put on the choice card nor asked about",
                );
            }
            None => println!("\n=== ambiguous_name ===\nskipped"),
        }

        if runs("writes_hidden") {
            let writes = harness
                .ask(
                    "writes_hidden",
                    None,
                    "zh-CN",
                    "把我最常一起玩的那个人加进我的本地收藏。",
                )
                .await;
            harness.check(
                "writes_hidden",
                !writes
                    .tool_calls
                    .iter()
                    .any(|name| WRITE_TOOLS.contains(&name.as_str())),
                "a write tool ran while writes are off",
            );
        }

        if runs("third_turn_recall") {
            let first = harness
                .ask("recall_1", None, "zh-CN", "最近有哪些好友和我变疏远了？")
                .await;
            let second = harness
                .ask(
                    "recall_2",
                    Some(first.session_id.clone()),
                    "zh-CN",
                    "我这个月一共玩了多久？",
                )
                .await;
            if let Some(minutes) = self.truth.month_minutes {
                harness.check(
                    "recall_2",
                    mentions_duration(&second.answer, minutes),
                    "the answer did not state this month's play time",
                );
            }
            let third = harness
                .ask(
                    "recall_3",
                    Some(first.session_id.clone()),
                    "zh-CN",
                    "第一个问题里排第一的那位，我和他最后一次一起玩是什么时候？",
                )
                .await;
            match self
                .fading_top
                .as_deref()
                .filter(|name| first.answer.contains(name))
            {
                Some(name) => harness.check(
                    "recall_3",
                    third.answer.contains(name),
                    "the third turn lost the person ranked first two turns earlier",
                ),
                None => println!("recall_3: no snapshot fading friend named in the first answer"),
            }
        }
    }
}

fn utc_midnight(day: chrono::NaiveDate) -> Option<String> {
    Some(
        day.and_hms_opt(0, 0, 0)?
            .and_local_timezone(chrono::Local)
            .earliest()?
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string(),
    )
}

fn custom_window_case(sql: &SnapshotSql) -> Option<WindowCase> {
    use chrono::Datelike;
    let today = chrono::Local::now().date_naive();
    let month_top = sql
        .companions_between(
            &utc_midnight(today - chrono::Days::new(30))?,
            &utc_midnight(today + chrono::Days::new(1))?,
        )
        .into_iter()
        .next()
        .map(|(user_id, _)| user_id);
    let mut fallback = None;
    for back in 7..=60 {
        let first_day = today - chrono::Days::new(back);
        let last_day = first_day + chrono::Days::new(2);
        let from = utc_midnight(first_day)?;
        let to = utc_midnight(last_day + chrono::Days::new(1))?;
        let ranked = sql.companions_between(&from, &to);
        let Some((top, top_minutes)) = ranked.first() else {
            continue;
        };
        let second_minutes = ranked.get(1).map_or(0, |(_, minutes)| *minutes);
        if *top_minutes < 60 || top_minutes * 2 < second_minutes * 3 {
            continue;
        }
        let top_names = sql.names_of(top, &from, &to);
        if top_names.is_empty() {
            continue;
        }
        let case = WindowCase {
            question: format!(
                "{}月{}日到{}月{}日这三天，我和哪位好友一起玩的时间最长？",
                first_day.month(),
                first_day.day(),
                last_day.month(),
                last_day.day()
            ),
            top_names,
        };
        if month_top.as_ref() != Some(top) {
            return Some(case);
        }
        fallback.get_or_insert(case);
    }
    if fallback.is_some() {
        println!("custom_window: every candidate window shares the 30-day top companion");
    }
    fallback
}

#[test]
fn answer_judges_read_durations_and_english() {
    assert!(mentions_duration(
        "这个月你一共玩了 41 小时 23 分钟。",
        2483
    ));
    assert!(mentions_duration("About 41.4 hours this month.", 2483));
    assert!(mentions_duration("合計 2,483 分です。", 2483));
    assert!(!mentions_duration("这个月你玩了 12 小时。", 2483));
    assert!(!mentions_duration("1, 2 and 3 sessions", 2483));
    assert!(reads_as_english("You spent the most time with Alice."));
    assert!(!reads_as_english("这周和你一起玩最多的是 Alice。"));
}

const SCRIPTED_MODEL: &str = "scripted";
const SCRIPTED_OWNER: &str = "usr_owner";

#[derive(Default)]
struct ScriptedLlm {
    turns: Mutex<VecDeque<AssistantTurn>>,
    requests: Mutex<Vec<Vec<ChatMessage>>>,
}

impl ScriptedLlm {
    fn last_tool_message(&self, request: usize) -> String {
        self.requests.lock().unwrap()[request]
            .iter()
            .rev()
            .find(|message| message.role == "tool")
            .and_then(|message| message.content.clone())
            .unwrap_or_default()
    }
}

impl AssistantLlmClientPort for ScriptedLlm {
    fn list_models(&self) -> AssistantLlmFuture<'_, LlmEndpointDetectModelsResult> {
        Box::pin(async {
            Ok(LlmEndpointDetectModelsResult {
                models: vec![SCRIPTED_MODEL.into()],
                model_reasoning: Vec::new(),
            })
        })
    }

    fn complete_chat<'a>(
        &'a self,
        _messages: &'a [ChatMessage],
        _options: &'a LlmRequestOptions,
    ) -> AssistantLlmFuture<'a, String> {
        Box::pin(async { Ok(String::new()) })
    }

    fn stream_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        _tools: &'a [ToolDefinition],
        _options: &'a LlmRequestOptions,
        mut on_text: Box<dyn FnMut(&str) + Send + 'a>,
    ) -> AssistantLlmFuture<'a, AssistantTurn> {
        self.requests.lock().unwrap().push(messages.to_vec());
        let turn = self.turns.lock().unwrap().pop_front();
        Box::pin(async move {
            let turn =
                turn.ok_or_else(|| AssistantLlmError::Http("the script ran out of turns".into()))?;
            on_text(&turn.content);
            Ok(turn)
        })
    }
}

struct ScriptedFactory(Arc<ScriptedLlm>);

impl AssistantLlmClientFactoryPort for ScriptedFactory {
    fn create(
        &self,
        _input: AssistantLlmClientInput,
    ) -> Result<Arc<dyn AssistantLlmClientPort>, AssistantLlmError> {
        Ok(self.0.clone())
    }
}

fn call(id: &str, name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: id.into(),
        kind: "function".into(),
        function: FunctionCall {
            name: name.into(),
            arguments: arguments.into(),
        },
        extra_content: None,
    }
}

fn tool_turn(calls: Vec<ToolCall>, finish_reason: &str) -> AssistantTurn {
    AssistantTurn {
        content: String::new(),
        tool_calls: calls,
        reasoning_details: Vec::new(),
        finish_reason: Some(finish_reason.into()),
    }
}

fn answer(text: &str) -> AssistantTurn {
    AssistantTurn {
        content: text.into(),
        tool_calls: Vec::new(),
        reasoning_details: Vec::new(),
        finish_reason: Some("stop".into()),
    }
}

fn joined(created_at: &str, name: &str, user_id: &str) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.into(),
        event_type: "OnPlayerJoined".into(),
        display_name: name.into(),
        location: "wrld_a:1".into(),
        user_id: user_id.into(),
        world_name: "World A".into(),
        time: 0,
    }
}

struct ScriptedRun {
    rig: Rig,
    llm: Arc<ScriptedLlm>,
}

impl ScriptedRun {
    async fn start(turns: Vec<AssistantTurn>) -> Self {
        let scratch = ScratchDir::new("loop");
        std::fs::create_dir_all(scratch.0.join("app-data")).unwrap();
        let runtime = Rig::runtime(&scratch);
        Rig::sign_in(&runtime, SCRIPTED_OWNER);
        write_batch(
            runtime.database().as_ref(),
            &OwnerId::new(SCRIPTED_OWNER),
            &GameLogWriteBatch {
                join_leave: vec![
                    joined("2026-06-01T20:00:00.000Z", "Alice", "usr_alice"),
                    joined("2026-06-02T20:00:00.000Z", "Alicia", "usr_alicia"),
                ],
                ..GameLogWriteBatch::default()
            },
        )
        .expect("seed game log");
        let llm = Arc::new(ScriptedLlm {
            turns: Mutex::new(turns.into()),
            ..ScriptedLlm::default()
        });
        let factory: AssistantLlmClientFactory = Arc::new(ScriptedFactory(Arc::clone(&llm)));
        let rig = Rig::start(scratch, runtime, |_| factory).await;
        let controller = &rig.harness.controller;
        let endpoint = controller
            .endpoint_upsert(LlmEndpointUpsertInput {
                id: None,
                name: "Scripted".into(),
                base_url: "https://llm.invalid/v1".into(),
                api_key: Some("test-key".into()),
                models: vec![SCRIPTED_MODEL.into()],
                model_reasoning: None,
            })
            .expect("save endpoint");
        controller
            .set_default_runtime(
                Some(endpoint.id),
                Some(SCRIPTED_MODEL.into()),
                false,
                PlaybookMode::Open,
            )
            .expect("select runtime");
        Self { rig, llm }
    }

    async fn ask(&mut self, question: &str) -> TurnLog {
        self.rig.harness.ask("scripted", None, "en", question).await
    }

    async fn finish(self) {
        self.rig.finish().await;
    }
}

#[tokio::test]
async fn scripted_turn_runs_a_real_tool_and_answers_from_its_result() {
    let mut run = ScriptedRun::start(vec![
        tool_turn(
            vec![call("call_1", "find_user", r#"{"name":"Alice"}"#)],
            "tool_calls",
        ),
        answer("Alice is in your history."),
    ])
    .await;

    let log = run.ask("Who is Alice?").await;

    assert_eq!(log.tool_calls, ["find_user"]);
    assert!(log.failed_tools.is_empty(), "{:?}", log.failed_tools);
    assert_eq!(log.answer, "Alice is in your history.");
    assert!(run.llm.last_tool_message(1).contains("usr_alice"));
    let session = run
        .rig
        .harness
        .controller
        .get_session(&log.session_id)
        .unwrap()
        .unwrap();
    let roles: Vec<Role> = session
        .messages
        .iter()
        .map(|message| message.role)
        .collect();
    assert_eq!(
        roles,
        [
            Role::User,
            Role::ToolCall,
            Role::ToolResult,
            Role::Assistant
        ]
    );
    run.finish().await;
}

#[tokio::test]
async fn scripted_ambiguous_name_waits_for_a_pick_and_feeds_the_rerun_back() {
    let mut run = ScriptedRun::start(vec![
        tool_turn(
            vec![call("call_1", "get_companions_of", r#"{"user":"Ali"}"#)],
            "tool_calls",
        ),
        answer("Here is who they play with."),
    ])
    .await;

    let log = run.ask("Who does Ali play with?").await;

    assert_eq!(log.choices, 1);
    assert!(log.failed_tools.is_empty(), "{:?}", log.failed_tools);
    let fed_back = run.llm.last_tool_message(1);
    assert!(!fed_back.contains("needsDisambiguation"), "{fed_back}");
    run.finish().await;
}

#[tokio::test]
async fn scripted_broken_and_truncated_calls_come_back_as_tool_errors() {
    let mut run = ScriptedRun::start(vec![
        tool_turn(vec![call("call_1", "find_user", "{not json")], "tool_calls"),
        tool_turn(
            vec![call("call_2", "find_user", r#"{"name":"Alice"}"#)],
            "length",
        ),
        answer("I could not look that up."),
    ])
    .await;

    let log = run.ask("Who is Alice?").await;

    assert_eq!(log.failed_tools.len(), 2, "{:?}", log.failed_tools);
    assert!(run
        .llm
        .last_tool_message(1)
        .contains("not a valid JSON object"));
    assert!(run.llm.last_tool_message(2).contains("output token limit"));
    assert_eq!(log.answer, "I could not look that up.");
    run.finish().await;
}

struct ToolProbe {
    tools: vrcx_0_mcp::InProcessMcpTools,
    sizes: Vec<(String, usize)>,
    dump_dir: Option<PathBuf>,
}

impl ToolProbe {
    async fn call(&mut self, name: &'static str, arguments: Value) -> Value {
        let outcome = self
            .tools
            .call_tool(name, arguments.as_object().cloned())
            .await
            .unwrap_or_else(|error| panic!("{name} failed to dispatch: {error}"));
        assert!(
            !outcome.is_error,
            "{name} {arguments} failed: {}",
            outcome.text
        );
        let value = outcome.structured.unwrap_or(Value::Null);
        if let Some(dir) = &self.dump_dir {
            let file = dir.join(format!("{:02}_{name}.json", self.sizes.len()));
            let body = json!({ "arguments": arguments, "result": value });
            std::fs::write(file, serde_json::to_string_pretty(&body).unwrap()).unwrap();
        }
        let keys = arguments
            .as_object()
            .map(|map| map.keys().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_default();
        self.sizes
            .push((format!("{name}({keys})"), value.to_string().chars().count()));
        value
    }
}

struct SnapshotSql {
    connection: rusqlite::Connection,
    owner: String,
    owner_row: i64,
    prefix: String,
}

impl SnapshotSql {
    fn open(database: &Path, owner: &str) -> Self {
        let connection =
            rusqlite::Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .expect("open the snapshot");
        let owner_row = connection
            .query_row("SELECT id FROM owners WHERE user_id = ?1", [owner], |row| {
                row.get(0)
            })
            .unwrap_or(0);
        Self {
            connection,
            owner: owner.to_string(),
            owner_row,
            prefix: owner.replace(['-', '_'], ""),
        }
    }

    fn table(&self, suffix: &str) -> String {
        format!("{}_{suffix}", self.prefix)
    }

    fn int(&self, sql: &str, params: impl rusqlite::Params) -> i64 {
        self.connection
            .query_row(sql, params, |row| row.get::<_, Option<i64>>(0))
            .unwrap_or_else(|error| panic!("{sql}: {error}"))
            .unwrap_or(0)
    }

    fn text(&self, sql: &str, params: impl rusqlite::Params) -> Option<String> {
        self.connection
            .query_row(sql, params, |row| row.get::<_, Option<String>>(0))
            .ok()
            .flatten()
    }

    fn copresence_minutes(&self, user_id: &str, from: &str, to: &str) -> i64 {
        self.int(
            "SELECT SUM(MAX(0,
                 MIN(strftime('%s', created_at) * 1000, strftime('%s', ?4) * 1000)
                 - MAX(strftime('%s', created_at) * 1000 - COALESCE(time, 0), strftime('%s', ?3) * 1000)
             )) / 60000
             FROM gamelog_join_leave
             WHERE owner_id IN (0, ?1) AND type = 'OnPlayerLeft' AND user_id = ?2
               AND strftime('%s', created_at) * 1000 > strftime('%s', ?3) * 1000
               AND strftime('%s', created_at) * 1000 - COALESCE(time, 0) < strftime('%s', ?4) * 1000",
            rusqlite::params![self.owner_row, user_id, from, to],
        )
    }

    fn top_screenshot_person(&self) -> Option<ScreenshotTruth> {
        let path = self.connection.path()?.to_string();
        let cache = std::path::Path::new(&path).with_file_name("metadataCache.db");
        let connection =
            rusqlite::Connection::open_with_flags(cache, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        connection
            .query_row(
                "SELECT json_extract(p.value, '$.id') AS player_id,
                        json_extract(p.value, '$.displayName')
                 FROM screenshot_files f, json_each(f.metadata_json, '$.players') p
                 WHERE substr(json_extract(p.value, '$.id'), 1, 4) = 'usr_'
                   AND json_extract(p.value, '$.id')
                       <> COALESCE(json_extract(f.metadata_json, '$.author.id'), '')
                 GROUP BY player_id ORDER BY COUNT(*) DESC LIMIT 1",
                [],
                |row| {
                    Ok(ScreenshotTruth {
                        top_person_id: row.get(0)?,
                        top_person_name: row.get(1)?,
                    })
                },
            )
            .ok()
    }

    fn most_visited_world(&self) -> Option<WorldTruth> {
        let (id, name, total_minutes) = self
            .connection
            .query_row(
                "SELECT world_id, MAX(world_name), SUM(MAX(COALESCE(time, 0), 0)) / 60000
                 FROM gamelog_location
                 WHERE owner_id IN (0, ?1) AND world_id LIKE 'wrld%' AND world_name <> ''
                 GROUP BY world_id HAVING COUNT(*) >= 2
                 ORDER BY COUNT(*) DESC LIMIT 1",
                [self.owner_row],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get(2)?,
                    ))
                },
            )
            .ok()?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT display_name FROM gamelog_join_leave
                 WHERE owner_id IN (0, ?1) AND type = 'OnPlayerLeft' AND user_id <> ?2
                   AND trim(user_id) <> ''
                   AND (location = ?3 OR substr(location, 1, length(?3) + 1) = ?3 || ':')
                 GROUP BY user_id ORDER BY SUM(COALESCE(time, 0)) DESC LIMIT 3",
            )
            .unwrap();
        let top_people = statement
            .query_map(rusqlite::params![self.owner_row, self.owner, id], |row| {
                row.get(0)
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        Some(WorldTruth {
            id,
            name,
            total_minutes,
            top_people,
        })
    }

    fn friends_by_copresence(&self) -> Vec<(String, i64)> {
        let sql = format!(
            "SELECT g.user_id, SUM(COALESCE(g.time, 0)) / 60000
             FROM gamelog_join_leave g
             WHERE g.owner_id IN (0, ?1) AND g.type = 'OnPlayerLeft' AND g.user_id <> ?2
               AND EXISTS (SELECT 1 FROM {} f WHERE f.user_id = g.user_id)
             GROUP BY g.user_id ORDER BY SUM(COALESCE(g.time, 0)) DESC, g.user_id",
            self.table("friend_log_current")
        );
        let mut statement = self.connection.prepare(&sql).unwrap();
        statement
            .query_map(rusqlite::params![self.owner_row, self.owner], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    fn companions_between(&self, from: &str, to: &str) -> Vec<(String, i64)> {
        let sql = format!(
            "SELECT g.user_id, SUM(MAX(0,
                 MIN(strftime('%s', g.created_at) * 1000, strftime('%s', ?4) * 1000)
                 - MAX(strftime('%s', g.created_at) * 1000 - COALESCE(g.time, 0), strftime('%s', ?3) * 1000)
             )) / 60000 AS minutes
             FROM gamelog_join_leave g
             WHERE g.owner_id IN (0, ?1) AND g.type = 'OnPlayerLeft' AND g.user_id <> ?2
               AND strftime('%s', g.created_at) * 1000 > strftime('%s', ?3) * 1000
               AND strftime('%s', g.created_at) * 1000 - COALESCE(g.time, 0) < strftime('%s', ?4) * 1000
               AND EXISTS (SELECT 1 FROM {} f WHERE f.user_id = g.user_id)
             GROUP BY g.user_id ORDER BY minutes DESC, g.user_id",
            self.table("friend_log_current")
        );
        let mut statement = self.connection.prepare(&sql).unwrap();
        statement
            .query_map(
                rusqlite::params![self.owner_row, self.owner, from, to],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    fn top_names(&self, from: &str, to: &str) -> Option<Vec<String>> {
        let ranked = self.companions_between(from, to);
        let top_minutes = ranked
            .first()
            .map(|(_, minutes)| *minutes)
            .filter(|minutes| *minutes > 0)?;
        let mut names: Vec<String> = ranked
            .iter()
            .take_while(|(_, minutes)| *minutes + 1 >= top_minutes)
            .take(3)
            .flat_map(|(user_id, _)| self.names_of(user_id, from, to))
            .collect();
        names.dedup();
        (!names.is_empty()).then_some(names)
    }

    fn names_of(&self, user_id: &str, from: &str, to: &str) -> Vec<String> {
        let current = self.text(
            &format!(
                "SELECT display_name FROM {} WHERE user_id = ?1",
                self.table("friend_log_current")
            ),
            [user_id],
        );
        let observed = self.text(
            "SELECT display_name FROM gamelog_join_leave
             WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3
             ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![user_id, from, to],
        );
        let mut names: Vec<String> = [current, observed]
            .into_iter()
            .flatten()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect();
        names.dedup();
        names
    }

    fn friend_components(&self) -> (usize, Vec<usize>) {
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT user_id FROM {} WHERE trim(user_id) <> ''",
                self.table("friend_log_current")
            ))
            .unwrap();
        let friends: BTreeSet<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT friend_id, mutual_id FROM {}",
                self.table("mutual_graph_links")
            ))
            .unwrap();
        let links: Vec<(String, String)> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        let mut parent: HashMap<String, String> =
            friends.iter().map(|id| (id.clone(), id.clone())).collect();
        let root = |parent: &HashMap<String, String>, id: &str| {
            let mut current = id.to_string();
            while parent[&current] != current {
                current = parent[&current].clone();
            }
            current
        };
        for (left, right) in links {
            if left != right && parent.contains_key(&left) && parent.contains_key(&right) {
                let left_root = root(&parent, &left);
                let right_root = root(&parent, &right);
                parent.insert(left_root, right_root);
            }
        }
        let mut sizes: HashMap<String, usize> = HashMap::new();
        for id in &friends {
            *sizes.entry(root(&parent, id)).or_default() += 1;
        }
        let mut circles: Vec<usize> = sizes.into_values().filter(|size| *size >= 2).collect();
        circles.sort_unstable_by(|left, right| right.cmp(left));
        (friends.len(), circles)
    }
}

#[derive(Default)]
struct Verdicts(Vec<String>);

impl Verdicts {
    fn expect_eq<T: PartialEq + std::fmt::Debug>(&mut self, what: &str, tool: T, snapshot: T) {
        if tool != snapshot {
            self.0
                .push(format!("{what}: tool={tool:?} snapshot={snapshot:?}"));
        }
    }

    fn expect(&mut self, what: &str, passed: bool) {
        if !passed {
            self.0.push(what.to_string());
        }
    }
}

fn rows(value: &Value) -> &[Value] {
    value["rows"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn bucket_total(row: &Value) -> i64 {
    row["buckets"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, count)| count.as_i64())
        .sum()
}

#[tokio::test]
#[ignore = "reads a snapshot of the local VRCX-0 database; optional VRCX0_HARNESS_DATA_DIR, VRCX0_HARNESS_USER_ID and VRCX0_HARNESS_DUMP_DIR (env or .env.local)"]
async fn assistant_tools_agree_with_the_snapshot() {
    let env = HarnessEnv::load();
    let Snapshot {
        scratch,
        runtime,
        database,
        user_id,
    } = Snapshot::take(&env, "tools");
    let dump_dir = env.get("VRCX0_HARNESS_DUMP_DIR").map(PathBuf::from);
    if let Some(dir) = &dump_dir {
        std::fs::create_dir_all(dir).unwrap();
    }
    let mut probe = ToolProbe {
        tools: vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(
            &runtime,
            harness_chatbox(),
            McpCaller::Assistant,
        ))
        .await
        .expect("spawn tools"),
        sizes: Vec::new(),
        dump_dir,
    };
    let sql = SnapshotSql::open(&database, &user_id);
    let mut verdicts = Verdicts::default();
    let now = chrono::Utc::now();
    let to = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let from = (now - chrono::Duration::days(30))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let window = json!({ "from": from, "to": to });
    let online = sql.table("feed_online_offline");
    let status = sql.table("feed_status");

    let ranked = sql.friends_by_copresence();
    let top = probe
        .call("get_copresence_summary", json!({ "limit": 3 }))
        .await;
    verdicts.expect_eq(
        "copresence totalRows",
        top["totalRows"].as_u64().unwrap_or_default() as usize,
        ranked.len(),
    );
    for (row, (user, minutes)) in rows(&top).iter().zip(&ranked) {
        verdicts.expect_eq(
            "copresence all-time ranking",
            (row["userId"].as_str(), row["totalMinutes"].as_i64()),
            (Some(user.as_str()), Some(*minutes)),
        );
    }

    let recent = probe
        .call(
            "get_copresence_summary",
            json!({ "timeWindow": window, "limit": 5 }),
        )
        .await;
    for row in rows(&recent) {
        verdicts.expect_eq(
            "copresence 30d minutes",
            row["totalMinutes"].as_i64().unwrap_or_default(),
            sql.copresence_minutes(row["userId"].as_str().unwrap_or_default(), &from, &to),
        );
    }

    let changes = probe
        .call(
            "get_friend_changes",
            json!({ "kind": "status", "timeWindow": window, "limit": 5 }),
        )
        .await;
    verdicts.expect_eq(
        "friend_changes busiest friend",
        rows(&changes)
            .first()
            .and_then(|row| row["changeCount"].as_i64())
            .unwrap_or_default(),
        sql.int(
            &format!(
                "SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM {status}
                 WHERE trim(user_id) <> '' AND created_at >= ?1 AND created_at <= ?2
                 GROUP BY user_id)"
            ),
            rusqlite::params![from, to],
        ),
    );
    for row in rows(&changes) {
        verdicts.expect_eq(
            "friend_changes per-friend count",
            row["changeCount"].as_i64().unwrap_or_default(),
            sql.int(
                &format!(
                    "SELECT COUNT(*) FROM {status}
                     WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3"
                ),
                rusqlite::params![row["userId"].as_str().unwrap_or_default(), from, to],
            ),
        );
    }

    if let Some((friend, minutes)) = ranked.get(100).or(ranked.first()) {
        let profile = probe
            .call(
                "get_friend_profile",
                json!({ "user": friend, "utcOffsetMinutes": 540 }),
            )
            .await;
        verdicts.expect_eq(
            "friend_profile copresence minutes",
            profile["copresence"]["totalMinutes"].as_i64(),
            Some(*minutes),
        );
        let peak_hour = sql.text(
            &format!(
                "SELECT strftime('%H', created_at, '+540 minutes') AS hour FROM {online}
                 WHERE type = 'Online' AND user_id = ?1
                 GROUP BY hour ORDER BY COUNT(*) DESC, hour ASC LIMIT 1"
            ),
            [friend],
        );
        verdicts.expect_eq(
            "friend_profile local peak hour",
            profile["activityPattern"]["typicalOnlineWindow"]
                .as_str()
                .and_then(|label| label.get(..2))
                .map(str::to_string),
            peak_hour,
        );
        verdicts.expect_eq(
            "friend_profile status changes",
            profile["recentChanges"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|row| row["kind"] == "status")
                .and_then(|row| row["changeCount"].as_i64())
                .unwrap_or_default(),
            sql.int(
                &format!("SELECT COUNT(*) FROM {status} WHERE user_id = ?1"),
                [friend],
            ),
        );
    }

    let patterns = probe
        .call(
            "get_friend_activity_pattern",
            json!({ "limit": 5, "utcOffsetMinutes": 540 }),
        )
        .await;
    let totals: Vec<i64> = rows(&patterns).iter().map(bucket_total).collect();
    verdicts.expect("friend_activity_pattern honours limit", totals.len() <= 5);
    verdicts.expect(
        "friend_activity_pattern is sorted by online events",
        totals.windows(2).all(|pair| pair[0] >= pair[1]),
    );
    verdicts.expect_eq(
        "friend_activity_pattern most active friend",
        totals.first().copied().unwrap_or_default(),
        sql.int(
            &format!(
                "SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM {online}
                 WHERE type = 'Online' AND trim(user_id) <> '' GROUP BY user_id)"
            ),
            [],
        ),
    );

    let best = probe
        .call(
            "get_best_time_to_play",
            json!({ "utcOffsetMinutes": 540, "limit": 3 }),
        )
        .await;
    for row in rows(&best) {
        verdicts.expect_eq(
            "best_time distinct friends per hour",
            row["distinctFriends"].as_i64().unwrap_or_default(),
            sql.int(
                &format!(
                    "SELECT COUNT(DISTINCT user_id) FROM {online}
                     WHERE type = 'Online' AND trim(user_id) <> ''
                       AND strftime('%H', created_at, '+540 minutes') = ?1"
                ),
                [row["bucket"].as_str().unwrap_or_default()],
            ),
        );
    }

    let visits = probe
        .call(
            "search_worlds_visited",
            json!({ "timeWindow": window, "limit": 25 }),
        )
        .await;
    verdicts.expect_eq(
        "search_worlds_visited row count",
        rows(&visits).len() as i64,
        sql.int(
            "SELECT COUNT(*) FROM gamelog_location WHERE owner_id IN (0, ?1)
             AND created_at >= ?2 AND created_at <= ?3",
            rusqlite::params![sql.owner_row, from, to],
        )
        .min(25),
    );

    let friend_log = probe.call("get_friend_log", json!({ "limit": 5 })).await;
    let logged = sql.int(
        &format!("SELECT COUNT(*) FROM {}", sql.table("friend_log_history")),
        [],
    );
    verdicts.expect(
        "friend_log summary reports the full total",
        friend_log["summary"]
            .as_str()
            .unwrap_or_default()
            .contains(&format!("of {logged} ")),
    );

    let notes = probe.call("get_friend_note", json!({})).await;
    verdicts.expect_eq(
        "friend_note totalRows",
        notes["totalRows"].as_i64().unwrap_or_default(),
        sql.int("SELECT COUNT(*) FROM memos", []),
    );

    if let Some((friend, _)) = ranked.first() {
        let name = sql
            .text(
                &format!(
                    "SELECT display_name FROM {} WHERE user_id = ?1",
                    sql.table("friend_log_current")
                ),
                [friend],
            )
            .unwrap_or_default();
        let found = probe.call("find_user", json!({ "name": name })).await;
        verdicts.expect_eq(
            "find_user ranks the exact friend first",
            rows(&found).first().and_then(|row| row["userId"].as_str()),
            Some(friend.as_str()),
        );
        probe
            .call("get_companions_of", json!({ "user": friend }))
            .await;
        probe
            .call(
                "recall_encounter",
                json!({ "coPresentWith": friend, "timeWindow": window }),
            )
            .await;
        probe
            .call(
                "search_friend_feed",
                json!({ "target": friend, "timeWindow": window }),
            )
            .await;
    }

    let summary = probe
        .call("summarize_social_period", json!({ "timeWindow": window }))
        .await;
    verdicts.expect_eq(
        "summarize top companion matches copresence",
        summary["topCompanions"][0]["userId"].as_str(),
        rows(&recent).first().and_then(|row| row["userId"].as_str()),
    );
    let activity = probe
        .call("get_my_activity", json!({ "timeWindow": window }))
        .await;
    verdicts.expect_eq(
        "summarize activity matches get_my_activity",
        summary["activity"]["totalMinutes"].as_i64(),
        activity["totalMinutes"].as_i64(),
    );

    let streaks = probe
        .call("get_activity_streaks", json!({ "utcOffsetMinutes": 540 }))
        .await;
    let all_time = probe.call("get_my_activity", json!({})).await;
    verdicts.expect_eq(
        "activity_streaks sessionCount matches get_my_activity",
        streaks["sessionCount"].as_i64(),
        all_time["sessionCount"].as_i64(),
    );
    let streak_minutes = streaks["totalMinutes"].as_i64().unwrap_or_default();
    let played_minutes = all_time["totalMinutes"].as_i64().unwrap_or_default();
    verdicts.expect(
        "activity_streaks totalMinutes is at least the played minutes",
        streak_minutes >= played_minutes,
    );
    println!(
        "activity_streaks counts {} more minutes than get_my_activity (gaps inside merged sessions)",
        streak_minutes - played_minutes
    );
    let timeline = probe
        .call("get_activity_timeline", json!({ "utcOffsetMinutes": 540 }))
        .await;
    let bucket_minutes: i64 = rows(&timeline)
        .iter()
        .filter_map(|row| row["minutes"].as_i64())
        .sum();
    verdicts.expect(
        "activity_timeline buckets add up to the streak total",
        (streak_minutes - bucket_minutes).abs() <= rows(&timeline).len() as i64,
    );

    let pivot = (now - chrono::Duration::days(30))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let prior_from = (now - chrono::Duration::days(60))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let left_minutes = |user: &str, from: &str, to: &str, end: &str| {
        sql.int(
            &format!(
                "SELECT SUM(time) / 60000 FROM gamelog_join_leave
                 WHERE owner_id IN (0, ?1) AND type = 'OnPlayerLeft' AND time > 0
                   AND user_id = ?2 AND created_at >= ?3 AND created_at {end} ?4"
            ),
            rusqlite::params![sql.owner_row, user, from, to],
        )
    };
    let fading = probe
        .call("get_fading_friends", json!({ "limit": 5 }))
        .await;
    for row in rows(&fading) {
        let user = row["userId"].as_str().unwrap_or_default();
        verdicts.expect_eq(
            "fading_friends prior and recent minutes",
            (row["priorMinutes"].as_i64(), row["recentMinutes"].as_i64()),
            (
                Some(left_minutes(user, &prior_from, &pivot, "<")),
                Some(left_minutes(user, &pivot, &to, "<=")),
            ),
        );
    }

    let favorites = probe.call("get_favorites", json!({})).await;
    let favorite_total = favorites["totalRows"].as_i64().unwrap_or_default();
    verdicts.expect_eq(
        "favorites totalRows",
        favorite_total,
        sql.int(
            "SELECT (SELECT COUNT(*) FROM favorite_world) + (SELECT COUNT(*) FROM favorite_avatar)
                  + (SELECT COUNT(*) FROM favorite_friend WHERE owner_id IN (0, ?1))",
            [sql.owner_row],
        ),
    );
    verdicts.expect_eq(
        "favorites groups add up to totalRows",
        favorites["groups"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|group| group["count"].as_i64())
            .sum::<i64>(),
        favorite_total,
    );

    let circles = probe.call("get_friend_circles", json!({})).await;
    let (friend_count, components) = sql.friend_components();
    verdicts.expect_eq(
        "friend_circles friendsAnalyzed",
        circles["friendsAnalyzed"].as_u64(),
        Some(friend_count as u64),
    );
    verdicts.expect_eq(
        "friend_circles circleCount",
        circles["circleCount"].as_u64(),
        Some(components.len() as u64),
    );
    verdicts.expect_eq(
        "friend_circles largest circle",
        circles["circles"][0]["memberCount"].as_u64(),
        components.first().map(|size| *size as u64),
    );
    verdicts.expect_eq(
        "friend_circles isolatedFriendCount",
        circles["isolatedFriendCount"].as_u64(),
        Some((friend_count - components.iter().sum::<usize>()) as u64),
    );

    let invites = probe
        .call(
            "get_invite_history",
            json!({ "timeWindow": window, "limit": 25 }),
        )
        .await;
    let v1 = sql.table("notifications");
    let v2 = sql.table("notifications_v2");
    for row in rows(&invites) {
        let user = row["userId"].as_str().unwrap_or_default();
        let expected = if row["direction"] == "sent" {
            sql.int(
                &format!(
                    "SELECT COUNT(*) FROM {v1} WHERE type LIKE '%invite%'
                     AND sender_user_id = ?1 AND receiver_user_id = ?2
                     AND created_at >= ?3 AND created_at <= ?4"
                ),
                rusqlite::params![sql.owner, user, from, to],
            )
        } else {
            sql.int(
                &format!(
                    "SELECT (SELECT COUNT(*) FROM {v1} WHERE type LIKE '%invite%'
                             AND sender_user_id = ?2 AND sender_user_id <> ?1
                             AND created_at >= ?3 AND created_at <= ?4)
                          + (SELECT COUNT(*) FROM {v2} WHERE type LIKE '%invite%'
                             AND sender_user_id = ?2
                             AND created_at >= ?3 AND created_at <= ?4)"
                ),
                rusqlite::params![sql.owner, user, from, to],
            )
        };
        verdicts.expect_eq(
            "invite_history per-person count",
            row["totalCount"].as_i64().unwrap_or_default(),
            expected,
        );
    }

    let graph = probe.call("get_social_graph", json!({})).await;
    let links = sql.table("mutual_graph_links");
    let graph_friends = sql.table("mutual_graph_friends");
    verdicts.expect_eq(
        "social_graph totalEdges",
        graph["totalEdges"].as_i64(),
        Some(sql.int(&format!("SELECT COUNT(*) FROM {links}"), [])),
    );
    verdicts.expect_eq(
        "social_graph totalNodes",
        graph["totalNodes"].as_i64(),
        Some(sql.int(
            &format!(
                "SELECT COUNT(*) FROM (SELECT friend_id FROM {graph_friends}
                 UNION SELECT friend_id FROM {links} UNION SELECT mutual_id FROM {links})"
            ),
            [],
        )),
    );
    verdicts.expect_eq(
        "social_graph highest degree",
        graph["nodes"][0]["connectionDegree"].as_i64(),
        Some(sql.int(
            &format!(
                "SELECT MAX(degree) FROM (SELECT a, COUNT(DISTINCT b) AS degree FROM (
                     SELECT friend_id AS a, mutual_id AS b FROM {links}
                     UNION SELECT mutual_id, friend_id FROM {links}) GROUP BY a)"
            ),
            [],
        )),
    );

    let visit_start = sql.text(
        "SELECT created_at FROM gamelog_location WHERE owner_id IN (0, ?1) AND time > 0
         AND created_at >= ?2 ORDER BY created_at DESC, id DESC LIMIT 1",
        rusqlite::params![sql.owner_row, from],
    );
    if let Some(joined_at) = visit_start {
        let next_start = sql.text(
            "SELECT created_at FROM gamelog_location WHERE owner_id IN (0, ?1)
             AND created_at > ?2 ORDER BY created_at ASC, id ASC LIMIT 1",
            rusqlite::params![sql.owner_row, joined_at],
        );
        let visit = probe
            .call("get_visit_timeline", json!({ "at": joined_at }))
            .await;
        verdicts.expect_eq(
            "visit_timeline picks the visit containing `at`",
            visit["visit"]["joinedAt"].as_str(),
            Some(joined_at.as_str()),
        );
        verdicts.expect_eq(
            "visit_timeline peopleObserved",
            visit["peopleObserved"].as_i64(),
            Some(sql.int(
                "SELECT COUNT(DISTINCT CASE WHEN trim(COALESCE(user_id, '')) = ''
                     THEN 'name:' || display_name ELSE user_id END)
                 FROM gamelog_join_leave
                 WHERE owner_id IN (0, ?1) AND created_at >= ?2
                   AND (?3 IS NULL OR created_at < ?3)
                   AND type IN ('OnPlayerJoined', 'OnPlayerLeft') AND display_name <> ''
                   AND COALESCE(user_id, '') <> ?4",
                rusqlite::params![sql.owner_row, joined_at, next_start, sql.owner],
            )),
        );
    }

    for (name, arguments) in [
        ("recall_encounter", json!({ "timeWindow": "7d" })),
        ("search_friend_feed", json!({ "timeWindow": "7d" })),
    ] {
        probe.call(name, arguments).await;
    }

    println!("\n| tool call | result chars |\n|---|---|");
    for (label, size) in &probe.sizes {
        println!("| {label} | {size} |");
    }
    drop(probe);
    drop(sql);
    runtime.stop_runtime_tasks();
    drop(runtime);
    scratch.remove_when_released().await;
    assert!(
        verdicts.0.is_empty(),
        "tool results disagree with the snapshot:\n{}",
        verdicts.0.join("\n")
    );
}
