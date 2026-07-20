import type {
    DataDirMigrationErrorCode,
    DataDirMigrationMode,
    DataDirMigrationPhase,
    DataDirMigrationPlan,
    DataDirMigrationWarning
} from './dataDirMigrationService';

export function formatDataDirMigrationBytes(bytes: number, locale: string) {
    const gigabytes = bytes >= 1024 ** 3;
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: gigabytes ? 'gigabyte' : 'megabyte',
        unitDisplay: 'short',
        maximumFractionDigits: 1
    }).format(bytes / (gigabytes ? 1024 ** 3 : 1024 ** 2));
}

export function dataDirMigrationModes(
    targetState: DataDirMigrationPlan['targetState']
): ReadonlyArray<readonly [DataDirMigrationMode, string]> {
    return [
        ['migrate', 'data_dir_migration.mode.migrate'],
        targetState === 'existingProfile'
            ? ['adoptExisting', 'data_dir_migration.mode.adoptExisting']
            : ['freshStart', 'data_dir_migration.mode.freshStart']
    ];
}

export function dataDirMigrationErrorKey(
    code: DataDirMigrationErrorCode
): string {
    return `data_dir_migration.error.${code}`;
}

export function dataDirMigrationPhaseKey(
    phase: DataDirMigrationPhase | null | undefined
): string {
    return `data_dir_migration.phase.${phase ?? 'preparing'}`;
}

export function dataDirMigrationWarningKey(
    warning: DataDirMigrationWarning
): string {
    return `data_dir_migration.warning.${warning}`;
}
