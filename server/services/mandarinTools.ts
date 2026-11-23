/* Dedicated Mandarin Chinese (中文普通话 / 國語) Linguistics, Orthography,
   Traditional↔Simplified Equivalence, Pinyin Similarity & Voice Homophone Repair */

// High-frequency Traditional -> Simplified pair tokens (explicitly space-separated to prevent pair-shift bugs)
const TRAD_TO_SIMP_PAIR_LIST = (
  '愛爱 戀恋 夢梦 聲声 響响 聽听 說说 話话 語语 詞词 風风 雲云 電电 閃闪 淚泪 傷伤 樂乐 歡欢 難难 過过 ' +
  '來来 開开 關关 門门 時时 間间 鐘钟 點点 邊边 遠远 裡里 後后 現现 還还 這这 個个 們们 妳你 誰谁 麼么 ' +
  '嗎吗 錯错 對对 為为 與与 讓让 給给 從从 國国 寫写 讀读 畫画 見见 視视 覺觉 認认 識识 選选 擇择 決决 ' +
  '變变 換换 牽牵 臉脸 發发 頭头 體体 動动 靜静 飛飞 進进 尋寻 贏赢 輸输 戰战 爭争 護护 幫帮 謝谢 請请 ' +
  '問问 應应 該该 須须 總总 經经 將将 卻却 雖虽 並并 無无 沒没 僅仅 實实 際际 萬万 億亿 兩两 雙双 單单 ' +
  '獨独 虛虚 滿满 輕轻 強强 鹹咸 鮮鲜 艷艳 爛烂 榮荣 華华 麗丽 純纯 潔洁 淨净 濁浊 淺浅 遙遥 寬宽 廣广 ' +
  '圓圆 彎弯 斷断 續续 連连 結结 終终 舊旧 歲岁 韻韵 調调 線线 樣样 種种 類类 條条 張张 顆颗 陣阵 場场 ' +
  '頁页 書书 紙纸 筆笔 號号 碼码 圖图 鏡镜 燈灯 燒烧 煙烟 塵尘 鐵铁 鋼钢 寶宝 貝贝 鑽钻 車车 機机 輪轮 ' +
  '灣湾 島岛 灘滩 凍冻 飄飘 輝辉 溫温 擁拥 掛挂 癡痴 瘋疯 懼惧 憂忧 鬱郁 悶闷 煩烦 惱恼 憐怜 堅坚 ' +
  '執执 誠诚 義义 禮礼 靈灵 蹟迹 跡迹 緣缘 運运 數数 恆恒 暫暂 歷历 驗验 觸触 補补 創创 編编 織织 ' +
  '繪绘 湧涌 貼贴 緊紧 鬆松 釋释 懷怀 準准 備备 繼继 敗败 勝胜 負负 責责 擔担 當当 諾诺 約约 會会 歸归 ' +
  '轉转 趕赶 蓋盖 鎖锁 鑰钥 啟启 搖摇 擺摆 蕩荡 節节 詩诗 態态 氣气 顏颜 喚唤 嘆叹 諒谅 顧顾'
).split(/\s+/);

const TO_SIMPLIFIED: Record<string, string> = {};
const TO_TRADITIONAL: Record<string, string> = {};
for (const pair of TRAD_TO_SIMP_PAIR_LIST) {
  if (pair.length === 2 && pair[0] !== pair[1]) {
    const tr = pair[0];
    const si = pair[1];
    TO_SIMPLIFIED[tr] = si;
    if (!TO_TRADITIONAL[si]) TO_TRADITIONAL[si] = tr;
  }
}
// Extra context-safe mappings (avoid ambiguous 髮/發 or 後/后 override conflicts)
TO_SIMPLIFIED['髮'] = '发';
TO_SIMPLIFIED['裡'] = '里';
TO_SIMPLIFIED['裏'] = '里';
TO_SIMPLIFIED['於'] = '于';
TO_SIMPLIFIED['麼'] = '么';
TO_SIMPLIFIED['著'] = '着';
TO_SIMPLIFIED['願'] = '愿';
TO_SIMPLIFIED['廣'] = '广';
TO_SIMPLIFIED['雲'] = '云';
TO_SIMPLIFIED['麵'] = '面';

