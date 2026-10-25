import * as path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

// Bar charts as PNG images for embeds (Discord can't show SVG). Drawn as SVG and rendered with
// resvg, using the Inter font shipped in assets/fonts, so it looks the same on every system.

const FONT_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');
const FONTS = [path.join(FONT_DIR, 'Inter_400Regular.ttf'), path.join(FONT_DIR, 'Inter_600SemiBold.ttf')];

const WIDTH = 1000;
const HEIGHT = 380;
const PAD = { top: 84, right: 28, bottom: 52, left: 64 };
const COLORS = { background: '#2b2d31', grid: '#3f4147', text: '#f2f3f5', muted: '#b5bac1' };

export interface ChartPoint {
  label: string;
  value: number;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

// A round number just above `max` that splits into 4 even steps (4, 8, 20, 40, 100, …).
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].find(n => n * magnitude >= step)! * magnitude;
  return nice * 4;
}

export function renderBarChart(points: ChartPoint[], options: { title: string; subtitle: string; color: string }): Buffer {
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...points.map(p => p.value)));
  const slot = plotWidth / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(56, slot * 0.72));
  const busiest = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

  const parts: string[] = [
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="${COLORS.background}"/>`,
    `<text x="${PAD.left - 36}" y="44" font-size="26" font-weight="600" fill="${COLORS.text}">${escapeXml(options.title)}</text>`,
    `<text x="${WIDTH - PAD.right}" y="44" font-size="18" fill="${COLORS.muted}" text-anchor="end">${escapeXml(options.subtitle)}</text>`
  ];

  // Grid lines with their values.
  for (let i = 0; i <= 4; i++) {
    const value = (max / 4) * i;
    const lineY = y(value);
    parts.push(`<line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${lineY}" y2="${lineY}" stroke="${COLORS.grid}" stroke-width="1.5"${i === 0 ? '' : ' stroke-dasharray="6 6"'}/>`);
    parts.push(`<text x="${PAD.left - 12}" y="${lineY + 6}" font-size="16" fill="${COLORS.muted}" text-anchor="end">${Number(value.toFixed(1)).toLocaleString('en-US')}</text>`);
  }

  // At most ~8 labels under the bars, always including the last one.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  points.forEach((point, i) => {
    const centerX = PAD.left + slot * i + slot / 2;
    const top = y(point.value);
    const height = PAD.top + plotHeight - top;
    if (point.value > 0) {
      const radius = Math.min(6, barWidth / 3, height / 2);
      parts.push(`<rect x="${centerX - barWidth / 2}" y="${top}" width="${barWidth}" height="${height}" rx="${radius}" fill="${options.color}" opacity="${i === busiest ? 1 : 0.7}"/>`);
    }
    // Values on the bars when there is room for them.
    if (point.value > 0 && (points.length <= 16 || i === busiest)) {
      parts.push(`<text x="${centerX}" y="${top - 8}" font-size="15" font-weight="600" fill="${COLORS.text}" text-anchor="middle">${point.value}</text>`);
    }
    const isLast = i === points.length - 1;
    if (i % labelEvery === 0 || isLast) {
      // Skip a label that would collide with the last one.
      if (!isLast && points.length - 1 - i < labelEvery) return;
      parts.push(`<text x="${centerX}" y="${HEIGHT - PAD.bottom + 28}" font-size="16" fill="${COLORS.muted}" text-anchor="middle">${escapeXml(point.label)}</text>`);
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Inter">${parts.join('')}</svg>`;
  return new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng();
}
