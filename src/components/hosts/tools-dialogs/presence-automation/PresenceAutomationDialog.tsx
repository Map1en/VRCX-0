import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

import {
    instanceTypes,
    normalizeAutoAcceptValue,
    parseJsonArray
} from '../toolsDialogUtils';
import { ContextRulesTab } from './ContextRulesTab';
import { InviteRulesTab, type InviteRulesTabValues } from './InviteRulesTab';
import {
    createGroupOptions,
    createInstanceOptions,
    DEFAULT_INVITE_MESSAGE_REPLY_SETTINGS,
    normalizeInviteMessageReplySettings,
    normalizeContextRule,
    type ContextAutomationRule,
    type TimeAutomationRule
} from './presenceAutomationDialogUtils';
import { TimeRulesTab } from './TimeRulesTab';

const DEFAULT_INVITE_VALUES: InviteRulesTabValues = {
    autoAcceptInviteRequests: 'Off',
    autoAcceptInviteGroups: [],
    autoInviteMessageReplies: DEFAULT_INVITE_MESSAGE_REPLY_SETTINGS
};

const I18N_ROOT = 'view.tools.social_automation';

type ConfigValueType = 'array' | 'bool' | 'json' | 'string';
type DialogOpenProps = {
    onOpenChange: (open: boolean) => void;
    open: boolean;
};
type ConfigWriteQueueRef = {
    current: Map<string, Promise<unknown>>;
};

async function saveConfigValue(
    key: string,
    value: unknown,
    type: ConfigValueType = 'string'
) {
    if (type === 'bool') {
        await configRepository.setBool(key, value as boolean);
    } else if (type === 'array' || type === 'json') {
        await configRepository.setString(key, JSON.stringify(value));
    } else {
        await configRepository.setString(key, value);
    }
}

function enqueueConfigWrite(
    queueRef: ConfigWriteQueueRef,
    key: string,
    write: () => Promise<unknown>,
    onError: (error: unknown) => void
) {
    const queues = queueRef.current;
    const previousWrite = queues.get(key) || Promise.resolve();
    const nextWrite = previousWrite
        .catch(() => {})
        .then(write)
        .catch(onError)
        .finally(() => {
            if (queues.get(key) === nextWrite) {
                queues.delete(key);
            }
        });
    queues.set(key, nextWrite);
    return nextWrite;
}

