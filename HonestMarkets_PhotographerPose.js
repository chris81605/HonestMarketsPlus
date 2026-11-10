/* HonestMarkets 攝影師：只提供場景 Profile；所有動作均由獨立 Pose Engine 生成。 */
(function () {
  "use strict";
  const stageProfiles = ["general", "bold", "lingerie", "adult"];
  const stageComplexity = [3, 3, 3, 4];
  const stageTargets = [
    ["waist","shoulder","neck","hair","hip","thigh","knee","face","clothing","chair","wall"],
    ["waist","shoulder","neck","hair","hip","thigh","knee","face","clothing","chair","wall","chest","back"],
    ["waist","shoulder","neck","hair","hip","thigh","knee","face","clothing","chair","wall","chest","breasts","back","abdomen"],
    ["waist","shoulder","neck","hair","hip","thigh","knee","face","chair","wall","chest","breasts","back","abdomen","buttocks"]
  ];
  const captions = [
    "攝影師確認光線與構圖。",
    "攝影師調整角度，捕捉動作的張力。",
    "攝影師改用側光，強調服裝與姿態的線條。",
    "攝影師再次調整鏡位，要求你保持姿勢。"
  ];
  // 每階段 15 套範本；各鏡位分別使用範本、自由生成與範本變體。
  const templates = [[{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"},{"actor":"bothArms","action":"lower","effect":"relaxation","effectTarget":"shoulder"}],[{"actor":"torso","action":"turn","direction":"sideways","degree":"slight","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","target":"camera","effect":"profile","effectTarget":"face"}],[{"actor":"head","action":"turn","target":"camera","speed":"slow","effect":"profile","effectTarget":"face"},{"actor":"rightHand","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"}],[{"actor":"bothArms","action":"lower","effect":"relaxation","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"rest","target":"neck"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"torso","action":"lean","direction":"forward","degree":"slight","effect":"poseLine","effectTarget":"back"},{"actor":"head","action":"raise","effect":"highlight","effectTarget":"face"}],[{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"bothArms","action":"lower","effect":"relaxation","effectTarget":"shoulder"}],[{"actor":"leftHand","action":"rest","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"sideways","effect":"poseLine","effectTarget":"back"}],[{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"},{"actor":"head","action":"tilt","direction":"downward","effect":"angle","effectTarget":"face"}],[{"actor":"leftHand","action":"rest","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"sideways","effect":"poseLine","effectTarget":"back"}],[{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","target":"camera","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"lower","effect":"relaxation","effectTarget":"shoulder"},{"actor":"head","action":"turn","target":"camera","effect":"profile","effectTarget":"face"}],[{"actor":"bothLegs","action":"cross","effect":"asymmetry","effectTarget":"thigh"},{"actor":"leftHand","action":"rest","target":"thigh"}],[{"actor":"rightArm","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"bothLegs","action":"straighten","effect":"lengthen","effectTarget":"thigh"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"}],[{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"turn","target":"camera","effect":"profile","effectTarget":"face"}],[{"actor":"torso","action":"turn","direction":"backward","speed":"slow","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"head","action":"turn","target":"camera","effect":"profile","effectTarget":"face"},{"actor":"leftHand","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"}],[{"actor":"leftHand","action":"cover","target":"chest","targetWidget":"chest","coverage":"partial"},{"actor":"rightHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"foldAcross","target":"chest","targetWidget":"chest","coverage":"partial","effect":"contour","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"leftHand","action":"rest","target":"shoulder","effect":"balance","effectTarget":"shoulder"},{"actor":"rightHand","action":"cover","target":"chest","targetWidget":"chest","coverage":"partial"}],[{"actor":"bothLegs","action":"cross","posture":"sitting","effect":"asymmetry","effectTarget":"thigh"},{"actor":"bothHands","action":"rest","target":"thigh"}],[{"actor":"leftHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightArm","action":"raise","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"bothLegs","action":"straighten","effect":"lengthen","effectTarget":"thigh"},{"actor":"bothArms","action":"close","effect":"compact","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"cover","target":"chest","targetWidget":"chest","coverage":"partial"},{"actor":"leftHand","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"}],[{"actor":"bothHands","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"torso","action":"lean","direction":"forward","degree":"slight","effect":"poseLine","effectTarget":"back"}],[{"actor":"leftHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightHand","action":"rest","target":"neck"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"raise","degree":"high","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"leftArm","action":"raise","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"sideways","effect":"poseLine","effectTarget":"back"}],[{"actor":"bothHands","action":"rest","target":"neck"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"bothLegs","action":"cross","posture":"sitting","effect":"asymmetry","effectTarget":"thigh"},{"actor":"bothArms","action":"raise","effect":"lengthen","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothHands","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"torso","action":"twist","direction":"sideways","effect":"curve","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"leftHand","action":"rest","target":"shoulder","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"forward","effect":"poseLine","effectTarget":"back"}],[{"actor":"bothArms","action":"spread","effect":"open","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"leftHand","action":"hold","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightArm","action":"raise","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"arch","effect":"curve","effectTarget":"back"}],[{"actor":"bothHands","action":"rest","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"},{"actor":"rightHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"}],[{"actor":"leftHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"bothArms","action":"lower","effect":"relaxation","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"}],[{"actor":"rightHand","action":"rest","direction":"neck","target":"neck"},{"actor":"head","action":"tilt","direction":"sideways","effect":"angle","effectTarget":"face"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"sideways","effect":"poseLine","effectTarget":"back"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"bothLegs","action":"cross","effect":"asymmetry","effectTarget":"thigh"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"},{"actor":"rightHand","action":"rest","direction":"thigh","target":"thigh"}],[{"actor":"rightArm","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"torso","action":"lean","direction":"forward","effect":"poseLine","effectTarget":"back"},{"actor":"head","action":"raise","effect":"highlight","effectTarget":"face"},{"actor":"rightHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"rightHand","action":"rest","direction":"neck","target":"neck"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"bothLegs","action":"cross","effect":"asymmetry","effectTarget":"thigh"},{"actor":"leftHand","action":"rest","direction":"thigh","target":"thigh"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"sideways","effect":"poseLine","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"bothArms","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightArm","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"spread","effect":"open","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"rest","direction":"neck","target":"neck"},{"actor":"torso","action":"arch","effect":"curve","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}],[{"actor":"bothLegs","action":"cross","effect":"asymmetry","effectTarget":"thigh"},{"actor":"leftHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"torso","action":"lean","direction":"forward","effect":"poseLine","effectTarget":"back"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"bothArms","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"arch","effect":"curve","effectTarget":"back"},{"actor":"head","action":"turn","direction":"sideways","effect":"profile","effectTarget":"face"}],[{"actor":"rightHand","action":"rest","direction":"waist","target":"waist","effect":"frame","effectTarget":"waist"},{"actor":"torso","action":"twist","direction":"sideways","effect":"curve","effectTarget":"waist"},{"actor":"head","action":"turn","direction":"forward","effect":"profile","effectTarget":"face"}],[{"actor":"leftHand","action":"rest","direction":"wall","target":"wall","effect":"balance","effectTarget":"shoulder"},{"actor":"rightArm","action":"raise","direction":"upward","effect":"lengthen","effectTarget":"shoulder"},{"actor":"torso","action":"turn","direction":"sideways","effect":"profile","effectTarget":"waist"}],[{"actor":"bothArms","action":"spread","effect":"open","effectTarget":"shoulder"},{"actor":"torso","action":"straighten","effect":"alignment","effectTarget":"back"},{"actor":"head","action":"tilt","direction":"upward","effect":"angle","effectTarget":"face"}]];
  const ns = setup.HonestMarketsPhotographerPose = {
    stageProfiles, templates,
    compose(id,focus) {
      const pd=setup.poseDescription;
      if (!pd || typeof pd.compose!=="function") return {error:"Pose Composer 未載入"};
      const index=Number(id);
      if (!Number.isInteger(index)||index<0||index>=36) return {error:"姿勢索引不合法"};
      const stage=Math.floor(index/9), shot=index%3;
      const source=templates.slice(stage*9,stage*9+9).concat(templates.slice(36+stage*6,42+stage*6));
      const template=source[Math.floor(Math.random()*source.length)];
      const intentsByStage=[['portrait','elegant','dynamic'],['dynamic','contour','confident'],['contour','elegant','guarded'],['confident','contour','dynamic']];
      const poseIntent=shot===1 && ['legs','waist','chest','hips','feet'].includes(focus) ? focus : intentsByStage[stage][shot];
      const opts={profile:stageProfiles[stage],poseIntent:poseIntent==="feet"?"legs":poseIntent,complexity:stageComplexity[stage],
        hasClothing:stage<3,allowAdjustments:stage<3,targets:stageTargets[stage]};
      // 範本也是 Composer 核心動作，全部交由同一 Solver 處理，不另寫求解邏輯。
      if(focus==="feet" && shot===1) opts.coreActions=[
        {actor:"torso",action:"straighten"},
        {actor:"rightLeg",action:"step",direction:"forward"}
      ];
      if(shot===0)opts.coreActions=template;
      if(shot===2)opts.coreActions=template.slice(0,1);
      const result=pd.compose(opts);
      return {stage,shot,result,template};
    }
  };
  // 反應姿勢只接受事件層已判定的部位與心理類型，動作仍交由 Pose Composer/Solver。
  const reactionActions = {
    chest: {
      guarded: [{actor:"bothArms",action:"cross"},{actor:"torso",action:"turn",direction:"sideways"}],
      hesitant: [{actor:"torso",action:"turn",direction:"sideways",degree:"slight"},{actor:"head",action:"turn",target:"camera"}],
      confident: [{actor:"torso",action:"straighten"},{actor:"bothArms",action:"spread"}],
      playful: [{actor:"torso",action:"arch",effect:"curve",effectTarget:"chest"},{actor:"bothArms",action:"spread",effect:"open",effectTarget:"chest"}]
    },
    hips: {
      guarded: [{actor:"torso",action:"turn",direction:"sideways"},{actor:"bothLegs",action:"cross"}],
      hesitant: [{actor:"torso",action:"turn",direction:"sideways",degree:"slight"},{actor:"rightHand",action:"rest",target:"waist"}],
      confident: [{actor:"torso",action:"twist",direction:"sideways"},{actor:"rightHand",action:"rest",target:"waist"}],
      playful: [{actor:"torso",action:"twist",direction:"sideways",effect:"curve",effectTarget:"waist"},{actor:"bothLegs",action:"cross"}]
    },
    legs: {
      guarded: [{actor:"bothLegs",action:"cross"},{actor:"bothArms",action:"lower"}],
      hesitant: [{actor:"bothLegs",action:"cross"},{actor:"head",action:"turn",target:"camera"}],
      confident: [{actor:"bothLegs",action:"straighten"},{actor:"torso",action:"straighten"}],
      playful: [{actor:"bothLegs",action:"straighten",effect:"lengthen",effectTarget:"thigh"},{actor:"rightHand",action:"rest",target:"waist"}]
    },
    waist: {
      guarded: [{actor:"torso",action:"turn",direction:"sideways"},{actor:"bothArms",action:"lower"}],
      hesitant: [{actor:"rightHand",action:"rest",target:"waist"},{actor:"head",action:"turn",target:"camera"}],
      confident: [{actor:"torso",action:"twist",direction:"sideways"},{actor:"rightHand",action:"rest",target:"waist"}],
      playful: [{actor:"torso",action:"twist",direction:"sideways",effect:"curve",effectTarget:"waist"},{actor:"bothArms",action:"spread"}]
    }
  };
  ns.composeReaction = function (context) {
    const pd=setup.poseDescription;
    if (!pd || typeof pd.compose!=="function") return null;
    const coreActions=reactionActions[context.focus]?.[context.reaction];
    if (!coreActions) return null;
    const profile=stageProfiles[context.phase] || "bold";
    const result=pd.compose({profile,complexity:Math.max(2,stageComplexity[context.phase]-2),
      coreActions:coreActions.map(a=>({...a})),inferEffects:true,
      hasClothing:context.phase<3,allowAdjustments:false,
      targets:stageTargets[context.phase]});
    return result?.actions?.length ? result.actions : coreActions;
  };
  Macro.add("hmPhotographerReactionPose",{
    handler() {
      const [phase,index,focus,reaction]=this.args;
      const actions=ns.composeReaction({phase:Number(phase),index:Number(index),focus:String(focus),reaction:String(reaction)});
      if (!actions?.length) return;
      const pd=setup.poseDescription,pose=pd.create();
      actions.forEach(action=>pd.add(pose,action));
      if (pose.actions.length) pd.renderInto(pose,"simultaneous","action",this.output);
    }
  });
  // 僅啟用已由事件使用端確認的原版 Widget；不強制每次輸出。
  if (setup.poseDescription && typeof setup.poseDescription.configureAutoWidgets === "function") {
    setup.poseDescription.configureAutoWidgets({enabled:true,mappings:{
      chest:{widget:"chest",mode:"append"},
      breasts:{widget:"chest",mode:"append"},
      buttocks:{widget:"bottom",mode:"append"},
      genitals:{widget:"genitals",mode:"append"}
    }});
  }
  // 攝影事件的敘事整流：每張只保留少量互不矛盾的動作；不修改通用 Pose Engine。
  function conciseActions(actions, limit) {
    const chosen=[], occupied=new Set();
    const region=actor => {
      if (/Leg|Knee|Foot|Thigh/i.test(actor)) return "legs";
      if (/Arm|Hand|Shoulder/i.test(actor)) return "arms";
      if (/torso|hip|waist/i.test(actor)) return "torso";
      if (/head|neck/i.test(actor)) return "head";
      return actor;
    };
    for (const action of actions) {
      if (!action || !action.actor || !action.action) continue;
      const key=region(String(action.actor));
      if (occupied.has(key)) continue;
      chosen.push(action); occupied.add(key);
      if (chosen.length >= limit) break;
    }
    return chosen;
  }
  Macro.add("hmPhotographerPose", {
    handler() {
      const id=Number(this.args[0]);
      const focus=String(this.args[1]||"");
      const encounter=this.args[2];
      const shotIndex=Number(this.args[3]);
      const phase=Number(encounter?.phase);
      const cacheKey=Number.isInteger(phase) && Number.isInteger(shotIndex) ? `${phase}:${shotIndex}` : null;
      const cache=encounter && typeof encounter==="object" ? (encounter.photoPoseCache ||= {}) : null;
      const cached=cacheKey && cache?.[cacheKey];
      // 同一事件同一張照片固定動作；切換頁面不重新抽範本。
      const composed=cached && cached.id===id && cached.focus===focus
        ? {stage:Math.floor(id/9),shot:id%3,result:{actions:cached.actions}}
        : ns.compose(id,focus);
      if (composed.error) {
        console.warn("[HonestMarkets Pose]",composed.error);
        new Wikifier(this.output,"<span class='red'>[Pose] "+composed.error+"</span>");
        return;
      }
      const pd = setup.poseDescription;
      const actions = composed.result && composed.result.actions;
      if (!Array.isArray(actions) || !actions.length) {
        console.warn("[HonestMarkets Pose] Composer 未產生動作",composed);
        new Wikifier(this.output,"<span class='red'>[Pose] Composer 未產生動作，請查看控制台。</span>");
        return;
      }
      const pose = pd.create();
      const selected=conciseActions(actions,3);
      if (cache && cacheKey && !cached) cache[cacheKey]={id,focus,actions:selected.map(a=>({...a}))};
      selected.forEach(action => pd.add(pose,action));
      if (!pose.actions.length) {
        console.warn("[HonestMarkets Pose] 所有動作均未通過驗證",composed);
        new Wikifier(this.output,"<span class='red'>[Pose] 動作驗證失敗，請查看控制台。</span>");
        return;
      }
      pd.renderInto(pose,"simultaneous","action",this.output);
      if (composed.shot === 0) new Wikifier(this.output," "+captions[composed.stage]);
    }
  });
})();
