// クライアント → サーバーのメッセージの型と検証（sec1）。サーバーは検証に通らないものを捨てる（切断はしない）。クライアントの送信もこの型で書く
export type C2S = {
  netPing: { id: number; at: number };
  netReport: { id: number; value: unknown };
  rq: { n: number }; // 往復の遅延の計測の返事（sync1）
  input: { seq: number; dx: number; dy: number; rt?: number };
  resultReq: void;
  snapFull: void; // スナップショットを全部送り直してもらう（受け取りの準備ができた時。sync2）
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
  rq: (m) => obj(m) && fin(m.n),
  input: (m) => obj(m) && fin(m.seq) && fin(m.dx) && fin(m.dy) && Math.abs(m.dx) <= 1 && Math.abs(m.dy) <= 1 && optFin(m.rt), // dx・dy は -1〜1（スティックも正規化して送る）
  resultReq: none,
  snapFull: none,
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

// サーバー → クライアントのスナップショット（'s'。refac1）。サーバー側の組み立て（server/snapshot.ts）に付ける。クライアントの受け取り側は refac3 で使う
type View = 'all' | 'focus' | 0 | 1;
type HoldView = number[]; // [色, 先バレ, 高確率]
export type SnapPlayer = {
  id: string; team: number; char: string; bot: boolean; x: number; y: number; hp: number; alive: boolean; rage: number; bad: number;
  face: number; stunned: boolean; cd: number; respawnIn: number; ko: number | null;
  ack: number; cage: unknown; maxHp: number; spd: number; aim: string; tgt: string | null; skillCd: number;
  skA?: number; skR?: number; skRe?: boolean; // 技の矢印（本人だけ）
  st: Record<string, unknown>; lock: boolean; still: boolean; recall: number | null;
  assist: boolean; tier: number; ult: { form: string; tier: number; left: number | null } | null;
  boost: boolean; slow: boolean; weak: boolean; cdMax: number;
};
// スナップショットの差分（sync2）: SNAP_KEEP は前に送った中身から変わった時だけ載せる項目。SNAP_PKEEP はキャラごとに、変わった時だけ載せる項目（初めて送るキャラは全部）
// 省いた項目は、クライアントが受け取った時に前の値で埋める（net.ts）。入室・再接続・試合の作り直しでは全部送り直す（room.snapSent を消す）
export const SNAP_KEEP = ['roster', 'materials', 'items', 'broken', 'bossRooms'] as const;
export const SNAP_PKEEP = ['char', 'team', 'bot', 'assist', 'tier', 'maxHp', 'cdMax'] as const;
// 敵（視界の制限つきで見ている人の相手の陣営）には送らない項目。クライアントは自キャラ・味方の分だけ使う
export const SNAP_FOE_DROP = ['rage', 'bad', 'cd', 'cdMax', 'ack', 'cage', 'spd', 'aim', 'tgt', 'skillCd', 'still', 'lock', 'stunned', 'respawnIn', 'recall'] as const; // recall: クライアントは敵の溜めを描いていない（noon1）
export type Snapshot = {
  practice?: { mode: string; lv: number[]; foe: string | null };
  e2eFists?: number;
  spec?: { view: View | null; focus: unknown; abandon: number | null };
  netMeasure: number; me: string | null; t: number;
  roster: { id: string; team: number; bot: boolean; char: string; alive: boolean; ok: boolean; name?: string; ult: number | null }[];
  buffs: Record<string, number> | null; introMess?: unknown; back: { n: number; total: number; idle?: number } | null; finale: unknown;
  lobbyLeft: number | null; sortie: number | null; phase: string; phaseLeft: number; timeLeft: number; winner: number | null;
  teams: { toku: number; wanted: string | null; reflect: unknown; bossHpRatio: number; m: { mode: string; backLeft: number; holds: HoldView[]; cur: HoldView | null; lv: unknown } | { kind: string; holds: HoldView[]; cur: HoldView | null; chain: number } }[];
  wanted: { id: string; team: number; x: number; y: number }[];
  players: SnapPlayer[];
  bosses: { team: number; x: number; y: number; hp: number; base: number }[];
  materials: { id: number; x: number; y: number; hi: boolean; big: boolean }[]; items: unknown[];
  ents: { id: number; kind: string; team: number; x: number; y: number; r: unknown; body: unknown; hp: unknown; a: unknown; v: unknown }[];
  couriers: { id: number; team: number; x: number; y: number; box: unknown }[];
  warns: { id: number; team: number; x: number; y: number; r: number; left: number; boss: boolean }[];
  shots: { id: number; kind: string; team: number; x: number; y: number; vx: number; vy: number }[];
  fx: any[]; broken: unknown[]; cracks?: number[][]; bossRooms: unknown; reveal?: true; full?: true; // fx: 技ごとに中身が違う（描画は client/skills の FX_VIEW）
};
