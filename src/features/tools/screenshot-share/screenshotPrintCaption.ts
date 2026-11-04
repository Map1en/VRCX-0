import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-400-italic.css';
import '@fontsource/noto-sans/latin-500.css';
import { timeToText } from '@/lib/dateTime';
import type { ScreenshotShareFacts } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import type { ScreenshotPrintOptions } from '@/state/screenshotPrintOptionsStore';

export const PRINT_CAPTION = {
    width: 2048,
    height: 291,
    left: 64,
    right: 1984,
    minGap: 64,
    iconHeight: 30,
    textColor: '#000000',
    mutedColor: '#767676',
    iconColor: '#565656',
    dividerColor: '#d6d6d6'
} as const;

const FAMILY = `"Noto Sans", "Noto Sans JP", "Noto Sans CJK JP", "Noto Sans SC", "Noto Sans CJK SC", "Noto Sans TC", "Noto Sans KR", "Yu Gothic UI", "Microsoft YaHei UI", "Malgun Gothic", "Hiragino Sans", "PingFang SC", sans-serif`;

export const PRINT_FONTS = {
    caption: `35px ${FAMILY}`,
    extra: `30px ${FAMILY}`,
    classicNote: `italic 72px ${FAMILY}`,
    modernNote: `italic 56px ${FAMILY}`,
    title: `500 44px ${FAMILY}`,
    name: `500 34px ${FAMILY}`,
    meta: `28px ${FAMILY}`
} as const;

export type PrintFont = keyof typeof PRINT_FONTS;

const ELLIPSIS = '…';
const MIN_TRUNCATED_WIDTH = 120;
const MAX_PEOPLE_NAMES = 3;

type PrintIcon = 'user' | 'calendar' | 'pin';

const ICON_WIDTH: Record<PrintIcon, number> = {
    user: 17,
    calendar: 30,
    pin: 18
};

export type PrintOp =
    | {
          kind: 'text';
          text: string;
          x: number;
          y: number;
          font: PrintFont;
          color: string;
          align?: 'left' | 'center';
      }
    | { kind: 'icon'; icon: PrintIcon; x: number; y: number; width: number }
    | { kind: 'line'; x: number; y0: number; y1: number };

export type MeasureText = (text: string, font: PrintFont) => number;

export type PrintText = {
    capturedBy: string;
    byAuthor(author: string): string;
    withNames(names: string[], total: number): string;
    withCount(count: number): string;
    inRoom(count: number): string;
    stayed(ms: number): string;
};

export type PrintContent = {
    note: string;
    people: string[] | null;
};

const IMAGE_KEY = 'view.tools.screenshot_print.image';

export function screenshotPrintText(): PrintText {
    const t = (key: string, values?: Record<string, unknown>) =>
        i18n.t(`${IMAGE_KEY}.${key}`, values);
    return {
        capturedBy: t('captured_by'),
        byAuthor: (author) => t('by_author', { author }),
        withNames: (names, total) => {
            const joined = names.join(t('name_separator'));
            return total > names.length
                ? t('with_names_more', {
                      names: joined,
                      count: total - names.length,
                      total
                  })
                : t('with_names', { names: joined });
        },
        withCount: (count) => t('with_count', { count }),
        inRoom: (count) => t('in_room', { count }),
        stayed: (ms) => t('stayed', { duration: timeToText(ms) })
    };
}

type Piece =
    | { kind: 'text'; text: string; truncatable?: boolean }
    | { kind: 'icon'; icon: PrintIcon }
    | { kind: 'gap'; width: number };

const pad = (value: number) => String(value).padStart(2, '0');

