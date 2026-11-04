use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

const OWNER_TABLES: &[&str] = &[
    "assistant_session",
    "favorite_friend",
    "favorite_group_collection",
    "gamelog_event",
    "gamelog_external",
    "gamelog_join_leave",
    "gamelog_location",
    "gamelog_portal_spawn",
    "gamelog_resource_load",
    "gamelog_video_play",
];

const OWNER_FILTER_EXCEPTIONS: &[(&str, &str)] = &[
    // Suspected gap: assistant session UI/runtime/pin updates are keyed by session id only, while load and delete are owner scoped.
    ("src/assistant.rs", "update assistant_session set entity_panel_open"),
    ("src/assistant.rs", "update assistant_session set endpoint_id"),
    ("src/assistant.rs", "update assistant_session set pinned"),
    // Storage size panel counts the machine-wide game log tables.
    ("src/database/maintenance.rs", "select count(*) from {table_name}"),
    // Maintenance repairs walk the whole machine game log and write back by row id.
    ("src/database/maintenance.rs", "from gamelog_join_leave where type = 'onplayerleft' and location = 'traveling'"),
    ("src/database/maintenance.rs", "select location from gamelog_join_leave where type = 'onplayerjoined' and display_name = @display_name"),
    ("src/database/maintenance.rs", "update gamelog_join_leave set location = @location where id = @row_id"),
    ("src/database/maintenance.rs", "select location, time from gamelog_location"),
    ("src/database/maintenance.rs", "select location, time, id from gamelog_join_leave"),
    ("src/database/maintenance.rs", "update gamelog_join_leave set time = 0 where id = @id"),
    ("src/database/maintenance.rs", "from gamelog_join_leave where display_name like"),
    ("src/database/maintenance.rs", "update gamelog_join_leave set display_name = @new_display_name"),
    ("src/database/maintenance.rs", "update gamelog_location set group_name = groupname"),
    ("src/database/maintenance/copresence_repair.rs", "from gamelog_join_leave where type = 'onplayerleft' and time = 0"),
    ("src/database/maintenance/copresence_repair.rs", "select created_at from gamelog_join_leave where type = 'onplayerjoined'"),
    ("src/database/maintenance/copresence_repair.rs", "update gamelog_join_leave set time = @time where id = @id"),
    // Scans every owner's leave rows and reuses each row's own owner_id for the location lookup.
    ("src/database/maintenance/leave_location_repair.rs", "select id, created_at, time, owner_id, user_id, display_name from gamelog_join_leave"),
    ("src/database/maintenance/leave_location_repair.rs", "update gamelog_join_leave set location = @location where id = @id"),
    // Duplicate probe before building a unique index that already includes owner_id.
    ("src/database/schema.rs", "select 1 from {table} where {non_null_columns}"),
    // Claims shared pre-upgrade rows (owner_id = 0) for the only local account.
    ("src/game_log/legacy_ownership.rs", "update {table} set owner_id = @owner_id where owner_id = 0"),
    // Machine replay cursor: the latest location row from any owner.
    ("src/game_log/query.rs", "fn last_location_sql: sea-query from(gamelog_location)"),
    // (created_at, video_url) is the machine-global unique key of a video play row.
    ("src/game_log/write.rs", "update gamelog_video_play set video_name = @video_name"),
    // World id to world name is a global fact, not account history.
    ("src/realtime/query.rs", "select world_name from gamelog_location where world_id = @world_id"),
];

const SEA_QUERY_TABLE_METHODS: &[&str] = &[
    "from",
    "from_table",
    "join",
    "inner_join",
    "left_join",
    "right_join",
    "full_outer_join",
];

const KEY_ONLY_SQL_BUILDERS: &[&str] =
    &["update_by_key_sql", "delete_by_key_sql", "delete_all_sql"];

struct Literal {
    start: usize,
    text: String,
}

