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

struct Harness {
    controller: AssistantController,
    events: UnboundedReceiver<(String, Value)>,
    failures: Vec<String>,
    meter: Arc<LlmMeter>,
    metrics: Vec<(String, usize, TurnMetrics)>,
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
        self.metrics
            .push((node.to_string(), log.tool_calls.len(), log.metrics.clone()));
        log.print(node, question);
        self.check(node, log.error.is_none(), "turn ended with an error");
        self.check(node, !log.answer.trim().is_empty(), "answer is empty");
        self.check(
            node,
            !exposes_user_id(&log.answer),
            "answer exposes a raw usr_ id",
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

    fn print_metrics(&self) {
        println!(
            "\n| node | tool calls | LLM requests | prompt chars | tool result chars | secs |"
        );
        println!("|---|---|---|---|---|---|");
        for (node, tool_calls, metrics) in &self.metrics {
            println!(
                "| {node} | {tool_calls} | {} | {} | {} | {:.1} |",
                metrics.llm_requests,
                metrics.prompt_chars,
                metrics.tool_result_chars,
                metrics.elapsed.as_secs_f64()
            );
        }
    }

    fn check(&mut self, node: &str, passed: bool, problem: &str) {
        if !passed {
            self.failures.push(format!("{node}: {problem}"));
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
        let mut deps = assistant_controller_deps_for(&runtime);
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
                metrics: Vec::new(),
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
        assert!(failures.is_empty(), "failures:\n{}", failures.join("\n"));
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

        let runtime = Rig::runtime(&scratch);
        let user_id = env.get("VRCX0_HARNESS_USER_ID").unwrap_or_else(|| {
            runtime
                .desktop_assembly()
                .config()
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
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(runtime, McpCaller::Assistant))
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
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(runtime, McpCaller::Assistant))
        .await
        .expect("spawn probe tools");
    let outcome = tools.call_tool("get_fading_friends", None).await.ok()?;
    outcome.structured?["rows"][0]["displayName"]
        .as_str()
        .map(str::to_string)
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
        ..
    } = Snapshot::take(&env, "harness");
    let only = env.get("VRCX0_HARNESS_ONLY");
    let runs = |scenario: &str| {
        only.as_deref()
            .is_none_or(|only| only.split(',').any(|name| name.trim() == scenario))
    };
    let playbook_mode = match env.get("VRCX0_HARNESS_PLAYBOOK").as_deref() {
        Some("guided") => PlaybookMode::Guided,
        Some("open") => PlaybookMode::Open,
        _ => PlaybookMode::Auto,
    };
    let ambiguous = find_ambiguous_fragment(&runtime, &database).await;
    let fading_top = top_fading_friend(&runtime).await;
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

    if runs("weekly") {
        let weekly = harness
            .ask("weekly_top", None, "zh-CN", "这周我和谁一起玩得最多？")
            .await;
        harness.check(
            "weekly_top",
            !weekly.tool_calls.is_empty(),
            "answered without reading any data",
        );

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

    match ambiguous.filter(|_| runs("ambiguous_name")) {
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
        harness
            .ask(
                "recall_2",
                Some(first.session_id.clone()),
                "zh-CN",
                "我这个月一共玩了多久？",
            )
            .await;
        let third = harness
            .ask(
                "recall_3",
                Some(first.session_id.clone()),
                "zh-CN",
                "第一个问题里排第一的那位，我和他最后一次一起玩是什么时候？",
            )
            .await;
        match fading_top.filter(|name| first.answer.contains(name.as_str())) {
            Some(name) => harness.check(
                "recall_3",
                third.answer.contains(name.as_str()),
                "the third turn lost the person ranked first two turns earlier",
            ),
            None => println!("recall_3: no snapshot fading friend named in the first answer"),
        }
    }

    harness.print_metrics();
    let _ = harness.controller.endpoint_delete(&endpoint.id);
    rig.finish().await;
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
        tools: vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(&runtime, McpCaller::Assistant))
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

    for (name, arguments) in [
        ("get_activity_streaks", json!({ "utcOffsetMinutes": 540 })),
        ("get_activity_timeline", json!({ "utcOffsetMinutes": 540 })),
        ("get_fading_friends", json!({})),
        ("get_favorites", json!({})),
        ("get_friend_circles", json!({})),
        (
            "get_invite_history",
            json!({ "timeWindow": window, "limit": 25 }),
        ),
        ("get_social_graph", json!({})),
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
