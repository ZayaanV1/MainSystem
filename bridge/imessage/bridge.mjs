#!/usr/bin/env node
/**
 * The iMessage bridge — Abood's Mac.
 *
 * Apple offers no iMessage API, so this runs on a Mac signed into Messages
 * and does the two things an API would: it watches the Messages database for
 * new one-to-one iMessages, and it sends replies through the Messages app.
 * Everything else — which account a number belongs to, the answer, the
 * memory, the budget — happens in the planner's `imessage` edge function,
 * which is the same door Telegram uses.
 *
 * No dependencies: macOS ships sqlite3, osascript and caffeinate, and the
 * fewer moving parts a program that must run unattended has, the fewer
 * things break at 2am.
 *
 * WHAT IT NEEDS FROM macOS (only you can grant these)
 *   Full Disk Access for the node binary, to read ~/Library/Messages/chat.db.
 *   Automation permission for Messages, the first time it sends a reply.
 *
 * WHAT IT NEVER DOES
 *   Read group chats, read anything you sent, or answer a number that has not
 *   linked itself to a planner account (the edge function returns nothing for
 *   those, and nothing is what gets sent).
 */

import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HOME = homedir();
const CONFIG_DIR = join(HOME, '.config', 'abood-bridge');
const CONFIG = join(CONFIG_DIR, 'config.json');
const STATE = join(CONFIG_DIR, 'state.json');
const DB = join(HOME, 'Library', 'Messages', 'chat.db');

const POLL_MS = 2_000;
const HEARTBEAT_MS = 5 * 60_000;
/** chat.style for a one-to-one conversation (43 is a group). */
const DIRECT = 45;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadConfig() {
  if (!existsSync(CONFIG)) {
    log(`No config at ${CONFIG}. Run bridge/imessage/install.sh first.`);
    process.exit(1);
  }
  const c = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (!c.url || !c.secret || !c.address) {
    log('Config is missing the url, the bridge key or Abood\'s address. Run: bridge/imessage/install.sh <abood-apple-id> <bridge-key from Settings>');
    process.exit(1);
  }
  return c;
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));
}

async function sql(query) {
  const { stdout } = await run('/usr/bin/sqlite3', ['-readonly', '-json', DB, query], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

/**
 * The text of a message.
 *
 * Since macOS Ventura, Messages often leaves `text` empty and keeps the body
 * only in `attributedBody`, an NSArchiver typedstream. The string follows the
 * first NSString class marker, after a '+' byte and a length that is one
 * byte, or 0x81 plus two bytes, or 0x82 plus four, little-endian.
 */
export { send };

export function decodeAttributedBody(hex) {
  if (!hex) return null;
  const b = Buffer.from(hex, 'hex');
  let i = b.indexOf('NSString');
  if (i < 0) return null;
  i = b.indexOf(0x2b, i);
  if (i < 0) return null;
  i += 1;
  let len = b[i];
  i += 1;
  if (len === 0x81) {
    len = b.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = b.readUInt32LE(i);
    i += 4;
  }
  if (!Number.isFinite(len) || i + len > b.length) return null;
  return b.subarray(i, i + len).toString('utf8');
}

async function newestRowId() {
  const rows = await sql('select max(ROWID) as id from message');
  return rows[0]?.id ?? 0;
}

async function incoming(after) {
  return sql(`
    select m.ROWID as id, m.text as text, hex(m.attributedBody) as body, h.id as handle, c.guid as chat
    from message m
    join handle h on h.ROWID = m.handle_id
    join chat_message_join j on j.message_id = m.ROWID
    join chat c on c.ROWID = j.chat_id
    where m.ROWID > ${Number(after)}
      and m.is_from_me = 0
      and m.service = 'iMessage'
      and c.style = ${DIRECT}
      and m.item_type = 0
    order by m.ROWID
    limit 50
  `);
}

/**
 * Sends through Messages. The text and the handle are passed as arguments to
 * the script, never spliced into it, so nothing a reply contains can become
 * AppleScript.
 */
async function send(handle, text, address) {
  /*
   * From Abood's account, named. A Mac can have several iMessage accounts
   * signed in — here, the owner's own Apple ID as well as Abood's — and
   * "the first iMessage account", or the conversation's default, was the
   * owner's. A reply from the owner's own Apple ID to the owner's own phone
   * is a message to yourself, which iMessage refuses (error 22). So the
   * account is chosen by its address, and if it cannot be found nothing is
   * sent from anyone else's.
   */
  const script = [
    'on run argv',
    '  tell application "Messages"',
    '    set wanted to "E:" & (item 3 of argv)',
    '    set theAccount to missing value',
    '    repeat with a in (every account)',
    '      if (description of a as text) is wanted and enabled of a then',
    '        set theAccount to a',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if theAccount is missing value then error "Abood\'s account " & wanted & " is not signed in and enabled in Messages"',
    '    send (item 1 of argv) to participant (item 2 of argv) of theAccount',
    '  end tell',
    'end run',
  ];
  await run('/usr/bin/osascript', [...script.flatMap((l) => ['-e', l]), text, handle, address]);
}

/**
 * What Messages did with the reply it was handed.
 *
 * osascript returns as soon as Messages accepts a send, which is not the same
 * as delivering it — a reply can sit "Not Delivered" with nothing thrown
 * anywhere. So a few seconds later the outgoing row is read back and its
 * state logged, which is the only place a silent failure would show.
 */
async function reportDelivery(handle) {
  await new Promise((r) => setTimeout(r, 4_000));
  try {
    const rows = await sql(`
      select m.error, m.is_sent, m.is_delivered, m.service, m.account, m.destination_caller_id as from_id
      from message m join handle h on h.ROWID = m.handle_id
      where m.is_from_me = 1 and h.id = '${handle.replace(/'/g, "''")}'
      order by m.ROWID desc limit 1
    `);
    log('delivery:', JSON.stringify(rows[0] ?? 'no outgoing row found'));
  } catch (e) {
    log('delivery check failed:', String(e.stderr || e.message).trim());
  }
}

/**
 * Several texts, a beat apart, the way a person sends them — longer texts
 * take a little longer, as if typed.
 */
async function sendAll(handle, texts, address) {
  for (const [i, t] of texts.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700 + Math.min(t.length * 15, 1_800)));
    await send(handle, t, address);
  }
}

