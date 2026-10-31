import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import { publishToolsStatusUpdated } from '@/shared/constants/tools';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

import { normalizeAutoAcceptValue, parseJsonArray } from '../toolsDialogUtils';
import { ContextRulesTab } from './ContextRulesTab';
import { InviteRulesTab, type InviteRulesTabValues } from './InviteRulesTab';
import {
    normalizeContextRule,
    normalizeTimeRule,
    type ContextAutomationRule,
    type TimeAutomationRule
} from './presenceAutomationDialogUtils';
import { TimeRulesTab } from './TimeRulesTab';

const DEFAULT_INVITE_VALUES: InviteRulesTabValues = {
    autoAcceptInviteRequests: 'Off',
    autoAcceptInviteGroups: [],
    autoAcceptInviteStatuses: [],
    autoAcceptInviteMessageSlot: ''
};

const I18N_ROOT = 'view.tools.social_automation';

type DialogOpenProps = {
    onOpenChange: (open: boolean) => void;
    open: boolean;
};
type ConfigWriteQueueRef = {
    current: Map<string, Promise<void>>;
};

async function saveConfigValue(key: string, value: string | string[]) {
    await configRepository.setString(
        key,
        Array.isArray(value) ? JSON.stringify(value) : value
    );
}

function enqueueConfigWrite<TResult>(
    queueRef: ConfigWriteQueueRef,
    key: string,
    write: () => Promise<TResult>,
    onError: (error: unknown) => void
): Promise<void> {
    const queues = queueRef.current;
    const previousWrite = queues.get(key) || Promise.resolve();
    const nextWrite = previousWrite
        .catch(() => {})
        .then(write)
        .then(() => publishToolsStatusUpdated())
        .catch(onError)
        .finally(() => {
            if (queues.get(key) === nextWrite) {
                queues.delete(key);
            }
        });
    queues.set(key, nextWrite);
    return nextWrite;
}

export function PresenceScheduleDialog({
    open,
    onOpenChange
}: DialogOpenProps) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map<string, Promise<void>>());
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
                setTimeRules(result.map(normalizeTimeRule));
            })
            .catch((error: unknown) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_schedule_rules`)
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open, t]);

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
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_schedule_rules`)
                    )
                })
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
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_room_rules`)
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open, t]);

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
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_room_rules`)
                    )
                })
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
            configRepository.getString('autoAcceptInviteStatuses', '[]'),
            configRepository.getString('autoAcceptInviteMessageSlot', '')
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
                    autoAcceptInviteStatuses: parseJsonArray(result[2]),
                    autoAcceptInviteMessageSlot: result[3]
                });
            })
            .catch((error: unknown) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_load_invite_settings`)
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open, t]);

    async function saveValue<K extends keyof InviteRulesTabValues>(
        key: K,
        value: InviteRulesTabValues[K]
    ) {
        setValues((current) => ({ ...current, [key]: value }));
        await enqueueConfigWrite(
            writeQueuesRef,
            key,
            () => saveConfigValue(key, value),
            (error) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_invite_settings`)
                    )
                })
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
                            onSaveValue={saveValue}
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
