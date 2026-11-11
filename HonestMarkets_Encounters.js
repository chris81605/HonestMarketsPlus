(function () {
    "use strict";

    const HM = setup.HonestMarkets = setup.HonestMarkets || {};
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // 依原版衣物暴露規則獨立計算事件文案所需程度；不可直接呼叫原版內部函式。
    // 濕透與未穿著均可回傳 2，但劇情仍須另外辨別衣物遮蔽原因。
    HM.ambushItemExposure = function (slot) {
        const V = State.variables;
        if (V.fox >= 7 && (slot === "legs" || slot === "feet")) return 0;
        const item = V.worn?.[slot];
        if (!item) return 0;
        const types = Array.isArray(item.type) ? item.type : [];
        const wetstage = Number(V[slot.replace("_", "") + "wetstage"] || 0);
        if (types.includes("naked") || wetstage >= 3) return 2;
        return Number(item.exposed || 0);
    };

    /*
     * ==================== 市場隨機遭遇 ====================
     *
     * 每次建立市場時先以 MARKET_ENCOUNTER_CHANCE 判定是否產生遭遇；命中後再從
     * 當下 eligible() 成立的事件中依 weight 相對權重抽選。weight 不是固定百分比，
     * 候選事件因商品、庫存等條件退出時，其餘事件會依剩餘總權重重新分配機率。
     *
     * MARKET_ENCOUNTERS 同時是事件資料表與統一接口。事件定義可提供：
     * - weight：進入候選池後的基礎相對抽選權重。
     * - timeWeights：可選的時段倍率；未宣告的時段維持 ×1。
     * - npc：false 不生成、true 生成一名、整數 1～6 生成指定數量 NPC。
     * - eligible()：只判斷目前是否具備事件條件，不應改變遊戲狀態。
     * - create(encounter)：事件被抽中後只執行一次，用來鎖定商品、價格與隨機結果。
     * - resolve(encounter, action)：處理玩家選項並套用金錢、物品、狀態等實際效果。
     * - output / resultOutput：分別指定事件本體與結果畫面的 Twee widget。
     *
     * 抽中的 encounter 會保存到遊戲狀態。Maplebirch gate 只檢查已保存的事件 ID，
     * 不在 cond 中擲骰或建立狀態，因此框架重複檢查條件也不會重新抽選事件。
     */
    HM.MARKET_ENCOUNTER_CHANCE = 40;
    HM.MARKET_ENCOUNTERS = Object.create(null);

    // 40% 是正常探索的最低事件率；營業時段只會提高，不會因時間而低於此基準。
    HM.getMarketEncounterTimeInfo = function () {
        const hour = typeof Time !== "undefined" ? Number(Time.hour) : NaN;
        if (!Number.isFinite(hour)) return { key: "daytime", name: "一般營業", chance: 45 };
        if (hour >= 6 && hour < 7) return { key: "preparing", name: "準備營業", chance: 40 };
        if (hour >= 7 && hour < 10) return { key: "morning", name: "早市", chance: 45 };
        if (hour >= 10 && hour < 16) return { key: "daytime", name: "一般營業", chance: 45 };
        if (hour >= 16 && hour < 19) return { key: "peak", name: "人潮高峰", chance: 55 };
        if (hour >= 19 && hour < 21) return { key: "late", name: "收市前", chance: 50 };
        if (hour >= 21 && hour < 22) return { key: "closing", name: "收市", chance: 40 };
        return { key: "closed", name: "休市", chance: 0 };
    };

    // 通用動態權重倍率：各事件可選擇提供 weightModifier(timeInfo)。
    // 沒有宣告時維持 ×1；回傳 0 可暫時排除事件，錯誤或非有限數字則退回 ×1。
    HM.marketEncounterDynamicMultiplier = function (definition, timeInfo) {
        if (typeof definition?.weightModifier !== "function") return 1;
        try {
            const value = Number(definition.weightModifier(timeInfo));
            return Number.isFinite(value) ? Math.max(0, value) : 1;
        } catch (error) {
            console.warn("[HonestMarkets] Event weightModifier failed:", definition?.id, error);
            return 1;
        }
    };

    HM.marketEncounterWeight = function (definition, timeInfo) {
        const base = Math.max(0, Number(definition?.weight) || 0);
        const rawTimeMultiplier = definition?.timeWeights?.[timeInfo?.key];
        const timeMultiplier = rawTimeMultiplier == null ? 1 : Math.max(0, Number(rawTimeMultiplier) || 0);
        const dynamicMultiplier = HM.marketEncounterDynamicMultiplier(definition, timeInfo);
        return base * timeMultiplier * dynamicMultiplier;
    };

    // 所有事件都透過此入口加入資料表；重複 ID 直接拒絕，避免覆蓋既有事件定義。
    HM.registerMarketEncounter = function (id, definition) {
        if (!id || !definition || HM.MARKET_ENCOUNTERS[id]) return false;
        HM.MARKET_ENCOUNTERS[id] = Object.assign({ id, weight: 0, npc: false }, definition);
        return true;
    };

    /*
     * eligible() 同時負責事件本身條件與場景資格。抽選可能發生在真正切換 Passage
     * 前，因此 HM.isPassage() 優先讀取本次抽選指定的目標 Passage；沒有指定時
     * 才退回目前 passage()。沒有呼叫 HM.isPassage() 的事件自然就是通用事件。
     */
    HM.normalizeEncounterPassage = function (name) {
        return name === "HonestMarkets Category" ? "HonestMarkets Products" : name;
    };

    HM.isPassage = function (...names) {
        let current = HM._encounterTargetPassage;
        if (!current) {
            try { current = typeof passage === "function" ? passage() : ""; }
            catch (_) { current = ""; }
        }
        current = HM.normalizeEncounterPassage(current);
        return names.map(HM.normalizeEncounterPassage).includes(current);
    };

    HM.prepareMarketEncounter = function (targetPassage, source = "enter") {
        return HM.rollMarketEncounter(source, null, HM.normalizeEncounterPassage(targetPassage));
    };


    // 只回傳本輪仍有庫存且商品資料有效的報價，供事件資格與目標抽選共用。
    HM.marketOffers = function () {
        return Object.values(State.variables.honestMarketsVisit?.categories || {})
            .flat()
            .filter(o => o?.qty > 0 && setup.foodstuff?.[o.id]);
    };

    // 貨箱角落事件：框架生成兩名 NPC；場景、人物互動及驚嚇結果於 create() 鎖定。
    HM.registerMarketEncounter("hidden_couple", {
        weight: 13,
        timeWeights: { preparing: 0.3, morning: 0.6, daytime: 0.8, peak: 1.0, late: 1.5, closing: 1.1 },
        npc: 2,
        output: "HonestMarketsEncounterHiddenCouple",
        resultOutput: "HonestMarketsEncounterHiddenCoupleResult",
        create(e) {
            e.startleWorks = HM.rollChance(50);
            // 同一次事件的場景、人物互動與結果差分只抽取一次，避免切換 Passage 時改變敘述。
            e.sceneVariant = rand(0, 3);
            e.coupleDynamic = rand(0, 2);
            e.watchVariant = rand(0, 2);
            e.startleVariant = rand(0, 2);
        },
        resolve(e, action) {
            if (e.stage === "initial") {
                if (action === "ignore") e.result = "ignored";
                else if (action === "approach") e.stage = "discovered";
                else return false;
                return true;
            }
            // 偷看分支先等待玩家選擇，確認繼續後才進入收尾。
            if (e.stage === "watching") {
                if (action === "watch_continue") {
                    e.result = "watched";
                    return true;
                }
                if (action === "masturbate") {
                    e.stage = "masturbating";
                    State.variables.masturbationstart = 1;
                    State.variables.outside = 1;
                    return true;
                }
                return false;
            }
            if (e.stage !== "discovered") return false;
            const willing = (Number(State.variables.promiscuity) || 0) >= 60;
            if (action === "leave") {
                if (willing) {
                    // 主動不打擾：不改變任何角色狀態。
                    e.result = "left_quietly";
                } else {
                    Wikifier.wikifyEval("<<arousal 100>><<awareness 1>>");
                    e.result = "embarrassed";
                }
            } else if (action === "watch" && willing) {
                Wikifier.wikifyEval("<<arousal 500>>");
                e.stage = "watching";
            } else if (action === "startle" && willing) {
                Wikifier.wikifyEval("<<stress -2>>");
                e.result = e.startleWorks ? "startled" : "unfazed";
            } else return false;
            return true;
        }
    });

    // 原版街道收購貼身衣物事件的市場版本：只在建檔時抽選收購部位與價格。
    HM.marketUnderwearOptions = function () {
        const worn = State.variables.worn || {};
        const upper = worn.under_upper;
        const lower = worn.under_lower;
        const valid = item => item && item.name !== "naked" && !item.one_piece;
        const options = [];
        if (valid(upper)) options.push("upper");
        if (valid(lower)) options.push("lower");
        if (valid(upper) && valid(lower)) options.push("set");
        return options;
    };

    // 連身內衣不是缺貨；只有真正出售時才改走整件重新報價。
    HM.marketCollectorOnePiece = function () {
        const w = State.variables.worn || {};
        const u = w.under_upper, l = w.under_lower;
        const present = x => !!x && x.name !== "naked";
        const linked = present(u) && present(l) && !!l.outfitSecondary && l.outfitSecondary[1] === u.name;
        const one = (present(u) && u.one_piece === 1) || (present(l) && l.one_piece === 1);
        return {
            active: !!(one && linked),
            upper: present(u), lower: present(l),
            upperName: present(u) ? (u.cn_name_cap || u.name) : "內衣",
            lowerName: present(l) ? (l.cn_name_cap || l.name) : "內褲"
        };
    };

    // 敘事用的衣著快照：上、下半身獨立判斷，不能以暴露癖推測是否穿著外衣。
    // DoL 的 naked 為空槽；此快照只用於文案，不修改實際穿著。
    HM.marketCollectorClothing = function () {
        const worn = State.variables.worn || {};
        const present = slot => !!slot && slot.name !== "naked";
        return {
            upperOuter: present(worn.upper) || present(worn.over_upper),
            lowerOuter: present(worn.lower) || present(worn.over_lower),
            upperUnder: present(worn.under_upper),
            lowerUnder: present(worn.under_lower),
            upperName: present(worn.under_upper) ? (worn.under_upper.cn_name_cap || worn.under_upper.name) : "",
            lowerName: present(worn.under_lower) ? (worn.under_lower.cn_name_cap || worn.under_lower.name) : "",
            onePiece: HM.marketCollectorOnePiece().active
        };
    };

    // 統一依原版最終誘惑值計算機率；各事件自行指定最低與最高值。
    HM.allureChance = function (minimum, maximum) {
        const allure = Math.max(0, Math.min(16000, Number(State.variables.allure) || 0));
        return Math.round(minimum + (maximum - minimum) * allure / 16000);
    };

    // 原版 Street Panties：下身殘留精液總量 >= 3 優先，其次興奮度 >= 60%。
    // 於交貨前快照，避免衣物移除後的狀態變化影響結果頁面。
    HM.marketCollectorStainReaction = function () {
        const v = State.variables;
        const liquid = v.player?.bodyliquid || {};
        const semen = ["vagina", "vaginaoutside", "anus", "bottom"]
            .reduce((sum, part) => sum + (Number(liquid[part]?.semen) || 0), 0);
        if (semen >= 3) return "semen";
        const arousal = Number(v.arousal) || 0;
        const maximum = Number(v.arousalmax) || 0;
        return maximum > 0 && arousal >= maximum * 0.6 ? "arousal" : "normal";
    };

    // 觸碰交易差分：興奮與精液平行判定，不能沿用內褲事件的互斥回傳值。
    HM.marketCollectorTouchState = function () {
        const v = State.variables;
        const liquid = v.player?.bodyliquid || {};
        const semen = ["vagina", "vaginaoutside", "anus", "bottom"]
            .reduce((sum, part) => sum + (Number(liquid[part]?.semen) || 0), 0);
        const maximum = Number(v.arousalmax) || 0;
        return { aroused: maximum > 0 && (Number(v.arousal) || 0) >= maximum * 0.6,
            semen: semen >= 3 };
    };

    /*
     * 收藏家觸碰敘事詞庫：直接在對應陣列末尾追加一筆字串即可擴充。
     * motion：收藏家正在觸碰的動作（依部位）；dialogue：收藏家當下的話語（依部位）。
     * reaction：玩家即時感受（依興奮狀態）；after：觸碰後的心理（依暴露值）。
     * 每組獨立抽取，保留原有 touchMotionVariant / touchReactionVariant 的鎖定索引；
     * 不將收手、付款、結束事件等固定流程放進詞庫。
     * 注意：字串內可使用 <br><br> 分段，但不應加入 Twee 巨集。
     */
    HM.COLLECTOR_TOUCH_TEXT = {
        "after_low": [
                "你仍不習慣他那樣直白的目光，只希望這場令人難為情的交易能快點結束。",
                "你仍有些不知所措，尤其擔心他又會說出什麼令人害羞的評語。",
                "你對自己竟然答應這種交易感到難為情，一時甚至不知道該如何面對他的笑容。"
        ],
        "after_mid": [
                "你仍有些害羞，卻已能坦然接受自己答應了這場交易。",
                "他的評語仍讓你有些不好意思，不過你已不像最初那樣難以面對。",
                "你雖然還有些難為情，卻也漸漸能接受他毫不掩飾的期待。"
        ],
        "after_high": [
                "你對這場交易並不覺得難為情，反而覺得他藏不住的貪心有點好笑。",
                "你並不介意被這樣注視，甚至有餘裕欣賞他努力掩飾喜悅的模樣。",
                "這場古怪的交易似乎比預期還有趣，你甚至對他那副滿足的神情感到好奇。"
        ],
        "dialogue_genitals": [
                "他藏不住滿臉期待，連聲音都壓得很低。<br><br>「沒想到你真的願意……」他小聲說，滿臉喜色。",
                "他似乎也察覺自己有些得意忘形，說話忽然小聲了些。<br><br>「抱歉，我一時太興奮了。」他有些心虛地笑了笑。",
                "他露出心滿意足的笑容，像是終於見識到一直惦記的事。<br><br>「這下可真是開了眼界。」他滿足地笑了。",
                "他沉默了一陣，像是在努力找出一句能說出口的感想。<br><br>「哎呀……這可比我想的還讓人緊張。」他終於開口。",
                "他望著你，滿足的神情裡又多了幾分不捨。<br><br>「真希望下次還有這種好事。」他滿足地笑了。"
        ],
        "dialogue_bottom": [
                "他張了張嘴，似乎一時找不到合適的話。<br><br>「哎呀，真是……」他一時找不到話說，只顧著傻笑。",
                "他一臉心虛地偷笑，連解釋都顯得欲蓋彌彰。<br><br>「這、這可是你答應的啊。」他連忙解釋，語氣卻掩不住高興。",
                "他似乎還想討價還價，卻又不好意思真的開口。<br><br>「好啦，好啦，我沒有忘記約定。」他不好意思地搔搔頭。",
                "他抬眼望向你，露出一副得逞般的神情。<br><br>「我還以為你會拒絕呢。」他露出得逞般的笑容。",
                "他滿臉笑意，像是連自己都沒料到會有這種好事。<br><br>「嘿嘿，這次真沒白來市場。」他高興得藏不住笑。"
        ],
        "dialogue_chest": [
                "他偷瞄了你一眼，嘴角藏不住笑意。<br><br>「嘿……真的可以碰啊。」他壓低聲音，笑得有些不好意思。",
                "他說話時仍不時偷看你的神情，像是怕你突然反悔。<br><br>「抱歉，難得有這種機會……」他說著，眼神卻還捨不得移開。",
                "他像是忽然想起該說點什麼，慌忙抬起頭。<br><br>「啊，對不起，我剛剛有點看入迷了。」他尷尬地笑了笑。",
                "他久久不說話，你不禁抬眼觀察，想知道他究竟在想什麼。<br><br>「今天這筆錢花得真值。」他忍不住小聲嘀咕。",
                "他的目光依然黏在你身上，笑意幾乎藏不住。<br><br>「要不是親眼見到，我還真不敢相信你會答應。」他笑得合不攏嘴。"
        ],
        "reaction_normal": [
                "你稍微繃緊身體，呼吸短暫一頓；明明早已答應，真正被碰到的瞬間仍不免害羞，還得暗暗提醒自己別反應過度。",
                "你的呼吸短暫一頓，隨後才逐漸恢復原本的節奏；你有些意外自己竟會如此在意，連想裝作鎮定都變得不太容易。",
                "你察覺到碰觸帶來的細微感覺，腳下不由得調整了一下重心；一想到對方就在身旁，你便有點不知所措，卻又不想讓這份窘迫表現出來。"
        ],
        "reaction_aroused": [
                "你原本就難以平復的心跳變得更快，呼吸也亂了節奏；明明想裝作若無其事，卻又為自己如此在意這份觸感而有些害羞。",
                "你的心跳始終慢不下來，連極輕微的碰觸都變得格外鮮明；你暗自希望自己別表現得太明顯，偏偏注意力總是不由自主地被拉回當下。",
                "一陣熱意沿著身體蔓延，你比平時更清楚地感受到每一下碰觸；這份意料之外的敏感讓你有些慌張，一時不知道該如何掩飾。"
        ],
        "motion_genitals": [
                "他猶豫了一下才伸手，隨後因為太過緊張，連動作都顯得笨拙。",
                "他起初十分謹慎，隨後卻逐漸放開膽子，動作比剛開始時大膽了許多。",
                "他的手在半空猶豫片刻，真正碰上後，卻又忍不住多試探了幾下。",
                "他盯著看了好一會兒，才終於伸手，緊張得連一句完整的話都說不出來。",
                "他起初只敢短暫碰觸，後來卻漸漸忘了拘謹，動作帶著明顯的留戀。"
        ],
        "motion_bottom": [
                "他先試探著伸手，接著忍不住多停留了一會兒，還不時留意你是否回頭。",
                "他起初十分拘謹，碰過之後卻像捨不得結束似的，動作越發磨蹭。",
                "他伸出手，動作漸漸變得磨蹭，像是每一下都捨不得草草帶過。",
                "他小心地伸手，卻又不時抬眼偷看你，像是怕你突然改變主意。",
                "他先小心翼翼地碰了碰，隨後漸漸放鬆，仍然有些戀戀不捨。"
        ],
        "motion_chest": [
                "他小心地伸出手，碰過之後膽子漸漸大了些，還不時抬眼看你，似乎捨不得就此結束。",
                "他原本只敢輕輕碰一下，隨後又試探著增加了幾分力道。",
                "他起初還很拘謹，指尖卻逐漸放得開了些，注意力全落在手邊。",
                "他緊張地伸出手，碰觸時一聲不吭，卻藏不住嘴角的笑意。",
                "他小心地碰了碰，又忍不住多停留片刻，指尖的動作透著幾分貪心。"
        ]
};

    HM.marketCollectorTouchText = function (group, target, variant) {
        const entries = HM.COLLECTOR_TOUCH_TEXT[group + "_" + target];
        if (!Array.isArray(entries) || entries.length === 0) return "";
        const index = Number(variant);
        return entries[Number.isInteger(index) && index >= 0 ? index % entries.length : 0] || "";
    };

    /*
     * 收藏家觸碰交易：特殊液體 A/B 成對差分詞庫。
     * 只描述正在接觸的當下，不假定前一個隨機區塊的動作或情緒；
     * 不寫收手、退開、付款或離開。可自行在各陣列新增 { a, b }，
     * A/B 永遠以同一組輸出；文字採普通字串，不要放 HTML 或 Twee 巨集。
     * 精液優先於濕潤度；若同時成立，只顯示精液的一組。
     */
    HM.COLLECTOR_TOUCH_LIQUID_PAIRS = {
        wet45: [
            { a: "你察覺到下身有些潮濕，這份細微的感覺讓你不由得分出一些注意力。", b: "你開始在意自己的反應，心裡猜測他是否也能察覺到這個變化。" },
            { a: "一絲濕潤感持續提醒著你，自己的身體正出現意料之外的變化。", b: "你不禁有些困惑，明明只是答應了一場交易，身體卻有著自己的反應。" },
            { a: "你清楚感覺到下身已經有些潮濕，雖然還不算特別明顯，卻無法完全忽略。", b: "你一時間不知道該如何看待這份變化，甚至有些在意他會怎麼理解。" },
            { a: "你感覺私密處似乎有點異樣感，仔細一看對方的手不知為何有些濕潤，是本來就這樣嗎？還是……想到這裡，你耳根不由有些發紅。", b: "對方對此似乎毫不在意，甚至好像有點得意。" }
        ],
        wet60: [
            { a: "你清楚感覺到下身已經濕透，這份持續存在的濕潤感讓你難以忽略自己的狀態。", b: "他似乎也察覺到了你的反應，嘴角浮現一絲得意的笑容。" },
            { a: "你意識到自己的身體比預想中更加潮濕，即使想轉移注意力，也很難完全忽略。", b: "他仔細留意著你的神情，似乎想從你的表情中讀出更多訊息。" },
            { a: "明顯的濕潤感讓你知道，自己的身體已經完全濕透。", b: "你不禁在意他是否已經察覺，卻又無法確定自己更希望他發現，還是裝作不知道。" },
            { a: "隨著對方輕輕觸摸，私密處逐漸濕潤，不曉得是有意還是無意，他手上的動作由輕觸改為揉捏你的敏感處，並不時擦過入口，", b: "他每捏一下你都不由自主夾緊雙腿，濕潤感又更明顯了。" }
        ],
        wet75: [
            { a: "你感覺到液體不斷沿著大腿根部流淌，清楚意識到自己下面早已濕透。", b: "這份持續存在的感覺讓你難以分心，即使不去確認，也無法忽略自己的身體狀態。" },
            { a: "你察覺到液體沿著肌膚緩緩流下，濕潤的程度已經明顯得無法忽視。", b: "你發現他的舉動更加大膽，接觸的方式也開始出現新的試探，讓你不得不留意他的動作。" },
            { a: "你清楚感覺到液體持續沿著大腿根部流淌，這份濕潤已經無法輕易忽略。", b: "他察覺到你的反應，嘴角浮現一絲得意的笑容，似乎想看看你還會有什麼反應。" },
            { a: "一股暖流順著雙腿緩緩流下，你不得不承認：身體誠實的反應對方的動作，", b: "像是展示戰利品一樣，對方忽然把手在你面前揚了揚，晶瑩的水滴隨著他的動作飛濺，原來你已經這麼濕了。" }
        ],
        wet90: [
            { a: "你感覺到液體持續沿著大腿根部流淌，清楚知道自己已經濕得一塌糊塗。", b: "即使試著將注意力放在別處，這份感覺仍讓你無法不去在意自己的身體狀態。" },
            { a: "你察覺到下身的濕潤程度遠遠超過預期，沿著大腿根部流動的液體讓這個事實格外鮮明。", b: "他露出難以掩飾的得意，舉動變得更主動，似乎還想進一步試探你的反應。" },
            { a: "你清楚感覺到自己已經濕得一塌糊塗，持續的濕潤感讓你無法忽略眼下的狀況。", b: "他仔細觀察你的神情，嘴角帶著意味深長的笑意，似乎對眼前的反應相當滿意。" },
            { a: "你感覺有液體正不斷從大腿根部流淌而下，下身已然氾濫成災。", b: "對方一邊感受手上的濕潤柔軟的觸感，一邊露出意味深長的笑容，手上撫摸的動作不僅沒有停下，反而嘗試在你敏感處不斷深入。" },
            { a: "你發現隨著對方輕輕撫摸，皮膚彷彿有電流流過一樣，讓你感到一陣戰慄差點站不穩，隨著對方的時而輕撫時而用手指往縫隙探索，下身濕潤的感覺越來越明顯，忽然一股暖流沿著大腿往下滑地上多了點水漬。", b: "對方顯然不可能沒發現，低頭一看，他正用意味深長的笑容看著你。" },
            { a: "隨著他的撫摸及時不時掃過縫隙敏感地帶，液體開始不受控制的流淌而下，身體不時顫抖，抖動一次地面就出現新的水跡，", b: "對方似乎很滿意你的反應，手上的動作越發大膽，甚至故意在敏感的洞口挑逗，或輕輕捏一下你最敏感的地方，你面紅耳赤，一面希望趕緊結束，身體卻不受控制，雙腿緊緊夾著他的手。" },
        ],
        semen: [
            { a: "你察覺到身上仍有尚未清理乾淨的黏稠殘留物，意識到他可能也會注意到。", b: "他的動作微微一頓，困惑地皺起眉頭，像是在思考自己究竟碰到了什麼。" },
            { a: "那份不同尋常的黏膩感提醒著你，身上仍留有先前的痕跡。", b: "他似乎察覺到異樣，神情有些疑惑，卻沒有立即開口詢問。" },
            { a: "你忽然意識到身上還殘留著先前留下的液體，不禁在意他會如何理解這個情況。", b: "他察覺到異樣，眼神中多了幾分玩味，卻只是意味深長地笑了笑，沒有追問來源。" }
        ]
    };

    HM.marketCollectorTouchLiquidPair = function (encounter) {
        if (!encounter || encounter.touchTarget !== "genitals") return null;
        const v = State.variables;
        const wetness = Number(encounter.touchWetness);
        const level = Number.isFinite(wetness) ? wetness : (Number(v.vaginaWetness) || 0);
        const key = encounter.touchState?.semen ? "semen" :
            level >= 90 ? "wet90" : level >= 75 ? "wet75" :
            level >= 60 ? "wet60" : level >= 45 ? "wet45" : null;
        if (!key) return null;
        const pairs = HM.COLLECTOR_TOUCH_LIQUID_PAIRS[key];
        if (!Array.isArray(pairs) || !pairs.length) return null;
        const index = Number(encounter.touchLiquidVariant);
        return pairs[Number.isInteger(index) && index >= 0 ? index % pairs.length : 0] || null;
    };

    // 收藏家後續收購：只計算原版服裝層中實際穿著的衣物；詛咒衣物無法脫下，故不提供「全部收購」。
    HM.marketCollectorRemaining = function () {
        const worn = State.variables.worn || {};
        const layers = setup.clothingLayer?.all || [];
        return Array.from(layers).filter(slot => setup.clothes?.[slot] && worn[slot] && worn[slot].name !== "naked");
    };

    // 追加收購：在脫衣前鎖定待移除衣著，敘述只根據這份清單產生。
    HM.marketCollectorExtensionClothing = function (slots) {
        const worn = State.variables.worn || {};
        const entries = [];
        const seen = new Set();
        const category = slot => {
            if (["under_upper", "under_lower"].includes(slot)) return "under";
            if (["upper", "lower", "over_upper", "over_lower"].includes(slot)) return "outer";
            return "other";
        };
        for (const slot of slots) {
            const item = worn[slot];
            if (!item || item.name === "naked") continue;
            const partner = slot === "under_lower" ? "under_upper" : slot === "lower" ? "upper" : null;
            const other = partner && worn[partner];
            const linked = !!(partner && slots.includes(partner) && other && other.name !== "naked" &&
                ((Array.isArray(item.outfitSecondary) && item.outfitSecondary[1] === other.name) ||
                 (Array.isArray(other.outfitSecondary) && other.outfitSecondary[1] === item.name)));
            const key = linked ? [slot, partner].sort().join("+") : slot;
            if (seen.has(key)) continue;
            seen.add(key);
            entries.push({ slot, category: category(slot), linked, name: item.cn_name_cap || item.name });
        }
        const outer = entries.some(e => e.category === "outer");
        const under = entries.some(e => e.category === "under");
        const other = entries.some(e => e.category === "other");
        let removalText;
        if (entries.length === 1) {
            const item = entries[0];
            removalText = item.linked ? "你將身上最後一件連身衣物完整脫下，交到他手中。" :
                "你脫下身上最後一件" + (item.category === "under" ? "貼身衣物" : item.category === "outer" ? "外衣" : "穿戴物") + "，交到他手中。";
        } else if (outer && under) {
            removalText = other ? "你先脫下外層服裝，再取下貼身衣物與其他穿戴物，將剩餘衣物全部交到他手中。" :
                "你先脫下外層服裝，再將剩下的貼身衣物逐件取下，把衣物全部交到他手中。";
        } else if (outer) {
            removalText = "你將身上剩餘的外層服裝" + (other ? "及其他穿戴物" : "") + "逐件脫下，全部交到他手中。";
        } else if (under) {
            removalText = "你將身上剩餘的貼身衣物" + (other ? "與其他穿戴物" : "") + "逐件脫下，全部交到他手中。";
        } else {
            removalText = "你將身上剩餘的穿戴物逐件取下，全部交到他手中。";
        }
        return { entries, removalText };
    };

    HM.registerMarketEncounter("underwear_collector", {
        weight: 12,
        // 僅提高傍晚人潮時段的相對權重；不改變市場事件本身的觸發率。
        timeWeights: { peak: 1.35, late: 1.20 },
        // 高暴露玩家較容易引起收藏家注意；其他事件的抽選規則不受影響。
        weightModifier() {
            if (hasSexStat("exhibitionism", 5)) return 1.50;
            if (hasSexStat("exhibitionism", 4)) return 1.25;
            return 1;
        },
        npc: 1,
        output: "HonestMarketsEncounterUnderwearCollector",
        resultOutput: "HonestMarketsEncounterUnderwearCollectorResult",
        eligible() { return true; },
        create(e) {
            const choices = HM.marketUnderwearOptions();
            // NPC 的要求獨立抽選，玩家沒有穿著該部位也可能收到報價。
            e.available = choices.slice();
            e.onePiece = HM.marketCollectorOnePiece();
            e.target = ["upper", "lower", "set"][rand(0, 2)];
            e.offerTarget = e.target;
            e.missingTarget = !choices.includes(e.target) && !e.onePiece.active;
            e.onePieceOffer = e.onePiece.active && !choices.includes(e.target);
            e.onePiecePrice = rand(60, 150) + rand(60, 150);
            e.alternative = e.missingTarget ? (choices.includes("upper") ? "upper" : choices.includes("lower") ? "lower" : null) : null;
            e.alternativeAccepted = false;
            e.alternativePrice = e.alternative ? rand(60, 150) : 0;
            e.alternativeAcceptedRoll = rand(0, 1) === 1;
            // 本次事件固定路人是否注意到交易，避免每次渲染重新抽籤。
            e.passerbyNotice = rand(1, 5) === 1;
            // 買家是隨機出現的路人，並非攤販；此旗標只區分當場交付與移往隱蔽處。
            e.buyerOnsite = rand(0, 1) === 1;
            // 固定敘事變體，確保返回事件頁面時內容不重新抽選。
            e.sceneVariant = rand(0, 2);
            // 展示動作與交付前準備各自抽樣；不影響交易與衣著判定。
            e.displayVariant = rand(0, 2);
            e.removalVariant = rand(0, 2);
            // 空衣物展示結局的 NPC 反應固定在事件建立時。
            e.emptyReaction = rand(0, 3);
            e.inviteVariant = rand(0, 2);
            e.payVariant = rand(0, 2);
            e.exitVariant = rand(0, 2);
            e.clothing = HM.marketCollectorClothing();
            // 無可出售衣物時，仍為高暴露癖欺騙分支提供一次固定報價。
            e.prankPrice = rand(60, 150);
            // 收藏家失去分寸的支線在事件建立時固定。
            e.overstepChance = HM.allureChance(10, 40);
            e.overstep = HM.rollChance(e.overstepChance);
            e.extraPay = 0;
            e.overstepOutcome = null;
            e.deliveryPrepared = false;
            e.extensionPending = false;
            e.extensionPrice = 0;
            e.extensionWitnessVariant = rand(0, 2);
            e.extensionRoll = HM.rollChance(50);
            e.touchRoll = HM.rollChance(40);
            e.touchFollowupRoll = HM.rollChance(60);
            // 第三階段邀約在事件建立時預先骰定；只有完成最後一筆摸摸才會揭露。
            e.intimateInviteRoll = HM.rollChance(50);
            e.intimatePrice = 0;
            e.intimatePaid = false;
            e.touchFirst = rand(0, 1) ? "chest" : (rand(0, 1) ? "bottom" : "genitals");
            e.touchSecond = e.touchFirst === "chest" ? (rand(0, 1) ? "bottom" : "genitals") : "chest";
            e.touchCount = 0;
            e.touchVariant = rand(0, 2);
            e.touchOverstepFree = !e.overstep;
            e.upperPrice = (e.target === "upper" || e.target === "set") ? rand(60, 150) : 0;
            e.lowerPrice = (e.target === "lower" || e.target === "set") ? rand(60, 150) : 0;
            e.price = e.upperPrice + e.lowerPrice;
            const worn = State.variables.worn || {};
            e.upperName = worn.under_upper?.name !== "naked" ? (worn.under_upper?.cn_name_cap || "內衣") : "內衣";
            e.lowerName = worn.under_lower?.name !== "naked" ? (worn.under_lower?.cn_name_cap || "內褲") : "內褲";
        },
        resolve(e, action) {
            if (e.stage === "intimate_offer") {
                if (action === "intimate_view") {
                    e.presentationResult = "intimate_offer";
                    return true;
                }
                if (action === "intimate_decline") {
                    e.result = "intimate_declined"; e.stage = "done"; return true;
                }
                if (action !== "intimate_accept") return false;
                if (!e.intimateInviteRoll || e.touchCount < 1 || e.intimatePaid) return false;
                e.stage = "intimate_combat";
                e.result = null;
                return true;
            }
            if (e.stage === "intimate_combat") {
                if (action !== "intimate_combat_finish") return false;
                // 僅在正常完成約定的遭遇戰時支付；擊倒對方不視為完成交易。
                const v = State.variables;
                const completed = Number(v.enemyhealth) > 0 && Number(v.enemyarousalmax) > 0 && Number(v.enemyarousal) >= Number(v.enemyarousalmax);
                if (completed && !e.intimatePaid) {
                    Wikifier.wikifyEval(`<<money ${Math.round(e.intimatePrice * 100)} "prostitution">>`);
                    e.intimatePaid = true;
                }
                e.result = completed ? "intimate_completed" : "intimate_interrupted";
                e.stage = "done";
                return true;
            }
            if (e.stage === "touch_offer") {
                if (action === "touch_decline") {
                    e.result = "touch_declined"; e.stage = "done"; return true;
                }
                if (action !== "touch_accept") return false;
                // 僅在確認仍符合裸身狀態時成交，避免玩家換裝後沿用舊邀約。
                if (HM.marketCollectorRemaining().length || !e.touchOverstepFree || e.buyerOnsite) {
                    e.result = "touch_unavailable"; e.stage = "done"; return true;
                }
                e.touchState = HM.marketCollectorTouchState();
                e.touchWetness = Number(State.variables.vaginaWetness) || 0;
                e.touchLiquidVariant = rand(0, 2147483646); // 只擲一次；依詞庫長度取餘數，方便日後增補配對。
                // 每筆交易獨立固定動作與反應差分；避免同一結果頁重新渲染時重抽。
                e.touchMotionVariant = rand(0, 2147483646); // 以詞庫長度取餘數；動作與評語沿用同一抽取值。
                e.touchReactionVariant = rand(0, 2147483646); // 以詞庫長度取餘數；即時與後續心理沿用同一抽取值。
                e.touchVariant = e.touchMotionVariant; // 保留既有追蹤欄位。
                e.touchTarget = e.touchCount === 0 ? e.touchFirst : e.touchSecond;
                e.touchCount++;
                const pennies = Math.round(Number(e.extensionPrice || 0) * 200);
                Wikifier.wikifyEval(`<<money ${pennies} "prostitution">>`);
                Wikifier.wikifyEval(`<<arousal ${e.touchTarget === "genitals" ? 150 : e.touchTarget === "chest" ? 80 : 60}>>`);
                e.touchNextPending = e.touchCount === 1 && e.touchFollowupRoll;
                e.presentationResult = "touch_completed";
                e.intimatePrice = Math.round(Number(e.extensionPrice || 0) * 10);
                e.stage = e.touchNextPending ? "touch_followup" : (e.intimateInviteRoll ? "intimate_offer" : "done");
                if (e.stage === "done") e.result = "touch_completed";
                return true;
            }
            if (e.stage === "touch_followup") {
                if (action === "touch_decline") {
                    e.result = "touch_declined"; e.stage = "done"; return true;
                }
                if (action !== "touch_next") return false;
                e.stage = "touch_offer";
                e.presentationResult = "touch_offer";
                return true;
            }
            if (e.stage === "extension_offer") {
                if (action === "extension_decline") {
                    e.extensionPending = false;
                    e.result = "extension_declined";
                    e.stage = "done";
                    return true;
                }
                if (action !== "extension_accept") return false;
                const slots = HM.marketCollectorRemaining();
                if (!slots.length || slots.length !== e.extensionSlots.length ||
                    slots.some((slot, i) => slot !== e.extensionSlots[i] ||
                        (State.variables.worn[slot].cursed === 1 &&
                         !(State.variables.worn[slot].type || []).some(type => type === "broken" || type === "split")))) {
                    e.extensionPending = false;
                    e.result = "extension_unavailable";
                    e.stage = "done";
                    return true;
                }
                const clothingSnapshot = HM.marketCollectorExtensionClothing(slots);
                // 使用原版 generalRuined，限定 worn，不觸及 carried，也不啟動自動回購。
                for (const slot of slots) {
                    Wikifier.wikifyEval(`<<set _noRebuy to true>><<generalRuined "${slot}" true "worn">>`);
                }
                const left = HM.marketCollectorRemaining();
                e.extensionPending = false;
                if (left.length) {
                    e.result = "extension_unavailable";
                    e.stage = "done";
                    return true;
                }
                e.extensionClothing = clothingSnapshot;
                Wikifier.wikifyEval(`<<money ${Math.round(Number(e.extensionPrice || 0) * 100)} "prostitution">>`);
                if (e.buyerOnsite) Wikifier.wikifyEval('<<fameexhibitionism 1>>');
                Wikifier.wikifyEval('<<exhibitionism3>>');
                e.presentationResult = "extension_sold";
                e.touchPending = !e.buyerOnsite && e.touchOverstepFree && e.touchRoll;
                e.stage = e.touchPending ? "touch_offer" : "done";
                if (e.touchPending) e.result = null;
                return true;
            }
            const settle = () => {
                // 交易敘事採用交付當下的衣著狀態，不沿用過時的外衣快照。
                const currentClothing = HM.marketCollectorClothing();
                const sameItem = (e.offerTarget === "upper" && currentClothing.upperName === e.clothing.upperName)
                    || (e.offerTarget === "lower" && currentClothing.lowerName === e.clothing.lowerName)
                    || (e.offerTarget === "set" && currentClothing.upperName === e.clothing.upperName && currentClothing.lowerName === e.clothing.lowerName)
                    || (e.offerTarget === "one_piece" && currentClothing.onePiece && currentClothing.upperName === e.clothing.upperName);
                if (!sameItem) { e.result = "unavailable"; e.stage = "done"; return true; }
                e.clothing = currentClothing;
                // 交付前再次確認衣物仍存在，避免中途換裝導致錯誤結算。
                if (e.offerTarget === "one_piece") {
                    if (!HM.marketCollectorOnePiece().active) { e.result = "unavailable"; e.stage = "done"; return true; }
                    e.stainReaction = HM.marketCollectorStainReaction();
                    Wikifier.wikifyEval('<<underupperruined undefined "sold">>');
                    if (State.variables.worn?.under_lower?.name !== "naked") Wikifier.wikifyEval('<<underlowerruined undefined "sold">>');
                    Wikifier.wikifyEval(`<<money ${(e.price + e.extraPay) * 100} "prostitution">><<fameexhibitionism 1>><<exhibitionism3>>`);
                    e.result = "sold"; e.presentationResult = "sold"; e.stage = "done";
                    const remaining = HM.marketCollectorRemaining();
                    if (e.extensionRoll && remaining.length && remaining.every(slot => {
                        const item = State.variables.worn[slot];
                        return item.cursed !== 1 || (item.type || []).includes("broken") || (item.type || []).includes("split");
                    })) {
                        e.extensionPending = true;
                        e.stage = "extension_offer";
                        e.result = null;
                        e.extensionSlots = remaining.slice();
                        e.extensionPrice = remaining.reduce(total => total + rand(60, 150), 0);
                    }
                    return true;
                }
                if (!HM.marketUnderwearOptions().includes(e.offerTarget)) {
                    e.result = "unavailable";
                    e.stage = "done";
                    return true;
                }
                e.stainReaction = HM.marketCollectorStainReaction();
                if (e.offerTarget === "upper" || e.offerTarget === "set") Wikifier.wikifyEval('<<underupperruined undefined "sold">>');
                if (e.offerTarget === "lower" || e.offerTarget === "set") Wikifier.wikifyEval('<<underlowerruined undefined "sold">>');
                Wikifier.wikifyEval(`<<money ${(e.price + e.extraPay) * 100} "prostitution">><<fameexhibitionism 1>><<exhibitionism3>>`);
                e.result = "sold";
                e.presentationResult = "sold";
                e.stage = "done";
                // 第一筆交易已完全結算，只有仍能脫下所有剩餘衣物時，才可能邀請第二筆交易。
                const remaining = HM.marketCollectorRemaining();
                if (e.extensionRoll && remaining.length && remaining.every(slot => {
                    const item = State.variables.worn[slot];
                    return item.cursed !== 1 || (item.type || []).includes("broken") || (item.type || []).includes("split");
                })) {
                    e.extensionPending = true;
                    e.stage = "extension_offer";
                    e.result = null;
                    e.extensionSlots = remaining.slice();
                    e.extensionPrice = remaining.reduce((total) => total + rand(60, 150), 0);
                }
                return true;
            };
            // 交貨現場只進入一次：無越界直接結算，有越界才開啟玩家選擇頁。
            // 交貨地點與路人插曲在同一場景輸出，避免重複跳頁。
            const startDelivery = () => {
                e.deliveryPrepared = true;
                if (e.overstep) { e.stage = "overstep_choice"; return true; }
                return settle();
            };
            if (e.stage === "initial") {
                // 替代報價屬於收藏家事件，必須在此轉換階段；不能落入其他事件的 resolve。
                if (action === "propose_alternative" && e.missingTarget && e.alternative) {
                    // 重新確認可供替代的衣物仍在身上。
                    if (!HM.marketUnderwearOptions().includes(e.alternative)) {
                        e.result = "unavailable";
                        e.stage = "done";
                        return true;
                    }
                    e.stage = "alternative_offer";
                    return true;
                }
                if (action === "show_empty" || action === "showcase") {
                    if (!hasSexStat("exhibitionism", 4)) return false;
                    Wikifier.wikifyEval("<<exhibitionism4>>");
                    e.clothing = HM.marketCollectorClothing();
                    e.result = ((e.target === "upper" || e.target === "set") && !e.clothing.upperUnder && !e.clothing.onePiece)
                        || ((e.target === "lower" || e.target === "set") && !e.clothing.lowerUnder && !e.clothing.onePiece)
                        ? "showed_empty" : "showcased";
                    return true;
                }
                if (action === "prank") {
                    if (!hasSexStat("exhibitionism", 5)) return false;
                    // 避免事件建立後換裝，導致欺騙敘事與實際衣著不一致。
                    const currentClothing = HM.marketCollectorClothing();
                    if (["upperUnder", "lowerUnder", "upperOuter", "lowerOuter", "upperName", "lowerName", "onePiece"].some(key => currentClothing[key] !== e.clothing[key])) {
                        e.result = "unavailable";
                        e.stage = "done";
                        return true;
                    }
                    // 先收款，僅一次；沒有衣物移除、正常交易與越界事件。
                    Wikifier.wikifyEval(`<<money ${e.price * 100} "prostitution">>`);
                    e.result = "pranked";
                    return true;
                }
                if (action === "decline") {
                    Wikifier.wikifyEval("<<stress 3>>");
                    e.result = !hasSexStat("exhibitionism", 3) ? "shy_leave" : "declined";
                    return true;
                }
                if (action === "request_one_piece" && e.onePieceOffer && HM.marketCollectorOnePiece().active) {
                    e.stage = "one_piece_quote";
                    return true;
                }
                if (action !== "accept" || e.missingTarget || e.onePieceOffer) return false;
                if (!HM.marketUnderwearOptions().includes(e.offerTarget)) {
                    e.result = "unavailable";
                    e.stage = "done";
                    return true;
                }
                return startDelivery();
            }
            if (e.stage === "one_piece_quote") {
                if (action === "cancel") { e.result = "declined"; e.stage = "done"; return true; }
                if (action !== "accept" || !hasSexStat("exhibitionism", 3) || !HM.marketCollectorOnePiece().active) return false;
                e.offerTarget = "one_piece";
                e.price = e.onePiecePrice;
                return startDelivery();
            }
            if (e.stage === "alternative_offer") {
                if (action === "cancel") { e.result = "declined"; e.stage = "done"; return true; }
                if (action !== "negotiate") return false;
                if (!e.alternativeAcceptedRoll) { e.result = "alternative_rejected"; e.stage = "done"; return true; }
                if (HM.marketCollectorOnePiece().active) { e.result = "unavailable"; e.stage = "done"; return true; }
                e.offerTarget = e.alternative;
                e.price = e.alternativePrice;
                e.alternativeAccepted = true;
                e.stage = "alternative_accepted";
                return true;
            }
            if (e.stage === "alternative_accepted") {
                if (action === "cancel") { e.result = "declined"; e.stage = "done"; return true; }
                if (action !== "accept") return false;
                if (!HM.marketUnderwearOptions().includes(e.offerTarget)) { e.result = "unavailable"; e.stage = "done"; return true; }
                return startDelivery();
            }
            if (e.stage === "overstep_choice") {
                if (action === "cancel") {
                    e.result = "overstep_cancel";
                    e.stage = "done";
                    return true;
                }
                if (action === "dodge") {
                    // 原版舞蹈技能為 $danceskill（0～1000），以其值決定一次性閃避結果。
                    const dance = Math.max(0, Math.min(1000, Number(State.variables.danceskill) || 0));
                    e.overstepOutcome = rand(1, 1000) <= Math.min(900, 250 + Math.floor(dance * 0.65))
                        ? "dodge_success" : "dodge_fail";
                    e.stage = "overstep_result";
                    if (e.overstepOutcome === "dodge_fail") Wikifier.wikifyEval("<<stress 2>>");
                    return true;
                }
                if (action === "stop") {
                    e.overstepOutcome = "stopped";
                    e.stage = "overstep_result";
                    return true;
                }
                if (action === "extra" && hasSexStat("exhibitionism", 5)) {
                    e.extraPay = Math.max(10, Math.round(e.price * rand(25, 50) / 100));
                    e.overstepOutcome = "extra";
                    e.stage = "overstep_result";
                    return true;
                }
                return false;
            }
            if (e.stage === "overstep_result") {
                if (action === "finish") return settle();
                if (action === "cancel") {
                    e.result = "overstep_cancel";
                    e.stage = "done";
                    return true;
                }
            }
            return false;
        }
    });

    HM.registerMarketEncounter("found_money", {
        weight: 24,
        timeWeights: { preparing: 0.8, morning: 1.0, daytime: 1.0, peak: 1.1, late: 1.1, closing: 0.8 },
        output: "HonestMarketsEncounterFoundMoney",
        resultOutput: "HonestMarketsEncounterFoundMoneyResult",
        create(encounter) {
            // 共用骰值只擲一次：普通 93%、大額 5%、特大額 2%。
            // forceRng=true 時固定擲出 100，方便測試最稀有的分支。
            const roll = HM.rollRng();
            encounter.moneyTier = roll >= 99 ? "jackpot" : roll >= 94 ? "large" : "coins";
            encounter.money = encounter.moneyTier === "jackpot"
                ? rand(100000, 300000) // £1,000～£3,000（便士）
                : encounter.moneyTier === "large"
                    ? rand(5000, 20000) // £50～£200（便士）
                    : rand(10, 200);    // 原有零錢範圍
        },
        resolve(e, action) {
            if (action !== "take") return false;
            // 依拾金級距調整減壓；使用已計算的變數，避免 Twee 巨集解析算式出錯。
            const stressReduction = e.moneyTier === "jackpot" ? -6 : e.moneyTier === "large" ? -3 : -1;
            Wikifier.wikifyEval(`<<money ${e.money}>><<stress ${stressReduction}>>`);
            e.result = "done";
            return true;
        }
    });

    HM.registerMarketEncounter("pickpocket", {
        weight: 20,
        timeWeights: { preparing: 0.4, morning: 0.7, daytime: 1.0, peak: 1.5, late: 1.3, closing: 0.7 },
        npc: true,
        output: "HonestMarketsEncounterPickpocket",
        resultOutput: "HonestMarketsEncounterPickpocketResult",
        create(encounter) {
            const V = State.variables;
            // 竊取金額以事件建立當下的現金鎖定：一般至少 £500（50000 便士），
            // 上限以持有現金的 5% 計；不足 £500 時改採現金的 5%，不強制扣 £500。
            const cash = Math.max(0, Math.floor(Number(V.money) || 0));
            encounter.money = cash < 50000
                ? Math.floor(cash * 0.05)
                : Math.min(cash, Math.max(50000, Math.floor(cash * 0.05)));
            // 扒手在玩家察覺之前就已得手：事件建立時立即扣款，後續處置只負責返還。
            // 僅此處扣款，避免追捕失敗／未察覺時重複扣除。
            if (encounter.money > 0) Wikifier.wikifyEval(`<<money -${encounter.money}>>`);
            encounter.moneyTaken = true;
            // 察覺與否在事件建立時只判定一次，玩家不自行選擇判定結果。
            encounter.stage = rand(1, 2) === 1 ? "noticed" : "missed";
        },
        resolve(e, action) {
            // 扒手處置選項只在追捕成功後開放。
            if (action === "chase_begin" && e.stage === "noticed") {
                HM.chase.create(e, {
                    playerRole: "pursuer", pursuerName: "扒手", title: "追捕扒手",
                    stage: "pickpocket_chase", onCatch: "chase_caught", onEscape: "chase_escaped",
                    actions: [{
                        id: "tackle", name: "飛撲抓捕", apCost: 25, playerRole: "pursuer", maxGap: 4,
                        followUpAfterMove: true, followUpCost: 15,
                        message: "你奮力向扒手飛撲過去！",
                        effects: [{type:"chance", outcomes:[
                            {weight:65, message:"你抓住了扒手，兩人一同跌倒在地！", effects:[{type:"catch"}]},
                            {weight:35, message:"你撲了個空，扒手趁機繼續逃跑。", effects:[{type:"ap",target:"player",value:-10}]}
                        ]}]
                    }]
                });
                e.stage = "pickpocket_chase";
                return true;
            }
            if (action === "chase_caught" && e.stage === "pickpocket_chase") {
                e.stage = "caught";
                return true;
            }
            if (action === "chase_escaped" && e.stage === "pickpocket_chase") {
                // 失竊金額已在 create() 扣除，此處只結算情緒效果。
                Wikifier.wikifyEval(e.money > 0 ? "<<stress 3>>" : "<<stress 2>>");
                e.result = "done";
                return true;
            }
            if (action === "lost" && e.stage === "missed") {
                // 失竊金額已在 create() 扣除，此處只結算情緒效果。
                Wikifier.wikifyEval(e.money > 0 ? "<<stress 3>>" : "<<stress 2>>");
                e.result = "done";
            } else if (action === "recover" && e.stage === "caught") {
                // 已抓到扒手，取回事件開始時被偷走的全部現金。
                if (e.money > 0) Wikifier.wikifyEval(`<<money ${e.money}>>`);
                Wikifier.wikifyEval("<<stress -2>>");
                e.result = "done";
            } else if (action === "release" && e.stage === "caught") {
                // 放走扒手前仍先拿回自己的錢包。
                if (e.money > 0) Wikifier.wikifyEval(`<<money ${e.money}>>`);
                Wikifier.wikifyEval("<<stress -1>>");
                e.result = "done";
            } else if (action === "extort" && e.stage === "caught") {
                // 勒索額外補償：依事件鎖定的失竊金額計算 10%，最低 £100（10000 內部單位）；與返還原款分開計算。
                const gain = Math.max(10000, Math.floor(Math.max(0, Number(e.money) || 0) * 0.10));
                e.extortGain = gain;
                // 返還被偷的原款，額外補償另外入帳；犯罪與壓力效果沿用原設定。
                Wikifier.wikifyEval(`<<money ${Math.max(0, Number(e.money) || 0) + gain}>><<crimeUp ${Math.max(1, Math.round(gain / 100))} "thievery">><<stress -2>>`);
                e.result = "done";
            } else {
                return false;
            }
            return true;
        }
    });

    // 市場街道埋伏：僅檢查原版實際暴露與外部體液，不以興奮或容許度取代外觀。
    HM.registerMarketEncounter("market_ambush", {
        weight: 13,
        timeWeights: {preparing:0.45, morning:0.55, daytime:0.75, peak:1, late:2, closing:2.5},
        npc: 3,
        output: "HonestMarketsEncounterMarketAmbush",
        resultOutput: "HonestMarketsEncounterMarketAmbushResult",
        eligible() {
            const V=State.variables;
            // 暴露值由原版更新；只在已有原版統計時使用，不於抽選階段重算 exposure()。
            // 外部體液用原版 bodyliquid 計數函式現算，避免沿用過期的液體總數。
            let fluids=0;
            try {
                if (typeof liquidcount === "function" && Array.isArray(setup.bodyliquid?.outerbodyparts)) {
                    const parts=setup.bodyliquid.outerbodyparts;
                    fluids=liquidcount("goo",parts)+liquidcount("semen",parts)+liquidcount("nectar",parts);
                } else fluids=Number(V.liquidoutsidecount)||0;
            } catch (_) { fluids=Number(V.liquidoutsidecount)||0; }
            return Number(V.exposedRaw)>0 || fluids>0;
        },
        create(e) {
            const V=State.variables;
            const strength=Math.max(0,Math.min(1,(Number(V.physique)||0)/(Math.max(1,Number(V.physiquemax)||20000))));
            const dance=Math.max(0,Math.min(1,(Number(V.danceskill)||0)/1000));
            e.counterChance=Math.max(10,Math.min(85,15+50*strength+25*dance));
            e.stage="initial";
        },
        resolve(e,action) {
            if(e.stage==="initial" && action==="counter") {
                e.counterSuccess=HM.rollChance(e.counterChance);
                e.stage=e.counterSuccess?"counter_success":"cornered";
                if(!e.counterSuccess) e.cornerReason="counter";
                return true;
            }
            if(e.stage==="initial" && action==="run") {
                HM.chase.create(e,{
                    playerRole:"runner", pursuerName:"三名追逐者",title:"市場街道追逐",stage:"street_chase",
                    onEscape:"chase_escaped",onCaught:"chase_caught",
                    sceneTexts:{opening:"你衝向市場外圍的街道，三人緊追在後。",headStart:"你搶先衝上街道，身後傳來三人追趕的腳步聲！",run:"你沿著市場街道奮力奔跑。",escape:"你甩開三名追逐者，消失在街道另一端！",corner:"街道轉角"},
                    environment:{hiding:false,objectCount:{min:3,max:5},hazards:["slippery","debris","stray_cat","door"],obstacles:[
                        "trash_bin","boxes","cart",
                        {id:"fruit_crates",name:"水果木箱",cost:13,reach:6,slow:7,description:"疊放在攤邊的水果木箱",texts:{playerTrigger:"你猛地推翻水果木箱，水果滾得滿地都是！",npcAffected:"{npc}被滿地亂滾的水果絆住了腳步。"}},
                        {id:"stall_rack",name:"路邊攤架",cost:20,reach:5,slow:10,description:"靠在街邊的輕便攤架",texts:{playerTrigger:"你推倒路邊攤架，貨物嘩啦啦散落一地！",npcAffected:"{npc}不得不繞開倒下的攤架。"}}
                    ]},
                    actions:[{id:"shout_help",name:"大聲呼救",apCost:15,playerRole:"runner",message:"你朝街上的行人大喊救命！",effects:[{type:"chance",outcomes:[
                        {weight:60,message:"附近攤販大聲喝止，三名追逐者遲疑了一瞬。",effects:[{type:"stun",target:"npc",turns:1}]},
                        {weight:40,message:"路人紛紛回頭觀望，卻沒有人及時阻止追逐者。",effects:[]}
                    ]}]}]
                });
                e.stage="street_chase";
                return true;
            }
            if(e.stage==="street_chase" && action==="chase_escaped") {e.stage="escaped";return true;}
            if(e.stage==="street_chase" && action==="chase_caught") {e.stage="cornered";e.cornerReason="chase";return true;}
            if(e.stage==="counter_success" && action==="finish") {e.stage="done";e.result="escaped";return true;}
            if(e.stage==="escaped" && action==="finish") {e.stage="done";e.result="escaped";return true;}
            if(e.stage==="cornered" && action==="combat") {e.stage="combat";return true;}
            if(e.stage==="combat" && action==="combat_finish") {e.stage="done";e.result="combat";return true;}
            return false;
        }
    });

    HM.registerMarketEncounter("crowd_grope", {
        weight: 20,
        timeWeights: { preparing: 0.2, morning: 0.5, daytime: 1.0, peak: 1.6, late: 1.2, closing: 0.5 },
        npc: true,
        output: "HonestMarketsEncounterCrowdGrope",
        resultOutput: "HonestMarketsEncounterCrowdGropeResult",
        resolve(e, action) {
            if (action === "endure") {
                Wikifier.wikifyEval("<<stress 2>><<arousal 100>>");
                const r = HM.rollRng();
                if (r > 45) e.result = "withdraw";
                else if (r > 15) e.stage = "further";
                else e.result = "escalate";
            } else if (action === "endure_more") {
                Wikifier.wikifyEval("<<stress 3>><<arousal 200>><<trauma 1>>");
                e.result = HM.rollChance(45) ? "withdraw" : "escalate";
            } else if (action === "push") {
                Wikifier.wikifyEval("<<stress -1>>");
                e.result = HM.rollChance(85) ? "withdraw" : "escalate";
            } else if (action === "slap") {
                Wikifier.wikifyEval("<<stress -2>><<pain 1>>");
                const r = HM.rollRng();
                e.result = r > 30 ? "withdraw" : (r > 10 ? "angry" : "escalate");
            } else {
                return false;
            }
            return true;
        }
    });

    /* 特殊服裝事件：候選池僅使用正常服裝商店的上裝與獨立下裝。 */
    HM.clothierCandidates = function () {
        const clothes = setup.clothes;
        if (!clothes) return [];
        const V = State.variables;
        const results = [];
        for (const slot of ["upper", "lower"]) {
            for (const item of clothes[slot] || []) {
                if (!item || !Array.isArray(item.shop) || !item.shop.includes("clothing")) continue;
                if (!Number.isInteger(item.index) || item.index <= 0) continue;
                if (item.outfitSecondary != null) continue;
                if (slot === "lower" && (item.outfitPrimary != null || item.one_piece)) continue;
                if (V.worn?.[slot]?.cursed) continue;
                const parts = item.outfitPrimary && typeof item.outfitPrimary === "object" ? item.outfitPrimary : {};
                if (Object.keys(parts).some(s => V.worn?.[s]?.cursed || !(clothes[s] || []).some(x => x.name === parts[s]))) continue;
                const traits = Array.isArray(item.type) ? item.type : [];
                if (!(Number(item.reveal) >= 700 || traits.some(t => ["fetish", "binding", "gag", "constricting", "shackle"].includes(t)))) continue;
                results.push(item);
            }
        }
        return results;
    };

    HM.registerMarketEncounter("suspicious_clothier", {
        weight: 12,
        npc: true,
        timeWeights: { preparing: 0.3, morning: 0.7, daytime: 1, peak: 1.2, late: 1.4, closing: 0.5 },
        output: "HonestMarketsEncounterClothierOffer",
        resultOutput: "HonestMarketsEncounterClothierResult",
        eligible() {
            return HM.normalizeEncounterPassage(HM._encounterTargetPassage) === "HonestMarkets Clothing" && HM.clothierCandidates().length > 0;
        },
        create(e) {
            const pool = HM.clothierCandidates();
            if (!pool.length) throw new Error("沒有可用的試穿服裝");
            const item = pool[rand(0, pool.length - 1)];
            e.slot = item.slot;
            e.index = item.index;
            e.itemName = item.name;
            const colours = Array.isArray(item.colour_options) ? item.colour_options.filter(x => x && x !== "custom") : [];
            e.colour = colours.length ? colours[rand(0, colours.length - 1)] : "";
        },
        resolve(e, action) {
            if (action === "refuse" && e.stage === "initial") { e.result = "refused"; return true; }
            if (action === "try" && e.stage === "initial") { e.stage = "trial"; return true; }
            if (action === "trial_ready" && e.stage === "trial") {
                if (!HM.clothierRecordTrial()) return false;
                e.stage = "inspection";
                return true;
            }
            if ((action === "ask_price" || action === "change_back") && e.stage === "inspection") {
                e.trialReaction = action;
                e.stage = "confrontation";
                return true;
            }
            if (action === "trial_failed" && e.stage === "trial") { e.result = "trial_failed"; return true; }
            if (action === "resist" && e.stage === "confrontation") { e.stage = "combat"; return true; }
            if (action === "combat_finish" && e.stage === "combat") {
                const V = State.variables;
                if (V.enemyhealth <= 0) e.result = "escaped";
                else if (V.enemyarousal >= V.enemyarousalmax) {
                    HM.clothierConfiscate();
                    e.result = "confiscated";
                } else e.result = "escaped";
                return true;
            }
            return false;
        }
    });

    // 穿衣後記錄試穿服裝的各個插槽；僅保存用於識別的值，不修改其他衣物儲存。
    HM.clothierRecordTrial = function () {
        const e = HM.getMarketEncounter();
        if (!e || e.id !== "suspicious_clothier" || e.stage !== "trial") return false;
        const source = setup.clothes?.[e.slot]?.[e.index];
        const worn = State.variables.worn;
        if (!source || !worn || worn[e.slot]?.name !== source.name) return false;
        const parts = source.outfitPrimary && typeof source.outfitPrimary === "object" ? source.outfitPrimary : {};
        const slots = [e.slot, ...Object.keys(parts)];
        e.trialPieces = slots.filter(slot => worn[slot] && worn[slot].name !== "naked")
            .map(slot => ({ slot, name: worn[slot].name, index: worn[slot].index, colour: worn[slot].colour }));
        return e.trialPieces.length > 0;
    };

    // 小販沒收試穿衣物：不呼叫衣櫃存放，且不觸碰獨立的疊穿資料。
    HM.clothierConfiscate = function () {
        const e = HM.getMarketEncounter();
        if (!e || e.id !== "suspicious_clothier" || e.confiscated) return 0;
        const worn = State.variables.worn;
        let removed = 0;
        for (const piece of e.trialPieces || []) {
            const current = worn?.[piece.slot];
            const empty = setup.clothes?.[piece.slot]?.[0];
            if (!current || !empty || current.name !== piece.name || current.index !== piece.index || current.colour !== piece.colour) continue;
            worn[piece.slot] = clone(empty);
            removed++;
        }
        e.confiscated = true;
        return removed;
    };

    /*
     * 模特兒換裝使用兩組事件專用衣櫃：original 保存原衣，display 保存展示服。
     * 衣櫃資料留在事件狀態中；僅在執行原版 wardrobewear 時暫時掛載到 ground。
     * 穿脫、套裝主從件連動由原版 Widget 負責，不直接改寫衣物部件。
     */
    HM.modelWardrobeSlots = ["face", "feet", "hands", "handheld", "handheld_left", "head", "legs", "lower", "neck", "over_head", "over_lower", "over_upper", "genitals", "under_lower", "under_upper", "upper"];
    HM.modelNewWardrobe = function (name) {
        const wardrobe = { unlocked: false, shopSend: false, transfer: false, isolated: true, locationRequirement: [], space: 10000, outside: false, name };
        for (const slot of HM.modelWardrobeSlots) wardrobe[slot] = [];
        return wardrobe;
    };
    HM.modelCandidates = function () {
        const worn = State.variables.worn;
        if (!worn?.upper || !worn?.lower || worn.upper.cursed || worn.lower.cursed) return [];
        // 先限於只有 upper + lower 的原生套裝，避免附帶配件被事件換掉。
        if (Object.keys(worn.upper.outfitPrimary || {}).some(slot => slot !== "lower")) return [];
        if (worn.lower.outfitPrimary && Object.keys(worn.lower.outfitPrimary).length) return [];
        return (HM.getClothingCatalog?.() || []).filter(item => {
            const parts = item.outfitPrimary;
            return item.slot === "upper" && parts && Object.keys(parts).length === 1 &&
                typeof parts.lower === "string" && parts.lower !== "split" && parts.lower !== "broken" &&
                (setup.clothes?.lower || []).some(part => part.name === parts.lower);
        });
    };
    // 保存角色穿著與事件衣櫃的快照，供換裝過程拋出例外時整體回滾。
    HM.modelClothingSnapshot = function (e) {
        const V = State.variables;
        return { worn: clone(V.worn), wardrobes: clone(e.modelWardrobes) };
    };
    HM.modelClothingRollback = function (e, snapshot) {
        const V = State.variables;
        V.worn = clone(snapshot.worn);
        e.modelWardrobes = clone(snapshot.wardrobes);
        HM.modelRefresh();
    };
    // 透過原版衣櫃巨集逐一操作 slot，避免直接改寫穿著資料。
    // 暫存 ground 與操作參數，僅設定指定欄位；finally 必須恢復玩家原有的衣櫃上下文。
    HM.modelWardrobeAction = function (e, wardrobeKey, slot, clothes) {
        const V = State.variables;
        const container = e.modelWardrobes?.[wardrobeKey];
        if (!container || !V.wardrobes) throw Error("事件虛擬衣櫃不存在");
        // 保留 ground 欄位原先是否存在，避免操作結束後留下額外衣櫃欄位。
        const hadGround = Object.prototype.hasOwnProperty.call(V.wardrobes, "ground");
        const oldGround = V.wardrobes.ground;
        const oldLocation = V.wardrobe_location;
        const oldOption = V.wardrobeOption;
        const oldWear = V["wear_" + slot];
        try {
            V.wardrobes.ground = container;
            V.wardrobe_location = "ground";
            V.wardrobeOption = "wear";
            V["wear_" + slot] = clothes;
            Wikifier.wikifyEval("<<wardrobewear>>");
            e.modelWardrobes[wardrobeKey] = V.wardrobes.ground;
        } finally {
            V.wardrobe_location = oldLocation;
            V.wardrobeOption = oldOption;
            if (oldWear === undefined) delete V["wear_" + slot];
            else V["wear_" + slot] = oldWear;
            if (hadGround) V.wardrobes.ground = oldGround;
            else delete V.wardrobes.ground;
        }
    };
    // 每次脫衣後重新讀取穿著狀態，避免重複脫下原版已連動處理的部件。
    HM.modelStripToWardrobe = function (e, wardrobeKey) {
        const V = State.variables;
        for (const slot of ["upper", "lower"]) {
            if (V.worn?.[slot] && V.worn[slot].name !== "naked") {
                HM.modelWardrobeAction(e, wardrobeKey, slot, "strip");
            }
        }
    };
    // 每次穿衣後重新讀取衣櫃；套裝主件可能同時取出其他欄位的部件。
    HM.modelWearFromWardrobe = function (e, wardrobeKey) {
        for (const slot of ["upper", "lower"]) {
            const wardrobe = e.modelWardrobes[wardrobeKey];
            if (wardrobe?.[slot]?.length) {
                HM.modelWardrobeAction(e, wardrobeKey, slot, 0);
            }
        }
    };
    // 建立展示服裝並完成換裝；生成展示套裝使用原版 generalSend，穿脫使用 wardrobewear。
    // 任一步驟拋出例外時回滾穿著與事件衣櫃，不將暫存資料混入玩家地面衣櫃。
    HM.modelPrepare = function (e) {
        if (e.modelWardrobes) return false;
        const V = State.variables;
        if (!V.wardrobes || !V.worn?.upper || !V.worn?.lower) return false;
        e.modelWardrobes = { original: HM.modelNewWardrobe("原本服裝暫存"), display: HM.modelNewWardrobe("展示服裝暫存") };
        const snapshot = HM.modelClothingSnapshot(e);
        const previous = Object.prototype.hasOwnProperty.call(V.wardrobes, "hm_model");
        const old = V.wardrobes.hm_model;
        try {
            try {
                V.wardrobes.hm_model = e.modelWardrobes.display;
                // generalSend 的顏色參數可省略；只傳入有效字串，否則交由原版選色。
                const colour = typeof e.modelColour === "string" && e.modelColour && e.modelColour !== "custom"
                    ? e.modelColour : null;
                const colourArg = colour ? ` ${JSON.stringify(colour)}` : "";
                Wikifier.wikifyEval(`<<generalSend "hm_model" "upper" ${e.modelIndex}${colourArg}>>`);
                e.modelWardrobes.display = V.wardrobes.hm_model;
            } finally {
                if (previous) V.wardrobes.hm_model = old;
                else delete V.wardrobes.hm_model;
            }
            if (!e.modelWardrobes.display.upper.length || !e.modelWardrobes.display.lower.length) throw Error("展示套裝建立失敗");
            HM.modelStripToWardrobe(e, "original");
            HM.modelWearFromWardrobe(e, "display");
            return true;
        } catch (error) {
            HM.modelClothingRollback(e, snapshot);
            e.modelRestored = true;
            console.error("[HonestMarkets] 模特兒換裝已回滾", error);
            return false;
        }
    };
    // 結束工作時將展示服裝收回 display，再從 original 穿回原衣。
    // 還原失敗時回滾到操作前穿著狀態；由事件結算流程直接走異常結尾，避免卡死。
    HM.modelRestore = function (e) {
        if (!e.modelWardrobes || e.modelRestored) return !!e.modelRestored;
        const snapshot = HM.modelClothingSnapshot(e);
        const V = State.variables;
        try {
            HM.modelStripToWardrobe(e, "display");
            HM.modelWearFromWardrobe(e, "original");
            e.modelRestored = true;
            HM.modelRefresh();
            return true;
        } catch (error) {
            HM.modelClothingRollback(e, snapshot);
            console.error("[HonestMarkets] 模特兒還原失敗，已回滾至還原前狀態", error);
            return false;
        }
    };
    // 換裝後刷新依賴穿著狀態的角色顯示與能力資料。
    HM.modelRefresh = function () {
        Wikifier.wikifyEval("<<updatesidebarimg>><<updatesidebardescription>><<updateallure>><<updatewarmthscale>><<exposure>><<run updateMoment()>>");
    };
    // 展示評分只讀取原版能力，不呼叫舞蹈系統的戰鬥／脫衣副作用。
    HM.modelPerformance = function () {
        const V = State.variables;
        const clamp = (n, max) => Math.max(0, Math.min(1, (Number(n) || 0) / max));
        let dance = 0;
        try { if (typeof currentSkillValue === "function") dance = currentSkillValue("danceskill"); }
        catch (error) { console.warn("[HonestMarkets] 無法讀取舞蹈技能", error); }
        const exhibition = clamp(V.exhibitionism, 100);
        const dancing = clamp(dance, 1000);
        // beauty 是原版容貌值；以存檔內 beautymax 為滿分基準（原版預設 10000）。
        // allure 反映穿著等因素造成的當前吸引力，僅提供少量額外獎勵。
        const beauty = clamp(V.beauty, Math.max(1, Number(V.beautymax) || 10000));
        const allure = clamp(V.allure, 16000);
        // 每十分鐘保底 £50；四項能力加權後以 1.5 次方成長，頂尖表現 £300。
        // 誘惑度只佔 10%，避免高誘惑服裝蓋過實際展示能力。
        const score = 0.3 * exhibition + 0.3 * dancing + 0.3 * beauty + 0.1 * allure;
        const rate = Math.round(50 + 250 * Math.pow(score, 1.5));
        return { exhibition, dancing, beauty, allure, appearance: beauty, score, rate };
    };
    // 每輪只抽一次；依能力分層選句，同一份工作優先避免重複敘述。
    // 已使用句子的索引保存在事件狀態中，僅供同次工作避免重複。
    HM.modelPickNarrative = function (e, key, options) {
        if (!e.modelNarrativeUsed || typeof e.modelNarrativeUsed !== "object") e.modelNarrativeUsed = {};
        const used = Array.isArray(e.modelNarrativeUsed[key]) ? e.modelNarrativeUsed[key] : [];
        let available = options.map((_, i) => i).filter(i => !used.includes(i));
        if (!available.length) { used.length = 0; available = options.map((_, i) => i); }
        const index = available[rand(0, available.length - 1)];
        used.push(index);
        e.modelNarrativeUsed[key] = used;
        return options[index];
    };
    // 僅計算展示結果與選定文案索引；實際文字由 Twee 渲染。
    HM.modelReaction = function (e, performance) {
        const attention = Math.max(0, Math.min(1, performance.score + (rand(0, 30) - 15) / 100));
        const crowd = attention < 0.25 ? 0 : attention < 0.5 ? 1 : attention < 0.75 ? 2 : 3;
        const exhibition = performance.exhibition < 0.3 ? 0 : performance.exhibition < 0.65 ? 1 : 2;
        const dancing = performance.dancing < 0.3 ? 0 : performance.dancing < 0.65 ? 1 : 2;
        const pick = (key) => HM.modelPickNarrative(e, key, [0, 1, 2, 3, 4]);
        const narrative = {
            crowd, exhibition, dancing,
            crowdIndex: pick("crowd_" + crowd),
            exhibitionIndex: pick("exhibition_" + exhibition),
            dancingIndex: pick("dancing_" + dancing)
        };
        const tipPools = [[0, 0, 0, 0.05], [0, 0.05, 0.10], [0, 0.10, 0.15, 0.20], [0.10, 0.20, 0.25, 0.40]];
        const tipRate = tipPools[crowd][rand(0, tipPools[crowd].length - 1)];
        narrative.tipped = tipRate > 0;
        return { narrative, bonus: Math.round(performance.rate * tipRate) };
    };
    HM.registerMarketEncounter("temporary_model", {
        weight: 10,
        timeWeights: { preparing: 0.3, morning: 0.7, daytime: 1, peak: 1.3, late: 0.8, closing: 0.2 },
        npc: false,
        output: "HonestMarketsEncounterModel",
        resultOutput: "HonestMarketsEncounterModelResult",
        eligible() { return HM.isPassage("HonestMarkets Clothing") && HM.modelCandidates().length > 0; },
        create(e) {
            const pool = HM.modelCandidates();
            const item = pool[rand(0, pool.length - 1)];
            e.modelIndex = item.index;
            e.modelName = item.name;
            e.modelLabel = HM.clothingDisplayName(item);
            const colours = (item.colour_options || []).filter(colour => colour && colour !== "custom");
            e.modelColour = colours.length ? colours[rand(0, colours.length - 1)] : null;
            e.modelMinutes = 0;
            e.modelReward = 0;
            e.modelTips = 0;
            e.modelLastBase = 0;
            e.modelLastTip = 0;
            e.modelLastEarned = 0;
            e.modelLastNarrative = null;
            e.modelPerformance = null;
            e.modelScoreTotal = 0;
            e.modelRounds = 0;
            e.modelNarrativeUsed = {};
            e.modelClosingTier = 0;
            e.modelClosingIndex = 0;
            e.modelPhotoAction = "";
            e.modelIncidentAction = "";
            e.modelPhotoOffer = 0;
            e.modelPhotoHandled = false;
            e.modelPhotoIncident = false;
            e.modelPhotoIncidentWilling = false;
            e.modelPhotoExtra = 0;
            e.modelPhotoVariant = 0;
            e.modelPhotoInviteVariant = 0;
            e.modelIncidentVariant = 0;
            e.modelExtraVariant = 0;
        },
        resolve(e, action) {
            if (action === "decline" && e.stage === "initial") { e.result = "declined"; return true; }
            if (action === "accept" && e.stage === "initial") {
                try {
                    if (!HM.modelPrepare(e)) { e.result = "wardrobe_failed"; return true; }
                    HM.modelRefresh();
                    e.modelPerformance = HM.modelPerformance();
                    e.stage = "showing";
                    return true;
                } catch (error) {
                    console.error("[HonestMarkets] 模特兒換裝失敗，保留暫存衣物供恢復", error);
                    e.result = "wardrobe_failed";
                    return true;
                }
            }
            if (action === "continue" && e.stage === "showing" && e.modelMinutes < 30) {
                HM.advanceMinutes(10);
                e.modelMinutes += 10;
                // 每段時間按當前能力重新評分，結果只在點擊「繼續」時產生一次。
                const performance = HM.modelPerformance();
                const reaction = HM.modelReaction(e, performance);
                e.modelPerformance = performance;
                e.modelScoreTotal = (Number(e.modelScoreTotal) || 0) + performance.score;
                e.modelRounds = (Number(e.modelRounds) || 0) + 1;
                e.modelLastNarrative = reaction.narrative;
                e.modelLastBase = performance.rate;
                e.modelLastTip = reaction.bonus;
                e.modelLastEarned = e.modelLastBase + e.modelLastTip;
                e.modelTips = (Number(e.modelTips) || 0) + e.modelLastTip;
                e.modelReward += e.modelLastEarned;
                e.modelPhotoAction = "";
                e.modelIncidentAction = "";
                e.modelPhotoHandled = false;
                e.modelPhotoIncident = false;
                e.modelPhotoIncidentWilling = false;
                e.modelPhotoExtra = 0;
                e.modelPhotoVariant = rand(0, 3);
                e.modelPhotoInviteVariant = rand(0, 5);
                e.modelIncidentVariant = rand(0, 3);
                e.modelExtraVariant = rand(0, 3);
                // 每輪展示結算後只判定一次拍照邀請：20%～70%，隨展示評分線性提高。
                // 抽中後保存報價及文字差分；重繪頁面不得重新擲骰。
                const photoChance = Math.min(70, Math.max(20, Math.round(20 + performance.score * 50)));
                if (HM.rollChance(photoChance)) {
                    e.modelPhotoOffer = Math.max(5, Math.round(performance.rate * (0.05 + rand(0, 10) / 100)));
                    e.stage = "photo";
                } else {
                    e.modelPhotoOffer = 0;
                }
                return true;
            }
            // 拍照流程：接受／拒絕 → 拍攝中判定越界 → 玩家回應 → 回到展示。
            // 不可在越界判定前宣告攝影者離開；拒絕則直接回到展示。
            if (e.stage === "photo" && ["photo_free", "photo_tip", "photo_refuse"].includes(action)) {
                if (e.modelPhotoHandled) return false;
                e.modelPhotoHandled = true;
                if (action === "photo_refuse") {
                    e.modelPhotoAction = "refuse";
                } else if (action === "photo_free") {
                    e.modelPhotoAction = "free";
                } else {
                    // 拍照費與既有小費同樣以英鎊記錄，最後統一乘 100 發放。
                    const offered = Number(e.modelPhotoOffer) || 0;
                    e.modelTips += offered;
                    e.modelReward += offered;
                    e.modelLastTip = (Number(e.modelLastTip) || 0) + offered;
                    e.modelLastEarned = (Number(e.modelLastEarned) || 0) + offered;
                    e.modelPhotoAction = "tip";
                }
                // 只有接受拍照才判定越界（2%～30%，取決於 allure）。
                // 淫亂門檻 60 決定後續可選回應，不改變越界事件的抽選機率。
                if (action !== "photo_refuse" && HM.rollChance(Math.min(30, Math.max(2, Math.round(2 + (Number(State.variables.allure) || 0) / 16000 * 28))))) {
                    e.modelPhotoIncident = true;
                    e.modelPhotoIncidentWilling = (Number(State.variables.promiscuity) || 0) >= 60;
                    e.stage = "photo_incident";
                } else {
                    e.stage = "showing";
                }
                return true;
            }
            // 回應時只結算一次壓力、性奮與額外小費；結果文案不可再次套用效果。
            // 額外小費以英鎊累加，最終工作結算才轉換為遊戲貨幣單位。
            if (e.stage === "photo_incident" && ["incident_push", "incident_warn", "incident_close", "incident_extra"].includes(action)) {
                const willing = (Number(State.variables.promiscuity) || 0) >= 60;
                if (!willing && !["incident_push", "incident_warn"].includes(action)) return false;
                if (willing && !["incident_close", "incident_extra"].includes(action)) return false;
                if (action === "incident_push") {
                    Wikifier.wikifyEval("<<stress 1>>");
                    e.modelIncidentAction = "push";
                } else if (action === "incident_warn") {
                    Wikifier.wikifyEval("<<stress 1>>");
                    e.modelIncidentAction = "warn";
                } else if (action === "incident_close") {
                    Wikifier.wikifyEval("<<stress -1>><<arousal 100>>");
                    e.modelIncidentAction = "close";
                } else {
                    Wikifier.wikifyEval("<<stress -1>><<arousal 200>>");
                    const extra = Math.max(10, Math.round((Number(e.modelPhotoOffer) || 5) * 1.5));
                    e.modelTips += extra;
                    e.modelReward += extra;
                    e.modelLastTip = (Number(e.modelLastTip) || 0) + extra;
                    e.modelLastEarned = (Number(e.modelLastEarned) || 0) + extra;
                    e.modelPhotoExtra = extra;
                    e.modelIncidentAction = "extra";
                }
                e.modelPhotoIncident = false;
                e.modelPhotoIncidentWilling = false;
                e.stage = "showing";
                return true;
            }
            if (action === "finish" && e.stage === "showing") {
                // 還原異常不阻止事件結束。modelRestore 會先回滾到還原前的穿著狀態，
                // 因此玩家保留當前服裝；不再重試，以免進入無法離開的循環。
                let restored = false;
                try {
                    restored = HM.modelRestore(e);
                } catch (error) {
                    console.error("[HonestMarkets] 模特兒還原衣物時發生未預期錯誤", error);
                }
                e.modelRestoreFailed = !restored;
                // 只在成功結束時依已完成各輪的平均表現產生結語，並鎖定隨機文案。
                // 未滿三輪時替補尚未抵達；完成三輪才描寫替補到場。
                const avgScore = e.modelRounds ? (Number(e.modelScoreTotal) || 0) / e.modelRounds : 0;
                e.modelClosingTier = avgScore < 0.3 ? 0 : avgScore < 0.6 ? 1 : avgScore < 0.85 ? 2 : 3;
                e.modelClosingIndex = rand(0, 1);
                // 展示報酬以英鎊計算與顯示；原版 <<money>> 接收的金額單位為便士。
                if (e.modelReward) Wikifier.wikifyEval(`<<money ${Math.round(e.modelReward * 100)}>>`);
                e.result = e.modelRestoreFailed ? "clothes_lost" : "finished";
                delete e.modelWardrobes;
                return true;
            }
            return false;
        }
    });

    // 從仍有庫存的市場報價中隨機挑選，並允許事件提供額外篩選條件。
    HM.pickEncounterOffer = function (predicate) {
        const offers = HM.marketOffers().filter(o => !predicate || predicate(o));
        return offers.length ? offers[rand(0, offers.length - 1)] : null;
    };

    HM.encounterOffer = function (e) {
        return HM.marketOffers().find(o => o.id === e?.itemId && o.qty > 0) || null;
    };

    HM.encounterCanPay = function (price) {
        return (Number(State.variables.money) || 0) >= Math.max(0, Number(price) || 0);
    };

    // 統一處理市場遭遇中的正常商品交易：給貨、扣款、扣除實際庫存並推進交易時間。
    // 特殊交易（例如缺斤少兩實際交貨量與收費量不一致）應保留自己的結算邏輯。
    HM.encounterBuy = function (e, qty, price, minutes = 5) {
        const offer = HM.encounterOffer(e);
        qty = Math.max(1, Math.floor(Number(qty) || 0));
        price = Math.max(1, Math.round(Number(price) || 0));
        minutes = Math.max(0, Math.floor(Number(minutes) || 0));
        if (!offer || offer.qty < qty || !HM.encounterCanPay(price)) return false;

        Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} ${qty}>><<money -${price}>>`);
        HM.consumeEncounterOffer(e.itemId, qty);
        if (minutes > 0 && typeof HM.advanceMinutes === "function") HM.advanceMinutes(minutes);
        return true;
    };

    HM.registerMarketEncounter("flash_sale", {
        weight: 18,
        timeWeights: { preparing: 0.6, morning: 0.7, daytime: 1.0, peak: 1.2, late: 2.0, closing: 2.2 },
        output: "HonestMarketsEncounterFlashSale",
        resultOutput: "HonestMarketsEncounterFlashSaleResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty >= 3); },
        create(e) {
            const offer = HM.pickEncounterOffer(o => o.qty >= 3);
            if (!offer) return;
            e.itemId = offer.id;
            e.normalPrice = Math.max(1, Math.round(offer.wholesaleUnit));
            e.discount = rand(65, 85) / 100;
            e.price = Math.max(1, Math.round(e.normalPrice * e.discount));
            // 攤販是為了清掉賣不完的存貨，因此一次願意用特價拋售約 20～50%，最多 24 份。
            const minClearance = Math.max(1, Math.ceil(offer.qty * 0.20));
            const maxClearance = Math.max(minClearance, Math.min(24, Math.ceil(offer.qty * 0.50)));
            e.offerQty = rand(minClearance, maxClearance);
        },
        resolve(e, action) {
            if (action === "buy") {
                const offer = HM.encounterOffer(e);
                const money = Math.max(0, Number(State.variables.money) || 0);
                const affordable = Math.floor(money / e.price);
                const buyQty = offer ? Math.min(offer.qty, Math.max(0, Number(e.offerQty) || 0), affordable) : 0;
                if (buyQty <= 0) { e.result = "cannot_buy"; return true; }

                const totalPrice = e.price * buyQty;
                if (!HM.encounterBuy(e, buyQty, totalPrice)) { e.result = "cannot_buy"; return true; }
                e.boughtQty = buyQty;
                e.totalPrice = totalPrice;
                e.remainingQty = HM.encounterOffer(e)?.qty || 0;
                e.result = "bought";
            } else if (action === "decline") e.result = "declined";
            else return false;
            return true;
        }
    });

    HM.registerMarketEncounter("market_rumor", {
        weight: 14,
        timeWeights: { preparing: 0.8, morning: 1.1, daytime: 1.0, peak: 1.0, late: 1.1, closing: 0.8 },
        output: "HonestMarketsEncounterMarketRumor",
        resultOutput: "HonestMarketsEncounterMarketRumorResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => HM.getPriceBreakdown?.(o.id)); },
        create(e) {
            const candidates = HM.marketOffers().map(o => ({ offer: o, info: HM.getPriceBreakdown?.(o.id) }))
                .filter(x => x.info);
            if (!candidates.length) return;
            const picked = candidates[rand(0, candidates.length - 1)];
            e.itemId = picked.offer.id;
            e.marketRatio = picked.info.marketRatio;
            e.trend = e.marketRatio >= 1.08 ? "high" : (e.marketRatio <= 0.92 ? "low" : "steady");
        },
        resolve(e, action) {
            if (action !== "listen") return false;
            Wikifier.wikifyEval("<<stress -1>>");
            e.result = "done";
            return true;
        }
    });

    HM.registerMarketEncounter("short_measure", {
        weight: 12,
        timeWeights: { preparing: 0.7, morning: 0.9, daytime: 1.0, peak: 1.2, late: 1.4, closing: 1.2 },
        output: "HonestMarketsEncounterShortMeasure",
        resultOutput: "HonestMarketsEncounterShortMeasureResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty >= 5); },
        create(e) {
            const offer = HM.pickEncounterOffer(o => o.qty >= 5);
            if (!offer) return;
            e.itemId = offer.id;
            e.claimedQty = rand(8, Math.min(24, offer.qty));
            const minActual = Math.max(1, Math.floor(e.claimedQty * 0.60));
            const maxActual = Math.max(minActual, Math.min(e.claimedQty - 1, Math.floor(e.claimedQty * 0.85)));
            e.actualQty = rand(minActual, maxActual);
            // 看似划算：按實際交貨量附近收費，但對外宣稱是 claimedQty 份。
            e.price = Math.max(1, Math.round(offer.wholesaleUnit * e.actualQty * rand(95, 110) / 100));
        },
        resolve(e, action) {
            const offer = HM.encounterOffer(e);
            if (action === "buy") {
                if (!offer || offer.qty < e.actualQty || !HM.encounterCanPay(e.price)) { e.result = "cannot_buy"; return true; }
                Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} ${e.actualQty}>><<money -${e.price}>><<stress 1>>`);
                offer.qty -= e.actualQty;
                offer.wholesaleTotal = offer.qty > 0 ? Math.max(1, Math.round(offer.wholesaleUnit * offer.qty)) : 0;
                if (typeof HM.advanceMinutes === "function") HM.advanceMinutes(5);
                e.result = "cheated";
            } else if (action === "question") {
                if (HM.rollChance(70)) {
                    e.price = Math.max(1, Math.round((offer?.wholesaleUnit || 1) * e.claimedQty));
                    e.stage = "corrected";
                } else e.result = "denied";
            } else if (action === "buy_corrected" && e.stage === "corrected") {
                if (!offer || offer.qty < e.claimedQty || !HM.encounterCanPay(e.price)) { e.result = "cannot_buy"; return true; }
                if (!HM.encounterBuy(e, e.claimedQty, e.price)) { e.result = "cannot_buy"; return true; }
                Wikifier.wikifyEval("<<stress -1>>");
                e.result = "corrected_buy";
            } else if (action === "leave") e.result = "left";
            else return false;
            return true;
        }
    });

    // 熱門商品搶購：事件結束後，其他客人會把這批商品掃到只剩 0～20%。
    // 玩家若加入搶購，會先從事件開始時的實際庫存中搶到一小批，再結算其他客人的購買。
    HM.registerMarketEncounter("hot_item", {
        weight: 14,
        timeWeights: { preparing: 0.5, morning: 0.9, daytime: 1.0, peak: 1.6, late: 1.3, closing: 0.6 },
        output: "HonestMarketsEncounterHotItem",
        resultOutput: "HonestMarketsEncounterHotItemResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty >= 2); },
        create(e) {
            const offer = HM.pickEncounterOffer(o => o.qty >= 2);
            if (!offer) return;
            e.itemId = offer.id;
            e.price = Math.max(1, Math.round(offer.wholesaleUnit));
            e.startQty = offer.qty;
            // 玩家能搶到約原庫存 5～20% 的一小批，至少 1 個、最多 12 個。
            const minGrab = Math.max(1, Math.ceil(offer.qty * 0.05));
            const maxGrab = Math.max(minGrab, Math.min(12, Math.ceil(offer.qty * 0.20)));
            e.grabQty = rand(minGrab, maxGrab);
        },
        resolve(e, action) {
            const offer = HM.encounterOffer(e);
            if (!offer) {
                e.playerTake = 0;
                e.crowdTake = 0;
                e.remainingQty = 0;
                e.result = action === "buy" ? "cannot_buy" : "yielded";
                return true;
            }

            if (action === "buy") {
                const money = Math.max(0, Number(State.variables.money) || 0);
                const affordable = Math.floor(money / e.price);
                const playerTake = Math.min(offer.qty, Math.max(0, Number(e.grabQty) || 0), affordable);
                if (playerTake > 0) {
                    const totalPrice = e.price * playerTake;
                    if (!HM.encounterBuy(e, playerTake, totalPrice)) { e.playerTake = 0; }
                    else {
                        e.playerTake = playerTake;
                        e.totalPrice = totalPrice;
                    }
                } else {
                    e.playerTake = 0;
                }
            } else if (action === "yield") {
                e.playerTake = 0;
            } else return false;

            // 無論玩家是否參與，搶購人潮都會把剩餘商品掃到只剩 0～20%。
            const beforeCrowd = offer.qty;
            const keepPercent = rand(0, 20) / 100;
            const remaining = Math.min(beforeCrowd, Math.floor(beforeCrowd * keepPercent));
            e.crowdTake = beforeCrowd - remaining;
            offer.qty = remaining;
            offer.wholesaleTotal = remaining > 0 ? Math.max(1, Math.round(offer.wholesaleUnit * remaining)) : 0;
            e.remainingQty = remaining;

            if (action === "buy") e.result = e.playerTake > 0 ? "bought" : "cannot_buy";
            else e.result = "yielded";
            return true;
        }
    });

    HM.registerMarketEncounter("lost_property", {
        weight: 14,
        timeWeights: { preparing: 0.5, morning: 0.8, daytime: 1.0, peak: 1.5, late: 1.3, closing: 0.7 },
        output: "HonestMarketsEncounterLostProperty",
        resultOutput: "HonestMarketsEncounterLostPropertyResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().length > 0; },
        create(e) {
            const offer = HM.pickEncounterOffer();
            if (!offer) return;
            e.itemId = offer.id;
            e.value = Math.max(1, Math.round(Number(setup.foodstuff?.[e.itemId]?.shop?.sell_price) || offer.wholesaleUnit || 1));
        },
        resolve(e, action) {
            if (action === "keep") {
                Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} 1>><<crimeUp ${Math.max(1, Math.round(e.value / 100))} "petty">>`);
                e.result = "kept";
            } else if (action === "return") {
                Wikifier.wikifyEval("<<stress -1>>");
                e.result = "returned";
            } else return false;
            return true;
        }
    });

    HM.registerMarketEncounter("mistaken_regular", {
        weight: 12,
        timeWeights: { preparing: 0.8, morning: 1.3, daytime: 1.1, peak: 0.9, late: 0.8, closing: 0.6 },
        output: "HonestMarketsEncounterMistakenRegular",
        resultOutput: "HonestMarketsEncounterMistakenRegularResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().length > 0; },
        create(e) {
            const offer = HM.pickEncounterOffer();
            if (!offer) return;
            e.itemId = offer.id;
            e.qty = rand(3, Math.min(8, offer.qty));
            e.normalUnitPrice = Math.max(1, Math.round(offer.wholesaleUnit));
            e.normalPrice = Math.max(1, Math.round(e.normalUnitPrice * e.qty));
            e.price = Math.max(1, Math.round(e.normalPrice * rand(70, 85) / 100));
        },
        resolve(e, action) {
            if (action === "accept") {
                const offer = HM.encounterOffer(e);
                if (!offer || offer.qty < e.qty || !HM.encounterCanPay(e.price)) { e.result = "cannot_buy"; return true; }
                if (!HM.encounterBuy(e, e.qty, e.price)) { e.result = "cannot_buy"; return true; }
                e.result = "bought";
            } else if (action === "correct") {
                Wikifier.wikifyEval("<<stress -1>>");
                e.result = "corrected";
            } else return false;
            return true;
        }
    });

    HM.registerMarketEncounter("pushy_vendor", {
        weight: 16,
        timeWeights: { preparing: 0.8, morning: 0.9, daytime: 1.0, peak: 1.2, late: 1.5, closing: 1.6 },
        output: "HonestMarketsEncounterPushyVendor",
        resultOutput: "HonestMarketsEncounterPushyVendorResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty >= 2); },
        create(e) {
            const offer = HM.pickEncounterOffer(o => o.qty >= 2);
            if (!offer) return;
            e.itemId = offer.id;
            e.qty = rand(8, Math.min(24, offer.qty));
            e.normalUnitPrice = Math.max(1, Math.round(offer.wholesaleUnit));
            e.normalPrice = Math.max(1, Math.round(offer.wholesaleUnit * e.qty));
            e.askingPrice = Math.max(1, Math.round(e.normalPrice * rand(110, 135) / 100));
            e.price = e.askingPrice;
        },
        resolve(e, action) {
            const offer = HM.encounterOffer(e);
            if (action === "buy") {
                if (!offer || offer.qty < e.qty || !HM.encounterCanPay(e.price)) { e.result = "cannot_buy"; return true; }
                if (!HM.encounterBuy(e, e.qty, e.price)) { e.result = "cannot_buy"; return true; }
                e.result = "bought";
            } else if (action === "haggle") {
                if (HM.rollChance(70)) {
                    e.price = Math.max(1, Math.round(e.normalPrice * rand(82, 98) / 100));
                    e.stage = "haggled";
                } else {
                    e.price = e.askingPrice;
                    e.stage = "haggled_fail";
                }
            } else if (action === "refuse") {
                Wikifier.wikifyEval("<<stress 1>>");
                e.result = "refused";
            } else return false;
            return true;
        }
    });

    HM.registerMarketEncounter("vendor_gift", {
        weight: 22,
        timeWeights: { preparing: 1.3, morning: 1.2, daytime: 1.0, peak: 0.8, late: 0.7, closing: 0.6 },
        output: "HonestMarketsEncounterVendorGift",
        resultOutput: "HonestMarketsEncounterVendorGiftResult",
        eligible() {
            return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => setup.foodstuff[o.id]?.category !== "seed");
        },
        create(encounter) {
            const candidates = HM.marketOffers().filter(o => setup.foodstuff[o.id]?.category !== "seed");
            encounter.itemId = candidates.length ? candidates[rand(0, candidates.length - 1)].id : null;
        },
        resolve(e, action) {
            if (action === "accept") {
                Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} 1>><<stress -1>>`);
                HM.consumeEncounterOffer(e.itemId);
                e.result = "done";
            } else if (action === "decline") {
                e.result = "done";
            } else return false;
            return true;
        }
    });


    // 額外的獨立市場小事件：不建立跨次探索狀態，選擇後立即結算。
    HM.registerMarketEncounter("dropped_goods", {
        weight: 14, timeWeights: { preparing: 1.2, morning: 1.1, daytime: 1.0, peak: 1.3, late: 1.1, closing: 0.7 },
        npc: true,
        output: "HonestMarketsEncounterDroppedGoods", resultOutput: "HonestMarketsEncounterDroppedGoodsResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().length > 0; },
        create(e) {
            const o = HM.pickEncounterOffer();
            if (!o) return;
            e.itemId = o.id;
            e.damaged = rand(1, 3);
            const breakdown = typeof HM.getPriceBreakdown === "function" ? HM.getPriceBreakdown(o.id) : null;
            e.unitValue = Math.max(1, Math.round(Number(breakdown?.currentMarketPrice ?? setup.foodstuff?.[o.id]?.shop?.sell_price ?? o.wholesaleUnit) || 1));
            e.compensation = e.unitValue * e.damaged;
        },
        resolve(e, action) {
            const V = State.variables;
            if (action === "pay") {
                Wikifier.wikifyEval(`<<money -${Math.min(e.compensation, Math.max(0, Number(V.money) || 0))}>><<stress -1>>`);
                e.result = "paid";
            } else if (action === "deny") {
                Wikifier.wikifyEval("<<stress 2>>");
                e.result = "denied";
            } else if (action === "smash") {
                // 砸攤的總損失以最初撞落商品的鎖定價格為基準，再放大為整攤損失。
                e.stallMultiplier ??= rand(5, 10);
                e.stallDamage ??= Math.max(e.compensation, e.compensation * e.stallMultiplier);

                const athletics = Math.clamp(Number(V.athletics) || 0, 0, 1000);
                const dance = Math.clamp(Number(V.danceskill) || 0, 0, 1000);
                // 運動能力主導奔跑，舞蹈能力補充在人群中的閃身與變向；成功率限制在 20%～90%。
                e.escapeChance = Math.clamp(Math.round(20 + 70 * ((athletics * 0.7 + dance * 0.3) / 1000)), 20, 90);
                e.escapeRoll = HM.rollRng();
                Wikifier.wikifyEval("<<stress -3>><<crimeUp 5 \"petty\">>");
                if (e.escapeRoll > 100 - e.escapeChance) {
                    e.result = "smashed_escaped";
                } else {
                    e.stage = "caught_after_smash";
                    e.result = null;
                }
            } else if (action === "stall_pay" && e.stage === "caught_after_smash") {
                const money = Math.max(0, Number(V.money) || 0);
                if (money <= 0) return false;
                e.paidAfterSmash = Math.min(money, e.stallDamage);
                Wikifier.wikifyEval(`<<money -${e.paidAfterSmash}>><<stress 2>>`);
                e.result = money >= e.stallDamage ? "stall_paid" : "stall_partial";
                e.stage = "resolved";
            } else if (action === "voluntary_compensation" && e.stage === "caught_after_smash" && ((Number(V.promiscuity) || 0) >= 60 || Number(V.debug) === 1)) {
                e.result = "voluntary_sex";
            } else if (action === "forced_compensation" && e.stage === "caught_after_smash" && (Number(V.money) || 0) <= 0) {
                e.result = "forced_sex";
            } else return false;
            return true;
        }
    });
    HM.registerMarketEncounter("queue_jumper", {
        weight: 15, timeWeights: { preparing: 0.3, morning: 0.8, daytime: 1.0, peak: 1.7, late: 1.4, closing: 0.5 },
        output: "HonestMarketsEncounterQueueJumper", resultOutput: "HonestMarketsEncounterQueueJumperResult",
        resolve(e, action) {
            if (action === "ignore") { Wikifier.wikifyEval("<<stress 1>>"); e.result="ignored"; }
            else if (action === "argue") { e.argumentStressChange = HM.rollChance(65) ? -1 : 2; Wikifier.wikifyEval(`<<stress ${e.argumentStressChange}>>`); e.result="argued"; }
            else if (action === "push") { Wikifier.wikifyEval("<<stress -2>><<pain 1>>"); e.result="pushed"; }
            else return false; return true;
        }
    });
    HM.registerMarketEncounter("market_argument", {
        weight: 13, timeWeights: { preparing: 0.5, morning: 0.8, daytime: 1.0, peak: 1.5, late: 1.3, closing: 0.8 },
        output: "HonestMarketsEncounterMarketArgument", resultOutput: "HonestMarketsEncounterMarketArgumentResult",
        create(e) {
            // 在事件建立時就鎖定是否會從口角升級成鬥毆，避免重繪頁面改變結果。
            e.turnsViolent = HM.rollChance(35);
            if (e.turnsViolent) {
                const offer = e.targetPassage === "HonestMarkets Products" ? HM.pickEncounterOffer(o => o.qty > 0) : null;
                if (offer) {
                    e.itemId = offer.id;
                    e.giftQty = rand(1, Math.min(3, offer.qty));
                }
            }
        },
        resolve(e, action) {
            if (action === "watch") {
                if (typeof HM.advanceMinutes === "function") HM.advanceMinutes(5);
                if (e.turnsViolent) {
                    e.stage = "fight_aftermath";
                    e.result = "escalate";
                } else {
                    e.result = "watched";
                }
            } else if (action === "mediate") {
                if (typeof HM.advanceMinutes === "function") HM.advanceMinutes(5);
                if (e.turnsViolent) {
                    Wikifier.wikifyEval("<<pain 4>>");
                    const offer = e.itemId ? HM.encounterOffer(e) : null;
                    const giftQty = offer ? Math.min(offer.qty, Math.max(1, Number(e.giftQty) || 1)) : 0;
                    if (giftQty > 0) {
                        Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} ${giftQty}>>`);
                        HM.consumeEncounterOffer(e.itemId, giftQty);
                    }
                    e.giftQty = giftQty;
                    e.result = "mediated_fight";
                } else {
                    Wikifier.wikifyEval("<<stress -1>>");
                    e.result = "mediated";
                }
            } else if (action === "help_cleanup" && e.stage === "fight_aftermath") {
                const offer = e.itemId ? HM.encounterOffer(e) : null;
                const giftQty = offer ? Math.min(offer.qty, Math.max(1, Number(e.giftQty) || 1)) : 0;
                if (giftQty > 0) {
                    Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} ${giftQty}>><<stress -1>>`);
                    HM.consumeEncounterOffer(e.itemId, giftQty);
                } else {
                    Wikifier.wikifyEval("<<stress -1>>");
                }
                e.giftQty = giftQty;
                e.stage = null;
                e.result = "helped_cleanup";
            } else if (action === "leave_after_fight" && e.stage === "fight_aftermath") {
                e.stage = null;
                e.result = "left_after_fight";
            } else if (action === "leave") e.result = "left";
            else return false;
            return true;
        }
    });
    HM.registerMarketEncounter("beggar", {
        weight: 12, timeWeights: { preparing: 0.7, morning: 0.9, daytime: 1.0, peak: 1.1, late: 1.2, closing: 1.0 },
        output: "HonestMarketsEncounterBeggar", resultOutput: "HonestMarketsEncounterBeggarResult",
        resolve(e, action) {
            const donations = { give10: { amount: 1000, stress: -1 }, give50: { amount: 5000, stress: -3 }, give100: { amount: 10000, stress: -6 } };
            if (donations[action]) {
                const choice = donations[action];
                if ((Number(State.variables.money) || 0) < choice.amount) { e.result = "cannot_give"; e.requested = choice.amount; return true; }
                e.given = choice.amount;
                Wikifier.wikifyEval(`<<money -${choice.amount}>><<stress ${choice.stress}>>`);
                e.result = "gave";
            } else if (action === "refuse") e.result="refused"; else return false; return true;
        }
    });
    // 輕量型狀態事件也必須完整走事件註冊、resolve 與 resultOutput 流程。
    // 金錢以便士計算（£1 = 100），壓力透過原版 <<stress>> 巨集調整。
    HM.registerMarketEncounter("street_performer", {
        weight: 11,
        timeWeights: { preparing: 0.3, morning: 0.7, daytime: 1.2, peak: 1.3, late: 1.1, closing: 0.5 },
        output: "HonestMarketsEncounterStreetPerformer",
        resultOutput: "HonestMarketsEncounterStreetPerformerResult",
        resolve(e, action) {
            const choices = {
                watch: { amount: 0, stress: -2 },
                tip10: { amount: 1000, stress: -4 },
                tip50: { amount: 5000, stress: -8 },
                tip100: { amount: 10000, stress: -12 }
            };
            if (action === "leave") { e.result = "left"; return true; }
            const choice = choices[action];
            if (!choice) return false;
            // 餘額不足時不扣款、不減壓，也不消耗觀賞時間。
            if (Number(State.variables.money) < choice.amount) {
                e.requested = choice.amount;
                e.result = "cannot_tip";
                return true;
            }
            e.tipped = choice.amount;
            e.stressChange = choice.stress;
            HM.advanceMinutes(5);
            Wikifier.wikifyEval(`${choice.amount ? `<<money -${choice.amount}>>` : ""}<<stress ${choice.stress}>>`);
            e.result = choice.amount ? "tipped" : "watched";
            return true;
        }
    });
    // 街頭按摩師（v0.5.16.1）：階段推進、時間與數值效果在 resolve 中結算一次；文案留在 Twee。
    // 一般隨機文案指針彼此獨立；主動路線則固定整場 encourageScene，三幕共用同一組 case。
    // 修改興奮增量時須保留原版 <<arousal>> Widget 的結算方式，避免重繪重複加值。
    // 主動路線的「完整三幕劇情組」數量。每組必須同時提供三幕相同編號的 case。
    // 目前只有 case 0；新增完整的 case 1 後才改成 2，以此類推。
    const STREET_MASSEUR_ENCOURAGE_SCENE_COUNT = 1;
    HM.registerMarketEncounter("street_masseur", {
        weight: 10,
        timeWeights: { preparing: 0.3, morning: 0.7, daytime: 1.1, peak: 1.2, late: 1.1, closing: 0.5 },
        npc: 1,
        output: "HonestMarketsEncounterStreetMasseur",
        resultOutput: "HonestMarketsEncounterStreetMasseurResult",
        create(e) {
            // 事件建立時拍下衣著狀態：裸體與濕透造成的暴露必須分開判定。
            const clothes = HM.marketCollectorClothing();
            const upperExposure = Math.max(
                HM.ambushItemExposure("upper"),
                HM.ambushItemExposure("over_upper"),
                HM.ambushItemExposure("under_upper")
            );
            const lowerExposure = Math.max(
                HM.ambushItemExposure("lower"),
                HM.ambushItemExposure("over_lower"),
                HM.ambushItemExposure("under_lower")
            );
            const nakedUpper = !clothes.upperOuter && !clothes.upperUnder;
            const nakedLower = !clothes.lowerOuter && !clothes.lowerUnder;
            // 0 正常、1 部分暴露、2 明顯暴露、3 全裸。
            e.exposureReaction = nakedUpper && nakedLower ? 3
                : upperExposure >= 2 || lowerExposure >= 2 || nakedUpper || nakedLower ? 2
                : upperExposure >= 1 || lowerExposure >= 1 ? 1 : 0;
            // 只提高按摩師「越界」機率，不影響市場抽到按摩師事件的 weight。
            // 基礎機率依原版誘惑值 20～60%；全裸時額外 +35 個百分點。
            const exposureBonus = [0, 8, 18, 35][e.exposureReaction];
            e.overstepChance = Math.min(95, HM.allureChance(20, 60) + exposureBonus);
            e.overstep = HM.rollChance(e.overstepChance);
            e.targetBody = rand(0, 1) ? "chest" : "lower";
            e.introVariant = rand(0, 2);
            e.touchVariant = rand(0, 2);
            e.responseVariant = rand(0, 2);
            e.stageVariant = rand(0, 2);
            e.ignoreStage = 0;
            e.encourageStage = 0;
            // 三幕共用的完整劇情指針；開始主動路線時才決定，後續不重新抽。
            e.encourageScene = null;
            e.paid = false;
        },
        resolve(e, action) {
            const effect = (macros, minutes) => {
                if (minutes) HM.advanceMinutes(minutes);
                if (macros) Wikifier.wikifyEval(macros);
            };
            const finish = (result, macros, minutes) => {
                effect(macros, minutes);
                e.result = result;
                return true;
            };
            const nextStage = (route, level, gain, minutes) => {
                // 僅在 resolve(action) 內增加興奮，重新渲染 Passage 不會重複結算。
                effect(`<<arousal ${gain}>>`, minutes);
                e.stage = route;
                e[route === "ignore_stage" ? "ignoreStage" : "encourageStage"] = level;
                if (route === "ignore_stage") e.stageVariant = rand(0, 2);
                return true;
            };
            if (e.stage === "initial") {
                if (action === "leave") return finish("declined");
                if (action !== "start") return false;
                if ((Number(State.variables.money) || 0) < 5000) return finish("cannot_pay");
                effect('<<money -5000>>', 5);
                e.paid = true;
                if (e.overstep) {
                    // 初次越界無論玩家選擇如何，均先結算一次生理興奮。
                    effect('<<arousal 50>>');
                    e.stage = "touch_choice";
                    return true;
                }
                return finish("normal", '<<tiredness -8>><<stress -12>>', 10);
            }
            if (!e.paid) return false;
            const canEncourage = typeof hasSexStat === "function" && hasSexStat("exhibitionism", 4);
            if (e.stage === "touch_choice" || e.stage === "ignore_stage") {
                const level = e.stage === "ignore_stage" ? e.ignoreStage : 0;
                if (action === "stop") return finish("stop", '<<tiredness -2>><<stress 5>>');
                if (action === "warn") return finish("warn", '<<tiredness -8>><<stress -2>>', Math.max(0, 10 - level * 2));
                if (action === "encourage") {
                    if (!canEncourage) return false;
                    // 只在玩家選擇進入主動路線的瞬間抽選一次。
                    // 不與 ignoreStage 的 stageVariant 混用，避免換幕時跳劇情。
                    e.encourageScene = rand(0, STREET_MASSEUR_ENCOURAGE_SCENE_COUNT - 1);
                    return nextStage("encourage_stage", 1, 200, 2);
                }
                if (action === "ignore") {
                    if (level >= 3) return finish("ignore", '<<tiredness -8>><<stress 3>>', 1);
                    return nextStage("ignore_stage", level + 1, 75 + level * 25, 2);
                }
                return false;
            }
            if (e.stage === "encourage_stage") {
                // 主動路線為單行道；第三幕結束後才允許結算。
                if (action === "end") {
                    if (e.encourageStage !== 3) return false;
                    return finish("encourage", '<<tiredness -5>><<stress -3>>', 1);
                }
                if (action !== "more" || e.encourageStage >= 3) return false;
                return nextStage("encourage_stage", e.encourageStage + 1, e.encourageStage === 1 ? 350 : 500, 2);
            }
            return false;
        }
    });
    HM.registerMarketEncounter("directions", {
        weight: 12, timeWeights: { preparing: 0.7, morning: 1.1, daytime: 1.1, peak: 0.9, late: 0.8, closing: 0.5 },
        output: "HonestMarketsEncounterDirections", resultOutput: "HonestMarketsEncounterDirectionsResult",
        resolve(e, action) {
            if (action === "point") { Wikifier.wikifyEval("<<stress -1>>"); e.result="pointed"; }
            else if (action === "guide") { if(typeof HM.advanceMinutes==="function") HM.advanceMinutes(10); Wikifier.wikifyEval("<<stress -2>>"); e.result="guided"; }
            else if (action === "ignore") e.result="ignored"; else return false; return true;
        }
    });
    HM.registerMarketEncounter("sleeping_vendor", {
        weight: 10, timeWeights: { preparing: 0.4, morning: 0.6, daytime: 0.9, peak: 0.6, late: 1.4, closing: 2.0 },
        output: "HonestMarketsEncounterSleepingVendor", resultOutput: "HonestMarketsEncounterSleepingVendorResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().length > 0; },
        create(e) { const o=HM.pickEncounterOffer(); if(!o)return; e.itemId=o.id; e.value=Math.max(1,Math.round(Number(setup.foodstuff?.[o.id]?.shop?.sell_price)||o.wholesaleUnit||1)); },
        resolve(e, action) {
            if (action === "wake") { Wikifier.wikifyEval("<<stress -1>>"); e.result="woke"; }
            else if (action === "leave") e.result="left";
            else if (action === "steal") { Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} 1>><<crimeUp ${Math.max(1,Math.round(e.value/100))} "petty">>`); HM.consumeEncounterOffer(e.itemId); e.result="stolen"; }
            else return false; return true;
        }
    });
    HM.registerMarketEncounter("suspicious_goods", {
        weight: 11, timeWeights: { preparing: 0.6, morning: 0.8, daytime: 1.0, peak: 1.0, late: 1.4, closing: 1.6 },
        output: "HonestMarketsEncounterSuspiciousGoods", resultOutput: "HonestMarketsEncounterSuspiciousGoodsResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty >= 2); },
        create(e) {
            const o = HM.pickEncounterOffer(o => o.qty >= 2);
            if (!o) return;
            e.itemId = o.id;
            e.qty = rand(2, Math.min(10, o.qty));
            e.normalUnitPrice = Math.max(1, Math.round(o.wholesaleUnit));
            e.normalPrice = Math.max(1, Math.round(e.normalUnitPrice * e.qty));
            e.price = Math.max(1, Math.round(e.normalPrice * rand(45, 70) / 100));
        },
        resolve(e, action) {
            if (action === "buy") {
                const offer = HM.encounterOffer(e);
                if (!offer || offer.qty < e.qty || !HM.encounterCanPay(e.price)) { e.result="cannot_buy"; return true; }
                if (!HM.encounterBuy(e, e.qty, e.price)) { e.result="cannot_buy"; return true; }
                Wikifier.wikifyEval("<<stress 1>>");
                e.result="bought";
            }
            else if (action === "question") { Wikifier.wikifyEval("<<stress 1>>"); e.result="questioned"; }
            else if (action === "leave") e.result="left"; else return false; return true;
        }
    });
    HM.registerMarketEncounter("carry_goods", {
        weight: 13, timeWeights: { preparing: 1.8, morning: 1.5, daytime: 1.1, peak: 0.7, late: 0.8, closing: 1.2 },
        output: "HonestMarketsEncounterCarryGoods", resultOutput: "HonestMarketsEncounterCarryGoodsResult",
        eligible() { return HM.isPassage("HonestMarkets Products") && HM.marketOffers().some(o => o.qty > 0); },
        create(e) {
            const offer = HM.pickEncounterOffer(o => o.qty > 0);
            e.pay = rand(1000, 1500);
            if (!offer) return;
            e.itemId = offer.id;
            e.giftQty = rand(1, Math.min(3, offer.qty));
        },
        resolve(e, action) {
            if (action === "help") {
                if (typeof HM.advanceMinutes === "function") HM.advanceMinutes(10);
                Wikifier.wikifyEval("<<tiredness 7>>");
                const offer = HM.marketOffers().find(o => o.id === e.itemId && o.qty > 0);
                const giftQty = offer ? Math.min(offer.qty, Math.max(1, Number(e.giftQty) || 1)) : 0;
                Wikifier.wikifyEval(`<<money ${e.pay}>><<stress -1>>`);
                if (giftQty > 0) {
                    Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(e.itemId)} ${giftQty}>>`);
                    offer.qty -= giftQty;
                    offer.wholesaleTotal = offer.qty > 0 ? Math.max(1, Math.round(offer.wholesaleUnit * offer.qty)) : 0;
                }
                e.giftQty = giftQty;
                e.result = "helped";
            }
            else if (action === "refuse") e.result = "refused"; else return false; return true;
        }
    });

    HM.consumeEncounterOffer = function (itemId, qty = 1) {
        const offer = HM.marketOffers().find(o => o.id === itemId && o.qty > 0);
        qty = Math.max(1, Math.floor(Number(qty) || 1));
        if (!offer || offer.qty < qty) return false;
        offer.qty -= qty;
        offer.wholesaleTotal = offer.qty > 0 ? Math.max(1, Math.round(offer.wholesaleUnit * offer.qty)) : 0;
        return true;
    };

    // 建立「本次實際可抽」的候選池；資格判定失敗只排除該事件，不中斷整個市場。
    HM.marketEncounterCandidates = function (targetPassage) {
        const previous = HM._encounterTargetPassage;
        HM._encounterTargetPassage = targetPassage || previous || null;
        try {
            return Object.values(HM.MARKET_ENCOUNTERS).filter(def => {
                if (!(Number(def.weight) > 0)) return false;
                try { return typeof def.eligible !== "function" || def.eligible(); }
                catch (error) {
                    console.error(`[HonestMarkets] 市場事件資格判定失敗：${def.id}`, error);
                    return false;
                }
            });
        } finally {
            HM._encounterTargetPassage = previous || null;
        }
    };

    // 依目前時段修正候選事件的相對權重；未宣告時段倍率的事件維持原始 weight。
    HM.weightedEncounterPick = function (pool, timeInfo) {
        const weighted = pool.map(def => ({ def, weight: HM.marketEncounterWeight(def, timeInfo) }))
            .filter(entry => entry.weight > 0);
        const total = weighted.reduce((n, entry) => n + entry.weight, 0);
        if (total <= 0) return null;
        let roll = Math.random() * total;
        for (const entry of weighted) {
            roll -= entry.weight;
            if (roll <= 0) return entry.def;
        }
        return weighted[weighted.length - 1]?.def || null;
    };

    /*
     * 市場遭遇的唯一擲骰入口。正常流程先判定總觸發率，再做資格篩選與權重抽選；
     * Debug 傳入 forcedId 時略過總觸發率，但仍要求該事件目前 eligible，避免建立無效事件。
     * create() 產生的隨機內容會直接保存，之後畫面重繪不會重新擲骰。
     */
    HM.rollMarketEncounter = function (source, forcedId, targetPassage) {
        const V = State.variables;
        targetPassage = HM.normalizeEncounterPassage(targetPassage || null);
        delete V.honestMarketsEncounter;
        const timeInfo = HM.getMarketEncounterTimeInfo();
        const triggerChance = Math.max(HM.MARKET_ENCOUNTER_CHANCE, Number(timeInfo.chance) || 0);
        if (timeInfo.key === "closed" && !forcedId) return null;
        if (!forcedId && !HM.rollChance(triggerChance)) return null;

        const pool = HM.marketEncounterCandidates(targetPassage);
        const picked = forcedId ? pool.find(e => e.id === forcedId) : HM.weightedEncounterPick(pool, timeInfo);
        if (!picked) return null;

        const encounter = { id: picked.id, source: source || "explore", targetPassage: targetPassage || null, stage: "initial", createdAt: Date.now() };
        try {
            if (typeof picked.create === "function") picked.create(encounter);
        } catch (error) {
            console.error(`[HonestMarkets] 市場事件建立失敗：${picked.id}`, error);
            return null;
        }
        if (typeof picked.eligible === "function" && "itemId" in encounter && !encounter.itemId) return null;

        V.honestMarketsEncounter = encounter;
        // npc 可設定為 true（一名）或整數 1～6（指定數量）；false／未設定不生成。
        // 生成後預設選擇 person1；多名 NPC 由各事件的 Twee 依需要切換 personN。
        const npcCount = picked.npc === true ? 1
            : (Number.isInteger(picked.npc) && picked.npc >= 1 && picked.npc <= 6 ? picked.npc : 0);
        if (npcCount > 0) {
            const npcWidgets = Array.from({ length: npcCount }, (_, index) => `<<generateNPC ${index + 1}>>`).join("");
            Wikifier.wikifyEval(npcWidgets + "<<person1>>");
        }
        return encounter;
    };

    HM.getMarketEncounter = function () { return State.variables.honestMarketsEncounter || null; };
    HM.hasMarketEncounter = function () { return !!HM.getMarketEncounter(); };

    // 事件結束後回到實際觸發事件的市場分頁；清除事件前先保存目標，
    // 讓進入戰鬥等流程即使已清掉 encounter 仍能回到原分頁。
    HM.marketEncounterReturnPassage = function () {
        const encounter = HM.getMarketEncounter();
        return HM.normalizeEncounterPassage(
            encounter?.targetPassage || State.variables.honestMarketsEncounterReturnPassage || "HonestMarkets Products"
        );
    };
    HM.clearMarketEncounter = function () {
        const encounter = HM.getMarketEncounter();
        if (encounter?.targetPassage) {
            State.variables.honestMarketsEncounterReturnPassage = HM.normalizeEncounterPassage(encounter.targetPassage);
        }
        delete State.variables.honestMarketsEncounter;
    };

    HM.encounterItemName = function (id) {
        const item = setup.foodstuff?.[id] || {};
        return item.singular || item.name || id || "商品";
    };

    // 中央結算器只負責把玩家 action 交給目前事件；各事件的實際規則留在自己的 resolve()。
    HM.resolveMarketEncounter = function (action) {
        const e = HM.getMarketEncounter();
        if (!e) return false;
        const def = HM.MARKET_ENCOUNTERS[e.id];
        if (!def || typeof def.resolve !== "function") return false;
        e.action = action;
        try { return def.resolve(e, action) !== false; }
        catch (error) {
            console.error(`[HonestMarkets] 市場事件結算失敗：${e.id}`, error);
            return false;
        }
    };

    // Twee 只需要要求「事件本體」或「結果」，實際 widget 名稱由事件定義決定。
    HM.renderMarketEncounter = function (result) {
        const e = HM.getMarketEncounter();
        if (!e) return "";
        const def = HM.MARKET_ENCOUNTERS[e.id];
        const widget = result ? def?.resultOutput : def?.output;
        return widget ? `<<${widget}>>` : "";
    };

    HM.marketEncounterDebug = function () {
        if (State.variables.debug !== 1) return "";
        const e = HM.getMarketEncounter();
        if (!e) return '<span class="grey">[市場遭遇 Debug：本輪無事件]</span><br>';
        return `<mouse class="tooltip linkBlue">[市場遭遇 Debug]<span class="black">事件：${e.id}<br>來源：${e.source}<br>階段：${e.stage || "-"}<br>選擇：${e.action || "-"}<br>結果：${e.result || "-"}</span></mouse><br>`;
    };


    /*
     * 可疑的攝影師：四組可依玩家衣著跳轉的拍攝流程。
     * 每組在事件建立時鎖定，報酬在完成當下支付；不得透過重新顯示重複領取。
     * 服裝變更使用原版衣櫃操作，敘事差分集中於 Twee。
     */
    // 每一組包含三個連續鏡位；每個鏡位分別產生協調度、心理狀態、攝影師反應差分。
    // target 僅代表畫面部位；是否顯示原版描述 Widget，仍須檢查實際衣著。
    HM.PHOTOGRAPHER_GROUPS = [
        [
            [{poseId:0,action:"站姿",target:null},{poseId:1,action:"轉身",target:null},{poseId:2,action:"回頭",target:null}],
            [{poseId:3,action:"行走",target:null},{poseId:4,action:"整理",target:null},{poseId:5,action:"凝視",target:"chest"}],
            [{poseId:6,action:"站姿",target:null},{poseId:7,action:"倚靠",target:null},{poseId:8,action:"凝視",target:null}]
        ],
        [
            [{poseId:9,action:"倚靠",target:null},{poseId:10,action:"轉身",target:null},{poseId:11,action:"凝視",target:null}],
            [{poseId:12,action:"坐姿",target:null},{poseId:13,action:"伸展",target:null},{poseId:14,action:"起身",target:null}],
            [{poseId:15,action:"站姿",target:null},{poseId:16,action:"轉身",target:null},{poseId:17,action:"回頭",target:null}]
        ],
        [
            [{poseId:18,action:"站姿",target:null},{poseId:19,action:"倚靠",target:null},{poseId:20,action:"凝視",target:"chest"}],
            [{poseId:21,action:"站姿",target:null},{poseId:22,action:"坐姿",target:null},{poseId:23,action:"伸展",target:"genitals"}],
            [{poseId:24,action:"行走",target:null},{poseId:25,action:"轉身",target:"bottom"},{poseId:26,action:"回頭",target:null}]
        ],
        [
            [{poseId:27,action:"站姿",target:null},{poseId:28,action:"轉身",target:null},{poseId:29,action:"凝視",target:"chest"}],
            [{poseId:30,action:"坐姿",target:null},{poseId:31,action:"起身",target:"genitals"},{poseId:32,action:"回頭",target:"bottom"}],
            [{poseId:33,action:"站姿",target:null},{poseId:34,action:"轉身",target:"genitals"},{poseId:35,action:"轉身",target:"bottom"}]
        ]
    ];
    // 攝影師拍攝衣物暫存：沿用已存在的原版 wardrobewear 橋接，避免直接改寫 V.worn。
    HM.photographerPrepareClothing = function (e) {
        if (e.photoWardrobes) return true;
        e.photoWardrobes = { original: HM.modelNewWardrobe("攝影師拍攝暫存") };
        e.photoRemoved = false;
        return true;
    };
    HM.photographerWardrobeAction = function (e, slot, action) {
        const previous = e.modelWardrobes;
        try {
            e.modelWardrobes = e.photoWardrobes;
            HM.modelWardrobeAction(e, "original", slot, action);
            e.photoWardrobes = e.modelWardrobes;
        } finally { e.modelWardrobes = previous; }
    };
    // 起始幕與後續跳幕只依「身體衣物」判斷；鞋襪與飾品不阻止進入最終幕。
    // 外衣（含罩衫）優先保留前兩幕；沒有外衣但仍有內衣則從第三幕開始。
    HM.photographerClothingState = function () {
        const worn = State.variables.worn || {};
        const has = slot => !!worn[slot]?.name && worn[slot].name !== "naked";
        const outer = ["over_upper", "over_lower", "upper", "lower"].some(has);
        const underwear = ["under_upper", "under_lower", "genitals"].some(has);
        return { outer, underwear, bare: !outer && !underwear };
    };
    HM.photographerFirstPhase = function () {
        const state = HM.photographerClothingState();
        return state.outer ? 0 : (state.underwear ? 2 : 3);
    };
    // 下一幕依身體衣物判定：沒有內衣時直接進入藝術寫真。
    HM.photographerNextPhase = function (phase) {
        if (phase === 1) return HM.photographerClothingState().underwear ? 2 : 3;
        if (phase === 2) return 3;
        return phase + 1;
    };
    HM.photographerEnterPhase = function (e, phase) {
        const mood = HM.photographerOfferMood(phase);
        if (mood === "blocked") return false;
        const before = HM.photographerClothingState();
        if (phase === 2 && !HM.photographerStripOuter(e)) return false;
        if (phase === 3 && !HM.photographerStripUnderwear(e)) return false;
        e.photoClothingBefore = before;
        e.photoClothingAfter = HM.photographerClothingState();
        e.photoChangedThisPhase = phase === 2 ? before.outer :
            phase === 3 ? !!(before.outer || before.underwear ||
                HM.modelWardrobeSlots.some(slot => e.photoWardrobes?.original?.[slot]?.length)) : false;
        HM.photographerApplyOfferMood(mood);
        e.offerMood = mood;
        e.stage = "shoot";
        return true;
    };
    HM.photographerStripOuter = function (e) {
        if (e.photoOuterDone) return true;
        HM.photographerPrepareClothing(e);
        const snapshot = { worn: clone(State.variables.worn), wardrobes: clone(e.photoWardrobes) };
        try {
            // 只移除現有的外衣插槽；套裝連動交給原版 Widget。
            for (const slot of ["over_upper", "over_lower", "upper", "lower"]) {
                if (State.variables.worn?.[slot]?.name && State.variables.worn[slot].name !== "naked") {
                    HM.photographerWardrobeAction(e, slot, "strip");
                }
            }
            e.photoRemoved = HM.modelWardrobeSlots.some(slot => e.photoWardrobes.original[slot]?.length);
            e.photoOuterDone = true;
            return true;
        } catch (err) {
            State.variables.worn = snapshot.worn;
            e.photoWardrobes = snapshot.wardrobes;
            HM.modelRefresh();
            console.error("HonestMarkets photographer clothing", err);
            return false;
        }
    };
    // 最後一組拍攝：移除所有仍穿戴的衣物與配件（含內衣、鞋襪、頭飾等）。
    HM.photographerStripUnderwear = function (e) {
        if (e.photoUnderwearDone) return true;
        HM.photographerPrepareClothing(e);
        const snapshot = { worn: clone(State.variables.worn), wardrobes: clone(e.photoWardrobes) };
        try {
            for (const slot of HM.modelWardrobeSlots) {
                if (State.variables.worn?.[slot]?.name && State.variables.worn[slot].name !== "naked") {
                    HM.photographerWardrobeAction(e, slot, "strip");
                }
            }
            e.photoRemoved = HM.modelWardrobeSlots.some(slot => e.photoWardrobes.original[slot]?.length);
            e.photoUnderwearDone = true;
            return true;
        } catch (err) {
            State.variables.worn = snapshot.worn;
            e.photoWardrobes = snapshot.wardrobes;
            HM.modelRefresh();
            console.error("HonestMarkets photographer underwear", err);
            return false;
        }
    };
    // 只在對應部位沒有外衣遮蓋時才顯示原版身體描述。
    HM.photographerWidgetVisibility = function () {
        const worn = State.variables.worn || {};
        const present = slot => !!worn[slot]?.name && worn[slot].name !== "naked";
        return {
            upper: !present("upper") && !present("over_upper"),
            lower: !present("lower") && !present("over_lower")
        };
    };
    HM.photographerRestoreClothing = function (e) {
        if (!e.photoWardrobes || e.photoRestored) return true;
        const snapshot = { worn: clone(State.variables.worn), wardrobes: clone(e.photoWardrobes) };
        try {
            // 只穿回這次拍攝暫存的衣物，不補上玩家原本沒有穿的衣服。
            // 由內向外還原；其餘配件依既有 slot 順序穿回。
            const restoreSlots = ["genitals", "under_lower", "under_upper", "lower", "upper", "over_lower", "over_upper",
                ...HM.modelWardrobeSlots.filter(slot => !["genitals", "under_lower", "under_upper", "lower", "upper", "over_lower", "over_upper"].includes(slot))];
            for (const slot of restoreSlots) {
                if (e.photoWardrobes.original[slot]?.length) HM.photographerWardrobeAction(e, slot, 0);
            }
            e.photoRestored = true;
            return true;
        } catch (err) {
            State.variables.worn = snapshot.worn;
            e.photoWardrobes = snapshot.wardrobes;
            HM.modelRefresh();
            console.error("HonestMarkets photographer restore", err);
            return false;
        }
    };
    HM.photographerPerformance = function (stage) {
        const V = State.variables;
        const clamp = (v, max) => Math.max(0, Math.min(1, (Number(v) || 0) / max));
        const dance = clamp(V.danceskill, 1000);
        const exhibition = clamp(V.exhibitionism, 100);
        const beauty = clamp(V.beauty, Math.max(1, Number(V.beautymax) || 10000));
        const weights = [[.70,.10,.20],[.55,.25,.20],[.35,.50,.15],[.20,.65,.15]][stage] || [.70,.10,.20];
        const score = dance * weights[0] + exhibition * weights[1] + beauty * weights[2];
        const tier = score < .25 ? 0 : score < .50 ? 1 : score < .75 ? 2 : 3;
        return { tier, score, danceTier: dance < .35 ? 0 : dance < .70 ? 1 : 2,
            calmTier: exhibition < .35 ? 0 : exhibition < .70 ? 1 : 2 };
    };
    // 攝影師敘事完全交由 Twee；JS 僅提供結構化的動作資料及能力結果。
    HM.photographerPoseData = function (e, index) {
        return HM.PHOTOGRAPHER_GROUPS[e.phase]?.[e.groups[e.phase]]?.[index] || null;
    };
    HM.photographerPoseTarget = function (e, index) {
        return HM.PHOTOGRAPHER_GROUPS[e.phase]?.[e.groups[e.phase]]?.[index]?.target || null;
    };
    // 以原版 hasSexStat 等級判定與門檻的差距，不直接猜測 exhibitionism 數值區間。
    HM.photographerOfferRequirement = function (phase) {
        return phase === 2 ? 3 : phase === 3 ? 5 : 0;
    };
    HM.photographerOfferMood = function (phase) {
        const min = HM.photographerOfferRequirement(phase);
        if (!min) return "ordinary";
        if (!hasSexStat("exhibitionism", min)) return "blocked";
        if (hasSexStat("exhibitionism", min + 2)) return "eager";
        if (hasSexStat("exhibitionism", min + 1)) return "curious";
        return "reluctant";
    };
    // 各幕結尾差分：動作與心理分別選池，使用事件建立時已固定的群組與能力資料作種子。
    // 不在每次重繪時重新抽選，避免返回頁面時同一幕的敘述改變。
    HM.photographerPhaseEnding = function (e, phase, tier, mood) {
        phase = Math.max(0, Math.min(3, Number(phase) || 0));
        tier = Math.max(0, Math.min(3, Number(tier) || 0));
        mood = ["reluctant", "curious", "eager"].includes(mood) ? mood : "curious";
        const seed = (Number(e?.groups?.[phase]) || 0) +
            Math.floor((Number(e?.performance?.[phase]?.score) || 0) * 100) +
            Math.floor(Number(e?.basePay?.[phase]) || 0);
        const variants = e?.photoEndingVariants?.[phase];
        const pick = (pool, offset) => pool[((variants?.[offset] ?? (seed + offset)) % pool.length + pool.length) % pool.length];
        const motion = [
            ["你鬆開一直握著的手指，輕輕甩了甩手腕，終於不必再盯著鏡頭。", "你退開半步，揉揉因為維持姿勢而僵硬的肩頸，順手理平衣角。", "你放下抬起的手臂，轉動一下肩膀，聽著攝影師翻看剛拍好的照片。"],
            ["你將重心換回較舒服的站姿，活動雙腿，讓剛才刻意維持的線條自然鬆開。", "你放下扶在腰側的手，伸直背脊後又放鬆，整理被動作扯皺的衣服。", "你慢慢收回伸展的手臂，朝旁邊挪了一步，讓緊繃的肌肉休息片刻。"],
            ["你先整理身上剩餘的衣料，確認沒有滑動，才將注意力從鏡頭移開。", "你收回拍攝時伸出的手臂，輕輕攏住衣角，向放著外衣的地方望去。", "你轉過身整理造型，重新調整衣物的位置，等呼吸平穩才回頭。"],
            ["你離開燈光最亮的位置，伸手拿起放在一旁的衣物，先確認它們都還在。", "你放鬆最後一個姿勢，走向暫放衣物的地方，讓自己暫時離開鏡頭的視線。", "你將肩膀放鬆，收回手臂，目光落在旁邊的衣物上，等攝影師真正放下相機。"]
        ];
        // 沒有實際脫衣時，收尾動作不得假定旁邊放著外衣或其他衣物。
        if (phase === 2 && !e?.photoClothingBefore?.outer) {
            motion[2] = [
                "你稍微活動肩膀，讓緊繃的站姿放鬆下來。",
                "你退開半步，重新調整呼吸，等攝影師查看照片。",
                "你收回拍攝時伸出的手臂，確認這組鏡頭已經完成。"
            ];
        }
        if (phase === 3 && !e?.photoRemoved) {
            motion[3] = [
                "你走離燈光最亮的位置，讓自己暫時離開鏡頭的視線。",
                "你放鬆維持許久的姿勢，等待攝影師確認拍攝結束。",
                "你收回手臂，朝巷口望了一眼，確認終於可以離開鏡頭前。"
            ];
        }
        const moodMotion = {
            reluctant: ["你不自覺地縮了縮肩，像是要把剛才被注視的感覺甩掉。", "你下意識把手臂收向身前，直到確定拍攝結束才稍稍放鬆。", "你側過身避開鏡頭，手指仍緊抓著衣角，等著對方確認結束。"],
            curious: ["你遲疑了一下才放鬆站姿，忍不住瞥向相機螢幕，想知道自己拍成什麼樣子。", "你一邊整理衣物一邊回想剛才的角度，想看照片又不願顯得太急切。", "你輕輕吐了口氣，重新站穩，對自己竟然完成了這組拍攝有些意外。"],
            eager: ["你從容地調整站姿，最後看了一眼燈光與鏡頭的位置，對自己的表現心中有數。", "你自然地收起動作，抬頭觀察攝影師查看照片時的表情，等待他給出評價。", "你舒展肩膀，慢慢走離取景位置，心裡已在比較哪個角度拍得最好。"]
        };
        const performance = [
            ["剛才幾次跟不上指示，讓你忍不住懷疑自己是否把簡單的事弄得太難。", "想到那些不得不重拍的瞬間，你有點懊惱，卻也慶幸總算完成。", "你回想剛才不太穩定的動作，決定至少別再讓攝影師看出自己的窘迫。"],
            ["雖然過程並不完美，你還是逐漸抓到了拍攝節奏，心情稍稍安定。", "你不確定照片是否出色，但至少沒有辜負自己花下去的力氣。", "有些姿勢比想像中難維持，所幸你還是把約定的部分做完了。"],
            ["你想起幾個配合得恰到好處的角度，對成品多了幾分期待。", "攝影師剛才幾次迅速按下快門，讓你覺得自己的表現或許真的不錯。", "你察覺自己已經能跟上指示，不再像最初那樣只顧著緊張。"],
            ["你幾乎能預想哪些照片會被留下，這份掌握感讓你暗自高興。", "剛才幾個動作都完成得很順利，你對這組作品頗有信心。", "你對自己在鏡頭前的表現相當滿意，甚至有點想立刻看看成果。"]
        ];
        const phaseThought = [
            ["這畢竟只是第一組，你希望接下來能更自在些。", "至少已經知道攝影師會怎麼指導，下一組應該不會那麼陌生。", "你開始明白，拍照不只是站著不動那麼簡單。"],
            ["更大膽的姿勢比想像中費力，你開始衡量下一組是否值得。", "這組的動作讓你重新意識到自己正被仔細打量。", "你發現鏡頭前的從容需要練習，並非只靠膽量就夠。"],
            ["攝影師幾次刻意停留的取景仍讓你有些在意，並不全是拍攝本身的問題。", "你想起他反覆調整同一個角度的舉動，心裡悄悄多留了一分警覺。", "你不確定他是否真的只在研究構圖，但至少下一步該由你自己決定。"],
            ["即使這組已經完成，你仍清楚記得他幾次不太自然的停頓。", "你不想讓最後幾次可疑的取景蓋過自己付出的努力，但也不打算假裝沒察覺。", "鏡頭終於移開，你才有空想清楚：拍得好，不代表攝影師的每個要求都合理。"]
        ];
        return {
            action: pick(motion[phase], 0) + (phase >= 2 ? pick(moodMotion[mood], 1) : ""),
            thought: pick(performance[tier], 2) + pick(phaseThought[phase], 3)
        };
    };
    // 每次建立事件就抽好各階段鏡位；存於事件狀態，避免重繪改變內容。
    // 第二、第三鏡位通常使用不同焦點，允許少量重拍。
    HM.photographerRollFocusPlans = function () {
        const pools = [["full","face","waist","legs"],["full","waist","legs","hips"],
            ["chest","waist","hips","legs","feet"],["chest","hips","legs","feet","waist"]];
        return pools.map((pool, phase) => {
            const first = pool[rand(0, pool.length - 1)];
            const second = pool[rand(0, pool.length - 1)];
            const remaining = pool.filter(f => f !== second);
            const third = rand(0, 7) === 0 ? second : remaining[rand(0, remaining.length - 1)];
            return [first, second, third];
        });
    };
    // 攝影師異常取景控制：只決定劇情與姿勢意圖，不介入 Pose 的求解器。
    // 門檻採原版 hasSexStat 等級，避免直接假設 $exhibitionism 的數值範圍。
    HM.photographerCameraReaction = function (e, index) {
        const phase = Number(e.phase);
        if (phase !== 2 && phase !== 3) return null;
        const min = phase === 2 ? 3 : 5;
        const gap = !hasSexStat("exhibitionism", min) ? -1
            : hasSexStat("exhibitionism", min + 3) ? 3
            : hasSexStat("exhibitionism", min + 2) ? 2
            : hasSexStat("exhibitionism", min + 1) ? 1 : 0;
        // 同一鏡位的資料完全由既有群組決定，重繪時不重新抽選。
        const targets = phase === 2 ? ["chest", "waist", "hips", "legs", "feet"] : ["chest", "hips", "legs", "feet", "waist"];
        const group = Number(e.groups?.[phase]) || 0;
        const focus = e.photoFocusPlans?.[phase]?.[index] || targets[(group + index) % targets.length];
        // 第一鏡位保留專業表象；後兩鏡位開始反覆停留，末鏡位尤為明顯。
        const attention = index === 0 ? "subtle" : index === 1 ? "lingering" : "repeated";
        const reaction = gap <= 0 ? "guarded" : gap === 1 ? "hesitant" : gap === 2 ? "confident" : "playful";
        return { phase, index, focus, attention, reaction, gap,
            variant: e.photoReactionVariants?.[phase]?.[index] ?? ((group * 3 + index + phase) % 3) };
    };
    // 每次接受提議時執行一次，絕不在 Twee 顯示階段改動數值。
    HM.photographerApplyOfferMood = function (mood) {
        const effects = {
            reluctant: "<<stress 2>>",
            curious: "<<stress 1>><<arousal 100>>",
            eager: "<<stress -1>><<arousal 200>>"
        };
        if (effects[mood]) Wikifier.wikifyEval(effects[mood]);
    };
    // 結算狀態：按實際完成度及進入該組時的心理狀態計算，僅在領款時執行一次。
    // 保持對原版數值的操作集中於 JS；Twee 僅呈現已記錄的結算結果。
    HM.photographerSettlement = function (e, phase, amount) {
        const tier = Math.max(0, Math.min(3, Number(e.performance?.[phase]?.tier) || 0));
        const mood = phase >= 2 ? (e.offerMood || "reluctant") : "ordinary";
        const stressByTier = [2, 1, -1, -2];
        let stress = stressByTier[tier];
        let arousal = 0;
        if (phase >= 2) {
            if (mood === "reluctant") stress += 1;
            if (mood === "curious" && tier >= 2) arousal = 50;
            if (mood === "eager" && tier >= 2) arousal = 100;
            // 高暴露能力代表拍攝自在，不等於對攝影師越界行為毫無戒心。
            if (phase === 3 && mood === "reluctant") stress += 1;
        }
        const commands = [];
        if (stress) commands.push(`<<stress ${stress}>>`);
        if (arousal) commands.push(`<<arousal ${arousal}>>`);
        if (commands.length) Wikifier.wikifyEval(commands.join(""));
        return { phase, tier, mood, amount, stress, arousal };
    };
    // 攝影師延伸事件：追逐由市場事件自行管理，不使用原版 stalk 的善意／路過分支。
    HM.photographerFollowChance = function (e) {
        const V = State.variables;
        const hour = Number(V.hour ?? 12);
        const time = hour >= 22 || hour < 5 ? 20 : hour >= 19 ? 12 : hour >= 16 ? 6 : 0;
        // 原版 allure 上限約 16000；不重複計算服裝、外貌。
        const allure = Math.max(0, Math.min(16000, Number(V.allure) || 0));
        const attraction = allure < 3200 ? 0 : allure < 6400 ? 5 : allure < 9600 ? 10 : allure < 12800 ? 17 : 25;
        const behaviour = e.photoOutcome === "escaped" && e.escapeMood === "blocked" ? 8 : 0;
        return Math.min(60, 8 + time + attraction + behaviour);
    };
    // 由 alley_photographer.resolve("return_depart") 呼叫；只處理一次離場判定。
    HM.photographerResolveReturnDeparture = function (e) {
        if (!e || e.photoFollowChecked || !["escaped", "complete"].includes(e.photoOutcome)) return false;
        e.photoFollowChecked = true;
        e.photoFollowChance = HM.photographerFollowChance(e);
        e.photoFollowTriggered = HM.rollChance(e.photoFollowChance);
        if (!e.photoFollowTriggered) { e.stage = "return_safe"; return true; }
        // 拍攝已結算，但整個事件仍在進行；僅切換 stage，不提前寫入 result。
        e.photoFollowOriginalResult = e.photoOutcome;
        e.stage = "follow_intro";
        e.photoFollowVariant = rand(0, 2);
        HM.photographerNameNPC("可疑的攝影師");
        return true;
    };
    HM.photographerNameNPC = function (name) {
        const npc = State.variables.NPCList?.[0];
        if (!npc) return;
        npc.fullDescription = name;
        npc.fullDescription_CN = name;
    };
    // 追逐由共用引擎管理；結局交由註冊事件的 resolve() 處理。
    HM.registerMarketEncounter("alley_photographer", {
        weight: 10,
        npc: 1,
        output: "HonestMarketsEncounterPhotographer",
        resultOutput: "HonestMarketsEncounterPhotographerResult",
        eligible() { return true; },
        create(e) {
            e.stage = "invitation";
            e.phase = HM.photographerFirstPhase();
            e.photoStartPhase = e.phase;
            e.groups = HM.PHOTOGRAPHER_GROUPS.map(groups => rand(0, groups.length - 1));
            e.photoFocusPlans = HM.photographerRollFocusPlans();
            // 事件建立時鎖定反應、成果與收尾變體，重繪保持一致。
            e.photoReactionVariants = [0,1,2,3].map(() => [rand(0,2),rand(0,2),rand(0,2)]);
            e.photoReviewVariants = [0,1,2,3].map(() => rand(0,2));
            e.photoEndingVariants = [0,1,2,3].map(() => [rand(0,2),rand(0,2),rand(0,2),rand(0,2)]);
            e.photoPoseCache = {};
            e.performance = [0,1,2,3].map(i => HM.photographerPerformance(i));
            e.paid = [false,false,false,false];
            e.payments = [0,0,0,0];
            e.settlements = [null,null,null,null];
            e.lastSettlement = null;
            e.basePay = [75,125,200,300].map(n => n + rand(0, Math.floor(n / 3)));
            e.photoOuterDone = false;
            e.photoUnderwearDone = false;
            e.photoRemoved = false;
            e.photoRestored = false;
            e.photoFollowChecked = false;
            e.photoOutcome = null;
        },
        resolve(e, action) {
            if (action === "return_depart") return HM.photographerResolveReturnDeparture(e);
            if (action === "follow_begin" && e.stage === "follow_intro") { e.stage = "follow_chase"; HM.chase.create(e, {pursuerName:"攝影師", title:"巷道追逐", stage:"follow_chase", onEscape:"follow_escape", onCaught:"follow_caught", actions:[{
                id:"call_help",name:"大聲呼救",apCost:10,playerRole:"runner",
                message:"你朝巷道外大聲呼救，希望有人聽見。",
                effects:[{type:"chance",outcomes:[
                    {weight:50,message:"你的呼救聲在巷道間迴盪，卻沒有得到回應。"},
                    {weight:30,message:"附近有人探頭查看，攝影師遲疑了一下。",effects:[{type:"stun",target:"npc",turns:1}]},
                    // 路人介入只阻止追兵兩次行動；逃脫仍須由玩家跑出追逐距離。
                    // 呼救當回合即消耗第一次暫停，玩家下一回合行動後再消耗第二次。
                    {weight:20,message:"幾名路人循聲趕來，其中一人上前攔住攝影師，質問他為什麼追著你不放。攝影師被迫停下腳步，一時無法繼續追趕。",effects:[{type:"stun",target:"npc",turns:2}]}
                ]}]
            }]}); return true; }
            if (action === "follow_escape" && e.stage === "follow_chase") { e.stage = "follow_escaped"; return true; }
            if (action === "follow_caught" && e.stage === "follow_chase") {
                e.stage = "follow_caught";
                e.photoFollowCaughtVariant = rand(0, 2);
                HM.photographerNameNPC("變態攝影師");
                return true;
            }
            if (action === "follow_escape_finish" && e.stage === "follow_escaped") { e.stage = "done"; e.result = "escaped"; return true; }
            if (action === "return_finish" && e.stage === "return_safe") { e.stage = "done"; e.result = e.photoOutcome; return true; }
            if (action === "follow_combat" && e.stage === "follow_caught") { e.stage = "follow_combat"; return true; }
            if (action === "follow_combat_finish" && e.stage === "follow_combat") { e.stage = "done"; e.result = "combat"; return true; }
            if (action === "decline" && e.stage === "invitation") { e.stage = "done"; e.photoOutcome = "declined"; e.result = "declined"; return true; }
            if (action === "accept" && e.stage === "invitation") {
                if (e.phase >= 2) return HM.photographerEnterPhase(e, e.phase);
                e.stage = "shoot"; return true;
            }
            if (action === "escape" && e.stage === "offer") {
                e.photoEscapeWithClothes = !!e.photoRemoved && !e.photoRestored;
                // 先記錄離場時的階段與心理；Twee 顯示時不再讀取可能變動的暴露值。
                e.escapeMood = e.offerMood || "ordinary";
                e.completedCount = e.paid.filter(Boolean).length;
                if (!HM.photographerRestoreClothing(e)) return false;
                e.stage = "photo_final"; e.photoOutcome = "escaped"; return true;
            }
            if (action === "continue" && e.stage === "offer") {
                return HM.photographerEnterPhase(e, e.phase);
            }
            if (action === "finish" && e.stage === "shoot" && e.phase >= 0 && e.phase < 4 && !e.paid[e.phase]) {
                const phase = e.phase;
                const rate = [.65,.85,1,1.3][e.performance[phase].tier];
                const amount = Math.max(1, Math.round(e.basePay[phase] * rate));
                Wikifier.wikifyEval(`<<money ${amount * 100}>>`);
                e.paid[phase] = true;
                e.payments[phase] = amount;
                e.lastSettlement = HM.photographerSettlement(e, phase, amount);
                e.settlements[phase] = e.lastSettlement;
                if (phase === 3) {
                    if (!HM.photographerRestoreClothing(e)) { e.stage = "done"; e.photoOutcome = "restore_failed"; e.result = "restore_failed"; return true; }
                    e.stage = "photo_final"; e.photoOutcome = "complete";
                }
                else { e.phase = HM.photographerNextPhase(phase); e.stage = "offer"; }
                return true;
            }
            return false;
        }
    });

    HM.marketEncounterLabels = {
        hidden_couple:"貨堆後的動靜", underwear_collector:"識貨的收藏家", alley_photographer:"可疑的攝影師", found_money:"撿到零錢", pickpocket:"扒手", market_ambush:"三人騷擾", crowd_grope:"性騷擾", suspicious_clothier:"不懷好意的小販", temporary_model:"臨時服裝模特兒", flash_sale:"臨時特價",
        market_rumor:"市場情報", short_measure:"缺斤少兩", hot_item:"搶手商品", lost_property:"遺失物",
        mistaken_regular:"認錯熟客", pushy_vendor:"推銷討價", vendor_gift:"攤販贈品",
        dropped_goods:"商品摔落", queue_jumper:"插隊爭執", market_argument:"市場爭吵", beggar:"討錢者",
        street_performer:"街頭藝人", street_masseur:"街頭按摩師", directions:"陌生人問路", sleeping_vendor:"商販打瞌睡", suspicious_goods:"可疑商品", carry_goods:"搬貨請求"
    };

    HM.forceSelectedMarketEncounter = function () {
        const select = document.querySelector(".hm-encounter-debug-select");
        const id = select?.value;
        if (!id) return false;
        HM.clearMarketEncounter();
        return !!HM.rollMarketEncounter("debug", id, typeof passage === "function" ? passage() : "HonestMarkets Products");
    };

    HM.marketEncounterDebugControls = function () {
        if (State.variables.debug !== 1) return "";
        const debugTarget = HM.getMarketEncounter()?.targetPassage || (typeof passage === "function" ? passage() : "HonestMarkets Products");
        const available = new Set(HM.marketEncounterCandidates(debugTarget).map(e => e.id));
        const options = Object.values(HM.MARKET_ENCOUNTERS).map(def => {
            const label = HM.marketEncounterLabels[def.id] || def.id;
            const suffix = available.has(def.id) ? "" : "（目前條件不符）";
            return `<option value="${def.id}"${available.has(def.id) ? "" : " disabled"}>${label}${suffix}</option>`;
        }).join("");
        const timeInfo = HM.getMarketEncounterTimeInfo();
        const chance = timeInfo.key === "closed" ? 0 : Math.max(HM.MARKET_ENCOUNTER_CHANCE, timeInfo.chance);
        const weights = HM.marketEncounterCandidates(debugTarget).map(def =>
            `${HM.marketEncounterLabels[def.id] || def.id}：${def.weight} → ${HM.marketEncounterWeight(def, timeInfo).toFixed(1)}`
        ).join("<br>");
        return `<div class="honest-markets-encounter-debug"><b>市場遭遇 Debug</b><br>` +
            `目前時段：${timeInfo.name}（${timeInfo.key}）　觸發率：${chance}%　目前事件：${HM.getMarketEncounter()?.id || "無"}<br>` +
            `<mouse class="tooltip linkBlue">[時段權重]<span class="black">${weights || "目前沒有可用事件"}</span></mouse><br>` +
            `強制觸發：<select class="hm-encounter-debug-select">${options}</select> ` +
            `<<link "觸發" ${JSON.stringify(debugTarget)}>><<run setup.HonestMarkets.forceSelectedMarketEncounter()>><</link>></div><br>`;
    };

    /*
     * 每個事件各註冊一個 Maplebirch gate。gate 不負責抽事件，只在市場頁面確認
     * pending encounter 是否為自己的 ID；命中後以 forceExit 取代原市場正文顯示事件 widget。
     */
    HM.registerMarketEncounterStateEvents = function () {
        if (HM._marketEncounterStateEventsRegistered) return true;
        if (!window.maplebirch?.dynamic?.regStateEvent) return false;

        const passages = ["HonestMarkets Products", "HonestMarkets Category", "HonestMarkets Seeds", "HonestMarkets Clothing"];
        for (const def of Object.values(HM.MARKET_ENCOUNTERS)) {
            const ok = maplebirch.dynamic.regStateEvent("gate", `HonestMarkets:encounter:${def.id}`, {
                output: def.output,
                cond: () => {
                    const encounter = HM.getMarketEncounter();
                    if (encounter?.id !== def.id) return false;
                    const current = typeof passage === "function" ? passage() : "";
                    const target = encounter.targetPassage;
                    if (!target) return true;
                    if (target === "HonestMarkets Products") return current === "HonestMarkets Products" || current === "HonestMarkets Category";
                    return current === target;
                },
                forceExit: true,
                priority: 50,
                extra: { passage: passages }
            });
            if (!ok) return false;
        }
        HM._marketEncounterStateEventsRegistered = true;
        return true;
    };


    /*
     * Maplebirch 狀態事件在腳本載入時註冊。若框架尚未完成初始化，
     * 則延後到首次 passageinit 再嘗試一次。
     */
    if (!HM.registerMarketEncounterStateEvents()) {
        $(document).one(":passageinit.honestMarketsEncounterStateEvents", () => HM.registerMarketEncounterStateEvents());
    }

    Macro.add("honestMarketsEncounterDebug", {
        handler() { new Wikifier(this.output, HM.marketEncounterDebug()); }
    });
    Macro.add("honestMarketsEncounterDebugControls", {
        handler() { new Wikifier(this.output, HM.marketEncounterDebugControls()); }
    });
    Macro.add("honestMarketsEncounter", {
        handler() { new Wikifier(this.output, HM.renderMarketEncounter(false)); }
    });
    Macro.add("honestMarketsEncounterResult", {
        handler() { new Wikifier(this.output, HM.renderMarketEncounter(true)); }
    });
})();
