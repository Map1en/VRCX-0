import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { Field, JsonTreeView, SettingsSectionHeading } from '../SettingsField';
import type {
    SettingsAdvancedAction,
    SettingsAdvancedPrefs
} from './settingsAdvancedTypes';

type DiagnosticAction = 'config' | 'online' | 'tables';

type AdvancedTroubleshootingGroupProps = {
    configTreeData: Record<string, unknown>;
    onClearConfigTreeData: () => void;
    onGameLogDisabledChange: (disabled: boolean) => unknown;
    onLogResourceLoadChange: (checked: boolean) => unknown;
    onRefreshConfigTreeData: SettingsAdvancedAction;
    onRefreshOnlineVisits: SettingsAdvancedAction;
    onRefreshSqliteTableSizes: SettingsAdvancedAction;
    onUdonExceptionLoggingChange: (checked: boolean) => unknown;
    onlineVisitCount: number | null;
    prefs: SettingsAdvancedPrefs;
    sqliteTableSizeRows: ReadonlyArray<readonly [string, string]>;
    sqliteTableSizes: Record<string, unknown>;
};

export function AdvancedTroubleshootingGroup({
    configTreeData,
    onClearConfigTreeData,
    onGameLogDisabledChange,
    onLogResourceLoadChange,
    onRefreshConfigTreeData,
    onRefreshOnlineVisits,
    onRefreshSqliteTableSizes,
    onUdonExceptionLoggingChange,
    onlineVisitCount,
    prefs,
    sqliteTableSizeRows,
    sqliteTableSizes
}: AdvancedTroubleshootingGroupProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<DiagnosticAction | null>(
        null
    );
    const hasConfig = Object.keys(configTreeData).length > 0;
    const hasTableSizes = Object.keys(sqliteTableSizes).length > 0;

    async function runAction(
        actionName: DiagnosticAction,
        action: SettingsAdvancedAction
    ) {
        if (pendingAction) {
            return;
        }
        setPendingAction(actionName);
        try {
            await action();
        } finally {
            setPendingAction(null);
        }
    }

    function renderRefreshButton(
        actionName: 'online' | 'tables',
        action: SettingsAdvancedAction,
        label: string
    ) {
        const pending = pendingAction === actionName;
        return (
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={label}
                            disabled={pendingAction !== null}
                            onClick={() => runAction(actionName, action)}
                        >
                            {pending ? (
                                <Spinner />
                            ) : (
                                <RefreshCwIcon data-icon="inline-start" />
                            )}
                        </Button>
                    }
                />
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced.advanced_ui.troubleshooting.header'
                        )}
                    </CardTitle>
                    <CardDescription>
                        {t(
                            'view.settings.advanced.advanced_ui.troubleshooting.description'
                        )}
                    </CardDescription>
                    <CardAction>
                        <CollapsibleTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="justify-between"
                                >
                                    {t(
                                        open
                                            ? 'view.settings.advanced.advanced_ui.troubleshooting.hide'
                                            : 'view.settings.advanced.advanced_ui.troubleshooting.show'
                                    )}
                                    <ChevronDownIcon
                                        data-icon="inline-end"
                                        className={cn(
                                            'transition-transform duration-150 motion-reduce:transition-none',
                                            open && 'rotate-180'
                                        )}
                                    />
                                </Button>
                            }
                        />
                    </CardAction>
                </CardHeader>
                <CollapsibleContent>
                    <Separator />
                    <CardContent className="flex flex-col pt-1">
                        <SettingsSectionHeading
                            title={t('view.settings.general.logging.header')}
                        />
                        <Field
                            label={t(
                                'view.settings.advanced.advanced.cache_debug.udon_exception_logging'
                            )}
                        >
                            <Switch
                                checked={prefs.udonExceptionLogging}
                                onCheckedChange={onUdonExceptionLoggingChange}
                            />
                        </Field>
                        <Field
                            label={t(
                                'view.settings.general.logging.resource_load'
                            )}
                        >
                            <Switch
                                checked={prefs.logResourceLoad}
                                onCheckedChange={onLogResourceLoadChange}
                            />
                        </Field>
                        <Field
                            label={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.gamelog'
                            )}
                            description={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.gamelog_description'
                            )}
                        >
                            <Switch
                                checked={!prefs.gameLogDisabled}
                                onCheckedChange={(checked) =>
                                    onGameLogDisabledChange(!checked)
                                }
                            />
                        </Field>

                        <SettingsSectionHeading
                            title={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.tools'
                            )}
                        />
                        <Field
                            label={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.database_usage'
                            )}
                        >
                            {renderRefreshButton(
                                'tables',
                                onRefreshSqliteTableSizes,
                                t(
                                    'view.settings.advanced.advanced_ui.troubleshooting.refresh_database_usage'
                                )
                            )}
                        </Field>
                        {hasTableSizes ? (
                            <div className="text-muted-foreground grid [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-1 rounded-lg border p-3 text-sm">
                                {sqliteTableSizeRows.map(([key, labelKey]) => (
                                    <div
                                        key={key}
                                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                                    >
                                        <span>{t(labelKey)}</span>
                                        <span className="font-mono">
                                            {String(
                                                sqliteTableSizes[key] ?? ''
                                            )}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <Field
                            label={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.online_users'
                            )}
                        >
                            <div className="flex items-center justify-end gap-2">
                                {onlineVisitCount !== null ? (
                                    <span className="text-muted-foreground text-sm">
                                        {t(
                                            'view.profile.game_info.user_online',
                                            { count: onlineVisitCount }
                                        )}
                                    </span>
                                ) : null}
                                {renderRefreshButton(
                                    'online',
                                    onRefreshOnlineVisits,
                                    t(
                                        'view.settings.advanced.advanced_ui.troubleshooting.refresh_online_users'
                                    )
                                )}
                            </div>
                        </Field>
                        <Field
                            label={t(
                                'view.settings.advanced.advanced_ui.troubleshooting.vrchat_config'
                            )}
                        >
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={pendingAction !== null}
                                onClick={() => {
                                    if (hasConfig) {
                                        onClearConfigTreeData();
                                        return;
                                    }
                                    runAction(
                                        'config',
                                        onRefreshConfigTreeData
                                    );
                                }}
                            >
                                {pendingAction === 'config' ? (
                                    <Spinner data-icon="inline-start" />
                                ) : null}
                                {t(
                                    hasConfig
                                        ? 'view.settings.advanced.advanced_ui.troubleshooting.hide_config'
                                        : 'view.settings.advanced.advanced_ui.troubleshooting.view_config'
                                )}
                            </Button>
                        </Field>
                        {hasConfig ? (
                            <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                                <JsonTreeView data={configTreeData} />
                            </div>
                        ) : null}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}
