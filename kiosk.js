// Dappl Hub: the family kiosk (Phase 2 prototype).
// A web app that runs full-screen in Chrome on the family tablet. It signs in as its own
// limited "kiosk device" (anonymous account + a pairing code from the iPhone app), so the
// database lets it show balances, set goals, change avatars and token pictures, and send
// requests ("I did it!" and "Can I buy this?") that a parent approves on their phone. It can
// never give tokens, spend them, or change the store. Kids with a card open their screen by
// tapping it (see "cards" below). See the kiosk and requests migrations in
// backend/supabase/migrations for the rules.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// kiosk/deploy.sh stamps each publish here ('dev' when served from this Mac). Pictures carry it
// (V) so a publish always brings fresh drawings, and "updates" below uses it to reload itself.
const BUILD = '20261113135940';
const V = BUILD === 'dev' ? '' : `?v=${BUILD}`;
// kiosk/deploy.sh --sandbox stamps true here: the test copy at …/dappl-hub-sandbox/ (same database).
const SANDBOX = false;
if (SANDBOX) document.body.insertAdjacentHTML('beforeend', '<div class="sandbox-tag">Sandbox</div>');

// ---------- backend ----------
const BACKENDS = {
  cloud: { url: 'https://glgxrtqamuiptlwxwrbc.supabase.co', key: 'sb_publishable_Nv7M-h1xCCjnSUE1j4KwSQ_dbfiE8Mn' },
  // The copy in Docker on the Mac, reached by the Mac's address (for testing).
  local: { url: `http://${location.hostname}:54321`, key: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' },
};
const params = new URLSearchParams(location.search);
const B = params.get('backend') === 'local' ? BACKENDS.local : BACKENDS.cloud;
if (params.has('still')) document.documentElement.classList.add('still');   // no drifting background
const sb = createClient(B.url, B.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: `tokenbank-kiosk-${params.get('backend') || 'cloud'}` } });

const IDLE_SECONDS = 60;          // back to the family screen after a minute untouched
const CAP = 36;                   // tokens a jar can show; past that it looks full (the number still counts)
const NEW_HOURS = 1;              // how long a "+5 new" sticker waits for the kid to tap their jar
// Signed photo links last 12 hours and are renewed once less than an hour is left.
// ?photottl=<seconds> shortens them, to test renewal.
const PHOTO_TTL_S = Number(params.get('photottl')) || 12 * 3600;
const PHOTO_RENEW_MS = Math.min(3600e3, PHOTO_TTL_S * 500);
const RESYNC_MS = (Number(params.get('resync')) || 120) * 1000;   // a full re-check, in case a live update was missed (?resync=<seconds> to test)
const SCAN_MS = 30e3;             // how long Redeem waits for the kid's Dappl Card

// ---------- pictures (same drawings as the iPhone app: design/svg) ----------
const HEAD_TOP = { fox: 30, lion: 20, bunny: 38, bear: 29, panda: 29, cat: 30, owl: 27, monkey: 27 }; // from AnimalMetrics.swift
const FURS = ['#FF9EC4', '#8FC8FF', '#B9A4FF', '#7FD9A8'];
// Each set is [many, one]. Same keys and words as TokenTheme in the iPhone app, in its order:
// Dappl Dots (the default) first, then the Featured sets with a "Featured" tag, then everyday.
const DEFAULT = { dappldots: ['Dappl Dots','Dappl Dot'] };
const FEATURED = { axolotls: ['axolotls','axolotl'], icecream: ['ice cream cones','ice cream cone'], chicks: ['chicks','chick'],
  rainbows: ['rainbows','rainbow'], penguins: ['penguins','penguin'], butterflies: ['butterflies','butterfly'], owls: ['owls','owl'],
  crabs: ['crabs','crab'], bees: ['bees','bee'], mushrooms: ['mushrooms','mushroom'] };
const EVERYDAY = { gems: ['gems','gem'], rubies: ['rubies','ruby'], crystals: ['crystals','crystal'], diamonds: ['diamonds','diamond'], coins: ['coins','coin'],
  stars: ['stars','star'], bugs: ['bugs','bug'], shells: ['shells','shell'], acorns: ['acorns','acorn'], eggs: ['dino eggs','dino egg'],
  pearls: ['pearls','pearl'], marbles: ['marbles','marble'], feathers: ['feathers','feather'], keys: ['keys','key'], fossils: ['fossils','fossil'],
  planets: ['planets','planet'], donuts: ['donuts','donut'], cookies: ['cookies','cookie'], medals: ['medals','medal'], robots: ['robots','robot'] };
const TOKENS = { ...DEFAULT, ...FEATURED, ...EVERYDAY };
const shown = k => TOKENS[k.token_theme] ? k.token_theme : 'dappldots';
// The pictures a pile of a set mixes: Dappl Dots come in six colors, other sets in one.
const DOT_COLORS = ['dappldots', 'dappldots-pink', 'dappldots-blue', 'dappldots-mint', 'dappldots-yellow', 'dappldots-orange'];
const pile = (theme, i) => theme === 'dappldots' ? DOT_COLORS[i % DOT_COLORS.length] : theme;
const mix = (a, b, t) => { const p = h => [1,3,5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), C = p(b); return '#' + A.map((v, i) => Math.round(v + (C[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Store and achievement pictures (Fluent Emoji, MIT: svg/art/LICENSE). An unknown key shows the gift.
const art = key => `<img class="art" alt="" src="svg/art/${/^[a-z0-9-]+$/.test(key || '') ? key : 'gift'}.svg${V}" onerror="this.onerror=null;this.src='svg/art/gift.svg${V}'">`;
const tok = (theme, cls = 'coin3d') => `<img class="${cls}" alt="" src="svg/token/${TOKENS[theme] || DOT_COLORS.includes(theme) ? theme : 'dappldots'}.svg${V}">`;
const unit = (kid, n) => TOKENS[shown(kid)][n === 1 ? 1 : 0];
// crypto.randomUUID only exists on https pages, and the prototype is served over plain http
// on the home network, so build the id from getRandomValues (which works everywhere).
const uuid = () => crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

function avatar(kid) {
  const a = kid.avatar || {}, animal = HEAD_TOP[a.animal] ? a.animal : 'bear';
  const fur = a.fur && FURS.includes(a.fur.toUpperCase()) ? '-' + a.fur.slice(1).toUpperCase() : '';
  let html = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${mix(kid.color, '#ffffff', .5)}"/></svg><img alt="" src="svg/animal/${animal}${fur}.svg${V}">`;
  if (a.extra === 'glasses' || a.extra === 'crown') html += `<img alt="" src="svg/extra/${a.extra}-${animal}.svg${V}">`;
  if (a.extra === 'bow') html += `<svg viewBox="0 0 100 100"><g transform="translate(50 55) scale(1.1) translate(-50 -53) translate(69 ${HEAD_TOP[animal] + 3}) rotate(18)"><path d="M0 0L-10 -6.5Q-12.5 0 -10 6.5Z" fill="${kid.color}"/><path d="M0 0L10 -6.5Q12.5 0 10 6.5Z" fill="${kid.color}"/><circle r="3.2" fill="${mix(kid.color, '#000000', .18)}"/></g></svg>`;
  return `<span class="av" aria-hidden="true">${html}</span>`;
}

// One rounded stroke icon set, as in the design file.
const IC = {
  store: '<path d="M5 8.2h14l-1.1 11.2a1.6 1.6 0 0 1-1.6 1.4H7.7a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M9 8.2V7a3 3 0 0 1 6 0v1.2"/>',
  star: '<path d="m12 4.2 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"/>',
  back: '<path d="M14.8 5.5 8.3 12l6.5 6.5"/>', flag: '<path d="M6.5 20.5V4.5"/><path d="M6.5 5h10.6l-2.2 3.8 2.2 3.8H6.5"/>',
  check: '<path d="m5.5 12.5 4.2 4.2 8.8-9.4"/>', x: '<path d="M7 7l10 10M17 7 7 17"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bolt: '<path d="M13.2 3.5 5.8 13.2h5.6l-1 7.3 7.8-10.2h-5.7z"/>',
  card: '<rect x="3.2" y="6" width="17.6" height="12.4" rx="2.4"/><path d="M6.8 14.6h4.4"/><path d="M15.2 10.2a3 3 0 0 1 0 3.6M17.4 8.8a5.4 5.4 0 0 1 0 6.4"/>',
  lock: '<rect x="5.5" y="10.6" width="13" height="9.4" rx="2.2"/><path d="M8.6 10.6V8.2a3.4 3.4 0 0 1 6.8 0v2.4"/>',
  mute: '<path d="M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z"/><path d="m16 9.5 4.5 5M20.5 9.5l-4.5 5"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.8V12l2.8 2"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.6 8 4.4 8 8.5s-8 3.9-8 8.5M16 3.5c0 4.6-8 4.4-8 8.5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M12 3v3.5M18.2 7.3l1.3-1.3"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6.5H5.2a2.6 2.6 0 0 0 2.9 3.4M16 6.5h2.8a2.6 2.6 0 0 1-2.9 3.4M12 13.5v3.5M8.8 20h6.4M10 17h4"/>', pencil: '<path d="m14.5 6 3.5 3.5M5 19l1-4.2L15.6 5.2a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L9.2 18 5 19z"/>',
};
const icon = (n, w = 2.4) => `<svg class="ic" viewBox="0 0 24 24" stroke-width="${w}" aria-hidden="true">${IC[n]}</svg>`;

// ---------- state ----------
const S = { family: null, kids: [], balances: {}, items: [], achievements: [], goals: {}, photos: {}, kidId: null, screen: 'loading',
  entries: [], seen: null, unseen: {}, pending: [], allItems: [], grownUntil: 0,
  dashes: [], dashId: null, dashEnd: 0, dashPrev: null, held: {}, doneAt: {}, dashRects: {},
  daily: {}, round3: false, pourFrom: {} };
const $screen = document.getElementById('screen'), $modal = document.getElementById('modal');
const kid = () => S.kids.find(k => k.id === S.kidId);
const bal = id => S.balances[id] ?? 0;
// What a jar shows: Dash winnings stay out of it until they pour in (see pourHeld).
const jarBal = id => Math.max(0, bal(id) - (S.held[id] || 0));
// Requests waiting for a parent. Tokens asked for in a purchase request can't be asked for twice.
const waiting = id => S.pending.filter(c => c.child_id === id);
const avail = id => bal(id) - waiting(id).filter(c => c.kind === 'buy').reduce((n, c) => n + c.amount, 0);
const goalItem = id => S.items.find(i => i.id === S.goals[id]);
// Whether a grown-up approves achievements ('did') or purchases ('buy'), from Settings in the app.
// "+1 Dappl Dot" and Dash finishes always wait for one. On unless the parents turned it off.
// A grown-up's own achievements and purchases always go straight through (the honor system).
// A kid (not a grown-up) can have 3 "I did it!" requests (achievements and "+1 Dappl Dot") and 1
// purchase waiting for a grown-up at most. Then that part of their screen goes dim under a note
// until a grown-up answers on their phone, and tapping it only shows a toast. (Little ones pressing
// everything in sight were filling the parents' phones with requests.) Dash finishes don't count.
const MAX_WAITING = { did: 3, buy: 1 };
const full = (k, kind) => !!k && !isGrown(k) && waiting(k.id).filter(c => c.kind === kind).length >= MAX_WAITING[kind];
const HELD = {
  did: ['Great job!', 'A grown-up needs to check these before you ask for more.', 'A grown-up will check these soon!'],
  buy: ['Your buy is waiting', 'Once a grown-up says OK, you can pick something else.', 'A grown-up will check your buy soon!'] };
// The dim note over a full section. It fades in only when it first appears, not on every redraw.
const heldNote = kind => { const fresh = S.justHeld === kind; S.justHeld = null; const [title, sub] = HELD[kind];
  return `<button class="held-note${fresh ? ' appear' : ''}" data-held="${kind}"><span class="hn-card">${icon('clock', 2.2)}<b>${title}</b><span>${sub}</span></span></button>`; };
const needsOK = (kind, k = kid()) => !isGrown(k) && S.family?.[kind === 'buy' ? 'approve_purchases' : 'approve_achievements'] !== false;
// Grown-ups have jars too (children.grown_up). They earn only from their own achievements, and
// their jars sit in their own row under the kids' on the family screen.
const isGrown = k => !!k?.grown_up;
const kidsOnly = () => S.kids.filter(k => !isGrown(k));
const grownUps = () => S.kids.filter(isGrown);
// Who an achievement or store item is for: its audience ('kids', 'grown_ups', 'everyone') and,
// optionally, only some of them (child_ids). Same rule as meant_for in the database.
const meantFor = (audience, ids, k) => (audience === 'everyone' || (audience === 'grown_ups') === isGrown(k)) && (!ids || ids.includes(k.id));
const itemFor = (it, k) => meantFor(it.audience || 'everyone', null, k);


// ---------- loading and live updates ----------
async function load() {
  // hub_locked_until (the Hub closed from a parent's phone) arrives with the round-2 migration,
  // the parents' approval settings after round 3. Older servers: load without them, in turn.
  let fams = null;
  for (const cols of ['id, name, hub_locked_until, approve_achievements, approve_purchases', 'id, name, hub_locked_until', 'id, name']) {
    const r = await sb.from('families').select(cols).limit(1);
    if (!r.error) { fams = r.data; break; }
  }
  if (!fams?.length) { S.family = null; return; }
  S.family = fams[0];
  const f = S.family.id;
  const [kids, bals, items, achs, goals, dashes, recent, pending, daily] = await Promise.all([
    sb.from('children').select('id, name, color, avatar, token_theme, sort_order, card_id, card_link_until, grown_up').eq('family_id', f).is('archived_at', null).order('sort_order'),
    sb.from('child_balances').select('child_id, balance').eq('family_id', f),
    // The parents-only store link is deliberately not loaded here.
    // Inactive items too, so a celebration can still show the picture of something just bought.
    loadItems(f, 2),
    loadAchievements(f, 3),
    sb.from('child_goals').select('child_id, item_id').eq('family_id', f),
    loadDashes(f, true),
    sb.from('ledger_entries').select('id, child_id, amount, label, category, source, achievement_id, item_id, created_at').eq('family_id', f).in('category', ['deposit', 'purchase']).order('created_at', { ascending: false }).limit(60),
    sb.from('claims').select('id, child_id, kind, item_id, label, amount, achievement_id').eq('family_id', f).eq('status', 'pending').order('created_at'),
    // Daily limits ("2 candies a day"): how many each kid has had today. Round 3; none before it.
    sb.rpc('daily_item_status', { p_family: f }),
  ]);
  // Before the grown-ups migration reaches the server there's no grown_up column (everyone's a kid),
  // and before the cards migration no card columns: load without them, in turn.
  let ks = kids;
  for (const cols of ['id, name, color, avatar, token_theme, sort_order, card_id, card_link_until', 'id, name, color, avatar, token_theme, sort_order']) {
    if (!ks.error) break;
    ks = await sb.from('children').select(cols).eq('family_id', f).is('archived_at', null).order('sort_order');
  }
  S.kids = ks.data || [];
  S.balances = Object.fromEntries((bals.data || []).map(b => [b.child_id, b.balance]));
  for (const id of Object.keys(S.held)) if (!S.kids.some(k => k.id === id)) delete S.held[id];   // a kid removed mid-pour
  let its = items;
  for (let level = 1; its.error && level >= 0; level--) its = await loadItems(f, level);
  S.allItems = its.data || [];
  S.items = S.allItems.filter(i => i.active && !i.archived_at && (!i.ends_at || new Date(i.ends_at) > Date.now())).sort((a, b) => a.price - b.price || a.sort_order - b.sort_order);
  // Grown-ups bring who each achievement is for (audience); round 3 brought some kids only and
  // the parents' order; achievement photos came before. Until the server has them, load without
  // (older levels are tried in turn).
  let a = achs, level = 3;
  while (a.error && level > 0) a = await loadAchievements(f, --level);
  S.round3 = level >= 2;
  S.achievements = a.data || [];
  S.daily = Object.fromEntries((daily.error ? [] : daily.data || []).map(d => [d.child_id + d.item_id, d]));
  S.goals = Object.fromEntries((goals.data || []).map(g => [g.child_id, g.item_id]));
  S.dashes = (dashes.error ? (await loadDashes(f, false)).data : dashes.data) || [];   // none before the Dashes migration reaches the server
  S.entries = recent.data || [];
  S.pending = pending.data || [];
  // Photos are private, so each gets a signed link that works for a while. The Hub runs for days,
  // so links are renewed well before they run out (they used to be made once and then break).
  const now = Date.now(), paths = new Set([...S.allItems, ...S.achievements].map(i => i.photo_path).filter(Boolean));
  await Promise.all([...paths].filter(p => !S.photos[p] || S.photos[p].until - now < PHOTO_RENEW_MS).map(async p => {
    const { data } = await sb.storage.from('item-photos').createSignedUrl(p, PHOTO_TTL_S);
    if (data?.signedUrl) S.photos[p] = { url: data.signedUrl, until: now + PHOTO_TTL_S * 1000 };
  }));
}
// Store items at three levels of server: 2 = grown-ups (who it's for), 1 = round 3 (daily limit), 0 = neither.
const loadItems = (f, level) => sb.from('reward_items')
  .select(`id, name, icon, photo_path, price, ends_at, sort_order, active, archived_at${level >= 1 ? ', daily_limit' : ''}${level >= 2 ? ', audience' : ''}`).eq('family_id', f);
// Achievements at four levels of server: 3 = grown-ups (audience), 2 = round 3 (some kids only,
// parents' order), 1 = photos, 0 = none of those.
const loadAchievements = (f, level) => sb.from('achievements')
  .select(`id, name, description, icon, value, sort_order${level >= 1 ? ', photo_path' : ''}${level >= 2 ? ', child_ids, pin_order' : ''}${level >= 3 ? ', audience' : ''}`)
  .eq('family_id', f).eq('active', true).is('archived_at', null).order('sort_order');
// A kid's achievements, in the parents' order: the ones they put first, then fewest Dappl Dots
// first. Same order as the app (FamilyBank.achievements(for:)).
const achOrder = (a, b) => (a.pin_order ?? 1e9) - (b.pin_order ?? 1e9) || a.value - b.value || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const kidAchievements = k => S.achievements.filter(a => meantFor(a.audience || 'kids', a.child_ids, k)).sort(achOrder);
// Daily limits: an item a kid has had all of today is gone from their store until tomorrow.
const usedUp = (kidId, itemId) => { const d = S.daily[kidId + itemId]; return !!d && d.allowed != null && d.used >= d.allowed; };
// A photo that still fails to load (gone, or the link ran out) shows its drawn picture instead.
// A Dash's description and each kid's own end arrive with the round-2 migration; before it, load without them.
const loadDashes = (f, full) => sb.from('dashes')
  .select(`id, title, ${full ? 'description, ' : ''}reward, payout, bonus, started_at, ends_at, stopped_at, bonus_child, dash_runners(child_id, status, paused_seconds, waiting_since, earned${full ? ', ends_at' : ''})`)
  .eq('family_id', f).gte('started_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('started_at');
const photoOr = (x, fallback) => {
  if (!x) return art(fallback);
  const p = x.photo_path && S.photos[x.photo_path];
  if (!p) return art(x.icon);
  const backup = `svg/art/${/^[a-z0-9-]+$/.test(x.icon || '') ? x.icon : fallback}.svg${V}`;
  return `<img class="photo" alt="" src="${esc(p.url)}" onerror="this.onerror=null;this.className='art';this.src='${backup}'">`;
};
const itemPic = item => photoOr(item, 'gift');
const achPic = a => photoOr(a, 'star');

// Live updates. The connection can drop quietly (Wi-Fi blips, the tablet dozing), and the Hub used
// to miss changes until someone woke the screen. Now a dropped channel reconnects and catches up,
// and a full re-check every two minutes (or when the network comes back) catches anything missed.
let channel, reloadTimer, rejoinTimer, rejoinWait = 2000;
const soon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 400); };
function listen() {
  clearTimeout(rejoinTimer);
  if (channel) sb.removeChannel(channel);
  const ch = channel = sb.channel('kiosk-' + S.family.id + '-' + Date.now());
  for (const table of ['children', 'achievements', 'reward_items', 'child_goals', 'ledger_entries', 'claims', 'dashes', 'dash_runners'])
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `family_id=eq.${S.family.id}` }, soon);
  // The family row itself (the Hub lock; its own id is the family id). Only once the database has
  // the lock: asking for a table that doesn't send live updates would break the whole channel.
  if ('hub_locked_until' in S.family)
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'families', filter: `id=eq.${S.family.id}` }, soon);
  // "One more today" from a parent's phone (round 3), for the same reason only once the server has it.
  if (S.round3) ch.on('postgres_changes', { event: '*', schema: 'public', table: 'daily_extras', filter: `family_id=eq.${S.family.id}` }, soon);
  ch.subscribe(status => {
    if (ch !== channel) return;
    if (status === 'SUBSCRIBED') { if (rejoinWait > 2000) soon(); rejoinWait = 2000; }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      clearTimeout(rejoinTimer);
      rejoinTimer = setTimeout(() => { if (ch === channel) listen(); }, rejoinWait);
      rejoinWait = Math.min(rejoinWait * 2, 60e3);
    }
  });
}
// What's on screen depends on these; a safety re-check that finds nothing new doesn't redraw.
const dataSig = () => JSON.stringify([S.kids, S.balances, S.items.map(i => i.id + i.price + i.name + i.icon + i.photo_path), S.achievements, S.goals,
  S.dashes, S.pending.map(c => c.id), S.entries.map(e => e.id), S.family?.hub_locked_until, needsOK('buy'), needsOK('did'), Object.values(S.photos).map(p => p.url), S.daily]);
