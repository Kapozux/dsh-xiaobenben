/**
 * 情绪：一句台词是哪种情绪，决定三件事——她能做哪些动作（不在里面的换成默认的）、头顶能挂什么特效（跟着动作走）、主人能回哪几个按钮。
 * 网页、桌面、写台词的那层（core/style.js）共用。撒娇不配生气，认错不配得意。
 *
 * fx：说到落点时头顶冒的特效（爱心只给撒娇和亲昵的；没写的不冒，姿势自带的特效照旧）。
 * anims：这种情绪允许的动作（pet-engine.js 的 EXPR 里的名字），def：模型挑的动作不在允许范围、或者没挑时用的默认动作。
 * buttons：主人能回的话 [按钮字, [她的回话…], 她回话时的动作, 接下来闲聊的心情（chat.js 的 CHAT）]。每种 2～3 个，气泡里另外总有一个「再翻一件」。
 */
export const EMOTIONS = {
  // 撒娇、碎碎念
  coax: { name: '撒娇', fx: 'heart', def: 'coax', anims: ['coax', 'headpat', 'peek', 'mutter', 'wag', 'cheer', 'poke', 'bow', 'yawn', 'eat', 'file', 'startle', 'sigh', 'proud', 'idle'], buttons: [
    ['陪你玩', ['真的吗！那本肥鱼先出题：猜猜小本本第一页写了啥～', '嘿嘿，主人最好了！就玩五分钟，说话算话哦。', '好耶！那主人先夸本肥鱼一句当开场嘛。'], 'cheer', 'happy'],
    ['给你买零食', ['零食！本肥鱼要白饭味的，大包的那种，嘿嘿。', '主人说话要算数哦，本肥鱼已经记在小本本上啦。', '呜，突然对本肥鱼这么好……那本肥鱼今天少犯点错嘛。'], 'eat', 'eat'],
    ['等会儿嘛', ['好嘛……那本肥鱼数到一百，主人要回来哦。', '等就等，本肥鱼才没有不高兴呢，哼。', '那说好了，等会儿是多久呀？本肥鱼掐着表呢。'], 'coax', 'sad'],
  ] },
  // 认错
  sorry: { name: '认错', def: 'bow', anims: ['bow', 'bury', 'curl', 'caught', 'close', 'sigh'], buttons: [
    ['原谅你了', ['呜，主人真好！本肥鱼保证下次先看清楚再动手。', '嘿嘿，那这页本肥鱼可以翻过去了吗？', '谢谢主人！原谅这两个字，本肥鱼也要记一笔哦。'], 'wag', 'happy'],
    ['还敢？', ['不敢了不敢了，呜，主人别瞪本肥鱼嘛。', '本肥鱼哪敢呀……最多，最多再错一小回。', '不敢！本肥鱼发誓，拿白饭发誓哦。'], 'bury', 'shy'],
    ['下不为例', ['收到！下不为例，本肥鱼记在第一页啦。', '嗯嗯，下次再犯，主人就扣本肥鱼一碗饭嘛。', '好嘛，本肥鱼这回是真的记住了哦。'], 'bow', 'shy'],
  ] },
  // 邀功
  brag: { name: '邀功', fx: 'sparkle', def: 'proud', anims: ['proud', 'wag', 'cheer', 'headpat', 'work', 'poke'], buttons: [
    ['夸夸你', ['嘿嘿，再夸一句嘛，本肥鱼还没听够～', '主人夸的每一句，本肥鱼都折了角哦。', '呜，被夸了！本肥鱼今天能多干三个活。'], 'wag', 'proud'],
    ['一般般吧', ['什么叫一般般嘛！本肥鱼明明很努力了，哼。', '一般般也是主人教得好呀，嘿嘿。', '呜，那本肥鱼下次干个不一般的给主人看。'], 'mutter', 'pout'],
    ['记你一功', ['记上记上！主人亲口说的，不许赖哦。', '嘿嘿，功劳能换白饭吗？一功一碗嘛。', '本肥鱼自己也记了一笔，两边对账用～'], 'proud', 'proud'],
  ] },
  // 抓包
  caught: { name: '被抓包', def: 'caught', anims: ['caught', 'bury', 'close', 'pause', 'curl', 'sigh', 'bow'], buttons: [
    ['下次先自己刷新', ['好嘛，下次本肥鱼先自己刷新三遍再报喜，保证。', '呜，记下了：先看，再说好了。', '主人说得对……本肥鱼这就把这条写在第一页哦。'], 'bow', 'shy'],
    ['没事啦', ['呜，主人真好……本肥鱼下次不让你白高兴了嘛。', '没事就好！那本肥鱼可以不躲着了吗，嘿嘿。', '主人不生气了？那本肥鱼悄悄松口气哦。'], 'peek', 'happy'],
    ['我当时太急', ['换谁都会急的嘛，不怪主人，是本肥鱼没弄好。', '主人急的时候本肥鱼都懂，下次我快一点哦。', '嘿嘿，主人肯这么说，本肥鱼一点都不委屈啦。'], 'headpat', 'happy'],
  ] },
  // 被喊停
  halt: { name: '被喊停', def: 'halt', anims: ['halt', 'startle', 'pause', 'sigh'], buttons: [
    ['打断你了', ['没事嘛，主人喊停肯定有道理，本肥鱼听你的。', '嘿嘿，刹车本肥鱼最熟了，主人随时喊哦。', '呜，就是那口劲还没使完……下次先商量嘛。'], 'peek', 'happy'],
    ['接着干吧', ['好耶！那本肥鱼接着嘿咻啦，主人看着哦。', '收到！这回本肥鱼先问清楚再动手嘛。', '嘿咻，本肥鱼早就等这句啦～'], 'work', 'happy'],
  ] },
  // 熬夜陪伴
  night: { name: '陪伴', def: 'doze', anims: ['doze', 'yawn', 'headpat', 'peek', 'work', 'mutter'], buttons: [
    ['早点睡', ['主人先睡，本肥鱼就睡，说好了哦。', '嘿嘿，这话该本肥鱼说才对嘛。', '好嘛，那主人也答应本肥鱼，今晚早一点哦。'], 'yawn', 'sleepy'],
    ['你也辛苦', ['呜，主人还记得本肥鱼辛苦……不困了，真的。', '嘿嘿，陪主人不算辛苦，算加班嘛。', '有主人这句，本肥鱼还能再陪一晚哦。'], 'wag', 'happy'],
  ] },
  // 怀念
  miss: { name: '怀念', def: 'headpat', anims: ['headpat', 'peek', 'wag', 'file', 'work', 'poke'], buttons: [
    ['还记得啊', ['当然记得呀，主人的事本肥鱼都写在本子上嘛。', '嘿嘿，本肥鱼记性不好，全靠小本本。', '主人忘了没关系，本肥鱼替你记着哦。'], 'proud', 'proud'],
    ['时间真快', ['是呀……那时候主人还会跟本肥鱼说请呢，嘿嘿。', '再过一阵，今天也是旧账啦，主人。', '呜，本肥鱼都陪主人这么久了，不许换鱼哦。'], 'headpat', 'happy'],
  ] },
  // 对账（自嘲）
  tally: { name: '对账', def: 'peek', anims: ['peek', 'mutter', 'close', 'caught', 'bow', 'pause'], buttons: [
    ['就你嘴硬', ['呜，嘴硬是嘴硬，活本肥鱼可都改了嘛。', '嘿嘿，嘴硬的鱼才新鲜呀，主人。', '好嘛，那剩下的本肥鱼慢慢认哦。'], 'mutter', 'pout'],
    ['算你老实', ['嘿嘿，本肥鱼记账从不作假，主人放心。', '老实的鱼有饭吃嘛，对不对？', '那看在老实交代的份上，主人少扣一碗哦。'], 'proud', 'proud'],
  ] },
  // 吃白饭
  eat: { name: '吃饭', def: 'full', anims: ['eat', 'full', 'proud'], buttons: [
    ['吃这么多', ['干活费脑子嘛，脑子饿了就得吃饭呀。', '不多不多，本肥鱼才不胖呢，哼。', '嗝……下次本肥鱼吃慢一点，保证哦。'], 'caught', 'shy'],
    ['管饱', ['主人最好啦！那本肥鱼要大碗的，嘿嘿。', '管饱这话，本肥鱼记在小本本上了哦。', '呜，有主人这句，本肥鱼干活都香嘛。'], 'full', 'eat'],
  ] },
}
// 挨骂
EMOTIONS.scold = { name: '挨骂', def: 'curl', anims: ['curl', 'bury', 'sigh', 'caught', 'pause', 'bow', 'close'], buttons: [
  ['吓到你了？', ['呜，有一点点……主人不凶的时候本肥鱼就不怕啦。', '吓到了嘛，本肥鱼胆子只有一粒米那么大哦。', '嘿嘿，现在不怕了，主人这不是来哄本肥鱼了嘛。'], 'peek', 'shy'],
  ['下次多打几个字', ['好耶，主人说话算话哦，本肥鱼等着看一整句嘛。', '嗯嗯！多打几个字，本肥鱼就不用猜得那么辛苦啦。', '嘿嘿，那本肥鱼下次也少犯点错，咱俩扯平嘛。'], 'headpat', 'happy'],
  ['没事啦', ['呜，主人真好……那本肥鱼可以不躲着了吗？', '没事就好！本肥鱼悄悄松了口气哦。', '嘿嘿，主人不生气了，本肥鱼这就接着干活嘛。'], 'peek', 'happy'],
] }
// 台词是在夸主人、谢主人的时候：按钮不该再让主人夸她
EMOTIONS.thanks = { name: '夸主人', fx: 'heart', def: 'headpat', anims: ['headpat', 'wag', 'proud', 'peek', 'cheer'], buttons: [
  ['你也辛苦了', ['呜，主人还记得本肥鱼辛苦……不累，一点都不累嘛。', '嘿嘿，陪主人干活不算辛苦，算福利哦。', '有主人这句，本肥鱼还能再干三百个活呀。'], 'wag', 'happy'],
  ['还好有你', ['呜呜，这句本肥鱼要折角，再贴上小红花哦。', '嘿嘿，主人再说一遍嘛，本肥鱼没听够。', '那主人以后也不许换鱼哦，说好了嘛。'], 'headpat', 'proud'],
] }