export function containsHanzi(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(String(text || ''));
}

export function normalizeHanziBase(ch: string): string {
  const c = String(ch || '').trim();
  return TO_SIMPLIFIED[c] || c;
}

export function detectMandarinScript(text: string): 'zh-Hans' | 'zh-Hant' {
  let tradHits = 0;
  let simpHits = 0;
  for (const ch of String(text || '')) {
    if (TO_SIMPLIFIED[ch] && !TO_TRADITIONAL[ch]) tradHits++;
    else if (TO_TRADITIONAL[ch] && !TO_SIMPLIFIED[ch]) simpHits++;
  }
  return tradHits > simpHits ? 'zh-Hant' : 'zh-Hans';
}

export function harmonizeMandarinScript(text: string, targetScript: 'zh-Hans' | 'zh-Hant'): string {
  const map = targetScript === 'zh-Hant' ? TO_TRADITIONAL : TO_SIMPLIFIED;
  let out = '';
  for (const ch of String(text || '')) {
    out += map[ch] || ch;
  }
  return out;
}

// Core Mandarin Pinyin syllable dictionary (~1,050 high-frequency song & speech characters grouped by base syllable)
const PINYIN_GROUPS: Record<string, string> = {
  a: '啊阿呵',
  ai: '爱愛哀唉埃挨哎癌矮艾碍',
  an: '安暗岸按案安胺暗',
  ang: '昂',
  ao: '傲奥熬袄拗',
  ba: '吧把八爸巴拔罢霸坝芭疤',
  bai: '白百败擺摆拜柏',
  ban: '半办伴辦般班板版搬拌斑',
  bang: '帮幫旁傍榜棒绑磅',
  bao: '抱宝寶保报包薄爆暴饱剥',
  bei: '被悲北背杯贝貝备備倍辈碑',
  ben: '本奔笨',
  beng: '崩蹦',
  bi: '比笔筆必毕闭壁避鼻逼碧彼',
  bian: '边邊变變遍便编編辩辨',
  biao: '表标標飘表',
  bie: '别別憋',
  bin: '滨宾',
  bing: '冰并並病兵饼',
  bo: '波播泊博拨玻璃',
  bu: '不步部布补補捕怖',
  ca: '擦',
  cai: '才猜彩采菜财',
  can: '残惨餐参',
  cang: '藏苍沧仓',
  cao: '草操',
  ce: '测册侧策',
  ceng: '曾层',
  cha: '茶差查插察',
  chai: '拆',
  chan: '缠颤产',
  chang: '唱常长長场場肠尝偿',
  chao: '潮朝超吵抄',
  che: '车車彻撤扯',
  chen: '沉晨尘塵陈趁称衬',
  cheng: '成城承程诚誠称乘撑橙',
  chi: '吃持痴癡迟池尺翅赤',
  chong: '冲重充虫宠崇',
  chou: '愁抽丑臭',
  chu: '出初除处触觸楚础储',
  chuan: '穿传傳船川喘串',
  chuang: '窗床创創闯',
  chui: '吹垂锤',
  chun: '春纯純唇',
  ci: '词詞此刺次辞辭瓷慈',
  cong: '从從匆聪',
  cu: '粗促醋',
  cuan: '窜',
  cui: '脆碎催翠',
  cun: '存村寸',
  cuo: '错錯措',
  da: '大答打达搭',
  dai: '带帶代待戴袋呆',
  dan: '但单單淡担擔弹蛋诞',
  dang: '当當挡擋荡蕩党',
  dao: '到道倒岛島刀导盗',
  de: '的得德',
  deng: '等灯燈登',
  di: '地第底低滴帝弟递敌',
  dian: '点點电電店垫典颠',
  diao: '掉调調吊雕',
  die: '蝶跌叠',
  ding: '定订顶盯叮',
  diu: '丢',
  dong: '动動东冬懂洞冻凍',
  dou: '都斗抖豆读',
  du: '独獨度读讀渡毒赌堵',
  duan: '断斷短段端',
  dui: '对對队堆兑',
  dun: '顿蹲盾',
  duo: '多朵躲夺堕',
  e: '恶饿鹅额哦',
  en: '恩嗯',
  er: '而儿耳二尔',
  fa: '发發法罚乏伐',
  fan: '繁烦煩反饭翻犯凡范',
  fang: '放方防房访芳仿',
  fei: '飞飛非肥费废肺啡',
  fen: '分粉份纷奋愤',
  feng: '风風封疯瘋峰锋丰逢',
  fo: '佛',
  fou: '否',
  fu: '福幅负負复服付扶浮符富府父夫',
  gai: '该該改盖蓋概',
  gan: '感敢干甘肝赶趕',
  gang: '刚钢鋼港岗',
  gao: '高告搞膏',
  ge: '歌个個各哥隔格割',
  gei: '给給',
  gen: '跟根',
  geng: '更耕',
  gong: '共公功工攻宫供',
  gou: '够构狗沟勾',
  gu: '孤故顾顧古鼓骨谷固',
  gua: '挂掛刮瓜',
  guai: '怪乖',
  guan: '关關观管官惯馆',
  guang: '光广廣逛',
  gui: '归歸贵鬼轨',
  gun: '滚',
  guo: '过過国國果锅裹',
  ha: '哈',
  hai: '海还還害孩',
  han: '寒喊含汗汉憾',
  hang: '行航',
  hao: '好号號毫豪浩',
  he: '和河合喝何黑荷盒',
  hei: '黑嘿',
  hen: '很恨痕',
  heng: '横恒恆哼',
  hong: '红紅虹宏洪轰',
  hou: '后後候厚猴',
  hu: '呼湖护護狐虎胡乎互忽',
  hua: '花画畫话話华華滑化',
  huai: '坏壞怀懷',
  huan: '欢歡还换換幻环',
  huang: '黄慌荒皇晃',
  hui: '回会會灰挥辉輝悔毁汇绘繪',
  hun: '昏魂婚混',
  huo: '或火活货获',
  ji: '记記己几寂季迹蹟跡极机機鸡急集级际際给及击激挤',
  jia: '家假加价架驾甲',
  jian: '见見间間坚堅简件建渐肩剑',
  jiang: '将將江讲降强',
  jiao: '叫角觉教交焦骄娇胶',
  jie: '界介接结結借节節街姐解洁潔',
  jin: '今紧緊近进進金尽仅僅斤',
  jing: '经經静靜镜鏡净淨景惊精竟警',
  jiu: '就久酒旧舊救九究',
  ju: '聚句举拒局剧具居巨',
  juan: '卷倦',
  jue: '觉覺决決绝掘',
  jun: '军君均',
  ka: '卡咖',
  kai: '开開',
  kan: '看砍刊',
  kang: '康抗',
  kao: '靠考烤',
  ke: '可刻克科客颗顆渴课',
  ken: '肯',
  kong: '空恐孔控',
  kou: '口扣',
  ku: '哭苦库裤酷',
  kua: '跨夸',
  kuai: '快块筷',
  kuan: '宽寬款',
  kuang: '狂况框矿',
  kui: '亏愧',
  kun: '困昆',
  kuo: '阔扩',
  la: '啦拉辣蜡',
  lai: '来來赖',
  lan: '蓝藍懒烂爛拦篮',
  lang: '浪朗狼廊',
  lao: '老劳牢',
  le: '了乐樂勒',
  lei: '泪淚累类類雷',
  leng: '冷',
  li: '离離里裡力立丽麗理礼禮历歷利例励',
  lian: '恋戀脸臉连連练炼怜憐',
  liang: '亮凉涼两兩量良粮',
  liao: '聊了辽疗料',
  lie: '烈裂猎',
  lin: '林淋临邻',
  ling: '灵靈零铃领另令',
  liu: '流留六柳',
  long: '龙笼浓',
  lou: '楼漏露',
  lu: '路露鹿录绿陆',
  luan: '乱卵',
  lue: '略',
  lun: '轮輪论',
  luo: '落罗萝',
  lv: '绿綠旅律履',
  ma: '吗嗎嘛妈马骂麻',
  mai: '买卖迈埋',
  man: '慢漫满滿瞒',
  mang: '忙盲茫芒',
  mao: '猫毛帽貌冒',
  me: '么麼',
  mei: '美没沒每妹眉梅媒煤',
  men: '们們门門闷悶',
  meng: '梦夢猛蒙萌',
  mi: '迷密秘蜜米',
  mian: '面麵眠绵免',
  miao: '秒描妙庙',
  mie: '灭',
  min: '民敏',
  ming: '明名命鸣',
  mo: '寞莫默磨抹摸魔末模',
  mou: '某谋',
  mu: '目木母幕慕墓牧',
  na: '那哪拿纳呐',
  nai: '耐奶乃',
  nan: '难難南男',
  nao: '恼惱脑闹',
  ne: '呢',
  nei: '内',
  nen: '嫩',
  neng: '能',
  ni: '你妳呢泥逆拟霓',
  nian: '念年粘',
  niang: '娘',
  niao: '鸟',
  nie: '捏',
  nin: '您',
  ning: '宁凝',
  niu: '牛扭',
  nong: '浓弄',
  nu: '怒努女',
  nuan: '暖',
  nuo: '诺諾',
  nv: '女',
  o: '哦',
  ou: '偶欧',
  pa: '怕爬趴',
  pai: '拍排派牌',
  pan: '盼盘判',
  pang: '旁胖',
  pao: '跑抛泡炮',
  pei: '陪配佩',
  pen: '喷',
  peng: '朋碰捧棚',
  pi: '皮疲脾批披',
  pian: '片骗偏篇',
  piao: '飘飄票漂',
  pie: '撇',
  pin: '拼品贫',
  ping: '平瓶评凭',
  po: '破泊坡',
  pou: '剖',
  pu: '普扑铺',
  qi: '起期七奇其气氣齐弃企启啟泣妻',
  qia: '恰',
  qian: '前牵牽千浅淺钱欠签',
  qiang: '强強墙抢枪',
  qiao: '桥橋悄敲瞧巧',
  qie: '切且窃怯',
  qin: '亲親琴勤侵',
  qing: '情晴清青轻輕请請倾',
  qiong: '穷',
  qiu: '秋求球',
  qu: '去曲取趣区驱',
  quan: '全泉劝圈',
  que: '却卻缺确',
  qun: '群裙',
  ran: '然燃染',
  rang: '让讓嚷',
  rao: '绕繞',
  re: '热熱惹',
  ren: '人认認忍任仁',
  reng: '仍扔',
  ri: '日',
  rong: '容荣榮融溶',
  rou: '柔肉',
  ru: '如入乳',
  ruan: '软',
  rui: '锐瑞',
  run: '润',
  ruo: '若弱',
  sa: '洒撒',
  sai: '赛',
  san: '散三伞傘',
  sang: '丧桑',
  sao: '扫骚',
  se: '色涩',
  sen: '森',
  sha: '傻沙杀',
  shai: '晒',
  shan: '山闪閃善扇衫',
  shang: '伤傷上尚赏商',
  shao: '少烧燒稍',
  she: '舍设社射蛇',
  shei: '谁誰',
  shen: '深身神什伸审',
  sheng: '声聲生升胜勝剩圣',
  shi: '是事时時世十实實识識始试誓失室市视視湿诗詩石',
  shou: '手守受收首瘦熟',
  shu: '书書数數树樹输輸熟束属',
  shua: '刷',
  shuai: '衰甩帅',
  shuan: '拴',
  shuang: '双雙霜爽',
  shui: '水谁誰睡税',
  shun: '顺瞬',
  shuo: '说說硕',
  si: '思死似私丝四司撕',
  song: '送松鬆颂',
  sou: '搜',
  su: '诉訴速素苏宿',
  suan: '算酸',
  sui: '岁歲碎随虽雖',
  sun: '损孙',
  suo: '所锁鎖缩',
  ta: '他她它踏塔',
  tai: '太台态態抬',
  tan: '谈談叹嘆探弹贪',
  tang: '淌躺糖汤堂',
  tao: '逃讨套桃',
  te: '特',
  teng: '疼腾',
  ti: '体體提题替踢',
  tian: '天甜田填添',
  tiao: '跳调條条挑',
  tie: '贴貼铁鐵',
  ting: '听聽停挺庭',
  tong: '痛同通童铜銅统',
  tou: '头頭透偷投',
  tu: '图圖土突涂吐徒',
  tuan: '团',
  tui: '退推腿',
  tun: '吞',
  tuo: '脱脫拖妥',
  wa: '哇挖瓦',
  wai: '外歪',
  wan: '晚万萬完弯彎玩挽碗',
  wang: '忘望往王网',
  wei: '为為微唯位未味威围委慰尾',
  wen: '温溫问問文稳吻闻',
  wo: '我握窝',
  wu: '无無物五雾霧舞午悟误屋',
  xi: '西希息惜喜吸细夕洗席习',
  xia: '下夏吓霞瞎',
  xian: '先现現线線鲜鮮仙显险限',
  xiang: '想相香向响響像象乡',
  xiao: '笑小消效晓宵',
  xie: '写寫谢謝些鞋斜携',
  xin: '心新信欣辛',
  xing: '星行幸醒性形兴',
  xiong: '胸兄雄',
  xiu: '休修羞袖',
  xu: '需须許许虚虛续續序',
  xuan: '选選旋悬',
  xue: '雪学血',
  xun: '寻尋训迅',
  ya: '呀压雅牙亚',
  yan: '眼烟煙颜顏言演严延厌',
  yang: '阳陽样樣羊洋扬养',
  yao: '要遥遙摇搖药咬腰耀',
  ye: '夜也叶葉业页頁野',
  yi: '一以已意忆憶依移疑衣义易异亿億',
  yin: '因音阴陰引银銀隐印饮',
  ying: '影应應迎英映赢贏硬樱',
  yong: '永拥擁用勇',
  you: '有友又由游油优忧憂犹',
  yu: '雨与與语語宇于於遇余欲愈愉',
  yuan: '远遠愿願缘緣元原圆園园',
  yue: '月越约約乐悦',
  yun: '云雲运運韵韻晕允',
  za: '杂砸',
  zai: '在再载',
  zan: '暂暫赞',
  zang: '脏葬',
  zao: '早造遭糟',
  ze: '则责責择澤',
  zen: '怎',
  zeng: '增曾',
  zha: '扎炸',
  zhai: '摘窄',
  zhan: '站战戰展占',
  zhang: '张張长掌涨账',
  zhao: '找照招着朝',
  zhe: '这這着著折遮',
  zhen: '真珍阵陣震针',
  zheng: '正争爭整证睁',
  zhi: '只知直值之指纸紙止至治志支枝',
  zhong: '中终終钟鐘重种種众',
  zhou: '周洲昼',
  zhu: '住祝注主助柱珠竹猪',
  zhua: '抓',
  zhuan: '转轉专砖',
  zhuang: '装撞壮状',
  zhui: '追坠',
  zhun: '准準',
  zhuo: '桌捉',
  zi: '自字子紫资仔',
  zong: '总總纵',
  zou: '走',
  zu: '足组阻租祖',
  zuan: '钻鑽',
  zui: '最醉嘴',
  zun: '尊遵',
  zuo: '做作坐座昨',
};

