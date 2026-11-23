// 入力の抽象化層（src/client/input.ts）の単体テスト: キーボードとタッチが同じコマンドになる
import { Controls } from '../src/client/input';
import { CONFIG as C } from '../src/shared/config';

let fails = 0;
const ok = (name: string, cond: boolean, detail: any = '') => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const sent: any[] = [];
const c = new Controls((type, msg) => sent.push(msg === undefined ? [type] : [type, msg]));
const none = { up: false, down: false, left: false, right: false };
const mv = (k: Partial<typeof none>) => c.move({ ...none, ...k });

console.log('--- 移動');
ok('キーボード: W=上、D+S=右下（今までと同じ値）', JSON.stringify(mv({ up: true })) === '{"dx":0,"dy":-1}' && JSON.stringify(mv({ right: true, down: true })) === '{"dx":1,"dy":1}');
ok('何も触れていなければ止まる', JSON.stringify(mv({})) === '{"dx":0,"dy":0}');
c.setStick(C.TOUCH.dead - 1, 0);
ok(`スティック: 遊び（${C.TOUCH.dead}px）未満は止まる`, JSON.stringify(mv({})) === '{"dx":0,"dy":0}');
c.setStick(30, -40); const m = mv({});
ok('スティック: 遊びの外は向きだけ（長さ1）', Math.abs(m.dx - 0.6) < 1e-9 && Math.abs(m.dy + 0.8) < 1e-9, m);
ok('キーボードを押していればキーボードが優先', JSON.stringify(mv({ left: true })) === '{"dx":-1,"dy":0}');
c.releaseStick();
ok('スティックを離すと止まる', JSON.stringify(mv({})) === '{"dx":0,"dy":0}');

console.log('--- コマンド（キー・ボタンとも同じ関数を呼ぶ）');
sent.length = 0;
c.skill(); c.qDown(); c.qUp();
ok('技=skill、帰還=qdown→qup（攻撃のコマンドはない。通常攻撃は自動）', JSON.stringify(sent) === JSON.stringify([['skill'], ['qdown'], ['qup']]) && !('attack' in c), sent);
sent.length = 0;
for (let i = 0; i < C.AIM_MODES.length; i++) c.cycleAim();
ok(`照準: ${C.AIM_MODES.join('→')}→最初に戻る`, JSON.stringify(sent.map((x) => x[1].mode)) === JSON.stringify([...C.AIM_MODES.slice(1), C.AIM_MODES[0]]) && sent.every((x) => x[0] === 'aim'), sent);
sent.length = 0; c.cycleAim(); c.sendAim();
ok('再接続時は今の照準モードを送り直す', sent[1][1].mode === C.AIM_MODES[1] && sent[1][0] === 'aim');

console.log('--- 技の矢印（aim1: 押す→矢印→離して発動）');
sent.length = 0; c.aimDown('r', false); const none0 = sent.length; c.aimUp('r');
ok('押しただけでは何も送らない。動かさずに離すと向きなしの skillUp（サーバーが自動照準）', none0 === 0 && JSON.stringify(sent) === JSON.stringify([['skillUp', {}]]), sent);
sent.length = 0; c.aimDown('btn', false); c.aimTo(1); c.aimTo(2); c.aimUp('btn');
ok('動かすと離した時の向きを送る（動かしている間は送らない）', JSON.stringify(sent) === JSON.stringify([['skillUp', { a: 2 }]]), sent);
sent.length = 0; c.aimDown('r', false); c.aimDown('rc', false); c.aimTo(1); c.aimUp('r'); const mid = sent.length; c.aimUp('rc');
ok('R・技ボタン・右クリックのどれかを押している間は続き、全部離した時に1回だけ発動', mid === 0 && JSON.stringify(sent) === JSON.stringify([['skillUp', { a: 1 }]]) && c.aim === null, sent);
sent.length = 0; c.aimUp('r');
ok('押していない入力の離しは何も送らない', sent.length === 0);
sent.length = 0; c.aimDown('r', true); c.aimTo(1); c.aimTo(1); c.aimTo(2); c.aimUp('r');
ok('タメ中（re）は動かすたびに skillAim で向きを送り、離すと skillUp で確定', JSON.stringify(sent) === JSON.stringify([['skillAim', { a: 1 }], ['skillAim', { a: 2 }], ['skillUp', { a: 2 }]]), sent);

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
