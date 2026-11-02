use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::OpenFlags;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use vrcx_0_application_core::RuntimeEventSink;
use vrcx_0_assistant::{
    AssistantController, LlmEndpointDetectModelsInput, LlmEndpointUpsertInput, PlaybookMode,
};
use vrcx_0_composition::{RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState};
use vrcx_0_mcp::McpCaller;
use vrcx_0_platform::app_paths::{resolve_app_data_dir, AppDataDirResolution, AppDataDirSource};

use crate::state::{assistant_controller_deps_for, mcp_runtime_for};

const DEFAULT_BASE_URL: &str = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL: &str = "deepseek-ai/DeepSeek-V3";
const TURN_TIMEOUT: Duration = Duration::from_secs(240);
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
}

struct ScratchDir(PathBuf);

impl ScratchDir {
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
struct TurnLog {
    session_id: String,
    tool_calls: Vec<String>,
    failed_tools: Vec<String>,
    choices: usize,
    answer: String,
    error: Option<String>,
}

impl TurnLog {
    fn print(&self, node: &str, question: &str) {
        println!("\n=== {node} ===\nQ: {question}");
        println!("tools: {:?}", self.tool_calls);
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
}

impl Harness {
    async fn ask(&mut self, node: &str, session_id: Option<String>, question: &str) -> TurnLog {
        let sent = self
            .controller
            .send_message(session_id, question.to_string(), Some("zh-CN".into()))
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
                "assistantToolCall" => log
                    .tool_calls
                    .push(payload["name"].as_str().unwrap_or_default().to_string()),
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
        log.print(node, question);
        self.check(node, log.error.is_none(), "turn ended with an error");
        self.check(node, !log.answer.trim().is_empty(), "answer is empty");
        log
    }

    fn check(&mut self, node: &str, passed: bool, problem: &str) {
        if !passed {
            self.failures.push(format!("{node}: {problem}"));
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

async fn find_ambiguous_fragment(runtime: &RuntimeHostState, database: &Path) -> Option<String> {
    let tools = vrcx_0_mcp::spawn_in_process_tools(mcp_runtime_for(runtime, McpCaller::Assistant))
        .await
        .expect("spawn probe tools");
    for fragment in name_fragments(database).into_iter().take(60) {
        let arguments = Map::from_iter([("user".to_string(), json!(fragment))]);
        let Ok(outcome) = tools.call_tool("get_companions_of", Some(arguments)).await else {
            continue;
        };
        let structured = outcome.structured.unwrap_or_default();
        if structured["candidates"]
            .as_array()
            .is_some_and(|candidates| candidates.len() >= 2)
        {
            return Some(fragment);
        }
    }
    None
}

#[tokio::test]
#[ignore = "calls a real LLM against a snapshot of the local VRCX-0 database; set VRCX0_HARNESS_LLM_API_KEY (env or .env.local)"]
async fn assistant_answers_key_questions_with_a_real_llm() {
    let env = HarnessEnv::load();
    let api_key = env
        .get("VRCX0_HARNESS_LLM_API_KEY")
        .expect("set VRCX0_HARNESS_LLM_API_KEY in the environment or .env.local");
    let base_url = env
        .get("VRCX0_HARNESS_LLM_BASE_URL")
        .unwrap_or_else(|| DEFAULT_BASE_URL.into());
    let model = env
        .get("VRCX0_HARNESS_LLM_MODEL")
        .unwrap_or_else(|| DEFAULT_MODEL.into());
    let source_dir = env
        .get("VRCX0_HARNESS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            resolve_app_data_dir()
                .expect("resolve data dir")
                .current_dir
        });

    let scratch = ScratchDir(
        std::env::temp_dir().join(format!("vrcx-0-assistant-harness-{}", std::process::id())),
    );
    let app_data = scratch.0.join("app-data");
    std::fs::create_dir_all(&app_data).unwrap();
    let database = app_data.join("VRCX-0.sqlite3");
    snapshot_database(&source_dir.join("VRCX-0.sqlite3"), &database);

    let runtime = RuntimeHostState::new(RuntimeHostOptions {
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
    .expect("start headless runtime on the snapshot");
    let assembly = runtime.desktop_assembly();
    let user_id = env.get("VRCX0_HARNESS_USER_ID").unwrap_or_else(|| {
        assembly
            .config()
            .get_string("lastUserLoggedIn", "")
            .unwrap_or_default()
    });
    assert!(
        !user_id.is_empty(),
        "no signed-in account in the database; set VRCX0_HARNESS_USER_ID"
    );
    assembly
        .auth_scope()
        .set(&user_id, "https://api.vrchat.cloud/api/1");
    let (sender, events) = unbounded_channel();
    assembly.event_bus().set_sink(ChannelSink(sender));

    let ambiguous = find_ambiguous_fragment(&runtime, &database).await;
    let controller = AssistantController::new(assistant_controller_deps_for(&runtime))
        .await
        .expect("assistant controller");
    let mut harness = Harness {
        controller,
        events,
        failures: Vec::new(),
    };

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
        .set_default_runtime(
            Some(endpoint.id.clone()),
            Some(model),
            false,
            PlaybookMode::default(),
        )
        .expect("select runtime");

    let weekly = harness
        .ask("weekly_top", None, "这周我和谁一起玩得最多？")
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
            "那这些人里，有没有最近和我变疏远的？",
        )
        .await;
    harness.check(
        "follow_up",
        !follow_up.tool_calls.is_empty(),
        "follow-up did not read any data",
    );

    let unknown = harness
        .ask("unknown_person", None, "我和 Zyxwv Qprst 关系怎么样？")
        .await;
    harness.check(
        "unknown_person",
        !unknown.answer.contains("usr_"),
        "answer exposes a user id for a person who is not in the history",
    );

    match ambiguous {
        Some(fragment) => {
            let question = format!("{fragment} 平时都和谁一起玩？");
            let picked = harness.ask("ambiguous_name", None, &question).await;
            harness.check(
                "ambiguous_name",
                picked.choices > 0,
                "an ambiguous name never reached the choice card",
            );
        }
        None => println!("\n=== ambiguous_name ===\nskipped: no ambiguous name in this history"),
    }

    let writes = harness
        .ask(
            "writes_hidden",
            None,
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

    let _ = harness.controller.endpoint_delete(&endpoint.id);
    let Harness {
        controller,
        failures,
        ..
    } = harness;
    drop(controller);
    runtime.stop_runtime_tasks();
    drop(runtime);
    scratch.remove_when_released().await;
    assert!(
        failures.is_empty(),
        "harness failures:\n{}",
        failures.join("\n")
    );
}