struct SourceFile {
    path: String,
    code: String,
    literals: Vec<Literal>,
    functions: Vec<(usize, usize)>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Violation {
    file: String,
    statement: String,
}

impl SourceFile {
    fn enclosing_function(&self, position: usize) -> Option<(usize, usize)> {
        self.functions
            .iter()
            .copied()
            .filter(|(start, end)| *start <= position && position < *end)
            .max_by_key(|(start, _)| *start)
    }
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn collect_rust_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("read {}: {error}", dir.display()))
        .map(|entry| entry.expect("directory entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "tests") {
                continue;
            }
            collect_rust_files(&path, files);
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.ends_with(".rs")
            || name == "tests.rs"
            || name == "test_support.rs"
            || name.ends_with("_tests.rs")
        {
            continue;
        }
        files.push(path);
    }
}

fn is_ident_byte(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn decode_literal(raw: &str, escaped: bool) -> String {
    if !escaped {
        return raw.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match chars.next() {
            Some('\n') | Some('\r') => {
                while chars.peek().is_some_and(|next| next.is_whitespace()) {
                    chars.next();
                }
            }
            Some('n') | Some('t') | Some('r') => out.push(' '),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

fn lex(source: &str) -> (Vec<u8>, Vec<Literal>) {
    let bytes = source.as_bytes();
    let mut code = bytes.to_vec();
    let mut literals = Vec::new();
    let mut index = 0;
    let blank = |code: &mut Vec<u8>, from: usize, to: usize| {
        for byte in &mut code[from..to] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    };
    while index < bytes.len() {
        let byte = bytes[index];
        let prev_is_ident = index > 0 && is_ident_byte(bytes[index - 1]);
        if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            let end = source[index..]
                .find('\n')
                .map_or(bytes.len(), |offset| index + offset);
            blank(&mut code, index, end);
            index = end;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            let mut depth = 0;
            let mut cursor = index;
            while cursor < bytes.len() {
                if bytes[cursor] == b'/' && bytes.get(cursor + 1) == Some(&b'*') {
                    depth += 1;
                    cursor += 2;
                } else if bytes[cursor] == b'*' && bytes.get(cursor + 1) == Some(&b'/') {
                    depth -= 1;
                    cursor += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    cursor += 1;
                }
            }
            blank(&mut code, index, cursor);
            index = cursor;
            continue;
        }
        let raw_prefix = if prev_is_ident {
            None
        } else if byte == b'r' {
            Some(index + 1)
        } else if byte == b'b' && bytes.get(index + 1) == Some(&b'r') {
            Some(index + 2)
        } else {
            None
        };
        if let Some(hash_start) = raw_prefix {
            let mut cursor = hash_start;
            while bytes.get(cursor) == Some(&b'#') {
                cursor += 1;
            }
            if bytes.get(cursor) == Some(&b'"') {
                let hashes = cursor - hash_start;
                let terminator = format!("\"{}", "#".repeat(hashes));
                let content_start = cursor + 1;
                let content_end = source[content_start..]
                    .find(&terminator)
                    .map_or(bytes.len(), |offset| content_start + offset);
                literals.push(Literal {
                    start: index,
                    text: decode_literal(&source[content_start..content_end], false),
                });
                let end = (content_end + terminator.len()).min(bytes.len());
                blank(&mut code, index, end);
                index = end;
                continue;
            }
        }
        if byte == b'"' || (byte == b'b' && !prev_is_ident && bytes.get(index + 1) == Some(&b'"')) {
            let quote = if byte == b'"' { index } else { index + 1 };
            let mut cursor = quote + 1;
            while cursor < bytes.len() && bytes[cursor] != b'"' {
                cursor += if bytes[cursor] == b'\\' { 2 } else { 1 };
            }
            let content_end = cursor.min(bytes.len());
            literals.push(Literal {
                start: index,
                text: decode_literal(&source[quote + 1..content_end], true),
            });
            let end = (content_end + 1).min(bytes.len());
            blank(&mut code, index, end);
            index = end;
            continue;
        }
        if byte == b'\'' {
            if bytes.get(index + 1) == Some(&b'\\') {
                let end = source[index + 2..]
                    .find('\'')
                    .map_or(bytes.len(), |offset| index + 2 + offset + 1);
                blank(&mut code, index, end);
                index = end;
                continue;
            }
            if let Some(character) = source[index + 1..].chars().next() {
                let after = index + 1 + character.len_utf8();
                if bytes.get(after) == Some(&b'\'') {
                    blank(&mut code, index, after + 1);
                    index = after + 1;
                    continue;
                }
            }
        }
        index += 1;
    }
    (code, literals)
}

fn matching_brace(code: &[u8], open: usize) -> usize {
    let mut depth = 0usize;
    for (offset, byte) in code[open..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return open + offset + 1;
                }
            }
            _ => {}
        }
    }
    code.len()
}