// One reload at a time: two at once (waking up fires several) would both see the same request
// disappear, and the second would call an approved one declined. A reload asked for while one is
// running happens once it's done.
let reloading = null, reloadAgain = false;
async function reload(check) {
  if (reloading) { reloadAgain = true; return reloading; }
  reloading = reloadOnce(check).finally(() => { reloading = null; if (reloadAgain) { reloadAgain = false; reload(); } });
  return reloading;
}
async function reloadOnce(check) {
  const sig = check && dataSig();
  const before = Object.fromEntries(S.kids.map(k => [k.id, jarBal(k.id)])), asked = S.pending, earned = earnedNow();
  await load();
  if (check && dataSig() === sig) return;
  const gifts = newEntries();
  holdDashEarnings(earned, gifts);
  refresh(before, gifts, asked, approvals(asked, gifts));
  checkLinking();
  dashTick();
}

// What happened since we last looked: tokens per kid ({ amount, labels, icon }) and purchases.
// The first call only remembers what's already there, so starting the kiosk doesn't replay old news.
function newEntries() {
  const first = !S.seen, fresh = first ? [] : S.entries.filter(e => !S.seen.has(e.id));
  S.seen = new Set(S.entries.map(e => e.id));
  const by = new Map();
  by.fresh = fresh;
  by.buys = fresh.filter(e => e.category === 'purchase').reverse();
  for (const e of fresh.filter(e => e.category === 'deposit').reverse()) {
    const g = by.get(e.child_id) || { amount: 0, labels: [], icon: null };
    g.amount += e.amount; g.labels.push(e.label);
    g.icon ||= S.achievements.find(a => a.id === e.achievement_id)?.icon;
    by.set(e.child_id, g);
  }
  return by;
}
const unseen = id => { const u = S.unseen[id]; return u && Date.now() - u.at < NEW_HOURS * 3600e3 ? u : null; };

