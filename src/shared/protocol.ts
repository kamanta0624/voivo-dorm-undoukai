// クライアント → サーバーのメッセージの型と検証（sec1）。サーバーは検証に通らないものを捨てる（切断はしない）。クライアントの送信もこの型で書く
export type C2S = {
  netPing: { id: number; at: number };
  netReport: { id: number; value: unknown };
  input: { seq: number; dx: number; dy: number; rt?: number };
  resultReq: void;
  qdown: { seq?: number } | void;
  qup: void;
  spec: { view: 'all' | 'focus' | 0 | 1 };
  back: void;
  skill: void;
  skillUp: { a?: number } | void;
  skillAim: { a: number };
  aim: { mode: string };
  pick: { char: string };
  go: { char: string };
  unpick: void;
  team: { team: number };
  pr: { op: string; [k: string]: unknown };
};

const obj = (m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null && !Array.isArray(m);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optFin = (v: unknown) => v === undefined || fin(v);
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const none = () => true; // 中身を使わないメッセージ（何が来てもよい）

// 名前 → 検証。ここにない名前（e2e のフックを除く）は捨てる
export const CHECK: { [K in keyof C2S]: (m: unknown) => boolean } = {
  netPing: (m) => obj(m) && fin(m.id) && fin(m.at),
  netReport: (m) => obj(m) && fin(m.id),
  input: (m) => obj(m) && fin(m.seq) && fin(m.dx) && fin(m.dy) && Math.abs(m.dx) <= 1 && Math.abs(m.dy) <= 1 && optFin(m.rt), // dx・dy は -1〜1（スティックも正規化して送る）
  resultReq: none,
  qdown: (m) => m === undefined || (obj(m) && optFin(m.seq)),
  qup: none,
  spec: (m) => obj(m) && ['all', 'focus', 0, 1].includes(m.view as never),
  back: none,
  skill: none,
  skillUp: (m) => m === undefined || (obj(m) && optFin(m.a)),
  skillAim: (m) => obj(m) && fin(m.a),
  aim: (m) => obj(m) && str(m.mode),
  pick: (m) => obj(m) && str(m.char),
  go: (m) => obj(m) && str(m.char),
  unpick: none,
  team: (m) => obj(m) && (m.team === 0 || m.team === 1),
  pr: (m) => obj(m) && str(m.op),
};
// e2e のフック（E2E_HOOKS のときだけある）: オブジェクトか無し
export const checkE2e = (m: unknown) => m === undefined || obj(m);

// クライアントの送信（型を C2S に合わせる）
export function sendC2S<K extends keyof C2S>(room: { send(type: string, m?: unknown): void }, type: K, ...m: C2S[K] extends void ? [] | [C2S[K]] : [C2S[K]]) {
  room.send(type, m[0]);
}
