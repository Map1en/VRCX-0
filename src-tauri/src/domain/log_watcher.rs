use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use chrono::{Local, NaiveDateTime, Utc};
use tauri::{AppHandle, Emitter};

pub struct LogWatcher {
    inner: Arc<Inner>,
}

struct Inner {
    log_list: RwLock<Vec<Vec<String>>>,
    till_date: Mutex<Option<NaiveDateTime>>,
    active: Mutex<bool>,
    reset_flag: Mutex<bool>,
    vrc_closed_gracefully: Mutex<bool>,
}

impl LogWatcher {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                log_list: RwLock::new(Vec::new()),
                till_date: Mutex::new(None),
                active: Mutex::new(false),
                reset_flag: Mutex::new(false),
                vrc_closed_gracefully: Mutex::new(false),
            }),
        }
    }

    pub fn start(&self, log_dir: PathBuf, app_handle: AppHandle) {
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || thread_loop(inner, log_dir, app_handle));
    }

    pub fn set_date_till(&self, date: &str) {
        if let Ok(dt) = date.parse::<chrono::DateTime<Utc>>() {
            *self.inner.till_date.lock().unwrap() = Some(dt.naive_utc());
        } else if let Ok(dt) = NaiveDateTime::parse_from_str(date, "%Y-%m-%dT%H:%M:%S%.fZ") {
            *self.inner.till_date.lock().unwrap() = Some(dt);
        }
        *self.inner.active.lock().unwrap() = true;
    }

    pub fn reset(&self) {
        *self.inner.reset_flag.lock().unwrap() = true;
    }

    pub fn get(&self) -> Vec<Vec<String>> {
        let mut list = self.inner.log_list.write().unwrap();
        if list.is_empty() {
            return Vec::new();
        }
        let n = list.len().min(1000);
        let items: Vec<Vec<String>> = list.drain(..n).collect();
        items
    }

    pub fn vrc_closed_gracefully(&self) -> bool {
        *self.inner.vrc_closed_gracefully.lock().unwrap()
    }
}

fn thread_loop(inner: Arc<Inner>, log_dir: PathBuf, app_handle: AppHandle) {
    let mut contexts: HashMap<String, LogContext> = HashMap::new();
    let mut first_run = true;

    loop {
        let active = *inner.active.lock().unwrap();

        {
            let mut reset = inner.reset_flag.lock().unwrap();
            if *reset {
                first_run = true;
                *reset = false;
                contexts.clear();
                inner.log_list.write().unwrap().clear();
            }
        }

        if active {
            update(&inner, &log_dir, &app_handle, &mut contexts, &mut first_run);
        }

        std::thread::sleep(Duration::from_secs(1));
    }
}

fn update(
    inner: &Inner,
    log_dir: &Path,
    app_handle: &AppHandle,
    contexts: &mut HashMap<String, LogContext>,
    first_run: &mut bool,
) {
    let till_date_utc = inner
        .till_date
        .lock()
        .unwrap()
        .unwrap_or(chrono::DateTime::UNIX_EPOCH.naive_utc());

    let till_date = chrono::TimeZone::from_utc_datetime(&Local, &till_date_utc).naive_local();

    let mut deleted: HashSet<String> = contexts.keys().cloned().collect();

    if !log_dir.exists() {
        *first_run = false;
        return;
    }

    let mut entries: Vec<_> = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("output_log_")
                && e.file_name().to_string_lossy().ends_with(".txt")
        })
        .collect();

    entries.sort_by_key(|e| e.metadata().and_then(|m| m.created()).ok());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if let Ok(last_write) = meta.modified() {
            let lwt: chrono::DateTime<Local> = last_write.into();
            if lwt.naive_local() < till_date {
                continue;
            }
        }

        deleted.remove(&name);

        let ctx = contexts.entry(name.clone()).or_insert_with(LogContext::new);

        if ctx.length == meta.len() {
            continue;
        }
        ctx.length = meta.len();

        parse_log(
            inner,
            app_handle,
            &entry.path(),
            &name,
            ctx,
            till_date,
            *first_run,
        );
    }

    for name in deleted {
        contexts.remove(&name);
    }

    *first_run = false;
}

