import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.join(import.meta.dirname, '..');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(rootDir, 'Cargo.lock');
const RELEASE_VERSION_PATTERN =
    /^v?(?<major>[1-9][0-9]{0,1})\.(?<minor>0|[1-9][0-9]{0,2})\.(?<patch>0|[1-9][0-9]{0,2})(?:-beta\.(?<beta>[1-9][0-9]{0,5}))?$/;

type ReleaseMeta = {
    base_version: string;
    build_version: string;
    channel: 'stable' | 'beta';
    prerelease: 'true' | 'false';
    beta_number: string;
    display_version: string;
    tag: string;
};

function readArg(argName: string, fallback = ''): string {
    const prefix = `--${argName}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) {
        return inline.slice(prefix.length);
    }

    const index = process.argv.indexOf(`--${argName}`);
    if (index >= 0 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }

    return fallback;
}

function hasFlag(argName: string): boolean {
    return process.argv.includes(`--${argName}`);
}

function buildReleaseMeta(versionInput: string): ReleaseMeta {
    const version = versionInput.trim();
    const match = RELEASE_VERSION_PATTERN.exec(version);
    if (!match?.groups) {
        throw new Error(`Invalid release version: ${version}`);
    }

    const buildVersion = version.replace(/^v/, '');
    const baseVersion = `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`;
    const channel = match.groups.beta ? 'beta' : 'stable';

    return {
        base_version: baseVersion,
        build_version: buildVersion,
        channel,
        prerelease: channel === 'beta' ? 'true' : 'false',
        beta_number: match.groups.beta || '',
        display_version: buildVersion,
        tag: `v${buildVersion}`
    };
}

function syncVersionToManifests(buildVersion: string): void {
    const parsedTauriConfig: unknown = JSON.parse(
        fs.readFileSync(tauriConfigPath, 'utf8')
    );
    if (!parsedTauriConfig || typeof parsedTauriConfig !== 'object') {
        throw new Error('Invalid src-tauri/tauri.conf.json');
    }
    const tauriConfig = parsedTauriConfig as Record<string, unknown>;
    tauriConfig.version = buildVersion;
    fs.writeFileSync(
        tauriConfigPath,
        `${JSON.stringify(tauriConfig, null, 4)}\n`
    );

    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    const cargoVersionPattern = /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m;
    if (!cargoVersionPattern.test(cargoToml)) {
        throw new Error(
            'Failed to update src-tauri/Cargo.toml package version'
        );
    }
    fs.writeFileSync(
        cargoTomlPath,
        cargoToml.replace(cargoVersionPattern, `$1"${buildVersion}"`)
    );

    if (!fs.existsSync(cargoLockPath)) {
        return;
    }

    const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
    const lockVersionPattern =
        /(\[\[package\]\]\r?\nname = "vrcx-0"\r?\nversion = )"[^"]+"/;
    if (!lockVersionPattern.test(cargoLock)) {
        throw new Error('Failed to update Cargo.lock package version');
    }
    fs.writeFileSync(
        cargoLockPath,
        cargoLock.replace(lockVersionPattern, `$1"${buildVersion}"`)
    );
}

function writeOutputs(meta: ReleaseMeta): void {
    const lines = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
    for (const line of lines) {
        console.log(line);
    }

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    }
}

function main(): void {
    const meta = buildReleaseMeta(readArg('version'));
    if (!hasFlag('dry-run')) {
        syncVersionToManifests(meta.build_version);
    }
    writeOutputs(meta);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

export { buildReleaseMeta };
