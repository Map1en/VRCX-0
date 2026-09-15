use std::collections::HashSet;

use regex::RegexBuilder;
use serde::Serialize;

const LOG_TIME_FORMAT: &str = "%Y.%m.%d %H:%M:%S";
pub const LOG_LEVELS: [&str; 3] = ["Debug", "Warning", "Error"];

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub category: Option<String>,
    pub message: String,
    pub raw: String,
    pub line_number: u32,
    pub end_line_number: u32,
    pub file_name: String,
    pub continuation_lines: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct LogQuery {
    pub text: Option<String>,
    pub case_sensitive: bool,
    pub use_regex: bool,
}

enum LogQueryMatcher {
    Substring {
        needle: String,
        case_sensitive: bool,
    },
    Regex(regex::Regex),
}

impl LogQueryMatcher {
    fn from_query(query: LogQuery) -> Result<Option<Self>, String> {
        let Some(text) = query
            .text
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            return Ok(None);
        };

        if !query.use_regex {
            return Ok(Some(Self::Substring {
                needle: if query.case_sensitive {
                    text
                } else {
                    text.to_lowercase()
                },
                case_sensitive: query.case_sensitive,
            }));
        }

        RegexBuilder::new(&text)
            .case_insensitive(!query.case_sensitive)
            .build()
            .map(|regex| Some(Self::Regex(regex)))
            .map_err(|error| error.to_string())
    }

    fn matches(&self, haystack: &str) -> bool {
        match self {
            Self::Substring {
                needle,
                case_sensitive,
            } => {
                if *case_sensitive {
                    haystack.contains(needle)
                } else {
                    haystack.to_lowercase().contains(needle)
                }
            }
            Self::Regex(regex) => regex.is_match(haystack),
        }
    }
}

pub struct LogEntryFilter {
    query: Option<LogQueryMatcher>,
    levels: Option<HashSet<String>>,
    categories: Option<HashSet<String>>,
}

impl LogEntryFilter {
    pub fn from_parts(
        query: LogQuery,
        levels: Option<Vec<String>>,
        categories: Option<Vec<String>>,
    ) -> Result<Self, String> {
        let categories = categories
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();

        Ok(Self {
            query: LogQueryMatcher::from_query(query)?,
            levels: normalize_level_set(levels),
            categories: (!categories.is_empty()).then_some(categories),
        })
    }

    pub fn matches(&self, entry: &LogEntry) -> bool {
        self.matches_level(entry) && self.matches_ignoring_level(entry)
    }

    pub fn matches_ignoring_level(&self, entry: &LogEntry) -> bool {
        if let Some(categories) = &self.categories {
            if !entry
                .category
                .as_deref()
                .is_some_and(|category| categories.contains(category))
            {
                return false;
            }
        }

        if let Some(query) = &self.query {
            let continuation_text = entry.continuation_lines.join("\n");
            let haystack = [
                entry.timestamp.as_str(),
                entry.level.as_str(),
                entry.category.as_deref().unwrap_or_default(),
                entry.message.as_str(),
                entry.raw.as_str(),
                continuation_text.as_str(),
            ]
            .join("\n");
            if !query.matches(&haystack) {
                return false;
            }
        }

        true
    }

    fn matches_level(&self, entry: &LogEntry) -> bool {
        self.levels
            .as_ref()
            .is_none_or(|levels| levels.contains(&entry.level))
    }
}

pub struct ParsedLogDocument {
    pub entries: Vec<LogEntry>,
    pub total_lines: usize,
}

pub fn parse_log_document(file_name: &str, content: &str) -> ParsedLogDocument {
    ParsedLogDocument {
        entries: parse_log_entries(file_name, content),
        total_lines: content.lines().count(),
    }
}

pub fn parse_log_entries(file_name: &str, content: &str) -> Vec<LogEntry> {
    let mut entries = Vec::new();
    let mut current: Option<LogEntry> = None;

    for (index, line) in content.lines().enumerate() {
        let line_number = u32::try_from(index).unwrap_or(u32::MAX).saturating_add(1);
        if let Some((timestamp, level, message)) = parse_log_header(line) {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(LogEntry {
                timestamp,
                level,
                category: extract_category(&message),
                message,
                raw: line.to_string(),
                line_number,
                end_line_number: line_number,
                file_name: file_name.to_string(),
                continuation_lines: Vec::new(),
            });
            continue;
        }

        if let Some(entry) = &mut current {
            entry.continuation_lines.push(line.to_string());
            entry.end_line_number = line_number;
        }
    }

    if let Some(entry) = current {
        entries.push(entry);
    }
    entries
}

pub(crate) fn parse_log_header(line: &str) -> Option<(String, String, String)> {
    let timestamp = line.get(..19)?;
    chrono::NaiveDateTime::parse_from_str(timestamp, LOG_TIME_FORMAT).ok()?;
    let rest = line.get(19..)?.trim_start();

    for level in LOG_LEVELS {
        let Some(after_level) = rest.strip_prefix(level) else {
            continue;
        };
        let message = after_level
            .trim_start()
            .strip_prefix('-')?
            .trim_start()
            .to_string();
        return Some((timestamp.to_string(), level.to_string(), message));
    }

    None
}

