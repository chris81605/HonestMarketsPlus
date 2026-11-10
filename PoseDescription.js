/* Pose Description Engine v0.2.8 — DoL / SugarCube 2
 * 純文字輸出：不修改 State.variables、衣物、能力值。
 * 原版 Widget 為文字輸出，採用可選的 Wikifier 文字橋接；需先核對副作用。
 * 提供姿勢組合、語意驗證與文字渲染 API。
 */
(function () {
  'use strict';
  if (typeof setup === 'undefined') throw new Error('PoseDescription: setup 尚未建立');
  const ns = (setup.poseDescription = setup.poseDescription || {});
  const parts = {"head":{"name":"頭部","group":"head"},"face":{"name":"臉龐","group":"head"},"forehead":{"name":"額頭","group":"head"},"eyes":{"name":"雙眼","group":"head"},"leftEye":{"name":"左眼","group":"head"},"rightEye":{"name":"右眼","group":"head"},"eyebrows":{"name":"眉毛","group":"head"},"nose":{"name":"鼻尖","group":"head"},"mouth":{"name":"嘴","group":"head"},"lips":{"name":"嘴唇","group":"head"},"tongue":{"name":"舌頭","group":"head"},"chin":{"name":"下巴","group":"head"},"cheeks":{"name":"臉頰","group":"head"},"leftEar":{"name":"左耳","group":"head"},"rightEar":{"name":"右耳","group":"head"},"hair":{"name":"髮絲","group":"head"},"neck":{"name":"頸部","group":"head"},"nape":{"name":"後頸","group":"head"},"throat":{"name":"喉部","group":"head"},"shoulder":{"name":"肩膀","group":"torso"},"leftShoulder":{"name":"左肩","group":"torso"},"rightShoulder":{"name":"右肩","group":"torso"},"collarbone":{"name":"鎖骨","group":"torso"},"chest":{"name":"胸前","group":"torso"},"breasts":{"name":"胸部","group":"torso"},"leftBreast":{"name":"左胸","group":"torso"},"rightBreast":{"name":"右胸","group":"torso"},"nipples":{"name":"胸部前端","group":"torso"},"upperBack":{"name":"上背","group":"torso"},"back":{"name":"背部","group":"torso"},"lowerBack":{"name":"下背","group":"torso"},"spine":{"name":"脊背","group":"torso"},"abdomen":{"name":"腹部","group":"torso"},"belly":{"name":"肚子","group":"torso"},"navel":{"name":"肚臍","group":"torso"},"waist":{"name":"腰側","group":"torso"},"leftWaist":{"name":"左腰","group":"torso"},"rightWaist":{"name":"右腰","group":"torso"},"ribcage":{"name":"肋側","group":"torso"},"underarm":{"name":"腋下","group":"torso"},"leftUnderarm":{"name":"左腋下","group":"torso"},"rightUnderarm":{"name":"右腋下","group":"torso"},"arm":{"name":"手臂","group":"arm"},"leftArm":{"name":"左臂","group":"arm"},"rightArm":{"name":"右臂","group":"arm"},"upperArm":{"name":"上臂","group":"arm"},"elbow":{"name":"手肘","group":"arm"},"leftElbow":{"name":"左手肘","group":"arm"},"rightElbow":{"name":"右手肘","group":"arm"},"forearm":{"name":"前臂","group":"arm"},"wrist":{"name":"手腕","group":"arm"},"leftWrist":{"name":"左手腕","group":"arm"},"rightWrist":{"name":"右手腕","group":"arm"},"hand":{"name":"手掌","group":"arm"},"leftHand":{"name":"左手","group":"arm"},"rightHand":{"name":"右手","group":"arm"},"palm":{"name":"掌心","group":"arm"},"fingers":{"name":"手指","group":"arm"},"fingertips":{"name":"指尖","group":"arm"},"thumb":{"name":"拇指","group":"arm"},"knuckles":{"name":"指節","group":"arm"},"hip":{"name":"髖部","group":"lower"},"hips":{"name":"腰臀","group":"lower"},"pelvis":{"name":"骨盆","group":"lower"},"buttocks":{"name":"臀部","group":"lower"},"leftButtock":{"name":"左臀","group":"lower"},"rightButtock":{"name":"右臀","group":"lower"},"groin":{"name":"腹股溝","group":"lower"},"crotch":{"name":"胯間","group":"lower"},"genitals":{"name":"私密部位","group":"lower"},"leg":{"name":"腿部","group":"leg"},"leftLeg":{"name":"左腿","group":"leg"},"rightLeg":{"name":"右腿","group":"leg"},"thigh":{"name":"大腿","group":"leg"},"leftThigh":{"name":"左大腿","group":"leg"},"rightThigh":{"name":"右大腿","group":"leg"},"innerThigh":{"name":"大腿內側","group":"leg"},"leftInnerThigh":{"name":"左大腿內側","group":"leg"},"rightInnerThigh":{"name":"右大腿內側","group":"leg"},"knee":{"name":"膝蓋","group":"leg"},"leftKnee":{"name":"左膝","group":"leg"},"rightKnee":{"name":"右膝","group":"leg"},"calf":{"name":"小腿","group":"leg"},"shin":{"name":"脛部","group":"leg"},"ankle":{"name":"腳踝","group":"leg"},"leftAnkle":{"name":"左腳踝","group":"leg"},"rightAnkle":{"name":"右腳踝","group":"leg"},"foot":{"name":"腳掌","group":"leg"},"leftFoot":{"name":"左腳","group":"leg"},"rightFoot":{"name":"右腳","group":"leg"},"heel":{"name":"腳跟","group":"leg"},"toes":{"name":"腳趾","group":"leg"},"camera":{"name":"鏡頭","group":"scene"},"floor":{"name":"地面","group":"scene"},"wall":{"name":"牆面","group":"scene"},"chair":{"name":"椅子","group":"scene"},"table":{"name":"桌面","group":"scene"},"hairEnds":{"name":"髮尾","group":"scene"},"clothing":{"name":"衣物","group":"scene"},"sleeve":{"name":"袖口","group":"scene"},"hem":{"name":"衣襬","group":"scene"},"collar":{"name":"領口","group":"scene"},"skirt":{"name":"裙襬","group":"scene"}};
  const actors = {"leftHand":{"name":"左手","group":"hand"},"rightHand":{"name":"右手","group":"hand"},"bothHands":{"name":"雙手","group":"hand"},"fingers":{"name":"手指","group":"hand"},"leftFingers":{"name":"左手手指","group":"hand"},"rightFingers":{"name":"右手手指","group":"hand"},"leftArm":{"name":"左臂","group":"arms"},"rightArm":{"name":"右臂","group":"arms"},"bothArms":{"name":"雙臂","group":"arms"},"leftElbow":{"name":"左手肘","group":"arms"},"rightElbow":{"name":"右手肘","group":"arms"},"leftLeg":{"name":"左腿","group":"leg"},"rightLeg":{"name":"右腿","group":"leg"},"leftKnee":{"name":"左膝","group":"leg"},"rightKnee":{"name":"右膝","group":"leg"},"leftFoot":{"name":"左腳","group":"leg"},"rightFoot":{"name":"右腳","group":"leg"},"bothLegs":{"name":"雙腿","group":"legs"},"bothFeet":{"name":"雙腳","group":"legs"},"bothKnees":{"name":"雙膝","group":"legs"},"torso":{"name":"上半身","group":"torso"},"chest":{"name":"胸口","group":"torso"},"waist":{"name":"腰部","group":"torso"},"back":{"name":"背部","group":"torso"},"hips":{"name":"腰臀","group":"torso"},"pelvis":{"name":"骨盆","group":"torso"},"head":{"name":"頭","group":"head"},"neck":{"name":"頸部","group":"head"},"face":{"name":"臉","group":"head"},"eyes":{"name":"雙眼","group":"eyes"},"leftEye":{"name":"左眼","group":"eyes"},"rightEye":{"name":"右眼","group":"eyes"},"mouth":{"name":"嘴","group":"mouth"},"lips":{"name":"嘴唇","group":"mouth"},"body":{"name":"身體","group":"body"},"hair":{"name":"頭髮","group":"hair"},"clothing":{"name":"衣物","group":"clothing"},"skirt":{"name":"裙襬","group":"clothing"},"sleeve":{"name":"袖口","group":"clothing"}};
  const actions = {"reach":{"groups":["hand","arms"],"template":"將{a}伸向{t}","requiresTarget":true,"description":"reach"},"touch":{"groups":["hand","arms"],"template":"用{a}碰觸{t}","requiresTarget":true,"description":"touch"},"rest":{"groups":["hand","arms"],"template":"將{a}搭在{t}","requiresTarget":true,"description":"rest"},"cover":{"groups":["hand","arms"],"template":"用{a}遮住{t}","requiresTarget":true,"description":"cover"},"press":{"groups":["hand","arms"],"template":"用{a}按壓{t}","requiresTarget":true,"description":"press"},"hold":{"groups":["hand","arms"],"template":"用{a}扶住{t}","requiresTarget":true,"description":"hold"},"rub":{"groups":["hand","arms"],"template":"用{a}輕揉{t}","requiresTarget":true,"description":"rub"},"trace":{"groups":["hand","arms"],"template":"用{a}沿著{t}滑過","requiresTarget":true,"description":"trace"},"raise":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"抬起{a}","requiresTarget":false,"description":"raise"},"lower":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"放下{a}","requiresTarget":false,"description":"lower"},"spread":{"groups":["hand","arms","leg","legs"],"template":"將{a}向兩側展開","requiresTarget":false,"description":"spread"},"close":{"groups":["hand","arms","leg","legs"],"template":"將{a}收攏","requiresTarget":false,"description":"close"},"cross":{"groups":["hand","arms","leg","legs"],"template":"將{a}交叉","requiresTarget":false,"description":"cross"},"lean":{"groups":["torso","head","body"],"template":"讓{a}傾斜","requiresTarget":false,"description":"lean"},"turn":{"groups":["torso","head","body"],"template":"轉動{a}","requiresTarget":false,"description":"turn"},"tilt":{"groups":["torso","head","body"],"template":"讓{a}傾斜","requiresTarget":false,"description":"tilt"},"arch":{"groups":["torso","body"],"template":"挺起{a}","requiresTarget":false,"description":"arch"},"bend":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"彎曲{a}","requiresTarget":false,"description":"bend"},"straighten":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"伸直{a}","requiresTarget":false,"description":"straighten"},"extend":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"伸展{a}","requiresTarget":false,"description":"extend"},"retract":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"收回{a}","requiresTarget":false,"description":"retract"},"move":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"移動{a}","requiresTarget":false,"description":"move"},"shift":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"挪動{a}","requiresTarget":false,"description":"shift"},"lift":{"groups":["hand","arms","leg","legs"],"template":"抬高{a}","requiresTarget":false,"description":"lift"},"drop":{"groups":["hand","arms","leg","legs"],"template":"垂下{a}","requiresTarget":false,"description":"drop"},"rotate":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"旋轉{a}","requiresTarget":false,"description":"rotate"},"twist":{"groups":["torso","head","body"],"template":"扭轉{a}","requiresTarget":false,"description":"twist"},"sway":{"groups":["torso","head","body"],"template":"輕擺{a}","requiresTarget":false,"description":"sway"},"swing":{"groups":["hand","arms","leg","legs"],"template":"擺動{a}","requiresTarget":false,"description":"swing"},"stretch":{"groups":["hand","arms","leg","legs","torso","head","body"],"template":"舒展{a}","requiresTarget":false,"description":"stretch"},"curl":{"groups":["hand","arms","leg","legs"],"template":"蜷起{a}","requiresTarget":false,"description":"curl"},"fold":{"groups":["hand","arms","leg","legs"],"template":"折起{a}","requiresTarget":false,"description":"fold"},"uncross":{"groups":["hand","arms","leg","legs"],"template":"將{a}分開","requiresTarget":false,"description":"uncross"},"clasp":{"groups":["hand","arms"],"template":"將{a}交握","requiresTarget":false,"description":"clasp"},"interlace":{"groups":["hand","arms"],"template":"將{a}交扣","requiresTarget":false,"description":"interlace"},"clench":{"groups":["hand","arms"],"template":"握緊{a}","requiresTarget":false,"description":"clench"},"release":{"groups":["hand","arms"],"template":"放鬆{a}","requiresTarget":false,"description":"release"},"grip":{"groups":["hand","arms"],"template":"用{a}抓住{t}","requiresTarget":true,"description":"grip"},"grab":{"groups":["hand","arms"],"template":"用{a}握住{t}","requiresTarget":true,"description":"grab"},"support":{"groups":["hand","arms"],"template":"用{a}托住{t}","requiresTarget":true,"description":"support"},"cup":{"groups":["hand","arms"],"template":"用{a}捧住{t}","requiresTarget":true,"description":"cup"},"push":{"groups":["hand","arms"],"template":"用{a}推動{t}","requiresTarget":true,"description":"push"},"pull":{"groups":["hand","arms"],"template":"用{a}拉動{t}","requiresTarget":true,"description":"pull"},"slide":{"groups":["hand","arms"],"template":"讓{a}沿著{t}移動","requiresTarget":true,"description":"slide"},"tap":{"groups":["hand","arms"],"template":"用{a}輕拍{t}","requiresTarget":true,"description":"tap"},"pat":{"groups":["hand","arms"],"template":"用{a}拍了拍{t}","requiresTarget":true,"description":"pat"},"point":{"groups":["hand","arms"],"template":"用{a}指向{t}","requiresTarget":true,"description":"point"},"gesture":{"groups":["hand","arms"],"template":"以{a}比出手勢","requiresTarget":false,"description":"gesture"},"frame":{"groups":["hand","arms"],"template":"以{a}框住{t}","requiresTarget":true,"description":"frame"},"wrap":{"groups":["hand","arms"],"template":"將{a}環繞{t}","requiresTarget":true,"description":"wrap"},"hug":{"groups":["hand","arms"],"template":"以{a}環抱{t}","requiresTarget":true,"description":"hug"},"squeeze":{"groups":["hand","arms"],"template":"用{a}輕擠{t}","requiresTarget":true,"description":"squeeze"},"pinch":{"groups":["hand","arms"],"template":"用{a}捏住{t}","requiresTarget":true,"description":"pinch"},"brush":{"groups":["hand","arms"],"template":"用{a}拂過{t}","requiresTarget":true,"description":"brush"},"stroke":{"groups":["hand","arms"],"template":"用{a}撫過{t}","requiresTarget":true,"description":"stroke"},"shield":{"groups":["hand","arms"],"template":"以{a}擋住{t}","requiresTarget":true,"description":"shield"},"separate":{"groups":["hand","arms","leg","legs"],"template":"將{a}分開","requiresTarget":false,"description":"separate"},"join":{"groups":["hand","arms","leg","legs"],"template":"將{a}靠攏","requiresTarget":false,"description":"join"},"kneel":{"groups":["torso","head","leg","legs","body"],"template":"讓{a}轉為跪姿","requiresTarget":false,"description":"kneel"},"squat":{"groups":["torso","head","leg","legs","body"],"template":"讓{a}轉為蹲姿","requiresTarget":false,"description":"squat"},"sit":{"groups":["torso","head","leg","legs","body"],"template":"讓{a}轉為坐姿","requiresTarget":false,"description":"sit"},"stand":{"groups":["torso","head","leg","legs","body"],"template":"讓{a}站直","requiresTarget":false,"description":"stand"},"crouch":{"groups":["torso","head","leg","legs","body"],"template":"讓{a}屈低","requiresTarget":false,"description":"crouch"},"rise":{"groups":["torso","head","leg","legs","body"],"template":"抬高{a}","requiresTarget":false,"description":"rise"},"balance":{"groups":["torso","head","leg","legs","body"],"template":"穩住{a}","requiresTarget":false,"description":"balance"},"step":{"groups":["leg","legs"],"template":"讓{a}跨出一步","requiresTarget":false,"description":"step"},"stepBack":{"groups":["leg","legs"],"template":"讓{a}退後一步","requiresTarget":false,"description":"stepBack"},"stepSide":{"groups":["leg","legs"],"template":"讓{a}側跨一步","requiresTarget":false,"description":"stepSide"},"tiptoe":{"groups":["leg","legs"],"template":"讓{a}踮起","requiresTarget":false,"description":"tiptoe"},"kick":{"groups":["leg","legs"],"template":"踢起{a}","requiresTarget":false,"description":"kick"},"plant":{"groups":["leg","legs"],"template":"讓{a}穩穩踏住地面","requiresTarget":false,"description":"plant"},"look":{"groups":["head","eyes","mouth"],"template":"以{a}望向{t}","requiresTarget":true,"description":"look"},"glance":{"groups":["head","eyes","mouth"],"template":"以{a}瞥向{t}","requiresTarget":true,"description":"glance"},"nod":{"groups":["head"],"template":"輕點{a}","requiresTarget":false,"description":"nod"},"shake":{"groups":["head"],"template":"輕搖{a}","requiresTarget":false,"description":"shake"},"bow":{"groups":["head"],"template":"低下{a}","requiresTarget":false,"description":"bow"},"smile":{"groups":["head","eyes","mouth"],"template":"讓{a}浮現笑意","requiresTarget":false,"description":"smile"},"blink":{"groups":["eyes"],"template":"讓{a}眨了眨","requiresTarget":false,"description":"blink"},"closeEyes":{"groups":["eyes"],"template":"閉上{a}","requiresTarget":false,"description":"closeEyes"},"openEyes":{"groups":["eyes"],"template":"睜開{a}","requiresTarget":false,"description":"openEyes"},"partLips":{"groups":["mouth"],"template":"微張{a}","requiresTarget":false,"description":"partLips"},"purseLips":{"groups":["mouth"],"template":"輕抿{a}","requiresTarget":false,"description":"purseLips"},"liftClothing":{"groups":["hand","arms","clothing"],"template":"用{a}掀起{t}","requiresTarget":true,"description":"liftClothing"},"lowerClothing":{"groups":["hand","arms","clothing"],"template":"用{a}拉低{t}","requiresTarget":true,"description":"lowerClothing"},"adjustClothing":{"groups":["hand","arms","clothing"],"template":"用{a}整理{t}","requiresTarget":true,"description":"adjustClothing"},"smoothClothing":{"groups":["hand","arms","clothing"],"template":"用{a}撫平{t}","requiresTarget":true,"description":"smoothClothing"},"tugClothing":{"groups":["hand","arms","clothing"],"template":"用{a}輕拉{t}","requiresTarget":true,"description":"tugClothing"},"pullAside":{"groups":["hand","arms","clothing"],"template":"用{a}將{t}撥向一側","requiresTarget":true,"description":"pullAside"},"tightenClothing":{"groups":["hand","arms","clothing"],"template":"用{a}拉緊{t}","requiresTarget":true,"description":"tightenClothing"},"loosenClothing":{"groups":["hand","arms","clothing"],"template":"用{a}鬆開{t}","requiresTarget":true,"description":"loosenClothing"},"hideBehind":{"groups":["hand"],"template":"將{a}收至{t}後方","requiresTarget":true,"description":"hideBehind"},"faceCamera":{"groups":["torso","head","body"],"template":"讓{a}面向鏡頭","requiresTarget":false,"description":"faceCamera"},"angleCamera":{"groups":["torso","head","body"],"template":"讓{a}側向鏡頭","requiresTarget":false,"description":"angleCamera"}};
  const directions = {"upward":"向上","downward":"向下","inward":"向內","outward":"向外","forward":"向前","backward":"向後","left":"向左","right":"向右","sideways":"向側面","diagonalUp":"斜向上","diagonalDown":"斜向下","clockwise":"順時針","counterclockwise":"逆時針","towardCamera":"朝向鏡頭","awayFromCamera":"背向鏡頭","around":"環繞"};
  const degrees = {"tiny":"極輕微","slight":"微微","subtle":"略微","small":"稍稍","moderate":"適度","normal":"","noticeable":"明顯","wide":"大幅","large":"大大","veryWide":"極大幅度","full":"完全","maximum":"盡可能"};
  const speeds = {"verySlow":"極緩慢地","slow":"緩緩","gradual":"逐漸","steady":"平穩地","fluid":"流暢地","smooth":"順暢地","normal":"","quick":"迅速","rapid":"快速","sudden":"突然","hesitant":"遲疑地","rhythmic":"有節奏地"};
  const forces = {"featherlight":"極輕地","light":"輕輕","gentle":"輕柔地","soft":"柔和地","relaxed":"放鬆地","loose":"鬆鬆地","steady":"穩穩","firm":"堅定地","strong":"用力","tight":"緊緊","careful":"小心地","controlled":"有控制地"};
  const contacts = {"fingertips":"用指尖","palm":"用掌心","backOfHand":"用手背","knuckles":"用指節","bothPalms":"用雙掌","oneFinger":"用一根手指","twoFingers":"用兩根手指","forearm":"以前臂","elbow":"用手肘","overClothes":"隔著衣物","bareSkin":"直接","edge":"沿著邊緣","side":"從側面","bothSides":"從兩側"};
  const durations = {"instant":"瞬間","brief":"短暫","moment":"片刻","short":"稍作停留","steady":"持續","held":"維持住","long":"久久","repeated":"反覆","alternating":"交替","gradual":"逐步"};
  const postures = {"standing":"站立","sitting":"坐著","kneeling":"跪姿","squatting":"蹲姿","lying":"躺姿","supine":"仰躺","prone":"俯臥","sideLying":"側躺","leaning":"倚靠","halfSitting":"半坐","crouching":"屈身","onTiptoe":"踮腳"};
  const gazes = {"camera":"直視鏡頭","away":"避開視線","down":"垂下目光","up":"抬眼望去","left":"望向左側","right":"望向右側","side":"側目望去","overShoulder":"回眸","closed":"閉上眼睛","halfClosed":"半垂眼簾","glance":"偷瞄一眼","straight":"直視前方","distant":"望向遠處","towardTarget":"望向目標"};
  const cameras = {"front":"正面","side":"側面","back":"背面","threeQuarter":"四分之三側面","highAngle":"俯視","lowAngle":"仰視","closeUp":"特寫","medium":"半身","fullBody":"全身","profile":"側臉","overShoulder":"越肩","diagonal":"斜角"};
  const clothings = {"overClothes":"隔著衣物","underClothes":"衣物內側","fitted":"貼身","loose":"寬鬆","wrinkled":"帶著皺褶","smooth":"平整","covered":"被遮住","partiallyCovered":"部分遮住","edgeVisible":"露出邊緣","lifted":"掀起","lowered":"拉低","adjusted":"整理過"};
  const expressions = {"shy":"略顯羞澀","confident":"顯得自信","hesitant":"略帶遲疑","natural":"顯得自然","elegant":"顯得優雅","bold":"顯得大膽","playful":"帶著俏皮感","reserved":"顯得拘謹","nervous":"略顯緊張","stiff":"動作有些僵硬","relaxed":"顯得放鬆","composed":"神情鎮定","serious":"表情認真","focused":"神情專注","gentle":"神情柔和","curious":"流露好奇","embarrassed":"略顯難為情","awkward":"顯得不太自在","graceful":"姿態優美","proud":"神情驕傲","calm":"顯得平靜","lively":"充滿活力","timid":"略顯膽怯","determined":"神情堅定","uncertain":"顯得不確定","carefree":"顯得灑脫","quiet":"顯得安靜","cheerful":"面帶笑意","cool":"神情冷靜","dramatic":"富有戲劇感","cautious":"顯得謹慎","cooperative":"配合地維持姿勢","reluctant":"略帶不情願","selfConscious":"有些在意自己的姿態","poised":"姿態從容","mischievous":"帶著狡黠神情","formal":"顯得正式","casual":"顯得隨意","delicate":"動作細膩","theatrical":"姿態誇張"};
  const effects = {"emphasize":"讓{t}的輪廓更加明顯","visible":"使{t}更容易被鏡頭看見","conceal":"讓{t}受到遮擋","silhouette":"使{t}形成鮮明的線條","outline":"勾勒出{t}的線條","highlight":"讓視線集中在{t}","frame":"使{t}成為畫面焦點","shadow":"讓{t}呈現更明顯的明暗層次","curve":"突顯{t}的曲線","lengthen":"讓{t}的線條顯得修長","compact":"使{t}的姿態顯得緊湊","open":"讓{t}的姿態更加舒展","angle":"改變{t}面向鏡頭的角度","profile":"呈現{t}的側面輪廓","symmetry":"讓{t}的姿態更加對稱","asymmetry":"讓{t}形成不對稱的構圖","focus":"讓{t}落在鏡頭視覺中心","foreground":"使{t}靠近畫面前景","background":"讓{t}退入畫面背景","contrast":"增加{t}與周圍輪廓的對比","depth":"使{t}呈現更明顯的空間層次","balance":"讓{t}的視覺重心更加穩定","tension":"讓{t}的線條顯得緊繃","relaxation":"讓{t}的姿態顯得放鬆","motion":"讓{t}帶出動態感","stillness":"使{t}呈現靜止的姿態","partialView":"讓{t}只有部分進入畫面","covered":"使{t}在視線中被遮住","exposureIntent":"將{t}調整到較容易看見的位置","contour":"讓{t}的外形更清晰","poseLine":"讓{t}延伸出連續的姿勢線條","softness":"讓{t}的線條顯得柔和","definition":"讓{t}的邊界更清楚","alignment":"讓{t}與其他部位形成一致方向"};
  const relations = {"contact":"接觸","near":"靠近","apart":"分開","overlap":"重疊","cross":"交叉","behind":"位於後方","inFront":"位於前方","beside":"位於旁邊","above":"位於上方","below":"位於下方","around":"環繞","between":"位於兩者之間","toward":"朝向","away":"遠離","parallel":"平行","opposite":"相反方向","support":"支撐","cover":"遮住","frame":"框住","aligned":"對齊","interlocked":"交扣","mirrored":"鏡像對稱","touching":"相貼","separated":"保持距離"};
  // 遮擋是視覺關係，不是衣物操作；只會生成敘述。
  Object.assign(relations, {
    occlude: '在鏡頭視線中遮擋',
    partiallyOcclude: '在鏡頭視線中部分遮擋',
    concealFromCamera: '使鏡頭難以看清'
  });
  Object.assign(effects, {
    obscured: '讓{t}被肢體遮擋，難以從鏡頭看清',
    partiallyObscured: '讓{t}在鏡頭前只露出部分輪廓',
    emphasizedByPose: '使{t}的輪廓因姿勢而更加突出'
  });
  Object.assign(actions, {
    clamp: {groups:['legs','leg','arms'],template:'將{a}夾緊',requiresTarget:false,description:'clamp'},
    tuck: {groups:['legs','leg','arms','hand'],template:'將{a}向內收起',requiresTarget:false,description:'tuck'},
    foldAcross: {groups:['arms','hand'],template:'將{a}橫在{t}',requiresTarget:true,description:'foldAcross'},
    screen: {groups:['arms','hand'],template:'以{a}擋在{t}前方',requiresTarget:true,description:'screen'}
  });
  // actor 是可動肢體；target 是被遮擋的部位。不能將遮擋當成實際裸露判定。
  const coverage = {
    none:'', partial:'部分', mostly:'大部分', full:'完全'
  };
  const visibility = {
    unspecified:'', hidden:'難以看清', partial:'只能看見部分輪廓', clear:'清楚可見'
  };
  // Widget 映射表；useOriginalWidget 可沿用已登記的 Widget。
  const originalWidgets = { breasts: { widget: 'breasts', verified: false, outputType: 'text' } };
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const pick = (o,k,f='') => typeof k === 'string' && own(o,k) ? o[k] : f;
  const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeId = s => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(s);
  function targetText(id, useOriginal) {
    const p = pick(parts,id);
    if (!p) return '';
    const original = pick(originalWidgets,id);
    if (useOriginal && original && original.widget && safeId(original.widget)) return `<<${original.widget}>>`;
    return p.name;
  }
  // 任意 Widget 名稱只接受識別字；禁止把參數當成任意 Twee 原始碼插入。
  // 注意：Widget 本身可能修改遊戲狀態；是否安全由事件作者負責。
  function widgetName(value) { return typeof value === 'string' && safeId(value); }
  function widgetCall(name) { return `<<${name}>>`; }
  function widgetText(spec, field, fallback) {
    return spec[field] ? widgetCall(spec[field]) : fallback;
  }
  function widgetList(value) { return value == null ? [] : value; }
  function validateWidgets(spec) {
    for (const key of ['targetWidget','effectTargetWidget','relationTargetWidget']) {
      if (spec[key] != null && !widgetName(spec[key])) return `無效 Widget 名稱：${key}`;
    }
    for (const key of ['prependWidgets','appendWidgets']) {
      if (spec[key] == null) continue;
      if (!Array.isArray(spec[key]) || !spec[key].every(widgetName)) return `無效 Widget 清單：${key}`;
    }
    return '';
  }
  // 單側部位不能交握／交扣；腿不能「旋轉」，身體不能籠統「收回」。
  const semanticRules = {
    clasp: {actors:['bothHands'],template:'將雙手交握'},
    interlace: {actors:['bothHands'],template:'將雙手手指交扣'},
    cross: {actors:['bothArms','bothLegs'],template:null},
    rotate: {actors:['leftHand','rightHand','bothHands','torso','head'],template:null},
    retract: {actors:['leftHand','rightHand','bothHands','leftArm','rightArm','bothArms','leftLeg','rightLeg'],template:null},
    raise: {actors:['leftHand','rightHand','bothHands','leftArm','rightArm','bothArms','leftLeg','rightLeg','head']},
    // 頭部只能轉動或傾斜；伸展動作可用於頸部，但不能直接用於頭。
    extend: {actors:['leftHand','rightHand','bothHands','leftArm','rightArm','bothArms','leftLeg','rightLeg','bothLegs','torso','body','neck']},
    stretch: {actors:['leftHand','rightHand','bothHands','leftArm','rightArm','bothArms','leftLeg','rightLeg','bothLegs','torso','body','neck']},
    kneel: {actors:['body'],template:'跪下'},
    squat: {actors:['body'],template:'蹲下'},
    sit: {actors:['body'],template:'坐下'},
    stand: {actors:['body'],template:'站直'},
    crouch: {actors:['body'],template:'俯低身體'}
  };
  for(const [id,rule] of Object.entries(semanticRules)) {
    actions[id].groups=[...new Set(rule.actors.map(a=>actors[a].group))];
    if(rule.template)actions[id].template=rule.template;
  }
  const semanticValid=(spec)=>!semanticRules[spec.action]||semanticRules[spec.action].actors.includes(spec.actor);
  // 手動 API 與 Composer 共用目標語意驗證規則。
  const sightTargets = new Set(['camera','viewer','wall','floor','table','chair','hand','leftHand','rightHand','clothing','hem','skirt','dress','shirt','hair','foot','leftFoot','rightFoot']);
  const coverTargets = new Set(['face','eyes','mouth','chest','breasts','abdomen','belly','waist','hips','buttocks','groin','crotch','genitals','shoulder','neck']);
  const outsideTargets = new Set(['camera','viewer','wall','floor','table','chair']);
  const clothingActionIds = new Set(['liftClothing','lowerClothing','adjustClothing','smoothClothing','tugClothing','pullAside','tightenClothing','loosenClothing']);
  const clothingTargetIds = new Set(['clothing','sleeve','hem','collar','skirt','dress','shirt','bra','panties','underwear']);
  function targetCompatible(actor,action,target,context={}) {
    if (!own(parts,target)) return false;
    if (clothingActionIds.has(action)) return clothingTargetIds.has(target) && context.hasClothing!==false;
    if (action==='hideBehind') return actors[actor]?.group==='hand' && ['back','upperBack','waist','hips'].includes(target);
    if (['look','glance'].includes(action)) return sightTargets.has(target); // 不注視自身臉龐／雙眼
    if (['cover','shield','screen','foldAcross'].includes(action)) return coverTargets.has(target);
    if (['rest','hold','support'].includes(action) && outsideTargets.has(target)) return ['wall','chair','table','floor'].includes(target);
    if (outsideTargets.has(target)) return ['touch','reach','press','push','point','rest','hold','support'].includes(action);
    if (['cup','squeeze','pinch','stroke','brush','rub','trace'].includes(action)) return !['hair','eyes','face','camera','viewer'].includes(target) || ['stroke','brush'].includes(action) && target==='hair';
    if (['rest','hold','touch'].includes(action) && target==='hair') return false;
    if (['leftHand','leftArm'].includes(actor) && ['leftHand','leftArm'].includes(target)) return false;
    if (['rightHand','rightArm'].includes(actor) && ['rightHand','rightArm'].includes(target)) return false;
    return true;
  }
  // 視覺效果不可從無關的接觸目標推斷。明確指定的效果仍交由事件作者負責。
  const inferredEffectActionIds = new Set(['arch','lean','bend','twist','turn','rotate','spread','extend','stretch','raise','lift','straighten','tilt']);
  function validate(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return '參數必須是物件';
    const widgetError = validateWidgets(spec);
    if (widgetError) return widgetError;
    const actor = pick(actors,spec.actor), action = pick(actions,spec.action);
    if (!actor) return '未知執行部位：' + String(spec.actor);
    if (!action) return '未知動作：' + String(spec.action);
    if (!semanticValid(spec)) return `動作 ${spec.action} 不適用於 ${spec.actor}`;
    if (!action.groups.includes(actor.group)) return `動作 ${spec.action} 不支援 ${spec.actor}（${actor.group}）`;
    if (action.requiresTarget && !spec.target) return `動作 ${spec.action} 需要 target`;
    if (spec.target && !pick(parts,spec.target)) return '未知目標部位：' + spec.target;
    if (action.requiresTarget && !targetCompatible(spec.actor,spec.action,spec.target)) return `動作 ${spec.action} 與目標 ${spec.target} 不相容`;
    // 遮藏動作只允許手部移至合理的身體後側，避免頭部藏到頸部後方等不可能姿勢。
    if (spec.action === 'hideBehind' && !['back','upperBack','waist','hips'].includes(spec.target)) return 'hideBehind 的目標必須是背部、上背、腰側或腰臀';
    const dicts = {direction:directions,degree:degrees,speed:speeds,force:forces,contact:contacts,
      duration:durations,posture:postures,gaze:gazes,camera:cameras,clothing:clothings,
      effect:effects,expression:expressions,relation:relations,coverage,visibility};
    for (const key of Object.keys(dicts)) if (spec[key] != null && !own(dicts[key],spec[key]))
      return `未知修飾詞：${key}=${String(spec[key])}`;
    if (spec.coverage && !['cover','shield','screen','foldAcross'].includes(spec.action)) return 'coverage 僅適用於遮擋動作';
    if (spec.coverage && !spec.target) return 'coverage 需要 target';
    if (spec.visibility && !spec.target && !spec.effectTarget) return 'visibility 需要 target 或 effectTarget';
    if (spec.effect && !pick(parts,spec.effectTarget || spec.target)) return '效果缺少有效目標';
    if (spec.relation && !pick(parts,spec.relationTarget || spec.target)) return '關係缺少有效目標';
    if (spec.relationTarget && !pick(parts,spec.relationTarget)) return '未知關係目標';
    if (spec.effectTarget && !pick(parts,spec.effectTarget)) return '未知效果目標';
    return '';
  }
  // 主體姿態的語意效果與配合動作；不改動遊戲狀態。
  const primaryPoseEffects = Object.freeze({
    sideTurn: {text:'肩線與腰部形成自然的側面層次',focus:'waist'},
    weightShift: {text:'重心落在一側，讓站姿呈現柔和的不對稱曲線',focus:'hips'},
    upright: {text:'上半身舒展，整體輪廓顯得挺拔',focus:'torso'},
    forwardLean: {text:'身體前後的層次更加明顯',focus:'torso'},
    armsRaised: {text:'手臂向上延伸，使上半身的線條顯得修長',focus:'torso'},
    guarded: {text:'雙臂收向身前，姿態顯得較為拘謹',focus:'chest'},
    crossedLegs: {text:'雙腿錯落的站位讓整體線條更有節奏',focus:'legs'}
  });
  function inferPrimaryPose(actionsList,posture) {
    const list=Array.isArray(actionsList)?actionsList:[];
    const has=(fn)=>list.some(fn);
    if(has(x=>['turn','twist','angleCamera'].includes(x.action)&&['torso','body','waist'].includes(x.actor)))return 'sideTurn';
    if(posture==='standing' && has(x=>['step','stepSide','plant'].includes(x.action)&&/Leg|Foot/.test(x.actor)))return 'weightShift';
    if(has(x=>['arch','straighten','stretch'].includes(x.action)&&['torso','body','back'].includes(x.actor)))return 'upright';
    if(has(x=>x.action==='lean'&&['torso','body'].includes(x.actor)))return 'forwardLean';
    if(has(x=>['raise','extend'].includes(x.action)&&['bothArms','bothHands'].includes(x.actor)))return 'armsRaised';
    if(has(x=>['cover','shield','foldAcross'].includes(x.action)&&['bothArms','bothHands'].includes(x.actor)))return 'guarded';
    if(posture==='standing' && has(x=>x.action==='cross'&&x.actor==='bothLegs'))return 'crossedLegs';
    return null;
  }
  // 原版 Widget 自動映射預設關閉：須由事件作者確認輸出及副作用後啟用。
  const autoWidgetConfig={enabled:false,mappings:{}};
  function configureAutoWidgets(config={}) {
    if(typeof config.enabled==='boolean') autoWidgetConfig.enabled=config.enabled;
    if(config.mappings && typeof config.mappings==='object') for(const [part,raw] of Object.entries(config.mappings)) {
      const entry=typeof raw==='string'?{widget:raw,mode:'inline'}:raw;
      if(own(parts,part) && entry && safeId(entry.widget) && ['inline','append'].includes(entry.mode||'inline'))
        autoWidgetConfig.mappings[part]={widget:entry.widget,mode:entry.mode||'inline'};
    }
  }
  function mappedWidget(part) {
    if(!autoWidgetConfig.enabled || !part) return null;
    const entry=autoWidgetConfig.mappings[part];
    if(!entry) return null;
    if(typeof Macro!=='undefined' && typeof Macro.has==='function' && !Macro.has(entry.widget)) return null;
    return entry;
  }
  /*
   * 動作 → 視覺效果推導
   * 只描述姿勢引起的輪廓與構圖變化，不從「挺胸／抬手」推斷裸體或露出。
   * 僅在 Composer 生成的動作套用，手動 poseAdd 不會被偷偷改寫。
   * explicit effect / effectTarget 一律優先，避免覆蓋事件作者設定。
   */
  const inferredVisualRules = [
    {actors:['torso','chest','body'],actions:['arch'],effect:'emphasizedByPose',target:'chest'},
    {actors:['torso','body'],actions:['lean','bend'],directions:['backward'],effect:'silhouette',target:'waist'},
    {actors:['torso','waist','body'],actions:['twist','turn','rotate'],effect:'silhouette',target:'waist'},
    {actors:['head'],actions:['tilt','turn'],effect:'silhouette',target:'face'}
  ];
  function inferVisualEffect(item,opts={}) {
    if (!item || typeof item!=='object') return item;
    if (opts.inferEffects===false || item.effect || item.effectTarget) return {...item};
    const rule=inferredVisualRules.find(r=>r.actors.includes(item.actor) && r.actions.includes(item.action) &&
      (!r.directions || r.directions.includes(item.direction)));
    if (!rule || !own(effects,rule.effect) || !own(parts,rule.target)) return {...item};
    return {...item,effect:rule.effect,effectTarget:rule.target};
  }
  // 露出與遮擋由事件端提供的真實狀態控制；未知時絕不推斷。
  // visibility 是引擎既有的文字描述欄位，不等同 DoL 服裝狀態判定。
  function applyExposure(item,opts={}) {
    if (!item || !opts.exposure || typeof opts.exposure!=='object' || item.visibility) return item;
    const target=item.effectTarget || item.target;
    const value=opts.exposure[target];
    if (!value || !own(visibility,value)) return item;
    return {...item,visibility:value};
  }
  function enrichVisuals(item,opts={}) {
    const enriched=inferVisualEffect(item,opts);
    return applyExposure(enriched,opts);
  }
  // 自然語句變體受部位與方向限制，不新增任意 actor/action 組合。
  // phraseVariant 由 Composer 決定並隨姿勢保存；手動 API 未指定時保持既有措辭。
  const phraseVariants = Object.freeze({
    'torso:straighten':['挺直腰背','將上半身舒展開來','緩緩拉直背脊','調整肩背，讓站姿更加挺拔'],
    'torso:turn:sideways':['將上半身稍微側向一旁','順勢側過上半身','讓肩線轉向側面','將軀幹轉出一個側身角度'],
    'torso:arch':['微微挺起腰背','讓腰背形成柔和的弧度','稍稍向後舒展上半身'],
    'torso:lean':['將上半身稍微傾斜','讓身體向一側輕傾','微微調整上半身的傾斜角度'],
    'torso:twist':['輕輕扭轉腰身','讓肩膀與腰部轉向不同角度','從腰部帶動上半身轉動'],
    'bothLegs:cross':['讓雙腿自然交疊','將雙腿前後錯開','把雙腿交叉站定'],
    'bothLegs:straighten':['將雙腿自然伸直','伸展雙腿，重新站穩','讓雙腿保持舒展'],
    'bothArms:lower':['讓雙臂自然垂落','慢慢放下雙臂','將雙臂放鬆在身側'],
    'bothArms:raise':['將雙臂向上舉起','抬起雙臂，舒展肩線','將雙手舉過頭頂'],
    'head:tilt':['輕輕偏過頭','稍稍歪頭','讓頭部微微傾斜'],
    'head:turn:sideways':['將臉轉向側方','微微側過頭','轉頭露出側臉輪廓'],
    'rightLeg:step':['右腳向前輕踏一步','將右腿向前跨出一步','讓右腳踏出一步，調整站位'],
    'leftLeg:step':['左腳向前輕踏一步','將左腿向前跨出一步','讓左腳踏出一步，調整站位'],
    'rightLeg:extend':['自然伸展右腿','將右腿舒展開來','輕輕伸出右腿'],
    'leftLeg:extend':['自然伸展左腿','將左腿舒展開來','輕輕伸出左腿'],
    'rightHand:rest:waist':['將右手輕搭在腰側','右手自然扶住腰際','以右手輕扶腰側'],
    'leftHand:rest:waist':['將左手輕搭在腰側','左手自然扶住腰際','以左手輕扶腰側'],
    'rightHand:rest:wall':['右手輕扶牆面','將右手抵在牆上作為支撐','用右手扶牆，穩住站姿'],
    'leftHand:rest:wall':['左手輕扶牆面','將左手抵在牆上作為支撐','用左手扶牆，穩住站姿'],
    'rightHand:hold:wall':['以右手扶住牆面','右手輕抵牆面，穩住身體'],
    'leftHand:hold:wall':['以左手扶住牆面','左手輕抵牆面，穩住身體']
  });
  const wholeBodyEffectVariants = Object.freeze({
    sideTurn:['肩腰之間呈現自然的側面層次','肩膀與腰側形成錯落的輪廓','身體的側面線條在這個角度更清楚'],
    weightShift:['重心落向一側，站姿顯得更有層次','左右不對稱的站位帶出自然的動感','身體重心的變化讓姿勢不再僵硬'],
    upright:['上半身舒展，整個人顯得更加挺拔','肩背自然打開，站姿顯得俐落','身體的線條隨著挺直的姿態延展'],
    forwardLean:['身體前後的層次更加分明','前傾的角度讓姿態帶有動感','軀幹的傾斜讓構圖多了縱深'],
    armsRaised:['抬起的手臂延伸了上半身的輪廓','肩臂向上舒展，姿態顯得修長','雙臂的角度讓上半身線條更完整'],
    guarded:['雙臂收向身前，姿態帶著幾分拘謹','身體自然收斂，呈現防備的姿態','收攏的手臂讓整體姿態顯得含蓄'],
    crossedLegs:['錯開的腿部讓站姿更有節奏','雙腿的交疊帶出自然的站位層次','腿部的錯落使姿態顯得更有變化']
  });
  function variantIndex(spec,count) {
    const n=Number(spec && spec.phraseVariant);
    return Number.isFinite(n) && n>=0 ? Math.floor(n)%count : 0;
  }
  function renderAction(spec) {
    const error = validate(spec);
    if (error) { console.warn('[PoseDescription]',error,spec); return ''; }
    const actor = actors[spec.actor].name, action = actions[spec.action];
    const autoTarget = !spec.targetWidget && !spec.useOriginalWidget ? mappedWidget(spec.target) : null;
    const target = spec.target ? widgetText(spec,'targetWidget',autoTarget && autoTarget.mode==='inline' ? widgetCall(autoTarget.widget) : targetText(spec.target,!!spec.useOriginalWidget)) : '';
    let phrase = action.template.replace(/\{a\}/g,actor).replace(/\{t\}/g,target);
    if (['look','glance'].includes(spec.action)) phrase = (spec.action==='look'?'將目光投向':'將目光瞥向')+target;
    if (spec.action==='rest' && spec.target==='wall') phrase = `將${actor}輕扶在牆面上`;
    if (spec.action==='hold' && spec.target==='wall') phrase = `以${actor}扶住牆面`;
    if (spec.action==='turn' && spec.actor==='head') phrase = '將頭轉向'+(spec.direction ? '' : '側方');
    if (spec.actor==='neck' && ['stretch','extend'].includes(spec.action)) phrase = '舒展頸部';
    if (spec.action==='rest' && spec.target==='shoulder' && spec.actor==='leftHand') phrase = '將左手搭在右肩上';
    if (spec.action==='rest' && spec.target==='shoulder' && spec.actor==='rightHand') phrase = '將右手搭在左肩上';
    // 只替換可確認語意完整的組合；已有方向或其他修飾時避免重複追加。
    const phraseKey = [spec.actor,spec.action,...(spec.target?[spec.target]:[]),...(spec.direction==='sideways'?['sideways']:[])].join(':');
    const variants=phraseVariants[phraseKey] || (!spec.direction && phraseVariants[`${spec.actor}:${spec.action}`]);
    if (variants && !spec.targetWidget && !spec.useOriginalWidget && !spec.contact && !spec.posture && !spec.degree && !spec.speed && !spec.force && !spec.duration) {
      phrase=variants[variantIndex(spec,variants.length)];
      // 已在詞組中表達側身方向，避免後續重複加上「向側面」。
      if (spec.direction==='sideways') spec={...spec,direction:undefined};
    }
    // 扶牆是支撐而非肩膀的「視覺重心」；避免舊範本套用錯誤因果。
    if (['rest','hold'].includes(spec.action) && spec.target==='wall' && spec.effect==='balance') {
      spec={...spec,effect:undefined,effectTarget:undefined};
    }
    // 修飾語採用獨立片段；不把姿勢與視覺效果誤認成遊戲狀態變更。
    const prefix = [pick(speeds,spec.speed),pick(forces,spec.force),pick(degrees,spec.degree)].filter(Boolean).join('');
    if (prefix) phrase = prefix + phrase;
    if (spec.direction && !['spread','separate','stepSide','faceCamera','angleCamera'].includes(spec.action))
      phrase += pick(directions,spec.direction);
    if (spec.contact && !['touch','trace'].includes(spec.action)) phrase = pick(contacts,spec.contact) + '，' + phrase;
    if (spec.contact && ['touch','trace'].includes(spec.action)) phrase = phrase.replace('用'+actor, pick(contacts,spec.contact));
    if (spec.posture) phrase = `以${postures[spec.posture]}的姿態，` + phrase;
    if (spec.duration) phrase += `，${durations[spec.duration]}保持動作`;
    if (spec.relation && !(['cover','shield','screen','foldAcross'].includes(spec.action) && ['cover','occlude','partiallyOcclude','concealFromCamera'].includes(spec.relation))) phrase += `，讓${actor}與${widgetText(spec,'relationTargetWidget',targetText(spec.relationTarget || spec.target,false))}${relations[spec.relation]}`;
    if (spec.coverage && spec.coverage !== 'none') {
      if (spec.action === 'cover') phrase = phrase.replace('遮住'+target, coverage[spec.coverage]+'遮住'+target);
      else phrase += `，${coverage[spec.coverage]}遮住${target}`;
    }
    if (spec.visibility && spec.visibility !== 'unspecified') phrase += `，使${widgetText(spec,'effectTargetWidget',targetText(spec.effectTarget || spec.target,false))}${visibility[spec.visibility]}`;
    if (spec.effect) phrase += '，' + effects[spec.effect].replace(/\{t\}/g,widgetText(spec,'effectTargetWidget',targetText(spec.effectTarget||spec.target,!!spec.useOriginalWidget)));
    if (spec.gaze) phrase += '，' + gazes[spec.gaze];
    if (spec.expression) phrase += '，' + expressions[spec.expression];
    if (spec.camera) phrase += `，以${cameras[spec.camera]}角度呈現`;
    if (spec.clothing) phrase += `，衣物呈現${clothings[spec.clothing]}的狀態`;
    const before = widgetList(spec.prependWidgets).map(widgetCall).join('');
    const after = widgetList(spec.appendWidgets).map(widgetCall).join('');
    const autoAppend=autoTarget && autoTarget.mode==='append' ? ' '+widgetCall(autoTarget.widget) : '';
    // 前後附加描述與主句之間使用獨立句段，避免 Widget 的完整句子被強塞進名詞位置。
    return (before ? before + ' ' : '') + phrase + (after ? ' ' + after : '') + autoAppend;
  }

  /*
   * Pose Composer + Solver
   * 所有約束皆為敘事近似，不宣稱具有精確人體運動學。
   * 核心動作優先、修復後再補位；不會改變任何遊戲角色狀態。
   */
  const poseSolver = (() => {
    const positions = new Set(['reach','touch','rest','cover','press','hold','rub','trace','grip','grab','support','cup','push','pull','slide','tap','pat','point','frame','wrap','hug','squeeze','pinch','brush','stroke','shield','screen','foldAcross','liftClothing','lowerClothing','adjustClothing','smoothClothing','tugClothing','pullAside','tightenClothing','loosenClothing','hideBehind']);
    const opposites = [['raise','lower'],['spread','close'],['spread','clamp'],['spread','join'],['cross','uncross'],['bend','straighten'],['extend','retract'],['lift','drop'],['clench','release'],['openEyes','closeEyes']];
    const stanceSet = new Set(['standing','sitting','kneeling','squatting','lying','supine','prone','sideLying','halfSitting','crouching']);
    const reachable = new Set(['head','face','forehead','eyes','nose','mouth','lips','chin','cheeks','hair','neck','nape','throat','shoulder','leftShoulder','rightShoulder','collarbone','chest','breasts','leftBreast','rightBreast','upperBack','back','lowerBack','abdomen','belly','navel','waist','leftWaist','rightWaist','ribcage','underarm','leftUnderarm','rightUnderarm','arm','leftArm','rightArm','elbow','leftElbow','rightElbow','forearm','wrist','hand','leftHand','rightHand','palm','fingers','hip','hips','pelvis','buttocks','groin','crotch','genitals','leg','leftLeg','rightLeg','thigh','leftThigh','rightThigh','knee','leftKnee','rightKnee','calf','ankle','foot','leftFoot','rightFoot','clothing','sleeve','hem','collar','skirt','chair','table','wall','floor']);
    const contactActions = new Set([...positions]);
    // Profile 控制候選權重，不以拍攝階段直接推斷衣著或身體狀態。
    const profiles = {
      general:{postures:['standing','sitting'],actions:{faceCamera:4,look:3,smile:3,rest:3,turn:2,lean:2,spread:0.6},categories:{face:2,core:2,arms:2,legs:1}},
      bold:{postures:['standing','sitting','kneeling'],actions:{arch:3,spread:3,turn:3,lean:3,raise:3,cover:2,rest:2},categories:{core:3,arms:2,legs:3,face:1}},
      lingerie:{postures:['standing','sitting','kneeling'],actions:{rest:3,turn:3,tilt:3,adjustClothing:3,hold:2,arch:2},categories:{core:2,arms:3,legs:2,face:1}},
      adult:{postures:['standing','sitting','kneeling','sideLying'],actions:{arch:3,spread:3,cover:3,turn:3,lean:3,rest:2,raise:2},categories:{core:3,arms:3,legs:3,face:1}}
    };
    const categories = a => ['head','neck','face','eyes','leftEye','rightEye','mouth','lips'].includes(a)?'face':
      ['torso','chest','waist','back','hips','pelvis','body'].includes(a)?'core':
      /Leg|Foot|Knee/.test(a)?'legs':'arms';
    const compatibleTarget = targetCompatible;
    function weighted(items,weight,rng) {
      const entries=items.map(x=>[x,Math.max(0,Number(weight(x))||0)]).filter(x=>x[1]>0);
      const total=entries.reduce((n,x)=>n+x[1],0);if(!total)return null;
      let r=Math.min(.999999999,Math.max(0,rng()))*total;
      for(const [v,w] of entries) {r-=w;if(r<0)return v;}return entries[entries.length-1][0];
    }
    const stanceActions = new Set(['stand','sit','kneel','squat','crouch']);
    const stanceAction = {standing:'stand',sitting:'sit',kneeling:'kneel',squatting:'squat',crouching:'crouch'};

    const safeRng = rng => typeof rng === 'function' ? rng : Math.random;
    const choose = (arr,rng) => arr.length ? arr[Math.min(arr.length-1,Math.floor(Math.max(0,rng())*arr.length))] : null;
    const unique = arr => [...new Set(arr)];
    function resources(actor) {
      if (['bothHands','bothArms','fingers'].includes(actor)) return ['armL','armR'];
      if (/^left(Hand|Arm|Fingers|Elbow)$/.test(actor)) return ['armL'];
      if (/^right(Hand|Arm|Fingers|Elbow)$/.test(actor)) return ['armR'];
      if (['bothLegs','bothFeet','bothKnees'].includes(actor)) return ['legL','legR'];
      if (/^left(Leg|Foot|Knee)$/.test(actor)) return ['legL'];
      if (/^right(Leg|Foot|Knee)$/.test(actor)) return ['legR'];
      if (['torso','waist','back','hips','pelvis','chest','body'].includes(actor)) return ['core'];
      if (['head','neck','face'].includes(actor)) return ['head'];
      if (['eyes','leftEye','rightEye'].includes(actor)) return ['eyes'];
      return [actor];
    }
    const shared = (a,b) => resources(a.actor).some(r => resources(b.actor).includes(r));
    const stance = x => stanceSet.has(x.posture) ? x.posture : null;
    const key = x => [x.actor,x.action,x.target||'',x.direction||'',x.posture||''].join('|');
    function validatePhysical(item,context={}) {
      const err = validate(item);
      if (err) return {valid:false,reason:err};
      const posture = context.posture || item.posture || 'standing';
      if (stance(item) && context.posture && stance(item)!==context.posture) return {valid:false,reason:'姿態衝突'};
      if (actions[item.action].requiresTarget && !compatibleTarget(item.actor,item.action,item.target,context)) return {valid:false,reason:'動作與目標不相容'};
      if (contactActions.has(item.action) && ['leftHand','rightHand','bothHands','leftArm','rightArm','bothArms','leftFingers','rightFingers','fingers'].includes(item.actor)) {
        if (!reachable.has(item.target)) return {valid:false,reason:'未確認接觸距離'};
        if (['foot','leftFoot','rightFoot','ankle','leftAnkle','rightAnkle','toes','heel','floor'].includes(item.target) && posture==='standing') return {valid:false,reason:'站立時低位目標需先屈身'};
      }
      if (['step','stepBack','stepSide','tiptoe','kick'].includes(item.action) && ['kneeling','sitting','lying','supine','prone','sideLying'].includes(posture)) return {valid:false,reason:'姿勢缺少站立支撐'};
      if (['spread','raise','lift'].includes(item.action) && ['bothLegs','bothFeet'].includes(item.actor) && posture==='standing' && item.action!=='spread') return {valid:false,reason:'站姿缺少足部支撐'};
      if (['maximum','veryWide'].includes(item.degree) && ['torso','neck','back','head'].includes(item.actor)) return {valid:false,reason:'過大關節幅度'};
      return {valid:true,reason:''};
    }
    function conflict(a,b) {
      if (stance(a) && stance(b) && stance(a)!==stance(b)) return true;
      if (!shared(a,b)) return false;
      if (opposites.some(pair=>pair.includes(a.action)&&pair.includes(b.action))) return true;
      if (positions.has(a.action) && positions.has(b.action)) return a.target!==b.target || a.action!==b.action;
      if (positions.has(a.action) !== positions.has(b.action)) {
        const other=positions.has(a.action)?b:a;
        if (['raise','lower','spread','close','cross','clamp','tuck','fold','extend','retract','lift','drop','straighten','bend','stretch','curl','foldAcross'].includes(other.action)) return true;
      }
      if (a.action===b.action && a.direction && b.direction && a.direction!==b.direction) return true;
      return false;
    }
    function repair(item,accepted,context={}) {
      const variants=[];
      const sides={bothArms:['leftArm','rightArm'],bothHands:['leftHand','rightHand'],bothLegs:['leftLeg','rightLeg'],bothFeet:['leftFoot','rightFoot']};
      if (sides[item.actor]) for(const actor of sides[item.actor]) variants.push({...item,actor});
      if (item.degree) variants.push({...item,degree:'slight'});
      if (item.direction) variants.push({...item,direction:undefined});
      if (item.action==='raise' && /Arm|Hand/.test(item.actor)) variants.push({...item,action:'extend'});
      if (item.action==='spread' && item.actor==='bothLegs') variants.push({...item,actor:'leftLeg'});
      for(const v of variants) if(!accepted.some(x=>conflict(x,v)) && validatePhysical(v,context).valid) return v;
      return null;
    }
    function solve(items,opts={}) {
      const accepted=[]; const max=Math.max(1,Math.min(12,Number(opts.maxActions)||8));
      const context={posture:opts.posture,hasClothing:opts.hasClothing};
      for(const item of items||[]) {
        if(accepted.length>=max) break;
        if(accepted.some(x=>key(x)===key(item))) continue;
        let next=item;
        if(!validatePhysical(next,context).valid || accepted.some(x=>conflict(x,next))) {
          if(opts.allowAdjustments===false) continue;
          next=repair(item,accepted,context);
        }
        if(next && validatePhysical(next,context).valid && !accepted.some(x=>conflict(x,next))) accepted.push({...next});
      }
      return accepted;
    }
    // Composer 僅使用有明確姿態語意的部位／動作；手動 API 仍保留完整詞庫。
    const composerActors=new Set(['body','torso','head','bothArms','leftArm','rightArm','bothHands','leftHand','rightHand','bothLegs','leftLeg','rightLeg','eyes','waist']);
    const composerActions=new Set(['faceCamera','angleCamera','turn','tilt','lean','arch','straighten','stretch','bend','raise','lower','spread','close','cross','rest','hold','cover','shield','foldAcross','clasp','step','stepBack','stepSide','plant','look','glance','smile','adjustClothing','smoothClothing','touch','extend']);
    function makeCandidates(opts={}) {
      const rng=safeRng(opts.rng);
      const profile=profiles[opts.profile] || profiles.general;
      const posture=stanceSet.has(opts.posture)?opts.posture:choose(profile.postures,rng);
      const actorsList=Array.isArray(opts.actors)&&opts.actors.length?opts.actors:Object.keys(actors);
      const allowed=actorsList.filter(a=>own(actors,a) && composerActors.has(a));
      const count=Math.max(1,Math.min(12,Number(opts.complexity)||4));
      const targets=Array.isArray(opts.targets)&&opts.targets.length?opts.targets:['waist','chest','shoulder','neck','hair','hip','thigh','knee','face','clothing','chair','wall'];
      const targetList=targets.filter(t=>own(parts,t));
      const pool=[],seen=new Map();
      for(let i=0;i<count*70;i++) {
        const actor=weighted(allowed,a=>(profile.categories[categories(a)]||1)/(1+(seen.get(categories(a))||0)*1.5),rng);
        if(!actor)break;
        const compatible=Object.keys(actions).filter(id=>actions[id].groups.includes(actors[actor].group) && semanticValid({actor,action:id}) && composerActions.has(id) && !stanceActions.has(id));
        const action=weighted(compatible,id=>(profile.actions[id]||1)/(1+pool.filter(x=>x.action===id).length*3),rng);
        if(!action)continue;
        const item={actor,action};
        if(actions[action].requiresTarget) {
          const possible=targetList.filter(t=>compatibleTarget(actor,action,t,opts));
          if(!possible.length)continue;
          item.target=choose(possible,rng);
        }
        if(rng()<0.22 && ['raise','lean','turn','tilt','arch','spread','bend','extend'].includes(action)) item.degree=choose(['slight','moderate','wide'],rng);
        if(rng()<0.20 && ['lean','turn','tilt','raise'].includes(action)) item.direction=choose(action==='raise'?['upward']:action==='turn'?['left','right','sideways']:['forward','backward','left','right'],rng);
        if(validatePhysical(item,{posture,hasClothing:opts.hasClothing}).valid) {
          pool.push(item);const cat=categories(actor);seen.set(cat,(seen.get(cat)||0)+1);
        }
      }
      return pool;
    }
    // 姿勢意圖先決定承重／軀幹主動作，再由 Solver 處理肢體。
    // 不指定 poseIntent 時使用自由生成模式。
    const poseIntents=Object.freeze({
      portrait:[{actor:'torso',action:'turn',direction:'sideways',degree:'slight'},{actor:'torso',action:'straighten'}],
      elegant:[{actor:'bothLegs',action:'cross'},{actor:'torso',action:'straighten'}],
      dynamic:[{actor:'rightLeg',action:'step'},{actor:'torso',action:'turn',direction:'sideways'}],
      contour:[{actor:'torso',action:'turn',direction:'sideways'},{actor:'torso',action:'arch',degree:'slight'}],
      guarded:[{actor:'torso',action:'turn',direction:'sideways',degree:'slight'},{actor:'torso',action:'straighten'}],
      confident:[{actor:'torso',action:'straighten'},{actor:'bothLegs',action:'cross'}],
      legs:[{actor:'rightLeg',action:'step'},{actor:'bothLegs',action:'cross'}],
      waist:[{actor:'torso',action:'turn',direction:'sideways'},{actor:'torso',action:'arch',degree:'slight'}],
      chest:[{actor:'torso',action:'straighten'},{actor:'torso',action:'turn',direction:'sideways',degree:'slight'}],
      hips:[{actor:'torso',action:'turn',direction:'sideways'},{actor:'bothLegs',action:'cross'}]
    });
    const auxiliaryActions=new Set(['adjustClothing','smoothClothing','look','glance','smile','touch']);
    function compose(opts={}) {
      const rng=safeRng(opts.rng);
      const profile=profiles[opts.profile]||profiles.general;
      const count=Math.max(1,Math.min(12,Number(opts.complexity)||4));
      const posture=stanceSet.has(opts.posture)?opts.posture:choose(profile.postures,rng);
      const explicitCore=Array.isArray(opts.coreActions)?opts.coreActions:[];
      const intentChoices=poseIntents[opts.poseIntent]||null;
      const intentSeed=intentChoices ? intentChoices[Math.floor(rng()*intentChoices.length)] : null;
      const core=intentSeed && !explicitCore.some(x=>['torso','body','waist'].includes(x.actor)&&['turn','lean','straighten','arch','twist'].includes(x.action))
        ? [intentSeed,...explicitCore] : explicitCore;
      const pool=makeCandidates({...opts,posture,rng}).filter(x=>!intentSeed || !auxiliaryActions.has(x.action) || opts.allowAuxiliary!==false);
      const resolved=solve([...core,...pool],{maxActions:count,posture,allowAdjustments:opts.allowAdjustments!==false,hasClothing:opts.hasClothing});
      // 動作種類與肢體分區多樣化：不犧牲核心動作，僅替換後續重複類型。
      const locked=Math.min(core.length,resolved.length);
      const selected=resolved.slice(0,locked);
      for(const item of resolved.slice(locked)) {
        const category=categories(item.actor);
        if(selected.some(x=>x.action===item.action && categories(x.actor)===category))continue;
        selected.push(item);
      }
      for(const item of pool) {
        if(selected.length>=count)break;
        const cat=categories(item.actor);
        if(selected.some(x=>x.action===item.action && categories(x.actor)===cat))continue;
        const next=solve([...selected,item],{maxActions:count,posture,allowAdjustments:opts.allowAdjustments!==false,hasClothing:opts.hasClothing});
        if(next.length>selected.length) selected.push(next[next.length-1]);
      }
      const primaryPose=opts.primaryPose===false?null:(opts.primaryPose&&own(primaryPoseEffects,opts.primaryPose)?opts.primaryPose:inferPrimaryPose(selected,posture));
      const enriched=selected.map(item=>({...enrichVisuals(item,opts),phraseVariant:Math.floor(rng()*1000)}));
      const effectOptions=primaryPose && wholeBodyEffectVariants[primaryPose];
      const wholeBodyEffect=effectOptions ? effectOptions[Math.floor(rng()*effectOptions.length)] : null;
      return {actions:enriched,posture,profile:opts.profile||'general',support:posture,primaryPose,wholeBodyEffect};
    }
    const generate = opts => compose(opts).actions;
    return {resources,conflict,repair,solve,validatePhysical,makeCandidates,compose,generate,profiles,compatibleTarget,poseIntents};
  })();
  function create(){return {actions:[]};}
  function add(pose,spec){
    if (!pose || !Array.isArray(pose.actions)) return false;
    const error = validate(spec);
    if (error) {console.warn('[PoseDescription]',error,spec);return false;}
    pose.actions.push(Object.assign({},spec));return true;
  }
  function render(pose,mode='simultaneous',view='action') {
    const raw = pose && Array.isArray(pose.actions) ? pose.actions : [];
    const selected = mode === 'sequential' ? raw : poseSolver.solve(raw,{maxActions:raw.length || 8,posture:pose && pose.posture,hasClothing:pose && pose.hasClothing});
    const arr = selected.map(renderAction).filter(Boolean);
    if (!arr.length) return '';
    // 同時發生的動作只在最後一個分句前放一次「同時」，
    // 避免「動作A，同時動作B，同時動作C」的機械重複。
    // 依序動作則保留「接著」，以明確表達先後關係。
    const output = mode === 'sequential'
      ? arr.join('，接著')
      : arr.length === 1 ? arr[0]
      : arr.slice(0,-1).join('，') + '，同時' + arr[arr.length-1];
    // 僅在 Composer 回傳的主體姿態上加一句整體效果；手動 poseAdd 不受影響。
    const effect=pose && pose.wholeBodyEffect && primaryPoseEffects[pose.primaryPose] && (pose.wholeBodyEffect===primaryPoseEffects[pose.primaryPose].text || (wholeBodyEffectVariants[pose.primaryPose]||[]).includes(pose.wholeBodyEffect)) ? pose.wholeBodyEffect : '';
    if (view === 'fragment') return output+(effect?'，'+effect:'');
    if (view === 'instruction') return '請' + output + (effect?'，'+effect:'') + '。';
    return '你' + output + '。' + (effect?'這個姿勢讓'+effect+'。':'');
  }
  // 在實際 DOM 容器中交給 SugarCube Wikifier 執行；不要用 <<print>> 輸出含 Widget 的字串。
  // Widget 產生的 HTML 會保留；未註冊的 Widget 由 SugarCube 顯示錯誤訊息。
  function renderInto(pose,mode,view,output) {
    const markup = render(pose,mode,view);
    if (!markup || !output) return;
    if (typeof Wikifier !== 'function') {
      console.warn('[PoseDescription] Wikifier 不可用');
      output.appendChild(document.createTextNode(markup));
      return;
    }
    new Wikifier(output,markup);
  }
  // 使用 JS Macro，直接取得 this.output；公開的 Twee 呼叫名稱與參數保持不變。
  // 請勿重複載入同名的 <<widget>> 定義。
  if (typeof Macro !== 'undefined' && typeof Macro.add === 'function') {
    Macro.add('poseBegin', { handler() { State.temporary.pdPose = create(); } });
    Macro.add('poseAdd', { handler() {
      if (!State.temporary.pdPose) { console.warn('[PoseDescription] 請先呼叫 poseBegin'); return; }
      add(State.temporary.pdPose,this.args[0]);
    } });
    Macro.add('poseEnd', { handler() {
      if (!State.temporary.pdPose) return;
      renderInto(State.temporary.pdPose,this.args[0] || 'simultaneous',this.args[1] || 'action',this.output);
    } });
    Macro.add('poseSingle', { handler() {
      const pose = create();
      if (add(pose,this.args[0])) renderInto(pose,'simultaneous',this.args[1] || 'action',this.output);
    } });
  }
  // JS 資料 API 保持穩定；生成的輸出字串可能隨詞庫改變。
  Object.assign(ns, {version:'0.2.10.1',poseIntents:poseSolver.poseIntents,primaryPoseEffects,inferPrimaryPose,inferVisualEffect,enrichVisuals,inferredVisualRules,configureAutoWidgets,autoWidgetConfig,solver:poseSolver,compose:poseSolver.compose,validatePhysical:poseSolver.validatePhysical,parts,actors,actions,directions,degrees,speeds,forces,contacts,
    durations,postures,gazes,cameras,clothings,effects,expressions,relations,coverage,visibility,originalWidgets,
    create,add,validate,render,renderAction,targetText,renderInto,
    registerPart:(id,data)=>{if(safeId(id)&&data&&typeof data.name==='string')parts[id]=data;},
    registerActor:(id,data)=>{if(safeId(id)&&data&&typeof data.name==='string')actors[id]=data;},
    registerAction:(id,data)=>{if(safeId(id)&&data&&Array.isArray(data.groups)&&typeof data.template==='string')actions[id]=data;},
    registerOriginalWidget:(id,widget)=>{if(safeId(id)&&safeId(widget))originalWidgets[id]={widget,verified:false,outputType:'text'};},
    stats:()=>({parts:Object.keys(parts).length,actors:Object.keys(actors).length,actions:Object.keys(actions).length,
      modifiers:Object.fromEntries(Object.entries({directions,degrees,speeds,forces,contacts,durations,postures,gazes,cameras,clothings}).map(([k,v])=>[k,Object.keys(v).length])),
      coverage:Object.keys(coverage).length,visibility:Object.keys(visibility).length,effects:Object.keys(effects).length,expressions:Object.keys(expressions).length,relations:Object.keys(relations).length})
  });
})();