fn parse_log(
    inner: &Inner,
    app_handle: &AppHandle,
    path: &Path,
    file_name: &str,
    ctx: &mut LogContext,
    till_date: NaiveDateTime,
    first_run: bool,
) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut reader = BufReader::with_capacity(65536, file);
    if reader.seek(SeekFrom::Start(ctx.position)).is_err() {
        return;
    }

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Err(_) => break,
            _ => {}
        }

        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        if parse_udon_exception(inner, app_handle, file_name, trimmed, first_run) {
            continue;
        }

        if trimmed.len() <= 36 {
            continue;
        }
        if trimmed.as_bytes().get(31) != Some(&b'-') {
            continue;
        }

        let date_str = &trimmed[..19];
        let line_date = match NaiveDateTime::parse_from_str(date_str, "%Y.%m.%d %H:%M:%S") {
            Ok(d) => d,
            Err(_) => continue,
        };

        if line_date <= till_date {
            continue;
        }

        let now_local = Local::now().naive_local();
        if line_date > now_local + chrono::Duration::minutes(61) {
            continue;
        }

        let offset = 34;
        let content = &trimmed[offset..];

        if content.starts_with('[') {
            let _ = parse_player_joined_or_left(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_location(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_location_destination(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_portal_spawn(inner, app_handle, file_name, trimmed, first_run)
                || parse_notification(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_api_request(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avatar_change(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_join_blocked(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avatar_pedestal_change(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_video_error(
                    inner, app_handle, file_name, trimmed, content, ctx, first_run,
                )
                || parse_video_change(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avpro_video_change(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_usharp_video_play(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_usharp_video_sync(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_world_vrcx(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_audio_config(
                    inner, app_handle, file_name, trimmed, content, ctx, first_run,
                )
                || parse_screenshot(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_string_download(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_image_download(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_failed_to_join(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_instance_reset(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick_init(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick_success(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_sticker_spawn(inner, app_handle, file_name, trimmed, content, first_run);
        } else {
            let _ = parse_shader_keywords_limit(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_sdk2_video_play(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_application_quit(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_openvr_init(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_desktop_mode(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_osc_failed(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_untrusted_url(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            );
        }
    }

    ctx.position = reader.stream_position().unwrap_or(ctx.position);
}

fn convert_log_time_to_iso8601(line: &str) -> String {
    match NaiveDateTime::parse_from_str(&line[..19], "%Y.%m.%d %H:%M:%S") {
        Ok(local_dt) => {
            let local_aware = chrono::TimeZone::from_local_datetime(&Local, &local_dt);
            match local_aware.single() {
                Some(dt) => dt
                    .with_timezone(&Utc)
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
                None => format!("{}", local_dt.format("%Y-%m-%dT%H:%M:%S%.3fZ")),
            }
        }
        Err(_) => Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
    }
}

fn append_log(inner: &Inner, app_handle: &AppHandle, item: Vec<String>, first_run: bool) {
    if !first_run {
        if let Ok(json) = serde_json::to_string(&item) {
            let _ = app_handle.emit("addGameLogEvent", json);
        }
    }
    inner.log_list.write().unwrap().push(item);
}

fn parse_user_info(s: &str) -> (String, String) {
    if let Some(pos) = s.rfind(" (") {
        let display_name = s[..pos].to_string();
        let end = s.rfind(')').unwrap_or(s.len());
        let user_id: String = s[pos + 2..end]
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | ':' | '(' | ')'))
            .collect();
        (display_name, user_id)
    } else {
        (s.to_string(), String::new())
    }
}

fn clean_location(s: &str) -> String {
    s.replace('/', "")
}

fn parse_location(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] Entering Room: ") {
        if let Some(pos) = line.rfind("] Entering Room: ") {
            ctx.recent_world_name = line[pos + 17..].to_string();
        }
        return true;
    }

    if content.contains("[Behaviour] Joining ")
        && !content.contains("] Joining or Creating Room: ")
        && !content.contains("] Joining friend: ")
    {
        if let Some(pos) = line.rfind("] Joining ") {
            let location = clean_location(&line[pos + 10..]);
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "location".into(),
                    location,
                    ctx.recent_world_name.clone(),
                ],
                first_run,
            );
            ctx.last_audio_device.clear();
            ctx.video_errors.clear();
            *inner.vrc_closed_gracefully.lock().unwrap() = false;
        }
        return true;
    }

    false
}

fn parse_location_destination(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] OnLeftRoom") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "location-destination".into(),
                ctx.location_destination.clone(),
            ],
            first_run,
        );
        ctx.location_destination.clear();
        return true;
    }

    if content.contains("[Behaviour] Destination fetching: ") {
        if let Some(pos) = line.rfind("] Destination fetching: ") {
            ctx.location_destination = clean_location(&line[pos + 24..]);
        }
        return true;
    }

    false
}

fn parse_player_joined_or_left(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] OnPlayerJoined") && !content.contains("] OnPlayerJoined:") {
        if let Some(pos) = line.rfind("] OnPlayerJoined") {
            let user_info = &line[pos + 17..];
            let (display_name, user_id) = parse_user_info(user_info);
            if !display_name.is_empty() || !user_id.is_empty() {
                append_log(
                    inner,
                    app,
                    vec![
                        fname.into(),
                        convert_log_time_to_iso8601(line),
                        "player-joined".into(),
                        display_name,
                        user_id,
                    ],
                    first_run,
                );
            }
        }
        return true;
    }

    if content.contains("[Behaviour] OnPlayerLeft")
        && !content.contains("] OnPlayerLeftRoom")
        && !content.contains("] OnPlayerLeft:")
    {
        if let Some(pos) = line.rfind("] OnPlayerLeft") {
            let user_info = &line[pos + 15..];
            let (display_name, user_id) = parse_user_info(user_info);
            if !display_name.is_empty() || !user_id.is_empty() {
                append_log(
                    inner,
                    app,
                    vec![
                        fname.into(),
                        convert_log_time_to_iso8601(line),
                        "player-left".into(),
                        display_name,
                        user_id,
                    ],
                    first_run,
                );
            }
        }
        return true;
    }

    false
}

fn parse_portal_spawn(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    first_run: bool,
) -> bool {
    if line.contains("[Behaviour] Instantiated a (Clone [")
        && line.contains("] Portals/PortalInternalDynamic)")
    {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "portal-spawn".into(),
            ],
            first_run,
        );
        return true;
    }
    false
}

fn parse_notification(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[API] Received Notification: <") {
        return false;
    }
    if let Some(pos) = line.rfind("> received at ") {
        if let Some(start) = line.find("[API] Received Notification: <") {
            let data = &line[start + 30..pos];
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "notification".into(),
                    data.into(),
                ],
                first_run,
            );
        }
    }
    true
}

fn parse_api_request(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[API] [") {
        return false;
    }
    if let Some(pos) = line.rfind("] Sending Get request to ") {
        let data = &line[pos + 25..];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "api-request".into(),
                data.into(),
            ],
            first_run,
        );
        return true;
    }
    false
}

fn parse_avatar_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[Behaviour] Switching ") {
        return false;
    }
    if let Some(pos) = line.rfind(" to avatar ") {
        if let Some(start) = line.rfind("[Behaviour] Switching ") {
            let display_name = &line[start + 22..pos];
            let avatar_name = &line[pos + 11..];
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "avatar-change".into(),
                    display_name.into(),
                    avatar_name.into(),
                ],
                first_run,
            );
        }
    }
    true
}

