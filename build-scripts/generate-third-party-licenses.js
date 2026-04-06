/* global __dirname, require */
// generate-third-party-licenses.js
// use by frontend open source software notice dialog

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const frontendLicensePath = path.join(
    rootDir,
    'build',
    'html',
    '.vite',
    'license.md'
);
const outputDir = path.join(rootDir, 'build', 'html', 'licenses');
const outputManifestPath = path.join(outputDir, 'third-party-licenses.json');
const outputNoticePath = path.join(outputDir, 'THIRD_PARTY_NOTICES.txt');

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function readFileIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return fs.readFileSync(filePath, 'utf8');
}

function normalizeWhitespace(value) {
    return value?.replace(/\r\n/g, '\n').trim() || '';
}

function sanitizeId(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function parseFrontendLicenses(markdown) {
    const normalized = normalizeWhitespace(markdown);
    if (!normalized) {
        return [];
    }

    const sections = normalized.split(/\n(?=## )/g).slice(1);

    return sections
        .map((section) => {
            const [headerLine, ...bodyLines] = section.split('\n');
            const headerMatch = headerLine.match(
                /^##\s+(.+?)\s+-\s+(.+?)\s+\((.+?)\)$/
            );

            if (!headerMatch) {
                return null;
            }

            const [, name, version, license] = headerMatch;
            const noticeText = normalizeWhitespace(bodyLines.join('\n'));

            return {
                id: `frontend-${sanitizeId(`${name}-${version}`)}`,
                name,
                version,
                license,
                sourceType: 'frontend',
                sourceLabel: 'Frontend bundle',
                noticeText,
                needsReview: !license && !noticeText
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function createThirdPartyNoticeText(frontendLicenseMarkdown) {
    const lines = [
        'VRCX-0 Third-Party Notices',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '========================================',
        'Frontend bundled dependencies',
        '========================================',
        '',
        normalizeWhitespace(frontendLicenseMarkdown) ||
            'No frontend license manifest was available.',
        ''
    ];

    return `${lines.join('\n').trimEnd()}\n`;
}

function main() {
    ensureDirectory(outputDir);

    const frontendLicenseMarkdown = readFileIfExists(frontendLicensePath) || '';
    const frontendEntries = parseFrontendLicenses(frontendLicenseMarkdown);
    const manifest = {
        generatedAt: new Date().toISOString(),
        noticePath: 'licenses/THIRD_PARTY_NOTICES.txt',
        entries: frontendEntries
    };

    fs.writeFileSync(outputManifestPath, JSON.stringify(manifest, null, 4));
    fs.writeFileSync(
        outputNoticePath,
        createThirdPartyNoticeText(frontendLicenseMarkdown)
    );

    const reviewCount = manifest.entries.filter(
        (entry) => entry.needsReview
    ).length;
    console.log(
        `Generated third-party license manifest with ${manifest.entries.length} entries (${reviewCount} requiring review).`
    );
}

main();
