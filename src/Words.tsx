import { useState, type FormEvent } from 'react';
import { type Page, type Word } from '../shared/model';
import { send, useAction, useResource } from './api';
import { Badge, Dialog, Empty, formatDate, Notice, Pager, Result } from './components';
import { Import } from './Import';

const fields = [
  ['term', 'Word', 100], ['real_definition', 'Real definition', 2000], ['parody_sentence', 'Deliberately wrong sentence', 1000],
  ['part_of_speech', 'Part of speech', 80], ['pronunciation', 'Pronunciation', 160], ['theme', 'Category', 100], ['internal_notes', 'Internal notes', 2000],
] as const;

function WordForm({word, close, saved}: {word?: Word; close: () => void; saved: () => void}) {
  const {busy, run, notice} = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      await send(word ? `/words/${word.id}` : '/words', word ? 'PATCH' : 'POST', value);
      saved();
    });
  }
  return <Dialog title={word ? 'Edit draft' : 'New draft'} close={close}>
    <form onSubmit={submit}><fieldset disabled={busy}>
      {fields.map(([name, label, max], index) => <label key={name}>{label}{index < 3 && ' *'}
        {index === 1 || index === 2 || name === 'internal_notes'
          ? <textarea name={name} maxLength={max} defaultValue={word?.[name] ?? ''} required={index < 3} rows={3}/>
          : <input name={name} maxLength={max} defaultValue={word?.[name] ?? ''} required={index < 3}/>}
      </label>)}
      <button className="primary">{busy ? 'Saving…' : 'Save draft'}</button>
    </fieldset></form><Notice notice={notice}/>
  </Dialog>;
}

