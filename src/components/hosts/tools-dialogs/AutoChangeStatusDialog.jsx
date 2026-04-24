import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { configRepository } from '@/repositories/index.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';

import { CheckRow, MultiCheckList, StatusEditor } from './ToolsDialogControls.jsx';
import {
    instanceTypes,
    normalizeAutoAcceptMode,
    normalizeAutoAcceptValue,
    parseJsonArray
} from './toolsDialogUtils.js';

export function AutoChangeStatusDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const [values, setValues] = useState({
        autoStateChangeEnabled: false,
        autoStateChangeNoFriends: false,
        autoStateChangeGroups: [],
        autoStateChangeInstanceTypes: [],
        autoStateChangeAloneStatus: 'join me',
        autoStateChangeCompanyStatus: 'busy',
        autoStateChangeAloneDescEnabled: false,
        autoStateChangeAloneDesc: '',
        autoStateChangeCompanyDescEnabled: false,
        autoStateChangeCompanyDesc: '',
        autoAcceptInviteRequests: 'Off',
        autoAcceptInviteGroups: []
    });
    const [loading, setLoading] = useState(false);

    const remoteGroupOptions = (favoriteFriendGroups || []).map((group) => ({
        value: group.key,
        label: group.displayName || group.name || group.key
    }));
    const localGroupOptions = (localFriendFavoriteGroups || []).map((group) => ({
        value: `local:${group}`,
        label: group
    }));
    const groupOptions = [...remoteGroupOptions, ...localGroupOptions].filter(
        (group) => group.value
    );

    const instanceOptions = instanceTypes.map((type) => {
        const mapKey = type === 'groupOnly' ? 'groupMembers' : type;
        const localeKey = accessTypeLocaleKeyMap[mapKey];
        const groupKey = accessTypeLocaleKeyMap.group;
        return {
            value: type,
            label:
                mapKey === 'groupPublic' ||
                mapKey === 'groupPlus' ||
                mapKey === 'groupMembers'
                    ? `${t(groupKey)} ${t(localeKey)}`
                    : localeKey
                      ? t(localeKey)
                      : type
        };
    });

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
            configRepository.getString('autoAcceptInviteRequests', 'Off'),
            configRepository.getString('autoAcceptInviteGroups', '[]')
        ])
            .then((result) => {
                if (!active) {
                    return;
                }
                setValues({
                    autoStateChangeEnabled: result[0],
                    autoStateChangeNoFriends: result[1],
                    autoStateChangeGroups: parseJsonArray(result[2]),
                    autoStateChangeInstanceTypes: parseJsonArray(result[3]),
                    autoStateChangeAloneStatus: result[4] || 'join me',
                    autoStateChangeCompanyStatus: result[5] || 'busy',
                    autoStateChangeAloneDescEnabled: result[6],
                    autoStateChangeAloneDesc: result[7] || '',
                    autoStateChangeCompanyDescEnabled: result[8],
                    autoStateChangeCompanyDesc: result[9] || '',
                    autoAcceptInviteRequests: normalizeAutoAcceptValue(
                        result[10]
                    ),
                    autoAcceptInviteGroups: parseJsonArray(result[11])
                });
            })
            .catch((error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t(
                            'host.tools_dialogs.generated_toast.failed_to_load_tool_settings'
                        )
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

    function setLocalValue(key, value) {
        setValues((current) => ({ ...current, [key]: value }));
    }

    async function saveValue(key, value, type = 'string') {
        setLocalValue(key, value);
        try {
            if (type === 'bool') {
                await configRepository.setBool(key, value);
            } else if (type === 'array') {
                await configRepository.setString(key, JSON.stringify(value));
            } else {
                await configRepository.setString(key, value);
            }
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.tools_dialogs.generated_toast.failed_to_save_tool_settings'
                    )
                )
            );
        }
    }

    const autoAcceptEnabled = values.autoAcceptInviteRequests !== 'Off';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.general.automation.auto_change_status'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.general.automation.auto_state_change_tooltip'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <CheckRow
                        id="autoStateChangeEnabled"
                        label={t(
                            'view.settings.general.automation.auto_change_status_switch'
                        )}
                        description={t(
                            'view.settings.general.automation.auto_state_change_switch_tooltip'
                        )}
                        checked={values.autoStateChangeEnabled}
                        disabled={loading}
                        onCheckedChange={(checked) =>
                            void saveValue(
                                'autoStateChangeEnabled',
                                checked,
                                'bool'
                            )
                        }
                    />
                    <Field
                        data-disabled={
                            loading || !values.autoStateChangeEnabled
                        }
                    >
                        <FieldLabel>
                            {t(
                                'view.settings.general.automation.alone_condition'
                            )}
                        </FieldLabel>
                        <Select
                            value={
                                values.autoStateChangeNoFriends
                                    ? 'noFriends'
                                    : 'alone'
                            }
                            disabled={loading || !values.autoStateChangeEnabled}
                            onValueChange={(value) =>
                                void saveValue(
                                    'autoStateChangeNoFriends',
                                    value === 'noFriends',
                                    'bool'
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="alone">
                                        {t(
                                            'view.settings.general.automation.alone'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="noFriends">
                                        {t(
                                            'view.settings.general.automation.no_friends'
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        data-disabled={
                            loading ||
                            !values.autoStateChangeEnabled ||
                            !values.autoStateChangeNoFriends
                        }
                    >
                        <FieldLabel>
                            {t(
                                'view.settings.general.automation.auto_change_status_groups'
                            )}
                        </FieldLabel>
                        <MultiCheckList
                            idPrefix="autoStateChangeGroups"
                            values={values.autoStateChangeGroups}
                            options={groupOptions}
                            disabled={
                                loading ||
                                !values.autoStateChangeEnabled ||
                                !values.autoStateChangeNoFriends
                            }
                            onChange={(next) =>
                                void saveValue(
                                    'autoStateChangeGroups',
                                    next,
                                    'array'
                                )
                            }
                        />
                    </Field>
                    <Field
                        data-disabled={
                            loading || !values.autoStateChangeEnabled
                        }
                    >
                        <FieldLabel>
                            {t(
                                'view.settings.general.automation.allowed_instance_types'
                            )}
                        </FieldLabel>
                        <MultiCheckList
                            idPrefix="autoStateChangeInstanceTypes"
                            values={values.autoStateChangeInstanceTypes}
                            options={instanceOptions}
                            disabled={loading || !values.autoStateChangeEnabled}
                            onChange={(next) =>
                                void saveValue(
                                    'autoStateChangeInstanceTypes',
                                    next,
                                    'array'
                                )
                            }
                        />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatusEditor
                            id="auto-state-change-alone-status"
                            label={t(
                                'view.settings.general.automation.alone_status'
                            )}
                            disabled={loading || !values.autoStateChangeEnabled}
                            status={values.autoStateChangeAloneStatus}
                            descEnabled={values.autoStateChangeAloneDescEnabled}
                            desc={values.autoStateChangeAloneDesc}
                            onStatusChange={(value) =>
                                void saveValue(
                                    'autoStateChangeAloneStatus',
                                    value
                                )
                            }
                            onDescEnabledChange={(value) =>
                                void saveValue(
                                    'autoStateChangeAloneDescEnabled',
                                    value,
                                    'bool'
                                )
                            }
                            onDescChange={(value) =>
                                void saveValue('autoStateChangeAloneDesc', value)
                            }
                        />
                        <StatusEditor
                            id="auto-state-change-company-status"
                            label={t(
                                'view.settings.general.automation.company_status'
                            )}
                            disabled={loading || !values.autoStateChangeEnabled}
                            status={values.autoStateChangeCompanyStatus}
                            descEnabled={
                                values.autoStateChangeCompanyDescEnabled
                            }
                            desc={values.autoStateChangeCompanyDesc}
                            onStatusChange={(value) =>
                                void saveValue(
                                    'autoStateChangeCompanyStatus',
                                    value
                                )
                            }
                            onDescEnabledChange={(value) =>
                                void saveValue(
                                    'autoStateChangeCompanyDescEnabled',
                                    value,
                                    'bool'
                                )
                            }
                            onDescChange={(value) =>
                                void saveValue(
                                    'autoStateChangeCompanyDesc',
                                    value
                                )
                            }
                        />
                    </div>
                    <Separator />
                    <CheckRow
                        id="autoAcceptInviteRequests"
                        label={t(
                            'view.settings.general.automation.auto_invite_request_accept'
                        )}
                        description={t(
                            'view.settings.general.automation.auto_invite_request_accept_tooltip'
                        )}
                        checked={autoAcceptEnabled}
                        disabled={loading}
                        onCheckedChange={(checked) =>
                            void saveValue(
                                'autoAcceptInviteRequests',
                                checked
                                    ? normalizeAutoAcceptMode(
                                          values.autoAcceptInviteRequests
                                      )
                                    : 'Off'
                            )
                        }
                    />
                    <Field data-disabled={loading || !autoAcceptEnabled}>
                        <FieldLabel>
                            {t(
                                'view.settings.general.automation.auto_invite_request_accept'
                            )}
                        </FieldLabel>
                        <Select
                            value={normalizeAutoAcceptMode(
                                values.autoAcceptInviteRequests
                            )}
                            disabled={loading || !autoAcceptEnabled}
                            onValueChange={(value) =>
                                void saveValue(
                                    'autoAcceptInviteRequests',
                                    value
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="All Favorites">
                                        {t(
                                            'view.settings.general.automation.auto_invite_request_accept_favs'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="Selected Favorites">
                                        {t(
                                            'view.settings.general.automation.auto_invite_request_accept_selected_favs'
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        data-disabled={
                            loading ||
                            values.autoAcceptInviteRequests !==
                                'Selected Favorites'
                        }
                    >
                        <FieldLabel>
                            {t(
                                'view.settings.general.automation.auto_accept_invite_groups'
                            )}
                        </FieldLabel>
                        <MultiCheckList
                            idPrefix="autoAcceptInviteGroups"
                            values={values.autoAcceptInviteGroups}
                            options={groupOptions}
                            disabled={
                                loading ||
                                values.autoAcceptInviteRequests !==
                                    'Selected Favorites'
                            }
                            onChange={(next) =>
                                void saveValue(
                                    'autoAcceptInviteGroups',
                                    next,
                                    'array'
                                )
                            }
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
