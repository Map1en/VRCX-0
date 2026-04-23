#![allow(non_snake_case)]

pub mod calendar;
pub mod clipboard;
pub mod game;
pub mod ipc_commands;
pub mod media;
pub mod moderation;
pub mod paths;
pub mod registry;
pub mod screenshots;
pub mod shell;
pub mod updates;
pub mod window;

#[allow(unused_imports)]
pub use calendar::*;
#[allow(unused_imports)]
pub use clipboard::*;
#[allow(unused_imports)]
pub use game::*;
#[allow(unused_imports)]
pub use ipc_commands::*;
#[allow(unused_imports)]
pub use media::*;
#[allow(unused_imports)]
pub use moderation::*;
#[allow(unused_imports)]
pub use paths::*;
#[allow(unused_imports)]
pub use registry::*;
#[allow(unused_imports)]
pub use screenshots::*;
#[allow(unused_imports)]
pub use shell::*;
#[allow(unused_imports)]
pub use updates::*;
#[allow(unused_imports)]
pub use window::*;