const HANZI_TO_PINYIN: Record<string, string> = {};
for (const [py, chars] of Object.entries(PINYIN_GROUPS)) {
  for (const ch of chars) {
    if (!HANZI_TO_PINYIN[ch]) {
      HANZI_TO_PINYIN[ch] = py;
    }
  }
}

export function mandarinCharToPinyin(ch: string): string {
  const clean = String(ch || '').trim();
  if (!clean) return '';
  if (HANZI_TO_PINYIN[clean]) return HANZI_TO_PINYIN[clean];
  const simp = TO_SIMPLIFIED[clean];
  if (simp && HANZI_TO_PINYIN[simp]) return HANZI_TO_PINYIN[simp];
  return '';
}

function pinyinPhoneticSim(pyA: string, pyB: string): number {
  if (!pyA || !pyB) return 0;
  if (pyA === pyB) return 0.92;
  // Common Mandarin singing/accent fuzzy phonetic equivalents (n/ng, zh/z, ch/c, sh/s, l/n, in/ing, en/eng, an/ang)
  const normFuzzy = (p: string) =>
    p
      .replace(/^zh/, 'z')
      .replace(/^ch/, 'c')
      .replace(/^sh/, 's')
      .replace(/^n/, 'l')
      .replace(/ing$/, 'in')
      .replace(/eng$/, 'en')
      .replace(/ang$/, 'an');
  if (normFuzzy(pyA) === normFuzzy(pyB)) return 0.84;
  return 0;
}

