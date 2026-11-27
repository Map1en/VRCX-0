import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsCard } from '@/components/layout/SettingsCard';
import {
    commands,
    type ActivityTypeDefinition,
    type NotificationSoundRule
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Slider } from '@/ui/shadcn/slider';

import { Field } from '../SettingsField';

const translationKey =
    'view.settings.notifications.notifications.activity_sounds';
const defaultVolume = 50;
const builtinSounds = [
    'join_01_chime',
    'join_03_arp',
    'leave_01_chime',
    'leave_03_arp',
    'notify_01_ding',
    'notify_02_double',
    'notify_03_glass'
] as const;
const additionalGameLogEvents = [
    'Location',
    'PortalSpawn',
    'ResourceLoad',
    'StringLoad',
    'ImageLoad'
] as const;

type SoundSettingsData = {
    definitions: ActivityTypeDefinition[];
    rules: Record<string, NotificationSoundRule>;
};
type ActionError =
    | 'load_failed'
    | 'save_failed'
    | 'file_failed'
    | 'preview_failed';
type SelectOption = { value: string; label: string };

export function SettingsNotificationSoundsCard() {
    const { t } = useTranslation();
    const [data, setData] = useState<SoundSettingsData | null>(null);
    const [selectedEvent, setSelectedEvent] = useState('OnPlayerJoined');
    const [error, setError] = useState<ActionError | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [pending, setPending] = useState(false);
    const [draftVolume, setDraftVolume] = useState<number | null>(null);
    const requestPending = useRef(false);

    useEffect(() => {
        let active = true;
        Promise.all([
            commands.appOverlayActivityDefinitionsGet(),
            commands.appHostNotificationSoundRules()
        ])
            .then(([definitions, rules]) => {
                if (active) setData({ definitions, rules });
            })
            .catch(() => {
                if (active) setError('load_failed');
            });
        return () => {
            active = false;
        };
    }, [loadAttempt]);

    const eventGroups = new Map<string, SelectOption[]>();
    for (const definition of data?.definitions ?? []) {
        const options = eventGroups.get(definition.category) ?? [];
        options.push({
            value: definition.key,
            label: t(
                `dialog.wrist_feed_notifications.types.${definition.key.replaceAll('.', '_')}`,
                { defaultValue: definition.key }
            )
        });
        eventGroups.set(definition.category, options);
    }
    const gameLogOptions = additionalGameLogEvents.map((value) => ({
        value,
        label:
            value === 'ResourceLoad'
                ? t(`${translationKey}.resource_load`)
                : t(`view.game_log.filters.${value}`)
    }));
    const eventOptions = [...eventGroups.values()]
        .flat()
        .concat(gameLogOptions);
    const event = eventOptions.some(({ value }) => value === selectedEvent)
        ? selectedEvent
        : eventOptions[0].value;
    const rule = data?.rules[event];
    const usesCommonResourceSound =
        event === 'StringLoad' || event === 'ImageLoad';
    const effectiveRule =
        rule ??
        (usesCommonResourceSound ? data?.rules.ResourceLoad : undefined);
    const volume = draftVolume ?? effectiveRule?.volume ?? defaultVolume;
    const newSourceVolume = rule?.volume ?? defaultVolume;
    const source = rule?.source;
    const customPath = source?.kind === 'custom' ? source.path : null;
    const sourceValue =
        source?.kind === 'builtin' ? source.id : (source?.kind ?? 'off');
    const builtinOptions = builtinSounds.map((value) => ({
        value,
        label: t(`${translationKey}.builtin.${value}`)
    }));
    const sourceOptions: SelectOption[] = [
        {
            value: 'off',
            label: t(
                `${translationKey}.${usesCommonResourceSound ? 'use_resource_default' : 'off'}`
            )
        },
        ...builtinOptions,
        { value: 'custom', label: t(`${translationKey}.custom`) }
    ];

    async function runAction(
        action: () => Promise<void>,
        failure: ActionError
    ) {
        if (requestPending.current) return;
        requestPending.current = true;
        setPending(true);
        setError(null);
        try {
            await action();
        } catch {
            setError(failure);
        } finally {
            requestPending.current = false;
            setPending(false);
        }
    }

    async function saveRule(nextRule: NotificationSoundRule | null) {
        await commands.appHostNotificationSoundSetRule(event, nextRule);
        setData((previous) => {
            if (!previous) return previous;
            const rules = { ...previous.rules };
            if (nextRule) {
                rules[event] = nextRule;
            } else {
                delete rules[event];
            }
            return { ...previous, rules };
        });
    }

    function chooseFile() {
        void runAction(async () => {
            const path = await commands.appHostNotificationSoundChooseFile();
            if (path) {
                await saveRule({
                    source: { kind: 'custom', path },
                    volume: newSourceVolume
                });
            }
        }, 'file_failed');
    }

    function changeSource(value: string | null) {
        if (value === 'custom') {
            chooseFile();
        } else if (value) {
            const nextRule: NotificationSoundRule | null =
                value === 'off'
                    ? null
                    : {
                          source: { kind: 'builtin', id: value },
                          volume: newSourceVolume
                      };
            void runAction(() => saveRule(nextRule), 'save_failed');
        }
    }

    function changeEvent(value: string | null) {
        if (value) {
            setSelectedEvent(value);
            setDraftVolume(null);
            setError(null);
        }
    }

    function commitVolume(value: number) {
        if (requestPending.current) return;
        if (!rule || value === rule.volume) {
            setDraftVolume(null);
            return;
        }
        void runAction(async () => {
            try {
                await saveRule({ ...rule, volume: value });
            } finally {
                setDraftVolume(null);
            }
        }, 'save_failed');
    }

    return (
        <SettingsCard
            cardId="notifications.activity_sounds"
            title={t(`${translationKey}.header`)}
            description={t(`${translationKey}.description`)}
        >
            {data ? (
                <>
                    <Field
                        settingId="notifications.activity_sounds.event"
                        label={t(`${translationKey}.event`)}
                        description={
                            event === 'ResourceLoad'
                                ? t(`${translationKey}.resource_load_hint`)
                                : undefined
                        }
                        controlId="settings-activity-sounds-event"
                    >
                        <Select
                            value={event}
                            items={eventOptions}
                            onValueChange={changeEvent}
                            disabled={pending}
                        >
                            <SelectTrigger
                                id="settings-activity-sounds-event"
                                className="w-60 max-w-full"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {[...eventGroups].map(([category, options]) => (
                                    <SelectGroup key={category}>
                                        <SelectLabel>
                                            {t(
                                                `dialog.wrist_feed_notifications.categories.${category}.label`
                                            )}
                                        </SelectLabel>
                                        {options.map(({ value, label }) => (
                                            <SelectItem
                                                key={value}
                                                value={value}
                                            >
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                                <SelectGroup>
                                    <SelectLabel>
                                        {t(`${translationKey}.game_log`)}
                                    </SelectLabel>
                                    {gameLogOptions.map(({ value, label }) => (
                                        <SelectItem key={value} value={value}>
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        settingId="notifications.activity_sounds.source"
                        label={t(`${translationKey}.source`)}
                        description={t(`${translationKey}.custom_formats`)}
                        controlId="settings-activity-sounds-source"
                    >
                        <div className="flex w-60 max-w-full min-w-0 flex-col gap-2">
                            <Select
                                value={sourceValue}
                                items={sourceOptions}
                                onValueChange={changeSource}
                                disabled={pending}
                            >
                                <SelectTrigger
                                    id="settings-activity-sounds-source"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {sourceOptions.map(
                                            ({ value, label }) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                >
                                                    {label}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            {customPath ? (
                                <>
                                    <span
                                        className="text-muted-foreground truncate text-sm"
                                        title={customPath}
                                    >
                                        {customPath.split(/[\\/]/).at(-1)}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={chooseFile}
                                        disabled={pending}
                                    >
                                        {t(`${translationKey}.choose_file`)}
                                    </Button>
                                </>
                            ) : null}
                        </div>
                    </Field>
                    <Field
                        settingId="notifications.activity_sounds.volume"
                        label={t(`${translationKey}.volume`)}
                        disabled={!rule}
                    >
                        <div className="flex w-60 max-w-full items-center gap-3">
                            <Slider
                                thumbLabel={t(`${translationKey}.volume`)}
                                value={[volume]}
                                min={0}
                                max={100}
                                aria-busy={pending}
                                onValueChange={(value) => {
                                    if (!requestPending.current) {
                                        setDraftVolume(
                                            Array.isArray(value)
                                                ? value[0]
                                                : value
                                        );
                                    }
                                }}
                                onValueCommitted={(value) =>
                                    commitVolume(
                                        Array.isArray(value) ? value[0] : value
                                    )
                                }
                            />
                            <span className="text-muted-foreground w-10 shrink-0 text-right text-sm tabular-nums">
                                {volume}%
                            </span>
                        </div>
                    </Field>
                    <Field
                        settingId="notifications.activity_sounds.preview"
                        label={t(`${translationKey}.preview`)}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending || !effectiveRule || volume === 0}
                            onClick={() => {
                                if (effectiveRule) {
                                    void runAction(async () => {
                                        await commands.appHostNotificationSoundPreview(
                                            { ...effectiveRule, volume }
                                        );
                                    }, 'preview_failed');
                                }
                            }}
                        >
                            {t(`${translationKey}.play`)}
                        </Button>
                    </Field>
                </>
            ) : error !== 'load_failed' ? (
                <p className="text-muted-foreground py-2 text-sm" role="status">
                    {t(`${translationKey}.loading`)}
                </p>
            ) : null}
            {error ? (
                <div className="flex flex-wrap items-center gap-2 py-2">
                    <p className="text-destructive text-sm" role="alert">
                        {t(`${translationKey}.${error}`)}
                    </p>
                    {error === 'load_failed' ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setError(null);
                                setLoadAttempt((attempt) => attempt + 1);
                            }}
                        >
                            {t('common.actions.retry')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </SettingsCard>
    );
}
