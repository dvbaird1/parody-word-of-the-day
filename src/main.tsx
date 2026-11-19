import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { History, Overview, Preview, Settings } from './Screens';
import { Words } from './Words';
import { Recipients } from './Recipients';
import type { Theme } from '../shared/email-theme';
import './style.css';

const sections = {
  overview: {label: 'Overview', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', Component: Overview},
  words: {label: 'Word library', icon: 'M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 17h16 M8 7h7 M8 11h5', Component: Words},
  approvals: {label: 'Approvals', icon: 'M9 5h6 M8 4H5v17h14V4h-3 M9 13l2 2 4-4', Component: () => <Words approvals/>},
  recipients: {label: 'Recipients', icon: 'M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M21 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8', Component: Recipients},
  preview: {label: 'Email preview', icon: 'M3 5h18v14H3z M3 6l9 7 9-7', Component: Preview},
  history: {label: 'Send history', icon: 'M3 12a9 9 0 1 1 2 6 M3 5v7h7 M12 7v5l3 2', Component: History},
  settings: {label: 'Settings', icon: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M15 10v4 M10 16v4', Component: Settings},
};

type Section = keyof typeof sections;
function currentSection(): Section {
  const key = location.hash.slice(1);
  return Object.hasOwn(sections, key) ? key as Section : 'overview';
}

const themeKey = 'word-of-the-day.theme';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(themeKey);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    return null;
  }
}

function useTheme() {
  const [preference, setPreference] = useState(savedTheme);
  const [systemDark, setSystemDark] = useState(systemTheme.matches);
  const theme = preference ?? (systemDark ? 'dark' : 'light');
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (preference !== null) return;
    const track = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    systemTheme.addEventListener('change', track);
    setSystemDark(systemTheme.matches);
    return () => systemTheme.removeEventListener('change', track);
  }, [preference]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next);
    try {
      localStorage.setItem(themeKey, next);
    } catch {
      // The switch still works for the current visit when storage is blocked.
    }
  }
  return {theme, toggleTheme};
}

function App() {
  const [section, setSection] = useState(currentSection);
  const {theme, toggleTheme} = useTheme();
  useEffect(() => {
    const navigate = () => { setSection(currentSection()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const {Component, label} = sections[section];
  useEffect(() => { document.title = `${label} · Parody Word of the Day`; }, [label]);
  return <div className="shell">
    <a className="skip" href="#main-content" onClick={event => {
      event.preventDefault(); document.getElementById('main-content')?.focus();
    }}>Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark" aria-hidden="true">Aa</span><span>Parody Word<br/> of the Day</span></a>
      <nav aria-label="Dashboard">{Object.entries(sections).map(([key, value]) => <a key={key} href={'#' + key} aria-current={key === section ? 'page' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={value.icon}/></svg>{value.label}
      </a>)}</nav>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <span>Admin dashboard</span>
        <div className="topbar-actions">
          <span className="off"><span aria-hidden="true"/>Sending OFF — Phase 1</span>
          <button type="button" className="theme-switch" role="switch" aria-checked={theme === 'dark'} onClick={toggleTheme}>
            <span className="theme-track" aria-hidden="true"/> Dark mode
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}><Component key={section} theme={theme}/></main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