// "I did it!" requests a grown-up just approved, each with the Dappl Dots it brought. A request
// that went away with no matching deposit was declined.
function approvals(asked, gifts) {
  const still = new Set(S.pending.map(c => c.id)), used = new Set(), out = [];
  for (const c of asked) {
    if (c.kind !== 'did' || still.has(c.id)) continue;
    const e = (gifts.fresh || []).find(e => !used.has(e.id) && e.category === 'deposit' && e.source === 'approval' && e.child_id === c.child_id
      && (e.achievement_id ?? null) === (c.achievement_id ?? null) && e.amount === c.amount);
    const kid = S.kids.find(k => k.id === c.child_id);
    if (!e || !kid) continue;
    used.add(e.id);
    out.push({ c, e, kid });
  }
  return out;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Re-draws the current screen after new data (unless a dialog is open): numbers count to their
// new value, and jars that just got tokens celebrate.
function refresh(before = {}, gifts = new Map(), asked = [], earns = []) {
  if (S.kidId && !kid()) goSleep();
  // Purchases a grown-up approved get the big celebration, wherever the kiosk is.
  if (!S.lockShown) for (const e of gifts.buys || []) party({ buy: e });
  // Requests that went away without a purchase (or Dappl Dots) were declined.
  const stillWaiting = new Set(S.pending.map(c => c.id)), bought = new Set((gifts.buys || []).map(e => e.child_id + e.item_id));
  for (const c of asked) if (c.kind === 'buy' && !stillWaiting.has(c.id) && !bought.has(c.child_id + c.item_id) && c.child_id === S.kidId) toast(`Not this time: ${c.label}`);
  for (const c of asked) if (c.kind === 'did' && !stillWaiting.has(c.id) && !earns.some(x => x.c.id === c.id) && c.child_id === S.kidId) toast(`Not this time: ${c.label}`);
  // An approved "I did it!" is a bigger moment: on the kid's own screen, their jar fills in front
  // of them; on the family screen, the Dappl Dots drop into their jar (see pour). Elsewhere (or
  // with reduced motion) it's the usual toast and sticker.
  const mine = [], modalOpen = $modal.classList.contains('open');
  if (!reduced() && !S.lockShown) for (const x of earns) {
    const own = x.kid.id === S.kidId && (S.screen === 'home' || S.screen === 'store');
    const jar = S.screen === 'sleep' && !modalOpen && !slotDash(x.kid.id, Date.now());
    if (!own && !jar) continue;
    const g = gifts.get(x.kid.id);
    if (g) { g.amount -= x.e.amount; if (g.amount <= 0) gifts.delete(x.kid.id); }
    if (own) { mine.push(x); continue; }
    S.held[x.kid.id] = (S.held[x.kid.id] || 0) + x.e.amount;
    (S.pourFrom[x.kid.id] ||= []).push(x);
    S.unseen[x.kid.id] = { amount: (unseen(x.kid.id)?.amount || 0) + x.e.amount, at: Date.now() };
  }
  if (mine.length) party({ earn: mine });
  const list = S.kids.filter(k => gifts.has(k.id)).map(k => ({ ...gifts.get(k.id), kid: k, from: before[k.id] ?? Math.max(0, bal(k.id) - gifts.get(k.id).amount), to: bal(k.id) }));
  for (const g of list) if (g.kid.id !== S.kidId) S.unseen[g.kid.id] = { amount: (unseen(g.kid.id)?.amount || 0) + g.amount, at: Date.now() };
  if ($modal.classList.contains('open')) { if (list.length) toast(giftLine(list)); return; }
  render();
  for (const k of S.kids) { const v = jarBal(k.id); if (before[k.id] != null && before[k.id] !== v) document.querySelectorAll(`[data-k="${k.id}"]`).forEach(el => countFrom(el, before[k.id], v)); }
  celebrate(list);
}
const giftLine = list => list.map(g => g.kid.id === S.kidId ? `You got +${g.amount}!` : `${g.kid.name} got +${g.amount}!`).join('  ');

// ---------- screens ----------
function render() {
  // Closed from a parent's phone: everyone back to the lock screen (a Dash still runs, see hubClosed).
  S.lockShown = hubClosed();
  if (S.lockShown && S.screen !== 'pair' && S.screen !== 'loading') {
    S.kidId = null; S.screen = 'sleep'; S.grownUntil = 0; S.pendingBuy = null;
    if ($modal.classList.contains('open') && $modal.dataset.kind !== 'link') closeModal();
  }
  const k = kid();
  document.documentElement.style.setProperty('--kid', k ? k.color : '#FF6A3D');
  const draw = { pair: drawPair, sleep: S.lockShown ? drawLocked : drawSleep, home: drawHome, store: drawStore, dash: drawDash, loading: () => '<div class="k-pair"></div>' }[S.screen];
  document.body.classList.toggle('scene-on', S.screen === 'sleep');
  $screen.className = 'kscreen k-' + S.screen + (S.screen === 'sleep' && S.lockShown ? ' k-locked' : '') + (S.screen === 'sleep' && sky.day ? ' day' : '');
  // Where each kid's Dash picture is right now, so their winnings can pour out from there.
  $screen.querySelectorAll('[data-dash-done]').forEach(el => { S.dashRects[el.dataset.dashDone] = (el.querySelector('.sw-av, .drun-av') || el).getBoundingClientRect(); });
  // Held Dappl Dots only wait for a jar to pour into: not on a kid's screen or the closed screen.
  if ((S.screen !== 'sleep' && S.screen !== 'dash') || S.lockShown) { S.held = {}; S.pourFrom = {}; }
  // Redrawing the same screen (a card turning to "waiting", new data) keeps lists where they were scrolled.
  const same = S.drawn === S.screen + S.kidId, scrolled = same ? [...$screen.querySelectorAll('.kst-scroll')].map(e => e.scrollTop) : [];
  $screen.innerHTML = draw();
  S.drawn = S.screen + S.kidId;
  $screen.querySelectorAll('.kst-scroll').forEach((e, i) => { if (scrolled[i]) e.scrollTop = scrolled[i]; });
  wire();
  if (S.screen === 'sleep') pourHeld();
}

function drawPair() {
  return `<div class="card pair-card">
    <img class="brandmark" src="icon-192.png" alt="">
    <h1>Pair this Dappl Hub</h1>
    <p>On a parent's iPhone: Dappl Dots → Settings → <b>Set up a Dappl Hub</b>. Enter the code it shows.</p>
    <input class="pair-code" id="code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD2345" inputmode="text">
    <input class="pair-name" id="kname" maxlength="40" value="Kitchen Dappl Hub" aria-label="Dappl Hub name">
    <button class="bigbtn press" id="pair" disabled>Pair</button>
    <div class="pair-err" id="perr" role="alert"></div>
  </div>`;
}

// The family screen (shown when nobody is using the kiosk): everyone's jar, big. Up to 4 kids
// share one row, as before. With grown-ups, or more kids, the jars go in rows: the kids' (4 to a
// row at most, balanced: 5 is 3 + 2, 6 is 3 + 3), then the grown-ups' row, a bit smaller. Once
// there are rows, height is what runs out, so a row of 4 jars is about as big as a row of 3.
function drawSleep() {
  const now = new Date();
  const jar = k => {
    const sd = slotDash(k.id, now.getTime());
    if (sd) return dashSlot(k, sd);
    const u = unseen(k.id);
    const label = `<span class="jar-label">${avatar(k)}<b>${esc(k.name)}</b></span>` + (u ? `<span class="jar-new">+${u.amount} new!</span>` : '');
    // Kids with a Dappl Card open with it; grown-ups' jars open with their card or the grown-up sum.
    const lock = grownUp() ? '' : needsCard(k) ? `<span class="fj-card" title="Opens with a Dappl Card">${icon('card', 2.2)}</span>`
      : isGrown(k) ? `<span class="fj-card" title="Grown-ups only">${icon('lock', 2.2)}</span>` : '';
    return `<button class="fj press${isGrown(k) ? ' grown' : ''}" style="--c:${k.color}" data-sign="${k.id}" aria-label="${esc(k.name)}: ${bal(k.id)}">${jarHTML(k, label)}
      <span class="fj-bal">${tok(shown(k))}<span class="num" data-k="${k.id}">${jarBal(k.id)}</span>${lock}</span></button>`;
  };
  const kids = kidsOnly(), grown = grownUps();
  let jars;
  const kidRows = Math.max(1, Math.ceil(kids.length / 4)), multi = kidRows > 1 || grown.length > 0;
  if (!multi) jars = kids.map(jar).join('');
  else {
    const per = Math.ceil(kids.length / kidRows), rows = [];
    for (let i = 0; i < kids.length; i += per) rows.push(kids.slice(i, i + per));
    const row = (list, cls) => `<div class="fam-row ${cls}" style="--n:${list.length}">${list.map(jar).join('')}</div>`;
    jars = rows.map(r => row(r, 'kids')).join('') + (grown.length ? row(grown, 'grown') : '');
  }
  const template = [...Array(kidRows).fill('1.4fr'), ...(grown.length ? ['1fr'] : [])].join(' ');
  const carded = kids.filter(needsCard).length, anyCard = S.kids.some(needsCard);
  const hint = grownUp()
    ? `<div class="ks-hint grown">${icon('lock', 2.2)} Grown-up: tap any jar<span class="gr-state">${readerLine()}</span><button class="gr-done press" data-act="lockup">Lock</button></div>`
    : `<div class="ks-right"><div class="ks-hint">${carded ? icon('card', 2.2) : icon('star')} ${!carded ? 'Tap your jar to start' : carded === kids.length ? 'Tap your Dappl Card to start' : 'Tap your Dappl Card or your jar'}</div>
        ${anyCard ? `<button class="ks-grown press" data-act="grownup" aria-label="Grown-ups">${icon('lock', 2.2)}</button>` : ''}</div>`;
  return `<div class="ks-top"><div class="ks-time"><span class="t">${clock(now)}</span>
      <span class="d">${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      ${soundOff() ? `<span class="ks-sound">${icon('mute', 2.2)}Tap for sound</span>` : ''}</div>
      ${hint}</div>
    <div class="fam${multi ? ' multi' : ''}" style="--n:${Math.max(1, kids.length)};--rows:${template}">${jars || `<div class="ks-empty">No kids yet. Add them in the Dappl Dots app.</div>`}</div>`;
}
// ---------- closing the Hub ----------
// A parent can close the Hub from their phone, for a while or until they open it again
// (families.hub_locked_until; the year 9999 means "until a parent opens it"). Nothing on the
// tablet opens it. A Dappl Dash still runs, since a parent started it on purpose.
const lockedUntil = () => { const t = S.family?.hub_locked_until ? new Date(S.family.hub_locked_until).getTime() : 0; return t > Date.now() ? t : 0; };
const hubClosed = () => !!lockedUntil() && !S.dashes.some(d => !dashOver(d));
function drawLocked() {
  const now = new Date(), until = lockedUntil(), openEnded = until > Date.UTC(3000, 0);
  const at = new Date(until), time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const when = openEnded ? 'A grown-up will open it from their phone.'
    : at.toDateString() === now.toDateString() ? `Opens at ${time}.` : `Opens ${at.toLocaleDateString([], { weekday: 'long' })} at ${time}.`;
  return `<div class="ks-top"><div class="ks-time"><span class="t">${clock(now)}</span>
      <span class="d">${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span></div></div>
    <div class="hub-closed"><div class="lk-badge"><svg class="ic" viewBox="0 0 24 24" stroke-width="1.6" aria-hidden="true">${IC.lock}</svg></div>
      <h1>Your Dappl Hub is closed for now</h1><p>${when}</p></div>`;
}
const closedToast = () => toast('The Dappl Hub is closed for now.');

// ---------- the sky ----------
// The family screen's background is coloured light, not a picture: a gradient with soft glows of
// colour drifting through it, clouds sliding by in the day and stars twinkling at night, a broad warm light that crosses the screen with the sun, and a pool
// of light where the jars stand, so they sit in a space rather than on a flat page. It follows the
// day: dark with stars until 5 a.m., a slow blue hour to 6:15, then dawn through rose and peach
// (the stars fade by about 6:30) to pretty light by 7 and full morning by 7:40, clear blue
// through the day, golden in the mid-afternoon, coral and plum at sunset, and full night by
// 6:45 p.m. Colours move a little every minute, so it never visibly switches. Text and jars switch
// between their light and night looks once each way, around 6:40 a.m. and 5:40 p.m.
// It costs little: the colours are drawn once (and again only when they change, about once a
// minute); the glows and floating Dappl dots only slide and fade, which the tablet's graphics chip
// does without redrawing anything. Nothing moves with ?still or reduced motion.
// From 11 p.m. to 5 a.m. nobody uses the Hub, so it rests: nothing moves, and the tablet's
// graphics chip has nothing to do. The still night colours cost nothing once drawn.
// ?sky=14:30 shows a time of day; ?sky=fast runs a day in 2 minutes.
const REST_FROM = 23 * 60, REST_UNTIL = 5 * 60;
const NIGHT = ['#141B3E', '#0A0F24', '#4B3F9E', '#1C5F86', '#7B3F9A'];
const SKY = [   // [minutes after midnight, top, bottom, warm glow, cool glow, accent glow]
  [0, ...NIGHT], [300, ...NIGHT],
  [360, '#172048', '#1B2148', '#54439F', '#26608F', '#7C429C'],   // 6:00 blue hour, stars still out
  [375, '#202762', '#3B3068', '#A65C8E', '#44589F', '#8352B4'],   // 6:15 first light
  [400, '#4C5398', '#C77E92', '#F08A80', '#B87BB8', '#9C7AD8'],   // 6:40 dawn, stars gone
  [420, '#8E9FE6', '#FFC9B8', '#FFAA7E', '#F59AC0', '#AE9CF2'],   // 7:00 sunrise
  [460, '#88B4F4', '#FFDCC4', '#FFC27E', '#86CDF0', '#B9A4F4'],   // 7:40 morning
  [600, '#6FA8F4', '#BFDCFF', '#FFD27A', '#62D2C8', '#A2A8FF'],   // 10:00 clear blue
  [900, '#789FEB', '#FFD9B8', '#FFBE66', '#F3A0B6', '#9AAAF5'],   // 3:00 golden
  [1020, '#6E6FD0', '#FFAE92', '#FF9466', '#F07AA4', '#8C82E2'],  // 5:00 coral
  [1065, '#4A3F90', '#D9707A', '#FF8457', '#D2528A', '#6A4EB8'],  // 5:45 sunset
  [1100, '#252557', '#4E3266', '#B04E7E', '#41408E', '#2E4C82'],  // 6:20 plum dusk
  [1125, ...NIGHT], [1440, ...NIGHT]];                           // 6:45 night
const SUNRISE = 375, SUNSET = 1090;   // the warm light's path across the screen, in minutes after midnight
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
// Blends go round the colour wheel (OKLCH), so green turns gold then rose on its way to plum,
// instead of passing through grey the way a straight RGB blend would.
const toLch = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
};
const fromLch = ([L, C, h]) => {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + .3963377774 * A + .2158037573 * B) ** 3, m = (L - .1055613458 * A - .0638541728 * B) ** 3, s = (L - .0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map(c => Math.round(255 * Math.min(1, Math.max(0, c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055))).toString(16).padStart(2, '0')).join('');
};
const blend = (a, b, t) => {
  if (a === b) return a;
  const [L1, C1, h1] = toLch(a), [L2, C2, h2] = toLch(b);
  let dh = h2 - h1; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  // A near-grey end has no real hue: take the other one's, so it doesn't swing round the wheel.
  const h = C1 < .02 ? h2 : C2 < .02 ? h1 : h1 + dh * t;
  return fromLch([L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, h]);
};
const sky = { day: false, key: '' };
function skyMinutes() {
  const p = params.get('sky');
  if (p === 'fast') return (Date.now() / 1000 % 120) / 120 * 1440;
  const m = /^(\d{1,2}):(\d{2})$/.exec(p || '');
  if (m) return Math.min(1439, Number(m[1]) * 60 + Number(m[2]));
  const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
// The scene lives behind #screen and stays put while screens redraw, so nothing in it restarts.
const SCENE = (() => {
  // Stars: a fixed scatter (the same every night), in two layers that twinkle out of step.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = n => Array.from({ length: n }, () => `${(rnd() * 100).toFixed(1)}vw ${(rnd() * 70).toFixed(1)}vh 0 ${rnd() < .2 ? '.12vw' : '.05vw'} rgba(255,255,255,${(.4 + rnd() * .5).toFixed(2)})`).join(',');
  // The floating Dappl dots: specks of light drifting up. [left %, top %, size, seconds, delay]
  const motes = [[9, 62, 1.1, 23, -4], [18, 78, 0.7, 29, -17], [27, 55, 0.5, 19, -9], [38, 84, 0.9, 31, -2], [52, 66, 0.6, 26, -20],
    [63, 80, 1.0, 22, -11], [74, 58, 0.7, 34, -6], [84, 74, 0.5, 27, -14], [92, 61, 0.9, 30, -24]];
  const el = document.createElement('div');
  el.id = 'scene'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="sc-light"></div><div class="sc-stars" style="--s:${stars(70)}"></div><div class="sc-stars b" style="--s:${stars(50)}"></div>
    <div class="sc-glow"></div><div class="sc-glow b"></div><div class="sc-clouds"><i></i><i></i><i></i></div><div class="sc-pool"></div>
    <div class="sc-motes">${motes.map(([x, y, s, d, del]) => `<i style="left:${x}%;top:${y}%;--m:${s}vw;animation-duration:${d}s;animation-delay:${del}s"></i>`).join('')}</div>`;
  document.body.prepend(el);
  return el;
})();
function applySky() {
  const t = skyMinutes(), i = SKY.findIndex(([m]) => m > t), A = SKY[i - 1], B = SKY[i];
  const f = (t - A[0]) / (B[0] - A[0]), c = A.slice(1).map((x, j) => blend(x, B[j + 1], f));
  const [top, bottom, warm, cool, accent] = c;
  // The broad light: up from the lower left in the morning, high in the middle of the day, down to
  // the right by evening. At night a cool glow takes the same path.
  const up = t >= SUNRISE && t <= SUNSET, span = up ? SUNSET - SUNRISE : 1440 - (SUNSET - SUNRISE);
  const p = ((t - (up ? SUNRISE : SUNSET)) + 1440) % 1440 / span;
  const x = (8 + p * 84).toFixed(1), y = (55 - Math.sin(p * Math.PI) * 50).toFixed(1);
  SCENE.classList.toggle('rest', t >= REST_FROM || t < REST_UNTIL);
  const key = c.join('') + x + y; if (key === sky.key) return;
  sky.key = key;
  const s = SCENE.style, night = Math.max(0, Math.min(1, (.08 - lum(top)) / .06));   // stars come out, clouds fade
  Object.entries({ '--night': night.toFixed(2), '--top': top, '--bottom': bottom, '--warm': warm, '--cool': cool, '--accent': accent, '--light': up ? warm : cool,
    '--sun-x': x + 'vw', '--sun-y': y + 'vh' }).forEach(([k, v]) => s.setProperty(k, v));
  // The pill behind the jars' balances: none while the sky near the jars is dark, fully there once
  // it's light (about 6:30 to 6:45 a.m., and 5:30 to 5:55 p.m.).
  document.body.style.setProperty('--pill', Math.max(0, Math.min(1, (lum(bottom) - .12) / .2)).toFixed(2));
  // Light look: dark text and the daytime jars.
  const day = lum(mix(top, bottom, .5)) > .2;
  if (day !== sky.day) { sky.day = day; SCENE.classList.toggle('day', day); if (S.screen === 'sleep') $screen.classList.toggle('day', day); }
}
applySky();

const clock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');

// Requests this kid is waiting on, under their jar: "🕒 Small toy", "🕒 Dry pull-up".
const waitingChips = k => { const w = waiting(k.id).filter(c => c.kind !== 'did'); return w.length ? `<div class="waiting"><span class="wt-head">${icon('clock', 2.4)}Waiting for a grown-up</span>
  <span class="wt-list">${w.slice(0, 4).map(c => `<span class="wchip">${c.kind === 'buy' ? itemPic(S.allItems.find(i => i.id === c.item_id))
    : achPic(S.achievements.find(a => a.id === c.achievement_id))}${esc(c.label)}</span>`).join('')}</span></div>` : ''; };

// ---------- jars ----------
// Tokens fill the jar in rows of 5 and 4, a little jumbled. Positions are % of the jar's inside.
const rnd = j => ((Math.sin(j * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;
function slot(j) {
  let row = 0, i = j;
  while (i >= (row % 2 ? 4 : 5)) { i -= row % 2 ? 4 : 5; row++; }
  return { x: (row % 2 ? 10.4 : .6) + i * 19.6 + (rnd(j) - .5) * 2.4, y: row * 11.2 + rnd(j + 99) * 1.6, rot: Math.round((rnd(j + 7) - .5) * 70) };
}
const coinHTML = (k, j) => { const p = slot(j); return `<span class="jt" style="left:${p.x.toFixed(1)}%;bottom:${p.y.toFixed(1)}%;transform:rotate(${p.rot}deg)">${tok(pile(shown(k), j), '')}</span>`; };
function jarHTML(k, label = '', count = jarBal(k.id)) {
  const n = Math.min(count, CAP);
  return `<div class="jar" data-jar="${k.id}" style="--c:${k.color}"><div class="jar-lid"></div>
    <div class="jar-body"><div class="jar-coins">${Array.from({ length: n }, (_, j) => coinHTML(k, j)).join('')}</div><div class="jar-shine"></div></div>${label}</div>`;
}

function topBar(left) {
  return `<div class="kh-top">${left ?? `<span class="kh-brand">${tok('dappldots')}${esc(S.family?.name || 'Dappl Hub')}</span>`}
    <span class="kh-right"><span class="kh-timer">Back to sleep in<span class="kh-ring"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="4"/><circle id="ring" cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="100.5 100.5" transform="rotate(-90 20 20)"/></svg><span id="secs">${IDLE_SECONDS}</span></span></span>
    <button class="kdone press" data-act="sleep">Done</button></span></div>`;
}

// A kid's own screen, after they tap their Dappl Card. Their Dappl Dots and goal are small (the
// family screen already shows their jar big); most of the screen is "What did you do?", so they
// can report what they did themselves ("Go give yourself a Dappl Dot!"). A grown-up still says OK
// on their phone. First comes the big "+1 Dappl Dot" (for "Go get a Dappl Dot!"), then this kid's
// achievements in the parents' order. A card they've tapped says it's waiting for a grown-up
// (no pop-up: kids thought they had to do something in it). Buy opens the list of things to
// spend Dappl Dots on.
function drawHome() {
  const k = kid(), g = goalItem(k.id), b = bal(k.id);
  const who = `<span class="kh-who">
      <button class="kd-who press" data-act="avatar" aria-label="Change how you look">${avatar(k)}<span class="kname">${esc(k.name)}</span><span class="swap">${icon('pencil', 2.2)}</span></button>
      <button class="kbal press" data-act="theme" aria-label="Change what goes in your jar">${tok(shown(k))}<span class="num" data-k="${k.id}">${b}</span>
        <span class="kbal-unit">${unit(k, b)}</span><span class="swap">${icon('pencil', 2)}</span></button></span>`;
  let goal;
  if (g) {
    const price = g.price, left = Math.max(0, price - b);
    goal = `<div class="card kg2${left ? '' : ' reached'}"><span class="kg-eyebrow">${icon('flag', 2.2)}My goal<button class="kg-change press" data-act="store">Change</button></span>
      <div class="kg2-row"><span class="kg2-art">${itemPic(g)}</span><span class="kg-title">${esc(g.name)}</span></div>
      <div class="prog"><i style="width:${Math.min(100, b / price * 100)}%"></i></div>
      <span class="kg-left"><b>${Math.min(b, price)}/${price}</b> · ${left ? `${left} more to go!` : 'You can buy it!'}</span></div>`;
  } else {
    goal = `<button class="card kg2 none press" data-act="store"><span class="kg-eyebrow">${icon('flag', 2.2)}My goal</span>
      <span class="kg-title">What are you saving for?</span><span class="kg-left">Pick something in Buy</span></button>`;
  }
  const wait = `<span class="kflag asked">${icon('hourglass', 2.4)}Waiting for a grown-up</span>`;
  // "+1 Dappl Dot" needs the round-3 database (before it, the server would refuse it).
  const dot = S.round3 && !isGrown(k) ? `<button class="kitem dot-card press can${asked(k, null) ? ' waiting' : ''}" data-claim="dot">${asked(k, null) ? wait : ''}
      <span class="ki-art">${tok(pile(shown(k), 0), 'dot-art')}</span><span class="dot-words"><b>+1</b><em>Dappl Dot</em>
      <span>When a grown-up says “Go get one!”</span></span></button>` : '';
  const did = kidAchievements(k).map(a => `<button class="kitem press can${asked(k, a.id) ? ' waiting' : ''}" data-claim="${a.id}">${asked(k, a.id) ? wait : ''}<span class="ki-art">${achPic(a)}</span>
    <span class="ki-name">${esc(a.name)}</span>${a.description ? `<span class="ki-desc">${esc(a.description)}</span>` : ''}<span class="kplus">+${a.value}</span></button>`).join('');
  const none = isGrown(k) ? 'No grown-up achievements yet. Add them in the Dappl Dots app: Settings, Achievements, “For grown-ups”.'
    : 'No achievements set up yet. A grown-up adds them in the Dappl Dots app.';
  return topBar(who) + `<div class="kd2">
    <div class="kd2-left">${goal}${waitingChips(k)}
      <button class="kredeem press" data-act="store">${dapplCard()}<span>Buy</span></button></div>
    <div class="card kd2-did${full(k, 'did') ? ' held' : ''}"><h2>${icon('star', 2.2)}What did you do?</h2>
      <div class="kst-scroll"><div class="kst-grid did">${dot}${did || (dot ? '' : `<div class="kempty">${none}</div>`)}</div></div>${full(k, 'did') ? heldNote('did') : ''}</div>
  </div>`;
}
// This kid already asked for this achievement (null: "+1 Dappl Dot") and a grown-up hasn't answered.
const asked = (k, achId) => waiting(k.id).some(c => c.kind === 'did' && (c.achievement_id ?? null) === achId);
// A Dappl Card with a blue Dappl Dot: the Buy button's picture (and the app icon's).
// Drawn like icon E (design/icon/make.py): a white card, tilted, with tap waves off its right edge.
const dapplCard = (cls = '') => `<span class="dcard ${cls}" aria-hidden="true"><span class="dcard-face">${tok('dappldots-blue', '')}</span>
  <svg class="dcard-waves" viewBox="0 0 40 60">${[0, 1, 2].map(i => `<path d="M${4 + i * 9} ${22 - i * 7}a${9 + i * 7} ${9 + i * 7} 0 0 1 0 ${16 + i * 14}" opacity="${(.95 - i * .3).toFixed(2)}"/>`).join('')}</svg></span>`;

function storeTop(title) {
  const k = kid();
  return `<div class="kst-top"><button class="kback press" data-act="home" aria-label="Back">${icon('back')}</button>${avatar(k)}<b>${title}</b>
    <span class="kpill">${tok(shown(k))}<span class="num" data-k="${k.id}">${bal(k.id)}</span></span></div>`;
}

function drawStore() {
  const k = kid(), b = avail(k.id);
  // An item a kid has had all of today ("2 candies a day") is gone until tomorrow.
  const cards = S.items.filter(it => itemFor(it, k) && !usedUp(k.id, it.id)).map(it => {
    const q = it, can = b >= q.price, isGoal = S.goals[k.id] === it.id;
    const asked = waiting(k.id).some(c => c.kind === 'buy' && c.item_id === it.id);
    return `<button class="kitem press ${can ? 'can' : 'locked'}" data-buy="${it.id}">
      ${asked ? `<span class="kflag asked">${icon('clock', 2.4)}Asked</span>` : isGoal ? `<span class="kflag">${icon('flag', 2.4)}My goal</span>` : ''}
      <span class="ki-art">${itemPic(it)}</span><span class="ki-name">${esc(it.name)}</span>
      <span class="ki-price">${tok(shown(k))}${q.price}</span>
      <span class="ki-need"><span class="prog"><i style="width:${Math.min(100, b / q.price * 100)}%"></i></span><span>${b}/${q.price}</span></span></button>`;
  }).join('');
  const list = `<div class="kst-scroll"><div class="kst-grid">${cards || '<div class="kempty">The store is empty right now.</div>'}</div></div>`;
  return storeTop('Buy') + (full(k, 'buy') ? `<div class="kst-wrap held">${list}${heldNote('buy')}</div>` : list);
}

// ---------- dialogs ----------
function openModal(html, kind = '') { $modal.dataset.kind = kind; $modal.innerHTML = `<div class="kc-card${html.wide ? ' wide' : ''}${html.cls ? ' ' + html.cls : ''}">${html.body ?? html}</div>`; $modal.classList.add('open'); wire($modal); }
// Tapping the dimmed area around a pop-up closes it, like its close button. Not while a card is
// being linked: that one closes itself when the parent finishes or the time runs out.
$modal.addEventListener('click', e => { if (e.target === $modal && $modal.dataset.kind !== 'link') closeModal(); });
function closeModal() { S.pendingBuy = null; $modal.classList.remove('open'); setTimeout(() => { if (!$modal.classList.contains('open')) $modal.innerHTML = ''; }, 300); }

// Tapping something in the store. Enough tokens: ask a grown-up to buy it (they approve on
// their phone). Not enough: save for it instead.
function confirmBuy(itemId) {
  const k = kid(), it = S.items.find(i => i.id === itemId); if (!it || !itemFor(it, k) || usedUp(k.id, it.id)) return;
  if (full(k, 'buy')) return toast(HELD.buy[2]);
  const q = it, b = avail(k.id), need = q.price - b, isGoal = S.goals[k.id] === it.id;
  const top = `<div class="kc-art">${itemPic(it)}</div><b class="kc-name">${esc(it.name)}</b>`;
  const math = `<div class="kc-math"><span class="kcm">${tok(shown(k))}<span class="num">${b}</span></span>${icon('arrow')}<span class="kcm">${tok(shown(k))}<span class="num">${b - q.price}</span></span></div>`;
  // Enough Dappl Dots. A kid with a Dappl Card taps it to buy, like paying with a card; kids
  // without one (and grown-ups helping) tap the button instead. A grown-up says OK on their phone,
  // unless the parents turned that off (or it's a grown-up's own jar).
  if (need <= 0 && needsCard(k) && !grownUp()) {
    S.pendingBuy = { kidId: k.id, itemId: it.id, until: Date.now() + SCAN_MS };
    openModal(top + math + `<div class="scan" aria-hidden="true"><span class="scan-reader">${icon('card', 1.8)}<i></i><i></i></span>
        <span class="scan-card">${tok('dappldots-blue', '')}</span></div>
      <b class="kc-name scan-ask">Tap your Dappl Card to buy</b>
      <div class="kc-btns"><button class="kno wide press" data-act="close">Never mind</button></div>
      <span class="kc-sub">${needsOK('buy') ? 'Then a grown-up says OK on their phone.' : "Then it's yours!"}</span>`, 'scan');
    const mine = S.pendingBuy;
    return setTimeout(() => { if (S.pendingBuy === mine && $modal.dataset.kind === 'scan') closeModal(); }, SCAN_MS);
  }
  if (need <= 0) return openModal(top + math + `
      <div class="kc-btns"><button class="kno press" data-act="close" aria-label="Not now">${icon('x', 2.6)}</button><button class="kask press" data-confirm-buy="${it.id}">${icon('check', 2.8)}Buy</button></div>
      ${needsOK('buy') ? '<span class="kc-sub">A grown-up says OK on their phone.</span>' : ''}`);
  const held = bal(k.id) >= q.price;   // they'd have enough, but it's promised to other asks
  openModal(top + `<div class="kc-need"><span class="prog"><i style="width:${Math.min(100, b / q.price * 100)}%"></i></span><span>${held ? 'Wait until a grown-up answers your other asks' : `${need} more ${unit(k, need)} to go`}</span></div>` + (isGoal
    ? `<div class="kc-btns"><button class="kno wide press" data-act="close">It's my goal! OK</button></div>`
    : `<div class="kc-btns"><button class="kno press" data-act="close" aria-label="Not now">${icon('x', 2.6)}</button><button class="kgoal press" data-save="${it.id}">${icon('flag', 2.6)}Save for this</button></div>`));
}

