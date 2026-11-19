export type Theme = 'light' | 'dark';

const styleTag = '<style id="email-colors">';
export const emailDarkStyles = `${styleTag}
    @media (prefers-color-scheme: dark) {`;

export function emailWithPreviewTheme(html: string, theme: Theme) {
  // Only the sandboxed dashboard preview overrides the recipient's color preference.
  const media = theme === 'dark' ? 'all' : 'not all';
  return html.replace(emailDarkStyles, `${styleTag}
    :root { color-scheme: ${theme} !important; }
    @media ${media} {`);
}
