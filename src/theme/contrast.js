// Filled buttons put a label on the accent colour (and delete buttons on the alert colour). Tavern themes can
// derive a dark accent on a dark page, so the label, sometimes the whole button, disappears. These helpers work
// on plain { r, g, b } colours; the theme controller measures the real colours and applies the result.

const linear = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
export function contrastRatio(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}
export const mixColors = (a, b, share) => ({ r: Math.round(a.r + (b.r - a.r) * share), g: Math.round(a.g + (b.g - a.g) * share), b: Math.round(a.b + (b.b - a.b) * share) });
export const toCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;

// Computed colours come as rgb()/rgba(), or as color(srgb 0-1 values) when they are the result of color-mix().
export function parseCssColor(text) {
    const value = String(text || '').trim();
    const srgb = /^color\(srgb\s+([^)]+)\)$/i.exec(value);
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
    const parts = (srgb || rgb)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (!parts || parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null;
    const scale = srgb ? 255 : 1;
    return { r: Math.round(parts[0] * scale), g: Math.round(parts[1] * scale), b: Math.round(parts[2] * scale) };
}

const white = { r: 255, g: 255, b: 255 }, dark = { r: 28, g: 26, b: 23 };
// Whichever of white or near-black reads better on the fill.
export const labelOn = fill => contrastRatio(fill, white) >= contrastRatio(fill, dark) ? white : dark;

// A button should stand out from the page (3:1 is the usual bar for controls). Move the accent toward the text
// colour in steps until it does; null when it already does or cannot be helped.
export function liftAccent(accent, paper, ink, minimum = 3) {
    if (contrastRatio(accent, paper) >= minimum) return null;
    for (const share of [0.25, 0.4, 0.55, 0.7, 0.85]) {
        const lifted = mixColors(accent, ink, share);
        if (contrastRatio(lifted, paper) >= minimum) return lifted;
    }
    return mixColors(accent, ink, 0.85);
}
