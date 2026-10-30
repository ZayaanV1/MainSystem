import { useEffect, useState } from 'react';
import { bridgeStatus, forgetFact, loadMemory, telegramLinked, type BridgeStatus, type MemoryFact } from '../lib/abood';
import { formatRoute } from '../lib/route';
import { announce } from '../lib/announce';

/**
 * Abood's side panels on Vision's desk, either side of the conversation, in
 * the places the glass dashboard keeps its contact list and profile.
 *
 * Left: where the one conversation is reachable from, with each channel's
 * real state. Right: what Abood remembers, which the desk had nowhere to
 * show; each memory can be forgotten here as in Settings.
 */

/** Open a Settings page the way the app's own links do: a new address, announced. */
function openSettings(page: string) {
  window.history.pushState(null, '', formatRoute({ screen: 'settings', page }));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AboodChannels({ starters, onAsk, spent }: { starters: string[]; onAsk: (q: string) => void; spent: boolean }) {
  const [telegram, setTelegram] = useState<boolean | null | undefined>(undefined);
  const [bridge, setBridge] = useState<BridgeStatus | null | undefined>(undefined);

  useEffect(() => {
    void telegramLinked().then(setTelegram);
    void bridgeStatus().then(setBridge);
  }, []);

  const rows: { name: string; state: string; on: boolean }[] = [
    { name: 'This app', state: 'Here', on: true },
    {
      name: 'Telegram',
      state: telegram === undefined ? 'Checking' : telegram === null ? 'Couldn’t check' : telegram ? 'Linked' : 'Not linked',
      on: Boolean(telegram),
    },
    {
      name: 'iMessage',
      state:
        bridge === undefined
          ? 'Checking'
          : bridge === null
            ? 'Couldn’t check'
            : !bridge.exists
              ? 'Not set up'
              : bridge.online
                ? 'Mac online'
                : 'Mac offline',
      on: Boolean(bridge?.online),
    },
  ];

  return (
    <aside className="v-card v-side" aria-label="Where Abood answers">
      <h2 className="v-h">Channels</h2>
      <p className="v-meta">One conversation, wherever you text from.</p>
      <ul className="v-stagger v-channels">
        {rows.map((r, j) => (
          <li key={r.name} style={{ ['--j' as string]: j }}>
            <span className={`v-led ${r.on ? 'is-on' : ''}`} aria-hidden />
            <span className="v-line">{r.name}</span>
            <span className="v-meta ml-auto">{r.state}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="v-link mt-3 self-start" onClick={() => openSettings('abood')}>
        Set up channels
      </button>

      {!spent && (
        <>
          <h2 className="v-h mt-6">Ask about</h2>
          <div className="v-starters">
            {starters.map((q) => (
              <button key={q} type="button" className="v-starter" onClick={() => onAsk(q)}>
                {q}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

export function AboodMemory({ refresh }: { refresh: number }) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void loadMemory().then(({ facts: f, failed: bad }) => {
      setFacts(f);
      setFailed(bad);
    });
  }, [refresh]);

  async function forget(f: MemoryFact) {
    setFacts((fs) => fs?.filter((x) => x.id !== f.id) ?? fs);
    if (await forgetFact(f.id)) announce('Forgotten');
    else {
      setFacts((fs) => (fs ? [...fs, f] : fs));
      setFailed(true);
    }
  }

  return (
    <aside className="v-card v-side" aria-label="What Abood remembers">
      <div className="v-mem-head">
        <span className="v-mem-mark" aria-hidden>
          A
        </span>
        <div>
          <h2 className="v-h">Abood</h2>
          <p className="v-meta">What it remembers about you</p>
        </div>
      </div>
      {failed && <p className="v-meta text-t-critical">Couldn’t load or change its memory. Try again.</p>}
      {facts && facts.length === 0 && !failed && (
        <p className="v-empty">Nothing yet. When it learns something, it says so in the conversation.</p>
      )}
      <ul className="v-stagger v-facts">
        {facts?.map((f, j) => (
          <li key={f.id} style={{ ['--j' as string]: Math.min(j, 10) }}>
            <p>{f.fact}</p>
            <button type="button" className="v-link" onClick={() => void forget(f)}>
              Forget
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