fn parse_join_blocked(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("] Master is not sending any events! Moving to a new instance.") {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            "Joining instance blocked by master".into(),
        ],
        first_run,
    );
    true
}

fn parse_avatar_pedestal_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            format!("{data} changed avatar pedestal"),
        ],
        first_run,
    );
    true
}

fn parse_video_error(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    const YT_BOT_ERROR: &str = "Sign in to confirm";
    const YT_BOT_FIX: &str = "[VRCX] Fix error with this: https://github.com/EllyVR/VRCVideoCacher";

    if content.contains("[Video Playback] ERROR: ") {
        if let Some(pos) = content.find("[Video Playback] ERROR: ") {
            let mut data = content[pos + 24..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            if data.contains(YT_BOT_ERROR) {
                data = format!("{YT_BOT_FIX}\n{data}");
            }
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "event".into(),
                    format!("VideoError: {data}"),
                ],
                first_run,
            );
        }
        return true;
    }

    if content.contains("[AVProVideo] Error: ") {
        if let Some(pos) = content.find("[AVProVideo] Error: ") {
            let mut data = content[pos + 20..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            if data.contains(YT_BOT_ERROR) {
                data = format!("{YT_BOT_FIX}\n{data}");
            }
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "event".into(),
                    format!("VideoError: {data}"),
                ],
                first_run,
            );
        }
        return true;
    }

    false
}

