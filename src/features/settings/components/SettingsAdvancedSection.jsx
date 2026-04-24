export function SettingsAdvancedSection({ advanced }) {
    const {
        SettingsAdvancedTab,
        t,
        prefs,
        cacheStats,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        saveBoolPreference,
        promptAutoLoginDelaySeconds,
        backend,
        saveAppLauncherField,
        clearVrcxCache,
        promptAutoClearVrcxCacheFrequency,
        refreshCacheSize,
        handleGameLogDisabledChange,
        saveStringPreference,
        setPurgeDialogOpen,
        setSystemHostOpen,
        refreshSqliteTableSizes,
        refreshOnlineVisits,
        refreshConfigTreeData,
        setConfigTreeData
    } = advanced;

    return (
        <SettingsAdvancedTab
            t={t}
            prefs={prefs}
            cacheStats={cacheStats}
            avatarAutoCleanupOptions={avatarAutoCleanupOptions}
            sqliteTableSizes={sqliteTableSizes}
            sqliteTableSizeRows={sqliteTableSizeRows}
            onlineVisitCount={onlineVisitCount}
            configTreeData={configTreeData}
            gameLogDisabledLabel={t(
                'view.settings.generated_dynamic.value_value',
                {
                    value: t(
                        'view.settings.advanced.advanced.cache_debug.disable_gamelog'
                    ),
                    value2: t(
                        'view.settings.advanced.advanced.cache_debug.disable_gamelog_notice'
                    )
                }
            )}
            onRelaunchVRChatAfterCrashChange={(checked) =>
                void saveBoolPreference(
                    'relaunchVRChatAfterCrash',
                    'VRCX_relaunchVRChatAfterCrash',
                    checked
                )
            }
            onVrcQuitFixChange={(checked) =>
                void saveBoolPreference('vrcQuitFix', 'vrcQuitFix', checked)
            }
            onAutoSweepVRChatCacheChange={(checked) =>
                void saveBoolPreference(
                    'autoSweepVRChatCache',
                    'VRCX_autoSweepVRChatCache',
                    checked
                )
            }
            onUdonExceptionLoggingChange={(checked) =>
                void saveBoolPreference(
                    'udonExceptionLogging',
                    'VRCX_udonExceptionLogging',
                    checked
                )
            }
            onLogResourceLoadChange={(checked) =>
                void saveBoolPreference(
                    'logResourceLoad',
                    'logResourceLoad',
                    checked
                )
            }
            onLogEmptyAvatarsChange={(checked) =>
                void saveBoolPreference(
                    'logEmptyAvatars',
                    'logEmptyAvatars',
                    checked
                )
            }
            onAutoLoginDelayEnabledChange={(checked) =>
                void saveBoolPreference(
                    'autoLoginDelayEnabled',
                    'VRCX_autoLoginDelayEnabled',
                    checked
                )
            }
            onPromptAutoLoginDelaySeconds={() =>
                void promptAutoLoginDelaySeconds()
            }
            onOpenShortcutFolder={() => void backend.app.OpenShortcutFolder()}
            onEnableAppLauncherChange={(checked) =>
                void saveAppLauncherField('enableAppLauncher', checked)
            }
            onEnableAppLauncherAutoCloseChange={(checked) =>
                void saveAppLauncherField('enableAppLauncherAutoClose', checked)
            }
            onEnableAppLauncherRunProcessOnceChange={(checked) =>
                void saveAppLauncherField(
                    'enableAppLauncherRunProcessOnce',
                    checked
                )
            }
            onShowConfirmationOnSwitchAvatarChange={(checked) =>
                void saveBoolPreference(
                    'showConfirmationOnSwitchAvatar',
                    'showConfirmationOnSwitchAvatar',
                    checked
                )
            }
            onClearVrcxCache={() => void clearVrcxCache()}
            onPromptAutoClearVrcxCacheFrequency={() =>
                void promptAutoClearVrcxCacheFrequency()
            }
            onRefreshCacheSize={() => void refreshCacheSize()}
            onGameLogDisabledChange={(checked) =>
                void handleGameLogDisabledChange(checked)
            }
            onAvatarAutoCleanupChange={(value) =>
                void saveStringPreference(
                    'avatarAutoCleanup',
                    'avatarAutoCleanup',
                    value
                )
            }
            onOpenPurgeDialog={() => setPurgeDialogOpen(true)}
            onOpenLaunchOptions={() =>
                setSystemHostOpen('launchOptionsOpen', true)
            }
            onOpenRegistryBackup={() =>
                setSystemHostOpen('registryBackupOpen', true)
            }
            onRefreshSqliteTableSizes={() => void refreshSqliteTableSizes()}
            onRefreshOnlineVisits={() => void refreshOnlineVisits()}
            onRefreshConfigTreeData={() => void refreshConfigTreeData()}
            onClearConfigTreeData={() => setConfigTreeData({})}
        />
    );
}
