import { useState, type FormEvent } from 'react';
import type { Page, Recipient } from '../shared/model';
import { send, useAction, useResource } from './api';
import { Badge, Dialog, Empty, formatDate, Notice, Pager, Result } from './components';
import { Import } from './Import';

function RecipientForm({close, saved}: {close: () => void; saved: () => void}) {
  const [active, setActive] = useState(true);
  const {busy, run, notice} = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      await send('/recipients', 'POST', {...data, consented_at: data.consented_at || null, status: active ? 'active' : 'inactive'});
      saved();
    });
  }
  return <Dialog title="Add recipient" close={close}>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Email address<input name="email" type="email" required maxLength={254}/></label>
      <label>Display name<input name="display_name" maxLength={160}/></label>
      <label className="checkbox"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)}/> Active recipient</label>
      <label>Consent source<input name="consent_source" maxLength={200} required={active}/></label>
      <label>Consent date<input name="consented_at" type="date" required={active}/></label>
      <button className="primary">{busy ? 'Saving…' : 'Add recipient'}</button>
    </fieldset></form><Notice notice={notice}/>
  </Dialog>;
}

export function Recipients() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<'new' | 'import'>();
  const [saved, setSaved] = useState(false);
  const params = new URLSearchParams({page: String(page), search});
  if (filter) params.set('status', filter);
  const result = useResource<Page<Recipient>>('/recipients?' + params);
  const {busy, run, notice} = useAction();
  function setStatus(recipient: Recipient, status: Recipient['status']) {
    if (status === 'unsubscribed' && !window.confirm(`Record an unsubscribe for ${recipient.email}? It cannot be undone in Phase 1.`)) return;
    setSaved(false);
    void run(async () => {
      await send(`/recipients/${recipient.id}`, 'PATCH', {status});
      if (filter && page > 1 && result.data?.rows.length === 1) setPage(page - 1);
      result.refresh();
    }, 'Recipient status updated.');
  }
  return <>
    <div className="screen-head"><div><h1>Recipients</h1><p>Manage consent and subscription status.</p></div>
      <div className="actions"><button onClick={() => setDialog('import')}>Import recipients</button><button className="primary" onClick={() => setDialog('new')}>＋ Add recipient</button></div>
    </div>
    <Notice notice={saved ? {message: 'Recipient added.'} : notice}/>
    <div className="toolbar"><label>Search recipients<input type="search" value={search} maxLength={100} placeholder="Search by email" onChange={event => {setSearch(event.target.value); setPage(1);}}/></label>
      <label>Status<select value={filter} onChange={event => {setFilter(event.target.value); setPage(1);}}>
        <option value="">All statuses</option>{['active','inactive','unsubscribed','suppressed'].map(status => <option key={status}>{status}</option>)}
      </select></label>
    </div>
    <Result {...result} retry={result.refresh}/>
    {result.data && <>
      <div className="panel table-wrap">{result.data.rows.length ? <table>
        <thead><tr><th>Recipient</th><th>Status</th><th>Consent</th><th>Actions</th></tr></thead>
        <tbody>{result.data.rows.map(recipient => <tr key={recipient.id}>
          <td><strong>{recipient.email}</strong>{recipient.display_name && <small>{recipient.display_name}</small>}</td>
          <td><Badge status={recipient.status}/>{recipient.unsubscribed_at && <small>{formatDate(recipient.unsubscribed_at)}</small>}</td>
          <td>{recipient.consent_source ?? '—'}<small>{formatDate(recipient.consented_at)}</small></td>
          <td><div className="actions">
            {recipient.status === 'active' && <button disabled={busy} onClick={() => setStatus(recipient, 'inactive')}>Deactivate</button>}
            {recipient.status === 'inactive' && recipient.consented_at && recipient.consent_source && <button disabled={busy} onClick={() => setStatus(recipient, 'active')}>Activate</button>}
            {(recipient.status === 'active' || recipient.status === 'inactive') && <button disabled={busy} onClick={() => setStatus(recipient, 'unsubscribed')}>Record unsubscribe</button>}
          </div></td>
        </tr>)}</tbody>
      </table> : <Empty title="No matching recipients">{search || filter ? 'Try changing the search or filter.' : 'Add a recipient or import a list with consent records.'}</Empty>}</div>
      <Pager result={result.data} setPage={setPage}/>
    </>}
    {dialog === 'new' && <RecipientForm close={() => setDialog(undefined)} saved={() => {
      setDialog(undefined); setFilter(''); setSearch(''); setPage(1); setSaved(true); result.refresh();
    }}/>}
    {dialog === 'import' && <Import kind="recipients" close={() => setDialog(undefined)} refresh={result.refresh}/>}
  </>;
}