fn parse_video_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Video Playback] Attempting to resolve URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "video-play".into(),
                url.into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_avpro_video_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Video Playback] Resolving URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "video-play".into(),
                url.into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_sdk2_video_play(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("User ") {
        return false;
    }
    if let Some(pos) = content.rfind(" added URL ") {
        let display_name = &content[5..pos];
        let url = &content[pos + 11..];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "video-play".into(),
                url.into(),
                display_name.into(),
            ],
            first_run,
        );
        return true;
    }
    false
}

fn parse_usharp_video_play(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[USharpVideo] Started video load for URL: ";
    if !content.starts_with(tag) {
        return false;
    }
    if let Some(pos) = content.rfind(", requested by ") {
        let url = &content[tag.len()..pos];
        let display_name = &content[pos + 15..];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "video-play".into(),
                url.into(),
                display_name.into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_usharp_video_sync(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[USharpVideo] Syncing video to ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "video-sync".into(),
            data.into(),
        ],
        first_run,
    );
    true
}

fn parse_world_vrcx(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[VRCX] ") {
        return false;
    }
    let data = &content[7..];
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "vrcx".into(),
            data.into(),
        ],
        first_run,
    );
    true
}

fn parse_screenshot(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[VRC Camera] Took screenshot to: ") {
        return false;
    }
    if let Some(pos) = line.rfind("] Took screenshot to: ") {
        let path = &line[pos + 22..];
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "screenshot".into(),
                path.into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_shader_keywords_limit(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.contains("Maximum number (384) of shader global keywords exceeded") {
        return false;
    }
    if ctx.shader_keywords_limit_reached {
        return true;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            "Shader Keyword Limit has been reached".into(),
        ],
        first_run,
    );
    ctx.shader_keywords_limit_reached = true;
    true
}

fn parse_application_quit(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    _ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.starts_with("VRCApplication: OnApplicationQuit at ")
        && !content.starts_with("VRCApplication: HandleApplicationQuit at ")
    {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "vrc-quit".into(),
        ],
        first_run,
    );
    *inner.vrc_closed_gracefully.lock().unwrap() = true;
    true
}

fn parse_openvr_init(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("Initializing VRSDK.") && !content.starts_with("STEAMVR HMD Model: ") {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "openvr-init".into(),
        ],
        first_run,
    );
    true
}

fn parse_desktop_mode(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("VR Disabled") {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "desktop-mode".into(),
        ],
        first_run,
    );
    true
}

fn parse_string_download(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "] Attempting to load String from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if url.starts_with("http://127.0.0.1:22500")
                || url.starts_with("http://localhost:22500")
            {
                return true;
            }
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "resource-load-string".into(),
                    url.into(),
                ],
                first_run,
            );
        }
    }
    true
}

fn parse_image_download(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "] Attempting to load image from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if url.starts_with("http://127.0.0.1:22500")
                || url.starts_with("http://localhost:22500")
            {
                return true;
            }
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "resource-load-image".into(),
                    url.into(),
                ],
                first_run,
            );
        }
    }
    true
}

fn parse_vote_kick(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Behaviour] Received executive message: ";
    if !content.starts_with(tag) {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            content[tag.len()..].into(),
        ],
        first_run,
    );
    true
}