export function mandarinCharSimilarity(a: string, b: string): number {
  const ca = normalizeHanziBase(a.replace(/[，。！？、；：…,.!?;:]/g, ''));
  const cb = normalizeHanziBase(b.replace(/[，。！？、；：…,.!?;:]/g, ''));
  if (!ca || !cb) return 0;
  if (ca === cb) return 1.0;
  if (ca.length === 1 && cb.length === 1) {
    const pa = mandarinCharToPinyin(ca);
    const pb = mandarinCharToPinyin(cb);
    return pinyinPhoneticSim(pa, pb);
  }
  return 0;
}

// Stage-A Common Mandarin multi-character homophone & spelling typo collocation fixes
const ZH_COLLOCATION_FIXES: Record<string, string> = {
  // Casual / phonetic typos -> correct Simplified Chinese
  因位: '因为',
  所已: '所以',
  一值: '一直',
  以经: '已经',
  已前: '以前',
  已后: '以后',
  时侯: '时候',
  时后: '时候',
  在见: '再见',
  在次: '再次',
  在说: '再说',
  在也: '再也',
  现再: '现在',
  觉的: '觉得',
  因该: '应该',
  虽燃: '虽然',
  但事: '但是',
  如过: '如果',
  或着: '或者',
  非长: '非常',
  没油: '没有',
  什莫: '什么',
  怎莫: '怎么',
  为什莫: '为什么',
  快落: '快乐',
  幸幅: '幸福',
  幸褔: '幸福',
  温油: '温柔',
  微效: '微笑',
  眼累: '眼泪',
  梦相: '梦想',
  回亿: '回忆',
  世介: '世界',
  实间: '时间',
  永愿: '永远',
  永运: '永远',
  永敢: '勇敢',
  坚驰: '坚持',
  感东: '感动',
  安净: '安静',
  孤读: '孤独',
  记寞: '寂寞',
  陪办: '陪伴',
  真惜: '珍惜',
  望记: '忘记',
  成诺: '承诺',
  等代: '等待',
  等带: '等待',
  相心: '相信',
  希忘: '希望',
  感角: '感觉',
  身音: '声音',
  哥词: '歌词',
  歌辞: '歌词',
  选律: '旋律',
  名天: '明天',
  作天: '昨天',
  今添: '今天',
  朋有: '朋友',
  保贝: '宝贝',
  亲哀: '亲爱',
  浪慢: '浪漫',
  美力: '美丽',
  轻春: '青春',
  杨光: '阳光',
  温暧: '温暖',
  名白: '明白',
  决订: '决定',
  一订: '一定',
  一羊: '一样',
  一企: '一起',
  一窃: '一切',
  好象: '好像',
  以微: '以为',
  喜翻: '喜欢',
  不嫩: '不能',
  不药: '不要',
  看件: '看见',
  听件: '听见',
  心调: '心跳',
  真地: '真的',
  招顾: '照顾',
  保紧: '抱紧',
  防手: '放手',
  回投: '回头',
  经果: '经过',
  该变: '改变',
  从钱: '从前',
  知前: '之前',
  做梦: '做梦',
  在作: '在做',
  必需要: '必须要',
  光忙: '光芒',
  心光: '星光',
  月凉: '月亮',
  清清: '轻轻',
  漫漫: '慢慢',
  好号: '好好',
  子细: '仔细',
  终於: '终于',
  甚么: '什么',
};

