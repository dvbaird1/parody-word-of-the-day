import type { EmailPreview, Word } from '../shared/model';

export interface EmailProvider {
  preview(word: Word, subject?: string): EmailPreview;
}

const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => entities[char]);
export const previewProvider: EmailProvider = {
  preview(word, subject = `Word of the Day · ${word.term}`) {
    subject = subject.replace(/[\r\n]+/g, ' ');
    const details = [word.part_of_speech, word.pronunciation].filter(Boolean).join(' · ');
    const footer = 'Unsubscribe link placeholder. A public unsubscribe endpoint is required before live email.';
    return {
      subject,
      text: ['PARODY WORD OF THE DAY', word.term, details, `Real meaning: ${word.real_definition}`, `Deliberately wrong: “${word.parody_sentence}”`, footer].filter(Boolean).join('\n\n'),
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f6f2e9;color:#23251e;font:16px Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="20"><tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="28" style="max-width:560px;margin:auto;background:#fffdf7;border:1px solid #ded8c9"><tr><td><p style="color:#47583b;font-size:13px;font-weight:bold;letter-spacing:2px">WORD OF THE DAY</p><h1 style="font:48px Georgia;margin:12px 0;overflow-wrap:anywhere">${escapeHtml(word.term)}</h1><p>${escapeHtml(details)}</p><p><strong>Real meaning</strong><br>${escapeHtml(word.real_definition)}</p><blockquote style="margin:22px 0;padding:16px;background:#eef0e5;font:22px Georgia"><strong style="display:block;font: bold 13px Arial;margin-bottom:8px">DELIBERATELY WRONG</strong>“${escapeHtml(word.parody_sentence)}”</blockquote><p style="font-size:13px;color:#54574b">${footer}</p></td></tr></table></td></tr></table></body></html>`,
    };
  },
};