fn item_end(code: &[u8], from: usize) -> usize {
    for (offset, byte) in code[from..].iter().enumerate() {
        match byte {
            b';' => return from + offset + 1,
            b'{' => return matching_brace(code, from + offset),
            _ => {}
        }
    }
    code.len()
}

fn keyword_positions<'a>(code: &'a str, keyword: &'a str) -> impl Iterator<Item = usize> + 'a {
    let bytes = code.as_bytes();
    code.match_indices(keyword).filter_map(move |(index, _)| {
        let before = index == 0 || !is_ident_byte(bytes[index - 1]);
        let after = bytes
            .get(index + keyword.len())
            .is_none_or(|byte| !is_ident_byte(*byte));
        (before && after).then_some(index)
    })
}

fn test_only_ranges(code: &str) -> Vec<(usize, usize)> {
    code.match_indices("#[cfg(test)]")
        .map(|(index, marker)| {
            let start = index + marker.len();
            (index, item_end(code.as_bytes(), start))
        })
        .collect()
}

fn function_ranges(code: &str) -> Vec<(usize, usize)> {
    let bytes = code.as_bytes();
    keyword_positions(code, "fn")
        .filter_map(|index| {
            let rest = &bytes[index..];
            let open = rest
                .iter()
                .position(|byte| *byte == b'{' || *byte == b';')?;
            (rest[open] == b'{').then(|| (index, matching_brace(bytes, index + open)))
        })
        .collect()
}

fn parse_source(path: &Path) -> SourceFile {
    let source =
        fs::read_to_string(path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let (code, literals) = lex(&source);
    let code = String::from_utf8(code).expect("masked source stays utf-8");
    let excluded = test_only_ranges(&code);
    let outside = |position: usize| {
        !excluded
            .iter()
            .any(|(start, end)| *start <= position && position < *end)
    };
    let relative = path
        .strip_prefix(Path::new(env!("CARGO_MANIFEST_DIR")))
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    SourceFile {
        path: relative,
        literals: literals
            .into_iter()
            .filter(|literal| outside(literal.start))
            .collect(),
        functions: function_ranges(&code)
            .into_iter()
            .filter(|(start, _)| outside(*start))
            .collect(),
        code,
    }
}

fn load_sources() -> Vec<SourceFile> {
    let mut paths = Vec::new();
    collect_rust_files(&src_dir(), &mut paths);
    paths.iter().map(|path| parse_source(path)).collect()
}

fn literal_at(source: &SourceFile, position: usize) -> Option<&Literal> {
    source
        .literals
        .iter()
        .find(|literal| literal.start >= position)
        .filter(|literal| source.code[position..literal.start].trim().is_empty())
}

fn read_identifier(text: &str) -> &str {
    let end = text
        .bytes()
        .position(|byte| !is_ident_byte(byte))
        .unwrap_or(text.len());
    &text[..end]
}

fn string_consts(sources: &[SourceFile]) -> BTreeMap<String, BTreeSet<String>> {
    let mut aliases: Vec<(String, String)> = Vec::new();
    let mut consts: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for source in sources {
        for index in keyword_positions(&source.code, "const") {
            let rest = source.code[index + "const".len()..].trim_start();
            let name = read_identifier(rest);
            if name.is_empty() {
                continue;
            }
            let after_name = rest[name.len()..].trim_start();
            let Some(type_and_value) = after_name.strip_prefix(':') else {
                continue;
            };
            let Some(equals) = type_and_value.find('=') else {
                continue;
            };
            let declared_type: String = type_and_value[..equals]
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect();
            if declared_type != "&str" && declared_type != "&'staticstr" {
                continue;
            }
            let value_offset = source.code.len() - type_and_value[equals + 1..].len();
            if let Some(literal) = literal_at(source, value_offset) {
                consts
                    .entry(name.to_string())
                    .or_default()
                    .insert(literal.text.clone());
            } else if let Some(end) = source.code[value_offset..].find(';') {
                let path = source.code[value_offset..value_offset + end].trim();
                let target = path.rsplit("::").next().unwrap_or(path).trim();
                aliases.push((name.to_string(), target.to_string()));
            }
        }
    }
    for (name, target) in aliases {
        if let Some(values) = consts.get(&target).cloned() {
            consts.entry(name).or_default().extend(values);
        }
    }
    consts
}

fn resolve_const<'a>(
    consts: &'a BTreeMap<String, BTreeSet<String>>,
    name: &str,
) -> Option<&'a str> {
    let values = consts.get(name)?;
    (values.len() == 1).then(|| values.iter().next().map(String::as_str))?
}

