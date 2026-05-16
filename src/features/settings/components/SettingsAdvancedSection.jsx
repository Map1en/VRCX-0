export function SettingsAdvancedSection({ advanced }) {
    const {
        SettingsAdvancedTab,
        t,
        prefs,
        cacheStats,
        cacheStatsVisible,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        backendAppSnapshot,
        saveBoolPreference,
        backend,
        saveAppLauncherField,
        clearVrcxCache,
        promptAutoClearVrcxCacheFrequency,
        refreshCacheSize,
        handleGameLogDisabledChange,
        saveStringPreference,
        setPurgeDialogOpen,
        refreshSqliteTableSizes,
        refreshOnlineVisits,
        refreshConfigTreeData,
        refreshBackendAppSnapshot,
        setConfigTreeData,
        migrateLegacyVrcxData
    } = advanced;

    return (
        <SettingsAdvancedTab
            t={t}
            prefs={prefs}
            cacheStats={cacheStats}
            cacheStatsVisible={cacheStatsVisible}
            avatarAutoCleanupOptions={avatarAutoCleanupOptions}
            sqliteTableSizes={sqliteTableSizes}
            sqliteTableSizeRows={sqliteTableSizeRows}
            onlineVisitCount={onlineVisitCount}
            configTreeData={configTreeData}
            backendAppSnapshot={backendAppSnapshot}
            gameLogDisabledLabel={t(
                'view.settings.advanced.advanced.cache_debug.disable_gamelog'
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
            onMigrateLegacyVrcxData={() => void migrateLegacyVrcxData()}
            onRefreshSqliteTableSizes={() => void refreshSqliteTableSizes()}
            onRefreshOnlineVisits={() => void refreshOnlineVisits()}
            onRefreshConfigTreeData={() => void refreshConfigTreeData()}
            onRefreshBackendAppSnapshot={() =>
                void refreshBackendAppSnapshot()
            }
            onClearConfigTreeData={() => setConfigTreeData({})}
        />
    );
}
