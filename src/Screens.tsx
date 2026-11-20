import { emailWithPreviewTheme, type Theme } from '../shared/email-theme';
import { useState, type FormEvent } from 'react';
import type { Dashboard, EmailPreview, EmailTest, Page, Recipient, SendRun, Settings as AppSettings, Word } from '../shared/model';
import { send, useAction, useResource } from './api';
import { Badge, Dialog, Empty, formatDate, Notice, Pager, Result } from './components';

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

function TestRecipientPicker({close, select}: {close: () => void; select: (email: string) => void}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({page: String(page), pageSize: '10', search});
  const result = useResource<Page<Recipient>>('/recipients?' + params);

  return <Dialog title="Choose a recipient" close={close}>
    <label>Search recipient email
      <input type="search" value={search} maxLength={100} onChange={event => {
        setSearch(event.target.value);
        setPage(1);
      }}/>
    </label>
    <Result {...result} retry={result.refresh}/>
    {result.data && <>
      {result.data.rows.length ? <ul className="test-recipient-list">
        {result.data.rows.map(recipient => <li key={recipient.id}>
          <button type="button" disabled={Boolean(recipient.unsubscribed_at) ||
            (recipient.status !== 'active' && recipient.status !== 'inactive')}
            onClick={() => select(recipient.email)}>{recipient.email}</button>
          <Badge status={recipient.status}/>
        </li>)}
      </ul> : <p>No matching recipients.</p>}
      {result.data.total > result.data.pageSize && <Pager result={result.data} setPage={setPage}/>}
    </>}
  </Dialog>;
}

export function Preview({theme}: {theme: Theme}) {
  const [word, setWord] = useState<Word>();
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [page, setPage] = useState(1);
  const [request, setRequest] = useState<string | null>(null);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const list = useResource<Page<Word>>('/words?' + new URLSearchParams({page: String(page), pageSize: '10', search: query}));
  const preview = useResource<EmailPreview>(request);
  const test = useResource<{configured: boolean}>('/email/test');
  const testAction = useAction();
  const [testAddress, setTestAddress] = useState('');
  const [choosingRecipient, setChoosingRecipient] = useState(false);
  const [testResult, setTestResult] = useState<EmailTest>();
  const [attempt, setAttempt] = useState<{id: string; recipient: string; wordId: string}>();
  const address = testAddress.trim().toLowerCase();
  const testStatus = testResult?.recipient === address ? testResult.status : undefined;
  const retry = attempt?.recipient === address && attempt.wordId === word?.id ? attempt : undefined;
  const canSendTest = test.data?.configured && word?.status === 'approved' && address && testStatus !== 'unknown';

  function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSendTest || !word || testAction.busy) return;
    if (!retry && !window.confirm(`Send a test email for “${word.term}” to ${address}?`)) return;
    const current = retry ?? {id: crypto.randomUUID(), recipient: address, wordId: word.id};
    setAttempt(current);
    setTestResult(undefined);
    void testAction.run(async () => {
      const result = await send<EmailTest>('/email/test', 'POST', {
        wordId: current.wordId, recipient: current.recipient, attemptId: current.id,
      });
      setTestResult(result);
      if (result.status !== 'pending') setAttempt(undefined);
    });
  }
  function render(event: FormEvent) {
    event.preventDefault();
    if (!word) return;
    const path = '/email/preview?' + new URLSearchParams({wordId: word.id, subject});
    if (path === request) preview.refresh();
    else setRequest(path);
  }
  return <>
    <div className="screen-head"><div><h1>Email preview</h1><p>Review the layout and plain-text version of a selected word.</p></div></div>
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
          {mode === 'html' ? <iframe title="HTML email preview" sandbox="" srcDoc={emailWithPreviewTheme(preview.data.html, theme)}/> : <pre>{preview.data.text}</pre>}
        </> : !request && <Empty title="No email rendered">Choose a word and render a preview.</Empty>}
      </section>
    </div>
    <form className="panel padded test-send" aria-label="Graph test send" onSubmit={sendTest}>
      <h2>Send a test email</h2>
      <Result {...test} retry={test.refresh}/>
      <Notice notice={testAction.notice}/>
      {test.data && <>
        <label>Test recipient email
          <input type="email" autoComplete="email" maxLength={254} required value={testAddress}
            disabled={testAction.busy} onChange={event => setTestAddress(event.target.value)}/>
        </label>
        <button type="button" disabled={testAction.busy} onClick={() => setChoosingRecipient(true)}>Choose from recipients</button>
        {!test.data.configured && <p>Configure the Graph credential to enable the test.</p>}
        {test.data.configured && word?.status !== 'approved' && <p>Select an approved word to send a test.</p>}
        {testStatus === 'submitted_to_graph' && <p role="status">Microsoft Graph accepted the test. Check the inbox.</p>}
        {testStatus === 'failed' && <p role="status">The test was rejected or stopped before submission.</p>}
        {testStatus === 'pending' && <p role="status">The previous test is still pending.</p>}
        {testStatus === 'unknown' && <p role="status">The test outcome is uncertain. Check the inbox before taking further action.</p>}
        <button type="submit" className="primary" disabled={!canSendTest || testAction.busy}>
          {testAction.busy ? 'Sending test…' : testStatus === 'pending' ? 'Check test status' : retry ? 'Retry test' : 'Send test email'}
        </button>
      </>}
    </form>
    {choosingRecipient && <TestRecipientPicker close={() => setChoosingRecipient(false)} select={email => {
      setTestAddress(email);
      setChoosingRecipient(false);
    }}/>}
  </>;
}