// High-frequency valid Mandarin 2-character & 3-character words used to guard Stage-B voice homophone repair
const ZH_LEXICON_RAW =
  '因为 所以 一直 以前 以后 已经 时候 再见 再次 再说 再也 现在 觉得 应该 虽然 但是 如果 或者 非常 没有 什么 怎么 快乐 幸福 温柔 微笑 眼泪 梦想 思念 回忆 世界 时间 永远 从前 勇敢 坚持 感动 安静 孤独 寂寞 陪伴 珍惜 离开 忘记 承诺 等待 相信 希望 光芒 星光 星空 月亮 天空 微风 声音 歌词 旋律 明天 昨天 今天 朋友 宝贝 亲爱 浪漫 美丽 青春 阳光 温暖 照顾 抱紧 放手 回头 改变 明白 决定 其实 终于 一定 一切 一样 一起 看见 听见 感觉 心跳 喜欢 爱上 爱你 想你 等你 拥有 失去 发现 知道 开始 结束 继续 过去 未来 生命 生活 人生 灵魂 心中 心里 眼里 身边 天边 海边 城市 街头 雨夜 黑夜 夜晚 清晨 黄昏 流星 蝴蝶 花朵 落叶 海洋 微光 闪烁 呼吸 秘密 奇迹 力量 自由 飞翔 奔跑 追逐 寻找 守候 依靠 牵手 拥抱 流泪 哭泣 欢笑 甜蜜 痛苦 悲伤 忧伤 心痛 心碎 错过 遇见 相逢 重逢 分离 告别 祝福 祈祷 愿望 风景 画面 记忆 故事 日记 写信 诗歌 音乐 节奏 节拍 舞台 灯光 掌声 岁月 时光 年华 季节 春天 夏天 秋天 冬天 白雪 细雨 彩虹 云朵 太阳 朝霞 晚霞 晚风 寒风 春风 秋风 雪花 烟火 霓虹 路口 车站 远方 家乡 故乡 中国 中文 北京 上海 台北 香港 地球 宇宙 银河 星河 天涯 海角 瞬间 永恒 真实 清醒 沉醉 迷茫 坚定 认真 仔细 简单 复杂 普通 特别 完美 遗憾 后悔 原谅 感谢 谢谢 对不起 没关系 为什么 全世界 一辈子 一瞬间 不能 不要 以为 只能 只有 只要 只要有 好好 慢慢 轻轻 悄悄 渐渐 突然 忽然 还是 还是会 还是你 不是 不再 不想 不敢 不懂 不见 一点 一起走 爱过 错过 经过 走过 唱出 说出 听见你 看见你 只要你 天气 真好 很好 每天 天天 你好 记得 开心 美好 相爱 相伴 永远爱你 在乎 在意 心动 感动 心愿 缘分 珍惜你 守护 一直都在';