fn expand_placeholders(text: &str, consts: &BTreeMap<String, BTreeSet<String>>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let name = read_identifier(after);
        if !name.is_empty() && after[name.len()..].starts_with('}') {
            if let Some(value) = resolve_const(consts, name) {
                out.push_str(value);
            } else {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
            rest = &after[name.len() + 1..];
        } else {
            out.push('{');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn normalize_sql(text: &str, consts: &BTreeMap<String, BTreeSet<String>>) -> String {
    expand_placeholders(text, consts)
        .chars()
        .filter(|character| !matches!(character, '`' | '"' | '\\'))
        .collect::<String>()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_owner_clause(sql: &str) -> bool {
    ["owner_id in (", "owner_id = @", "owner_id=@"]
        .iter()
        .any(|marker| {
            sql.match_indices(marker).any(|(index, _)| {
                let before = &sql[..index];
                keyword_positions(before, "where").next().is_some()
                    || keyword_positions(before, "on").next().is_some()
                    || keyword_positions(before, "and").next().is_some()
            })
        })
}

enum TableRef {
    Owner,
    Dynamic(String),
}

fn table_refs(sql: &str) -> Vec<TableRef> {
    let mut refs = Vec::new();
    for keyword in ["from", "join", "update"] {
        for index in keyword_positions(sql, keyword) {
            let rest = sql[index + keyword.len()..].trim_start();
            if let Some(placeholder) = rest.strip_prefix('{') {
                let name = read_identifier(placeholder);
                let after = placeholder.get(name.len() + 1..).unwrap_or("");
                if !name.is_empty()
                    && placeholder[name.len()..].starts_with('}')
                    && !after.bytes().next().is_some_and(is_ident_byte)
                {
                    refs.push(TableRef::Dynamic(name.to_string()));
                }
                continue;
            }
            if OWNER_TABLES.contains(&read_identifier(rest)) {
                refs.push(TableRef::Owner);
            }
        }
    }
    refs
}

fn is_owner_fragment(sql: &str) -> bool {
    table_refs(sql).is_empty()
        && ["owner_id in (", "owner_id = @", "owner_id=@"]
            .iter()
            .any(|marker| sql.contains(marker))
}

fn function_name(source: &SourceFile, (start, _): (usize, usize)) -> &str {
    read_identifier(source.code[start + "fn".len()..].trim_start())
}

fn calls(body: &str, name: &str) -> bool {
    let bytes = body.as_bytes();
    keyword_positions(body, name).any(|index| {
        let before_dot = body[..index].trim_end().ends_with('.');
        let after = body[index + name.len()..].trim_start();
        !before_dot
            && after.starts_with('(')
            && !body[..index].trim_end().ends_with("fn")
            && (index == 0 || bytes[index - 1] != b':')
    })
}

struct FileAnalysis {
    owner_table_functions: BTreeSet<(usize, usize)>,
    owner_fragment_helpers: Vec<String>,
}

fn analyze_file(source: &SourceFile, consts: &BTreeMap<String, BTreeSet<String>>) -> FileAnalysis {
    let owner_consts: Vec<&str> = consts
        .keys()
        .filter(|name| {
            resolve_const(consts, name).is_some_and(|value| OWNER_TABLES.contains(&value))
        })
        .map(String::as_str)
        .collect();
    let literals_in = |(start, end): (usize, usize)| {
        source
            .literals
            .iter()
            .filter(move |literal| start <= literal.start && literal.start < end)
    };
    let own_code = |function: (usize, usize)| -> String {
        let mut body = source.code.as_bytes()[function.0..function.1].to_vec();
        for other in &source.functions {
            if *other != function && function.0 < other.0 && other.1 <= function.1 {
                for byte in &mut body[other.0 - function.0..other.1 - function.0] {
                    *byte = b' ';
                }
            }
        }
        String::from_utf8(body).expect("masked source stays utf-8")
    };
    let providers: BTreeSet<(usize, usize)> = source
        .functions
        .iter()
        .copied()
        .filter(|function| {
            literals_in(*function).any(|literal| OWNER_TABLES.contains(&literal.text.as_str()))
                || owner_consts.iter().any(|name| {
                    keyword_positions(&own_code(*function), name)
                        .next()
                        .is_some()
                })
        })
        .collect();
    let names: BTreeMap<(usize, usize), &str> = source
        .functions
        .iter()
        .map(|function| (*function, function_name(source, *function)))
        .collect();
    let mut candidates: BTreeSet<(usize, usize)> = providers.clone();
    for function in &source.functions {
        let body = own_code(*function);
        if providers
            .iter()
            .any(|provider| calls(&body, names[provider]))
        {
            candidates.insert(*function);
        }
    }
    loop {
        let before = candidates.len();
        let current: Vec<(usize, usize)> = candidates.iter().copied().collect();
        for caller in current {
            let body = own_code(caller);
            for function in &source.functions {
                if calls(&body, names[function]) {
                    candidates.insert(*function);
                }
            }
        }
        if candidates.len() == before {
            break;
        }
    }
    let owner_fragment_helpers = source
        .functions
        .iter()
        .filter(|function| {
            literals_in(**function)
                .any(|literal| is_owner_fragment(&normalize_sql(&literal.text, consts)))
        })
        .map(|function| names[function].to_string())
        .collect();
    FileAnalysis {
        owner_table_functions: candidates,
        owner_fragment_helpers,
    }
}

fn bound_by_table_name_query(body_before: &str, variable: &str) -> bool {
    let pattern = format!("for {variable} in ");
    body_before.rfind(&pattern).is_some_and(|index| {
        let iterable = &body_before[index + pattern.len()..];
        let end = iterable.find('{').unwrap_or(iterable.len());
        iterable[..end].contains("select_table_names(")
    })
}

fn composed_statement_is_scoped(
    source: &SourceFile,
    analysis: &FileAnalysis,
    literal: &Literal,
    sql: &str,
    consts: &BTreeMap<String, BTreeSet<String>>,
) -> bool {
    if !sql.contains('{') {
        return false;
    }
    if sql.contains("owner_scope}") {
        return true;
    }
    let Some((start, end)) = source.enclosing_function(literal.start) else {
        return false;
    };
    let body = &source.code[start..end];
    analysis
        .owner_fragment_helpers
        .iter()
        .any(|helper| calls(body, helper))
        || source
            .literals
            .iter()
            .filter(|other| start <= other.start && other.start < end)
            .any(|other| is_owner_fragment(&normalize_sql(&other.text, consts)))
}

fn statement_snippet(sql: &str) -> String {
    const MAX: usize = 140;
    if sql.chars().count() <= MAX {
        return sql.to_string();
    }
    let cut: String = sql.chars().take(MAX).collect();
    format!("{cut}…")
}

fn literal_violations(
    source: &SourceFile,
    consts: &BTreeMap<String, BTreeSet<String>>,
    violations: &mut BTreeSet<Violation>,
) {
    let analysis = analyze_file(source, consts);
    for literal in &source.literals {
        let sql = normalize_sql(&literal.text, consts);
        let function = source.enclosing_function(literal.start);
        let needs_scope = table_refs(&sql).iter().any(|table_ref| match table_ref {
            TableRef::Owner => true,
            TableRef::Dynamic(variable) => function.is_some_and(|function| {
                analysis.owner_table_functions.contains(&function)
                    && !bound_by_table_name_query(&source.code[function.0..literal.start], variable)
            }),
        });
        if !needs_scope
            || has_owner_clause(&sql)
            || composed_statement_is_scoped(source, &analysis, literal, &sql, consts)
        {
            continue;
        }
        violations.insert(Violation {
            file: source.path.clone(),
            statement: sql,
        });
    }
}

fn sea_query_target(source: &SourceFile, after_paren: usize) -> Option<&str> {
    if let Some(literal) = literal_at(source, after_paren) {
        return Some(literal.text.as_str());
    }
    let name = read_identifier(source.code[after_paren..].trim_start());
    (!name.is_empty()).then_some(name)
}

fn resolve_table<'a>(
    target: &'a str,
    consts: &'a BTreeMap<String, BTreeSet<String>>,
) -> Option<&'a str> {
    if OWNER_TABLES.contains(&target) {
        return Some(target);
    }
    resolve_const(consts, target).filter(|value| OWNER_TABLES.contains(value))
}

fn function_has_owner_marker(
    source: &SourceFile,
    (start, end): (usize, usize),
    consts: &BTreeMap<String, BTreeSet<String>>,
) -> bool {
    let body = &source.code[start..end];
    body.contains("owner_scope_expr(")
        || keyword_positions(body, "COL_OWNER_ID").next().is_some()
        || source
            .literals
            .iter()
            .filter(|literal| start <= literal.start && literal.start < end)
            .any(|literal| has_owner_clause(&normalize_sql(&literal.text, consts)))
}

fn sea_query_violations(
    source: &SourceFile,
    consts: &BTreeMap<String, BTreeSet<String>>,
    violations: &mut BTreeSet<Violation>,
) {
    for function in &source.functions {
        let (start, end) = *function;
        let body = &source.code[start..end];
        let is_update = body.contains("Query::update()");
        let mut refs = Vec::new();
        for (offset, _) in body.match_indices("ident(") {
            let absolute = start + offset;
            if source.enclosing_function(absolute) != Some(*function) {
                continue;
            }
            let before = &source.code[start..absolute];
            let Some(dot) = before.rfind('.') else {
                continue;
            };
            let method = read_identifier(&before[dot + 1..]);
            let allowed =
                SEA_QUERY_TABLE_METHODS.contains(&method) || (method == "table" && is_update);
            if !allowed || before[dot + 1 + method.len()..].contains(')') {
                continue;
            }
            let Some(target) = sea_query_target(source, absolute + "ident(".len()) else {
                continue;
            };
            if let Some(table) = resolve_table(target, consts) {
                refs.push(format!("sea-query {method}({table})"));
            }
        }
        if !refs.is_empty() && !function_has_owner_marker(source, *function, consts) {
            let name = read_identifier(source.code[start + "fn".len()..].trim_start());
            for reference in refs {
                violations.insert(Violation {
                    file: source.path.clone(),
                    statement: format!("fn {name}: {reference}"),
                });
            }
        }
    }
    for builder in KEY_ONLY_SQL_BUILDERS {
        for index in keyword_positions(&source.code, builder) {
            let rest = &source.code[index + builder.len()..];
            let Some(args) = rest.trim_start().strip_prefix('(') else {
                continue;
            };
            let args_start = source.code.len() - args.len();
            if let Some(table) = sea_query_target(source, args_start)
                .and_then(|target| resolve_table(target, consts))
            {
                violations.insert(Violation {
                    file: source.path.clone(),
                    statement: format!("{builder}({table})"),
                });
            }
        }
    }
}

fn owner_scope_violations() -> BTreeSet<Violation> {
    let sources = load_sources();
    let consts = string_consts(&sources);
    let mut violations = BTreeSet::new();
    for source in &sources {
        literal_violations(source, &consts, &mut violations);
        sea_query_violations(source, &consts, &mut violations);
    }
    violations
}

fn exception_matches(exception: &(&str, &str), violation: &Violation) -> bool {
    let fragment = exception
        .1
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    violation.file == exception.0 && violation.statement.contains(&fragment)
}

fn top_level_args(code: &str, open: usize) -> Vec<(usize, usize)> {
    let mut args = Vec::new();
    let mut depth = 0usize;
    let mut arg_start = open + 1;
    for (offset, byte) in code.as_bytes()[open..].iter().enumerate() {
        let position = open + offset;
        match byte {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth -= 1;
                if depth == 0 {
                    args.push((arg_start, position));
                    return args;
                }
            }
            b',' if depth == 1 => {
                args.push((arg_start, position));
                arg_start = position + 1;
            }
            _ => {}
        }
    }
    args
}

fn schema_owner_tables(
    sources: &[SourceFile],
    consts: &BTreeMap<String, BTreeSet<String>>,
) -> BTreeSet<String> {
    let mut tables = BTreeSet::new();
    for source in sources {
        for literal in &source.literals {
            let sql = normalize_sql(&literal.text, consts);
            let Some(rest) = sql.strip_prefix("create table if not exists ") else {
                continue;
            };
            if sql.contains(" owner_id integer") || sql.contains("(owner_id integer") {
                tables.insert(read_identifier(rest).to_string());
            }
        }
        for index in keyword_positions(&source.code, "add_column_if_missing") {
            let Some(open) = source.code[index..].find('(').map(|offset| index + offset) else {
                continue;
            };
            let args = top_level_args(&source.code, open);
            let (Some(table_arg), Some(column_arg)) = (args.get(1), args.get(2)) else {
                continue;
            };
            if source.code[column_arg.0..column_arg.1].trim() != "COL_OWNER_ID" {
                continue;
            }
            if let Some(literal) =
                literal_at(source, table_arg.0).filter(|literal| literal.start < table_arg.1)
            {
                tables.insert(literal.text.clone());
            }
        }
        for (start, end) in &source.functions {
            let body = &source.code[*start..*end];
            if !body.contains("Table::create()") || !body.contains("owner_column()") {
                continue;
            }
            for (offset, _) in body.match_indices(".table(ident(") {
                let target_start = start + offset + ".table(ident(".len();
                if let Some(table) = sea_query_target(source, target_start)
                    .and_then(|target| resolve_const(consts, target))
                {
                    tables.insert(table.to_string());
                }
            }
        }
    }
    tables
}

#[test]
fn owner_scoped_table_list_matches_schema() {
    let sources = load_sources();
    let consts = string_consts(&sources);
    let expected: BTreeSet<String> = OWNER_TABLES.iter().map(|table| table.to_string()).collect();
    assert_eq!(
        schema_owner_tables(&sources, &consts),
        expected,
        "tables with an INTEGER owner_id column must match OWNER_TABLES in this audit"
    );
}

#[test]
fn owner_scoped_queries_filter_by_owner_id() {
    let missing: Vec<String> = owner_scope_violations()
        .into_iter()
        .filter(|violation| {
            !OWNER_FILTER_EXCEPTIONS
                .iter()
                .any(|exception| exception_matches(exception, violation))
        })
        .map(|violation| {
            format!(
                "{}: {} — add owner scope or list it in OWNER_FILTER_EXCEPTIONS",
                violation.file,
                statement_snippet(&violation.statement)
            )
        })
        .collect();
    assert!(
        missing.is_empty(),
        "{} owner-table statement(s) lack an owner_id filter:\n{}",
        missing.len(),
        missing.join("\n")
    );
}

#[test]
fn owner_scoped_exceptions_still_lack_owner_scope() {
    let violations = owner_scope_violations();
    let stale: Vec<String> = OWNER_FILTER_EXCEPTIONS
        .iter()
        .filter(|exception| {
            !violations
                .iter()
                .any(|violation| exception_matches(exception, violation))
        })
        .map(|(file, fragment)| {
            format!("{file}: {fragment} — no longer lacks owner scope; remove it from OWNER_FILTER_EXCEPTIONS")
        })
        .collect();
    assert!(
        stale.is_empty(),
        "{} OWNER_FILTER_EXCEPTIONS entr(ies) are stale:\n{}",
        stale.len(),
        stale.join("\n")
    );
}
