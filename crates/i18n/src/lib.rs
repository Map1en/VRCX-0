mod catalog;
mod locale;

#[cfg(test)]
mod tests;

pub use catalog::{parse_catalog, Catalog};
pub use locale::{collapse_whitespace, interpolate, resolve_locale};