fn parse_failed_to_join(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Behaviour] Failed to join instance ";
    if !content.starts_with(tag) {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            content[12..].into(),
        ],
        first_run,
    );
    true
}

fn parse_osc_failed(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("Could not Start OSC: ") {
        return false;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            format!("VRChat couldn't start OSC server, \"{content}\""),
        ],
        first_run,
    );
    true
}

fn parse_untrusted_url(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.contains("Attempted to play an untrusted URL") {
        return false;
    }
    if !ctx.video_errors.insert(content.to_string()) {
        return true;
    }
    append_log(
        inner,
        app,
        vec![
            fname.into(),
            convert_log_time_to_iso8601(line),
            "event".into(),
            format!("VideoError: {content}"),
        ],
        first_run,
    );
    true
}

fn parse_instance_reset(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] This instance will be reset in ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "event".into(),
                content[pos + 20..].into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_vote_kick_init(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] A vote kick has been initiated against ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "event".into(),
                content[pos + 20..].into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_vote_kick_success(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] Vote to kick ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "event".into(),
                content[pos + 20..].into(),
            ],
            first_run,
        );
    }
    true
}

fn parse_sticker_spawn(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[StickersManager] User ")
        || !content.contains("inv_")
        || !content.contains("spawned sticker")
    {
        return false;
    }

    if let Some(pos) = content.find("[StickersManager] User ") {
        let info = &content[pos + 23..];
        let (user_id, display_name) = parse_user_info(info);
        if display_name.is_empty() && user_id.is_empty() {
            return true;
        }
        let inv_id = if let Some(inv_pos) = info.find("inv_") {
            info[inv_pos..]
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | ':' | '(' | ')'))
                .collect::<String>()
        } else {
            String::new()
        };
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "sticker-spawn".into(),
                user_id,
                display_name,
                inv_id,
            ],
            first_run,
        );
    }
    true
}

fn parse_audio_config(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Always] uSpeak: OnAudioConfigurationChanged") {
        ctx.audio_device_changed = true;
        return true;
    }

    if content.contains("[Always] uSpeak: SetInputDevice 0") {
        if let Some(pos) = line.rfind(") '") {
            let start = pos + 3;
            let end = line.len().saturating_sub(1);
            if start >= end {
                return true;
            }
            let audio_device = &line[start..end];
            if ctx.last_audio_device.is_empty() {
                ctx.audio_device_changed = false;
                ctx.last_audio_device = audio_device.to_string();
                return true;
            }
            if !ctx.audio_device_changed || ctx.last_audio_device == audio_device {
                return true;
            }
            append_log(
                inner,
                app,
                vec![
                    fname.into(),
                    convert_log_time_to_iso8601(line),
                    "event".into(),
                    format!("Audio device changed, mic set to '{audio_device}'"),
                ],
                first_run,
            );
            ctx.last_audio_device = audio_device.to_string();
            ctx.audio_device_changed = false;
        }
        return true;
    }

    false
}

fn parse_udon_exception(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    first_run: bool,
) -> bool {
    if line.contains("[PyPyDance]") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "udon-exception".into(),
                line.into(),
            ],
            first_run,
        );
        return true;
    }
    if let Some(pos) = line.find(" ---> VRC.Udon.VM.UdonVMException: ") {
        append_log(
            inner,
            app,
            vec![
                fname.into(),
                convert_log_time_to_iso8601(line),
                "udon-exception".into(),
                line[pos..].into(),
            ],
            first_run,
        );
        return true;
    }
    false
}

struct LogContext {
    position: u64,
    length: u64,
    recent_world_name: String,
    location_destination: String,
    video_errors: HashSet<String>,
    shader_keywords_limit_reached: bool,
    last_audio_device: String,
    audio_device_changed: bool,
}

impl LogContext {
    fn new() -> Self {
        Self {
            position: 0,
            length: 0,
            recent_world_name: String::new(),
            location_destination: String::new(),
            video_errors: HashSet::with_capacity(50),
            shader_keywords_limit_reached: false,
            last_audio_device: String::new(),
            audio_device_changed: false,
        }
    }
}