function officialDate(ms: number): string {
    const date = new Date(ms);
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

function watermarkDate(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function peopleText(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent,
    text: PrintText
): string {
    if (options.people === 'off' || !fact.people.length) {
        return '';
    }
    if (options.people === 'count') {
        return text.withCount(fact.people.length);
    }
    const selected = content.people;
    const names = selected
        ? fact.people.filter((name) => selected.includes(name))
        : fact.people;
    return names.length
        ? text.withNames(names.slice(0, MAX_PEOPLE_NAMES), names.length)
        : '';
}

function extras(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent,
    text: PrintText
): { people: string; room: string; stay: string } {
    return {
        people: peopleText(fact, options, content, text),
        room:
            options.playerCount && fact.playerCount
                ? text.inRoom(fact.playerCount)
                : '',
        stay: options.stay && fact.stay ? text.stayed(fact.stay.ms) : ''
    };
}

const joinDot = (parts: string[]) => parts.filter(Boolean).join(' · ');

function graphemes(text: string): string[] {
    return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
            text
        ),
        (part) => part.segment
    );
}

function truncateToWidth(
    text: string,
    maxWidth: number,
    width: (value: string) => number
): string {
    if (width(text) <= maxWidth) {
        return text;
    }
    const parts = graphemes(text);
    let low = 0;
    let high = parts.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (width(parts.slice(0, mid).join('') + ELLIPSIS) <= maxWidth) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return parts.slice(0, low).join('') + ELLIPSIS;
}

function pieceWidth(piece: Piece, measure: MeasureText, font: PrintFont) {
    switch (piece.kind) {
        case 'text':
            return measure(piece.text, font);
        case 'icon':
            return ICON_WIDTH[piece.icon];
        case 'gap':
            return piece.width;
    }
}

function rowWidth(pieces: Piece[], measure: MeasureText, font: PrintFont) {
    return pieces.reduce(
        (sum, piece) => sum + pieceWidth(piece, measure, font),
        0
    );
}

function shrinkRows(
    rows: Piece[][],
    budget: number,
    measure: MeasureText,
    font: PrintFont
): void {
    for (const row of [...rows].reverse()) {
        for (let index = row.length - 1; index >= 0; index -= 1) {
            const total = rows.reduce(
                (sum, current) => sum + rowWidth(current, measure, font),
                0
            );
            const overflow = total - budget;
            const piece = row[index];
            if (overflow <= 0) {
                return;
            }
            if (piece.kind !== 'text' || !piece.truncatable) {
                continue;
            }
            const target = Math.max(
                measure(piece.text, font) - overflow,
                MIN_TRUNCATED_WIDTH
            );
            row[index] = {
                ...piece,
                text: truncateToWidth(piece.text, target, (value) =>
                    measure(value, font)
                )
            };
        }
    }
}

function placeRow(
    pieces: Piece[],
    startX: number,
    y: number,
    font: PrintFont,
    measure: MeasureText
): PrintOp[] {
    const ops: PrintOp[] = [];
    let x = startX;
    for (const piece of pieces) {
        const width = pieceWidth(piece, measure, font);
        if (piece.kind === 'text') {
            ops.push({
                kind: 'text',
                text: piece.text,
                x,
                y,
                font,
                color: PRINT_CAPTION.textColor
            });
        } else if (piece.kind === 'icon') {
            ops.push({ kind: 'icon', icon: piece.icon, x, y, width });
        }
        x += width;
    }
    return ops;
}

function noteOps(
    note: string,
    y: number,
    font: PrintFont,
    measure: MeasureText
): PrintOp[] {
    const text = truncateToWidth(
        note.trim(),
        PRINT_CAPTION.right - PRINT_CAPTION.left,
        (value) => measure(value, font)
    );
    return text
        ? [
              {
                  kind: 'text',
                  text,
                  x: PRINT_CAPTION.width / 2,
                  y,
                  font,
                  color: PRINT_CAPTION.textColor,
                  align: 'center'
              }
          ]
        : [];
}

