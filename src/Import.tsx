import { useState } from 'react';
import type { ImportReport } from '../shared/model';
import { send, useAction } from './api';
import { Dialog, Notice } from './components';

export function Import({kind, close, refresh}: {kind: 'words' | 'recipients'; close: () => void; refresh: () => void}) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [report, setReport] = useState<ImportReport>();
  const [committed, setCommitted] = useState(false);
  const {notice, busy, run} = useAction();
  const example = kind === 'words'
    ? 'term,real_definition,parody_sentence,part_of_speech,pronunciation,theme,internal_notes'
    : 'email,display_name,consent_source,consented_at,status';
  function update(value: string) {
    setContent(value);
    setReport(undefined);
    setCommitted(false);
  }
  function submit(commit: boolean) {
    void run(async () => {
      const result = await send<ImportReport>(`/${kind}/import/${commit ? 'commit' : 'preview'}`, 'POST', {format, content});
      setReport(result);
      if (commit) { setCommitted(true); refresh(); }
    }, commit ? 'Import committed.' : undefined);
  }
  return <Dialog title={`Import ${kind}`} close={close}>
    <fieldset disabled={busy}>
      <label>Format<select value={format} onChange={event => {setFormat(event.target.value === 'json' ? 'json' : 'csv'); setReport(undefined); setCommitted(false);}}>
        <option value="csv">CSV</option><option value="json">JSON array</option>
      </select></label>
      <p className="hint">Import up to 100 rows. {kind === 'words' ? 'All imported words start as drafts.' : 'Active recipients require a consent source and a YYYY-MM-DD consent date.'}</p>
      <p className="hint">Field names <code>{example}</code></p>
      <label>Choose a file<input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        void run(async () => {
          if (file.size > 128 * 1024) throw new Error('File must be 128 KiB or smaller.');
          setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
          update(await file.text());
        });
      }}/></label>
      <label>Import contents<textarea rows={6} maxLength={128 * 1024} value={content} onChange={event => update(event.target.value)}/></label>
      <div className="actions">
        <button type="button" disabled={!content.trim()} onClick={() => submit(false)}>Preview import</button>
        <button type="button" className="primary" disabled={!report?.valid || !!report.invalid || !!report.duplicates || committed} onClick={() => submit(true)}>Commit import</button>
      </div>
    </fieldset>
    {busy && <p role="status">Processing…</p>}
    <Notice notice={notice}/>
    {report && <section aria-label="Import results">
      <p role="status">{report.total} rows · {report.valid} valid · {report.invalid} invalid · {report.duplicates} duplicates</p>
      <ol className="import-results">{report.rows.map(row => <li key={row.row}>Row {row.row} {row.label && <strong>{row.label} </strong>}<span>{row.status}{row.message && ` · ${row.message}`}</span></li>)}</ol>
    </section>}
  </Dialog>;
}
