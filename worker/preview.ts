import { emailDarkStyles } from '../shared/email-theme';
import type { EmailPreview, Word } from '../shared/model';

export interface EmailProvider {
  preview(word: Word, subject?: string, unsubscribe?: URL): EmailPreview;
}

const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => entities[char]);
export const previewProvider: EmailProvider = {
  preview(word, subject = `Word of the Day · ${word.term}`, unsubscribe) {
    subject = subject.replace(/[\r\n]+/g, ' ');
    const details = [word.part_of_speech, word.pronunciation].filter(Boolean).join(' · ');
    const footer = 'A personal unsubscribe link will appear in the delivered email.';
    const unsubscribeText = unsubscribe ? `Unsubscribe: ${unsubscribe.href}` : footer;
    const unsubscribeHtml = unsubscribe
      ? `<a class="email-footer" style="color:inherit" href="${escapeHtml(unsubscribe.href)}">Unsubscribe</a>`
      : footer;
    return {
      subject,
      text: ['PARODY WORD OF THE DAY', word.term, details, `Real meaning: ${word.real_definition}`, `Deliberately wrong: “${word.parody_sentence}”`, unsubscribeText].filter(Boolean).join('\n\n'),
      html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  ${emailDarkStyles}
      .email-page { background-color: #171b17 !important; color: #f0f1e8 !important; }
      .email-card { background-color: #222922 !important; border-color: #4a5749 !important; color: #f0f1e8 !important; }
      .email-example { background-color: #303d30 !important; color: #f0f1e8 !important; }
      .email-brand { color: #c6dfa9 !important; }
      .email-footer { color: #c3cbbd !important; }
    }
    [data-ogsc] .email-page, [data-ogsb] .email-page { background-color: #171b17 !important; color: #f0f1e8 !important; }
    [data-ogsc] .email-card, [data-ogsb] .email-card { background-color: #222922 !important; border-color: #4a5749 !important; color: #f0f1e8 !important; }
    [data-ogsc] .email-example, [data-ogsb] .email-example { background-color: #303d30 !important; color: #f0f1e8 !important; }
    [data-ogsc] .email-brand { color: #c6dfa9 !important; }
    [data-ogsc] .email-footer { color: #c3cbbd !important; }
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
  </style>
</head>
<body class="email-page" style="margin:0;background-color:#f6f2e9;color:#23251e;font:16px Arial,sans-serif">
  <table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="20" bgcolor="#f6f2e9" style="background-color:#f6f2e9;color:#23251e">
    <tr><td>
      <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="28" bgcolor="#fffdf7" style="max-width:560px;margin:auto;background-color:#fffdf7;border:1px solid #ded8c9;color:#23251e">
        <tr><td>
          <p class="email-brand" style="color:#47583b;font-size:13px;font-weight:bold;letter-spacing:2px">WORD OF THE DAY</p>
          <h1 style="font:48px Georgia;margin:12px 0;overflow-wrap:anywhere">${escapeHtml(word.term)}</h1>
          <p>${escapeHtml(details)}</p>
          <p><strong>Real meaning</strong><br>${escapeHtml(word.real_definition)}</p>
          <blockquote class="email-example" style="margin:22px 0;padding:16px;background-color:#eef0e5;color:#23251e;font:22px Georgia">
            <strong style="display:block;font:bold 13px Arial;margin-bottom:8px">DELIBERATELY WRONG</strong>“${escapeHtml(word.parody_sentence)}”
          </blockquote>
          <p class="email-footer" style="font-size:13px;color:#54574b">${unsubscribeHtml}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    };
  },
};