function usePresenceOptions() {
    const { t } = useTranslation();
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const favoriteWorldGroups = useFavoriteStore(
        (state) => state.favoriteWorldGroups
    );
    const localWorldFavoriteGroups = useFavoriteStore(
        (state) => state.localWorldFavoriteGroups
    );

    const groupOptions = useMemo(
        () =>
            createGroupOptions({
                remoteGroups: favoriteFriendGroups,
                localGroups: localFriendFavoriteGroups
            }),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const worldGroupOptions = useMemo(
        () =>
            createGroupOptions({
                remoteGroups: favoriteWorldGroups,
                localGroups: localWorldFavoriteGroups
            }),
        [favoriteWorldGroups, localWorldFavoriteGroups]
    );
    const instanceOptions = useMemo(
        () => createInstanceOptions(instanceTypes, t),
        [t]
    );

    return { groupOptions, worldGroupOptions, instanceOptions };
}

export function PresenceScheduleDialog({
    open,
    onOpenChange
}: DialogOpenProps) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map<string, Promise<unknown>>());
    const [timeRules, setTimeRules] = useState<TimeAutomationRule[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        commands
            .appPresenceAutomationRulesGet('time')
            .then((result) => {
                if (!active) {
                    return;
                }
                setTimeRules(result as TimeAutomationRule[]);
            })
            .catch((error: unknown) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_schedule_rules`)
                    )
                )
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open]);

    async function saveTimeRules(nextRules: TimeAutomationRule[]) {
        setTimeRules(nextRules);
        await enqueueConfigWrite(
            writeQueuesRef,
            'presenceAutomationTimeRules',
            async () => {
                const savedRules = await commands.appPresenceAutomationRulesSet(
                    'time',
                    nextRules
                );
                configRepository.applyServerEntry(
                    'presenceAutomationTimeRules',
                    JSON.stringify(savedRules)
                );
            },
            (error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_schedule_rules`)
                    )
                )
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-130 max-h-[calc(100vh-4rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>
                        {t(`${I18N_ROOT}.status_schedule`)}
                    </DialogTitle>
                    <DialogDescription>
                        {t(`${I18N_ROOT}.status_schedule_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-4 pb-4">
                        <TimeRulesTab
                            rules={timeRules}
                            disabled={loading}
                            onRulesChange={(nextRules) => {
                                saveTimeRules(nextRules);
                            }}
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export function PresenceRoomRulesDialog({
    open,
    onOpenChange
}: DialogOpenProps) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map());
    const { groupOptions, worldGroupOptions, instanceOptions } =
        usePresenceOptions();
    const [contextRules, setContextRules] = useState<ContextAutomationRule[]>(
        []
    );
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        commands
            .appPresenceAutomationRulesGet('context')
            .then((result) => {
                if (!active) {
                    return;
                }
                setContextRules(result.map(normalizeContextRule));
            })
            .catch((error: unknown) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_room_rules`)
                    )
                )
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open]);

    async function saveContextRules(nextRules: ContextAutomationRule[]) {
        const normalizedRules = nextRules.map(normalizeContextRule);
        setContextRules(normalizedRules);
        await enqueueConfigWrite(
            writeQueuesRef,
            'presenceAutomationContextRules',
            async () => {
                const savedRules = await commands.appPresenceAutomationRulesSet(
                    'context',
                    normalizedRules
                );
                configRepository.applyServerEntry(
                    'presenceAutomationContextRules',
                    JSON.stringify(savedRules)
                );
            },
            (error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_room_rules`)
                    )
                )
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>
                        {t(`${I18N_ROOT}.room_status_rules`)}
                    </DialogTitle>
                    <DialogDescription>
                        {t(`${I18N_ROOT}.room_status_rules_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-4 pb-4">
                        <ContextRulesTab
                            loading={loading}
                            groupOptions={groupOptions}
                            worldGroupOptions={worldGroupOptions}
                            instanceOptions={instanceOptions}
                            contextRules={contextRules}
                            onRulesChange={(nextRules) => {
                                saveContextRules(nextRules);
                            }}
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export function PresenceInviteRequestsDialog({
    open,
    onOpenChange
}: DialogOpenProps) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map());
    const { groupOptions } = usePresenceOptions();
    const [values, setValues] = useState<InviteRulesTabValues>(
        DEFAULT_INVITE_VALUES
    );
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getString('autoAcceptInviteRequests', 'Off'),
            configRepository.getString('autoAcceptInviteGroups', '[]'),
            configRepository.getString('autoInviteMessageReplies', '{}')
        ])
            .then((result) => {
                if (!active) {
                    return;
                }
                setValues({
                    autoAcceptInviteRequests: normalizeAutoAcceptValue(
                        result[0]
                    ),
                    autoAcceptInviteGroups: parseJsonArray(result[1]),
                    autoInviteMessageReplies:
                        normalizeInviteMessageReplySettings(result[2])
                });
            })
            .catch((error: unknown) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_invite_settings`)
                    )
                )
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open]);

    async function saveValue(
        key: keyof InviteRulesTabValues,
        value: unknown,
        type: ConfigValueType = 'string'
    ) {
        setValues(
            (current) =>
                ({
                    ...current,
                    [key]: value
                }) as InviteRulesTabValues
        );
        await enqueueConfigWrite(
            writeQueuesRef,
            key,
            () => saveConfigValue(key, value, type),
            (error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_invite_settings`)
                    )
                )
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[78vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>
                        {t(`${I18N_ROOT}.invite_request_auto_reply`)}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            `${I18N_ROOT}.invite_request_auto_reply_description`
                        )}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-4 pb-4">
                        <InviteRulesTab
                            values={values}
                            loading={loading}
                            groupOptions={groupOptions}
                            onSaveValue={saveValue}
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
