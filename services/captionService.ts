import type { CaptionWord, CaptionStyle, CaptionPreset } from '../types';

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  preset: 'none',
  emphasisColor: '#fde047',
  enableEmoji: true,
};

export const CAPTION_PRESETS: { id: CaptionPreset; label: string; description: string }[] = [
  { id: 'none', label: 'Off', description: '자막 없음' },
  { id: 'clean', label: 'Clean', description: '깔끔한 흰색 + 그림자' },
  { id: 'bold', label: 'Bold', description: '굵은 외곽선 (가독성 최고)' },
  { id: 'hype', label: 'Hype', description: '강조 색상 + 큰 글자' },
];

const EMOJI_KEYWORDS: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /(돈|머니|수익|매출|연봉|부자|money|cash|rich|profit|salary)/i, emoji: '💰' },
  { pattern: /(사랑|love|heart|연애)/i, emoji: '❤️' },
  { pattern: /(불|fire|hot|뜨거운|핫한|화끈)/i, emoji: '🔥' },
  { pattern: /(별|스타|star|최고|짱)/i, emoji: '⭐' },
  { pattern: /(시간|타임|time|hour|초|분)/i, emoji: '⏰' },
  { pattern: /(아이디어|idea|생각|brain|뇌)/i, emoji: '💡' },
  { pattern: /(roket|로켓|rocket|launch|런칭|급상승|급성장)/i, emoji: '🚀' },
  { pattern: /(승리|win|성공|success|이기|우승)/i, emoji: '🏆' },
  { pattern: /(목표|target|goal|타겟)/i, emoji: '🎯' },
  { pattern: /(꿀팁|꿀|tip|honey|sweet)/i, emoji: '🍯' },
  { pattern: /(boom|폭발|대박|충격|shock)/i, emoji: '💥' },
  { pattern: /(미래|future|trend|tomorrow|내일)/i, emoji: '🔮' },
  { pattern: /(주의|warning|위험|danger|조심)/i, emoji: '⚠️' },
  { pattern: /(체크|check|확인|완료|done)/i, emoji: '✅' },
  { pattern: /(질문|question|왜|어떻게|무엇)/i, emoji: '❓' },
  { pattern: /(중요|important|핵심|key)/i, emoji: '🔑' },
  { pattern: /(놀라운|amazing|wow|대단|awesome)/i, emoji: '🤯' },
  { pattern: /(아름다운|beautiful|pretty|예쁜)/i, emoji: '✨' },
];

export function pickEmoji(word: string): string | undefined {
  for (const { pattern, emoji } of EMOJI_KEYWORDS) {
    if (pattern.test(word)) return emoji;
  }
  return undefined;
}

function syllableWeight(word: string): number {
  // Korean syllables (Hangul) ~ heavier per char; Latin uses character count.
  let weight = 0;
  for (const ch of word) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0xac00 && code <= 0xd7a3) weight += 1.4; // Hangul syllable
    else if (/[a-zA-Z]/.test(ch)) weight += 0.6;
    else if (/[0-9]/.test(ch)) weight += 0.7;
    else if (/[.,!?;:]/.test(ch)) weight += 0.2;
    else weight += 1;
  }
  return Math.max(1, weight);
}