export const ZH_COMMON_WORDS = new Set<string>(ZH_LEXICON_RAW.split(/\s+/).filter(Boolean));
// Add Traditional equivalents of the lexicon so ZH-Hant validation works seamlessly
for (const w of Array.from(ZH_COMMON_WORDS)) {
  const trad = harmonizeMandarinScript(w, 'zh-Hant');
  if (trad !== w) ZH_COMMON_WORDS.add(trad);
}

export interface MandarinLineAudit {
  correctedLine: string;
  changes: Array<{ original: string; corrected: string; source: 'orthography' | 'punctuation' }>;
}

export function fixMandarinCollocationsAndPunctuation(
  rawLine: string,
  targetScript: 'zh-Hans' | 'zh-Hant' | 'auto' = 'auto',
): MandarinLineAudit {
  let line = String(rawLine || '').trim();
  const changes: Array<{ original: string; corrected: string; source: 'orthography' | 'punctuation' }> = [];
  if (!line || !containsHanzi(line)) {
    return { correctedLine: line, changes };
  }

  // 1. Remove spurious spaces between Hanzi characters & right before CJK/Latin punctuation adjacent to Hanzi
  const spaceCleaned = line
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf，。！？；：、])/g, '$1')
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+([,.!?;:])(?=\s|$|[\u4e00-\u9fff])/g, '$1$2')
    .replace(/([，。！？；：])\s+/g, '$1');

  if (spaceCleaned !== line) {
    line = spaceCleaned;
  }

  // 2. Harmonize script if user explicitly chose Simplified or Traditional
  if (targetScript === 'zh-Hans' || targetScript === 'zh-Hant') {
    const harmonized = harmonizeMandarinScript(line, targetScript);
    if (harmonized !== line) {
      // Record distinct character diffs concisely
      const charsBefore = Array.from(line);
      const charsAfter = Array.from(harmonized);
      for (let i = 0; i < Math.min(charsBefore.length, charsAfter.length); i++) {
        if (charsBefore[i] !== charsAfter[i]) {
          changes.push({ original: charsBefore[i], corrected: charsAfter[i], source: 'orthography' });
        }
      }
      line = harmonized;
    }
  }

  // 3. Fix unambiguous multi-character Mandarin collocation typos / wrong homophones
  const effectiveScript = targetScript === 'auto' ? detectMandarinScript(line) : targetScript;
  for (const [wrong, rightBase] of Object.entries(ZH_COLLOCATION_FIXES)) {
    if (wrong === rightBase) continue;
    // Note: skip "清清" (valid reduplication in "清清淡淡"), "漫漫" ("长夜漫漫"), "好号" wait keep safe
    if (wrong === '清清' || wrong === '漫漫') continue;
    // Preserve '終於'/'甚麼' if user explicitly writes Traditional zh-Hant
    if (effectiveScript === 'zh-Hant' && (wrong === '終於' || wrong === '甚么')) continue;

    const right = effectiveScript === 'zh-Hant' ? harmonizeMandarinScript(rightBase, 'zh-Hant') : rightBase;
    if (line.includes(wrong) && wrong !== right) {
      line = line.split(wrong).join(right);
      changes.push({ original: wrong, corrected: right, source: 'orthography' });
    }
    const wrongTrad = harmonizeMandarinScript(wrong, 'zh-Hant');
    if (wrongTrad !== wrong && line.includes(wrongTrad) && wrongTrad !== right) {
      line = line.split(wrongTrad).join(right);
      changes.push({ original: wrongTrad, corrected: right, source: 'orthography' });
    }
  }

  return { correctedLine: line, changes };
}

