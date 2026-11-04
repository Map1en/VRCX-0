import type {
    ScreenshotShareEmbed,
    ScreenshotShareEmbedField,
    ScreenshotShareFacts,
    ScreenshotShareFields,
    ScreenshotShareMessage
} from '@/platform/tauri/bindings';

export const SCREENSHOT_SHARE_MAX_PEOPLE = 20;

export type ScreenshotShareText = {
    playerCount: string;
    people: string;
    stay: string;
    stayValue(ms: number, ongoing: boolean): string;
    morePeople(count: number): string;
};

function groupConsecutiveByWorld(
    facts: ScreenshotShareFacts[]
): ScreenshotShareFacts[][] {
    const sorted = [...facts].sort(
        (left, right) => left.capturedAtMs - right.capturedAtMs
    );
    const groups: ScreenshotShareFacts[][] = [];
    for (const fact of sorted) {
        const current = groups.at(-1);
        if (current && current[0].worldId === fact.worldId) {
            current.push(fact);
        } else {
            groups.push([fact]);
        }
    }
    return groups;
}

function peopleValue(
    group: ScreenshotShareFacts[],
    text: ScreenshotShareText
): string {
    const names = [...new Set(group.flatMap((fact) => fact.people))];
    if (names.length <= SCREENSHOT_SHARE_MAX_PEOPLE) {
        return names.join(', ');
    }
    return `${names.slice(0, SCREENSHOT_SHARE_MAX_PEOPLE).join(', ')} ${text.morePeople(
        names.length - SCREENSHOT_SHARE_MAX_PEOPLE
    )}`;
}

function embedFields(
    group: ScreenshotShareFacts[],
    fields: ScreenshotShareFields,
    text: ScreenshotShareText
): ScreenshotShareEmbedField[] {
    const result: ScreenshotShareEmbedField[] = [];
    const counts = group
        .map((fact) => fact.playerCount)
        .filter((count): count is number => count !== null);
    if (fields.playerCount && counts.length) {
        result.push({
            name: text.playerCount,
            value: String(Math.max(...counts)),
            inline: true
        });
    }
    const stay = group.find((fact) => fact.stay)?.stay;
    if (fields.stay && stay) {
        result.push({
            name: text.stay,
            value: text.stayValue(stay.ms, stay.ongoing),
            inline: true
        });
    }
    const people = fields.people ? peopleValue(group, text) : '';
    if (people) {
        result.push({ name: text.people, value: people, inline: false });
    }
    return result;
}

function buildMessage(
    group: ScreenshotShareFacts[],
    fields: ScreenshotShareFields,
    text: ScreenshotShareText
): ScreenshotShareMessage {
    const first = group[0];
    const worldName = fields.world ? first.worldName : null;
    const capturedAtMs = fields.time ? first.capturedAtMs : 0;
    const extraFields = embedFields(group, fields, text);
    const embed: ScreenshotShareEmbed | null =
        worldName || extraFields.length
            ? {
                  title: worldName,
                  url:
                      worldName && first.worldId
                          ? `https://vrchat.com/home/world/${first.worldId}`
                          : null,
                  timestamp:
                      capturedAtMs > 0
                          ? new Date(capturedAtMs).toISOString()
                          : null,
                  fields: extraFields
              }
            : null;
    return {
        paths: group.map((fact) => fact.path),
        content:
            !embed && capturedAtMs > 0
                ? `<t:${Math.floor(capturedAtMs / 1000)}:f>`
                : '',
        embed,
        spoiler: fields.spoiler,
        metadata: fields.metadata,
        compression: fields.compression,
        printCaptions: []
    };
}

export function buildScreenshotShareMessages(
    facts: ScreenshotShareFacts[],
    fields: ScreenshotShareFields,
    text: ScreenshotShareText
): ScreenshotShareMessage[] {
    return groupConsecutiveByWorld(facts).map((group) =>
        buildMessage(group, fields, text)
    );
}
