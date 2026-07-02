//! Lightweight intent routing: a matched query narrows the visible tool set and
//! injects a focused constraint, steering a weak model onto one aggregate tool
//! instead of free-planning across the whole toolset. A keyword fast-path runs
//! first; on a miss, a stateless side-channel LLM call matches the intent
//! semantically in any language. Unmatched queries fall through to the normal
//! agent loop.

use vrcx_0_integrations::llm::{ChatMessage, LlmClient, ToolDefinition};

#[derive(Clone, Copy)]
pub(crate) struct Playbook {
    tool_whitelist: &'static [&'static str],
    constraint_prompt: &'static str,
}

impl Playbook {
    pub(crate) fn constraint_prompt(&self) -> &'static str {
        self.constraint_prompt
    }

    pub(crate) fn filter_tools(&self, tools: &[ToolDefinition]) -> Vec<ToolDefinition> {
        tools
            .iter()
            .filter(|tool| self.tool_whitelist.contains(&tool.name.as_str()))
            .cloned()
            .collect()
    }
}

/// Tools kept out of a weak model's fallback toolset when no playbook matched:
/// the raw mutual-friend graph (an answer-shaped tool supersedes it for the
/// common question and weak models drown in its nodes+edges) and the
/// graph-refresh action (infrastructure, not a question to answer). Strong
/// models in open mode are never narrowed and keep these.
const WEAK_FALLBACK_DENYLIST: &[&str] = &["get_social_graph", "refresh_mutual_graph"];

/// Drop the advanced/non-answer tools above from the full toolset. Used only on
/// a classify miss while a playbook mode is active; open mode keeps everything.
pub(crate) fn weak_fallback_tools(tools: &[ToolDefinition]) -> Vec<ToolDefinition> {
    tools
        .iter()
        .filter(|tool| !WEAK_FALLBACK_DENYLIST.contains(&tool.name.as_str()))
        .cloned()
        .collect()
}

struct Intent {
    label: &'static str,
    description: &'static str,
    keywords: &'static [&'static str],
    playbook: Playbook,
}

const FRIEND_CIRCLES: Playbook = Playbook {
    tool_whitelist: &["get_friend_circles"],
    constraint_prompt: "The user is asking which of their friends know each other (friend \
groups / circles). Call get_friend_circles exactly once; it returns ready-made \
mutual-friendship circles with a summary. Narrate from that summary and the circle rows — \
do NOT attempt graph reasoning yourself. Circles reflect who is friends with whom (mutual \
connections), which is not the same as who plays together.",
};

const CO_PRESENCE: Playbook = Playbook {
    tool_whitelist: &["get_copresence_summary"],
    constraint_prompt: "The user wants to know who they play with or spend the most time with. \
Call get_copresence_summary once; it returns people ranked by time spent together, computed \
from the local game log (reliable even for private instances you attended). It defaults to \
current friends and is already ranked — read the top rows, do NOT loop or re-rank. For an \
all-time / 'ever' question OMIT timeWindow entirely; only pass a window if the user named a \
period. This measures time played together, which is not the same as who is friends with whom.",
};

const BEST_TIME: Playbook = Playbook {
    tool_whitelist: &["get_best_time_to_play"],
    constraint_prompt: "The user wants the best time to log on to find the most friends online. \
Call get_best_time_to_play once; it returns hour-of-day or weekday buckets ranked by how many \
distinct friends come online. Pass utcOffsetMinutes (e.g. 540 for UTC+9) so buckets are in the \
user's local time. Narrate the peak buckets from the summary; do NOT tally the raw log \
yourself. This is about the whole friend list, not one named person.",
};

const ACTIVITY_PATTERN: Playbook = Playbook {
    tool_whitelist: &["get_friend_activity_pattern"],
    constraint_prompt: "The user wants to know when a specific friend is usually online. Call \
get_friend_activity_pattern once with that friend (a display name is accepted directly). It \
buckets their online/offline log by hour-of-day or weekday. Pass utcOffsetMinutes for \
local-time buckets. Narrate the busiest buckets from the summary. This describes one person's \
pattern, not the best time to catch the most people.",
};

