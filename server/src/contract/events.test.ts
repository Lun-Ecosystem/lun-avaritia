import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { emitEvent, eventsSince, pruneEvents } from './events.ts';

/** Reads SSE frames from a streaming response until `count` events arrived. */
async function readEvents(
  res: Response,
  count: number,
): Promise<{ id: string; event: string; data: unknown }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: { id: string; event: string; data: unknown }[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const fields = Object.fromEntries(
        raw
          .split('\n')
          .filter((l) => l && !l.startsWith(':'))
          .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]),
      );
      if (fields.id && fields.event && fields.data)
        frames.push({ id: fields.id, event: fields.event, data: JSON.parse(fields.data) });
    }
  }
  await reader.cancel();
  return frames;
}

describe('GET /lun/v1/events', () => {
  it('replays the events after Last-Event-ID, in order', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const first = emitEvent(h.db, { type: 'fiche.sorted', importance: 'normal', title: 'Un' }, h.clock());
    emitEvent(h.db, { type: 'mail.pending', importance: 'info', title: 'Deux' }, h.clock());
    emitEvent(h.db, { type: 'agenda.reminder', importance: 'urgent', title: 'Trois' }, h.clock());
    const res = await h.app.request('/lun/v1/events', {
      headers: { ...h.auth(token), 'last-event-id': first.id },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = await readEvents(res, 2);
    expect(frames.map((f) => f.event)).toEqual(['mail.pending', 'agenda.reminder']);
    expect(frames[1]!.data).toEqual({
      id: frames[1]!.id,
      type: 'agenda.reminder',
      importance: 'urgent',
      at: '2026-11-02T08:00:00.000Z',
      title: 'Trois',
    });
  });

  it('pushes an event emitted while the client is connected', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/events', { headers: h.auth(token) });
    setTimeout(
      () => emitEvent(h.db, { type: 'mail.changed', importance: 'info', title: 'Live' }, h.clock()),
      20,
    );
    const frames = await readEvents(res, 1);
    expect(frames[0]!.event).toBe('mail.changed');
  });

  it('gives increasing string ids', () => {
    const h = makeHarness();
    const a = emitEvent(h.db, { type: 't', importance: 'info', title: 'a' }, h.clock());
    const b = emitEvent(h.db, { type: 't', importance: 'info', title: 'b' }, h.clock());
    expect(typeof a.id).toBe('string');
    expect(Number(b.id)).toBeGreaterThan(Number(a.id));
    expect(eventsSince(h.db, a.id).map((e) => e.title)).toEqual(['b']);
  });

  it('keeps events for 7 days', () => {
    const h = makeHarness();
    emitEvent(h.db, { type: 't', importance: 'info', title: 'old' }, new Date('2026-10-25T07:59:00Z'));
    emitEvent(h.db, { type: 't', importance: 'info', title: 'recent' }, new Date('2026-10-26T08:01:00Z'));
    pruneEvents(h.db, h.clock());
    expect(eventsSince(h.db).map((e) => e.title)).toEqual(['recent']);
  });
});
