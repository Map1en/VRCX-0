function escapeTag(tag: unknown): string {
    const s = String(tag);
    return s.replace(/["&'<>]/g, (c: any) => `&#${c.charCodeAt(0)};`);
}

function escapeTagRecursive<T>(obj: T): T {
    if (typeof obj === 'string') {
        return escapeTag(obj) as T;
    }
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            obj[key] = escapeTagRecursive(obj[key]);
        }
    }
    return obj;
}

function textToHex(text: unknown): string {
    const s = String(text);
    return s
        .split('')
        .map((c: any) => c.charCodeAt(0).toString(16).toUpperCase())
        .join(' ');
}

function commaNumber(num: unknown): string {
    if (!num) {
        return '0';
    }
    const numValue = Number(num);
    if (isNaN(numValue)) {
        return '0';
    }
    const s = String(numValue);
    return s.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
}

function localeIncludes(
    str: unknown,
    search: unknown,
    comparer: Pick<Intl.Collator, 'compare'>
): boolean {
    // These checks are stolen from https://stackoverflow.com/a/69623589/11030436
    if (search === '') {
        return true;
    } else if (!str || !search) {
        return false;
    }
    const strObj = String(str);
    const searchObj = String(search);

    if (strObj.length === 0) {
        return false;
    }

    if (searchObj.length > strObj.length) {
        return false;
    }

    for (let i = 0; i < strObj.length - searchObj.length + 1; i++) {
        const substr = strObj.substring(i, i + searchObj.length);
        if (comparer.compare(substr, searchObj) === 0) {
            return true;
        }
    }
    return false;
}

function replaceBioSymbols(text: unknown): string {
    if (typeof text !== 'string') {
        return '';
    }
    const symbolList: Record<string, string> = {
        '@': '＠',
        '#': '＃',
        $: '＄',
        '%': '％',
        '&': '＆',
        '=': '＝',
        '+': '＋',
        '/': '⁄',
        '\\': '＼',
        ';': ';',
        ':': '˸',
        ',': '‚',
        '?': '？',
        '!': 'ǃ',
        '"': '＂',
        '<': '≺',
        '>': '≻',
        '.': '․',
        '^': '＾',
        '{': '｛',
        '}': '｝',
        '[': '［',
        ']': '］',
        '(': '（',
        ')': '）',
        '|': '｜',
        '*': '∗'
    };
    let newText = text;
    for (const key in symbolList) {
        const regex = new RegExp(symbolList[key], 'g');
        newText = newText.replace(regex, key);
    }
    return newText.replace(/ {1,}/g, ' ').trimRight();
}

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function removeEmojis(text: unknown): string {
    if (!text) {
        return '';
    }
    return String(text)
        .replace(
            /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
            ''
        )
        .replace(/\s+/g, ' ')
        .trim();
}

export {
    escapeTag,
    escapeTagRecursive,
    textToHex,
    commaNumber,
    localeIncludes,
    normalizeString,
    replaceBioSymbols,
    removeEmojis
};