function chooseTheme() {
  const k = kid(), now = shown(k);
  const title = s => s[0].toUpperCase() + s.slice(1);
  const opt = ([key, [name]]) => `<button class="tk-opt press${key === now ? ' on' : ''}" data-theme="${key}">${FEATURED[key] ? '<span class="tk-badge">Featured</span>' : ''}${tok(key, '')}${title(name)}</button>`;
  openModal({ wide: true, cls: 'themes', body: `<b class="kc-name">What goes in your jar?</b><span class="kc-sub">Same Dappl Dots, new look.</span>
    <div class="tk-grid">${Object.entries(TOKENS).map(opt).join('')}</div>
    <div class="kc-btns"><button class="kno wide press" data-act="close">Done</button></div>` });
}

// Change how you look: animal, fur colour and a little extra. The big face shows the choice.
const ANIMALS = ['fox', 'lion', 'bunny', 'bear', 'panda', 'cat', 'owl', 'monkey'], EXTRAS = ['none', 'bow', 'glasses', 'crown'];
function chooseAvatar(draft) {
  const k = kid(); draft ||= { animal: 'bear', extra: 'none', ...k.avatar };
  const as = a => avatar({ ...k, avatar: a });
  const pick = (attr, value, label) => `<button class="av-opt press${(draft[attr] ?? null) === value ? ' on' : ''}" data-av="${attr}" data-v="${value ?? ''}" aria-label="${label}">${as({ ...draft, [attr]: value })}</button>`;
  openModal({ wide: true, body: `<div class="av-preview">${as(draft)}</div>
    <div class="av-row">${ANIMALS.map(a => pick('animal', a, a)).join('')}</div>
    <div class="av-row">${[null, ...FURS].map(f => pick('fur', f, f ? 'colour' : 'natural')).join('')}</div>
    <div class="av-row">${EXTRAS.map(e => pick('extra', e, e)).join('')}</div>
    <div class="kc-btns"><button class="kno press" data-act="close" aria-label="Never mind">${icon('x', 2.6)}</button><button class="kask press" data-av-save>${icon('check', 2.8)}That's me!</button></div>` });
  $modal.querySelectorAll('[data-av]').forEach(b => b.onclick = () => chooseAvatar({ ...draft, [b.dataset.av]: b.dataset.v || null }));
  $modal.querySelector('[data-av-save]').onclick = () => act(setAvatar(draft));
}

// ---------- actions ----------
async function call(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const msg = { TB008: 'Time ran out. Tap "Link a Dappl Card" in the app again.', TB001: "Not enough yet! Some may be waiting on other asks.", TB004: "That's not in the store anymore.", TB007: "Lots of requests are already waiting. Ask a grown-up!", TB010: "There's no Dappl Dash going right now.", TB011: "Oh no, the clock ran out!", TB013: "That's all of those for today!" }[error.code] || 'Something went wrong. Try again.';
    toast(msg); error.shown = true; throw error;
  }
  return data;
}

// Ask a grown-up to buy it. Nothing is spent until they approve; then everyone sees the party.
// (Unless the parents don't approve purchases: then it's bought right away, same party.)
async function buy(itemId, from) {
  const k = kid(), it = S.items.find(i => i.id === itemId);
  if (full(k, 'buy')) { closeModal(); return toast(HELD.buy[2]); }
  if (from) from.disabled = true;   // one tap, one request
  let c;
  try { c = await call('request_purchase', { p_child: k.id, p_item: itemId, p_id: uuid() }); }
  finally { if (from) from.disabled = false; }
  const d = S.daily[k.id + itemId]; if (d) d.used++;   // counts toward today's limit straight away
  // The parents don't approve purchases: it's bought already. The reload finds the purchase and
  // throws the same party as when a grown-up approves one.
  if (c.status === 'approved') { closeModal(); S.screen = 'home'; render(); return reload(); }
  if (!S.pending.some(x => x.id === c.id)) S.pending.push(c);
  if (full(k, 'buy')) S.justHeld = 'buy';
  openModal(`<div class="kc-art">${itemPic(it)}</div><b class="kc-name">Asked!</b>
    <span class="kc-sub">A grown-up will say OK on their phone. Then ${esc(it.name)} is yours.</span>`);
  setTimeout(() => { if ($modal.textContent.includes('Asked!')) { closeModal(); S.screen = 'home'; render(); } }, 2800);
}

async function saveFor(itemId) {
  const k = kid();
  await call('set_goal', { p_child: k.id, p_item: itemId, p_via: 'kiosk' });
  S.goals[k.id] = itemId; closeModal(); S.screen = 'home'; render(); toast('Saving for it!');
}

