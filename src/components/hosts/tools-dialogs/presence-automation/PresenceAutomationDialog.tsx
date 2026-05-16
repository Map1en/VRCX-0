import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { configRepository } from '@/repositories/index.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
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
} from '../toolsDialogUtils.js';
import { ContextRulesTab } from './ContextRulesTab.js';
import { InviteRulesTab } from './InviteRulesTab.js';
import { TimeRulesTab } from './TimeRulesTab.js';
import {
    createGroupOptions,
    createInstanceOptions,
    normalizeContextRule
} from './presenceAutomationDialogUtils.js';

const DEFAULT_CONTEXT_VALUES = {
    autoStateChangeEnabled: false,
    autoStateChangeNoFriends: false,
    autoStateChangeGroups: [],
    autoStateChangeInstanceTypes: [],
    autoStateChangeAloneStatus: 'join me',
    autoStateChangeCompanyStatus: 'busy',
    autoStateChangeAloneDescEnabled: false,
    autoStateChangeAloneDesc: '',
    autoStateChangeCompanyDescEnabled: false,
    autoStateChangeCompanyDesc: ''
};

const DEFAULT_INVITE_VALUES = {
    autoAcceptInviteRequests: 'Off',
    autoAcceptInviteGroups: []
};

const I18N_ROOT = 'view.tools.social_automation';

async function saveConfigValue(key, value, type = 'string') {
    if (type === 'bool') {
        await configRepository.setBool(key, value);
    } else if (type === 'array') {
        await configRepository.setString(key, JSON.stringify(value));
    } else {
        await configRepository.setString(key, value);
    }
}

function enqueueConfigWrite(queueRef, key, write, onError) {
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

    const groupOptions = useMemo(
        () =>
            createGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups
            }),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const instanceOptions = useMemo(
        () => createInstanceOptions(instanceTypes, t),
        [t]
    );

    return { groupOptions, instanceOptions };
}

export function PresenceScheduleDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map());
    const [timeRules, setTimeRules] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        configRepository
            .getString('presenceAutomationTimeRules', '[]')
            .then((result) => {
                if (!active) {
                    return;
                }
                setTimeRules(parseJsonArray(result));
            })
            .catch((error) =>
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

    async function saveTimeRules(nextRules) {
        setTimeRules(nextRules);
        await enqueueConfigWrite(
            writeQueuesRef,
            'presenceAutomationTimeRules',
            () =>
                configRepository.setString(
                    'presenceAutomationTimeRules',
                    JSON.stringify(nextRules)
                ),
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
                    <DialogTitle>{t(`${I18N_ROOT}.status_schedule`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${I18N_ROOT}.status_schedule_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-4 pb-4">
                        <TimeRulesTab
                            rules={timeRules}
                            disabled={loading}
                            onRulesChange={(nextRules) =>
                                void saveTimeRules(nextRules)
                            }
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export function PresenceRoomRulesDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map());
    const { groupOptions, instanceOptions } = usePresenceOptions();
    const [values, setValues] = useState(DEFAULT_CONTEXT_VALUES);
    const [contextRules, setContextRules] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getBool('autoStateChangeEnabled', false),
            configRepository.getBool('autoStateChangeNoFriends', false),
            configRepository.getString('autoStateChangeGroups', '[]'),
            configRepository.getString('autoStateChangeInstanceTypes', '[]'),
            configRepository.getString('autoStateChangeAloneStatus', 'join me'),
            configRepository.getString('autoStateChangeCompanyStatus', 'busy'),
            configRepository.getBool('autoStateChangeAloneDescEnabled', false),
            configRepository.getString('autoStateChangeAloneDesc', ''),
            configRepository.getBool(
                'autoStateChangeCompanyDescEnabled',
                false
            ),
            configRepository.getString('autoStateChangeCompanyDesc', ''),
            configRepository.getString('presenceAutomationContextRules', '[]')
        ])
            .then((result) => {
                if (!active) {
                    return;
                }
                setValues({
                    autoStateChangeEnabled: Boolean(result[0]),
                    autoStateChangeNoFriends: Boolean(result[1]),
                    autoStateChangeGroups: parseJsonArray(result[2]),
                    autoStateChangeInstanceTypes: parseJsonArray(result[3]),
                    autoStateChangeAloneStatus:
                        String(result[4] || '') || 'join me',
                    autoStateChangeCompanyStatus:
                        String(result[5] || '') || 'busy',
                    autoStateChangeAloneDescEnabled: Boolean(result[6]),
                    autoStateChangeAloneDesc: String(result[7] || ''),
                    autoStateChangeCompanyDescEnabled: Boolean(result[8]),
                    autoStateChangeCompanyDesc: String(result[9] || '')
                });
                setContextRules(
                    parseJsonArray(result[10]).map(normalizeContextRule)
                );
            })
            .catch((error) =>
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

    async function saveValue(key, value, type = 'string') {
        setValues((current) => ({ ...current, [key]: value }));
        await enqueueConfigWrite(
            writeQueuesRef,
            key,
            () => saveConfigValue(key, value, type),
            (error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(`${I18N_ROOT}.failed_to_save_room_settings`)
                    )
                )
        );
    }

    async function saveContextRules(nextRules) {
        const normalizedRules = nextRules.map(normalizeContextRule);
        setContextRules(normalizedRules);
        await enqueueConfigWrite(
            writeQueuesRef,
            'presenceAutomationContextRules',
            () =>
                configRepository.setString(
                    'presenceAutomationContextRules',
                    JSON.stringify(normalizedRules)
                ),
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
            <DialogContent className="flex h-[86vh] max-h-[calc(100vh-4rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>{t(`${I18N_ROOT}.room_status_rules`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${I18N_ROOT}.room_status_rules_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="px-4 pb-4">
                        <ContextRulesTab
                            values={values}
                            loading={loading}
                            groupOptions={groupOptions}
                            instanceOptions={instanceOptions}
                            contextRules={contextRules}
                            onSaveValue={saveValue}
                            onRulesChange={(nextRules) =>
                                void saveContextRules(nextRules)
                            }
                        />
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

export function PresenceInviteRequestsDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const writeQueuesRef = useRef(new Map());
    const { groupOptions } = usePresenceOptions();
    const [values, setValues] = useState(DEFAULT_INVITE_VALUES);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getString('autoAcceptInviteRequests', 'Off'),
            configRepository.getString('autoAcceptInviteGroups', '[]')
        ])
            .then((result) => {
                if (!active) {
                    return;
                }
                setValues({
                    autoAcceptInviteRequests: normalizeAutoAcceptValue(
                        result[0]
                    ),
                    autoAcceptInviteGroups: parseJsonArray(result[1])
                });
            })
            .catch((error) =>
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

    async function saveValue(key, value, type = 'string') {
        setValues((current) => ({ ...current, [key]: value }));
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
                        {t(`${I18N_ROOT}.invite_request_auto_reply_description`)}
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