function layoutClassic(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent,
    text: PrintText,
    measure: MeasureText
): PrintOp[] {
    const baseline = 270;
    const left: Piece[] = fact.authorName
        ? [
              { kind: 'text', text: text.capturedBy },
              { kind: 'gap', width: 20 },
              { kind: 'icon', icon: 'user' },
              { kind: 'gap', width: 13 },
              { kind: 'text', text: fact.authorName, truncatable: true }
          ]
        : [];
    const right: Piece[] = [];
    if (fact.capturedAtMs > 0) {
        right.push(
            { kind: 'icon', icon: 'calendar' },
            { kind: 'gap', width: 6 },
            { kind: 'text', text: officialDate(fact.capturedAtMs) }
        );
    }
    if (fact.worldName) {
        if (right.length) {
            right.push({ kind: 'gap', width: 11 });
        }
        right.push(
            { kind: 'icon', icon: 'pin' },
            { kind: 'gap', width: 11 },
            { kind: 'text', text: fact.worldName, truncatable: true }
        );
        if (fact.worldAuthorName) {
            right.push(
                { kind: 'text', text: ' ' },
                {
                    kind: 'text',
                    text: text.byAuthor(fact.worldAuthorName),
                    truncatable: true
                }
            );
        }
    }
    const budget =
        PRINT_CAPTION.right - PRINT_CAPTION.left - PRINT_CAPTION.minGap;
    shrinkRows([left, right], budget, measure, 'caption');

    const info = extras(fact, options, content, text);
    const extraRight = joinDot([info.room, info.stay]);
    const extraY = 214;
    const ops: PrintOp[] = [
        ...noteOps(content.note, 138, 'classicNote', measure),
        ...placeRow(left, PRINT_CAPTION.left, baseline, 'caption', measure),
        ...placeRow(
            right,
            PRINT_CAPTION.right - rowWidth(right, measure, 'caption'),
            baseline,
            'caption',
            measure
        )
    ];
    const rightWidth = extraRight ? measure(extraRight, 'extra') : 0;
    if (info.people) {
        ops.push({
            kind: 'text',
            text: truncateToWidth(info.people, budget - rightWidth, (value) =>
                measure(value, 'extra')
            ),
            x: PRINT_CAPTION.left,
            y: extraY,
            font: 'extra',
            color: PRINT_CAPTION.mutedColor
        });
    }
    if (extraRight) {
        ops.push({
            kind: 'text',
            text: extraRight,
            x: PRINT_CAPTION.right - rightWidth,
            y: extraY,
            font: 'extra',
            color: PRINT_CAPTION.mutedColor
        });
    }
    return ops;
}

function layoutWatermark(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent,
    text: PrintText,
    measure: MeasureText
): PrintOp[] {
    const info = extras(fact, options, content, text);
    const date = fact.capturedAtMs > 0 ? watermarkDate(fact.capturedAtMs) : '';
    const title = fact.worldName || date;
    const meta = joinDot([
        fact.worldName && fact.worldAuthorName
            ? text.byAuthor(fact.worldAuthorName)
            : '',
        fact.worldName ? date : '',
        info.stay
    ]);
    const name = fact.authorName ?? '';
    const company = joinDot([info.people, info.room]);
    const hasNote = Boolean(content.note.trim());
    const titleY = hasNote ? 196 : 150;
    const metaY = titleY + 50;
    const ops: PrintOp[] = hasNote
        ? noteOps(content.note, 84, 'modernNote', measure)
        : [];

    const rightWidth = Math.max(
        name ? measure(name, 'name') : 0,
        company ? measure(company, 'meta') : 0
    );
    const dividerGap = rightWidth ? 40 : 0;
    const leftBudget =
        PRINT_CAPTION.right - PRINT_CAPTION.left - rightWidth - dividerGap * 2;
    if (title) {
        ops.push({
            kind: 'text',
            text: truncateToWidth(title, leftBudget, (value) =>
                measure(value, 'title')
            ),
            x: PRINT_CAPTION.left,
            y: titleY,
            font: 'title',
            color: PRINT_CAPTION.textColor
        });
    }
    if (meta) {
        ops.push({
            kind: 'text',
            text: truncateToWidth(meta, leftBudget, (value) =>
                measure(value, 'meta')
            ),
            x: PRINT_CAPTION.left,
            y: metaY,
            font: 'meta',
            color: PRINT_CAPTION.mutedColor
        });
    }
    if (rightWidth) {
        ops.push({
            kind: 'line',
            x: PRINT_CAPTION.right - rightWidth - dividerGap,
            y0: titleY - 38,
            y1: metaY + 10
        });
        if (name) {
            ops.push({
                kind: 'text',
                text: name,
                x: PRINT_CAPTION.right - measure(name, 'name'),
                y: titleY,
                font: 'name',
                color: PRINT_CAPTION.textColor
            });
        }
        if (company) {
            ops.push({
                kind: 'text',
                text: company,
                x: PRINT_CAPTION.right - measure(company, 'meta'),
                y: metaY,
                font: 'meta',
                color: PRINT_CAPTION.mutedColor
            });
        }
    }
    return ops;
}