// "I did it!" (achId null: "+1 Dappl Dot"). No pop-up: the card itself turns to "Waiting for a
// grown-up" until they answer, and tapping it again just says so.
async function claim(achId, from) {
  const k = kid();
  if (asked(k, achId)) {
    from?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0)' }], { duration: 400 });
    return toast(`A grown-up is checking, ${k.name}!`);
  }
  if (full(k, 'did')) return toast(HELD.did[2]);
  if (from) from.disabled = true;   // one tap, one request
  let c;
  try { c = await call('submit_claim', { p_child: k.id, p_achievement: achId }); }
  finally { if (from) from.disabled = false; }
  if (!S.pending.some(x => x.id === c.id)) S.pending.push(c);
  burst(from, shown(k), { n: 10 });
  clink();
  // The parents don't approve achievements: the Dappl Dots are in already. The reload sees the
  // request answered and drops them into the jar, as when a grown-up approves.
  if (c.status === 'approved') return reload();
  if (full(k, 'did')) { S.justHeld = 'did'; setTimeout(() => { if (S.kidId === k.id) toast(HELD.did[2]); }, 700); }
  if (S.kidId === k.id && S.screen === 'home' && !$modal.classList.contains('open')) render();
}

async function setTheme(theme) {
  const k = kid();
  await call('set_token_theme', { p_child: k.id, p_theme: theme });
  k.token_theme = theme;
  closeModal(); render();
}

async function setAvatar(a) {
  const k = kid(), clean = { animal: a.animal, extra: a.extra || 'none', ...(a.fur ? { fur: a.fur } : {}) };
  await call('set_avatar', { p_child: k.id, p_avatar: clean });
  k.avatar = clean; closeModal(); render();
}

async function pair() {
  const code = document.getElementById('code').value.trim().toUpperCase(), name = document.getElementById('kname').value.trim();
  const err = document.getElementById('perr'), btn = document.getElementById('pair');
  btn.disabled = true; err.textContent = '';
  try {
    if (!(await sb.auth.getSession()).data.session) { const { error } = await sb.auth.signInAnonymously(); if (error) throw error; }
    const { error } = await sb.rpc('pair_kiosk', { p_code: code, p_name: name || 'Kiosk' });
    if (error) throw error;
    await start();
  } catch (e) {
    err.textContent = e.code === 'TB006' ? "That code didn't work. Codes last 15 minutes; make a new one in the app." : (e.message || 'Could not pair.');
    btn.disabled = false;
  }
}

function goSleep() { S.kidId = null; S.screen = 'sleep'; closeModal(); changeScreen(); }
function openKid(id) { if (lockedUntil()) return closedToast(); S.kidId = id; delete S.unseen[id]; S.screen = 'home'; closeModal(); poke(); changeScreen(); }
// Opening a kid's screen (their card or their jar) and going back to the family screen fade
// instead of switching at once. The new screen's pictures are loaded first (a moment at most, so
// nothing pops in during the fade); then the old screen fades out as the new one fades in, and a
// kid's cards rise gently into place (see "screen changes" in kiosk.css). Chrome does the fade
// itself (a view transition); without it, or with reduced motion, the screen just switches.
let changing = 0;
async function changeScreen() {
  const n = ++changing;
  if (reduced() || !document.startViewTransition || document.hidden) return render();
  await warmPictures();
  if (n !== changing) return;   // another change came first
  document.startViewTransition(() => { render(); if (S.screen === 'home') $screen.classList.add('enter'); });
}
function warmPictures() {
  const draw = { sleep: hubClosed() ? drawLocked : drawSleep, home: drawHome }[S.screen];
  const t = document.createElement('template');
  try { t.innerHTML = draw ? draw() : ''; } catch { return Promise.resolve(); }
  const loads = [...t.content.querySelectorAll('img[src]')].map(el => { const i = new Image(); i.src = el.getAttribute('src'); return i.decode().catch(() => {}); });
  return Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 300))]);
}

// Actions show a toast when they fail (RPC errors already did), rather than failing silently.
const act = p => p.catch(e => { console.error(e); if (!e?.shown) toast('Something went wrong. Try again.'); });

// One click handler for everything (buttons carry data- attributes).
function wire(root = $screen) {
  root.querySelectorAll('[data-sign]').forEach(b => b.onclick = () => {
    const k = S.kids.find(x => x.id === b.dataset.sign);
    if (k && needsCard(k) && !grownUp()) return askForCard(b, k);
    // A grown-up's jar without a card: the grown-up sum, then straight into their jar (their
    // achievements go in without anyone's OK, so kids mustn't open it).
    if (k && isGrown(k) && !grownUp()) return lockedUntil() ? closedToast() : askGrownUp(`${k.name}'s jar`, () => openKid(k.id));
    openKid(b.dataset.sign);
  });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'sleep') goSleep();
    else if (a === 'close') closeModal();
    else if (a === 'theme') chooseTheme();
    else if (a === 'avatar') chooseAvatar();
    else if (a === 'grownup') askGrownUp();
    else if (a === 'lockup') { S.grownUntil = 0; render(); }
    else if (a === 'cancel-link') act(cancelLink());
    else if (a === 'reader') checkLinking(true);
    else { S.screen = a; render(); }
  });
  root.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => confirmBuy(b.dataset.buy));
  root.querySelectorAll('[data-held]').forEach(b => b.onclick = () => { poke(); toast(HELD[b.dataset.held][2]); });
  root.querySelectorAll('[data-confirm-buy]').forEach(b => b.onclick = () => act(buy(b.dataset.confirmBuy, b)));
  root.querySelectorAll('[data-save]').forEach(b => b.onclick = () => act(saveFor(b.dataset.save)));
  root.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => act(claim(b.dataset.claim === 'dot' ? null : b.dataset.claim, b)));
  root.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => act(setTheme(b.dataset.theme)));
  root.querySelectorAll('[data-dash-done]').forEach(b => b.onclick = () => dashDoneTap(b.dataset.dashDone, b));
  root.querySelectorAll('[data-dash-finish]').forEach(b => b.onclick = () => act(finishDash(b.dataset.dashFinish, b)));
  const code = root.querySelector('#code');
  if (code) {
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); root.querySelector('#pair').disabled = code.value.length !== 8; };
    root.querySelector('#pair').onclick = pair;
  }
}

// ---------- idle timer, clock, full screen ----------
let idle = IDLE_SECONDS;
function poke() { idle = IDLE_SECONDS; lastStir = Date.now(); }
setInterval(() => {
  applySky();
  checkLinking();
  dashTick();
  if (S.family && S.screen !== 'pair' && S.screen !== 'dash' && hubClosed() !== !!S.lockShown) { render(); return; }
  if (S.screen === 'sleep') {
    // A pop-up left open on the family screen (the grown-ups' sum, "this card isn't linked"…) closes
    // after a minute untouched, like a kid's screen does. Otherwise it would also block updates.
    if ($modal.classList.contains('open') && $modal.dataset.kind !== 'link' && Date.now() - lastStir > IDLE_SECONDS * 1000) closeModal();
    const t = document.querySelector('.ks-time .t');
    const now = clock(new Date()); if (t && t.textContent !== now) t.textContent = now;   // only redraw when the minute changes
    if (S.grownUntil && !grownUp()) { S.grownUntil = 0; render(); }
    if (updateReady && quiet()) location.reload();
    return;
  }
  if (!S.kidId || S.noSleep) return;
  idle -= 1;
  const secs = document.getElementById('secs'), ring = document.getElementById('ring');
  if (secs) secs.textContent = Math.max(idle, 0);
  if (ring) ring.setAttribute('stroke-dasharray', `${(Math.max(idle, 0) / IDLE_SECONDS * 100.5).toFixed(1)} 100.5`);
  if (idle <= 0) goSleep();
}, 1000);
// Keep the screen on. Chrome lets a page ask without a tap, so ask straight away: after the Hub
// reloads itself for an update, nobody has tapped yet, and asking only on a tap let the tablet
// time out and lock. Android drops the lock whenever the page is hidden (screen off, another
// app), so ask again when it's back, and every minute in case it was dropped quietly.
let awake = null, asking = false;
function stayAwake() {
  if (!('wakeLock' in navigator) || awake || asking || document.visibilityState !== 'visible') return;
  asking = true;
  navigator.wakeLock.request('screen').then(l => { awake = l; l.addEventListener('release', () => { awake = null; }); })
    .catch(() => {}).finally(() => { asking = false; });
}
stayAwake();
document.addEventListener('visibilitychange', stayAwake);
setInterval(stayAwake, 60e3);
document.addEventListener('pointerdown', poke, { capture: true });
// Browsers only allow some things right after a person taps (on touch screens, that's when the
// finger lifts): sound, full screen, and asking to use the card reader.
document.addEventListener('pointerup', () => {
  startNfc(true);
  // Sound can only start after a tap; after that, a jar getting tokens goes "clink".
  startAudio();
  // Full screen and keep the screen on, once a person has tapped (browsers require a tap).
  if (!document.fullscreenElement && document.documentElement.requestFullscreen && !params.has('nofs')) document.documentElement.requestFullscreen().catch(() => {});
  stayAwake();
  guardBack();
}, { capture: true });

// Android's Back button never leaves the kiosk: it closes a pop-up, or goes back to the family
// screen. Back lands on an extra history entry the kiosk keeps on top, and the kiosk adds it again.
// (Chrome skips entries added before anyone has tapped, so taps re-add it if it's gone.)
let backGuarded = false;
function guardBack() { if (!backGuarded) { history.pushState({ kiosk: true }, ''); backGuarded = true; } }
addEventListener('popstate', () => {
  backGuarded = false; guardBack();
  if (!S.family || S.screen === 'pair') return;
  if ($modal.classList.contains('open')) closeModal(); else if (S.screen !== 'sleep') goSleep();
});
guardBack();
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.family) { reload(); listen(); } });
addEventListener('online', () => { if (S.family) { reload(); listen(); } });
setInterval(() => { if (S.family && !document.hidden && S.screen !== 'pair') reload(true).catch(console.error); }, RESYNC_MS);

// ---------- updates ----------
// kiosk/deploy.sh stamps each publish into BUILD (top of this file) and into version.txt beside
// the page. Every 2 minutes (and when the screen wakes) the kiosk reads version.txt; when it's newer, the kiosk reloads itself the next
// time it's quiet: the family screen, no pop-up or celebration, and nobody has tapped for 30
// seconds. A copy served from this Mac ('dev') never checks.
let updateReady = false, lastStir = Date.now();
const quiet = () => S.screen === 'sleep' && !$modal.classList.contains('open') && !partyOn && !grownUp()
  && Date.now() - lastStir > 30e3 && !S.dashes.some(d => !dashOver(d)) && !pouring.size && !Object.values(S.held).some(Boolean);
