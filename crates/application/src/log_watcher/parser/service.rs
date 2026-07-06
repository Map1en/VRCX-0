use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use chrono::{Local, NaiveDateTime};
use vrcx_0_core::log_watcher::{clean_location, parse_log_line_header};

use super::super::context::LogContext;
use super::super::event::GameLogEventKind;
use super::super::queue::append_event;
use super::super::watcher::Inner;

#[path = "media.rs"]
mod media;
#[path = "presence.rs"]
mod presence;
#[path = "scanner.rs"]
mod scanner;
#[path = "system.rs"]
mod system;

pub(in crate::log_watcher) use scanner::parse_log;

#[cfg(test)]
#[path = "../../../tests/log_watcher/parser/service_tests.rs"]
mod tests;