export function layoutPrintCaption(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent,
    text: PrintText,
    measure: MeasureText
): PrintOp[] {
    return options.style === 'classic'
        ? layoutClassic(fact, options, content, text, measure)
        : layoutWatermark(fact, options, content, text, measure);
}

function drawIcon(
    ctx: CanvasRenderingContext2D,
    icon: PrintIcon,
    x: number,
    baseline: number,
    width: number
): void {
    const top = baseline - PRINT_CAPTION.iconHeight + 1;
    ctx.fillStyle = PRINT_CAPTION.iconColor;
    ctx.strokeStyle = PRINT_CAPTION.iconColor;
    if (icon === 'user') {
        ctx.beginPath();
        ctx.arc(x + width / 2, top + 7.5, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(x, top + 16, width, 14, [7, 7, 1, 1]);
        ctx.fill();
        return;
    }
    if (icon === 'calendar') {
        ctx.beginPath();
        ctx.roundRect(x, top + 3, width, 26, 3);
        ctx.fill();
        ctx.fillRect(x + 7, top, 3.5, 7);
        ctx.fillRect(x + width - 10.5, top, 3.5, 7);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, top + 10, width, 1.5);
        return;
    }
    const centerX = x + width / 2;
    const centerY = top + 9;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7.5, Math.PI * 0.82, Math.PI * 0.18);
    ctx.lineTo(centerX, top + PRINT_CAPTION.iconHeight - 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2.8, 0, Math.PI * 2);
    ctx.fill();
}

export async function renderScreenshotPrintCaption(
    fact: ScreenshotShareFacts,
    options: ScreenshotPrintOptions,
    content: PrintContent = { note: '', people: null }
): Promise<string> {
    const text = screenshotPrintText();
    const sample = [
        fact.worldName,
        fact.authorName,
        content.note,
        text.withCount(fact.people.length),
        '0123456789'
    ]
        .filter(Boolean)
        .join(' ');
    await Promise.all(
        Object.values(PRINT_FONTS).map((font) =>
            document.fonts.load(font, sample)
        )
    );
    const canvas = document.createElement('canvas');
    canvas.width = PRINT_CAPTION.width;
    canvas.height = PRINT_CAPTION.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas 2D is unavailable.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'alphabetic';
    const measure: MeasureText = (text, font) => {
        ctx.font = PRINT_FONTS[font];
        return ctx.measureText(text).width;
    };
    for (const op of layoutPrintCaption(
        fact,
        options,
        content,
        text,
        measure
    )) {
        if (op.kind === 'text') {
            ctx.font = PRINT_FONTS[op.font];
            ctx.fillStyle = op.color;
            ctx.textAlign = op.align ?? 'left';
            ctx.fillText(op.text, op.x, op.y);
        } else if (op.kind === 'icon') {
            drawIcon(ctx, op.icon, op.x, op.y, op.width);
        } else {
            ctx.fillStyle = PRINT_CAPTION.dividerColor;
            ctx.fillRect(op.x - 1, op.y0, 2, op.y1 - op.y0);
        }
    }
    return canvas
        .toDataURL('image/png')
        .replace(/^data:image\/png;base64,/, '');
}
