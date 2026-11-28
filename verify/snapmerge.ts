// スナップショットの差分の取りこぼしの再現と確認（sync2 の直し）: npx tsx verify/snapmerge.ts（test:server に入れてある）
// 本物の GameRoom が作るスナップショットで、読み込みの遅い端末を作る: 最初の全部入りを捨て、その後に別の人の入室で roster だけ変わった差分を先に届かせる
// 直す前の受け取り方（net.ts の前のコードをそのまま写した oldMerge）では broken が無いまま使って描画（upWalls の s.broken.length）が落ち、直した後（client/snapmerge.ts）は落ちず、snapFull の後の全部入りで正しく描ける
import { GameRoom } from '../src/server/GameRoom';
import { SNAP_KEEP, SNAP_PKEEP } from '../src/shared/protocol';
import { mergeSnap, type SnapState } from '../src/client/snapmerge';

let fails = 0;
const ok = (name: string, cond: boolean, info?: unknown) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); if (!cond) fails++; };

// 部屋と端末（verify/server.ts のアウトゲームの確認と同じ作り）。届いたスナップショットは structuredClone（通信で別の物になるのと同じ）
const room = () => { const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {}; Object.defineProperty(r, 'clients', { value: [] }); r.onCreate(); return r; };
const join = (r: any, sid: string) => { const c: any = { sessionId: sid, inbox: [] as any[], auth: r.onAuth({}, { bid: 'b' + sid }, { ip: '9.9.9.' + sid.length, headers: new Headers() }), send: (t: string, m: any) => { if (t === 's') c.inbox.push(structuredClone(m)); }, leave: () => {} }; r.clients.push(c); r.onJoin(c, { name: sid }); return c; };
const draw = (s: any) => { void s.broken.length; void s.roster.length; for (const p of s.players) if (p.char === undefined) throw new Error('char なし'); }; // 描画で使う所（upWalls・一覧・キャラの絵）

// 直す前の受け取り方（net.ts の前のコード）
const oldState = { snapFull: false, pKeep: new Map<string, any>(), snap: null as any };
const oldMerge = (s: any) => {
  if (!oldState.snapFull) { if (!('roster' in s)) return false; oldState.snapFull = true; }
  for (const k of SNAP_KEEP) if (!(k in s)) s[k] = oldState.snap?.[k];
  for (const p of s.players) { if ('char' in p) oldState.pKeep.set(p.id, Object.fromEntries(SNAP_PKEEP.map((k) => [k, p[k]]))); else Object.assign(p, oldState.pKeep.get(p.id)); }
  oldState.snap = s; return true;
};

const r = room(), a = join(r, 'aa');
r.sendSnapshots(); const first = a.inbox.pop(); // 最初の全部入り: 読み込み中なので捨てる
ok('最初のスナップショットは全部入りの印つき・SNAP_KEEP が全部ある', first.full === true && SNAP_KEEP.every((k) => k in first), { full: first.full, keys: SNAP_KEEP.filter((k) => !(k in first)) });
r.sendSnapshots(); a.inbox.pop(); // 何も変わらない差分も捨てる
join(r, 'bbb'); // 別の人が入る → roster だけ変わる
r.sendSnapshots(); const diff = a.inbox.pop();
ok('再現の前提: 次の差分は roster だけ入り、broken などは無い', 'roster' in diff && !('broken' in diff) && !diff.full, { keys: SNAP_KEEP.filter((k) => k in diff) });

// 直す前: 差分を使ってしまい、描画で落ちる
{ const s = structuredClone(diff); const used = oldMerge(s); let err = ''; try { if (used) draw(s); } catch (e: any) { err = e.message; }
  ok('直す前の受け取り方では、broken が無いまま使って描画で落ちる（再現）', used && /length/.test(err), { used, err }); }

// 直した後: 全部入りが届くまで使わない → snapFull → 全部入りで正しく描ける
const st: SnapState = { full: false, pKeep: new Map() };
{ const s = structuredClone(diff), res = mergeSnap(st, null, s); ok('直した後: 全部入りの前の差分は使わない（wait）', res === 'wait', { res }); }
r.messages.snapFull(a); r.sendSnapshots(); let prev: any = null;
{ const s = a.inbox.pop(), res = mergeSnap(st, prev, s); let err = ''; try { draw(s); } catch (e: any) { err = e.message; }
  ok('直した後: snapFull の後の全部入りを使い、正しく描ける', res === 'ok' && s.full === true && Array.isArray(s.broken) && s.roster.length === 2 && !err, { res, err, roster: s.roster?.length }); prev = s; }
{ r.sendSnapshots(); const s = a.inbox.pop(), res = mergeSnap(st, prev, s); let err = ''; try { draw(s); } catch (e: any) { err = e.message; }
  ok('直した後: その次の差分は前の値で埋めて使える', res === 'ok' && !('full' in s && s.full) && Array.isArray(s.broken) && !err, { res, err }); prev = s; }

// キャラごとの項目（SNAP_PKEEP）の穴: 前の値を知らないキャラが char なしで来たら、使わずに全部入りを頼み直す
{ const s = structuredClone(prev); delete s.full; for (const k of SNAP_KEEP) delete s[k]; const p = s.players[0]; for (const k of SNAP_PKEEP) delete p[k];
  const st2: SnapState = { full: true, pKeep: new Map() }, res = mergeSnap(st2, prev, s);
  ok('キャラごとの項目: 前の値の無いキャラが char なしで来たら refull（使わない）', res === 'refull' && st2.full === false, { res }); }
// SNAP_KEEP の穴: 全部入りの後でも、前の値の無い項目が省かれていたら refull
{ const s = structuredClone(prev); delete s.full; delete s.broken; const st3: SnapState = { full: true, pKeep: new Map(st.pKeep) }, res = mergeSnap(st3, {}, s);
  ok('SNAP_KEEP: 前の値の無い項目が省かれていたら refull（使わない）', res === 'refull', { res }); }
// 壁の段階（cracks も変わった分だけ送る）: snapFull で最初から送り直す
{ r.crackLog.push([1, 1, 1]); r.sendSnapshots(); a.inbox.pop(); r.messages.snapFull(a); r.sendSnapshots(); const s = a.inbox.pop();
  ok('snapFull の後の全部入りには、壁の段階（cracks）も最初から入る', Array.isArray(s.cracks) && s.cracks.length === r.crackLog.length, { cracks: s.cracks?.length, log: r.crackLog.length }); }

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