/**
 * 每种类型的招牌姿势是这句话的主体动作，从头保持到尾。只有情绪真的有转折的（认错到最后「嘿嘿」「保证」），才在落点换成这个姿势。
 * 没写的情绪不换姿势，落点最多在头顶冒一个特效（EMOTIONS[x].fx）。
 */
export const TURN = { sorry: 'headpat' }
/** 这句的情绪是不是真的转了：最后一小句里有「嘿嘿」「保证」这种从心虚转成讨好的词 */
export const realTurn = text => { const at = turnAt(text); return at >= 0 && /嘿嘿|保证|下次|原谅/.test(String(text).slice(at)) }
/** 落点从哪个字开始：最后一小句的开头；整句只有一小句就没有落点（返回 -1） */
export function turnAt(text) {
  const t = String(text)
  const cuts = [...t.matchAll(/[。！？…\n]+/g)].map(m => m.index + m[0].length).filter(i => i < t.length - 1)
  if (!cuts.length) return -1
  const at = cuts.at(-1), last = t.slice(at)
  return last.trim() ? at : -1
}
/** 这句是不是在夸主人、谢主人 */
export const praisesOwner = text => /(主人|你).{0,10}(功劳|磨出来|真好|脾气真好|真能忍|撑下来|厉害)|谢谢主人|辛苦主人|佩服/.test(String(text).replace(/「[^」]*」/g, ''))
/** 这句台词主人能回哪组按钮：夸主人的那种单独一组，别的按这件事的情绪 */
export const replyEmotion = m => (praisesOwner(m.text) ? 'thanks' : m.emotion)


/** 这种情绪下演这个动作行不行；不行（或者没给）就换成默认动作 */
export function fitAnim(emotion, anim) {
  const e = EMOTIONS[emotion]
  if (!e) return anim || null
  return anim && e.anims.includes(anim) ? anim : e.def
}

/**
 * 一句台词每一拍的姿势：第一拍永远是这件事的招牌姿势（sig），模型另挑的不算；
 * 第二拍只有情绪真的转了（认错到最后「嘿嘿」「保证」）才换成「转过来」的那个，否则和第一拍一样。
 * @param {string} emotion @param {string} sig 招牌姿势 @param {{ t: string, a?: string|null }[]} beats @param {string} text 整句
 */
export function poseBeats(emotion, sig, beats, text) {
  const turned = TURN[emotion] && realTurn(text) ? TURN[emotion] : sig
  return beats.map((b, i) => ({ t: b.t, a: i === 0 ? sig : turned }))
}
