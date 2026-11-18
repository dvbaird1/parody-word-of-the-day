import { useEffect, useRef, type ReactNode } from 'react';
import type { Page } from '../shared/model';

export function Notice({notice}: {notice?: {message: string; error?: boolean}}) {
  return notice ? <p className={notice.error ? 'notice error' : 'notice success'} role={notice.error ? 'alert' : 'status'}>{notice.message}</p> : null;
}

export function Result({loading, error, retry}: {loading: boolean; error?: string; retry: () => void}) {
  if (error) return <div className="panel empty"><Notice notice={{message: error, error: true}}/><button type="button" onClick={retry}>Try again</button></div>;
  return loading ? <p className="panel empty" role="status">Loading…</p> : null;
}

export function Empty({title, children}: {title: string; children?: ReactNode}) {
  return <div className="empty"><div className="empty-icon" aria-hidden="true">✦</div><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function Badge({status}: {status: string}) {
  return <span className={`badge badge-${status.replaceAll(" ", "-")}`}>{status}</span>;
}

export function Pager({result, setPage}: {result: Pick<Page<unknown>, 'page' | 'pageSize' | 'total'>; setPage: (page: number) => void}) {
  const {page, pageSize, total} = result;
  const last = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pager">
    <span>{total ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total}` : '0 records'}</span>
    <div className="actions">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <button type="button" disabled={page >= last} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  </div>;
}

export function Dialog({title, close, children}: {title: string; close: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={event => {event.preventDefault(); close();}}>
    <div className="dialog-head"><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={close}>×</button></div>
    {children}
  </dialog>;
}

export const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'}).format(new Date(value))
  : '—';