const ONLINE_FRIENDS: Playbook = Playbook {
    tool_whitelist: &["get_online_friends"],
    constraint_prompt: "The user wants to know who is online right now or who they can join. \
Call get_online_friends once; it lists friends currently online with their location and \
instance access, from live session memory (realtime, not history). Narrate the summary and \
rows. Private instances may be redacted by VRChat privacy rules — say so if the list looks \
incomplete; never guess hidden locations.",
};

const ACTIVITY_TIMELINE: Playbook = Playbook {
    tool_whitelist: &["get_activity_timeline"],
    constraint_prompt: "The user wants to know how their own playtime is distributed over time \
(which months, weeks, or days they played most, or their trend). Call get_activity_timeline \
once; it buckets the user's own play history by year/month/week/day-of-week/hour-of-day with a \
ready summary. Pass utcOffsetMinutes for local buckets; OMIT timeWindow for all history. \
Narrate the peak buckets from the summary; do NOT add up sessions yourself.",
};

const SOCIAL_RECAP: Playbook = Playbook {
    tool_whitelist: &["summarize_social_period"],
    constraint_prompt: "The user wants an overall recap of their recent social activity (their \
week, month, or a period). Call summarize_social_period once; it composes several analyses — \
your activity, top companions, new and fading friends, top worlds, best times — into one \
bundle to narrate. Read the whole bundle and summarize it; do NOT separately call the \
individual tools it already includes.",
};

const INTENTS: &[Intent] = &[
    Intent {
        label: "circles",
        description: "which of the user's own friends know each other; friend groups or \
mutual-friendship clusters (who is friends with whom, not who plays together)",
        keywords: &[
            "friend group",
            "friend circle",
            "know each other",
            "knows who",
        ],
        playbook: FRIEND_CIRCLES,
    },
    Intent {
        label: "copresence",
        description: "who the user plays with or spends the most time together with \
(co-presence ranking); not who is friends with whom",
        keywords: &[
            "play with most",
            "play with the most",
            "spend the most time",
            "who do i play with",
        ],
        playbook: CO_PRESENCE,
    },
    Intent {
        label: "best_time",
        description: "the best time of day or week to log on to find the most friends online, \
across the whole friend list",
        keywords: &[
            "best time to play",
            "when can i find",
            "when should i log",
            "when are the most",
        ],
        playbook: BEST_TIME,
    },
    Intent {
        label: "activity_pattern",
        description: "when one specific named friend is usually online (that single person's \
activity pattern)",
        keywords: &["usually online", "usually on at", "what time is"],
        playbook: ACTIVITY_PATTERN,
    },
    Intent {
        label: "online_friends",
        description: "who is online right now / who the user can join at this moment (realtime \
presence)",
        keywords: &[
            "who is online",
            "who's online",
            "online right now",
            "online now",
            "who can i join",
        ],
        playbook: ONLINE_FRIENDS,
    },
    Intent {
        label: "activity_timeline",
        description: "how the user's own playtime is distributed over time — which months, \
weeks, or days they played most, or their personal play trend",
        keywords: &[
            "which month",
            "which week",
            "most active month",
            "play trend",
            "when did i play",
        ],
        playbook: ACTIVITY_TIMELINE,
    },
    Intent {
        label: "social_recap",
        description: "an overall recap or summary of the user's recent social activity over a \
period (their week or month)",
        keywords: &[
            "recap my",
            "summarize my week",
            "summarize my month",
            "how was my week",
            "how was my month",
        ],
        playbook: SOCIAL_RECAP,
    },
];

pub(crate) fn classify_keyword(user_text: &str) -> Option<Playbook> {
    let text = user_text.to_lowercase();
    INTENTS
        .iter()
        .find(|intent| intent.keywords.iter().any(|keyword| text.contains(keyword)))
        .map(|intent| intent.playbook)
}

/// One non-streaming LLM call over an independent message list to match the
/// intent semantically in any language. It never enters the main conversation
/// history and emits no events; any error or no-match returns None so the caller
/// falls back to the full toolset.
pub(crate) async fn classify_llm(client: &LlmClient, user_text: &str) -> Option<Playbook> {
    let messages = vec![
        ChatMessage::system(classify_prompt()),
        ChatMessage::system("/no_think"),
        ChatMessage::user(user_text.to_string()),
    ];
    let turn = match client.stream_chat(&messages, &[], |_| {}).await {
        Ok(turn) => turn,
        Err(error) => {
            tracing::warn!(%error, "assistant: intent classify call failed");
            return None;
        }
    };
    matched_intent(&turn.content).map(|intent| intent.playbook)
}