export function History() {
  const [page, setPage] = useState(1);
  const result = useResource<Page<SendRun>>('/history?page=' + page);
  return <>
    <div className="screen-head"><div><h1>Send history</h1><p>Recorded delivery runs by Eastern schedule date.</p></div></div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <div className="panel table-wrap">{result.data.rows.length ? <>
      <table><thead><tr><th>Schedule date</th><th>Word</th><th>Run status</th><th>Results</th><th>Completed</th></tr></thead>
        <tbody>{result.data.rows.map(run => <tr key={run.id}><td>{run.schedule_date_et}</td><td>{run.term}</td><td><Badge status={run.status}/></td><td>
          {run.submitted} accepted by Graph
          {!!run.failed && <small>{run.failed} failed</small>}
          {!!run.unknown && <small>{run.unknown} uncertain</small>}
          {!!run.suppressed && <small>{run.suppressed} suppressed</small>}
        </td><td>{formatDate(run.completed_at)}</td></tr>)}</tbody>
      </table><Pager result={result.data} setPage={setPage}/>
    </> : <Empty title="No send runs">No scheduled emails have been submitted.</Empty>}</div>}
  </>;
}

function SettingsForm({settings}: {settings: AppSettings}) {
  const {busy, notice, run} = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => { await send('/settings', 'PATCH', values); }, 'Preferences saved.');
  }
  return <form className="panel padded" onSubmit={submit}><h2>Schedule preferences</h2>
    <fieldset disabled={busy}><label>Timezone<input name="timezone" defaultValue={settings.timezone} placeholder="America/New_York" required maxLength={100}/></label>
      <label>Preferred time<input name="send_time" type="time" defaultValue={settings.send_time} required/></label>
      <button className="primary">{busy ? 'Saving…' : 'Save preferences'}</button>
    </fieldset><Notice notice={notice}/>
  </form>;
}

export function Settings({onScheduleChange}: {onScheduleChange: () => void}) {
  const result = useResource<AppSettings>('/settings');
  const action = useAction();
  function toggleSchedule() {
    const enabled = !result.data?.sending_enabled;
    if (enabled && !window.confirm('Enable daily delivery to active, opted-in recipients at the saved time?')) return;
    void action.run(async () => {
      await send('/settings/schedule', 'PATCH', {enabled});
      result.refresh();
      onScheduleChange();
    }, enabled ? 'Scheduled sending enabled.' : 'Scheduled sending paused.');
  }
  return <>
    <div className="screen-head"><div><h1>Settings</h1><p>Manage the daily Word of the Day schedule.</p></div></div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <div className="overview-grid">
      <SettingsForm settings={result.data}/>
      <section className="panel padded"><h2>Email delivery</h2>
        <dl className="details">
          <dt>Scheduled sending</dt><dd>{result.data.sending_enabled ? 'On' : 'Paused'}</dd>
          <dt>Graph sender</dt><dd>{result.data.sender_configured ? 'Configured' : 'Not configured'}</dd>
        </dl>
        <button type="button" className="primary" onClick={toggleSchedule}
          disabled={action.busy || (!result.data.sending_enabled && !result.data.sender_configured)}>
          {result.data.sending_enabled ? 'Pause scheduled sending' : 'Enable scheduled sending'}
        </button>
        <Notice notice={action.notice}/>
      </section>
    </div>}
  </>;
}
