use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MANIFEST_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCatalogManifest {
    version: u32,
    fallback_locale: String,
    domains: BTreeMap<String, DomainManifest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DomainManifest {
    locales: LocaleSelection,
    coverage: Coverage,
    messages: Vec<MessageManifest>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LocaleSelection {
    Named(String),
    Explicit(Vec<String>),
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Coverage {
    Required,
    Fallback,
}

#[derive(Deserialize)]
struct MessageManifest {
    key: String,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogOutput {
    version: u32,
    fallback_locale: String,
    locales: BTreeMap<String, BTreeMap<String, String>>,
}

struct GeneratedMessage {
    key: String,
    variant: String,
    constructor: String,
    placeholders: Vec<String>,
}

struct GeneratedDomain {
    key_type: &'static str,
    messages: Vec<GeneratedMessage>,
}

fn main() {
    if let Err(error) = generate() {
        panic!("native locale generation failed: {error}");
    }
}

fn generate() -> Result<(), String> {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(display_error)?);
    let repo_dir = crate_dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "i18n crate must be inside the workspace crates directory".to_string())?;
    let localization_dir = repo_dir.join("src/localization");
    let manifest_path = crate_dir.join("native-catalog.json");
    let language_codes_path = localization_dir.join("languageCodes.json");

    rerun_if_changed(&manifest_path);
    rerun_if_changed(&language_codes_path);

    let manifest = read_json::<NativeCatalogManifest>(&manifest_path)?;
    if manifest.version != MANIFEST_VERSION {
        return Err(format!(
            "{} uses version {}, expected {MANIFEST_VERSION}",
            manifest_path.display(),
            manifest.version
        ));
    }

    let language_codes = read_json::<Vec<String>>(&language_codes_path)?;
    validate_language_codes(&language_codes, &manifest.fallback_locale)?;
    let locale_sources = read_locale_sources(&localization_dir, &language_codes)?;
    let mut catalog_locales = language_codes
        .iter()
        .map(|locale| (locale.clone(), BTreeMap::new()))
        .collect::<BTreeMap<_, _>>();
    let mut generated_domains = Vec::new();
    let mut catalog_keys = BTreeSet::new();

    for (domain_name, key_type) in [
        ("overlay", "OverlayMessageKey"),
        ("discordPresence", "DiscordPresenceKey"),
        ("shell", "ShellKey"),
    ] {
        let domain = manifest
            .domains
            .get(domain_name)
            .ok_or_else(|| format!("native catalog manifest is missing domain {domain_name}"))?;
        let locales = selected_locales(&domain.locales, &language_codes)?;
        if !locales.contains(&manifest.fallback_locale) {
            return Err(format!(
                "native catalog domain {domain_name} must include fallback locale {}",
                manifest.fallback_locale
            ));
        }
        let mut generated_messages = Vec::new();
        let mut variants = BTreeSet::new();
        let mut constructors = BTreeSet::new();

        for message in &domain.messages {
            if !catalog_keys.insert(message.key.clone()) {
                return Err(format!("duplicate native catalog key {}", message.key));
            }
            let fallback_source = locale_sources
                .get(&manifest.fallback_locale)
                .ok_or_else(|| format!("missing fallback locale {}", manifest.fallback_locale))?;
            let fallback_text =
                required_source_text(fallback_source, &manifest.fallback_locale, message)?;
            let placeholders = placeholders(fallback_text);
            let expected_placeholders = placeholders.iter().cloned().collect::<BTreeSet<_>>();

            for locale in &locales {
                let source = locale_sources
                    .get(locale)
                    .ok_or_else(|| format!("missing locale source {locale}"))?;
                match source_text(source, &message.source) {
                    Some(text) if !text.trim().is_empty() => {
                        validate_text(locale, message, text, &expected_placeholders)?;
                        catalog_locales
                            .get_mut(locale)
                            .expect("validated catalog locale")
                            .insert(message.key.clone(), text.to_string());
                    }
                    _ if domain.coverage == Coverage::Fallback
                        && locale != &manifest.fallback_locale => {}
                    _ => {
                        return Err(format!(
                            "locale {locale} is missing required source {} for {}",
                            message.source, message.key
                        ));
                    }
                }
            }

            let variant = pascal_identifier(&message.key);
            validate_rust_identifier(&variant, &format!("key variant for {}", message.key))?;
            if !variants.insert(variant.clone()) {
                return Err(format!(
                    "domain {domain_name} has a generated key variant collision at {variant}"
                ));
            }
            let constructor = snake_identifier(&message.key);
            validate_rust_identifier(
                &constructor,
                &format!("message constructor for {}", message.key),
            )?;
            if !constructors.insert(constructor.clone()) {
                return Err(format!(
                    "domain {domain_name} has a generated constructor collision at {constructor}"
                ));
            }
            let mut argument_identifiers = BTreeSet::new();
            for placeholder in &placeholders {
                let identifier = snake_identifier(placeholder);
                validate_rust_identifier(
                    &identifier,
                    &format!("placeholder {placeholder} for {}", message.key),
                )?;
                if !argument_identifiers.insert(identifier.clone()) {
                    return Err(format!(
                        "{} has a generated placeholder identifier collision at {identifier}",
                        message.key
                    ));
                }
            }
            generated_messages.push(GeneratedMessage {
                key: message.key.clone(),
                variant,
                constructor,
                placeholders,
            });
        }

        generated_domains.push(GeneratedDomain {
            key_type,
            messages: generated_messages,
        });
    }

    let unexpected_domains = manifest
        .domains
        .keys()
        .filter(|name| !matches!(name.as_str(), "overlay" | "discordPresence" | "shell"))
        .cloned()
        .collect::<Vec<_>>();
    if !unexpected_domains.is_empty() {
        return Err(format!(
            "native catalog manifest has unsupported domains: {}",
            unexpected_domains.join(", ")
        ));
    }

    let output = CatalogOutput {
        version: MANIFEST_VERSION,
        fallback_locale: manifest.fallback_locale,
        locales: catalog_locales,
    };
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(display_error)?);
    fs::write(
        out_dir.join("native_catalog.json"),
        format!(
            "{}\n",
            serde_json::to_string(&output).map_err(display_error)?
        ),
    )
    .map_err(display_error)?;
    fs::write(
        out_dir.join("native_keys.rs"),
        generate_rust(&generated_domains),
    )
    .map_err(display_error)?;
    Ok(())
}

fn validate_language_codes(locales: &[String], fallback_locale: &str) -> Result<(), String> {
    if locales.is_empty() {
        return Err("languageCodes.json must not be empty".to_string());
    }
    if has_duplicates(locales) {
        return Err("languageCodes.json contains duplicate locales".to_string());
    }
    if !locales.iter().any(|locale| locale == fallback_locale) {
        return Err(format!(
            "languageCodes.json does not contain fallback locale {fallback_locale}"
        ));
    }
    Ok(())
}

fn read_locale_sources(
    localization_dir: &Path,
    language_codes: &[String],
) -> Result<BTreeMap<String, Value>, String> {
    let mut sources = BTreeMap::new();
    for locale in language_codes {
        let path = localization_dir.join(format!("{locale}.json"));
        rerun_if_changed(&path);
        sources.insert(locale.clone(), read_json(&path)?);
    }
    Ok(sources)
}

fn selected_locales(
    selection: &LocaleSelection,
    language_codes: &[String],
) -> Result<Vec<String>, String> {
    let locales = match selection {
        LocaleSelection::Named(name) if name == "all" => language_codes.to_vec(),
        LocaleSelection::Named(name) => {
            return Err(format!("unsupported locale selection {name}"));
        }
        LocaleSelection::Explicit(locales) => locales.clone(),
    };
    if has_duplicates(&locales) {
        return Err("native catalog domain contains duplicate locales".to_string());
    }
    for locale in &locales {
        if !language_codes.iter().any(|candidate| candidate == locale) {
            return Err(format!(
                "native catalog domain references unsupported locale {locale}"
            ));
        }
    }
    Ok(locales)
}

fn has_duplicates(values: &[String]) -> bool {
    values.iter().collect::<BTreeSet<_>>().len() != values.len()
}

fn required_source_text<'a>(
    source: &'a Value,
    locale: &str,
    message: &MessageManifest,
) -> Result<&'a str, String> {
    let text = source_text(source, &message.source).ok_or_else(|| {
        format!(
            "fallback locale {locale} is missing source {} for {}",
            message.source, message.key
        )
    })?;
    if text.trim().is_empty() {
        return Err(format!(
            "fallback locale {locale} has empty source {} for {}",
            message.source, message.key
        ));
    }
    Ok(text)
}