async function checkForUpdate() {
  try {
    const r = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    const v = r.ok ? (await r.text()).trim() : '';
    if (/^\d{14}$/.test(v) && v > BUILD) updateReady = true;
  } catch { /* offline: try again next time */ }
}
// Every 2 minutes, and straight away when the screen wakes or the network comes back (a sleeping
// tablet runs no timers, so it used to wait up to 5 more minutes after waking).
if (BUILD !== 'dev') {
  setInterval(checkForUpdate, 2 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  addEventListener('online', checkForUpdate);
}

// ---------- motion ----------
function countFrom(el, from, to) {
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const t0 = performance.now(), dur = Math.min(900, 350 + Math.abs(to - from) * 12);
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function burst(from, theme, opts = {}) {
  if (!from || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, unitPx = innerWidth / 100;
  const colors = ['#F2667A', '#FFC93C', '#4CC9C0', '#A98BD6', '#8CCB6E'];
  for (let i = 0; i < (opts.n || 12); i++) {
    const el = document.createElement('div'); el.className = 'particle';
    const isTok = !opts.confetti || Math.random() < .5, size = isTok ? (2 + Math.random()) * unitPx : unitPx;
    if (isTok) { el.innerHTML = tok(pile(theme, i), ''); el.style.cssText = `width:${size}px;height:${size}px`; }
    else el.style.cssText = `width:${unitPx}px;height:${(1 + Math.random()) * unitPx}px;border-radius:2px;background:${colors[i % colors.length]}`;
    document.body.appendChild(el);
    const a = -Math.PI / 2 + (Math.random() - .5) * (opts.full ? Math.PI * 2 : Math.PI * 1.1), d = 18 * unitPx * (.55 + Math.random() * .7);
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d, rot = (Math.random() - .5) * 540;
    el.animate([
      { transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(.3)`, opacity: 1 },
      { transform: `translate(${x + dx}px,${y + dy}px) translate(-50%,-50%) scale(1) rotate(${rot * .6}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${x + dx * 1.15}px,${y + dy + 12 * unitPx}px) translate(-50%,-50%) scale(.85) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 950 + Math.random() * 450, easing: 'cubic-bezier(.2,.75,.3,1)' }).onfinish = () => el.remove();
  }
}

// New tokens: the name on that kid's jar grows and confetti bursts out of it. When several kids
// get tokens at once, the jars go one after another, left to right, so it's clear who got some.
// Kids whose jar isn't on screen get a toast instead. Everything here only moves and fades
// (transform and opacity), which tablets draw smoothly.
function celebrate(list) {
  lastStir = Date.now();
  const away = [];
  let i = 0;
  for (const g of list) {
    if (document.querySelector(`.jar[data-jar="${g.kid.id}"]`)) { const delay = i++ * 400; setTimeout(() => pop(g), delay); }
    else away.push(g);
  }
  if (away.length && !S.lockShown) toast(giftLine(away));
}

function pop(g) {
  const label = document.querySelector(`.jar[data-jar="${g.kid.id}"] .jar-label`); if (!label) return;
  clink();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  label.animate([
    { transform: 'translateX(-50%) scale(1)', easing: 'cubic-bezier(.2,.8,.3,1)' },
    { transform: 'translateX(-50%) scale(1.35)', offset: .3, easing: 'cubic-bezier(.5,0,.4,1.25)' },
    { transform: 'translateX(-50%) scale(1)' },
  ], { duration: 1000 });
  setTimeout(() => confetti(label, g.kid.color), 120);
}

function confetti(from, color, n = 26, spread = 1) {
  const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, u = innerWidth / 100 * spread;
  const colors = [color, '#FFC93C', '#4CC9C0', '#F2667A', '#A98BD6', '#FFFFFF'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div'); el.className = 'confetti';
    el.style.cssText = `width:${(.6 + Math.random() * .5) * u}px;height:${(1 + Math.random() * .8) * u}px;background:${colors[i % colors.length]}`;
    document.body.appendChild(el);
    const a = Math.random() * Math.PI * 2, d = (6 + Math.random() * 10) * u, dx = Math.cos(a) * d, dy = Math.sin(a) * d - 4 * u, rot = (Math.random() - .5) * 720;
    el.animate([
      { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 1, easing: 'cubic-bezier(.15,.8,.3,1)' },
      { transform: `translate(${x + dx}px,${y + dy}px) rotate(${rot * .6}deg)`, opacity: 1, offset: .45, easing: 'ease-in' },
      { transform: `translate(${x + dx * 1.1}px,${y + dy + 9 * u}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 400 }).onfinish = () => el.remove();
  }
}

// A grown-up approved a purchase: a big card over everything with who, what and how much,
// and confetti. Several in a row wait their turn. Tap anywhere to close; it closes itself.
const partyQueue = [];
let partyOn = false;
// Each is { buy: ledger entry } or { earn: approvals for the kid whose screen is open }.
function party(p) { partyQueue.push(p); if (!partyOn) nextParty(); }
function nextParty() {
  const p = partyQueue.shift(); partyOn = !!p; if (!p) return;
  if (p.earn) return earnParty(p.earn);
  const e = p.buy;
  const k = S.kids.find(x => x.id === e.child_id); if (!k) return nextParty();
  const it = S.allItems.find(i => i.id === e.item_id);
  const el = Object.assign(document.createElement('div'), { className: 'party', role: 'alert' });
  el.style.setProperty('--c', k.color);
  el.innerHTML = `<div class="party-card"><div class="party-pic">${itemPic(it)}${avatar(k)}</div>
    <b class="party-who">${esc(k.name)} got</b><b class="party-what">${esc(e.label)}!</b>
    <span class="party-cost">Spent ${tok(shown(k))}<span class="num">${-e.amount}</span></span></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  clink();
  const pic = el.querySelector('.party-pic');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    [0, 500].forEach((d, i) => setTimeout(() => el.isConnected && confetti(pic, k.color, 30, 1.7 + i * .4), 250 + d));
  let closing = false;
  const close = () => { if (closing) return; closing = true; el.classList.remove('on'); setTimeout(() => { el.remove(); nextParty(); }, 350); };
  el.onclick = close; setTimeout(close, 7000);
  poke();
}

// A short glassy "clink", made on the fly (no sound files).
let audio;
// Browsers only allow sound after someone taps, unless the page is an installed app (Chrome lets
// those play right away). The Hub reloads itself after updates, so it tries at launch, and the
// family screen shows "Tap for sound" while sound is still blocked.
function startAudio() {
  if (params.has('quiet') || !window.AudioContext) return;
  if (!audio) { audio = new AudioContext(); audio.onstatechange = soundHint; }
  audio.resume?.().catch(() => {});
}
const soundOff = () => !params.has('quiet') && !!window.AudioContext && audio?.state !== 'running';
function soundHint() { const el = document.querySelector('.ks-sound'); if (el && !soundOff()) el.remove(); }
function clink(f = 1500) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  for (const [mult, vol] of [[1, .16], [2.76, .05]]) {
    const o = audio.createOscillator(), v = audio.createGain();
    o.frequency.setValueAtTime(f * mult, t); o.frequency.exponentialRampToValueAtTime(f * mult * .82, t + .2);
    v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(vol, t + .006); v.gain.exponentialRampToValueAtTime(.0001, t + .32);
    o.connect(v).connect(audio.destination); o.start(t); o.stop(t + .35);
  }
}

let toastEl;
function toast(text) {
  toastEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toast' });
  toastEl.textContent = text; toastEl.classList.add('show');
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- Dappl Dashes ----------
// A parent starts a countdown from their phone ("Clean upstairs! 10 minutes, +2"). For several
// kids the whole screen becomes the race; for one kid, their jar becomes a stopwatch. A kid who's
// done taps their Dappl Card (or their picture, without a card): that asks a grown-up, and their
// clock stops until the grown-up answers. Declined: back on the clock. Same rules as the database
// (start_dash, finish_dash, decide_claim) and Dash.swift in the app.
const DASH_RESULTS_MS = 15000;   // how long the group results stay up
const DASH_MISSED_MS = 8000;     // how long a kid's "Time's up!" stopwatch stays before their jar returns
const DASH_DONE_MS = 2600;       // how long a kid's "+2" stopwatch stays before their jar returns and fills
const isGroup = d => d.dash_runners.length > 1;
// A kid's own end (ends_at on their runner row) is set when it differs from the Dash's: their own
// time, or time a parent added just for them. Same rule as dash_deadline in the database.
const runEnd = (d, r) => new Date(r.ends_at || d.ends_at).getTime();
const deadline = (d, r) => runEnd(d, r) + Number(r.paused_seconds || 0) * 1000;
function standing(d, r, now = Date.now()) {
  if (r.status === 'done') return { s: 'done', earned: r.earned };
  if (r.status === 'waiting') return { s: 'waiting', left: Math.max(0, deadline(d, r) - new Date(r.waiting_since).getTime()) };
  const left = deadline(d, r) - now;
  return d.stopped_at || left <= 0 ? { s: 'missed', at: d.stopped_at ? new Date(d.stopped_at).getTime() : deadline(d, r) } : { s: 'running', left };
}
const dashOver = (d, now = Date.now()) => d.dash_runners.every(r => ['done', 'missed'].includes(standing(d, r, now).s));
// How long a kid's clock is (or, without a kid, the Dash's longest).
const dashLength = (d, r) => (r ? runEnd(d, r) : new Date(d.ends_at).getTime()) - new Date(d.started_at);
// Kids on different clocks (their own times, or time added for one of them).
const ownTimes = d => new Set(d.dash_runners.map(r => runEnd(d, r))).size > 1;
// The group's big clock: the latest clock still running.
const groupLeft = (d, now) => Math.max(0, ...d.dash_runners.map(r => standing(d, r, now)).filter(st => st.s === 'running').map(st => st.left));
const descHTML = (d, cls) => d.description ? `<p class="${cls}">${esc(d.description)}</p>` : '';
const mins = ms => { const m = Math.round(ms / 60e3); return m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} min`; };
const mmss = ms => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// The Dash this kid is racing in right now (running or waiting for a grown-up).
function activeDash(kidId, now = Date.now()) {
  for (const d of [...S.dashes].reverse()) {
    const r = d.dash_runners.find(x => x.child_id === kidId); if (!r) continue;
    const st = standing(d, r, now);
    if (st.s === 'running' || st.s === 'waiting') return { d, r, st };
  }
  return null;
}
// A kid's own (one-kid) Dash shows on the family screen while it runs, and "Time's up!" briefly after.
function slotDash(kidId, now) {
  const a = activeDash(kidId, now);
  if (a) return isGroup(a.d) ? null : a;
  for (const d of S.dashes) {
    if (isGroup(d) || d.dash_runners[0].child_id !== kidId) continue;
    const st = standing(d, d.dash_runners[0], now);
    if (st.s === 'missed' && !d.stopped_at && now - st.at < DASH_MISSED_MS) return { d, r: d.dash_runners[0], st };
    if (st.s === 'done' && now - (S.doneAt[d.id] || 0) < DASH_DONE_MS) return { d, r: d.dash_runners[0], st };
  }
  return null;
}
const doneHint = kids => { const c = kids.filter(needsCard).length;
  return !c ? 'Done? Tap your picture!' : c === kids.length ? 'Done? Tap your Dappl Card!' : 'Done? Tap your Dappl Card or your picture!'; };
const ring = (frac, attr) => `<svg class="dring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="dring-track"/>
  <circle cx="50" cy="50" r="44" class="dring-fill" pathLength="100" stroke-dasharray="${(Math.max(0, Math.min(1, frac)) * 100).toFixed(2)} 100" ${attr}/></svg>`;
const floaters = () => `<div class="dash-bg" aria-hidden="true">${Array.from({ length: 9 }, (_, i) =>
  `<span style="--i:${i};left:${(i * 37 + 6) % 94}%">${tok(pile('dappldots', i), '')}</span>`).join('')}</div>`;

// One kid's Dash on the family screen: a stopwatch with their face in it.
function dashSlot(k, { d, st }) {
  const frac = st.s === 'running' || st.s === 'waiting' ? st.left / dashLength(d, d.dash_runners[0]) : st.s === 'done' ? 1 : 0;
  const line = st.s === 'running' ? `<span class="num" data-sleft="${k.id}">${mmss(st.left)}</span>`
    : st.s === 'waiting' ? `${icon('hourglass', 2.4)}Checking…` : st.s === 'done' ? `${icon('check', 3)}<span class="num">+${st.earned ?? d.reward}</span>` : `Time's up!`;
  return `<button class="fj fjd st-${st.s} press" style="--c:${k.color}" data-dash-done="${k.id}" aria-label="${esc(k.name)}: ${esc(d.title)}">
    <span class="sw"><span class="sw-knob"></span>${ring(frac, `data-sring="${k.id}"`)}<span class="sw-av">${avatar(k)}</span></span>
    <b class="sw-title">${esc(d.title)}</b>${descHTML(d, 'sw-desc')}<span class="sw-time">${line}</span>
    <span class="sw-hint">${st.s === 'running' ? (needsCard(k) ? 'Done? Tap your Dappl Card!' : 'Done? Tap here!') : st.s === 'waiting' ? 'Your clock is paused' : st.s === 'done' ? 'You did it!' : 'Next time!'}</span></button>`;
}

// A Dash for several kids: the whole screen. While it runs: the mission, the clock and everyone
// in it. When it's over: how it went.
function drawDash() {
  const d = S.dashes.find(x => x.id === S.dashId); if (!d) return drawSleep();
  const now = Date.now(), over = dashOver(d, now), left = groupLeft(d, now), own = ownTimes(d);
  // Kids first, then any grown-ups racing too.
  const runners = d.dash_runners.map(r => ({ r, k: S.kids.find(x => x.id === r.child_id), st: standing(d, r, now) })).filter(x => x.k)
    .sort((a, b) => isGrown(a.k) - isGrown(b.k) || a.k.sort_order - b.k.sort_order);
  const reward = d.payout === 'team' ? `+${d.reward} each if everyone finishes!` : d.payout === 'first' ? `+${d.reward} each · first one done gets +${d.bonus} more!` : `+${d.reward} each!`;
  const tiles = runners.map(({ r, k, st }) => {
    // Everyone on the same clock: the big clock says it once, so the kids' tiles just say they're
    // racing. A kid whose clock differs (paused while a grown-up checked, then sent back) still
    // shows their own.
    const ownClock = own || Math.abs(st.left - left) > 1500;
    const line = st.s === 'running' ? (ownClock ? `<span class="num" data-dleft="${k.id}">${mmss(st.left)}</span>` : `${icon('bolt', 2.4)}Racing!`)
      : st.s === 'waiting' ? `${icon('hourglass', 2.4)}Checking…`
      : st.s === 'done' ? (d.payout === 'team' && r.earned == null ? `${icon('check', 3)}Done!` : `${icon('check', 3)}+${r.earned ?? d.reward}${d.bonus_child === k.id ? ' · first!' : ''}`)
      : `Time's up`;
    // Own times: each kid gets their own ring around their face.
    const kring = own && (st.s === 'running' || st.s === 'waiting') ? ring(st.left / dashLength(d, r), `data-kring="${k.id}"`) : '';
    return `<button class="drun st-${st.s}${own ? ' own' : ''} press" style="--c:${k.color}" data-dash-done="${k.id}">
      <span class="drun-av">${kring}${avatar(k)}</span><b class="drun-name">${esc(k.name)}</b><span class="drun-st">${line}</span></button>`;
  }).join('');
  let center;
  if (!over && own) {
    // Everyone has their own clock (on their tile), so the middle shows what to do instead.
    center = `<div class="dmission">${icon('flag', 2)}<b>${d.description ? esc(d.description) : 'Everyone has their own time!'}</b>
      ${d.description ? '<span>Everyone has their own time</span>' : ''}</div>`;
  } else if (!over) {
    center = `<div class="dclock${left < 10500 ? ' hurry' : ''}">${ring(left / dashLength(d), 'data-dring')}<span class="num" data-dclock>${mmss(left)}</span></div>`;
  } else {
    const made = runners.filter(x => x.st.s === 'done').length, all = made === runners.length;
    const head = d.stopped_at && !all ? 'Dash over' : d.payout === 'team' ? (all ? 'Team win!' : 'So close, team!') : all ? 'Everyone made it!' : made ? `${made} of ${runners.length} made it!` : "Time's up!";
    const sub = d.payout === 'team' ? (all ? `Everyone gets +${d.reward}!` : 'Everyone has to finish. Next time!')
      : d.bonus_child ? `${esc(S.kids.find(k => k.id === d.bonus_child)?.name || '')} was first!` : all ? 'Great job, everybody!' : 'Next time!';
    center = `<div class="dresult">${icon(made ? 'trophy' : 'clock', 1.8)}<b>${head}</b><span>${sub}</span></div>`;
  }
  return `${floaters()}<div class="dash-top"><span class="dash-tag">${icon('stopwatch', 2.4)}Dappl Dash</span><h1 class="dash-title">${esc(d.title)}</h1>
      ${!own || over ? descHTML(d, 'dash-desc') : ''}<span class="dash-reward">${reward}</span></div>
    <div class="dash-main">${center}<div class="dash-runners" style="--n:${runners.length}">${tiles}</div></div>
    <div class="dash-hint">${over ? `<button class="kdone press" data-act="sleep">Done</button>` : doneHint(runners.map(x => x.k))}</div>`;
}

// Every second (and after new data): keep the clocks moving, switch screens as Dashes start and
// end, and react when a kid's state changes (a grown-up approved, declined, or time ran out).
function dashTick() {
  if (!S.family || S.screen === 'pair' || S.screen === 'loading') return;
  const now = Date.now();
  // What changed since last time. The first look only remembers what's there.
  const sig = {}, changes = [], ends = {};
  for (const d of S.dashes) for (const r of d.dash_runners) { sig[d.id + r.child_id] = standing(d, r, now).s; ends[d.id + r.child_id] = runEnd(d, r); }
  // A parent added time ("Need more time?"): cheer the kids who got it.
  if (S.dashEnds) {
    const got = new Map();
    for (const d of S.dashes) for (const r of d.dash_runners) {
      const before = S.dashEnds[d.id + r.child_id], add = before ? ends[d.id + r.child_id] - before : 0;
      if (add > 20e3 && ['running', 'waiting'].includes(sig[d.id + r.child_id])) got.set(r.child_id, Math.round(add / 60e3));
    }
    if (got.size) setTimeout(() => moreTime(got), 50);
  }
  S.dashEnds = ends;
  if (S.dashPrev) {
    for (const d of S.dashes) {
      if (!d.dash_runners.some(r => S.dashPrev[d.id + r.child_id])) { if (!dashOver(d, now)) changes.push({ d, start: true }); continue; }
      for (const r of d.dash_runners) {
        const was = S.dashPrev[d.id + r.child_id], is = sig[d.id + r.child_id];
        if (was && was !== is) changes.push({ d, r, was, is });
      }
    }
  }
  S.dashPrev = sig;
  // A group Dash takes over the screen while it runs, then shows how it went.
  const live = S.dashes.find(d => isGroup(d) && !dashOver(d, now));
  if (live && (S.screen !== 'dash' || S.dashId !== live.id)) { S.dashId = live.id; S.dashEnd = 0; S.kidId = null; S.screen = 'dash'; closeModal(); render(); }
  else if (S.screen === 'dash') {
    const d = S.dashes.find(x => x.id === S.dashId);
    if (!d) { goSleep(); return; }
    if (!dashOver(d, now) && S.dashEnd) { S.dashEnd = 0; render(); }   // time added after it ended: back on
    else if (dashOver(d, now) && !S.dashEnd) { S.dashEnd = now; render(); finale(d); }
    else if (S.dashEnd && now - S.dashEnd > DASH_RESULTS_MS) { S.dashEnd = 0; S.dashId = null; goSleep(); return; }
    else if (changes.length && !$modal.classList.contains('open')) render();
  } else if (S.screen === 'sleep' && !$modal.classList.contains('open')) {
    // A kid's own stopwatch appears, changes or goes away.
    const shown = [...document.querySelectorAll('.fjd')].map(b => b.dataset.dashDone + b.className).join();
    const want = S.kids.map(k => { const sd = slotDash(k.id, now); return sd ? k.id + `fj fjd st-${sd.st.s} press` : ''; }).filter(Boolean).join();
    if (shown !== want) render();
  }
  for (const c of changes) dashChanged(c);
  // Clocks.
  for (const d of S.dashes) for (const r of d.dash_runners) {
    const st = standing(d, r, now); if (st.s !== 'running') continue;
    document.querySelectorAll(`[data-dleft="${r.child_id}"], [data-sleft="${r.child_id}"]`).forEach(el => { el.textContent = mmss(st.left); });
    document.querySelectorAll(`[data-sring="${r.child_id}"], [data-kring="${r.child_id}"]`).forEach(el => el.setAttribute('stroke-dasharray', `${(st.left / dashLength(d, r) * 100).toFixed(2)} 100`));
    // The last ten seconds tick: a kid's own stopwatch, or each kid's own clock in a group with own times.
    if ((!isGroup(d) || ownTimes(d)) && st.left < 10500 && st.left > 500) tick(st.left < 3500);
  }
  if (S.screen === 'dash' && !S.dashEnd) {
    const d = S.dashes.find(x => x.id === S.dashId), left = groupLeft(d, now);
    const el = document.querySelector('[data-dclock]');
    if (el) el.textContent = mmss(left);
    document.querySelector('[data-dring]')?.setAttribute('stroke-dasharray', `${(Math.max(0, left) / dashLength(d) * 100).toFixed(2)} 100`);
    document.querySelector('.dclock')?.classList.toggle('hurry', left < 10500);
    if (!ownTimes(d) && left < 10500 && left > 500) tick(left < 3500);
  }
}

// "+10 minutes, Eva!": a toast, a wiggle on the kids' clocks, and a happy two-note chime.
function moreTime(got) {
  const names = [...got.keys()].map(id => S.kids.find(k => k.id === id)?.name).filter(Boolean);
  const m = Math.max(...got.values());
  toast(`+${m} minute${m === 1 ? '' : 's'}${names.length ? `, ${names.length > 2 ? 'everyone' : names.join(' and ')}` : ''}!`);
  beep(784, .14, 'triangle', .22); beep(1175, .3, 'triangle', .22, .12);
  for (const id of got.keys()) document.querySelector(`[data-dash-done="${id}"]`)?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.08) rotate(-3deg)' }, { transform: 'scale(1.08) rotate(3deg)' }, { transform: 'scale(1)' }], { duration: 600 });
  lastStir = Date.now();
}

function dashChanged({ d, r, was, is, start }) {
  if (start) return dashIntro(d);
  const k = S.kids.find(x => x.id === r.child_id); if (!k) return;
  const el = document.querySelector(`[data-dash-done="${k.id}"]`);
  if (is === 'done') {
    fanfare();
    if (el) { confetti(el, k.color, 34, 1.4); setTimeout(() => el.isConnected && confetti(el, k.color, 24, 1.8), 450); }
  } else if (was === 'waiting' && is === 'running') {
    toast(`Not quite done, ${k.name}! Keep going!`);
    el?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' }], { duration: 450 });
  } else if (is === 'missed' && was === 'running' && !d.stopped_at) {
    womp();
  }
}

// Dash winnings don't just appear in a jar. They're held out while the Dash is on screen (the
// group race, or a kid's "+2" stopwatch), then, when the jars come back, they fly out of where
// that kid's Dash picture was and drop into their jar one by one, the number counting up as each
// lands. Anywhere else (a kid's own screen, or reduced motion) they're added straight away.
const earnedNow = () => Object.fromEntries(S.dashes.flatMap(d => d.dash_runners.map(r => [d.id + r.child_id, r.earned || 0])));
function holdDashEarnings(prev, gifts) {
  if ((S.screen !== 'sleep' && S.screen !== 'dash') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const d of S.dashes) for (const r of d.dash_runners) {
    const add = (r.earned || 0) - (prev[d.id + r.child_id] || 0);
    if (add <= 0) continue;
    S.held[r.child_id] = (S.held[r.child_id] || 0) + add;
    if (!isGroup(d)) S.doneAt[d.id] = Date.now();
    S.unseen[r.child_id] = { amount: (unseen(r.child_id)?.amount || 0) + add, at: Date.now() };
    // It's celebrated by the pour, not the usual jar pop or "+2" toast.
    const g = gifts.get(r.child_id);
    if (g) { g.amount -= add; if (g.amount <= 0) gifts.delete(r.child_id); }
  }
}
const pouring = new Set();
function pourHeld() {
  let i = 0;
  for (const k of S.kids) {
    if (!S.held[k.id] || pouring.has(k.id) || !famJar(k)) continue;
    pouring.add(k.id);
    setTimeout(() => pour(k), 350 + i++ * 700);
  }
}
const famJar = k => $screen.querySelector(`.jar[data-jar="${k.id}"]`);
// What an approval earned: the achievement's picture, or the kid's own token for "+1 Dappl Dot".
const earnPic = (k, x) => x.c.achievement_id ? achPic(S.achievements.find(a => a.id === x.c.achievement_id) || { icon: 'star' }) : tok(pile(shown(k), 0), '');
function pour(k) {
  const n = S.held[k.id] || 0, base = jarBal(k.id), earned = S.pourFrom[k.id];
  delete S.pourFrom[k.id];
  // An approved "I did it!": its picture pops up over the jar and the Dappl Dots drop out of it.
  // Dash winnings fly out of where the kid's Dash picture was.
  let from = S.dashRects[k.id], badge = null, lead = 0;
  if (earned) {
    badge = earnBadge(k, earned, n);
    if (badge) { from = badge.querySelector('.eb-pic').getBoundingClientRect(); lead = 750; }
  }
  const gap = Math.min(earned ? 420 : 260, 2400 / Math.max(1, n)), fly = earned ? 1100 : 950;
  lastStir = Date.now();
  const ctx = { jar: () => famJar(k), live: () => !!S.held[k.id], land: (j, last) => {
    S.held[k.id]--;
    document.querySelectorAll(`[data-k="${k.id}"]`).forEach(x => { x.textContent = jarBal(k.id); x.classList.remove('bump'); void x.offsetWidth; x.classList.add('bump'); });
    clink(1200 + Math.min(j, 12) * 60);   // a little higher with each one
    if (last) { const num = $screen.querySelector(`.fj[data-sign="${k.id}"] .fj-bal`); if (num) confetti(num, k.color, earned ? 34 : 22, earned ? 1.6 : 1.2); }
  } };
  for (let j = 0; j < n; j++) setTimeout(() => dropOne(k, base + j, j, from, fly, j === n - 1, ctx), lead + j * gap);
  // More may have arrived while this one poured (a second approval): pour that too.
  setTimeout(() => { pouring.delete(k.id); if (badge) closeBadge(badge); if (S.screen === 'sleep') pourHeld(); }, lead + (n - 1) * gap + fly + 250);
}
// One token flies from `from` (a rect) into the jar ctx.jar() at position idx, and lands with a squash.
function dropOne(k, idx, j, from, fly, last, ctx) {
  const jar = ctx.jar();
  if (!jar || !ctx.live()) return;
  const cr = jar.querySelector('.jar-coins').getBoundingClientRect(), jr = jar.getBoundingClientRect();
  const p = slot(Math.min(idx, CAP - 1)), size = cr.width * .19;
  const tx = cr.left + p.x / 100 * cr.width + size / 2, ty = cr.bottom - p.y / 100 * cr.height - size / 2;
  const sx = from ? from.left + from.width / 2 : jr.left + jr.width / 2, sy = from ? from.top + from.height / 2 : jr.top;
  const ax = (sx + tx) / 2 + (Math.random() - .5) * size, ay = Math.min(sy, jr.top) - size * (1.2 + Math.random() * .6);
  const el = document.createElement('div'); el.className = 'particle';
  el.innerHTML = tok(pile(shown(k), idx), ''); el.style.cssText = `width:${size}px;height:${size}px`;
  document.body.appendChild(el);
  el.animate([
    { transform: `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(.2)`, opacity: 0, easing: 'cubic-bezier(.2,.8,.4,1)' },
    { transform: `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(1.3)`, opacity: 1, offset: .15, easing: 'cubic-bezier(.3,.6,.5,1)' },
    { transform: `translate(${ax}px,${ay}px) translate(-50%,-50%) scale(1.15) rotate(${p.rot * 2}deg)`, offset: .55, easing: 'cubic-bezier(.5,0,.9,.6)' },
    { transform: `translate(${tx}px,${ty}px) translate(-50%,-50%) scale(1) rotate(${p.rot}deg)` },
  ], { duration: fly }).onfinish = () => {
    el.remove();
    if (!ctx.live()) return;
    const now = ctx.jar();
    if (now && idx < CAP) {
      const c = now.querySelector('.jar-coins'); c.insertAdjacentHTML('beforeend', coinHTML(k, idx));
      c.lastElementChild.animate([{ translate: '0 -12%', scale: '1.12 .86' }, { translate: '0 0', scale: '1 1' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    }
    ctx.land(j, last);
  };
}

// The picture of what a kid did, popping up over their jar on the family screen with "+2".
function earnBadge(k, earned, n) {
  const jar = famJar(k); if (!jar) return null;
  const jr = jar.getBoundingClientRect(), size = Math.min(jr.width * .62, innerHeight * .26);
  const el = Object.assign(document.createElement('div'), { className: 'earn-badge' });
  el.style.cssText = `--c:${k.color};width:${size}px;left:${jr.left + jr.width / 2}px;top:${Math.max(size * .55, jr.top - size * .15)}px`;
  el.innerHTML = `<span class="eb-pic">${earnPic(k, earned[0])}</span><b class="num">+${n}</b>`;
  document.body.appendChild(el);
  el.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: .6 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }],
    { duration: 600, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' });
  chime();
  return el;
}
function closeBadge(el) {
  el.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }], { duration: 350, easing: 'ease-in', fill: 'forwards' }).onfinish = () => el.remove();
}

// On a kid's own screen: their jar fills right in front of them. The picture of what they did
// sits over the jar, the Dappl Dots drop in one by one with the count going up, then confetti.
// Tap anywhere (or wait) to go back to their screen.
function earnParty(xs) {
  const k = xs[0].kid, n = xs.reduce((t, x) => t + x.e.amount, 0), start = Math.max(0, bal(k.id) - n);
  const what = xs.length === 1 ? (xs[0].c.achievement_id ? esc(xs[0].c.label) : 'Dappl Dot') : `${xs.length} things`;
  const el = Object.assign(document.createElement('div'), { className: 'party earn', role: 'alert' });
  el.style.setProperty('--c', k.color);
  el.innerHTML = `<div class="earn-card"><span class="earn-what">${earnPic(k, xs[0])}<b>${what}</b></span>
    <div class="earn-jar">${jarHTML(k, '', Math.min(start, CAP))}</div>
    <span class="earn-count">${tok(shown(k))}<span class="num">${start}</span><span class="earn-plus">+${n}</span></span>
    <b class="party-who">Nice work, ${esc(k.name)}!</b></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  chime();
  poke();
  let shownN = start, done = false;
  const num = el.querySelector('.earn-count .num');
  let closing = false;
  const close = () => { if (closing) return; closing = true; el.classList.remove('on'); setTimeout(() => { el.remove(); nextParty(); }, 350); };
  const ctx = { jar: () => el.querySelector('.jar'), live: () => el.isConnected, land: (j, last) => {
    num.textContent = ++shownN; num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
    clink(1200 + Math.min(j, 12) * 60);
    if (last) { fanfare(); confetti(el.querySelector('.earn-count'), k.color, 40, 1.8); setTimeout(() => el.isConnected && confetti(el.querySelector('.jar'), k.color, 30, 2), 350); done = true; setTimeout(close, 2600); }
  } };
  const gap = Math.min(420, 2400 / n), lead = 900, fly = 1100;
  setTimeout(() => {
    if (!el.isConnected) return;
    const from = el.querySelector('.earn-what .art, .earn-what .photo, .earn-what img').getBoundingClientRect();
    for (let j = 0; j < n; j++) setTimeout(() => dropOne(k, start + j, j, from, fly, j === n - 1, ctx), j * gap);
  }, lead);
  const t0 = Date.now();
  el.onclick = () => { if (done || Date.now() - t0 > 1500) close(); };
  setTimeout(close, lead + n * gap + fly + 6000);   // in case something stops it
}

// A new Dash: the mission, who's in it, and 3, 2, 1, GO!
function dashIntro(d) {
  const kids = d.dash_runners.map(r => S.kids.find(k => k.id === r.child_id)).filter(Boolean);
  if (!kids.length) return;
  lastStir = Date.now();
  const el = Object.assign(document.createElement('div'), { className: 'dintro', role: 'alert' });
  el.innerHTML = `<div class="dintro-card"><span class="dash-tag">${icon('stopwatch', 2.4)}${kids.length > 1 ? 'Dappl Dash!' : `${esc(kids[0].name)}'s Dappl Dash!`}</span>
    <b class="dintro-title">${esc(d.title)}</b>${descHTML(d, 'dintro-desc')}
    ${ownTimes(d)
      ? `<span class="dintro-who own">${d.dash_runners.map(r => { const k = S.kids.find(x => x.id === r.child_id); return k ? `<span class="dintro-kid">${avatar(k)}<b>${mins(dashLength(d, r))}</b></span>` : ''; }).join('')}</span>`
      : `<span class="dintro-who">${kids.map(avatar).join('')}</span><span class="dintro-time">${mins(dashLength(d))} on the clock</span>`}
    <b class="dintro-count num"></b></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const count = el.querySelector('.dintro-count');
  const steps = ['3', '2', '1', 'GO!'];
  steps.forEach((t, i) => setTimeout(() => {
    count.textContent = t; count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop');
    countSound(i === 3);
    if (i === 3 && !matchMedia('(prefers-reduced-motion: reduce)').matches) confetti(count, kids[0].color, 30, 1.6);
  }, 1300 + i * 850));
  const close = () => { if (!el.isConnected) return; el.classList.remove('on'); setTimeout(() => el.remove(), 350); };
  el.onclick = close; setTimeout(close, 1300 + steps.length * 850 + 600);
}

function finale(d) {
  const made = d.dash_runners.filter(r => r.status === 'done').length;
  if (made) fanfare(); else womp();
  if (made && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const at = document.querySelector('.dresult');
    if (at) [0, 500, 1000].forEach(t => setTimeout(() => at.isConnected && confetti(at, '#FFC93C', 36, 1.8), t));
  }
}

// Tapping a kid's picture (or stopwatch) in a Dash. A grown-up racing too finishes with their card
// or the grown-up sum (so kids can't finish for them), and nobody checks: it goes straight in.
function dashDoneTap(kidId, el) {
  const k = S.kids.find(x => x.id === kidId), a = activeDash(kidId);
  if (!k || !a) return;
  if (a.st.s === 'waiting') return toast(`A grown-up is checking, ${k.name}. Hang on!`);
  if (isGrown(k)) return grownUp() ? act(finishDash(k.id, el)) : askGrownUp(`Is ${k.name} done?`, () => act(finishDash(k.id)));
  if (needsCard(k) && !grownUp()) {
    el?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' }], { duration: 450 });
    return toast(`${k.name}, tap your Dappl Card when you're done!`);
  }
  openModal({ wide: true, body: `<div class="link-pic">${avatar(k)}</div><b class="kc-name">Done with ${esc(a.d.title)}?</b>
    <span class="kc-sub">A grown-up will check. Your clock stops while they do.</span>
    <div class="kc-btns"><button class="kno wide press" data-act="close">Not yet</button><button class="kask press" data-dash-finish="${k.id}">${icon('check', 3)}I'm done!</button></div>` }, 'dashask');
}

async function finishDash(kidId, from) {
  const k = S.kids.find(x => x.id === kidId); if (!k) return;
  if (from) from.disabled = true;
  let c;
  try { c = await call('finish_dash', { p_child: kidId }); }
  finally { if (from) from.disabled = false; }
  const a = activeDash(kidId);
  // A grown-up's finish comes back approved: they're done (the reload brings what they earned).
  const done = c?.status === 'approved';
  if (a) {
    if (done) { a.r.status = 'done'; a.r.done_at = new Date().toISOString(); }
    else { a.r.status = 'waiting'; a.r.waiting_since = new Date().toISOString(); }
    if (S.dashPrev) S.dashPrev[a.d.id + kidId] = a.r.status;
  }
  if (c && !done && !S.pending.some(x => x.id === c.id)) S.pending.push(c);
  closeModal(); render();
  if (from) clink();   // a tap on the screen; a card already got the reader's beep
  if (!done) return toast(`Sent! A grown-up will check, ${k.name}.`);
  toast(a?.d.payout === 'team' ? `Done, ${k.name}! The team's Dappl Dots come when everyone's in.` : `Done, ${k.name}! +${a?.d.reward} Dappl ${a?.d.reward === 1 ? 'Dot' : 'Dots'}.`);
  reload();
}

// Sounds, made on the fly like the clink.
function beep(f, dur = .12, type = 'sine', vol = .14, at = 0) {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime + at, o = audio.createOscillator(), v = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(vol, t + .01); v.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(v).connect(audio.destination); o.start(t); o.stop(t + dur + .02);
}
const tick = high => beep(high ? 1320 : 880, .06, 'square', .05);
// 3, 2, 1: a firm two-tone "boop". GO!: a rising run of notes over a quick whoosh.
function countSound(go) {
  if (!go) { beep(660, .22, 'triangle', .32); beep(330, .22, 'sine', .22); return; }
  [523, 659, 784, 1047, 1319].forEach((f, i) => beep(f, i === 4 ? .7 : .12, 'triangle', .3, i * .07));
  beep(1047, .7, 'sine', .14, .28);
  whoosh();
}
function whoosh() {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime, len = .6, buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * len), audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource(), bp = audio.createBiquadFilter(), v = audio.createGain();
  src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(4000, t + len);
  v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(.18, t + .15); v.gain.exponentialRampToValueAtTime(.0001, t + len);
  src.connect(bp).connect(v).connect(audio.destination); src.start(t); src.stop(t + len);
}
const chime = () => { beep(988, .16, 'triangle', .2); beep(1319, .34, 'triangle', .2, .1); };
const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, i === 3 ? .5 : .16, 'triangle', .16, i * .11));
const womp = () => { beep(392, .3, 'triangle', .12); beep(294, .55, 'triangle', .12, .28); };

// ---------- cards ----------
// A kid with a linked card opens their screen by tapping the card; tapping their jar won't, so
// nobody opens a brother's or sister's screen. Kids without a card still tap their jar. A
// grown-up can open any jar after a quick sum. Cards are read two ways: the tablet's own NFC
// (Chrome on Android, https pages only), or a USB reader that types the card's number and
// presses Enter. Cards are linked from a parent's phone (start_card_link), never here alone.
const cleanCard = s => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const needsCard = k => !!k.card_id;
const grownUp = () => S.grownUntil > Date.now();
const linkingKid = () => S.kids.find(k => k.card_link_until && new Date(k.card_link_until) > Date.now());
const hasNfc = 'NDEFReader' in window;

let reader = 'none', nfc = null;   // reader: none, nfc, usb, blocked, off, nohw
async function startNfc(tapped) {
  if (nfc || !hasNfc || !S.family || reader === 'blocked' || reader === 'nohw') return;
  // Asking for the reader needs a tap; without one, only start if Chrome already said yes.
  if (!tapped) { try { if ((await navigator.permissions.query({ name: 'nfc' })).state !== 'granted') return; } catch { return; } }
  const r = new NDEFReader(); nfc = r;
  try {
    await r.scan();
    reader = 'nfc';
    r.onreading = e => cardTapped(e.serialNumber);
    r.onreadingerror = () => toast("Couldn't read that Dappl Card. Hold it still and try again.");
  } catch (e) {
    nfc = null;
    reader = { NotAllowedError: 'blocked', NotReadableError: 'off', NotSupportedError: 'nohw' }[e.name] || reader;
  }
  if (grownUp() && S.screen === 'sleep') render();
  if ($modal.dataset.kind === 'link') checkLinking(true);
}
const readerLine = () => ({ nfc: 'Card reader on', usb: 'USB card reader on', blocked: 'Card reader blocked: allow NFC for this site in Chrome',
  off: "Turn on NFC in the tablet's settings", nohw: 'No built-in card reader (a USB one works)',
  none: hasNfc ? 'Tap the screen once to turn on the card reader' : 'No built-in card reader (a USB one works)' })[reader];

// USB readers type faster than any person: a burst of letters and digits, then Enter.
let typed = '', typedAt = 0;
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const t = performance.now();
  if (t - typedAt > 150) typed = '';
  typedAt = t;
  if (e.key === 'Enter') {
    if (typed.length >= 4) { e.preventDefault(); reader = 'usb'; cardTapped(typed); }
    typed = '';
  } else if (e.key.length === 1 && /[0-9a-z]/i.test(e.key)) typed += e.key;
}, { capture: true });

