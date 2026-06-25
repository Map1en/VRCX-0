// @ts-nocheck
/* global __dirname, process, require */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(rootDir, 'Cargo.lock');
const RELEASE_VERSION_PATTERN =
    /^v?(?<major>[1-9][0-9]{0,1})\.(?<minor>0|[1-9][0-9]{0,2})\.(?<patch>0|[1-9][0-9]{0,2})(?:-[0-9A-Za-z.-]+)?$/;

function readArg(argName, fallback = '') {
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

function hasFlag(argName) {
    return process.argv.includes(`--${argName}`);
}

function buildReleaseMeta() {
    const version = readArg('version').trim();
    const match = RELEASE_VERSION_PATTERN.exec(version);
    if (!match?.groups) {
        throw new Error(`Invalid release version: ${version}`);
    }

    const buildVersion = version.replace(/^v/, '');
    const baseVersion = `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`;

    return {
        base_version: baseVersion,
        build_version: buildVersion,
        display_version: buildVersion,
        tag: `v${buildVersion}`
    };
}

function syncVersionToManifests(buildVersion) {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
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

function writeOutputs(meta) {
    const lines = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
    for (const line of lines) {
        console.log(line);
    }

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    }
}

try {
    const meta = buildReleaseMeta();
    if (!hasFlag('dry-run')) {
        syncVersionToManifests(meta.build_version);
    }
    writeOutputs(meta);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