/* Stage B: Voice-Linked Mandarin Homophone Repair
   Uses DTW-paired Whisper character + adjacent Hanzi bigram context to catch wrong homophones
   while NEVER touching valid poetic or standard collocations. */
export function evaluateMandarinVoiceRepair(
  userCharRaw: string,
  prevCharInLine: string,
  nextCharInLine: string,
  voiceCharRaw: string,
  voiceConf: number,
  targetScript: 'zh-Hans' | 'zh-Hant' | 'auto' = 'auto',
): { shouldReplace: boolean; finalChar: string } {
  const punctTail = (userCharRaw.match(/[，。！？、；：…,.!?;:]+$/) || [''])[0];
  const uCh = punctTail ? userCharRaw.slice(0, -punctTail.length) : userCharRaw;
  const vCleanRaw = String(voiceCharRaw || '').replace(/[，。！？、；：…,.!?;:\s]/g, '');
  if (uCh.length !== 1 || !containsHanzi(uCh) || !vCleanRaw || !containsHanzi(vCleanRaw)) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }

  const vCh0 = Array.from(vCleanRaw)[0];
  const effScript = targetScript === 'auto' ? detectMandarinScript(`${prevCharInLine}${uCh}${nextCharInLine}`) : targetScript;
  const vCh = harmonizeMandarinScript(vCh0, effScript);
  if (normalizeHanziBase(uCh) === normalizeHanziBase(vCh)) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }

  const pySim = mandarinCharSimilarity(uCh, vCh);
  if (voiceConf < 0.78 || pySim < 0.80) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }

  const prevC = prevCharInLine.replace(/[，。！？、；：…,.!?;:\s]/g, '');
  const nextC = nextCharInLine.replace(/[，。！？、；：…,.!?;:\s]/g, '');

  const userHasLeftWord = Boolean(prevC && ZH_COMMON_WORDS.has(`${prevC}${uCh}`));
  const userHasRightWord = Boolean(nextC && ZH_COMMON_WORDS.has(`${uCh}${nextC}`));
  if (userHasLeftWord || userHasRightWord) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }

  const voiceFormsLeftWord = Boolean(prevC && ZH_COMMON_WORDS.has(`${prevC}${vCh}`));
  const voiceFormsRightWord = Boolean(nextC && ZH_COMMON_WORDS.has(`${vCh}${nextC}`));
  if (voiceFormsLeftWord || voiceFormsRightWord) {
    return { shouldReplace: true, finalChar: `${vCh}${punctTail}` };
  }

  return { shouldReplace: false, finalChar: userCharRaw };
}