export function alignWordsToDuration(text: string, durationSec: number, withEmoji: boolean = true): CaptionWord[] {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const totalMs = Math.max(500, Math.round(durationSec * 1000));
  const weights = tokens.map(syllableWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return tokens.map((t, i) => {
    const dur = (weights[i] / totalWeight) * totalMs;
    const startMs = Math.round(cursor);
    cursor += dur;
    const endMs = Math.round(cursor);
    return {
      text: t,
      startMs,
      endMs,
      emoji: withEmoji ? pickEmoji(t) : undefined,
    };
  });
}

interface PresetVisuals {
  fontWeight: number;
  fontSizeRatio: number; // relative to canvas height
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  highlightStyle: 'fill' | 'underline' | 'box';
  upperCase: boolean;
  emojiSizeRatio: number;
}

function getPresetVisuals(preset: CaptionPreset): PresetVisuals {
  switch (preset) {
    case 'clean':
      return {
        fontWeight: 700,
        fontSizeRatio: 0.060,
        textColor: '#ffffff',
        strokeColor: 'rgba(0,0,0,0.85)',
        strokeWidth: 4,
        shadow: true,
        highlightStyle: 'fill',
        upperCase: false,
        emojiSizeRatio: 0.075,
      };
    case 'bold':
      return {
        fontWeight: 900,
        fontSizeRatio: 0.075,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 10,
        shadow: false,
        highlightStyle: 'fill',
        upperCase: true,
        emojiSizeRatio: 0.090,
      };
    case 'hype':
      return {
        fontWeight: 900,
        fontSizeRatio: 0.085,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 8,
        shadow: true,
        highlightStyle: 'box',
        upperCase: true,
        emojiSizeRatio: 0.110,
      };
    case 'none':
    default:
      return {
        fontWeight: 700,
        fontSizeRatio: 0.06,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 4,
        shadow: true,
        highlightStyle: 'fill',
        upperCase: false,
        emojiSizeRatio: 0.07,
      };
  }
}

export interface RenderCaptionFrameOptions {
  width: number;
  height: number;
  style: CaptionStyle;
  windowSize?: number; // number of words shown around active word
}

/**
 * Render a single caption keyframe (one PNG showing the caption state when one specific word is active).
 * Window of `windowSize` words is shown horizontally; the active word is highlighted.
 */
export async function renderCaptionFrame(
  words: CaptionWord[],
  activeIdx: number,
  opts: RenderCaptionFrameOptions
): Promise<Blob> {
  const { width, height, style } = opts;
  const visuals = getPresetVisuals(style.preset);
  const windowSize = opts.windowSize ?? (style.preset === 'hype' ? 1 : style.preset === 'bold' ? 2 : 3);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);

  // Build window of words around active word
  const half = Math.floor(windowSize / 2);
  let start = Math.max(0, activeIdx - half);
  let end = Math.min(words.length, start + windowSize);
  start = Math.max(0, end - windowSize);
  const visible = words.slice(start, end);
  const activeLocal = activeIdx - start;

  const fontSize = Math.round(height * visuals.fontSizeRatio);
  const emojiSize = Math.round(height * visuals.emojiSizeRatio);
  const fontFamily = `"Noto Sans KR", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`;
  const baseFont = `${visuals.fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.font = baseFont;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const renderText = (w: CaptionWord) => visuals.upperCase ? w.text.toUpperCase() : w.text;

  // Measure widths
  const wordWidths = visible.map(w => ctx.measureText(renderText(w)).width);
  const gap = Math.round(fontSize * 0.4);

  // Active word emoji (only show emoji for active word to avoid clutter)
  const activeWord = visible[activeLocal];
  const emoji = (style.enableEmoji && activeWord?.emoji) ? activeWord.emoji : '';
  let emojiWidth = 0;
  if (emoji) {
    ctx.font = `${emojiSize}px ${fontFamily}`;
    emojiWidth = ctx.measureText(emoji).width + gap;
  }

  const totalWidth = wordWidths.reduce((a, b) => a + b, 0) + gap * (visible.length - 1) + emojiWidth;
  const maxWidth = width * 0.92;
  const scale = totalWidth > maxWidth ? maxWidth / totalWidth : 1;
  const finalFontSize = Math.round(fontSize * scale);
  const finalEmojiSize = Math.round(emojiSize * scale);

  // Re-measure with scaled font
  ctx.font = `${visuals.fontWeight} ${finalFontSize}px ${fontFamily}`;
  const finalWordWidths = visible.map(w => ctx.measureText(renderText(w)).width);
  let finalEmojiWidth = 0;
  if (emoji) {
    ctx.font = `${finalEmojiSize}px ${fontFamily}`;
    finalEmojiWidth = ctx.measureText(emoji).width + gap;
  }
  const finalTotalWidth = finalWordWidths.reduce((a, b) => a + b, 0) + gap * (visible.length - 1) + finalEmojiWidth;

  // Position: bottom-third area
  const baseY = Math.round(height * 0.78);
  let cursorX = Math.round((width - finalTotalWidth) / 2);

  // Draw highlight box behind the active word for "hype" preset
  if (visuals.highlightStyle === 'box') {
    let bx = cursorX;
    for (let i = 0; i < visible.length; i++) {
      if (i === activeLocal) {
        const padX = Math.round(finalFontSize * 0.25);
        const padY = Math.round(finalFontSize * 0.18);
        const boxW = finalWordWidths[i] + padX * 2;
        const boxH = finalFontSize + padY * 2;
        const boxX = bx - padX;
        const boxY = baseY - boxH / 2;
        ctx.fillStyle = style.emphasisColor;
        ctx.beginPath();
        const r = Math.round(finalFontSize * 0.18);
        ctx.roundRect(boxX, boxY, boxW, boxH, r);
        ctx.fill();
      }
      bx += finalWordWidths[i] + gap;
    }
  }

  ctx.font = `${visuals.fontWeight} ${finalFontSize}px ${fontFamily}`;
  for (let i = 0; i < visible.length; i++) {
    const w = visible[i];
    const text = renderText(w);
    const isActive = i === activeLocal;

    // Stroke
    if (visuals.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = visuals.strokeColor;
      ctx.lineWidth = visuals.strokeWidth;
      if (visuals.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = Math.round(finalFontSize * 0.15);
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = Math.round(finalFontSize * 0.04);
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
      ctx.strokeText(text, cursorX, baseY);
    }

    // Fill
    if (isActive) {
      if (visuals.highlightStyle === 'box') {
        ctx.fillStyle = '#0b0f1a';
      } else {
        ctx.fillStyle = style.emphasisColor;
      }
    } else {
      ctx.fillStyle = visuals.textColor;
    }
    ctx.shadowColor = visuals.shadow ? 'rgba(0,0,0,0.55)' : 'transparent';
    ctx.shadowBlur = visuals.shadow ? Math.round(finalFontSize * 0.15) : 0;
    ctx.shadowOffsetY = visuals.shadow ? Math.round(finalFontSize * 0.04) : 0;
    ctx.fillText(text, cursorX, baseY);

    // Underline highlight (clean preset)
    if (isActive && visuals.highlightStyle === 'underline') {
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = style.emphasisColor;
      const uy = baseY + Math.round(finalFontSize * 0.45);
      const uh = Math.max(3, Math.round(finalFontSize * 0.07));
      ctx.fillRect(cursorX, uy, finalWordWidths[i], uh);
    }

    cursorX += finalWordWidths[i] + gap;
  }

  // Draw emoji to the right (active word)
  if (emoji) {
    ctx.font = `${finalEmojiSize}px ${fontFamily}`;
    ctx.shadowColor = visuals.shadow ? 'rgba(0,0,0,0.55)' : 'transparent';
    ctx.shadowBlur = visuals.shadow ? Math.round(finalEmojiSize * 0.15) : 0;
    ctx.shadowOffsetY = visuals.shadow ? Math.round(finalEmojiSize * 0.05) : 0;
    ctx.fillText(emoji, cursorX, baseY);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Caption frame toBlob failed')), 'image/png');
  });
}