pub(crate) fn extract_category(message: &str) -> Option<String> {
    let trimmed = message.trim_start();
    let category = trimmed
        .strip_prefix('[')?
        .split_once(']')?
        .0
        .trim()
        .to_string();
    (!category.is_empty()).then_some(category)
}

pub(crate) fn normalize_level_set(levels: Option<Vec<String>>) -> Option<HashSet<String>> {
    let normalized = levels
        .unwrap_or_default()
        .into_iter()
        .filter_map(|level| match level.trim().to_ascii_lowercase().as_str() {
            "debug" => Some("Debug".to_string()),
            "warning" | "warn" => Some("Warning".to_string()),
            "error" => Some("Error".to_string()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entries_with_categories_and_continuations() {
        let content = "\
2026.06.21 12:00:01 Debug - [Behaviour] first line
continued detail
2026.06.21 12:00:02 Warning - no category
2026.06.21 12:00:03 Error - [Network] failed";

        let ParsedLogDocument {
            entries,
            total_lines,
        } = parse_log_document("output_log_2026-06-21.txt", content);

        assert_eq!(total_lines, 4);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].category.as_deref(), Some("Behaviour"));
        assert_eq!(entries[0].line_number, 1);
        assert_eq!(entries[0].end_line_number, 2);
        assert_eq!(entries[0].continuation_lines, vec!["continued detail"]);
        assert_eq!(entries[1].category, None);
        assert_eq!(entries[2].level, "Error");
    }

    #[test]
    fn ignores_lines_before_first_header() {
        let content = "\
orphan line
2026.06.21 12:00:01 Debug - [Behaviour] first line";

        let entries = parse_log_entries("output_log_2026-06-21.txt", content);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].line_number, 2);
        assert!(entries[0].continuation_lines.is_empty());
    }

    #[test]
    fn filter_normalizes_levels_and_searches_all_text() {
        let entries = parse_log_entries(
            "output_log_2026-06-21.txt",
            "\
2026.06.21 12:00:01 Debug - [Behaviour] first line
continued needle
2026.06.21 12:00:02 Warning - [Other] second line",
        );
        let filter = LogEntryFilter::from_parts(
            LogQuery {
                text: Some("NEEDLE".to_string()),
                ..LogQuery::default()
            },
            Some(vec!["warn".to_string(), "DEBUG".to_string()]),
            Some(vec!["Behaviour".to_string()]),
        )
        .expect("filter");

        assert!(filter.matches(&entries[0]));
        assert!(!filter.matches(&entries[1]));
    }

    #[test]
    fn filter_honours_case_sensitivity_and_regex() {
        let entries = parse_log_entries(
            "output_log_2026-06-21.txt",
            "\
2026.06.21 12:00:01 Debug - [Behaviour] Needle one
2026.06.21 12:00:02 Warning - [Other] second line",
        );

        let sensitive = LogEntryFilter::from_parts(
            LogQuery {
                text: Some("needle".to_string()),
                case_sensitive: true,
                use_regex: false,
            },
            None,
            None,
        )
        .expect("filter");
        assert!(!sensitive.matches(&entries[0]));

        let pattern = LogEntryFilter::from_parts(
            LogQuery {
                text: Some(r"needle\s+\w+".to_string()),
                case_sensitive: false,
                use_regex: true,
            },
            None,
            None,
        )
        .expect("filter");
        assert!(pattern.matches(&entries[0]));
        assert!(!pattern.matches(&entries[1]));

        assert!(LogEntryFilter::from_parts(
            LogQuery {
                text: Some("[unclosed".to_string()),
                case_sensitive: false,
                use_regex: true,
            },
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn filter_counts_levels_independently() {
        let entries = parse_log_entries(
            "output_log_2026-06-21.txt",
            "\
2026.06.21 12:00:01 Debug - [Behaviour] needle one
2026.06.21 12:00:02 Error - [Behaviour] needle two
2026.06.21 12:00:03 Error - [Other] third",
        );
        let filter = LogEntryFilter::from_parts(
            LogQuery {
                text: Some("needle".to_string()),
                ..LogQuery::default()
            },
            Some(vec!["Debug".to_string()]),
            None,
        )
        .expect("filter");

        let ignoring_level = entries
            .iter()
            .filter(|entry| filter.matches_ignoring_level(entry))
            .count();

        assert_eq!(ignoring_level, 2);
        assert_eq!(
            entries.iter().filter(|entry| filter.matches(entry)).count(),
            1
        );
    }

    #[test]
    fn rejects_malformed_headers() {
        assert!(parse_log_header("2026.06.21 12:00:01 Info - message").is_none());
        assert!(parse_log_header("2026.06.21 12:00:01 Debug message").is_none());
        assert!(parse_log_header("not a timestamp Debug - message").is_none());
    }
}
