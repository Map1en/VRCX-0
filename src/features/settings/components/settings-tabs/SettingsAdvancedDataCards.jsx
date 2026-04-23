import { Trash2Icon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Field, JsonTreeView } from '../SettingsField.jsx';

export function SettingsAdvancedDataCards({
    t,
    prefs,
    avatarAutoCleanupOptions,
    sqliteTableSizes,
    sqliteTableSizeRows,
    onlineVisitCount,
    configTreeData,
    onAvatarAutoCleanupChange,
    onOpenPurgeDialog,
    onOpenLaunchOptions,
    onOpenRegistryBackup,
    onRefreshSqliteTableSizes,
    onRefreshOnlineVisits,
    onRefreshConfigTreeData,
    onClearConfigTreeData
}) {
    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced.advanced.database_cleanup.header'
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup_description'
                        )}
                        controlId="settings-avatar-auto-cleanup"
                    >
                        <Select
                            value={prefs.avatarAutoCleanup}
                            onValueChange={onAvatarAutoCleanupChange}
                        >
                            <SelectTrigger
                                id="settings-avatar-auto-cleanup"
                                className="w-36"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {avatarAutoCleanupOptions.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {value === 'Off'
                                                ? t(
                                                      'view.settings.advanced.advanced.database_cleanup.auto_cleanup_off'
                                                  )
                                                : t(
                                                      `view.settings.advanced.advanced.database_cleanup.auto_cleanup_${value}`
                                                  )}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.database_cleanup.purge_button'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onOpenPurgeDialog}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced.advanced.database_cleanup.purge'
                            )}
                        </Button>
                    </Field>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onOpenLaunchOptions}
                        >
                            {t('dialog.launch_options.header')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onOpenRegistryBackup}
                        >
                            {t('dialog.registry_backup.header')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.advanced_groups.database.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.sqlite_table_size.refresh'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onRefreshSqliteTableSizes}
                        >
                            {t(
                                'view.settings.advanced.advanced.sqlite_table_size.refresh'
                            )}
                        </Button>
                    </Field>
                    {Object.keys(sqliteTableSizes).length ? (
                        <div className="text-muted-foreground grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
                            {sqliteTableSizeRows.map(([key, labelKey]) => (
                                <div
                                    key={key}
                                    className="flex justify-between gap-3"
                                >
                                    <span>{t(labelKey)}</span>
                                    <span className="font-mono">
                                        {sqliteTableSizes[key]}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.advanced_groups.diagnostics.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field label={t('view.profile.game_info.online_users')}>
                        <div className="flex items-center gap-2">
                            {onlineVisitCount !== null ? (
                                <span className="text-muted-foreground text-sm">
                                    {t(
                                        'view.profile.game_info.user_online',
                                        { count: onlineVisitCount }
                                    )}
                                </span>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onRefreshOnlineVisits}
                            >
                                {t('common.actions.refresh')}
                            </Button>
                        </div>
                    </Field>
                    <Field label={t('view.profile.config_json')}>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onRefreshConfigTreeData}
                            >
                                {t('common.actions.refresh')}
                            </Button>
                            {Object.keys(configTreeData).length ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={onClearConfigTreeData}
                                >
                                    {t('common.actions.clear')}
                                </Button>
                            ) : null}
                        </div>
                    </Field>
                    {Object.keys(configTreeData).length ? (
                        <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                            <JsonTreeView data={configTreeData} />
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </>
    );
}
