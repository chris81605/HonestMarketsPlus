(function () {
    "use strict";

    const HM = setup.HonestMarkets = setup.HonestMarkets || {};

    // 共用百分比骰值；測試旗標僅用於機率判定，不影響商品或 NPC 抽樣。
    // 正常擲出 1～100；測試時固定 100，並以高骰值表示成功。
    HM.forceRng ??= false;
    HM.rollRng = function () {
        HM.rng = HM.forceRng === true ? 100 : Math.floor(Math.random() * 100) + 1;
        return HM.rng;
    };
    HM.rollChance = function (chance) {
        const rate = Math.max(0, Math.min(100, Number(chance) || 0));
        return HM.rollRng() > 100 - rate;
    };


    HM.config = Object.assign({
        minShown: 6,      // 每個商品分類預設最少顯示數量
        maxShown: 8,      // 每個商品分類預設最多顯示數量
        maxLot: 240,      // 單批商品預設最大數量
        shownMinLimit: 5, // 商品顯示數量設定的安全下限
        shownMaxLimit: 20,// 商品顯示數量設定的安全上限
        maxLotMin: 50,    // 最大批次設定的安全下限
        maxLotMax: 2500,  // 最大批次設定的安全上限
        priceMultiplier: 1,    // 全局 foodstuff 商品價值倍率預設值
        priceMultiplierMin: 1, // 商品價值倍率安全下限
        priceMultiplierMax: 50 // 商品價值倍率安全上限
    }, HM.config || {});

    /*
     * ==================== 玩家市場設定 ====================
     *
     * Options 介面只負責方便調整，不能視為資料安全邊界。
     * 玩家仍可能透過控制台、舊存檔或其他 Mod 寫入負數、極大值、NaN、Infinity 或字串。
     * 因此所有設定在「寫入」與「市場真正使用」時都會再次正規化。
     *
     * 一般商品數量：5～20，預設 6～8。
     * 最大批次 maxLot：50～2500，預設 240。
     * 這些值只在 beginVisit() 建立新市場時鎖入 visit；修改 Options 不會改動已生成市場。
     */
    HM.clampInteger = function (value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, Math.round(n)));
    };

    HM.getMarketSettings = function () {
        const V = State.variables;
        const minLimit = HM.config.shownMinLimit;
        const maxLimit = HM.config.shownMaxLimit;
        let minShown = HM.clampInteger(V.honestMarketsMinShown, minLimit, maxLimit, HM.config.minShown);
        let maxShown = HM.clampInteger(V.honestMarketsMaxShown, minLimit, maxLimit, HM.config.maxShown);

        // 被外部手段寫成「下限 > 上限」時交換兩值，核心生成端永遠只接收合法區間。
        if (minShown > maxShown) [minShown, maxShown] = [maxShown, minShown];

        return {
            minShown,
            maxShown,
            maxLot: HM.clampInteger(
                V.honestMarketsMaxLot,
                HM.config.maxLotMin,
                HM.config.maxLotMax,
                HM.config.maxLot
            )
        };
    };

    HM.setMarketSetting = function (key, value) {
        const V = State.variables;
        const current = HM.getMarketSettings();

        if (key === "minShown") {
            const next = HM.clampInteger(value, HM.config.shownMinLimit, HM.config.shownMaxLimit, HM.config.minShown);
            V.honestMarketsMinShown = Math.min(next, current.maxShown);
        } else if (key === "maxShown") {
            const next = HM.clampInteger(value, HM.config.shownMinLimit, HM.config.shownMaxLimit, HM.config.maxShown);
            V.honestMarketsMaxShown = Math.max(next, current.minShown);
        } else if (key === "maxLot") {
            V.honestMarketsMaxLot = HM.clampInteger(value, HM.config.maxLotMin, HM.config.maxLotMax, HM.config.maxLot);
        }
        return HM.getMarketSettings();
    };

    HM.resetMarketSettings = function () {
        const V = State.variables;
        V.honestMarketsMinShown = HM.config.minShown;
        V.honestMarketsMaxShown = HM.config.maxShown;
        V.honestMarketsMaxLot = HM.config.maxLot;
        return HM.getMarketSettings();
    };

    // maxLot 滑塊採兩段式映射：前半 50～500、後半 500～2500，讓預設 240 附近仍有足夠操作精度。
    HM.maxLotToSlider = function (value) {
        const v = HM.clampInteger(value, HM.config.maxLotMin, HM.config.maxLotMax, HM.config.maxLot);
        if (v <= 500) return Math.round((v - 50) / 450 * 500);
        return Math.round(500 + (v - 500) / 2000 * 500);
    };

    HM.sliderToMaxLot = function (position) {
        const p = HM.clampInteger(position, 0, 1000, HM.maxLotToSlider(HM.config.maxLot));
        const value = p <= 500
            ? 50 + (p / 500) * 450
            : 500 + ((p - 500) / 500) * 2000;
        return HM.clampInteger(value, HM.config.maxLotMin, HM.config.maxLotMax, HM.config.maxLot);
    };

    /*
     * ==================== 全局 Foodstuff 商品價格引擎 ====================
     *
     * 價格計算固定由不可變的原版 sell_price 快照開始：
     *   原版價格 × 玩家全局倍率 = 真實基礎價格
     *   真實基礎價格 × 供應特性倍率 × 季節倍率 × 每日全局行情 = 當前市場價格
     *
     * setup.foodstuff[*].shop.sell_price 最後只保存「當前市場價格」，讓原版系統與其他
     * 直接讀取 sell_price 的模組共用同一套行情。每日行情本身保存在存檔變數中，
     * 同一遊戲日內重進 passage、調整 Options 或重新套價都不會重新抽取。
     */
    HM.PRICE_MULTIPLIER_STORAGE_KEY = "HonestMarkets.priceMultiplier";
    HM.baseFoodstuffPrices = HM.baseFoodstuffPrices instanceof Map ? HM.baseFoodstuffPrices : new Map();
    /*
     * 商品供應特性集中在這張資料表中。價格引擎只讀取 multiplier；一般玩家提示讀取 marketText。
     * 新增其他稀有、充足或特殊來源商品時，只需擴充資料，不必修改價格計算流程。
     */
        HM.SUPPLY_TRAITS = Object.freeze({
        bottle_of_semen: Object.freeze({
            key: "scarce_source",
            multiplier: 5,
            marketText: "這類商品貨源稀缺"
        }),
        bottle_of_breast_milk: Object.freeze({
            key: "scarce_source",
            multiplier: 5,
            marketText: "這類商品貨源稀缺"
        }),
        baby_bottle_of_breast_milk: Object.freeze({
            key: "scarce_source",
            multiplier: 5,
            marketText: "這類商品貨源稀缺"
        }),
        wild_honeycomb: Object.freeze({
            key: "restricted_source",
            multiplier: 2.5,
            marketText: "這類商品較難取得"
        }),
        oyster_pearl: Object.freeze({
            key: "rare_source",
            multiplier: 1.5,
            marketText: "這類商品產出稀少"
        }),
        truffle: Object.freeze({
            key: "rare_source",
            multiplier: 2,
            marketText: "這類商品較為稀有"
        }),
        blood_lemon: Object.freeze({
            key: "rare_source",
            multiplier: 2,
            marketText: "這類商品較為稀有"
        }),
                ghostshroom: Object.freeze({
            key: "unusual_source",
            multiplier: 2,
            marketText: "這類蘑菇並不常見"
        }),
        wolfshroom: Object.freeze({
            key: "unusual_source",
            multiplier: 2,
            marketText: "這類蘑菇並不常見"
        }),
        strange_flower: Object.freeze({
            key: "unusual_source",
            multiplier: 2,
            marketText: "這類花卉很少在一般市場流通"
        }),
                wolfbrew: Object.freeze({
            key: "unusual_source",
            multiplier: 3,
            marketText: "這類特殊釀製品很少在一般市場流通"
        }),
        ghostbrew: Object.freeze({
            key: "unusual_source",
            multiplier: 3,
            marketText: "這類特殊釀製品很少在一般市場流通"
        })
    });

    HM.normalizePriceMultiplier = function (value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return HM.config.priceMultiplier;
        return Math.max(HM.config.priceMultiplierMin, Math.min(HM.config.priceMultiplierMax, Math.round(n)));
    };

    HM.getPriceMultiplier = function () {
        try {
            const stored = localStorage.getItem(HM.PRICE_MULTIPLIER_STORAGE_KEY);
            return HM.normalizePriceMultiplier(stored === null ? HM.config.priceMultiplier : stored);
        } catch (_) {
            return HM.normalizePriceMultiplier(HM._priceMultiplierFallback ?? HM.config.priceMultiplier);
        }
    };

    HM.savePriceMultiplier = function (value) {
        const multiplier = HM.normalizePriceMultiplier(value);
        HM._priceMultiplierFallback = multiplier;
        try {
            if (multiplier === HM.config.priceMultiplier) localStorage.removeItem(HM.PRICE_MULTIPLIER_STORAGE_KEY);
            else localStorage.setItem(HM.PRICE_MULTIPLIER_STORAGE_KEY, String(multiplier));
        } catch (_) {
            // localStorage 不可用時，本次 runtime 仍可正常使用。
        }
        return multiplier;
    };

    // 只補抓尚未建立快照的商品；既有快照永不覆寫，避免把已套行情的價格誤當原價。
    HM.captureBaseFoodstuffPrices = function () {
        if (!setup.foodstuff) return 0;
        let captured = 0;
        for (const [id, item] of Object.entries(setup.foodstuff)) {
            if (!item?.shop || HM.baseFoodstuffPrices.has(id)) continue;
            const price = Number(item.shop.sell_price);
            if (!Number.isFinite(price)) continue;
            HM.baseFoodstuffPrices.set(id, price);
            captured++;
        }
        return captured;
    };

    HM.getOriginalSellPrice = function (id) {
        HM.captureBaseFoodstuffPrices();
        const price = Number(HM.baseFoodstuffPrices.get(id));
        return Number.isFinite(price) ? price : null;
    };

    // 玩家設定的倍率先改變整個遊戲世界的長期價格尺度；每日與季節行情都以此為基準。
    HM.getTrueBasePrice = function (id, multiplier = HM.getPriceMultiplier()) {
        const original = HM.getOriginalSellPrice(id);
        if (!Number.isFinite(original)) return null;
        return Math.round(original * HM.normalizePriceMultiplier(multiplier));
    };

    HM.getSupplyTrait = function (id) {
        const trait = HM.SUPPLY_TRAITS[id];
        if (!trait) return null;
        return {
            key: String(trait.key || "special"),
            multiplier: Number(trait.multiplier) > 0 ? Number(trait.multiplier) : 1,
            marketText: String(trait.marketText || "").trim()
        };
    };

    HM.getSupplyTraitMultiplier = function (id) {
        return HM.getSupplyTrait(id)?.multiplier ?? 1;
    };

    HM.getSeasonPriceInfo = function (id) {
        const seasons = setup.foodstuff?.[id]?.tending?.seasons;
        if (!Array.isArray(seasons) || seasons.length === 0) {
            return { restricted: false, yearRound: false, inSeason: null, multiplier: 1, seasons: [] };
        }

        // 四季全部存在時等同全年供應，不應顯示成「正值產季」。
        // 使用實際季節名稱判斷，避免其他 Mod 補資料時因陣列長度或重複值造成誤判。
        const allSeasons = ["spring", "summer", "autumn", "winter"];
        const yearRound = allSeasons.every(season => seasons.includes(season));
        if (yearRound) {
            return { restricted: false, yearRound: true, inSeason: null, multiplier: 1, seasons: seasons.slice() };
        }

        const currentSeason = typeof Time !== "undefined" ? Time.season : null;
        const inSeason = currentSeason != null && seasons.includes(currentSeason);
        return { restricted: true, yearRound: false, inSeason, multiplier: inSeason ? 1 : 2, seasons: seasons.slice() };
    };

    HM.currentPriceDay = function () {
        const day = typeof Time !== "undefined" ? Number(Time.days) : NaN;
        return Number.isFinite(day) ? day : 0;
    };

    /*
     * 每項商品每天各自鎖定一個全局行情：90% 為一般 ±5%，5% 暴漲，5% 暴跌。
     * 這一層描述「今天這種商品整體值多少」，與 HonestMarkets 每批商品自己的攤販
     * 行情修正互相獨立。
     */
    HM.rollDailyPriceMultiplier = function () {
        const roll = Math.random();
        if (roll < 0.05) return { multiplier: HM.randomFloat(1.30, 1.75), state: "surge" };
        if (roll < 0.10) return { multiplier: HM.randomFloat(0.55, 0.80), state: "crash" };
        const multiplier = HM.randomFloat(0.95, 1.05);
        return { multiplier, state: multiplier > 1 ? "high" : multiplier < 1 ? "low" : "normal" };
    };

    HM.rollDailyPriceFluctuations = function () {
        const V = State.variables;
        const multipliers = {};
        for (const [id, item] of Object.entries(setup.foodstuff ?? {})) {
            if (!item?.shop || !Number.isFinite(Number(item.shop.sell_price))) continue;
            multipliers[id] = HM.rollDailyPriceMultiplier();
        }
        V.honestMarketsDailyPrices = { day: HM.currentPriceDay(), multipliers };
        HM.applyGlobalFoodstuffPrices(HM.getPriceMultiplier());
        return V.honestMarketsDailyPrices;
    };

    // 初始化時只在當日尚無行情資料時建立一次；正常跨日刷新由 Maplebirch onDay 事件負責。
    HM.ensureDailyPriceFluctuations = function () {
        const state = State.variables.honestMarketsDailyPrices;
        if (state && state.day === HM.currentPriceDay() && state.multipliers && typeof state.multipliers === "object") {
            return state;
        }
        return HM.rollDailyPriceFluctuations();
    };

    HM.getDailyPriceInfo = function (id) {
        const state = State.variables.honestMarketsDailyPrices;
        const info = state?.multipliers?.[id];
        if (info && Number.isFinite(Number(info.multiplier))) {
            return { multiplier: Number(info.multiplier), state: info.state || "normal" };
        }
        return { multiplier: 1, state: "normal" };
    };

    HM.getPriceBreakdown = function (id) {
        const original = HM.getOriginalSellPrice(id);
        if (!Number.isFinite(original)) return null;
        const manualMultiplier = HM.getPriceMultiplier();
        const trueBasePrice = Math.round(original * manualMultiplier);
        const supplyTrait = HM.getSupplyTrait(id);
        const supplyTraitMultiplier = supplyTrait?.multiplier ?? 1;
        const season = HM.getSeasonPriceInfo(id);
        const daily = HM.getDailyPriceInfo(id);
        const marketBaselinePrice = Math.max(0, Math.round(
            trueBasePrice * supplyTraitMultiplier * season.multiplier
        ));
        const currentMarketPrice = Math.max(0, Math.round(
            trueBasePrice * supplyTraitMultiplier * season.multiplier * daily.multiplier
        ));
        const marketRatio = marketBaselinePrice > 0 ? currentMarketPrice / marketBaselinePrice : 1;
        return {
            original,
            manualMultiplier,
            trueBasePrice,
            supplyTrait,
            supplyTraitMultiplier,
            season,
            daily,
            marketBaselinePrice,
            currentMarketPrice,
            marketRatio
        };
    };

    /*
     * 重新套價是純計算，不產生新的每日行情。Options 改倍率時只會改變真實基礎價格，
     * 並沿用當日已鎖定的季節與每日行情結果。
     */
    HM.applyGlobalFoodstuffPrices = function (value = HM.getPriceMultiplier()) {
        const multiplier = HM.savePriceMultiplier(value);
        HM.captureBaseFoodstuffPrices();

        for (const [id, item] of Object.entries(setup.foodstuff ?? {})) {
            if (!item?.shop) continue;
            const original = HM.baseFoodstuffPrices.get(id);
            if (!Number.isFinite(original)) continue;
            const trueBasePrice = Math.round(original * multiplier);
            const supplyTraitMultiplier = HM.getSupplyTraitMultiplier(id);
            const seasonMultiplier = HM.getSeasonPriceInfo(id).multiplier;
            const dailyMultiplier = HM.getDailyPriceInfo(id).multiplier;
            item.shop.sell_price = Math.max(0, Math.round(
                trueBasePrice * supplyTraitMultiplier * seasonMultiplier * dailyMultiplier
            ));
        }

        HM.theftPriceDistribution = null;
        HM._foodstuffPriceMultiplierApplied = multiplier;
        return multiplier;
    };

    // 市場交易與其他呼叫端共用此價格查詢介面。
    HM.applyFoodstuffPriceMultiplier = HM.applyGlobalFoodstuffPrices;

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const shuffle = array => {
        const a = array.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = rand(0, i);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    HM.moneyText = cents => `£${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;


    HM.marketMinutes = function () {
        if (typeof Time === "undefined") return null;
        const hour = Number(Time.hour);
        const minute = Number(Time.minute) || 0;
        if (!Number.isFinite(hour)) return null;
        return hour * 60 + minute;
    };

    // 官方市集正常營業時間為 07:00～20:59；其餘時段只保留場景敘述。
    HM.getMarketTimeState = function () {
        const minutes = HM.marketMinutes();
        if (minutes === null) return "open";
        if (minutes >= 360 && minutes < 420) return "preparing";
        if (minutes >= 420 && minutes < 1260) return "open";
        if (minutes >= 1260 && minutes < 1320) return "closing";
        return "closed";
    };

    HM.isMarketOpen = () => HM.getMarketTimeState() === "open";

    HM.marketDay = function () {
        if (typeof Time !== "undefined" && Number.isFinite(Number(Time.days))) return Number(Time.days);
        return null;
    };

    HM.isBannedToday = function () {
        const day = HM.marketDay();
        return day !== null && Number(State.variables.honestMarketsBannedDay) === day;
    };

    HM.canUseMarket = () => HM.isMarketOpen() && !HM.isBannedToday();

    HM.marketBanText = function () {
        return "你才剛靠近攤位，幾名攤販便認出了你。看來今天沒有人願意再和你做生意了。";
    };

    HM.advanceMinutes = function (minutes) {
        const amount = Math.max(0, Math.floor(Number(minutes) || 0));
        if (amount > 0) Wikifier.wikifyEval(`<<pass ${amount}>>`);
    };

    HM.marketClosedText = function () {
        switch (HM.getMarketTimeState()) {
            case "preparing":
                return "天色漸亮，攤販們正陸續準備今天的生意，市場還沒有正式開放。";
            case "closing":
                return "攤販們已經開始收拾剩餘的商品，今天的市場營業結束了。";
            case "closed":
                return "市場已經打烊，白天熱鬧的攤位如今只剩下一片寂靜。";
            default:
                return "";
        }
    };

    HM.canExploreMore = function () {
        const minutes = HM.marketMinutes();
        if (!HM.canUseMarket()) return false;
        if (minutes === null) return true;
        return minutes + 30 < 1260;
    };

    HM.isMarketFood = item => !!(
        item && item.shop && Number.isFinite(Number(item.shop.sell_price)) &&
        Number(item.shop.sell_price) > 0
    );

    HM.getCatalog = function () {
        if (!setup.foodstuff) return [];
        return Object.entries(setup.foodstuff)
            .filter(([, item]) => HM.isMarketFood(item))
            .map(([id, item]) => ({ id, item }));
    };

    HM.categoryKey = item => item.category || "other";
    HM.categoryName = function (item, key) {
        return item.category_cn || item.category_name || key || "其他";
    };

    HM.getCategories = function () {
        const map = new Map();
        HM.getCatalog().forEach(({ id, item }) => {
            const key = HM.categoryKey(item);
            if (!map.has(key)) map.set(key, { key, name: HM.categoryName(item, key), ids: [] });
            map.get(key).ids.push(id);
        });
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant-TW"));
    };

    /*
     * ==================== 一般商品批次與報價 ====================
     *
     * DoL 的 shop.sell_price 使用「便士」作為內部單位：100 = £1。
     * 這個值是玩家正常擺攤出售商品時的基準價，不是商店成本。
     * HonestMarkets 因此直接以 sell_price 作為進貨行情基準，再依批次大小乘上不同倍率。
     *
     * 批次越大，倍率區間越低：
     *   零散     1.20～1.60 × sell_price
     *   小批     0.95～1.20 × sell_price
     *   中批     0.75～1.00 × sell_price
     *   大批     0.55～0.80 × sell_price
     *   清倉     0.35～0.60 × sell_price
     *
     * 這裡只定義「價格倍率」；實際數量範圍由 getLotTypes() 依 maxLot 動態建立。
     */
    HM.lotTypes = [
        { key: "loose",     name: "零散", markupMin: 1.20, markupMax: 1.60 },
        { key: "small",     name: "小批", markupMin: 0.95, markupMax: 1.20 },
        { key: "medium",    name: "中批", markupMin: 0.75, markupMax: 1.00 },
        { key: "large",     name: "大批", markupMin: 0.55, markupMax: 0.80 },
        { key: "clearance", name: "清倉", markupMin: 0.35, markupMax: 0.60 }
    ];

    /*
     * 由 maxLot 建立五種批次的數量範圍。
     *
     * 零散與小批固定為 1～4、5～9，避免 maxLot 改動後連小額供貨的語意也一起漂移。
     * 剩餘區間以 maxLot 的 30% / 65% 作為中批與大批分界：
     *   medium = 10 ～ floor(maxLot × 0.30)
     *   large  = mediumMax + 1 ～ floor(maxLot × 0.65)
     *   clearance = largeMax + 1 ～ maxLot
     *
     * 例如 maxLot = 240：1～4 / 5～9 / 10～72 / 73～156 / 157～240。
     * 若 maxLot 太小而使某區間無法成立，最後的 filter 會直接略過該批次。
     */
    HM.getLotTypes = function (maxLot = HM.getMarketSettings().maxLot) {
        // 即使呼叫端直接傳入異常值，批次生成仍強制限制在玩家設定允許的安全範圍。
        const max = HM.clampInteger(maxLot, HM.config.maxLotMin, HM.config.maxLotMax, HM.config.maxLot);
        const mediumMax = Math.max(10, Math.floor(max * 0.30));
        const largeMax = Math.max(mediumMax + 1, Math.floor(max * 0.65));
        const ranges = [
            [1, 4],
            [5, 9],
            [10, mediumMax],
            [mediumMax + 1, largeMax],
            [largeMax + 1, max]
        ];

        return HM.lotTypes.map((type, index) => ({
            ...type,
            min: ranges[index][0],
            max: Math.min(ranges[index][1], max),
            weightIndex: index
        })).filter(type => type.min <= type.max);
    };

    /*
     * 商品單價只影響「抽到哪種批次」的權重，不直接決定數量。
     * 陣列順序固定對應：零散 / 小批 / 中批 / 大批 / 清倉。
     *
     * sell 同樣是便士：100 = £1、500 = £5、1500 = £15。
     * 價格越高，權重越偏向小批；價格越低，才較常生成大批或清倉，
     * 避免高價商品一次生成數百個，同時保留低價商品大量進貨轉售的玩法。
     */
    HM.lotWeights = function (sell) {
        if (sell <= 100)  return [15, 25, 30, 20, 10];
        if (sell <= 500)  return [20, 30, 30, 15, 5];
        if (sell <= 1500) return [30, 35, 25, 9, 1];
        return [50, 35, 13, 2, 0];
    };

    HM.pickWeightedIndex = function (weights) {
        const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
        if (total <= 0) return 0;
        let roll = Math.random() * total;
        for (let i = 0; i < weights.length; i++) {
            roll -= Math.max(0, weights[i]);
            if (roll < 0) return i;
        }
        return weights.length - 1;
    };

    HM.randomFloat = function (min, max) {
        return min + Math.random() * (max - min);
    };

    HM.makeOffer = function (id, maxLot = HM.getMarketSettings().maxLot) {
        const item = setup.foodstuff[id];
        const sell = Math.max(1, Math.round(Number(item.shop.sell_price) || 1));
        const nativeBulk = Math.max(1, Math.floor(Number(item.shop.bought_in_bulk) || 1));

        const weights = HM.lotWeights(sell);
        const lotTypes = HM.getLotTypes(maxLot);
        const lotType = lotTypes[HM.pickWeightedIndex(lotTypes.map(type => weights[type.weightIndex]))];

        // 數量先受批次 min/max 限制，再盡量對齊原生 bought_in_bulk。
        // 例如批次 10～72、bought_in_bulk = 6，實際候選會是 12、18……72。
        // 若整個區間找不到任何合法倍數，才退回 step = 1，確保一定能生成有效數量。
        let minQty = lotType.min;
        let maxQty = lotType.max;
        let step = nativeBulk;

        let first = Math.ceil(minQty / step) * step;
        let last = Math.floor(maxQty / step) * step;
        if (first > last) {
            step = 1;
            first = minQty;
            last = maxQty;
        }
        const qty = first + rand(0, Math.floor((last - first) / step)) * step;

        /*
         * 報價公式：
         *   finalMultiplier = clamp(批次倍率 + 行情修正, 0.01, 2.00)
         *   wholesaleTotal  = round(sell_price × finalMultiplier × qty)
         *   wholesaleUnit   = wholesaleTotal / qty
         *
         * 行情修正為 -0.05～+0.05，代表同類批次仍有小幅市場波動。
         * wholesaleUnit 在生成時鎖定；之後即使只買掉部分庫存，也不重新抽倍率，
         * 剩餘商品只以「鎖定單價 × 剩餘數量」重算整批總價。
         */
        const baseMultiplier = HM.randomFloat(lotType.markupMin, lotType.markupMax);
        const marketModifier = HM.randomFloat(-0.05, 0.05);
        const finalMultiplier = Math.min(2.00, Math.max(0.01, baseMultiplier + marketModifier));
        const wholesaleTotal = Math.max(1, Math.round(sell * finalMultiplier * qty));
        const wholesaleUnit = wholesaleTotal / qty;

        return {
            id,
            qty,
            originalQty: qty,
            wholesaleTotal,
            originalWholesaleTotal: wholesaleTotal,
            wholesaleUnit,
            debug: {
                sellPrice: sell,
                lotType: lotType.key,
                lotTypeName: lotType.name,
                lotMin: lotType.min,
                lotMax: lotType.max,
                originalQty: qty,
                nativeBulk,
                baseMultiplier,
                marketModifier,
                finalMultiplier,
                weights: weights.slice()
            }
        };
    };

    // 任意購買數量都沿用該批次已鎖定的 wholesaleUnit。
    // 買完整批時直接使用 wholesaleTotal，避免浮點單價回乘後產生 1 便士的取整差。
    HM.batchPrice = function (offer, amount) {
        if (!offer || amount < 1) return 0;
        if (amount === offer.qty) return offer.wholesaleTotal;
        return Math.max(1, Math.round(offer.wholesaleUnit * amount));
    };

    /*
     * 可負擔判定優先嘗試整批；不足時由「目前庫存 - 1」往下找最大可買數量。
     * 部分購買仍使用同一 wholesaleUnit，因此不會因玩家錢少而切換到另一套價格。
     * 回傳 mode 只供 UI 決定顯示文字，實際扣款仍由 buy() 重新計算與驗證。
     */
    HM.affordability = function (offer) {
        const money = Math.max(0, Number(State.variables.money) || 0);
        if (!offer || offer.qty <= 0) return { mode: "soldout", amount: 0, price: 0 };

        if (money >= offer.wholesaleTotal) {
            return { mode: offer.qty === 1 ? "single" : "wholesale", amount: offer.qty, price: offer.wholesaleTotal };
        }

        for (let amount = offer.qty - 1; amount >= 1; amount--) {
            const price = HM.batchPrice(offer, amount);
            if (money >= price) return { mode: "partial", amount, price };
        }
        return { mode: "unaffordable", amount: 0, price: 0 };
    };
    // 僅重新抽選一般商品，不重建 visit，也不影響服裝的售出狀態。
    HM.populateProductOffers = function (visit, categories, settings) {
        visit.categories = {};
        categories.forEach(cat => {
            const count = Math.min(cat.ids.length, rand(settings.minShown, settings.maxShown));
            visit.categories[cat.key] = shuffle(cat.ids).slice(0, count).map(id => HM.makeOffer(id, settings.maxLot));
        });
    };

    /**
     * 服裝預覽重繪時清理 Canvas 圖片快取。
     * 清除圖片及錯誤快取，讓新 Passage 重新建立模型與 Canvas。
     * 不變更市場供貨、交易或玩家穿著。
     */
    HM.refreshPreviewImageCache = function () {
        if (typeof Renderer === "undefined") return;
        Renderer.ImageCaches = {};
        Renderer.ImageErrors = {};
    };

    HM.refreshProductOffers = function () {
        const visit = HM.ensureVisit();
        HM.initTheftPriceDistribution();
        HM.populateProductOffers(visit, HM.getCategories(), visit.settings || HM.getMarketSettings());
        State.variables.honestMarketsCategory = null;
        // 孤兒院採購單仍由首次入市時的供貨決定，不隨刷新變更。
        return visit.categories;
    };

    HM.refreshClothingOffers = function () {
        // 只更換當次探索的服裝供貨，保留 Products、Seeds 與其他 visit 資料。
        return HM.generateClothingOffers();
    };

    HM.beginVisit = function () {
        const V = State.variables;
        HM.initTheftPriceDistribution();
        const categories = HM.getCategories();
        const settings = HM.getMarketSettings();
        const visit = { categories: {}, createdAt: Date.now(), settings: { ...settings } };

        HM.populateProductOffers(visit, categories, settings);
        V.honestMarketsVisit = visit;
        // 進入市場時同時生成兩類供貨；市場內的後續探索則分別刷新。
        const clothingCatalog = HM.getClothingCatalog?.() || [];
        const clothingCount = Math.min(clothingCatalog.length, rand(HM.CLOTHING_MIN_SHOWN || 5, HM.CLOTHING_MAX_SHOWN || 8));
        visit.clothing = shuffle(clothingCatalog).slice(0, clothingCount).map(item => HM.makeClothingOffer(item));
        V.honestMarketsCategory = null;

        // 孤兒院採購單只取「當天第一次生成的市場」。探索更多商品雖然也會
        // 呼叫 beginVisit()，但 ensureOrphanageOrder() 會以遊戲日鎖定既有清單，
        // 因此後續 30 分鐘刷新只影響玩家市場，不會提供重抽採購單的機會。
        HM.ensureOrphanageOrder(visit);
        // 遭遇改在玩家選定商品／種子／服裝區域時才抽，讓 eligible() 能以目標 Passage 判斷場景資格。
        V.honestMarketsVisitCount = (Number(V.honestMarketsVisitCount) || 0) + 1;
        return visit;
    };

    HM.ensureVisit = function () {
        const V = State.variables;
        if (!V.honestMarketsVisit || !V.honestMarketsVisit.categories) HM.beginVisit();
        return V.honestMarketsVisit;
    };


    /*
     * ==================== 孤兒院每日採購 ====================
     *
     * 採購單從「當天第一次進入市場時已生成的商品」衍生，而不是重新從
     * setup.foodstuff 抽取。商品與單價因此都反映玩家當天最初看到的市場。
     *
     * 選品只接受蔬菜、水果、配料、肉食、海鮮五類；花卉、飲料與其他分類
     * 不進入候選池。基礎權重依序為 5、4、3、2、2，再乘上現有行情提示
     * 的權重（有利可圖 1.4、尚可 1.0、不太划算 0.6）。
     * 數量：沿用商品已生成的批次類型，但孤兒院使用固定 1～50 的採購區間，
     * 不跟著玩家可調整到 2500 的 maxLot 放大。
     *
     * 採購單只「參考」首輪市場的供貨類型與鎖定單價，代表替孤兒院向市場其他
     * 攤販統一訂貨；因此不扣玩家目前畫面上的 offer.qty。若在這裡共用庫存，
     * 會讓玩家僅因觸發公益事件就失去原本可購買的商品，亦會讓 30 分鐘刷新
     * 與每日鎖單的語意互相污染。
     *
     * honestMarketsOrphanagePurchaseDay 必須等付款成功後才寫入。查看事件、
     * 金錢不足或中途返回都不能消耗每日一次機會；結算時仍需重新驗證金錢
     * 與 21:00 前的時間硬條件。
     */
    // 與市場生成共用 setup.foodstuff[*].category 的原始分類 key。
    // 這裡同時是孤兒院伙食的白名單；未列出的分類一律不參與抽選。
    HM.orphanageCategoryWeights = Object.freeze({
        vegetable: 5,
        fruit: 4,
        ingredient: 3,
        seafood: 2,
        meat: 2
    });

    HM.orphanageCategoryWeight = function (categoryKey) {
        return HM.orphanageCategoryWeights[categoryKey] ?? 0;
    };

    HM.orphanageProfitWeight = function (offer) {
        const result = HM.marketProfitability(offer);
        if (!result) return 1;
        if (result.key === "good") return 1.4;
        if (result.key === "poor") return 0.6;
        return 1;
    };

    HM.orphanageQtyRange = function (lotType) {
        switch (lotType) {
            case "loose": return [1, 4];
            case "small": return [5, 9];
            case "medium": return [10, 19];
            case "large": return [20, 39];
            case "clearance": return [40, 50];
            default: return [1, 4];
        }
    };

    HM.pickWeightedEntry = function (entries) {
        const index = HM.pickWeightedIndex(entries.map(entry => entry.weight));
        return entries[index] || null;
    };

    HM.createOrphanageOrder = function (visit) {
        const day = HM.marketDay();
        if (!visit?.categories) return null;

        const categoryMap = new Map(HM.getCategories().map(cat => [cat.key, cat]));
        const pool = [];
        Object.entries(visit.categories).forEach(([categoryKey, offers]) => {
            const category = categoryMap.get(categoryKey);
            (offers || []).forEach(offer => {
                const item = setup.foodstuff?.[offer.id];
                if (!item || !(offer.qty > 0) || !(offer.wholesaleUnit > 0)) return;
                const categoryName = category?.name || HM.categoryName(item, categoryKey);
                const categoryWeight = HM.orphanageCategoryWeight(categoryKey);
                // 白名單以外的分類直接排除，避免花卉等「可出售但不適合作為伙食」的商品混入。
                if (!(categoryWeight > 0)) return;
                pool.push({
                    offer,
                    categoryKey,
                    categoryName,
                    weight: categoryWeight * HM.orphanageProfitWeight(offer)
                });
            });
        });
        if (!pool.length) return null;

        const wanted = Math.min(pool.length, rand(3, 5));
        const remaining = pool.slice();
        const items = [];
        for (let i = 0; i < wanted && remaining.length; i++) {
            const chosen = HM.pickWeightedEntry(remaining);
            if (!chosen) break;
            remaining.splice(remaining.indexOf(chosen), 1);

            const offer = chosen.offer;
            const item = setup.foodstuff[offer.id];
            const [minQty, maxQty] = HM.orphanageQtyRange(offer.debug?.lotType);
            const qty = rand(minQty, maxQty);
            const unitPrice = offer.wholesaleUnit;
            const price = Math.max(1, Math.round(unitPrice * qty));
            const profitability = HM.marketProfitability(offer);
            items.push({
                id: offer.id,
                name: item.plural || item.singular || item.name || offer.id,
                categoryKey: chosen.categoryKey,
                categoryName: chosen.categoryName,
                lotType: offer.debug?.lotType || "loose",
                lotTypeName: offer.debug?.lotTypeName || "零散",
                qty,
                unitPrice,
                price,
                profitability: profitability?.key || "fair",
                profitabilityMargin: profitability?.margin || 0
            });
        }

        return {
            day,
            items,
            total: items.reduce((sum, entry) => sum + entry.price, 0)
        };
    };

    HM.ensureOrphanageOrder = function (visit = State.variables.honestMarketsVisit) {
        const V = State.variables;
        const day = HM.marketDay();
        const current = V.honestMarketsOrphanageOrder;
        if (current && current.day === day && Array.isArray(current.items) && current.items.length) return current;
        const order = HM.createOrphanageOrder(visit);
        if (order) V.honestMarketsOrphanageOrder = order;
        return order;
    };

    HM.getOrphanageOrder = function () {
        return HM.ensureOrphanageOrder();
    };

    HM.canShowOrphanageOrder = function () {
        const V = State.variables;
        const order = HM.getOrphanageOrder();
        const day = HM.marketDay();
        if (!order || !order.items?.length || order.day !== day) return false;

        // Debug 只略過孤兒院劇情前置；金錢、時間與每日一次仍是硬條件。
        if (!(V.loft_river === 1 || V.debug === 1)) return false;
        if (day !== null && Number(V.honestMarketsOrphanagePurchaseDay) === day) return false;
        if ((Number(V.money) || 0) < order.total) return false;

        const minutes = HM.marketMinutes();
        return minutes === null || minutes + 15 < 1260;
    };

    HM.purchaseOrphanageOrder = function () {
        const V = State.variables;
        const order = HM.getOrphanageOrder();
        const day = HM.marketDay();
        if (!order || !order.items?.length || order.day !== day) return false;
        if (!(V.loft_river === 1 || V.debug === 1)) return false;
        if (day !== null && Number(V.honestMarketsOrphanagePurchaseDay) === day) return false;

        // 確認頁與實際付款之間仍可能有其他巨集改動金錢或時間，因此結算時再次檢查硬條件。
        const total = Math.max(0, Math.round(Number(order.total) || 0));
        if ((Number(V.money) || 0) < total) return false;
        const minutes = HM.marketMinutes();
        if (!(minutes === null || minutes + 15 < 1260)) return false;

        V.honestMarketsOrphanagePurchaseDay = day;
        Wikifier.wikifyEval(`<<money -${total}>><<hope 1>><<famegood 1>><<pass 15>><<endevent>>`);
        return true;
    };

    HM.renderOrphanageOrder = function () {
        if (!HM.canShowOrphanageOrder()) return "";
        const order = HM.getOrphanageOrder();
        if (!order) return "";
        // 市場頁入口只進入簡短事件，不在這裡扣款或消耗時間。
        return `<<foodstufficon ${JSON.stringify(order.items[0].id)}>>` +
            `<<link "看看能不能替孤兒院添些食物" "HonestMarkets Orphanage">><</link>><<ghope>><br>`;
    };

    HM.renderOrphanageOrderList = function () {
        const order = HM.getOrphanageOrder();
        if (!order?.items?.length) return "";
        return order.items.map(entry =>
            `<<foodstufficon ${JSON.stringify(entry.id)}>>${entry.name} × ${entry.qty}　${HM.moneyText(entry.price)}<br>`
        ).join("") + `<br><b>合計：${HM.moneyText(order.total)}</b>`;
    };

    HM.renderOrphanageDebug = function () {
        if (State.variables.debug !== 1) return "";
        const order = HM.getOrphanageOrder();
        if (!order?.items?.length) return '<span class="grey">[孤兒院 Debug：今日沒有可用採購單]</span><br>';
        const statusName = { poor: "不太划算", fair: "尚可", good: "有利可圖" };
        const rows = order.items.map(entry =>
            `${entry.name} × ${entry.qty}｜${entry.categoryName}｜${entry.lotTypeName}｜` +
            `${statusName[entry.profitability] || entry.profitability}｜單價 ${HM.moneyText(entry.unitPrice)}｜小計 ${HM.moneyText(entry.price)}`
        );
        return `<mouse class="tooltip linkBlue">[孤兒院採購 Debug]<span class="black">` +
            `鎖定日：${order.day}<br>${rows.join("<br>")}<br>總價：${HM.moneyText(order.total)}</span></mouse><br>`;
    };

    HM.endVisit = function () {
        const V = State.variables;
        delete V.honestMarketsVisit;
        delete V.honestMarketsEncounter;
        delete V.honestMarketsVisitCount;
        V.honestMarketsCategory = null;
    };

    HM.categoryRemaining = function (key) {
        return HM.getOffers(key).filter(offer => offer && offer.qty > 0).length;
    };

    HM.setCategory = function (key) {
        HM.ensureVisit();
        State.variables.honestMarketsCategory = key;
    };

    HM.getOffers = function (key) {
        const visit = HM.ensureVisit();
        return visit.categories[key] || [];
    };

    HM.buy = function (offer, amount, mode) {
        const V = State.variables;
        if (!HM.canUseMarket()) return false;
        if (!offer || !setup.foodstuff?.[offer.id]) return false;

        amount = Math.floor(Number(amount) || 0);
        if (amount < 1 || amount > offer.qty) return false;

        const price = HM.batchPrice(offer, amount);
        if ((Number(V.money) || 0) < price) return false;

        Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(offer.id)} ${amount}>><<money -${price}>>`);

        offer.qty -= amount;
        if (offer.qty > 0) {
            offer.wholesaleTotal = Math.max(1, Math.round(offer.wholesaleUnit * offer.qty));
        }
        HM.advanceMinutes(5);
        return true;
    };

    /*
     * ==================== 已知喜愛料理與市場 ♥ ====================
     *
     * 情報來源只讀取 $foodstuff[dish].knownFavorite；這是原版在玩家實際得知
     * NPC 喜愛某道料理後才寫入的資料。不要改用 setup.foodPreference，
     * 後者是完整答案表，直接讀取會讓市場提前劇透尚未發現的喜好。
     *
     * 材料反查分三層：
     *   1. recipe.ingredients：食譜正式材料。
     *   2. ingredient_alternatives.normal：普通替代材料。
     *   3. ingredient_alternatives.lewd：僅在 chef_state >= 3 後視為已解鎖情報。
     *
     * 原版 ingredientAlternativesSetup() 還會檢查「目前廚房是否允許淫穢材料」
     * 與自動選材偏好；那些是實際下廚時的場景/操作限制，不是玩家是否已解鎖
     * 這類材料的永久知識，因此市場提示不套用 T.allowLewdIngredients 或
     * ingredientsAutoManageLewd。真正能否在某間廚房使用，仍交由原版判定。
     */
    HM.favoriteDishName = function (dishId) {
        const item = setup.foodstuff?.[dishId] || {};
        return item.singular || item.name || item.plural || dishId;
    };

    HM.favoriteNpcName = function (npc) {
        try {
            return setup.NPC_CN_NAME?.(npc) || npc;
        } catch (_) {
            return npc;
        }
    };

    HM.recipeAlternativeMap = function (dishId, includeLewd) {
        const result = {};
        const add = (main, alternative, type) => {
            if (!main || !alternative) return;
            if (!result[main]) result[main] = [];
            if (!result[main].some(entry => entry.id === alternative && entry.type === type)) {
                result[main].push({ id: alternative, type });
            }
        };

        // 材料自身可宣告「可由哪些物品替代」；這是原版 alternativesSetup 的第一層來源。
        Object.entries(setup.foodstuff || {}).forEach(([main, item]) => {
            const alternatives = item?.ingredient_alternatives;
            (alternatives?.normal || []).forEach(id => add(main, id, "normal"));
            if (includeLewd) (alternatives?.lewd || []).forEach(id => add(main, id, "lewd"));
        });

        // 食譜也能針對特定料理額外指定替代品，需與材料自身規則合併。
        const recipeAlternatives = setup.foodstuff?.[dishId]?.recipe?.ingredient_alternatives;
        Object.entries(recipeAlternatives?.normal || {}).forEach(([main, list]) => {
            (list || []).forEach(id => add(main, id, "normal"));
        });
        if (includeLewd) {
            Object.entries(recipeAlternatives?.lewd || {}).forEach(([main, list]) => {
                (list || []).forEach(id => add(main, id, "lewd"));
            });
        }
        return result;
    };

    HM.favoriteFoodInfo = function (itemId) {
        const V = State.variables;
        const direct = [];
        const ingredientFor = [];
        const includeLewd = Number(V.chef_state) >= 3;

        Object.entries(setup.foodstuff || {}).forEach(([dishId, dish]) => {
            if (dish?.category !== "dish" || !dish?.recipe?.ingredients?.length) return;
            const npcs = Array.isArray(V.foodstuff?.[dishId]?.knownFavorite)
                ? V.foodstuff[dishId].knownFavorite.filter(Boolean)
                : [];
            if (!npcs.length) return;

            if (dishId === itemId) {
                npcs.forEach(npc => direct.push({ npc, dish: dishId }));
            }

            const alternatives = HM.recipeAlternativeMap(dishId, includeLewd);
            dish.recipe.ingredients.forEach(main => {
                if (main === itemId) {
                    npcs.forEach(npc => ingredientFor.push({
                        npc, dish: dishId, mainIngredient: main, relation: "main"
                    }));
                    return;
                }
                const alternative = (alternatives[main] || []).find(entry => entry.id === itemId);
                if (alternative) {
                    npcs.forEach(npc => ingredientFor.push({
                        npc,
                        dish: dishId,
                        mainIngredient: main,
                        relation: alternative.type
                    }));
                }
            });
        });

        // 同一 NPC / 料理 / 主材料只保留一次，避免資料同時由全局與食譜規則宣告時重複顯示。
        const unique = list => {
            const seen = new Set();
            return list.filter(entry => {
                const key = `${entry.npc}|${entry.dish}|${entry.mainIngredient || ""}|${entry.relation || ""}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };
        return { direct: unique(direct), ingredientFor: unique(ingredientFor) };
    };

    HM.hasFavoriteFoodInfo = function (itemId) {
        const info = HM.favoriteFoodInfo(itemId);
        return !!(info.direct.length || info.ingredientFor.length);
    };

    HM.openFavoriteFoodInfo = function (categoryKey, itemId) {
        const V = State.variables;
        V.honestMarketsFavoriteFood = { categoryKey, itemId };
    };

    HM.getFavoriteFoodSelection = function () {
        const selected = State.variables.honestMarketsFavoriteFood;
        if (!selected?.itemId) return null;
        const offer = HM.getOffers(selected.categoryKey).find(entry => entry.id === selected.itemId);
        if (!offer || offer.qty <= 0 || !setup.foodstuff?.[selected.itemId]) return null;
        return { ...selected, offer, item: setup.foodstuff[selected.itemId] };
    };

    HM.renderFavoriteHeart = function (categoryKey, itemId) {
        if (!HM.hasFavoriteFoodInfo(itemId)) return "";
        // ♥ 是商品列上的補充情報提示，不切換 Passage；內容只顯示玩家已經得知的喜愛料理關係。
        const details = HM.renderFavoriteFoodDetails(itemId);
        return ` <mouse class="tooltip-small red">♥<span class="black" style="max-height:35vh;overflow-y:auto;">${details}</span></mouse>`;
    };

    HM.renderFavoritePurchaseLink = function (categoryKey, itemId) {
        const item = setup.foodstuff?.[itemId];
        const info = HM.favoriteFoodInfo(itemId);
        if (item?.category !== "dish" || !info.direct.length) return "";
        // 戀人單份購買是商品列上的獨立交易入口；♥ 僅用來查看已知的喜愛料理資訊。
        return `<<link "替戀人購買一份" "HonestMarkets Favorite Food Purchase">>` +
            `<<run setup.HonestMarkets.openFavoriteFoodInfo(${JSON.stringify(categoryKey)}, ${JSON.stringify(itemId)})>><</link>><br>`;
    };

    HM.renderFavoriteFoodDetails = function (itemId) {
        const selected = itemId ? null : HM.getFavoriteFoodSelection();
        const targetId = itemId || selected?.itemId;
        if (!targetId || !setup.foodstuff?.[targetId]) return '<span class="grey">這項商品已經不在攤位上了。</span>';
        const info = HM.favoriteFoodInfo(targetId);
        const rows = [];

        // 依料理聚合已知喜愛角色，避免同一道料理因多名角色喜愛而重複佔用提示空間。
        const groupByDish = entries => {
            const groups = new Map();
            entries.forEach(entry => {
                if (!groups.has(entry.dish)) groups.set(entry.dish, []);
                groups.get(entry.dish).push(entry);
            });
            return groups;
        };
        const npcNames = entries => [...new Set(entries.map(entry => HM.favoriteNpcName(entry.npc)))].join("、");

        groupByDish(info.direct).forEach((entries, dishId) => {
            rows.push(`<<iconUi "sym-love.png">>「${HM.favoriteDishName(dishId)}」— ${npcNames(entries)}喜歡。`);
        });

        groupByDish(info.ingredientFor).forEach((entries, dishId) => {
            const dish = HM.favoriteDishName(dishId);
            const relations = [...new Map(entries.map(entry => {
                if (entry.relation === "main") return ["main", "可直接用來製作"];
                const main = HM.favoriteDishName(entry.mainIngredient);
                const type = entry.relation === "lewd" ? "淫穢替代材料" : "替代材料";
                return [`${entry.mainIngredient}|${entry.relation}`, `可作為「${main}」的${type}`];
            })).values()];
            rows.push(`<<iconUi "sym-love.png">>「${dish}」— ${npcNames(entries)}喜歡；${relations.join("、")}。`);
        });

        return rows.length ? rows.join("<br>") : '<span class="grey">你暫時想不起這項商品和誰的喜好有關。</span>';
    };

    /*
     * 已知喜愛料理可從商品列要求目前攤位的店主拆售一份。談判結果直接保存在 offer：
     * 同一批商品返回、切換分類或再次進入購買頁都沿用原結果；探索更多商品建立
     * 新一批 offer 後則重新判定，讓新攤位/新供貨有自己的談判結果。
     *
     * 基礎結果：正常 50%、敲竹槓 30%、拒絕 20%。
     * 語文能力 $english 只把「拒絕」逐步轉移成正常販售：
     *   english 0    -> 50 / 30 / 20
     *   english 1000 -> 65 / 30 / 5
     * 店主一旦決定敲竹槓，語文不再降低價格；加價倍率固定從 1.25～2.00 抽取並鎖定。
     */
    HM.getSingleDishDeal = function (itemId, offer = null) {
        const item = setup.foodstuff?.[itemId];
        const info = HM.favoriteFoodInfo(itemId);
        if (item?.category !== "dish" || !info.direct.length) return null;

        const selectedOffer = offer || HM.getFavoriteFoodSelection()?.offer;
        if (!selectedOffer || selectedOffer.id !== itemId || selectedOffer.qty <= 0) return null;
        if (selectedOffer.singleDishDeal) return selectedOffer.singleDishDeal;

        const english = Math.max(0, Math.min(1000, Number(State.variables.english) || 0));
        const refusedWeight = 20 - (english / 1000) * 15;
        const markupWeight = 30;
        const normalWeight = 100 - markupWeight - refusedWeight;
        const roll = HM.rollRng();

        let result = "normal";
        if (roll >= normalWeight && roll < normalWeight + markupWeight) result = "markup";
        else if (roll >= normalWeight + markupWeight) result = "refused";

        const multiplier = result === "markup" ? HM.randomFloat(1.25, 2.00) : 1;
        const basePrice = Math.max(1, Math.round(Number(item.shop?.sell_price) || 1));
        selectedOffer.singleDishDeal = {
            result,
            multiplier,
            basePrice,
            price: Math.max(1, Math.round(basePrice * multiplier)),
            english
        };
        return selectedOffer.singleDishDeal;
    };

    HM.renderSingleDishOffer = function () {
        const selected = HM.getFavoriteFoodSelection();
        if (!selected) return "";
        const info = HM.favoriteFoodInfo(selected.itemId);
        if (selected.item.category !== "dish" || !info.direct.length) return "";

        const deal = HM.getSingleDishDeal(selected.itemId, selected.offer);
        if (!deal) return "";
        if (deal.result === "refused") {
            return '<br><br>你試著和店主商量能不能只買一份。對方搖了搖頭。<br>「不拆。要買就整批拿走。」';
        }

        if (deal.result === "markup") {
            return `<br><br>你費了些口舌，店主總算願意拆一份給你。不過對方顯然看出了你很想要。<br>` +
                `「${HM.moneyText(deal.price)}。愛買不買。」<br><br>` +
                `<<link ${JSON.stringify(`買一份（${HM.moneyText(deal.price)}）(00:05)`)} "HonestMarkets Favorite Food Result">><</link>>`;
        }

        return `<br><br>你問了問能不能只買一份。店主想了一下，最後還是替你破了例。<br><br>` +
            `<<link ${JSON.stringify(`買一份（${HM.moneyText(deal.price)}）(00:05)`)} "HonestMarkets Favorite Food Result">><</link>>`;
    };

    HM.purchaseSingleDish = function () {
        const selected = HM.getFavoriteFoodSelection();
        if (!selected || !HM.canUseMarket()) return false;
        const deal = HM.getSingleDishDeal(selected.itemId, selected.offer);
        if (!deal || deal.result === "refused" || selected.offer.qty < 1) return false;

        // 拆售使用正常 sell_price，而非本批 wholesaleUnit；這是便利服務，不提供批發套利。
        // 結算時再次檢查金錢，避免玩家在詳細頁停留期間由其他巨集改變資金後扣成負數。
        const price = Math.max(1, Math.round(Number(deal.price) || 0));
        if ((Number(State.variables.money) || 0) < price) return false;

        Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(selected.itemId)} 1>><<money -${price}>>`);
        selected.offer.qty -= 1;
        if (selected.offer.qty > 0) {
            selected.offer.wholesaleTotal = Math.max(1, Math.round(selected.offer.wholesaleUnit * selected.offer.qty));
        }
        HM.advanceMinutes(5);
        return true;
    };

    HM.renderCategories = function () {
        const cats = HM.getCategories().filter(cat => HM.getOffers(cat.key).length);
        if (!cats.length) return '<span class="red">這裡暫時沒有可出售的食品。</span>';

        return cats.map(cat => {
            const remaining = HM.categoryRemaining(cat.key);
            if (remaining <= 0) {
                const tip = '這個分類的商品已經賣光了，也許應該再次探索市集。';
                return `<span class="grey">${cat.name}（售罄）</span> ` +
                    `<mouse class="tooltip-small linkBlue">(?)<span class="black">${tip}</span></mouse><br>`;
            }

            const label = `${cat.name}（${remaining}種）`;
            return `<<link ${JSON.stringify(label)} "HonestMarkets Category">>` +
                `<<run setup.HonestMarkets.setCategory(${JSON.stringify(cat.key)})>><</link>><br>`;
        }).join("");
    };

    // 行情提示永遠以「目前全局 sell_price ÷ 本批鎖定進貨單價 - 1」估算即時毛利率。
    // 批發報價在 offer 生成時鎖定，但每日全局行情可以改變商品今天的轉售價值，
    // 因此同一筆報價的「有利可圖／尚可／不太划算」允許隨目前行情改變。
    HM.marketProfitability = function (offer) {
        if (!offer || !(offer.wholesaleUnit > 0)) return null;
        const currentSellPrice = Number(setup.foodstuff?.[offer.id]?.shop?.sell_price);
        if (!(currentSellPrice > 0)) return null;
        const margin = (currentSellPrice / offer.wholesaleUnit) - 1;
        if (margin < 0) return { key: "poor", margin, currentSellPrice };
        if (margin < 0.15) return { key: "fair", margin, currentSellPrice };
        return { key: "good", margin, currentSellPrice };
    };

    // 行情評價以完成價格精度處理後的實際市場價格，與不含每日波動的行情基準價格比較。
    // 因此低價商品即使抽到極小幅波動，只要最後價格沒有改變，就仍會顯示為正常。
    HM.dailyMarketText = function (breakdown) {
        if (!breakdown) return "正常";
        const ratio = Number(breakdown.marketRatio);
        if (!Number.isFinite(ratio) || ratio === 1) return "正常";
        if (breakdown.daily?.state === "surge" && ratio > 1) return "異常火熱";
        if (breakdown.daily?.state === "crash" && ratio < 1) return "異常低迷";
        if (ratio > 1) return "偏高";
        if (ratio < 1) return "偏低";
        return "正常";
    };

    /*
     * ==================== 玩家庫存行情簿 ====================
     *
     * 行情簿只回答「玩家目前持有的商品，今天大約值多少」。它不讀 HonestMarkets
     * 的批次進貨成本，也不計算「有利可圖」等進貨評價，因為玩家庫存可能來自採集、
     * 烹飪、任務、其他商店或其他 Mod，而不是從 HonestMarkets 購入。
     *
     * 庫存沿用 DoL 原生 $foodstuff[id].amount；分類則沿用 setup.foodstuff 的 category，
     * 因此官方或其他 Mod 新增、且仍使用既有 foodstuff 結構的商品可自動出現在行情簿。
     */
    HM.getPlayerMarketInventory = function () {
        const inventory = State.variables.foodstuff;
        if (!inventory || !setup.foodstuff) return [];

        return HM.getCatalog().map(({ id, item }) => {
            const amount = Math.max(0, Math.floor(Number(inventory[id]?.amount) || 0));
            if (amount <= 0) return null;

            const breakdown = HM.getPriceBreakdown(id);
            if (!breakdown || !(breakdown.currentMarketPrice > 0)) return null;

            return {
                id,
                item,
                amount,
                categoryKey: HM.categoryKey(item),
                categoryName: HM.categoryName(item, HM.categoryKey(item)),
                name: item.singular || item.name || item.plural || id,
                price: breakdown.currentMarketPrice,
                marketText: HM.dailyMarketText(breakdown)
            };
        }).filter(Boolean);
    };

    HM.getPlayerMarketInventoryByCategory = function () {
        const groups = new Map();
        HM.getPlayerMarketInventory().forEach(entry => {
            if (!groups.has(entry.categoryKey)) {
                groups.set(entry.categoryKey, {
                    key: entry.categoryKey,
                    name: entry.categoryName,
                    items: []
                });
            }
            groups.get(entry.categoryKey).items.push(entry);
        });

        return Array.from(groups.values())
            .map(group => {
                group.items.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant-TW"));
                return group;
            })
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant-TW"));
    };

    HM.marketJournalState = function (breakdown) {
        const text = HM.dailyMarketText(breakdown);
        if (text === "異常火熱") return "surge";
        if (text === "偏高") return "high";
        if (text === "異常低迷") return "crash";
        if (text === "偏低") return "low";
        return "normal";
    };

    HM.marketJournalDetail = function (id) {
        const item = setup.foodstuff?.[id];
        const breakdown = HM.getPriceBreakdown(id);
        if (!item || !breakdown) return "";

        const name = item.singular || item.name || item.plural || id;
        const marketText = HM.dailyMarketText(breakdown);
        const signedPct = value => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
        const lines = [
            `<<foodstufficon ${JSON.stringify(id)}>><b>${name}</b><br>`,
            `目前市場價：<span class="gold">${HM.moneyText(breakdown.currentMarketPrice)} / 個</span><br>`,
            `今日行情：<b>${marketText}</b>（${signedPct(breakdown.marketRatio - 1)}）`
        ];

        if (State.variables.debug === 1) {
            lines.push(
                `<hr><span class="gray"><b>Debug</b><br>`,
                `行情基準：${HM.moneyText(breakdown.marketBaselinePrice)} / 個<br>`,
                `今日行情倍率：${breakdown.daily.multiplier.toFixed(3)}×<br>`,
                `真實基礎價格：${HM.moneyText(breakdown.trueBasePrice)}`,
                `</span>`
            );
        }
        return lines.join("");
    };

    HM.closeMarketJournalDetail = function () {
        document.querySelectorAll(".hm-market-journal-popover").forEach(node => node.remove());
        HM.marketJournalDetailState = null;
    };

    HM.openMarketJournalDetail = function (id, anchor) {
        const item = setup.foodstuff?.[id];
        if (!item || !HM.getPriceBreakdown(id) || !anchor) return;

        const current = HM.marketJournalDetailState;
        if (current?.id === id && current?.anchor === anchor && document.body.contains(current.popover)) {
            HM.closeMarketJournalDetail();
            return;
        }

        HM.closeMarketJournalDetail();

        const popover = document.createElement("div");
        popover.className = "hm-market-journal-popover";
        popover.setAttribute("role", "dialog");
        document.body.appendChild(popover);
        new Wikifier(popover, HM.marketJournalDetail(id));

        const gap = 8;
        const viewportPadding = 8;
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();

        let left = anchorRect.left + (anchorRect.width - popoverRect.width) / 2;
        left = Math.max(viewportPadding, Math.min(left, window.innerWidth - popoverRect.width - viewportPadding));

        let top = anchorRect.bottom + gap;
        if (top + popoverRect.height > window.innerHeight - viewportPadding) {
            top = anchorRect.top - popoverRect.height - gap;
        }
        top = Math.max(viewportPadding, Math.min(top, window.innerHeight - popoverRect.height - viewportPadding));

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
        HM.marketJournalDetailState = { id, anchor, popover };
    };

    HM.renderMarketJournal = function () {
        const groups = HM.getPlayerMarketInventoryByCategory();
        if (!groups.length) {
            return '<span class="gray">目前沒有可參考市場行情的庫存商品。</span>';
        }

        const options = ['<option value="all">全部</option>']
            .concat(groups.map(group => `<option value="${group.key}">${group.name}</option>`))
            .join("");

        const items = groups.flatMap(group => group.items.map(entry => {
            const breakdown = HM.getPriceBreakdown(entry.id);
            const state = HM.marketJournalState(breakdown);
            return `<div class="item hm-market-journal-item hm-market-${state}" ` +
                `data-hm-market-id="${entry.id}" data-hm-market-category="${group.key}" ` +
                `role="button" tabindex="0">` +
                `<<foodstufficon ${JSON.stringify(entry.id)}>>` +
                `<hr>${entry.amount}</div>`;
        })).join("");

        return `<div class="hm-market-journal-filter">展示： ` +
            `<select class="hm-market-journal-select">${options}</select></div>` +
            `<div class="itemInventory hm-market-journal-inventory">${items}</div>`;
    };

    HM.filterMarketJournal = function (root, category) {
        root.querySelectorAll(".hm-market-journal-item").forEach(card => {
            card.hidden = category !== "all" && card.dataset.hmMarketCategory !== category;
        });
        HM.closeMarketJournalDetail();
    };


    HM.seasonMarketText = function (season) {
        if (season?.yearRound) return "全年供應";
        if (!season?.restricted) return "無季節限制";
        return season.inSeason ? "當季" : "非產季";
    };

    HM.renderMarketInfo = function (offer, result = HM.marketProfitability(offer)) {
        if (!result) return "";
        const breakdown = HM.getPriceBreakdown(offer.id);
        if (!breakdown) return "";

        const stallText = result.key === "poor"
            ? "這攤賣得偏貴"
            : result.key === "fair"
                ? "這攤價格普通"
                : "這攤賣得便宜";
        const marketState = HM.dailyMarketText(breakdown);
        const dailyText = marketState === "異常火熱"
            ? "今天行情異常火熱"
            : marketState === "異常低迷"
                ? "今天行情異常低迷"
                : marketState === "偏高"
                    ? "今天行情比往常偏高"
                    : marketState === "偏低"
                        ? "今天行情比往常偏低"
                        : "今天行情與往常相近";
        const seasonText = breakdown.season.yearRound
            ? "全年都有供應"
            : breakdown.season.restricted
                ? (breakdown.season.inSeason ? "現在正值產季" : "現在不是產季")
                : "沒有季節限制";
        const supplyText = breakdown.supplyTrait?.marketText
            ? `，而且${breakdown.supplyTrait.marketText}`
            : "";

        return `${stallText}，${dailyText}，${seasonText}${supplyText}。`;
    };

    /*
     * 一般玩家仍只看到既有的三種行情標籤；標籤本身可點開簡要市場資訊。
     * 精確倍率與完整價格鏈只放在 Debug，避免一般 UI 直接暴露計算公式。
     */
    HM.renderMarketHint = function (offer) {
        const result = HM.marketProfitability(offer);
        if (!result) return "";
        const label = result.key === "poor" ? "不太划算" : result.key === "fair" ? "尚可" : "有利可圖";
        const color = result.key === "poor" ? "red" : result.key === "fair" ? "blue" : "green";
        const info = HM.renderMarketInfo(offer, result);
        return ` <mouse class="tooltip-small ${color}">【${label}】<span class="black">${info}</span></mouse>`;
    };

    HM.renderDebugTip = function (offer) {
        if (!State.variables.debug || !offer?.debug) return "";
        const d = offer.debug;
        const breakdown = HM.getPriceBreakdown(offer.id);
        const currentSellPrice = Math.max(0, Number(setup.foodstuff?.[offer.id]?.shop?.sell_price) || 0);
        const quotedSellPrice = Math.max(0, Number(d.sellPrice) || 0);
        const signedPct = value => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
        const weights = Array.isArray(d.weights) ? d.weights.join("/") : "-";
        const quoteChanged = quotedSellPrice > 0 && currentSellPrice !== quotedSellPrice;
        const body = [
            `<b>HonestMarkets Debug</b>`,
            `ID：${offer.id}`,
            ``,
            `<b>【全局市場價格】</b>`,
            `原版 sell_price：${breakdown ? HM.moneyText(breakdown.original) : HM.moneyText(quotedSellPrice)}`,
            ...(breakdown ? [
                `全局價格設定：${breakdown.manualMultiplier.toFixed(0)}×`,
                `真實基礎價格：${HM.moneyText(breakdown.trueBasePrice)}`,
                ...(breakdown.supplyTrait ? [
                    `供應特性：${breakdown.supplyTrait.marketText || breakdown.supplyTrait.key}`,
                    `供應特性倍率：${breakdown.supplyTraitMultiplier.toFixed(2)}×`
                ] : []),
                `季節：${HM.seasonMarketText(breakdown.season)}`,
                ...(breakdown.season.restricted ? [`季節倍率：${breakdown.season.multiplier.toFixed(2)}×`] : []),
                `行情基準價格：${HM.moneyText(breakdown.marketBaselinePrice)} / 個`,
                `今日全局行情：${breakdown.daily.multiplier.toFixed(3)}×`,
                `→ 當前市場價格：${HM.moneyText(currentSellPrice)} / 個`,
                `→ 實際行情：${signedPct(breakdown.marketRatio - 1)}（${HM.dailyMarketText(breakdown)}）`
            ] : []),
            ``,
            `<b>【本批進貨報價】</b>`,
            `報價生成時市場基準：${HM.moneyText(quotedSellPrice)} / 個`,
            ...(quoteChanged ? [`<span class="orange">※ 本批已鎖價；目前市場價格已與生成時不同。</span>`] : []),
            `批次：${d.lotTypeName}（${d.lotMin}-${d.lotMax}）`,
            `原始生成數量：${d.originalQty}`,
            `bought_in_bulk：${d.nativeBulk}`,
            `批次權重：${weights}`,
            `基礎倍率：${d.baseMultiplier.toFixed(3)}×`,
            `攤販行情修正：${signedPct(d.marketModifier)}`,
            `最終倍率：${d.finalMultiplier.toFixed(3)}×`,
            `→ 鎖定進貨單價：${HM.moneyText(offer.wholesaleUnit)} / 個`,
            `目前剩餘：${offer.qty}`,
            `目前整批價：${HM.moneyText(offer.wholesaleTotal)}`,
            ``,
            `<b>【轉售預估】</b>`,
            `正常擺攤：${HM.moneyText(currentSellPrice)} / 個`,
            `抬價擺攤：${HM.moneyText(Math.round(currentSellPrice * 1.2))} / 個`,
            `正常毛利：${offer.wholesaleUnit > 0 ? signedPct((currentSellPrice / offer.wholesaleUnit) - 1) : "-"}`,
            `抬價毛利：${offer.wholesaleUnit > 0 ? signedPct(((currentSellPrice * 1.2) / offer.wholesaleUnit) - 1) : "-"}`
        ].join("<br>");
        return ` <mouse class="tooltip-small linkBlue">(?)<span class="black">${body}</span></mouse>`;
    };

    HM.getSkulduggery = function () {
        if (typeof currentSkillValue === "function") {
            const value = Number(currentSkillValue("skulduggery"));
            if (Number.isFinite(value)) return Math.max(0, value);
        }
        return Math.max(0, Number(State.variables.skulduggery) || 0);
    };

    /*
     * ==================== 偷摸：候選商品能力門檻 ====================
     *
     * 偷摸不是直接拿「玩家詭術 vs 商品價格」做成功判定，而是分成三層：
     *   1. 候選門檻：詭術決定目前能考慮哪些價位的商品。
     *   2. 成功難度：入選後再由單價、數量、時段計算 $skulduggerydifficulty，
     *      最終成功／失敗交給 DoL 原生 <<skulduggerycheck>>。
     *   3. 被抓風險：只有原生檢定失敗後才判定，與成功率是兩個不同事件。
     *
     * 價格門檻採「當前 setup.foodstuff 價格分布的分位數」，而不是固定 £ 金額。
     * 因此官方或其他 Mod 改變商品價格後，下一次建立市場探索就會自動重新校準。
     * 只收集有效 shop.sell_price 並由低到高排序；使用分位數也可避免少數極端高價品
     * （例如遠高於一般食材的特殊物品）直接把整條能力曲線拉高。
     */
    HM.initTheftPriceDistribution = function () {
        HM.theftPriceDistribution = HM.getCatalog()
            .map(({ item }) => Number(item?.shop?.sell_price))
            .filter(price => Number.isFinite(price) && price > 0)
            .sort((a, b) => a - b);
        return HM.theftPriceDistribution;
    };

    /*
     * 詭術 → 可偷價格分位：
     *   0    → P10
     *   200  → P25
     *   400  → P50
     *   600  → P75
     *   800  → P90
     *   1000 → P95
     *
     * 節點之間線性插值，例如詭術 500 位於 400～600 正中間，得到 P62.5。
     * 1000 以上固定 P95，不開放最昂貴約 5% 商品，避免滿級後完全失去價值門檻。
     * 注意：這裡只決定「能否成為候選」，不代表該商品一定容易偷成功。
     */
    HM.theftPercentileForSkill = function (skulduggery = HM.getSkulduggery()) {
        const skill = Math.max(0, Number(skulduggery) || 0);
        const points = [
            [0, 0.10],
            [200, 0.25],
            [400, 0.50],
            [600, 0.75],
            [800, 0.90],
            [1000, 0.95]
        ];
        if (skill >= points[points.length - 1][0]) return points[points.length - 1][1];
        for (let i = 1; i < points.length; i++) {
            const [s1, p1] = points[i];
            if (skill <= s1) {
                const [s0, p0] = points[i - 1];
                const t = (skill - s0) / (s1 - s0);
                return p0 + (p1 - p0) * t;
            }
        }
        return points[0][1];
    };

    // 將 0～1 分位轉回實際 sell_price。position = (N - 1) × percentile。
    // 若 position 落在兩筆價格之間，依小數部分線性插值；這讓能力門檻隨詭術平滑變化，
    // 而不是只有跨過某個商品價格時才突然跳升。回傳值仍是 DoL 內部貨幣單位（便士）。
    HM.theftPriceQuantile = function (percentile) {
        const prices = HM.theftPriceDistribution?.length
            ? HM.theftPriceDistribution
            : HM.initTheftPriceDistribution();
        if (!prices.length) return 1;
        const p = Math.min(1, Math.max(0, Number(percentile) || 0));
        const position = (prices.length - 1) * p;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        if (lower === upper) return prices[lower];
        const t = position - lower;
        return prices[lower] + (prices[upper] - prices[lower]) * t;
    };

    HM.maxStealableUnitValue = function (skulduggery = HM.getSkulduggery()) {
        return Math.max(1, HM.theftPriceQuantile(HM.theftPercentileForSkill(skulduggery)));
    };

    HM.canStealItem = function (item, skulduggery = HM.getSkulduggery()) {
        const sell = Math.max(1, Number(item?.shop?.sell_price) || 1);
        return sell <= HM.maxStealableUnitValue(skulduggery);
    };

    /*
     * 通過價格門檻後，再用「能力上限 ÷ 商品單價」決定一次最多能摸幾個。
     * maxQty = 1 + floor(log2(limit / sell))，最後限制為 1～12。
     *
     * 因此商品越接近能力上限，通常只能拿 1 個；每便宜一半才增加約 1 個容量：
     *   limit / sell = 1× → 1 個
     *                  2× → 2 個
     *                  4× → 3 個
     *                  8× → 4 個
     *                 16× → 5 個
     *                 32× → 6 個
     *                 64× → 7 個，之後每翻倍再 +1，最高 12 個。
     * 這同時抑制「高價又大量」的極端偷摸目標。
     */
    HM.getStealMaxQty = function (item, skulduggery = HM.getSkulduggery()) {
        const sell = Math.max(1, Number(item?.shop?.sell_price) || 1);
        const limit = HM.maxStealableUnitValue(skulduggery);
        if (sell > limit) return 0;
        const ratio = Math.max(1, limit / sell);
        return Math.min(12, 1 + Math.floor(Math.log2(ratio)));
    };

    /*
     * 時段只修改成功檢定 difficulty，不會提高可偷價格上限。
     * 07:00～18:59：0
     * 19:00～19:59：基準 -50
     * 20:00～20:59：基準 -150
     *
     * 非零基準再乘 0.75～1.25，因此 -50 實際約 -38～-63，-150 約 -113～-188。
     * 負值代表越接近收攤越容易下手；波動在「觀察目標」時產生並存進 theft，
     * 後續確認頁不會重新抽取本次 difficulty。
     */
    HM.theftTimeModifier = function () {
        const minutes = HM.marketMinutes();
        if (minutes === null) return 0;

        let base = 0;
        if (minutes >= 1140 && minutes < 1200) base = -50;       // 19:00～19:59
        else if (minutes >= 1200 && minutes < 1260) base = -150; // 20:00～20:59

        if (base === 0) return 0;
        const factor = HM.randomFloat(0.75, 1.25);
        return Math.round(base * factor);
    };

    /*
     * 將商品價格換成目前價格分布中的相對分位。
     *
     * 這裡不用固定 £ 金額當基準。若整個經濟一起變成 10×，所有商品與分位價格會
     * 同比例上升，同一商品仍位於相同的相對位置，因此偷摸難度不會被貨幣尺度扭曲。
     *
     * 相同價格可能同時出現很多次，所以使用該價格在排序陣列中的「中間排名」
     * （第一個位置與最後一個位置的平均）計算 percentile，避免同價商品因排序位置
     * 不同得到不同難度。
     */
    HM.theftPricePercentile = function (item) {
        const sell = Math.max(1, Number(item?.shop?.sell_price) || 1);
        const prices = HM.theftPriceDistribution?.length
            ? HM.theftPriceDistribution
            : HM.initTheftPriceDistribution();
        if (prices.length <= 1) return 0;

        let low = 0;
        let high = prices.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (prices[mid] < sell) low = mid + 1;
            else high = mid;
        }
        const first = low;

        low = 0;
        high = prices.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (prices[mid] <= sell) low = mid + 1;
            else high = mid;
        }
        const last = low - 1;

        const position = last >= first ? (first + last) / 2 : first;
        return Math.min(1, Math.max(0, position / (prices.length - 1)));
    };

    /*
     * 將「價格分位」換算成 valueDifficulty。
     *
     * 這條曲線刻意與 theftPercentileForSkill() 的能力門檻互為對應：
     *   P10 →   0
     *   P25 → 200
     *   P50 → 400
     *   P75 → 600
     *   P90 → 800
     *   P95 → 1000
     *
     * 節點之間線性插值。P10 以下維持 0；P95 以上維持 1000。
     * 正常候選池最高本來就只開放到 P95，因此上限主要也是異常資料防護。
     *
     * 這代表「價格難度」描述的是商品在目前遊戲經濟中的相對昂貴程度，
     * 而不是某個固定英鎊數字。官方、其他 Mod 或全局倍率改變整體價格尺度時，
     * 系統會隨目前商品分布自動校準。
     */
    HM.theftValueDifficulty = function (item) {
        const percentile = HM.theftPricePercentile(item);
        const points = [
            [0.10, 0],
            [0.25, 200],
            [0.50, 400],
            [0.75, 600],
            [0.90, 800],
            [0.95, 1000]
        ];

        if (percentile <= points[0][0]) return points[0][1];
        if (percentile >= points[points.length - 1][0]) return points[points.length - 1][1];

        for (let i = 1; i < points.length; i++) {
            const [p1, d1] = points[i];
            if (percentile <= p1) {
                const [p0, d0] = points[i - 1];
                const t = (percentile - p0) / (p1 - p0);
                return d0 + (d1 - d0) * t;
            }
        }
        return 0;
    };

    /*
     * ==================== 偷摸：原版成功／失敗難度 ====================
     *
     * difficulty = 300 + valueDifficulty + quantityDifficulty + timeModifier
     *
     * valueDifficulty 由商品目前所在的價格分位決定。
     * P10/P25/P50/P75/P90/P95 約對應 +0/+200/+400/+600/+800/+1000。
     *
     * quantityDifficulty = max(0, amount - 1) × 75
     *   - 第 1 個不加難度；從第 2 個起每多拿 1 個 +75。
     *
     * timeModifier 由 theftTimeModifier() 提供，19/20 點為負值。
     * 最終結果四捨五入且最低為 0。這個數值會寫入 $skulduggerydifficulty，
     * 真正成功／失敗仍由 DoL 原生 <<skulduggerycheck "silent">> 判定，HM 不另造成功率公式。
     *
     * 由於候選門檻與價格難度現在共用同一份動態價格分布，全局商品價格倍率只改變
     * 經濟金額，不會改變商品的相對價格分位，因此也不會額外放大偷摸難度。
     */
    HM.theftDifficulty = function (item, amount = 1, timeModifier = HM.theftTimeModifier()) {
        const valueDifficulty = HM.theftValueDifficulty(item);
        const quantityDifficulty = Math.max(0, Math.floor(amount) - 1) * 75;
        return Math.max(0, Math.round(valueDifficulty + 300 + quantityDifficulty + timeModifier));
    };

    HM.prepareTheft = function (categoryKey) {
        const V = State.variables;
        if (!HM.canUseMarket()) {
            delete V.honestMarketsTheft;
            return false;
        }
        const skulduggery = HM.getSkulduggery();
        const candidates = HM.getOffers(categoryKey).filter(offer => {
            if (!(offer.qty > 0)) return false;
            const item = setup.foodstuff?.[offer.id];
            return item && HM.canStealItem(item, skulduggery);
        });
        if (!candidates.length) {
            delete V.honestMarketsTheft;
            return false;
        }

        const offer = candidates[rand(0, candidates.length - 1)];
        const item = setup.foodstuff[offer.id];
        const theoreticalMaxAmount = HM.getStealMaxQty(item, skulduggery);
        const maxAmount = Math.min(offer.qty, theoreticalMaxAmount);
        const amount = rand(1, Math.max(1, maxAmount));
        const name = amount > 1
            ? (item.plural || item.singular || item.name || offer.id)
            : (item.singular || item.name || offer.id);

        const timeModifier = HM.theftTimeModifier();
        V.honestMarketsTheft = {
            categoryKey,
            id: offer.id,
            amount,
            /* Debug／狀態資訊：分開保留能力公式上限與庫存限制後上限，方便判斷本次隨機數量為何。 */
            stockQty: offer.qty,
            theoreticalMaxAmount,
            maxAmount,
            name,
            unitValue: Math.max(1, Number(item.shop.sell_price) || 1),
            /*
             * 原版 crimeUp() 的第一參數使用 £，而 foodstuff sell_price 使用便士。
             * 因此在找到目標時就把「單價 × 數量」換算成 £ 並鎖定。
             * 這個值只描述本次企圖竊取的實際財物價值，與百分位化的偷摸難度分開：
             * 全局價格倍率可以不改變相對難度，但仍應改變實際犯罪價值。
             */
            crimeValue: (Math.max(1, Number(item.shop.sell_price) || 1) * amount) / 100,
            itemPricePercentile: HM.theftPricePercentile(item),
            valueDifficulty: HM.theftValueDifficulty(item),
            pricePercentile: HM.theftPercentileForSkill(skulduggery),
            maxUnitValue: HM.maxStealableUnitValue(skulduggery),
            difficulty: HM.theftDifficulty(item, amount, timeModifier),
            timeModifierBase: timeModifier === 0 ? 0 : (HM.marketMinutes() >= 1200 ? -150 : -50),
            timeModifier
        };

        /*
         * ==================== 偷摸：失敗後被抓風險 ====================
         *
         * 這一層只在原版 skulduggerycheck 已經失敗後使用；成功時完全不骰被抓。
         * 因此「一次下手最後被抓」的總體風險約為：原版失敗率 × caughtChance。
         *
         * 先用能力負荷衡量玩家是否在勉強挑戰：
         *   load = difficulty / max(1, skulduggery)
         * max(1, ...) 只為避免詭術 0 時除以 0。
         *
         * 基礎被抓率：
         *   load <= 0.50 → 20%
         *   load >  0.50 → 20% + (load - 0.50) × 30%
         *   上限 65%
         * 例：load 0.50 = 20%、1.00 = 35%、1.50 = 50%、2.00 = 65%。
         *
         * 再乘 caughtVariance = 0.75～1.25，模擬攤販注意力、視線與周遭人流等現場差異。
         * 最終 caughtChance 限制為 10%～75%，避免任何目標變成近乎必抓或完全無風險。
         *
         * load、基礎率、波動倍率與最終率都在 prepareTheft() 找到目標時一次鎖定。
         * 這很重要：確認頁重繪或停留不能反覆洗 RNG；失敗時只拿已鎖定 caughtChance 做最後一次 0～1 骰值。
         */
        const theft = V.honestMarketsTheft;
        const load = theft.difficulty / Math.max(1, skulduggery);
        const baseCaughtChance = Math.min(0.65, Math.max(0.20, 0.20 + Math.max(0, load - 0.50) * 0.30));
        const caughtVariance = HM.randomFloat(0.75, 1.25);
        theft.caughtLoad = load;
        theft.baseCaughtChance = baseCaughtChance;
        theft.caughtVariance = caughtVariance;
        theft.caughtChance = Math.min(0.75, Math.max(0.10, baseCaughtChance * caughtVariance));
        return true;
    };

    // 讀取事件建立時鎖定的被抓率，並限制在 10%～75% 的有效範圍。
    HM.theftCaughtChance = function (theft = State.variables.honestMarketsTheft) {
        return theft ? Math.min(0.75, Math.max(0.10, Number(theft.caughtChance) || 0.20)) : 0;
    };

    // 只有偷摸失敗後才呼叫：抽 0～1，低於 caughtChance 即視為被當場抓到。
    HM.rollTheftCaught = function (theft = State.variables.honestMarketsTheft) {
        return HM.rollChance(HM.theftCaughtChance(theft) * 100);
    };

    HM.banMarketToday = function () {
        const day = HM.marketDay();
        if (day === null) return false;
        State.variables.honestMarketsBannedDay = day;
        HM.endVisit();
        return true;
    };

    HM.completeTheft = function () {
        const V = State.variables;
        const theft = V.honestMarketsTheft;
        if (!theft) return false;

        const offer = HM.getOffers(theft.categoryKey).find(entry => entry.id === theft.id && entry.qty > 0);
        if (!offer) return false;

        const amount = Math.min(Math.max(1, Math.floor(theft.amount || 1)), offer.qty);
        Wikifier.wikifyEval(`<<tending_give ${JSON.stringify(theft.id)} ${amount}>>`);
        offer.qty -= amount;
        if (offer.qty > 0) {
            offer.wholesaleTotal = Math.max(1, Math.round(offer.wholesaleUnit * offer.qty));
        }
        theft.amount = amount;
        return true;
    };

    HM.renderTheftAction = function (categoryKey) {
        if (!HM.canUseMarket()) return "";
        const skulduggery = HM.getSkulduggery();
        const candidates = HM.getOffers(categoryKey).filter(offer => {
            const item = setup.foodstuff?.[offer.id];
            return offer.qty > 0 && item && HM.canStealItem(item, skulduggery);
        });
        if (!candidates.length) {
            return `<<crimeicon "mark">><span class="grey">這裡暫時沒有你有把握下手的商品。</span><<crime "petty">><br>`;
        }
        return `<<crimeicon "mark">><<link "偷摸點東西 (00:05)" "HonestMarkets Steal">>` +
            `<<run setup.HonestMarkets.prepareTheft(${JSON.stringify(categoryKey)})>><<run setup.HonestMarkets.advanceMinutes(5)>><</link>>` +
            `<<crime "petty">><br>`;
    };

    HM.renderOffers = function () {
        if (HM.isBannedToday()) return `<span class="grey">${HM.marketBanText()}</span>`;
        if (!HM.isMarketOpen()) return `<span class="grey">${HM.marketClosedText()}</span>`;
        const key = State.variables.honestMarketsCategory;
        const category = HM.getCategories().find(cat => cat.key === key);
        if (!category) return '<span class="red">這個攤位已經找不到了。</span>';
        const offers = HM.getOffers(key);
        const available = offers.filter(offer => offer.qty > 0);
        if (!available.length) return '<span class="blue">這個分類的商品已經賣光了，也許應該再次探索市集。</span>';

        return offers.map((offer, i) => {
            if (offer.qty <= 0) return "";
            const item = setup.foodstuff[offer.id];
            const name = offer.qty > 1 ? (item.plural || item.singular || item.name || offer.id) : (item.singular || item.name || offer.id);
            const icon = `<<foodstufficon ${JSON.stringify(offer.id)}>>`;
            const state = HM.affordability(offer);
            const lotInfo = offer.qty > 1
                ? `${name} × ${offer.qty}個，整批 ${HM.moneyText(offer.wholesaleTotal)}`
                : `${name} × 1個，${HM.moneyText(offer.wholesaleTotal)}`;
            const marketHint = HM.renderMarketHint(offer);
            const favoriteHeart = HM.renderFavoriteHeart(key, offer.id);
            const favoritePurchase = HM.renderFavoritePurchaseLink(key, offer.id);
            const debugTip = HM.renderDebugTip(offer);

            if (state.mode === "single") {
                const label = `購買 1 個（${HM.moneyText(state.price)}）(00:05)`;
                return `${icon}${lotInfo}${marketHint}${favoriteHeart}${debugTip}<br>` +
                    `<<link ${JSON.stringify(label)} "HonestMarkets Category">>` +
                    `<<run setup.HonestMarkets.buy(setup.HonestMarkets.getOffers(${JSON.stringify(key)})[${i}], 1, "single")>><</link>><br>` +
                    `${favoritePurchase}<br>`;
            }

            if (state.mode === "wholesale") {
                const label = `整批購買 ${offer.qty} 個（${HM.moneyText(state.price)}）(00:05)`;
                return `${icon}${lotInfo}${marketHint}${favoriteHeart}${debugTip}<br>` +
                    `<<link ${JSON.stringify(label)} "HonestMarkets Category">>` +
                    `<<run setup.HonestMarkets.buy(setup.HonestMarkets.getOffers(${JSON.stringify(key)})[${i}], ${state.amount}, "wholesale")>><</link>><br>` +
                    `${favoritePurchase}<br>`;
            }

            if (state.mode === "partial") {
                const label = `你只夠買 ${state.amount} 個（${HM.moneyText(state.price)}）(00:05)`;
                return `${icon}${lotInfo}${marketHint}${favoriteHeart}${debugTip}<br>` +
                    `<<link ${JSON.stringify(label)} "HonestMarkets Category">>` +
                    `<<run setup.HonestMarkets.buy(setup.HonestMarkets.getOffers(${JSON.stringify(key)})[${i}], ${state.amount}, "partial")>><</link>><br>` +
                    `${favoritePurchase}<br>`;
            }

            return `${icon}${lotInfo}${marketHint}${favoriteHeart}${debugTip}<br><span class="grey">（你的錢不夠）</span><br>` +
                `${favoritePurchase}<br>`;
        }).join("");
    };


    // DoL 以 tending.has_seeds 判斷植物是否具有可購買種子。
    HM.isSeedPlant = function (item) {
        return !!(item?.tending?.has_seeds);
    };

    HM.getKnownPlants = function () {
        const known = State.variables.plants_known;
        if (Array.isArray(known)) return known;
        if (known && typeof known === "object") {
            return Object.keys(known).filter(key => known[key]);
        }
        return [];
    };

    HM.getSeedCatalog = function () {
        if (!setup.foodstuff) return [];
        const known = new Set(HM.getKnownPlants());
        return Object.entries(setup.foodstuff)
            .filter(([id, item]) => HM.isSeedPlant(item) && !known.has(id))
            .map(([id, item]) => ({ id, item }));
    };

    HM.seedPrice = function (item) {
        const sellPrice = Math.max(0, Number(item?.shop?.sell_price) || 0);
        /*
         * 種子價格同樣使用便士：
         *   raw = £1000 + sqrt(作物 sell_price / £1) × £250
         *       = 100000 + sqrt(sellPrice / 100) × 25000
         *
         * 平方根讓高價作物的種子會更貴，但不會與作物價格線性暴增。
         * 最後 ceil(raw / 1000) × 1000，亦即一律向上取整到 £10。
         */
        const raw = 100000 + Math.sqrt(sellPrice / 100) * 25000;
        return Math.ceil(raw / 1000) * 1000;
    };

    HM.seedDay = function () {
        if (typeof Time !== "undefined" && Number.isFinite(Number(Time.days))) {
            return Number(Time.days);
        }
        const V = State.variables;
        return Number(V.days) || Number(V.day) || 0;
    };

    // 每五個遊戲日為一個固定進貨週期。
    HM.seedCycle = function () {
        return Math.floor(HM.seedDay() / 5);
    };

    HM.generateDailySeeds = function () {
        const V = State.variables;
        const day = HM.seedDay();
        const cycle = HM.seedCycle();
        const catalog = HM.getSeedCatalog();
        const count = Math.min(catalog.length, rand(0, 3));
        const offers = shuffle(catalog).slice(0, count).map(({ id, item }) => ({
            id,
            price: HM.seedPrice(item)
        }));

        V.honestMarketsSeeds = {
            day,
            cycle,
            offers
        };
        return V.honestMarketsSeeds;
    };

    HM.ensureDailySeeds = function () {
        const V = State.variables;
        const cycle = HM.seedCycle();
        if (!V.honestMarketsSeeds ||
            V.honestMarketsSeeds.cycle !== cycle ||
            !Array.isArray(V.honestMarketsSeeds.offers)) {
            return HM.generateDailySeeds();
        }

        const known = new Set(HM.getKnownPlants());
        V.honestMarketsSeeds.offers = V.honestMarketsSeeds.offers.filter(
            offer => offer?.id && setup.foodstuff?.[offer.id] && !known.has(offer.id)
        );
        return V.honestMarketsSeeds;
    };

    HM.buySeed = function (id) {
        const V = State.variables;
        if (!HM.canUseMarket()) return false;
        const daily = HM.ensureDailySeeds();
        const index = daily.offers.findIndex(offer => offer.id === id);
        if (index < 0) return false;

        const item = setup.foodstuff?.[id];
        if (!HM.isSeedPlant(item)) {
            daily.offers.splice(index, 1);
            return false;
        }

        const known = HM.getKnownPlants();
        if (known.includes(id)) {
            daily.offers.splice(index, 1);
            return false;
        }

        const price = HM.seedPrice(item);
        if ((Number(V.money) || 0) < price) return false;

        V.money -= price;
        if (!Array.isArray(V.plants_known)) V.plants_known = [];
        if (!V.plants_known.includes(id)) V.plants_known.push(id);

        // 購買後立即移除，本週期不補貨。
        daily.offers.splice(index, 1);
        HM.advanceMinutes(5);
        return true;
    };

    HM.seedDisplayName = function (id) {
        const item = setup.foodstuff?.[id] || {};
        return item.tending?.seed_name ||
            item.singular ||
            item.plural ||
            item.name ||
            id;
    };

    HM.renderSeedDebugTip = function (id, price) {
        if (!State.variables.debug) return "";
        const item = setup.foodstuff?.[id] || {};
        const sellPrice = Math.max(0, Number(item?.shop?.sell_price) || 0);
        const raw = 100000 + Math.sqrt(sellPrice / 100) * 25000;
        const body = [
            `<b>HonestMarkets Seed Debug</b>`,
            `ID：${id}`,
            `Time.days：${HM.seedDay()}`,
            `五日週期：${HM.seedCycle()}`,
            `原始 sell_price：${HM.moneyText(sellPrice)}`,
            `固定基礎價：£1000`,
            `價值加成：${HM.moneyText(raw - 100000)}`,
            `取整前：${HM.moneyText(raw)}`,
            `最終種子價：${HM.moneyText(price)}`
        ].join("<br>");
        return ` <mouse class="tooltip-small linkBlue">(?)<span class="black">${body}</span></mouse>`;
    };

    HM.renderSeeds = function () {
        if (HM.isBannedToday()) return `<span class="grey">${HM.marketBanText()}</span>`;
        if (!HM.isMarketOpen()) return `<span class="grey">${HM.marketClosedText()}</span>`;
        const daily = HM.ensureDailySeeds();
        if (!daily.offers.length) {
            return '<span class="blue">這次進貨沒有看到你尚未解鎖的新種子，請等待下一次進貨。</span>';
        }

        return daily.offers.map(offer => {
            const id = offer.id;
            const item = setup.foodstuff?.[id];
            if (!item) return "";

            const price = HM.seedPrice(item);
            offer.price = price;

            const name = HM.seedDisplayName(id);
            const icon = `<<foodstufficon ${JSON.stringify(id)}>>`;
            const debugTip = HM.renderSeedDebugTip(id, price);

            if ((Number(State.variables.money) || 0) >= price) {
                const label = `購買${name}種子（${HM.moneyText(price)}）(00:05)`;
                return `${icon}${name}種子　${HM.moneyText(price)}${debugTip}<br>` +
                    `<<link ${JSON.stringify(label)} "HonestMarkets Seeds">>` +
                    `<<run setup.HonestMarkets.buySeed(${JSON.stringify(id)})>><</link>><br><br>`;
            }

            return `${icon}${name}種子　${HM.moneyText(price)}${debugTip}<br>` +
                `<span class="grey">（你的錢不夠）</span><br><br>`;
        }).join("");
    };

    /*
     * ==================== 服裝市場 ====================
     *
     * 服裝供貨與一般商品同時建立，但庫存及售出狀態分開保存。
     * 候選直接讀取 setup.clothes.all：只接受可在商店購買、價格大於 0、且不是
     * outfitSecondary 的項目。完整套裝只把主件當成一項商品；實際購買交由
     * 原版 <<generalSend>> 展開 outfitPrimary，避免在此重做套裝與衣櫃邏輯。
     */
    HM.CLOTHING_MIN_SHOWN = 5;
    HM.CLOTHING_MAX_SHOWN = 8;

    HM.getClothingCatalog = function () {
        const all = Array.isArray(setup.clothes?.all) ? setup.clothes.all : [];
        const special = Array.isArray(State.variables.specialClothes) ? State.variables.specialClothes : [];
        return all.filter(item => {
            if (!item || !item.slot || !(Number(item.cost) > 0)) return false;
            if (!Array.isArray(item.shop) || item.shop.length === 0) return false;
            if (item.outfitSecondary !== undefined) return false;
            const lock = special.find(entry => entry?.name === item.name);
            if (lock && Number(lock.unlocked) === 0) return false;
            const list = setup.clothes?.[item.slot];
            return Array.isArray(list) && list[item.index];
        });
    };

    HM.clothingItem = function (offer) {
        if (!offer) return null;
        return setup.clothes?.[offer.slot]?.[offer.index] || null;
    };

    HM.clothingBasePrice = function (item) {
        if (!item) return 0;
        try {
            if (typeof getClothingCost === "function") {
                return Math.max(1, Math.round(Number(getClothingCost(item, item.slot)) || 0));
            }
        } catch (error) {
            console.warn("[HonestMarkets] 無法取得原版服裝售價，改用 item.cost。", error);
        }
        return Math.max(1, Math.round(Number(item.cost) || 1));
    };

    // 行情以原版商店售價為中心；大多落在正常價附近，極端便宜或昂貴較少見。
    HM.rollClothingMultiplier = function () {
        const roll = rand(1, 100);
        let min, max;
        if (roll <= 10) [min, max] = [0.55, 0.75];
        else if (roll <= 35) [min, max] = [0.75, 0.95];
        else if (roll <= 65) [min, max] = [0.95, 1.05];
        else if (roll <= 90) [min, max] = [1.05, 1.30];
        else [min, max] = [1.30, 1.50];
        return Math.round((min + Math.random() * (max - min)) * 1000) / 1000;
    };

    HM.clothingColours = function (item) {
        const colours = Array.isArray(item?.colour_options)
            ? [...new Set(item.colour_options.filter(colour => colour && colour !== "custom"))]
            : [];
        if (!colours.length) return [null];
        return shuffle(colours).slice(0, Math.min(colours.length, rand(1, 3)));
    };

    HM.makeClothingOffer = function (item) {
        const basePrice = HM.clothingBasePrice(item);
        const multiplier = HM.rollClothingMultiplier();
        return {
            slot: item.slot,
            index: item.index,
            basePrice,
            multiplier,
            price: Math.max(1, Math.round(basePrice * multiplier)),
            variants: HM.clothingColours(item).map(colour => ({ colour, sold: false }))
        };
    };

    HM.generateClothingOffers = function () {
        const catalog = HM.getClothingCatalog();
        const count = Math.min(catalog.length, rand(HM.CLOTHING_MIN_SHOWN, HM.CLOTHING_MAX_SHOWN));
        const offers = shuffle(catalog).slice(0, count).map(item => HM.makeClothingOffer(item));
        const visit = HM.ensureVisit();
        visit.clothing = offers;
        return offers;
    };

    HM.getClothingOffers = function () {
        const visit = HM.ensureVisit();
        if (!Array.isArray(visit.clothing)) HM.generateClothingOffers();
        return visit.clothing;
    };

    HM.hasClothingStock = function () {
        return HM.getClothingOffers().some(offer => offer.variants?.some(variant => !variant.sold));
    };

    HM.clothingDisplayName = function (item) {
        return item?.cn_name_cap || item?.name_cap || item?.cn_name || item?.name || "服裝";
    };

    HM.clothingColourInfo = function (colour) {
        if (!colour) return { key: null, name: "", css: "#888" };
        let record = null;
        try {
            record = typeof setup.guessColourInMap === "function"
                ? setup.guessColourInMap(setup.colours?.clothes_map || {}, colour)
                : setup.colours?.clothes_map?.[colour];
        } catch (_) { /* 第三方顏色資料異常時只使用 fallback。 */ }
        return {
            key: colour,
            name: record?.name || (typeof setup.colourName === "function" ? setup.colourName(colour) : colour),
            css: record?.canvasfilter?.blend || "#888"
        };
    };

    HM.clothingDebugText = function (offer) {
        if (State.variables.debug !== 1 || !offer) return "";
        return `原價 ${HM.moneyText(offer.basePrice)}｜倍率 ${Number(offer.multiplier).toFixed(3)}×｜市場價 ${HM.moneyText(offer.price)}`;
    };

    // 服裝詳情只記錄本次檢視的供貨索引與顏色，不改動市場庫存或角色穿著。
    HM.selectClothingPreview = function (offerIndex, variantIndex) {
        const offer = HM.getClothingOffers()[Number(offerIndex)];
        const variant = offer?.variants?.[Number(variantIndex)];
        if (!variant || !HM.clothingItem(offer)) return false;
        State.variables.honestMarketsClothingPreview = {
            offerIndex: Number(offerIndex), variantIndex: Number(variantIndex)
        };
        return true;
    };

    HM.getClothingPreview = function () {
        const selection = State.variables.honestMarketsClothingPreview;
        if (!selection) return null;
        const offer = HM.getClothingOffers()[selection.offerIndex];
        const variant = offer?.variants?.[selection.variantIndex];
        const item = HM.clothingItem(offer);
        return variant && item ? { offer, variant, item } : null;
    };

    HM.buyClothing = function (offerIndex, variantIndex) {
        const V = State.variables;
        if (!HM.canUseMarket()) return false;
        const offers = HM.getClothingOffers();
        const offer = offers[Number(offerIndex)];
        const variant = offer?.variants?.[Number(variantIndex)];
        const item = HM.clothingItem(offer);
        if (!offer || !variant || variant.sold || !item) return false;
        if ((Number(V.money) || 0) < offer.price) return false;

        const colourArg = variant.colour == null ? "undefined" : JSON.stringify(variant.colour);
        try {
            Wikifier.wikifyEval(
                `<<money -${offer.price} "clothes">>` +
                `<<generalSend "wardrobe" ${JSON.stringify(offer.slot)} ${offer.index} ${colourArg}>>`
            );
        } catch (error) {
            console.error("[HonestMarkets] 服裝購買失敗。", error);
            return false;
        }

        variant.sold = true;
        HM.advanceMinutes(5);
        return true;
    };

    /*
     * 服裝市場顯示沿用 HonestMarkets 既有的 render* → Macro.add → Twee 呼叫架構。
     * 與 renderOffers() / renderSeeds() 相同，商品迴圈、購買連結、售出與金錢判定
     * 全部在 JS 產生 Wikifier 內容；Twee Passage 只負責場景敘述與呼叫巨集。
     */
    HM.renderClothing = function () {
        if (HM.isBannedToday()) return `<span class="grey">${HM.marketBanText()}</span>`;
        if (!HM.isMarketOpen()) return `<span class="grey">${HM.marketClosedText()}</span>`;

        const offers = HM.getClothingOffers();
        if (!offers.length) return '<span class="grey">這一輪沒有找到可出售的服裝。</span>';

        const body = offers.map((offer, offerIndex) => {
            const item = HM.clothingItem(offer);
            if (!item) return "";

            const name = HM.clothingDisplayName(item);
            // 與 Spare Outfits / 原版衣物 UI 相同，交給原版 clothingicon 巨集產生圖示。
            // 不自行拼 iconFile 路徑，避免不同版本或第三方服裝的資源位置差異。
            const icon = `<<clothingicon setup.HonestMarkets.clothingItem(setup.HonestMarkets.getClothingOffers()[${offerIndex}]) ${JSON.stringify(offer.slot)}>>`;
            const debugTip = State.variables.debug
                ? ` <mouse class="tooltip-small linkBlue">(?)<span class="black"><b>HonestMarkets Clothing Debug</b><br>${HM.clothingDebugText(offer)}<br>Slot：${offer.slot}<br>Index：${offer.index}</span></mouse>`
                : "";

            const variants = (offer.variants || []).map((variant, variantIndex) => {
                const colour = HM.clothingColourInfo(variant.colour);
                const swatch = `<span class="hm-clothing-swatch" style="background-color:${colour.css}"></span>`;
                const label = variant.colour ? colour.name : "購買";

                if (variant.sold) {
                    return `<span class="hm-clothing-variant hm-clothing-sold">${swatch}${variant.colour ? `${colour.name} ` : ""}已售出</span>`;
                }
                if ((Number(State.variables.money) || 0) < offer.price) {
                    return `<span class="hm-clothing-variant grey">${swatch}${variant.colour ? `${colour.name} ` : ""}（你的錢不夠）</span>`;
                }

                return `<span class="hm-clothing-variant">${swatch}` +
                    `<<link ${JSON.stringify(label)} "HonestMarkets Clothing">>` +
                    `<<run setup.HonestMarkets.buyClothing(${offerIndex}, ${variantIndex})>><</link>></span>`;
            }).join("");

            const previews = (offer.variants || []).map((variant, variantIndex) => {
                const colour = HM.clothingColourInfo(variant.colour);
                const label = variant.colour ? `預覽：${colour.name}` : "查看詳情與預覽";
                return `<<link ${JSON.stringify(label)}>>` +
                    `<<run setup.HonestMarkets.openClothingModal(${offerIndex}, ${variantIndex})>><</link>>`;
            }).join("　");

            return `<div class="hm-clothing-offer">` +
                `<div class="hm-clothing-heading"><span class="hm-clothing-icon">${icon}</span>` +
                `<span class="hm-clothing-name">${name}</span>` +
                `<span class="hm-clothing-price">${HM.moneyText(offer.price)}</span>${debugTip}</div>` +
                `<div class="hm-clothing-variants">${variants}</div>` +
                `<div class="hm-clothing-previews">${previews}</div></div>`;
        }).join("");

        return `<div class="hm-clothing-list">${body}</div>`;
    };

    /**
     * 服裝詳情彈窗：共用 Clothing Preview Passage 作為內容模板。
     * 僅管理 DOM 與焦點，不修改供貨、交易及市場訪問狀態。
     */
    HM._clothingModal = null;
    HM.isClothingModalOpen = function () {
        return !!(HM._clothingModal && HM._clothingModal.isConnected);
    };
    HM.closeClothingModal = function () {
        const root = HM._clothingModal;
        HM._clothingModal = null;
        if (!root) return;
        document.removeEventListener("keydown", root._hmOnKeydown);
        root.remove();
        if (root._hmFocus && root._hmFocus.isConnected) root._hmFocus.focus();
    };
    // 清除舊內容後重新 Wikify 詳情模板，供手動快取刷新使用。
    HM.redrawClothingModal = function () {
        const root = HM._clothingModal;
        if (!root || !root.isConnected) return;
        const body = root.querySelector(".hm-clothing-modal-body");
        if (!body) return;
        // 清空舊 Canvas，避免非同步渲染完成後混入新的預覽節點。
        body.replaceChildren();
        try {
            // 保留原有完整詳情及原版 Canvas 模型，不複製另一套商品邏輯。
            new Wikifier(body, Story.get("HonestMarkets Clothing Preview").text);
        } catch (error) {
            console.error("[HonestMarkets] 服裝預覽彈窗渲染失敗", error);
            body.textContent = "服裝預覽載入失敗，請關閉後重試。";
        }
    };
    // 直接在當前市場 Passage 建立彈窗，不導覽或重新抽取供貨。
    HM.openClothingModal = function (offerIndex, variantIndex) {
        HM.closeClothingModal();
        HM.selectClothingPreview(offerIndex, variantIndex);
        if (!HM.getClothingPreview()) return;
        const root = document.createElement("div");
        root.className = "hm-clothing-modal-overlay";
        root.setAttribute("role", "presentation");
        root._hmFocus = document.activeElement;
        const panel = document.createElement("div");
        panel.className = "hm-clothing-modal-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", "服裝詳情與預覽");
        panel.setAttribute("tabindex", "-1");
        const close = document.createElement("button");
        close.type = "button";
        close.className = "hm-clothing-modal-close";
        close.setAttribute("aria-label", "關閉服裝預覽");
        close.textContent = "×";
        close.addEventListener("click", HM.closeClothingModal);
        const body = document.createElement("div");
        body.className = "hm-clothing-modal-body";
        panel.append(close, body);
        root.append(panel);
        root.addEventListener("click", event => {
            if (event.target === root) HM.closeClothingModal();
        });
        root._hmOnKeydown = event => {
            if (event.key === "Escape") { event.preventDefault(); HM.closeClothingModal(); }
            if (event.key === "Tab") {
                const nodes = [...panel.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')]
                    .filter(node => node.getClientRects().length);
                if (!nodes.length) { event.preventDefault(); panel.focus(); return; }
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener("keydown", root._hmOnKeydown);
        document.body.appendChild(root);
        HM._clothingModal = root;
        HM.redrawClothingModal();
        close.focus();
    };
    // 任何 Passage 導航（包括購買事件）都應自動關閉彈窗。
    if (typeof $ === "function") {
        $(document).on(":passagestart.hmClothingModal", HM.closeClothingModal);
    }

    HM.currentCategoryName = function () {
        const key = State.variables.honestMarketsCategory;
        return HM.getCategories().find(cat => cat.key === key)?.name || "商品";
    };

    HM.renderOptionsControl = function (output) {
        /*
         * Maplebirch 只負責把 <<HonestMarkets_options>> 掛進 Options。
         * 此處完全使用 DOM API 建立獨立區塊，避免與其他 Mod 的設定內容混成同一組，
         * 也避免把可變數值或文字拼進 HTML 字串。
         */
        // Maplebirch 會把這個節點插入 Options；標題與內容保持同層，避免把設定內容塞進 settingsHeader。
        const root = document.createElement("div");
        root.className = "honest-markets-options-root";

        const heading = document.createElement("div");
        heading.className = "settingsHeader options";
        heading.textContent = "誠信小販+";
        root.appendChild(heading);

        const content = document.createElement("div");
        content.className = "honest-markets-options";
        root.appendChild(content);

        const style = document.createElement("style");
        style.textContent = [
            ".honest-markets-options{padding:.2em .15em .35em}",
            ".honest-markets-options .hm-options-description{margin:.15em 0 .7em;line-height:1.55}",
            ".honest-markets-options .hm-option-row{padding:.85em .2em .95em;margin:0;border-top:1px solid rgba(128,128,128,.22)}",
            ".honest-markets-options .hm-option-heading{display:flex;align-items:center;gap:.5em;flex-wrap:wrap;margin-bottom:.22em}",
            ".honest-markets-options .hm-option-title{font-weight:700;line-height:1.35}",
            ".honest-markets-options .hm-option-scope{display:inline-block;padding:.08em .5em;border:1px solid currentColor;border-radius:999px;font-size:.78em;line-height:1.45;opacity:.72}",
            ".honest-markets-options .hm-option-description{margin:0 0 .55em;line-height:1.45;opacity:.88}",
            ".honest-markets-options .hm-option-controls{display:flex;align-items:center;gap:.35em;min-width:0}",
            ".honest-markets-options .hm-option-controls button{min-width:2.8em;padding:.25em .48em}",
            ".honest-markets-options .hm-option-controls input[type=range]{flex:1 1 240px;min-width:90px;margin:0 .1em}",
            ".honest-markets-options .hm-option-value{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:4.4em;padding:.18em .55em;border:1px solid rgba(128,128,128,.42);border-radius:999px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}",
            ".honest-markets-options .hm-option-note{margin-top:.42em;line-height:1.4;font-size:.92em}",
            ".honest-markets-options .hm-options-footer{display:flex;justify-content:flex-end;padding:.9em .2em .2em;border-top:1px solid rgba(128,128,128,.22)}",
            ".honest-markets-options .hm-reset{padding:.3em .8em}",
            "@media(max-width:520px){.honest-markets-options .hm-option-controls{flex-wrap:wrap}.honest-markets-options .hm-option-controls input[type=range]{order:2;flex:1 0 100%;margin:.25em 0}.honest-markets-options .hm-option-value{margin-left:auto}}"
        ].join("");
        root.appendChild(style);

        const description = document.createElement("p");
        description.className = "hm-options-description";
        description.textContent = "調整動態市場的商品供應規模，以及遊戲中的整體商品價格。市場供應設定從下一次建立的新市場生效；全局商品價格倍率則會立即套用。";
        content.appendChild(description);

        const makeButton = (label, delta) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.dataset.delta = String(delta);
            return button;
        };

        const makeOption = ({ key, title, scopeLabel, descriptionText, min, max, step, deltas, note }) => {
            const row = document.createElement("div");
            row.className = "hm-option-row";
            row.dataset.key = key;

            const headingRow = document.createElement("div");
            headingRow.className = "hm-option-heading";

            const titleNode = document.createElement("div");
            titleNode.className = "hm-option-title";
            titleNode.textContent = title;
            headingRow.appendChild(titleNode);

            if (scopeLabel) {
                const scope = document.createElement("span");
                scope.className = "hm-option-scope";
                scope.textContent = scopeLabel;
                headingRow.appendChild(scope);
            }

            row.appendChild(headingRow);

            const desc = document.createElement("p");
            desc.className = "hm-option-description";
            desc.textContent = descriptionText;
            row.appendChild(desc);

            const controls = document.createElement("div");
            controls.className = "hm-option-controls";

            const negative = deltas.filter(delta => delta < 0);
            const positive = deltas.filter(delta => delta > 0);
            negative.forEach(delta => controls.appendChild(makeButton(String(delta), delta)));

            const input = document.createElement("input");
            input.type = "range";
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.setAttribute("aria-label", title);
            controls.appendChild(input);

            positive.forEach(delta => controls.appendChild(makeButton(`+${delta}`, delta)));

            const value = document.createElement("span");
            value.className = "hm-option-value";
            value.setAttribute("aria-live", "polite");
            controls.appendChild(value);
            row.appendChild(controls);

            if (note) {
                const noteNode = document.createElement("div");
                noteNode.className = "hm-option-note grey";
                noteNode.textContent = note;
                row.appendChild(noteNode);
            }

            content.appendChild(row);
            return row;
        };

        makeOption({
            key: "minShown",
            title: "每分類最少商品數量",
            descriptionText: "控制每個商品分類在新市場中隨機抽取的最低商品種類數。",
            min: HM.config.shownMinLimit,
            max: HM.config.shownMaxLimit,
            step: 1,
            deltas: [-1, 1],
            note: `範圍 ${HM.config.shownMinLimit}～${HM.config.shownMaxLimit}，預設 ${HM.config.minShown}；不會高於「每分類最多商品數量」。`
        });

        makeOption({
            key: "maxShown",
            title: "每分類最多商品數量",
            descriptionText: "控制每個商品分類在新市場中隨機抽取的最高商品種類數。",
            min: HM.config.shownMinLimit,
            max: HM.config.shownMaxLimit,
            step: 1,
            deltas: [-1, 1],
            note: `範圍 ${HM.config.shownMinLimit}～${HM.config.shownMaxLimit}，預設 ${HM.config.maxShown}；不會低於「每分類最少商品數量」。`
        });

        makeOption({
            key: "maxLot",
            title: "市場最大批次數量",
            descriptionText: "控制一般商品單批可能生成的最大數量。數值越高，大批與清倉可能出現更多庫存；實際數量仍會依商品價值與批次類型決定。",
            min: 0,
            max: 1000,
            step: 1,
            deltas: [-10, -1, 1, 10],
            note: `範圍 ${HM.config.maxLotMin}～${HM.config.maxLotMax}，預設 ${HM.config.maxLot}。滑塊採兩段式映射，並可用左右按鈕精細調整。`
        });

        makeOption({
            key: "priceMultiplier",
            title: "全局商品價值倍率",
            scopeLabel: "全局・所有存檔",
            descriptionText: "調整遊戲中商品的整體價格尺度，會同時影響商品的購買與出售價格，以及 HonestMarkets 等相關系統。此設定為全局設定，會套用至所有存檔。",
            min: HM.config.priceMultiplierMin,
            max: HM.config.priceMultiplierMax,
            step: 1,
            deltas: [-10, -1, 1, 10],
            note: `範圍 ${HM.config.priceMultiplierMin}×～${HM.config.priceMultiplierMax}×，預設 ${HM.config.priceMultiplier}×；建議 5～20×。注意：提高倍率後，超市等商店的商品價格也會同步提高。`
        });

        const footer = document.createElement("div");
        footer.className = "hm-options-footer";
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "hm-reset";
        reset.textContent = "恢復預設";
        footer.appendChild(reset);
        content.appendChild(footer);

        /*
         * 這個介面同時呈現兩種不同生命週期的設定：
         * 市場供應設定屬於存檔資料，下一次建立市場時才影響新供貨；
         * 全局商品價格倍率跨存檔共用，操作後立即套用。
         * refresh() 僅把目前有效值同步到控制項，不負責改寫設定。
         */
        const refresh = () => {
            const settings = HM.getMarketSettings();
            root.querySelectorAll(".hm-option-row").forEach(row => {
                const key = row.dataset.key;
                const input = row.querySelector('input[type="range"]');
                const value = key === "priceMultiplier" ? HM.getPriceMultiplier() : settings[key];
                input.value = key === "maxLot" ? HM.maxLotToSlider(value) : value;
                row.querySelector(".hm-option-value").textContent = key === "priceMultiplier" ? `${value}×` : String(value);

                row.querySelectorAll("button[data-delta]").forEach(button => {
                    const delta = Number(button.dataset.delta);
                    const limit = key === "maxLot"
                        ? (delta < 0 ? HM.config.maxLotMin : HM.config.maxLotMax)
                        : key === "priceMultiplier"
                            ? (delta < 0 ? HM.config.priceMultiplierMin : HM.config.priceMultiplierMax)
                            : (delta < 0 ? HM.config.shownMinLimit : HM.config.shownMaxLimit);
                    button.disabled = delta < 0 ? value <= limit : value >= limit;
                });
            });
        };

        root.querySelectorAll(".hm-option-row").forEach(row => {
            const key = row.dataset.key;
            const input = row.querySelector('input[type="range"]');
            input.addEventListener("input", () => {
                if (key === "priceMultiplier") HM.applyFoodstuffPriceMultiplier(input.value);
                else HM.setMarketSetting(key, key === "maxLot" ? HM.sliderToMaxLot(input.value) : input.value);
                refresh();
            });
            row.querySelectorAll("button[data-delta]").forEach(button => {
                button.addEventListener("click", () => {
                    const settings = HM.getMarketSettings();
                    if (key === "priceMultiplier") {
                        HM.applyFoodstuffPriceMultiplier(HM.getPriceMultiplier() + Number(button.dataset.delta));
                    } else {
                        HM.setMarketSetting(key, settings[key] + Number(button.dataset.delta));
                    }
                    refresh();
                });
            });
        });

        reset.addEventListener("click", () => {
            HM.resetMarketSettings();
            HM.applyFoodstuffPriceMultiplier(HM.config.priceMultiplier);
            refresh();
        });

        refresh();
        output.appendChild(root);
    };

    Macro.add("HonestMarkets_options", {
        handler() { HM.renderOptionsControl(this.output); }
    });

    HM.registerOptions = function () {
        if (HM._optionsRegistered) return true;
        if (!window.maplebirch?.tool?.addTo) return false;
        maplebirch.tool.addTo("Options", "HonestMarkets_options");
        HM._optionsRegistered = true;
        return true;
    };

    if (!HM.registerOptions()) {
        $(document).one(":passageinit.honestMarketsOptions", () => HM.registerOptions());
    }

    /*
     * 每日全局行情只由 Maplebirch 的 onDay 時間事件刷新。事件每次觸發時為所有
     * foodstuff 產生新的當日倍率，再從原版價格快照完整重算 sell_price。
     */
    HM.registerDailyPriceEvent = function () {
        if (HM._dailyPriceEventRegistered) return true;
        if (!window.maplebirch?.dynamic?.regTimeEvent) return false;
        maplebirch.dynamic.regTimeEvent("onDay", "HonestMarkets:dailyPrices", {
            cond: () => true,
            action: () => HM.rollDailyPriceFluctuations()
        });
        HM._dailyPriceEventRegistered = true;
        return true;
    };

    if (!HM.registerDailyPriceEvent()) {
        $(document).one(":passageinit.honestMarketsDailyPriceEvent", () => HM.registerDailyPriceEvent());
    }

    // setup.foodstuff 完成後建立當日行情；已有同日存檔資料時只重新套價，不重新抽取。
    $(document).one(":passageinit.honestMarketsPriceEngine", () => {
        HM.captureBaseFoodstuffPrices();
        HM.ensureDailyPriceFluctuations();
        HM.applyGlobalFoodstuffPrices();
    });

    Macro.add("honestMarketsBegin", {
        handler() { HM.ensureVisit(); }
    });
    Macro.add("honestMarketsCategories", {
        handler() { new Wikifier(this.output, HM.renderCategories()); }
    });
    Macro.add("honestMarketsOffers", {
        handler() { new Wikifier(this.output, HM.renderOffers()); }
    });
    Macro.add("honestMarketsOrphanage", {
        handler() { new Wikifier(this.output, HM.renderOrphanageOrder()); }
    });
    Macro.add("honestMarketsOrphanageDebug", {
        handler() { new Wikifier(this.output, HM.renderOrphanageDebug()); }
    });
    Macro.add("honestMarketsOrphanageList", {
        handler() { new Wikifier(this.output, HM.renderOrphanageOrderList()); }
    });
    Macro.add("honestMarketsTheftAction", {
        handler() {
            const key = State.variables.honestMarketsCategory;
            new Wikifier(this.output, HM.renderTheftAction(key));
        }
    });
    Macro.add("honestMarketsSeeds", {
        handler() { new Wikifier(this.output, HM.renderSeeds()); }
    });
    Macro.add("honestMarketsClothing", {
        handler() { new Wikifier(this.output, HM.renderClothing()); }
    });
    Macro.add("honestMarketsMarketJournal", {
        handler() {
            const root = document.createElement("div");
            root.className = "hm-market-journal-root";
            this.output.appendChild(root);
            new Wikifier(root, HM.renderMarketJournal());

            const select = root.querySelector(".hm-market-journal-select");
            if (select) {
                select.value = "all";
                select.addEventListener("change", () => HM.filterMarketJournal(root, select.value));
            }

            root.querySelectorAll(".hm-market-journal-item").forEach(card => {
                const openDetail = event => {
                    event.stopPropagation();
                    HM.openMarketJournalDetail(card.dataset.hmMarketId, card);
                };
                card.addEventListener("click", openDetail);
                card.addEventListener("keydown", event => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openDetail(event);
                });
            });

            if (!HM.marketJournalOutsideClickBound) {
                /*
                 * 外部點擊關閉使用 capture phase 的 pointerdown。
                 * DoL / SugarCube 的部分介面會在較內層攔截 click 冒泡，因此不能依賴 document click。
                 */
                document.addEventListener("pointerdown", event => {
                    if (!HM.marketJournalDetailState) return;
                    const target = event.target instanceof Element ? event.target : null;
                    if (target?.closest(".hm-market-journal-popover")) return;
                    if (target?.closest(".hm-market-journal-item")) return;
                    HM.closeMarketJournalDetail();
                }, true);
                HM.marketJournalOutsideClickBound = true;

                $(document).on(":passageinit.honestMarketsMarketJournal", () => {
                    HM.closeMarketJournalDetail();
                });
            }
        }
    });


})();
