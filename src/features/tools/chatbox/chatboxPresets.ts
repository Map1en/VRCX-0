import type { ChatboxFormats } from '@/platform/tauri/bindings';

type Translate = (key: string, options?: Record<string, string>) => string;

export type ChatboxPreset = {
    id: string;
    template: (t: Translate) => string;
    formats?: Partial<ChatboxFormats>;
};

export type ChatboxPresetGroup = {
    id: 'time' | 'music' | 'system' | 'session';
    presets: ChatboxPreset[];
};

const literal = (template: string) => () => template;

const localized =
    (key: string, values: Record<string, string>) => (t: Translate) =>
        t(`view.tools.chatbox.presets.${key}`, values);

export const CHATBOX_PRESET_GROUPS: ChatboxPresetGroup[] = [
    {
        id: 'time',
        presets: [
            { id: 'time', template: literal('{time}') },
            { id: 'time-watch', template: literal('⌚ {time}') },
            { id: 'time-brackets', template: literal('【{time}】') },
            {
                id: 'time-12h',
                template: literal('{time}'),
                formats: { hour12: true }
            }
        ]
    },
    {
        id: 'music',
        presets: [
            {
                id: 'music-note',
                template: literal(
                    '♪ {track}\n{progress} {position} / {duration}'
                )
            },
            {
                id: 'music-label',
                template: localized('now_playing', { track: '{track}' })
            },
            { id: 'music-compact', template: literal('♪ {title} - {artist}') },
            {
                id: 'music-album',
                template: literal('♪ {track}\n「{album}」')
            },
            {
                id: 'music-quotes',
                template: literal('「{title}」\n{progress}'),
                formats: { progress: 'blocks' }
            }
        ]
    },
    {
        id: 'system',
        presets: [
            { id: 'stats-dot', template: literal('CPU {cpu} · RAM {memory}') },
            {
                id: 'stats-bar',
                template: literal('CPU {cpu} | RAM {memory}'),
                formats: { memory: 'usedOfTotal', memoryDecimals: 1 }
            },
            {
                id: 'stats-brackets',
                template: literal('[CPU {cpu}] [RAM {memory}]'),
                formats: { cpuDecimals: 1 }
            },
            { id: 'stats-gpu', template: literal('GPU {gpu} · {gputemp}') },
            {
                id: 'stats-vram',
                template: literal('GPU {gpu} | VRAM {vram}'),
                formats: { vram: 'usedOfTotal', vramDecimals: 1 }
            },
            {
                id: 'stats-all',
                template: literal('CPU {cpu} · GPU {gpu} · RAM {memory}')
            }
        ]
    },
    {
        id: 'session',
        presets: [
            {
                id: 'session-label',
                template: localized('game_session', { duration: '{session}' })
            },
            { id: 'session-timer', template: literal('⏱ {session}') }
        ]
    }
];

export const CHATBOX_PRESETS: ChatboxPreset[] = CHATBOX_PRESET_GROUPS.flatMap(
    (group) => group.presets
);

export const CHATBOX_SYMBOLS = [
    '♪',
    '♫',
    '⌚',
    '⏱',
    '❤',
    '✦',
    '★',
    '☆',
    '✿',
    '·',
    '|',
    '…',
    '【】',
    '「」',
    '『』',
    '《》',
    '( )',
    '[ ]'
];