fn validate_text(
    locale: &str,
    message: &MessageManifest,
    text: &str,
    expected_placeholders: &BTreeSet<String>,
) -> Result<(), String> {
    if text.trim() == message.key {
        return Err(format!(
            "locale {locale} uses raw key {} as localized text",
            message.key
        ));
    }
    let actual = placeholders(text).into_iter().collect::<BTreeSet<_>>();
    if &actual != expected_placeholders {
        return Err(format!(
            "locale {locale} placeholder mismatch for {}: expected {:?}, got {:?}",
            message.key, expected_placeholders, actual
        ));
    }
    Ok(())
}

fn source_text<'a>(source: &'a Value, path: &str) -> Option<&'a str> {
    path.split('.')
        .try_fold(source, |value, key| value.get(key))?
        .as_str()
}

fn placeholders(value: &str) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    let mut output = Vec::new();
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '{' {
            index += 1;
            continue;
        }
        let mut end = index + 1;
        while end < chars.len() && chars[end] != '}' {
            end += 1;
        }
        if end == chars.len() {
            break;
        }
        let name = chars[index + 1..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !name.is_empty() && seen.insert(name.clone()) {
            output.push(name);
        }
        index = end + 1;
    }
    output
}

fn generate_rust(domains: &[GeneratedDomain]) -> String {
    let mut output = String::new();
    for domain in domains {
        output.push_str(
            "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type)]\n",
        );
        output.push_str(&format!("pub enum {} {{\n", domain.key_type));
        for message in &domain.messages {
            output.push_str(&format!(
                "    #[serde(rename = {})]\n    {},\n",
                rust_string(&message.key),
                message.variant
            ));
        }
        output.push_str("}\n\n");
        output.push_str(&format!(
            "impl crate::sealed::Sealed for {} {{}}\n\n",
            domain.key_type
        ));
        output.push_str(&format!(
            "impl crate::CatalogKey for {} {{\n    fn as_str(self) -> &'static str {{\n        match self {{\n",
            domain.key_type
        ));
        for message in &domain.messages {
            output.push_str(&format!(
                "            Self::{} => {},\n",
                message.variant,
                rust_string(&message.key)
            ));
        }
        output.push_str("        }\n    }\n}\n\n");
        output.push_str(&format!("impl {} {{\n", domain.key_type));
        output.push_str("    pub const ALL: &'static [Self] = &[\n");
        for message in &domain.messages {
            output.push_str(&format!("        Self::{},\n", message.variant));
        }
        output.push_str("    ];\n}\n\n");
    }

    let overlay = domains
        .iter()
        .find(|domain| domain.key_type == "OverlayMessageKey")
        .expect("overlay generated domain");
    output.push_str("impl crate::OverlayMessage {\n");
    for message in &overlay.messages {
        let arguments = message
            .placeholders
            .iter()
            .map(|placeholder| format!("{}: impl ToString", snake_identifier(placeholder)))
            .collect::<Vec<_>>()
            .join(", ");
        let params = message
            .placeholders
            .iter()
            .map(|placeholder| {
                format!(
                    "({}, {}.to_string())",
                    rust_string(placeholder),
                    snake_identifier(placeholder)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        output.push_str(&format!(
            "    pub fn {}({}) -> Self {{\n        Self::new(crate::OverlayMessageKey::{}, [{}])\n    }}\n",
            message.constructor, arguments, message.variant, params
        ));
    }
    output.push_str("}\n");
    output
}

fn identifier_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut previous_is_lower_or_digit = false;
    for character in value.chars() {
        if !character.is_ascii_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            previous_is_lower_or_digit = false;
            continue;
        }
        if character.is_ascii_uppercase() && previous_is_lower_or_digit && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        previous_is_lower_or_digit = character.is_ascii_lowercase() || character.is_ascii_digit();
        current.push(character.to_ascii_lowercase());
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn pascal_identifier(value: &str) -> String {
    identifier_words(value)
        .into_iter()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn snake_identifier(value: &str) -> String {
    identifier_words(value).join("_")
}

fn validate_rust_identifier(identifier: &str, label: &str) -> Result<(), String> {
    let mut characters = identifier.chars();
    let valid_start = characters
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic());
    let valid_rest =
        characters.all(|character| character == '_' || character.is_ascii_alphanumeric());
    let reserved = matches!(
        identifier,
        "Self"
            | "abstract"
            | "as"
            | "async"
            | "await"
            | "become"
            | "box"
            | "break"
            | "const"
            | "continue"
            | "crate"
            | "do"
            | "dyn"
            | "else"
            | "enum"
            | "extern"
            | "false"
            | "final"
            | "fn"
            | "for"
            | "gen"
            | "if"
            | "impl"
            | "in"
            | "let"
            | "loop"
            | "macro"
            | "match"
            | "mod"
            | "move"
            | "mut"
            | "override"
            | "priv"
            | "pub"
            | "ref"
            | "return"
            | "self"
            | "static"
            | "struct"
            | "super"
            | "trait"
            | "true"
            | "try"
            | "type"
            | "typeof"
            | "union"
            | "unsafe"
            | "unsized"
            | "use"
            | "virtual"
            | "where"
            | "while"
            | "yield"
    );
    if !valid_start || !valid_rest || reserved {
        return Err(format!(
            "{label} generates invalid Rust identifier {identifier}"
        ));
    }
    Ok(())
}

fn rust_string(value: &str) -> String {
    serde_json::to_string(value).expect("string serialization")
}

fn read_json<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let source = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&source)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn rerun_if_changed(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
