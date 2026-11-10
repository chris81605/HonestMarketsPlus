/* HonestMarkets 通用追逐引擎 v2.1。狀態保存在事件 e.chase；引擎不負責事件劇情、戰鬥或結果清理。 */
(() => {
    "use strict";
    const HM = setup.HonestMarkets;
    const C = HM.chase = {};
    // 建立時固定設定並保存於事件狀態，重繪與讀檔不會重新抽取。
    const defaults = {playerRole:"runner",pursuerName:"追逐者",title:"巷道追逐",stage:"follow_chase",onEscape:"follow_escape",onCaught:"follow_caught",onCatch:"follow_caught",difficulty:1};
    const nameOf = s => (s.config && s.config.pursuerName) || defaults.pursuerName;
    const configOf = s => ({...defaults,...(s.config||{})});
    const random = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
    const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
    const fmt = v => Math.round(v*10)/10;
    // 環境事件定義：每場追逐複製設定，不會污染其他事件或預設事件庫。
    const defaultObstacles = [
        {id:"trash_bin",kind:"obstacle",name:"垃圾桶",cost:15,reach:6,slow:7,description:"路旁的垃圾桶",texts:{playerTrigger:"你掀翻垃圾桶，試圖阻擋追兵。",npcTrigger:"{npc}推倒垃圾桶，擋住你的去路。",playerAffected:"你被垃圾桶阻礙了腳步。",npcAffected:"{npc}被垃圾桶阻礙了腳步。"}},
        {id:"boxes",kind:"obstacle",name:"紙箱堆",cost:12,reach:6,slow:5,description:"堆疊的紙箱",texts:{playerTrigger:"你推倒紙箱堆，阻擋追兵。",npcTrigger:"{npc}推倒紙箱堆，阻擋你的追趕。",playerAffected:"你被散落的紙箱絆住。",npcAffected:"{npc}被散落的紙箱絆住。"}},
        {id:"cart",kind:"obstacle",name:"手推車",cost:20,reach:5,slow:11,description:"停放在路旁的手推車",texts:{playerTrigger:"你猛地推倒手推車！",npcTrigger:"{npc}推倒手推車，擋住道路。",playerAffected:"你被手推車擋住去路。",npcAffected:"{npc}被手推車擋住去路。"}}
    ];
    const defaultHides = [
        {id:"doorway",kind:"hide",name:"凹陷門廊",cost:10,reach:4,cover:.13},
        {id:"dumpster",kind:"hide",name:"大型垃圾箱後方",cost:10,reach:4,cover:.25},
        {id:"stairs",kind:"hide",name:"樓梯下方陰影",cost:10,reach:4,cover:.22}
    ];
    const defaultHazards = [
        {id:"pothole",name:"坑洞",effect:"distance",sharedOnce:false,texts:{playerAffected:"你一腳踩進坑洞，連忙調整重心。",npcAffected:"{npc}踩進坑洞，踉蹌了一下。"}},
        {id:"stray_cat",name:"野貓",effect:"distance",sharedOnce:true,texts:{playerAffected:"一隻野貓突然竄出，你慌忙閃避。",npcAffected:"一隻野貓竄出，{npc}急忙閃避。"}},
        {id:"stray_dog",name:"野狗",effect:"ap",sharedOnce:true,texts:{playerAffected:"一隻狗突然衝出，你費力穩住腳步。",npcAffected:"一隻狗突然衝出，{npc}被嚇得放慢腳步。"}},
        {id:"slippery",name:"濕滑路面",effect:"distance",sharedOnce:false,texts:{playerAffected:"你踩上濕滑地面，腳步打滑。",npcAffected:"{npc}踩上濕滑地面，腳步打滑。"}},
        {id:"debris",name:"散落雜物",effect:"ap",sharedOnce:false,texts:{playerAffected:"你踢到散落的瓶罐，急忙站穩。",npcAffected:"{npc}踢到散落的雜物，腳步一亂。"}},
        {id:"door",name:"突然開啟的門",effect:"ap",sharedOnce:true,texts:{playerAffected:"一旁的門突然推開，你急忙側身避讓。",npcAffected:"一旁的門突然推開，{npc}急忙避讓。"}}
    ];
    const expandText=(text,s)=>String(text||"").replace(/\{npc\}/g,nameOf(s));
    const effectText=(obj,key,s,fallback)=>expandText(obj.texts?.[key]||fallback,s);
    // options.environment 可用 false 禁用類別、字串 ID 限定預設項目，或完整物件新增／覆寫。
    function catalog(defaults,selection,kind) {
        if(selection===false)return [];
        if(selection===undefined||selection===true)return defaults.map(x=>structuredCloneSafe(x));
        if(!Array.isArray(selection))throw new Error(`environment.${kind} 必須為陣列或布林值`);
        return selection.map(entry=>{
            const id=typeof entry==="string"?entry:entry?.id;
            const base=defaults.find(x=>x.id===id);
            if(!base && (typeof entry!=="object"||!entry))throw new Error(`未知環境事件 ${id}`);
            const item={...(base||{}),...(typeof entry==="object"?entry:{})};
            item.texts={...(base?.texts||{}),...(item.texts||{})};
            if(typeof item.name!=="string"||!item.name)throw new Error(`環境事件 ${id} 缺少名稱`);
            if(kind==="hazards" && !["ap","distance"].includes(item.effect))throw new Error(`暗雷 ${id} 效果無效`);
            item.kind=kind==="hazards"?"hazard":kind==="hiding"?"hide":"obstacle";
            return item;
        });
    }
    const structuredCloneSafe = x => ({...x,texts:{...(x.texts||{})}});
    // 自訂行動只保存在本場追逐的 config.actions；不建立全域行動庫。
    // 使用純資料效果，確保 SugarCube 存檔及讀檔後仍可執行。
    const actionIds = new Set(["run","sprint","rest","hide","topple","clear","catch","search","continue"]);
    function validateActions(actions) {
        if(actions===undefined)return [];
        if(!Array.isArray(actions))throw new Error("actions 必須為陣列");
        const seen=new Set();
        return actions.map(a=>{
            if(!a||typeof a!=="object"||typeof a.id!=="string"||!/^[a-z][a-z0-9_]*$/i.test(a.id)||actionIds.has(a.id)||seen.has(a.id))
                throw new Error("追逐自訂行動 ID 無效或重複");
            if(typeof a.name!=="string"||!a.name.trim())throw new Error(`行動 ${a.id} 缺少名稱`);
            if(!Number.isFinite(a.apCost)||a.apCost<0||a.apCost>100)throw new Error(`行動 ${a.id} AP 消耗無效`);
            if(!Array.isArray(a.effects))throw new Error(`行動 ${a.id} 必須提供 effects 陣列`);
            seen.add(a.id);
            // 僅允許可序列化資料；效果的隨機抽選在實際執行時才進行。
            if(JSON.stringify(a)===undefined)throw new Error(`行動 ${a.id} 無法保存`);
            return JSON.parse(JSON.stringify(a));
        });
    }
    function customAvailable(s,a,followUp=false) {
        const cost=followUp&&Number.isFinite(a.followUpCost)?a.followUpCost:a.apCost;
        if(s.outcome||s.search||s.player.ap<cost)return false;
        if(a.playerRole&&a.playerRole!==configOf(s).playerRole)return false;
        const gap=Math.abs(s.player.position-s.pursuer.position);
        return !(Number.isFinite(a.maxGap)&&gap>a.maxGap);
    }
    // 標準效果可組合；chance 分支按權重抽取，避免每次重繪重新擲骰。
    function applyCustomEffects(s,effects) {
        const logs=[];
        for(const effect of effects) {
            if(!effect||typeof effect!=="object")continue;
            if(effect.type==="message")logs.push(expandText(effect.text,s));
            else if(effect.type==="ap"){
                const entity=effect.target==="npc"?s.pursuer:s.player;
                entity.ap=clamp(entity.ap+(Number(effect.value)||0),0,100);
            } else if(effect.type==="stun"){
                if(effect.target==="npc")s.npcSkipTurns=clamp((s.npcSkipTurns||0)+(Math.floor(Number(effect.turns))||1),0,10);
            } else if(effect.type==="escape"||effect.type==="catch"){
                s.outcome=effect.type==="escape"?"escaped":"caught";
            } else if(effect.type==="chance"){
                const options=(effect.outcomes||[]).filter(o=>Number(o.weight)>0);
                const total=options.reduce((n,o)=>n+Number(o.weight),0);
                if(!total)continue;
                let roll=Math.random()*total;
                const chosen=options.find(o=>(roll-=Number(o.weight))<0)||options[options.length-1];
                if(chosen.message)logs.push(expandText(chosen.message,s));
                logs.push(...applyCustomEffects(s,chosen.effects||[]));
            }
        }
        return logs.filter(Boolean);
    }
    function customAction(s,action,followUp=false) {
        const a=(s.config.actions||[]).find(a=>a.id===action);
        if(!a||!customAvailable(s,a,followUp))return null;
        s.player.ap-=followUp&&Number.isFinite(a.followUpCost)?a.followUpCost:a.apCost;
        const hazard=applyHazard(s,"player",0);
        const logs=[a.message||`你嘗試${a.name}。`,hazard.text,...applyCustomEffects(s,a.effects)];
        return logs.filter(Boolean).map(t=>expandText(t,s)).join(" ");
    }
    const dancing = () => clamp(Number(State.variables.danceskill)||0,0,1000);
    // 舞蹈技能越高損失越低，但最低仍有少量懲罰；技能不影響是否踩雷。
    function hazardPenalty(h, distance, actor, s) {
        const skill=actor==="player"?dancing():clamp(Number(s.pursuer.dancing)||0,0,1000);
        const ratio=.35-.30*skill/1000;
        const key=actor==="player"?"playerAffected":"npcAffected";
        const intro=effectText(h,key,s,actor==="player"?`你遭遇${h.name}。`:`{npc}遭遇${h.name}。`);
        if(h.effect==="distance"&&distance>0)
            return {distance:fmt(Math.max(0,distance*(1-ratio))),ap:0,text:`${intro} 移動距離受到影響。`};
        const ap=Math.max(1,Math.round(10-8*skill/1000));
        return {distance,ap,text:`${intro} 額外消耗 ${ap} AP。`};
    }
    // 只有上一次行動落點位於區間，下一次有效行動才觸發；穿越不算。
    function pendingHazard(s,actor) {
        const position=(actor==="player"?s.player:s.pursuer).position;
        return (s.hazards||[]).find(h=>position>=h.start&&position<=h.end&&
            !(h.sharedOnce&&h.triggered?.shared)&&!h.triggered?.[actor]);
    }
    function applyHazard(s,actor,distance) {
        const h=pendingHazard(s,actor);
        if(!h)return {distance,text:""};
        h.triggered ||= {player:false,npc:false,shared:false};
        h.triggered[actor]=true;
        if(h.sharedOnce)h.triggered.shared=true;
        const penalty=hazardPenalty(h,distance,actor,s);
        const entity=actor==="player"?s.player:s.pursuer;
        entity.ap=Math.max(0,entity.ap-penalty.ap);
        return {distance:penalty.distance,text:penalty.text};
    }
    const athletics = () => clamp(Number(State.variables.athletics)||0,0,1000);
    const moveMultiplier = () => .75 + athletics()/1000*.65;
    // 雙方共用 0～1000 的運動能力尺度；敏捷只決定開局先手。
    const skillMultiplier = skill => .75 + clamp(skill,0,1000)/1000*.65;
    const agilityRoll = skill => clamp(Math.floor(skill*.8)+random(0,200),0,1000);
    // 僅要求事件持有追逐狀態，且處於該追逐指定的階段；不檢查事件 ID。
    const current = () => {
        const e = HM.getMarketEncounter();
        return e && e.chase && e.stage === configOf(e.chase).stage ? e : null;
    };
    // 開局類型同時決定追逐者的 AP 與起始距離，避免完全獨立亂數產生極端組合。
    const openingProfiles = [
        {id:"weak", weight:20, ap:[45,65], gap:[20,26]},
        {id:"normal", weight:40, ap:[65,85], gap:[16,22]},
        {id:"fit", weight:25, ap:[85,100], gap:[14,19]},
        {id:"energetic", weight:15, ap:[100,100], gap:[14,17]}
    ];
    function openingProfile() {
        let roll=random(1,100);
        for(const profile of openingProfiles) {
            roll-=profile.weight;
            if(roll<=0) return profile;
        }
        return openingProfiles[1];
    }
    // 每場追逐獨立配置路段數與叉路規則；使用固定範圍避免生成失控。
    function routeConfig(route) {
        if(route===undefined)route={};
        if(!route||typeof route!=="object"||Array.isArray(route))throw new Error("route 必須為物件");
        const range=(value,fallback,min,max,key)=>{
            const v=value===undefined?fallback:value;
            if(!Array.isArray(v)||v.length!==2||v.some(x=>!Number.isInteger(x)||x<min||x>max)||v[0]>v[1])
                throw new Error(`route.${key} 必須是 ${min}～${max} 的整數範圍 [最小, 最大]`);
            return [...v];
        };
        const chance=route.wrongTurnChance===undefined?25:route.wrongTurnChance;
        const max=route.maxWrongTurns===undefined?2:route.maxWrongTurns;
        if(!Number.isFinite(chance)||chance<0||chance>100)throw new Error("route.wrongTurnChance 必須介於 0～100");
        if(!Number.isInteger(max)||max<0||max>50)throw new Error("route.maxWrongTurns 必須介於 0～50");
        return {segments:range(route.segments,[3,5],1,50,"segments"),wrongTurnChance:chance,
            maxWrongTurns:max,detourLength:range(route.detourLength,[12,23],1,100,"detourLength")};
    }
    // 反追逐模式：玩家與 NPC 各自判定已跨過的原始轉角；走錯只減少本次前進量，
    // 不回退角色、不增加地圖長度，避免障礙物與暗雷座標失效。
    function pursuitWrongTurn(s,actor,from,distance) {
        if(distance<=0)return {distance,message:""};
        const route=s.config.route;
        const checked=s.pursuitForks ||= {player:[],npc:[]};
        const list=checked[actor] ||= [];
        const cap=s.pursuitDetours ||= {player:0,npc:0};
        const boundary=s.segments.slice(0,-1).find(seg=>!list.includes(seg.end)&&from<seg.end&&from+distance>=seg.end);
        if(!boundary)return {distance,message:""};
        list.push(boundary.end);
        if(cap[actor]>=route.maxWrongTurns||Math.random()*100>=route.wrongTurnChance)return {distance,message:""};
        cap[actor]++;
        const loss=random(...route.detourLength);
        const actual=Math.max(0,distance-loss);
        const who=actor==="player"?"你":nameOf(s);
        return {distance:actual,message:`${who}在轉角選錯叉路，繞路浪費了相當於 ${loss} 公尺的前進距離！`};
    }
    // 玩家跨過轉角時才判斷是否走錯叉路；新增的支巷會插入當前轉角後，
    // 後續路段、互動點及隱藏暗雷座標一併平移，追逐者仍沿同一條追逐路線移動。
    // 每個原有轉角最多判定一次，每場最多新增兩段；支巷本身不再產生新叉路。
    function applyWrongTurn(s, from, to) {
        if(!Number.isFinite(s.detours)) s.detours=0;
        if(s.detours>=s.config.route.maxWrongTurns || to<=from) return {to,message:""};
        const junction=s.segments.findIndex((seg,i)=>i<s.segments.length-1 &&
            !seg.isDetour && !seg.forkChecked && from<seg.end && to>=seg.end);
        if(junction<0) return {to,message:""};
        const seg=s.segments[junction];
        seg.forkChecked=true;
        if(Math.random()*100>=s.config.route.wrongTurnChance) return {to,message:""};
        const boundary=seg.end, extra=random(...s.config.route.detourLength);
        for(let i=junction+1;i<s.segments.length;i++) {
            s.segments[i].start+=extra;
            s.segments[i].end+=extra;
        }
        for(const obj of s.objects) {
            if(obj.position>=boundary) {obj.position+=extra;obj.section+=1;}
        }
        for(const hazard of s.hazards||[]) {
            if(hazard.start>=boundary) {hazard.start+=extra;hazard.end+=extra;hazard.section+=1;}
        }
        s.segments.splice(junction+1,0,{start:boundary,end:boundary+extra,length:extra,isDetour:true,forkChecked:true});
        s.total+=extra;
        s.detours++;
        return {to,message:`你在轉角選錯了叉路，不得不繞過一段長 ${extra} 公尺的支巷！`};
    }
    /**
     * 在註冊事件的 resolve() 中呼叫 HM.chase.create(e, options)。
     * options: playerRole（runner／pursuer）、pursuerName、title、stage、onEscape、onCaught／onCatch、difficulty、environment、actions、route。
     * onEscape/onCaught/onCatch 為該事件 resolve() 可識別的 action 字串，不是 Passage。
     * 一個事件同時只維護一場追逐；再次呼叫不會重置既有狀態。
     */
    // 物件數量未設定或無效時，預設每段抽取 1～2 個。
    function objectCountRange(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const min = Number(value.min), max = Number(value.max);
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 12) return null;
        return [min, max];
    }
    const sceneText = (s, key, fallback) => s.config?.sceneTexts?.[key] || fallback;
    C.create = function(e, options={}) {
        if(!e || typeof e!=="object") throw new Error("HM.chase.create 需要市場事件實例");
        if(e.chase) return e.chase;
        const config={...defaults,...options};
        config.actions=validateActions(options.actions);
        config.route=routeConfig(options.route);
        if(!["runner","pursuer"].includes(config.playerRole))throw new Error("playerRole 必須為 runner 或 pursuer");
        if(config.playerRole==="pursuer" && !options.onCatch)throw new Error("追捕模式需要 onCatch action");
        const environment=config.environment||{};
        const obstacleCatalog=catalog(defaultObstacles,environment.obstacles,"obstacles");
        const hideCatalog=catalog(defaultHides,environment.hiding,"hiding");
        const hazardCatalog=catalog(defaultHazards,environment.hazards,"hazards");
        const objectCount = objectCountRange(environment.objectCount);
        config.difficulty=clamp(Number(config.difficulty)||1,.5,2);
        for(const key of ["pursuerName","title","stage","onEscape","onCaught"]) {
            if(typeof config[key]!=="string" || !config[key]) throw new Error(`追逐設定 ${key} 必須為非空字串`);
        }
        const count=random(...config.route.segments), segments=[];
        let cursor=0;
        for(let i=0;i<count;i++) {
            const length=random(22,39);
            segments.push({start:cursor,end:cursor+length,length});
            cursor+=length;
        }
        const objects=[];
        segments.forEach((s,index)=>{
            const amount=objectCount ? random(...objectCount) : random(1,2);
            for(let k=0;k<amount;k++) {
                const available=[...obstacleCatalog,...hideCatalog];
                if(!available.length)continue;
                const base=available[random(0,available.length-1)];
                const position=s.start+random(7,s.length-7);
                if(objects.some(o=>Math.abs(o.position-position)<7)) continue;
                objects.push({...base,id:`${index}_${k}`,section:index,position,state:"intact"});
            }
        });
        if(hideCatalog.length && !objects.some(o=>o.kind==="hide")) {
            const index=random(0,count-1),s=segments[index];
            objects.push({...hideCatalog[random(0,hideCatalog.length-1)],id:"guaranteed_hide",section:index,position:s.start+Math.floor(s.length/2),state:"intact"});
        }
        objects.sort((a,b)=>a.position-b.position);
        const profile=openingProfile();
        const startGap=random(profile.gap[0],profile.gap[1]);
        const playerAthletics=athletics();
        const pursuerAthletics=clamp(playerAthletics+random(-250,250),0,1000);
        const playerAgility=agilityRoll(playerAthletics);
        const pursuerAgility=agilityRoll(pursuerAthletics);
        // 敏捷相同時以隨機方式決定先手，不偏袒任一方。
        const pursuerFirst=pursuerAgility===playerAgility ? random(0,1)===1 : pursuerAgility>playerAgility;
        const hazards=[];
        // 每段 0～2 個暗雷；避開起點及出口附近，避免開局即踩雷或到終點才踩雷。
        segments.forEach((segment,index)=>{
            const amount=random(0,2);
            for(let k=0;k<amount;k++) {
                const center=segment.start+random(7,segment.length-7);
                const half=random(2,4);
                if((center-half)<=startGap && startGap<=(center+half)) continue;
                if(hazards.some(h=>center>=h.start-5 && center<=h.end+5)) continue;
                if(!hazardCatalog.length)continue;
                const kind=hazardCatalog[random(0,hazardCatalog.length-1)];
                hazards.push({id:`hazard_${index}_${k}`,section:index,start:center-half,end:center+half,
                    ...structuredCloneSafe(kind),triggered:{player:false,npc:false,shared:false}});
            }
        });
        e.chase={config,segments,total:cursor,objects,hazards,player:{position:startGap,ap:75,athletics:playerAthletics,agility:playerAgility},pursuer:{position:0,ap:random(profile.ap[0],profile.ap[1]),speed:random(95,105)/100,endurance:random(85,115)/100,athletics:pursuerAthletics,dancing:clamp(dancing()+random(-250,250),0,1000),agility:pursuerAgility,openingProfile:profile.id},detours:0,turn:0,firstMover:pursuerFirst?"pursuer":"player",search:null,log:sceneText({config},"opening",`你沿著曲折的小巷逃跑，${config.pursuerName}緊追在後。`),history:[],outcome:null};
        // 追逐者先手只在追逐初始化時執行一次，絕不在 render 或載入存檔時重抽。
        // 無論移動能力多高，先手最多追到距離玩家 3 公尺的位置，不能直接抓捕。
        if(config.playerRole==="pursuer") {
            e.chase.player.position=0;e.chase.pursuer.position=startGap;
            e.chase.log=`${config.pursuerName}沿著道路逃跑，你緊追在後。`;
            if(pursuerFirst) {
                const openingMove=npcEscapeMove(e.chase,true);
                e.chase.pursuer.position=Math.min(e.chase.pursuer.position,startGap+3);
                e.chase.log=`${config.pursuerName}反應更快，率先拉開距離。${openingMove}`;
            } else e.chase.log=`你反應更快，搶先追向${config.pursuerName}！`;
        } else if(pursuerFirst) {
            const openingMove=movePursuer(e.chase,Math.max(0,startGap-3));
            e.chase.log=`${config.pursuerName}反應更快，率先追了上來！${openingMove} 你們相距 ${fmt(startGap-e.chase.pursuer.position)} 公尺。`;
        } else {
            e.chase.log=sceneText(e.chase,"headStart","你反應更快，搶先向巷道深處逃跑！");
        }
        return e.chase;
    };
    C.section = function(s,p) {const index=s.segments.findIndex(x=>p<x.end);return index<0?s.segments.length-1:index;};
    C.available = function(s) {
        const p=s.player, q=s.pursuer, sec=C.section(s,p.position);
        if(configOf(s).playerRole==="pursuer")return s.objects.filter(o=>o.kind==="obstacle"&&o.state==="blocked"&&o.position>=p.position&&o.position-p.position<=o.reach&&p.ap>=o.cost);
        return s.objects.filter(o=>o.state==="intact" && o.section===sec && p.ap>=o.cost && (
            o.kind==="obstacle" ? p.position>=o.position && p.position-o.position<=o.reach && q.position<o.position
            : Math.abs(p.position-o.position)<=o.reach
        ));
    };
    function movePursuer(s,maxPosition=Infinity) {
        const q=s.pursuer, p=s.player, who=nameOf(s);
        if(q.ap<12) {q.ap=clamp(q.ap+Math.round(25*q.endurance),0,100);return `${who}停下來喘息。`;}
        const gap=p.position-q.position;
        const sprint=q.ap>=30 && (gap>19 || (gap<11 && Math.random()<.75)) && Math.random()<.8;
        const cost=sprint?30:12;
        let distance=(sprint?13:6)*skillMultiplier(q.athletics ?? 500)*q.speed*configOf(s).difficulty;
        q.ap-=cost;
        let target=q.position+distance;
        const blocks=s.objects.filter(o=>o.kind==="obstacle" && o.state==="blocked" && o.position>q.position && o.position<=target).sort((a,b)=>a.position-b.position);
        let message=sprint?`${who}奮力衝刺。`:`${who}繼續追趕。`;
        for(const o of blocks) {
            o.state="cleared";
            const roll=Math.random();
            if(roll<.18){target=Math.min(target,o.position);q.ap=Math.max(0,q.ap-8);message+=` 他被${o.name}絆住了！`;}
            else if(roll<.62){target=Math.max(q.position,target-o.slow);message+=` 他繞過${o.name}，腳步慢了下來。`;}
            else {target=Math.max(q.position,target-o.slow*.5);message+=` 他勉強跨過${o.name}。`;}
        }
        q.position=fmt(Math.max(q.position,Math.min(target,maxPosition)));
        return message;
    }
    // 追捕模式：玩家追擊逃跑者；NPC 先手最多只能拉開到原距離加 3m。
    function npcEscapeMove(s,opening=false) {
        const q=s.pursuer,p=s.player,who=nameOf(s);
        if(s.outcome)return "";
        if(s.search)return "";
        // 暗雷依上次行動落點觸發，直接套用於 NPC 本次移動。
        if(q.ap<12){q.ap=clamp(q.ap+Math.round(25*q.endurance),0,100);const penalty=applyHazard(s,"npc",0);return `${who}停下來喘息。 ${penalty.text}`;}
        const sprint=q.ap>=30 && (p.position-q.position<20 || Math.random()<.55);
        let distance=(sprint?13:6)*skillMultiplier(q.athletics)*q.speed*configOf(s).difficulty;
        q.ap-=sprint?30:12;
        const hazard=applyHazard(s,"npc",distance);
        distance=hazard.distance;
        const before=q.position;
        const fork=pursuitWrongTurn(s,"npc",before,distance);
        distance=fork.distance;
        q.position=fmt(Math.min(s.total,q.position+distance));
        let msg=sprint?`${who}奮力向前衝刺。`:`${who}沿著道路逃跑。`;
        if(hazard.text)msg+=` ${hazard.text}`;
        if(fork.message)msg+=` ${fork.message}`;
        const obstacles=s.objects.filter(o=>o.kind==="obstacle"&&o.state==="intact"&&o.position<=q.position&&o.position>=before&&p.position<o.position);
        if(obstacles.length && q.ap>=10 && Math.random()<.42){
            const o=obstacles[0];o.state="blocked";q.ap-=Math.min(q.ap,o.cost);
            msg+=` ${effectText(o,"npcTrigger",s,`{npc}推倒${o.name}阻擋你。`)}`;
        }
        if(!opening && q.position>=s.total){s.outcome="escaped";msg+=` ${who}從道路盡頭逃走了！`;}
        return msg;
    }
    function tryNpcHide(s,who){
        const p=s.player,q=s.pursuer;
                const spot=s.objects.find(o=>o.kind==="hide"&&o.state==="intact"&&Math.abs(o.position-q.position)<=o.reach);
                if(!s.outcome&&spot&&q.position-p.position>=6&&Math.random()<.18){
                    // 藏身點已鎖定；另外產生附近的可疑搜索區域，避免 UI 直接洩漏答案。
                    spot.state="used";
                    const candidates=[{id:spot.id,name:spot.name,position:spot.position}];
                    const others=s.objects.filter(o=>o.kind==="hide"&&o.id!==spot.id&&Math.abs(o.position-spot.position)<=30);
                    for(const o of others.slice(0,2))candidates.push({id:o.id,name:o.name,position:o.position});
                    const decoys=["轉角後方","牆邊陰影","路旁雜物後方","狹窄側巷"];
                    let i=0;
                    while(candidates.length<3){
                        const name=decoys[i%decoys.length];
                        candidates.push({id:`search_decoy_${i}`,name,position:spot.position+(i%2?5:-5)});i++;
                    }
                    for(let j=candidates.length-1;j>0;j--){const k=random(0,j);[candidates[j],candidates[k]]=[candidates[k],candidates[j]];}
                    s.search={spot,attempts:2,candidates,checked:[]};
                    s.log+=` ${who}在前方轉角突然消失，你只能從附近幾處可疑位置尋找蹤跡。`;
                }
    }
    function actPursuit(e,action,id) {
        const s=e.chase,p=s.player,q=s.pursuer,config=configOf(s),who=nameOf(s);
        if(s.outcome)return false;
        const gap=q.position-p.position;
        // 追捕模式的移動後追加行動：由本場 actions 設定啟用；NPC 尚未行動，玩家可執行符合條件的追加行動或放棄。
        // 追加行動的等待狀態保存在 e.chase，讀檔後仍能接續，不會重複結算上一個移動。
        if(s.followUp){
            const a=(s.config.actions||[]).find(a=>a.id===s.followUp.action);
            if(!a)return false;
            if(action!==a.id&&action!=="skip_followup")return false;
            if(action===a.id&&!customAvailable(s,a,true))return false;
            let msg=s.log;
            s.followUp=null;
            if(action===a.id){
                const result=customAction(s,action,true);
                msg+=` ${result}`;
            }else msg+=" 你沒有冒險飛撲，繼續保持追擊。";
            if(!s.outcome){
                if(s.npcSkipTurns>0){s.npcSkipTurns--;msg+=` ${who}暫時停下腳步。`;}
                else msg+=` ${npcEscapeMove(s)}`;
                // 放棄或失敗後，正常執行 NPC 的躲藏判定。
                if(!s.outcome){s.log=msg;tryNpcHide(s,who);msg=s.log;}
            }
            s.log=msg;
            s.history.unshift(s.log);s.history.length=Math.min(4,s.history.length);
            if(s.outcome==="escaped")HM.resolveMarketEncounter(config.onEscape);
            else if(s.outcome==="caught")HM.resolveMarketEncounter(config.onCatch);
            return true;
        }
        const actions=C.available(s);
        const blocked=actions.find(o=>o.id===id&&o.kind==="obstacle"&&o.state==="blocked");
        if(s.search){
            // 目標已失去視線：玩家必須選擇實際搜索位置，不顯示真正藏身點。
            if(action!=="search"&&action!=="continue")return false;
            const search=s.search;
            const candidate=search.candidates.find(x=>x.id===id);
            if(action==="search"&&(!candidate||p.ap<10||search.checked.includes(id)))return false;
            s.turn++;
            if(action==="search"){
                p.ap-=10;
                search.checked.push(id);
                const correct=id===search.spot.id;
                const chance=clamp(.4+(.2-(search.spot.cover||.15))+(p.athletics-q.athletics)/4000,.15,.75);
                if(correct&&Math.random()<chance){
                    s.search=null;
                    s.log=`你仔細搜索${candidate.name}，發現了${who}！`;
                } else {
                    search.attempts--;
                    s.log=correct?`你搜索${candidate.name}，卻沒能找出${who}。`:`你仔細查看${candidate.name}，卻沒有${who}的蹤影。`;
                }
            } else {
                s.search=null;s.log=`你放棄搜索，繼續沿著道路追趕${who}。`;
            }
            if(s.search && (s.search.attempts<=0 || s.search.checked.length>=s.search.candidates.length)){
                s.search=null;s.outcome="escaped";s.log+=` ${who}趁機逃走了。`;
            }
            if(!s.search&&!s.outcome){s.log+=` ${npcEscapeMove(s)}`;}
        } else {
            const custom=(s.config.actions||[]).some(a=>a.id===action&&customAvailable(s,a));
            if(!((action==="run"&&p.ap>=12)||(action==="sprint"&&p.ap>=30)||action==="rest"||(action==="catch"&&gap<=3&&gap>=0&&p.ap>=10)||(action==="clear"&&blocked)||custom))return false;
            let distance=0,msg="";
            if(custom){
                msg=customAction(s,action);
            } else if(action==="catch"){
                if(p.ap<10)return false;
                p.ap-=10;s.outcome="caught";msg=`你猛地伸手，成功抓住${who}！`;
            } else if(action==="clear"){
                p.ap-=Math.min(p.ap,blocked.cost);blocked.state="cleared";msg=`你移開${blocked.name}，重新打通道路。`;
            } else {
                if(action==="run"){p.ap-=12;distance=6*skillMultiplier(p.athletics);msg=`你朝${who}跑去。`;}
                if(action==="sprint"){p.ap-=30;distance=13*skillMultiplier(p.athletics);msg=`你全力衝刺，追趕${who}。`;}
                if(action==="rest"){p.ap=clamp(p.ap+25,0,100);msg="你暫時調整呼吸。";}
                const hazard=applyHazard(s,"player",distance);distance=hazard.distance;
                if(hazard.text)msg+=` ${hazard.text}`;
                const block=s.objects.find(o=>o.kind==="obstacle"&&o.state==="blocked"&&o.position>p.position&&o.position<=p.position+distance);
                if(block){distance=Math.max(0,block.position-p.position-0.2);msg+=` ${effectText(block,"playerAffected",s,`你被${block.name}擋住。`)}`;}
                const fork=pursuitWrongTurn(s,"player",p.position,distance);
                distance=fork.distance;
                if(fork.message)msg+=` ${fork.message}`;
                p.position=fmt(Math.min(s.total,q.position,p.position+distance));
                // 玩家移動完成後、NPC 下一次逃跑前，立即判斷是否進入抓捕範圍。
                // 只有實際移動的跑步／衝刺會觸發，避免休息或清障礙時免費抓捕。
                const catchReach=action==="sprint"?3:action==="run"?2:0;
                if(catchReach>0&&q.position-p.position<=catchReach&&q.position>=p.position){
                    s.outcome="caught";
                    msg+=` 你趁勢伸手，成功抓住${who}！`;
                }
            }
            s.turn++;
            if(!s.outcome&&(action==="run"||action==="sprint")){
                const follow=(s.config.actions||[]).find(a=>a.followUpAfterMove===true && customAvailable(s,a,true));
                if(follow){
                    s.followUp={action:follow.id};
                    msg+=` 你已進入${follow.name}的範圍，可以立即追加一次行動。`;
                }
            }
            if(s.followUp){
                s.log=msg;
                s.history.unshift(s.log);s.history.length=Math.min(4,s.history.length);
                return true;
            }
            if(!s.outcome){
                if(s.npcSkipTurns>0){s.npcSkipTurns--;msg+=` ${who}暫時停下腳步。`;}
                else msg+=` ${npcEscapeMove(s)}`;
                // NPC 只有在附近有躲藏點時才可能嘗試躲藏；不立即判玩家失敗。
                s.log=msg;
                tryNpcHide(s,who);
                msg=s.log;
            }
            s.log=msg;
        }
        s.history.unshift(s.log);s.history.length=Math.min(4,s.history.length);
        if(s.outcome==="escaped")HM.resolveMarketEncounter(config.onEscape);
        else if(s.outcome==="caught")HM.resolveMarketEncounter(config.onCatch);
        return true;
    }
    C.act = function(action,id) {
        const e=current(); if(!e||!e.chase) return false;
        const s=e.chase,p=s.player,q=s.pursuer,who=nameOf(s),config=configOf(s);
        if(config.playerRole==="pursuer")return actPursuit(e,action,id);
        if(s.outcome)return false;
        const objects=C.available(s);
        const obj=(action==="hide"||action==="topple")
            ? objects.find(o=>o.id===id && o.kind===(action==="hide"?"hide":"obstacle")) : null;
        // 先驗證操作，避免非法操作也消耗暗雷。
        const custom=(s.config.actions||[]).some(a=>a.id===action&&customAvailable(s,a));
        if(!((action==="run"&&p.ap>=12)||(action==="sprint"&&p.ap>=30)||action==="rest"||obj||custom))return false;
        let msg="",distance=0;
        if(custom){msg=customAction(s,action);}
        else if(action==="run") {p.ap-=12;distance=6*skillMultiplier(p.athletics ?? athletics());msg=sceneText(s,"run","你沿著巷道跑了起來。");}
        else if(action==="sprint") {p.ap-=30;distance=13*skillMultiplier(p.athletics ?? athletics());msg="你用盡力氣向前衝刺。";}
        else if(action==="rest") {p.ap=clamp(p.ap+25,0,100);msg="你放慢腳步恢復體力。";}
        else {
            p.ap-=obj.cost;obj.state="used";
            if(action==="topple") {
                distance=3*skillMultiplier(p.athletics ?? athletics());obj.state="blocked";msg=effectText(obj,"playerTrigger",s,`你一邊向前跑，一邊掀翻${obj.name}！`);
            } else {
                // 躲藏使用躲藏點座標，不額外計算移動距離。
                p.position=obj.position;
                const gap=p.position-q.position;
                const corner=C.section(s,p.position)!==C.section(s,q.position);
                if(gap<=5){s.outcome="caught";msg=`${who}已經太近，你還來不及躲好就被抓住了！`;}
                else {
                    // 距離加成減半、轉角加成降低，躲藏成功率上限 75%。
                    const chance=clamp(.12+gap*.009+obj.cover+(corner?.08:0),.05,.75);
                    if(Math.random()<chance){s.outcome="escaped";msg=`你藏進${obj.name}，${who}沒有發現你。`;}
                    else {
                        // 被發現後追逐者掌握玩家位置，本回合額外逼近 3m。
                        s.hideExposed=true;
                        msg=`你躲進${obj.name}，卻被${who}發現了！`;
                    }
                }
            }
        }
        // 上次行動結束時位於暗雷區間，本次有效行動必定觸發；穿越區間不觸發。
        // 先套用移動損失，再結算位置；暗雷只觸發一次，且不直接決定追逐勝負。
        if(!custom && pendingHazard(s,"player")) {
            const penalty=applyHazard(s,"player",distance);
            distance=penalty.distance;
            msg+=` ${penalty.text}`;
        }
        // 僅在本次行動真的跨越轉角時判斷叉路；休息與躲藏不會憑空觸發。
        const beforeMove=p.position;
        const planned=Math.min(s.total,beforeMove+distance);
        const fork=applyWrongTurn(s,beforeMove,planned);
        p.position=fmt(Math.min(s.total,fork.to));
        if(fork.message) msg+=` ${fork.message}`;
        s.turn++;
        if(!s.outcome && p.position>=s.total){s.outcome="escaped";msg+=" "+sceneText(s,"escape","你終於衝出巷道，抵達街道！");}
        if(!s.outcome) {
            if(s.npcSkipTurns>0){s.npcSkipTurns--;msg+=` ${who}暫時停下了腳步。`;}
            else msg+=" "+movePursuer(s);
            if(s.hideExposed) {
                q.position=fmt(Math.min(p.position,q.position+3));
                s.hideExposed=false;
                msg+=` ${who}發現你的藏身位置，迅速逼近！`;
            }
            if(q.position>=p.position){s.outcome="caught";msg+=` ${who}追上並抓住了你！`;}
        }
        s.log=msg;s.history.unshift(msg);s.history.length=Math.min(4,s.history.length);
        if(s.outcome==="escaped") HM.resolveMarketEncounter(config.onEscape);
        else if(s.outcome==="caught") HM.resolveMarketEncounter(config.onCaught);
        return true;
    };
    const esc = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    C.render = function() {
        const e=current();if(!e||!e.chase)return "<p>追逐尚未開始。</p>";
        const s=e.chase,p=s.player,q=s.pursuer,config=configOf(s),who=esc(nameOf(s)),sec=C.section(s,p.position),gap=Math.max(0,fmt(p.position-q.position));
        const pct=v=>clamp(v/s.total*100,0,100).toFixed(2);
        const marks=s.segments.slice(0,-1).map(x=>`<span class="hm-chase-turn" style="left:${pct(x.end)}%" title="${esc(sceneText(s,"corner","巷道轉角"))}"></span>`).join("");
        const actions=C.available(s);
        const pursuit=config.playerRole==="pursuer";
        // 以圖形而非文字標示：藏身點為眼睛加斜線，障礙物為三角警示圖形。
        // 互動點一律以完整路線座標定位，不依賴玩家是否已進入可操作範圍。
        const hideIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2A10.9 10.9 0 0 1 12 5c5 0 9 7 9 7a15.7 15.7 0 0 1-3 3.5M6.3 6.3C3.9 8 3 12 3 12s4 7 9 7a9.4 9.4 0 0 0 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
        const obstacleIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></svg>';
        // 將互動範圍直接畫在路徑上；躲藏點前後皆可使用，障礙物只能通過後掀翻。
        // 每個圖示位於其有效範圍中央，避免圖示與路徑分離。
        const points=s.objects.filter(o=>o.state==="intact"||o.state==="blocked").map(o=>{
            const hide=o.kind==="hide";
            const start=hide?o.position-o.reach:o.position;
            const end=hide?o.position+o.reach:o.position+o.reach;
            const left=clamp(start,0,s.total),right=clamp(end,0,s.total);
            const width=Math.max(0,right-left);
            const active=actions.some(a=>a.id===o.id);
            const cls=hide?"hm-chase-hiding":"hm-chase-obstacle";
            const icon=hide?hideIcon:obstacleIcon;
            const title=esc(o.description||o.name)+`（${fmt(left)}–${fmt(right)}m）`;
            return `<span class="hm-chase-range ${cls}${active?" hm-chase-range-active":""}${o.state==="blocked"?" hm-chase-range-blocked":""}" style="left:${pct(left)}%;width:${(width/s.total*100).toFixed(2)}%" title="${title}" aria-label="${title}"><span class="hm-chase-range-icon">${icon}</span></span>`;
        }).join("");
        const link=(name,action,id)=>`<<link "${esc(name)}" "HonestMarkets Encounter Continue">><<run setup.HonestMarkets.chase.act("${action}"${id?`, ${JSON.stringify(id)}`:""})>><</link>>`;
        const button=(name,action,cost)=>`<span class="hm-chase-action">${p.ap>=cost?link(name,action):`<span class="hm-chase-disabled">${name}（AP 不足）</span>`}</span>`;
        const customLinks=(s.config.actions||[]).map(a=>`<span class="hm-chase-action">${customAvailable(s,a)?link(`${a.name}（${a.apCost} AP）`,a.id):`<span class="hm-chase-disabled">${esc(a.name)}（不可使用）</span>`}</span>`).join("");
        const followUpLinks=pursuit&&s.followUp?(()=>{
            const a=(s.config.actions||[]).find(x=>x.id===s.followUp.action);
            return a?`${link(`${a.name}（追加 ${a.followUpCost} AP）`,a.id)}${link("不飛撲，讓扒手繼續行動","skip_followup")}`:"";
        })():"";
        const searchLinks=pursuit&&s.search?(s.search.candidates||[]).filter(x=>!(s.search.checked||[]).includes(x.id)).map(x=>p.ap>=10?link(`搜索${x.name}（10 AP）`,"search",x.id):`<span class="hm-chase-disabled">搜索${esc(x.name)}（AP 不足）</span>`).join(""):"";
        const objectLinks=pursuit&&s.search?"":pursuit?actions.map(o=>`<span class="hm-chase-action">${link(`移開${o.name}（${o.cost} AP）`,"clear",o.id)}</span>`).join(""):actions.map(o=>`<span class="hm-chase-action">${link(o.kind==="hide"?`躲進${o.name}（${o.cost} AP）`:`掀翻${o.name}（${o.cost} AP）`,o.kind==="hide"?"hide":"topple",o.id)}</span>`).join("");
        return `<div class="hm-chase-ui"><div class="hm-chase-head"><strong>${esc(config.title)}</strong><span>第 ${sec+1} / ${s.segments.length} 段 · 回合 ${s.turn}</span></div>`+
            `<div class="hm-chase-track">${marks}${points}${pursuit&&s.search?"":`<span class="hm-chase-marker pursuer" style="left:${pct(q.position)}%" title="${who}">${pursuit?"逃":"追"}</span>`}<span class="hm-chase-marker player" style="left:${pct(p.position)}%" title="玩家">你</span></div>`+
            `<div class="hm-chase-legend"><span class="hm-chase-legend-icon hm-chase-hiding">${hideIcon}</span> 躲藏點　<span class="hm-chase-legend-icon hm-chase-obstacle">${obstacleIcon}</span> 障礙物　│ 轉角</div>`+
            `${Number(State.variables.debug)===1?`<details class="hm-chase-debug"><summary title="查看追逐判定資訊" aria-label="查看追逐判定資訊">?</summary><div class="hm-chase-debug-panel"><strong>追逐判定資訊</strong><div>先手：<b>${s.firstMover==="pursuer"?who:"玩家"}</b></div><div>敏捷：玩家 <b>${p.agility??"—"}</b>／${who} <b>${q.agility??"—"}</b></div><div>運動：玩家 <b>${p.athletics??"—"}</b>／${who} <b>${q.athletics??"—"}</b></div></div></details>`:""}`+
            `<div class="hm-chase-stats"><div>玩家 AP <b>${p.ap}/100</b><div class="hm-chase-meter"><i style="width:${p.ap}%"></i></div></div><div>${who} AP <b>${pursuit&&s.search?"未知":`${q.ap}/100`}</b><div class="hm-chase-meter enemy"><i style="width:${q.ap}%"></i></div></div></div>`+
            `<div class="hm-chase-info">距離${who} <b>${pursuit&&s.search?"失去視線":pursuit?Math.max(0,fmt(q.position-p.position)):gap} ${pursuit&&s.search?"":"m"}</b> · 已前進 <b>${fmt(p.position)} / ${s.total} m</b></div>`+
            `<p class="hm-chase-log">${esc(s.log)}</p>`+
            `<div class="hm-chase-actions">${s.followUp?followUpLinks:(s.search?"":button("跑步（12 AP）","run",12)+button("衝刺（30 AP）","sprint",30)+button("休息（+25 AP）","rest",0))}${s.followUp?"":pursuit?(s.search?`${searchLinks}${link("放棄搜索","continue")}`:(q.position-p.position<=3&&q.position>=p.position?link("抓捕目標","catch"):"")):""}${s.followUp?"":objectLinks}${s.followUp||s.search?"":customLinks}</div>`+
            `<p class="hm-chase-hint">${s.followUp?"已接近目標：可追加飛撲或放棄；NPC 尚未行動。":pursuit?"追近目標 3m 內可嘗試抓捕；目標躲藏後需要搜索。":"互動點必須在有效距離內才能操作；躲藏可能直接逃脫，也可能暴露位置。"}</p></div>`;
    };
    Macro.add("hmChaseView",{handler(){new Wikifier(this.output,C.render());}});
})();