function cardTapped(raw) {
  if (!S.family || S.screen === 'pair') return;
  const card = cleanCard(raw);
  if (card.length < 4) return toast("Couldn't read that Dappl Card. Hold it still and try again.");
  poke();
  const linking = linkingKid();
  if (linking) return act(linkCard(linking, card));
  const k = S.kids.find(x => x.card_id === card);
  // Redeeming: waiting for this kid's card.
  const pb = S.pendingBuy;
  if (pb && pb.until > Date.now() && $modal.dataset.kind === 'scan') {
    if (k?.id !== pb.kidId) return toast(k ? `That's ${k.name}'s Dappl Card! Tap your own.` : "That card isn't linked. Tap your own Dappl Card.");
    S.pendingBuy = null;
    $modal.querySelector('.scan')?.classList.add('got');
    return act(buy(pb.itemId));
  }
  if (!k) {
    openModal(`<div class="kc-art card-art">${icon('card', 1.8)}</div><b class="kc-name">This card isn't linked yet</b>
      <span class="kc-sub">Ask a grown-up. They link Dappl Cards in the Dappl Dots app: Settings, tap a kid, Link a Dappl Card.</span>
      <div class="kc-btns"><button class="kno wide press" data-act="close">OK</button></div>`, 'unknown');
    return setTimeout(() => { if ($modal.dataset.kind === 'unknown') closeModal(); }, 6000);
  }
  const mine = activeDash(k.id);
  if (mine?.st.s === 'running') return act(finishDash(k.id));
  if (mine?.st.s === 'waiting') return toast(`A grown-up is checking, ${k.name}. Hang on!`);
  if (S.screen === 'dash') return toast(`A Dappl Dash is going! Your jar opens when it's over, ${k.name}.`);
  if (lockedUntil()) return closedToast();
  if (S.kidId === k.id && S.screen !== 'sleep') { if ($modal.dataset.kind === 'unknown') closeModal(); return; }   // already open
  openKid(k.id);   // no sound: the card reader beeps on its own
}