fn classify_prompt() -> String {
    let mut prompt = String::from(
        "Classify a VRChat social assistant user's question into one intent. The question may \
be in any language. Reply with EXACTLY ONE label from the list below, or `none` if none fit. \
Output only the label.\n\nIntents:\n",
    );
    for intent in INTENTS {
        prompt.push_str("- ");
        prompt.push_str(intent.label);
        prompt.push_str(": ");
        prompt.push_str(intent.description);
        prompt.push('\n');
    }
    prompt
}

fn matched_intent(output: &str) -> Option<&'static Intent> {
    let lowered = output.to_lowercase();
    let trimmed = lowered.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_');
    INTENTS
        .iter()
        .find(|intent| intent.label == trimmed)
        .or_else(|| {
            INTENTS
                .iter()
                .filter(|intent| lowered.contains(intent.label))
                .min_by_key(|intent| lowered.find(intent.label).unwrap_or(usize::MAX))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: String::new(),
            parameters: serde_json::Value::Null,
        }
    }

    #[test]
    fn keyword_matches_circle_phrasings() {
        assert!(classify_keyword("which of my friends know each other?").is_some());
        assert!(classify_keyword("show me my friend groups").is_some());
    }

    #[test]
    fn keyword_ignores_other_questions() {
        assert!(classify_keyword("what is the weather like").is_none());
        assert!(classify_keyword("who knows where alice went").is_none());
        assert!(classify_keyword("我的好友圈").is_none());
    }

    #[test]
    fn matched_intent_parses_label_leniently() {
        assert_eq!(
            matched_intent("circles").map(|intent| intent.label),
            Some("circles")
        );
        assert_eq!(
            matched_intent("The intent is circles.").map(|intent| intent.label),
            Some("circles")
        );
        assert!(matched_intent("none").is_none());
        assert!(matched_intent("teleport").is_none());
    }

    #[test]
    fn keywords_do_not_collide_across_intents() {
        for (index, left) in INTENTS.iter().enumerate() {
            for right in &INTENTS[index + 1..] {
                for left_keyword in left.keywords {
                    for right_keyword in right.keywords {
                        assert!(
                            !left_keyword.contains(right_keyword)
                                && !right_keyword.contains(left_keyword),
                            "keyword collision between `{}` and `{}`: `{left_keyword}` vs `{right_keyword}` \
(classify_keyword would silently resolve to whichever intent is listed first)",
                            left.label,
                            right.label,
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn weak_fallback_drops_advanced_keeps_leaf_and_analyze() {
        let tools = vec![
            tool("get_social_graph"),
            tool("refresh_mutual_graph"),
            tool("get_friend_circles"),
            tool("find_user"),
            tool("get_copresence_summary"),
        ];
        let names: Vec<String> = weak_fallback_tools(&tools)
            .into_iter()
            .map(|definition| definition.name)
            .collect();
        assert!(!names.contains(&"get_social_graph".to_string()));
        assert!(!names.contains(&"refresh_mutual_graph".to_string()));
        assert!(names.contains(&"get_friend_circles".to_string()));
        assert!(names.contains(&"find_user".to_string()));
        assert!(names.contains(&"get_copresence_summary".to_string()));
    }

    #[test]
    fn keyword_matches_new_intents() {
        assert!(classify_keyword("who do i play with the most").is_some());
        assert!(classify_keyword("best time to play tonight").is_some());
        assert!(classify_keyword("who is online now").is_some());
        assert!(classify_keyword("which month did i play most").is_some());
        assert!(classify_keyword("recap my week").is_some());
    }

    #[test]
    fn matched_intent_resolves_each_label() {
        for label in [
            "circles",
            "copresence",
            "best_time",
            "activity_pattern",
            "online_friends",
            "activity_timeline",
            "social_recap",
        ] {
            assert_eq!(
                matched_intent(label).map(|intent| intent.label),
                Some(label)
            );
        }
    }

    #[test]
    fn whitelist_keeps_only_circles() {
        let tools = vec![tool("get_friend_circles"), tool("get_social_graph")];
        let filtered = classify_keyword("which of my friends know each other")
            .unwrap()
            .filter_tools(&tools);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, "get_friend_circles");
    }
}