export function Words({approvals = false}: {approvals?: boolean}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Word | 'new'>();
  const [inspect, setInspect] = useState<Word>();
  const [importing, setImporting] = useState(false);
  const [saved, setSaved] = useState('');
  const status = approvals ? 'draft' : filter;
  const query = new URLSearchParams({page: String(page), search});
  if (status) query.set('status', status);
  const result = useResource<Page<Word>>('/words?' + query);
  const {busy, notice, run} = useAction();

  function action(word: Word, name: string, method = 'POST', payload?: unknown) {
    setSaved('');
    void run(async () => {
      await send(`/words/${word.id}${method === 'POST' ? '/' + name : ''}`, method, payload);
      if (page > 1 && result.data?.rows.length === 1 && (method === 'DELETE' || (method === 'POST' && status))) setPage(page - 1);
      result.refresh();
    }, ({approve: 'Word approved.', reject: 'Word rejected.', 'restore-draft': 'Word restored to drafts.', delete: 'Draft deleted.', priority: 'Priority updated.'} as Record<string, string>)[name]);
  }

  function approveAll() {
    if (!window.confirm('Approve every draft and add it to the ready queue? This includes drafts on other pages and outside the current search.')) return;
    setSaved('');
    void run(async () => {
      const {approved} = await send<{approved: number}>('/words/approve-all', 'POST');
      setPage(1);
      setSearch('');
      result.refresh();
      setSaved(approved === 0 ? 'No drafts to approve.' : `Approved ${approved} ${approved === 1 ? 'draft' : 'drafts'}.`);
    });
  }

  function buttons(word: Word) {
    return <div className="actions">
      {word.status === 'draft' && <>
        <button onClick={() => {setInspect(undefined); setEditor(word);}}>Edit</button>
        <button className="primary" disabled={busy} onClick={() => action(word, 'approve')}>Approve</button>
        <button disabled={busy} onClick={() => action(word, 'reject')}>Reject</button>
        {!approvals && <button className="danger" disabled={busy} onClick={() => {if (window.confirm(`Delete the draft “${word.term}”?`)) action(word, 'delete', 'DELETE');}}>Delete</button>}
      </>}
      {word.status === 'rejected' && <button disabled={busy} onClick={() => action(word, 'restore-draft')}>Restore to draft</button>}
      {word.status === 'approved' && <button disabled={busy} onClick={() => action(word, 'reject')}>Reject</button>}
    </div>;
  }

  return <>
    <div className="screen-head">
      <div><h1>{approvals ? 'Approvals' : 'Word library'}</h1><p>{approvals ? 'Review the meaning and the misuse before a word joins the queue.' : 'Manage drafts and decide which approved words go first.'}</p></div>
      {approvals && <button className="primary" disabled={busy || (!search && !result.data?.total)} onClick={approveAll}>Approve all drafts</button>}
      {!approvals && <div className="actions"><button onClick={() => setImporting(true)}>Import words</button><button className="primary" onClick={() => setEditor('new')}>＋ New draft</button></div>}
    </div>
    <Notice notice={saved ? {message: saved} : notice}/>
    <div className="toolbar">
      <label>Search words<input type="search" value={search} onChange={event => {setSearch(event.target.value); setPage(1);}} placeholder="Search by term" maxLength={100}/></label>
      {!approvals && <label>Status<select value={filter} onChange={event => {setFilter(event.target.value); setPage(1);}}>
        <option value="">All statuses</option>{['draft','approved','rejected','sent'].map(value => <option key={value}>{value}</option>)}
      </select></label>}
    </div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <>
      {result.data.rows.length === 0 ? <div className="panel"><Empty title={approvals ? 'No drafts to review' : 'No matching words'}>{search || filter ? 'Try changing the search or filter.' : 'Add a draft in the word library to get started.'}</Empty></div>
        : approvals ? <div className="review-grid">{result.data.rows.map(word => <article className="panel review" key={word.id}>
          <Badge status={word.status}/><h2>{word.term}</h2>
          <dl className="details"><dt>Real definition</dt><dd>{word.real_definition}</dd><dt>Deliberately wrong</dt><dd>{word.parody_sentence}</dd>
            <dt>Category</dt><dd>{word.theme ?? '—'}</dd><dt>Internal notes</dt><dd>{word.internal_notes ?? '—'}</dd></dl>
          {buttons(word)}
        </article>)}</div> : <div className="panel table-wrap"><table>
          <thead><tr><th>Word</th><th>Status</th><th>Updated</th>{status === 'approved' && <th>Queue priority</th>}<th>Actions</th></tr></thead>
          <tbody>{result.data.rows.map(word => <tr key={word.id}>
            <td><button className="text-button" onClick={() => setInspect(word)}>{word.term}</button>{word.theme && <small>{word.theme}</small>}</td>
            <td><Badge status={word.status}/></td><td>{formatDate(word.updated_at)}</td>
            {status === 'approved' && <td><form className="actions priority" onSubmit={event => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('priority');
              action(word, 'priority', 'PATCH', {queue_priority: value === '' ? null : Number(value)});
            }}><input aria-label={`Priority for ${word.term}`} name="priority" type="number" min={-10000} max={10000} placeholder="Default" defaultValue={word.queue_priority ?? ''}/><button disabled={busy}>Update</button></form></td>}
            <td>{buttons(word)}</td>
          </tr>)}</tbody>
        </table></div>}
      <Pager result={result.data} setPage={setPage}/>
    </>}
    {editor && <WordForm word={editor === 'new' ? undefined : editor} close={() => setEditor(undefined)} saved={() => {
      if (editor === 'new') {setPage(1); setFilter(''); setSearch('');}
      setEditor(undefined); setSaved('Draft saved.'); result.refresh();
    }}/>}
    {inspect && <Dialog title={inspect.term} close={() => setInspect(undefined)}>
      <Badge status={inspect.status}/><dl className="details">{fields.slice(1).map(([name, label]) => <div key={name}><dt>{label}</dt><dd>{inspect[name] ?? '—'}</dd></div>)}
        <dt>Created</dt><dd>{formatDate(inspect.created_at)}</dd><dt>Approved</dt><dd>{formatDate(inspect.approved_at)}</dd><dt>Sent</dt><dd>{formatDate(inspect.sent_at)}</dd></dl>
    </Dialog>}
    {importing && <Import kind="words" close={() => setImporting(false)} refresh={result.refresh}/>}
  </>;
}