// Tapping a jar that opens with a card: a little wobble and a reminder.
function askForCard(el, k) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    el.querySelector('.jar')?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' }], { duration: 450 });
  toast(`${k.name}, tap your Dappl Card to open your jar!`);
}

// A parent tapped "Link a card" on their phone: wait for that kid's card.
function checkLinking(force) {
  const k = linkingKid(), showing = $modal.classList.contains('open') && $modal.dataset.kind === 'link';
  if (k && (force || !showing || $modal.dataset.kid !== k.id)) {
    const needTap = hasNfc && !nfc && reader === 'none';
    openModal(`<div class="link-pic">${avatar(k)}<span class="link-card">${icon('card', 1.8)}</span></div>
      <b class="kc-name">Tap ${esc(k.name)}'s card now</b>
      <span class="kc-sub">${needTap ? 'First, turn on the card reader.' : `Hold the card on the card reader. ${esc(readerLine())}.`}</span>
      <div class="kc-btns"><button class="kno wide press" data-act="cancel-link">Cancel</button>${needTap ? `<button class="kask press" data-act="reader">${icon('card', 2.4)}Turn on reader</button>` : ''}</div>`, 'link');
    $modal.dataset.kid = k.id;
  } else if (!k && showing) closeModal();
}

async function linkCard(k, card) {
  let id;
  try { id = await call('link_card', { p_child: k.id, p_card: card }); }
  catch (e) { if (e.code === 'TB008') { k.card_link_until = null; checkLinking(); } throw e; }
  for (const x of S.kids) if (x.card_id === id) x.card_id = null;
  k.card_id = id; k.card_link_until = null;
  openModal(`<div class="link-pic">${avatar(k)}</div><b class="kc-name">That's ${esc(k.name)}'s card!</b>
    <span class="kc-sub">Tap it here any time to open your jar.</span>`, 'linked');
  confetti($modal.querySelector('.link-pic'), k.color);
  setTimeout(() => { if ($modal.dataset.kind === 'linked') goSleep(); }, 3200);
}

async function cancelLink() {
  const k = linkingKid(); closeModal(); if (!k) return;
  k.card_link_until = null;
  await call('cancel_card_link', { p_child: k.id });
}

// Grown-ups: a quick multiplication opens every jar for two minutes (or, with `then`, does just that).
function askGrownUp(note = 'Grown-ups only', then) {
  const a = 12 + Math.floor(Math.random() * 8), b = 3 + Math.floor(Math.random() * 7);
  let ans = '';
  openModal(`<b class="kc-name">${note}</b><div class="gm-q">${a} × ${b} = <span class="gm-a">?</span></div>
    <div class="gm-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="gm-key press" data-n="${n}">${n}</button>`).join('')}
      <button class="gm-key press" data-del aria-label="Delete">${icon('back', 2.6)}</button><button class="gm-key press" data-n="0">0</button>
      <button class="gm-key ok press" data-ok aria-label="OK">${icon('check', 2.8)}</button></div>
    <div class="kc-btns"><button class="kno wide press" data-act="close">Never mind</button></div>`, 'grown');
  const out = $modal.querySelector('.gm-a'), show = () => { out.textContent = ans || '?'; };
  $modal.querySelectorAll('[data-n]').forEach(btn => btn.onclick = () => { if (ans.length < 4) ans += btn.dataset.n; show(); });
  $modal.querySelector('[data-del]').onclick = () => { ans = ans.slice(0, -1); show(); };
  $modal.querySelector('[data-ok]').onclick = () => {
    if (Number(ans) !== a * b) return askGrownUp('Not quite. Try this one', then);
    closeModal();
    // Opening one grown-up's jar doesn't leave every jar open behind them.
    if (then) return then();
    S.grownUntil = Date.now() + 120e3; render();
  };
}
window.tapCard = cardTapped;   // for testing from the browser console

// ---------- start ----------
async function start() {
  document.title = 'Dappl Hub · starting';
  let { data } = await sb.auth.getSession();
  document.title = 'Dappl Hub · session ' + (data.session ? 'yes' : 'no');
  // Testing only: ?pair=CODE pairs without typing (codes still work once, for 15 minutes).
  if (!data.session && params.get('pair')) {
    await sb.auth.signInAnonymously();
    await sb.rpc('pair_kiosk', { p_code: params.get('pair'), p_name: 'Test kiosk' });
    ({ data } = await sb.auth.getSession());
  }
  if (!data.session) { S.screen = 'pair'; return render(); }
  await load();
  document.title = 'Dappl Hub';
  if (!S.family) { S.screen = 'pair'; return render(); }   // signed in but not paired (or removed)
  newEntries();                                            // things from before now aren't news
  // The Hub's clock decides when "today" starts for daily limits (round 3; ignored before it).
  if (S.round3) sb.rpc('set_family_time_zone', { p_family: S.family.id, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(() => {}, () => {});
  startAudio();                                            // plays right away in the installed app
  listen();
  startNfc(false);                                         // only if Chrome already allowed it
  // Debug/review only: ?kid=<name>&screen=store opens a screen directly.
  const pick = params.get('kid') && S.kids.find(k => k.name.toLowerCase() === params.get('kid').toLowerCase());
  if (pick) { S.kidId = pick.id; S.screen = params.get('screen') || 'home'; S.noSleep = true; } else S.screen = 'sleep';
  render();
  checkLinking();
  if (pick && params.get('buy')) confirmBuy(S.items.find(i => i.name.toLowerCase() === params.get('buy').toLowerCase())?.id);
  if (pick && params.get('modal') === 'theme') chooseTheme();
  if (pick && params.get('modal') === 'avatar') chooseAvatar();
  if (params.get('party')) { const k = pick || S.kids[0], it = S.items[0]; party({ buy: { child_id: k.id, item_id: it.id, label: it.name, amount: -it.price } }); }
  // ?earn=2 (with ?kid=) shows an approved "I did it!" filling that kid's jar; ?earn=1&dot for "+1 Dappl Dot".
  if (pick && params.get('earn')) { const a = params.has('dot') ? null : kidAchievements(pick)[0], n = Number(params.get('earn')) || 1;
    setTimeout(() => party({ earn: [{ kid: pick, c: { achievement_id: a?.id ?? null, label: a?.name ?? 'Dappl Dot' }, e: { amount: n } }] }), 600); }
}
function showError(e) {
  console.error(e);
  $screen.className = 'kscreen k-pair';
  $screen.innerHTML = `<div class="card pair-card"><h1>Can't reach Dappl Dots</h1><p>Check the tablet's Wi-Fi. Trying again in 10 seconds.</p><p style="font-size:1.1cqw">${esc(e?.message || e)}</p></div>`;
  setTimeout(() => start().catch(showError), 10000);
}
window.addEventListener('unhandledrejection', e => { document.title = 'Error: ' + (e.reason?.message || e.reason); });
start().catch(showError);
