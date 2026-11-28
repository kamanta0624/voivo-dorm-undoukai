// スナップショットの差分を埋める（sync2）: 省かれた項目は前のスナップショット・キャラごとの前の値で埋める（以後は全部そろった形として扱う）。net.ts の 's' の受け取りが使う（ブラウザなしで試せるよう分けた: verify/snapmerge.ts）
// 全部入り（サーバーが送った記録の無い時に付ける s.full）が届くまでは差分を使わない。読み込み中に最初の全部入りが捨てられ、その後に roster だけ変わった差分が届くと、
// broken などが無いまま使ってしまい描画が毎フレーム落ちていた。使い始めた後でも、前の値が無い項目・キャラがあれば全部入りを頼み直す
import { SNAP_KEEP, SNAP_PKEEP } from '../shared/protocol';

export type SnapState = { full: boolean; pKeep: Map<string, Record<string, unknown>> }; // full: 全部入りを受け取ったか。pKeep: キャラ id → 変わった時だけ届く項目の最後の値

// 戻り: ok＝s を埋めた（使ってよい）、wait＝全部入りを待つ間（使わない）、refull＝埋められない（使わず、snapFull を送って全部入りを待つ）
export function mergeSnap(st: SnapState, prev: any, s: any): 'ok' | 'wait' | 'refull' {
  if (s.full) { st.full = true; st.pKeep.clear(); }
  if (!st.full) return 'wait';
  for (const k of SNAP_KEEP) if (!(k in s)) { if (!prev || !(k in prev)) return refull(st); s[k] = prev[k]; }
  for (const p of s.players as any[]) {
    if ('char' in p) st.pKeep.set(p.id, Object.fromEntries(SNAP_PKEEP.map((k) => [k, p[k]])));
    else { const v = st.pKeep.get(p.id); if (!v) return refull(st); Object.assign(p, v); }
  }
  return 'ok';
}
const refull = (st: SnapState) => { st.full = false; return 'refull' as const; };