/** Collects anything Abood started (check-ins) and sends it. */
async function drainOutbox(config) {
  try {
    const { outbox = [] } = await post(config, { kind: 'outbox' });
    const byHandle = new Map();
    for (const o of outbox) byHandle.set(o.handle, [...(byHandle.get(o.handle) ?? []), o.text]);
    for (const [handle, texts] of byHandle) {
      await sendAll(handle, texts, config.address);
      log(`checked in with ${handle.replace(/.(?=.{4})/g, '•')}`);
    }
  } catch (e) {
    log('outbox:', String(e.stderr || e.message).trim());
  }
}

async function post(config, body) {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-secret': config.secret },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`planner answered ${res.status}`);
  return res.json();
}

async function main() {
  const config = loadConfig();

  // Keep the Mac awake while the bridge runs (on power), without changing any
  // system setting: the assertion ends when this process does.
  spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();

  const state = loadState();
  // First run: start from now. Answering months of old messages would be the
  // worst possible first impression.
  // Waits, rather than exits, until the database can be read: the moment Full
  // Disk Access is granted the bridge starts on its own, with nothing to restart.
  for (;;) {
    try {
      if (typeof state.last !== 'number') {
        state.last = await newestRowId();
        saveState(state);
      } else {
        await newestRowId();
      }
      break;
    } catch (e) {
      log('Cannot read the Messages database yet. Grant Full Disk Access to:', process.execPath);
      log(String(e.stderr || e.message).trim());
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  const hello = () => post(config, { kind: 'hello', address: config.address }).catch((e) => log('heartbeat failed:', e.message));
  await hello();
  setInterval(hello, HEARTBEAT_MS);
  // Check-ins are rare, so a slow poll is plenty and costs the server little.
  setInterval(() => void drainOutbox(config), 30_000);
  log(`bridge up, watching after message ${state.last}${config.address ? ` for ${config.address}` : ''}`);

  for (;;) {
    try {
      for (const m of await incoming(state.last)) {
        state.last = m.id;
        saveState(state);

        const text = (m.text ?? decodeAttributedBody(m.body) ?? '').replace(/￼/g, '').trim();
        const { replies = [] } = await post(config, { kind: 'message', handle: m.handle, text });
        await sendAll(m.handle, replies, config.address);
        if (replies.length) {
          log(`answered ${m.handle.replace(/.(?=.{4})/g, '•')}`);
          await reportDelivery(m.handle);
        }
      }
    } catch (e) {
      log('error:', String(e.stderr || e.message).trim());
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
