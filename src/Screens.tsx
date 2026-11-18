import { useState, type FormEvent } from 'react';
import type { Dashboard, EmailPreview, Page, SendRun, Settings as AppSettings, Word } from '../shared/model';
import { send, useAction, useResource } from './api';
import { Badge, Empty, formatDate, Notice, Pager, Result } from './components';

export function Overview() {
  const result = useResource<Dashboard>('/dashboard');
  const info = result.data;
  return <>
    <div className="screen-head"><div><h1>Overview</h1><p>Track the word queue, launch readiness, and subscribers.</p></div><a className="button primary" href="#words">Open word library <span aria-hidden="true">↗</span></a></div>
    <Result {...result} retry={result.refresh}/>
    {info && <>
      <div className="metrics">{[
        ['Total words', info.total], ['Drafts', info.draft], ['Approved and unused', info.approved],
        ['Rejected', info.rejected], ['Sent', info.sent], ['Active recipients', info.activeRecipients],
      ].map(([label, value]) => <div className="panel metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="overview-grid">
        <section className="panel readiness">
          <h2>Launch readiness</h2>
          <p>Build a year of approved, unused words.</p>
          <div className="progress-label"><strong>{info.approved}</strong><span> / {info.target} words</span></div>
          <progress aria-label="365-day launch readiness" value={Math.min(info.approved, info.target)} max={info.target}/>
          <p className="runway"><span aria-hidden="true">◷</span> {info.approved} {info.approved === 1 ? 'day' : 'days'} of ready inventory</p>
        </section>
        <section className="panel next-word">
          <div className="panel-head"><h2>Next in queue</h2>{info.next && <Badge status="approved"/>}</div>
          {info.next ? <div><h3 className="word-display">{info.next.term}</h3><p>{info.next.real_definition}</p><blockquote>“{info.next.parody_sentence}”</blockquote></div>
            : <Empty title="The queue is empty">Approve a draft to put a word in the queue.</Empty>}
          <a href="#approvals">Review drafts <span aria-hidden="true">→</span></a>
        </section>
      </div>
    </>}
  </>;
}

export function Preview() {
  const [word, setWord] = useState<Word>();
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [page, setPage] = useState(1);
  const [request, setRequest] = useState<string | null>(null);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const list = useResource<Page<Word>>('/words?' + new URLSearchParams({page: String(page), pageSize: '10', search: query}));
  const preview = useResource<EmailPreview>(request);
  function render(event: FormEvent) {
    event.preventDefault();
    if (!word) return;
    const path = '/email/preview?' + new URLSearchParams({wordId: word.id, subject});
    if (path === request) preview.refresh();
    else setRequest(path);
  }
  return <>
    <div className="screen-head"><div><h1>Email preview</h1><p>Review the layout and plain-text version of a selected word.</p></div><Badge status="preview only"/></div>
    <div className="preview-grid">
      <form className="panel padded" onSubmit={render}>
        <h2>Compose preview</h2>
        <label>Find a word<input type="search" maxLength={100} value={query} onChange={event => {setQuery(event.target.value); setPage(1);}}/></label>
        <Result {...list} retry={list.refresh}/>
        {list.data && <>
          {list.data.rows.length ? <fieldset className="word-picker"><legend>Choose a word</legend>
            {list.data.rows.map(item => <label className="checkbox" key={item.id}><input type="radio" name="word" checked={word?.id === item.id} onChange={() => setWord(item)}/>{item.term}</label>)}
          </fieldset> : <p>No matching words.</p>}
          {list.data.total > list.data.pageSize && <Pager result={list.data} setPage={setPage}/>}
        </>}
        <p>Selected word <strong>{word?.term ?? 'None'}</strong></p>
        <label>Subject<input maxLength={160} value={subject} placeholder="Use default subject" onChange={event => setSubject(event.target.value)}/></label>
        <button className="primary" disabled={!word}>Render preview</button>
      </form>
      <section className="panel padded">
        <Result {...preview} retry={preview.refresh}/>
        {preview.data ? <>
          <div className="panel-head"><div><span className="hint">Subject</span><h2>{preview.data.subject}</h2></div>
            <div className="actions"><button type="button" aria-pressed={mode === 'html'} onClick={() => setMode('html')}>HTML</button><button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Plain text</button></div>
          </div>
          {mode === 'html' ? <iframe title="HTML email preview" sandbox="" srcDoc={preview.data.html}/> : <pre>{preview.data.text}</pre>}
        </> : !request && <Empty title="No email rendered">Choose a word and render a preview.</Empty>}
      </section>
    </div>
  </>;
}

export function History() {
  const [page, setPage] = useState(1);
  const result = useResource<Page<SendRun>>('/history?page=' + page);
  return <>
    <div className="screen-head"><div><h1>Send history</h1><p>Recorded delivery runs by Eastern schedule date.</p></div></div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <div className="panel table-wrap">{result.data.rows.length ? <>
      <table><thead><tr><th>Schedule date</th><th>Word</th><th>Run status</th><th>Completed</th></tr></thead>
        <tbody>{result.data.rows.map(run => <tr key={run.id}><td>{run.schedule_date_et}</td><td>{run.term}</td><td><Badge status={run.status}/></td><td>{formatDate(run.completed_at)}</td></tr>)}</tbody>
      </table><Pager result={result.data} setPage={setPage}/>
    </> : <Empty title="No send runs">Email delivery is off in Phase 1.</Empty>}</div>}
  </>;
}

function SettingsForm({settings}: {settings: AppSettings}) {
  const {busy, notice, run} = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => { await send('/settings', 'PATCH', values); }, 'Preferences saved.');
  }
  return <form className="panel padded" onSubmit={submit}><h2>Schedule preferences</h2><p>These preferences are stored for future scheduling.</p>
    <fieldset disabled={busy}><label>Timezone<input name="timezone" defaultValue={settings.timezone} placeholder="America/New_York" required maxLength={100}/></label>
      <label>Preferred time<input name="send_time" type="time" defaultValue={settings.send_time} required/></label>
      <button className="primary">{busy ? 'Saving…' : 'Save preferences'}</button>
    </fieldset><Notice notice={notice}/>
  </form>;
}

export function Settings() {
  const result = useResource<AppSettings>('/settings');
  return <>
    <div className="screen-head"><div><h1>Settings</h1><p>Configure preferences for a future launch.</p></div></div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <div className="overview-grid">
      <SettingsForm settings={result.data}/>
      <section className="panel padded"><h2>Email delivery</h2>
        <dl className="details"><dt>Sending</dt><dd>OFF — Phase 1</dd><dt>Sender address</dt><dd>Not configured</dd><dt>Automated scheduling</dt><dd>Off</dd></dl>
      </section>
    </div>}
  </>;
}
