import{t as e}from"./facts-CVNvrT-z.js";import{t}from"./rules-DTO5C2xl.js";import{n}from"./quick-CXCR75GO.js";var r={calm:`静`,nervous:`慌`,angry:`怒`,scared:`惧`,sad:`悲`,relieved:`安`},i={calm:`平静`,nervous:`紧张`,angry:`恼火`,scared:`害怕`,sad:`难过`,relieved:`松了口气`};function a(e){return String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e])}var o=(e,t)=>e.characters.find(e=>e.id===t),s=(e,t)=>e.locations.find(e=>e.id===t)?.name??t;function c(e,t=``){return`<span class="mood ${e} ${t}" title="${i[e]}">${r[e]}</span>`}function l(e){return`<div class="stress" title="压力"><i style="width:${Math.round(e)}%"></i></div>`}function u(e){let{ui:t}=e,n=``;switch(t.screen){case`title`:n=d(e);break;case`intro`:n=f(e);break;case`ending`:n=L(e);break;default:n=y(e)}return t.modal&&(n+=T(e)),t.toast&&(n+=`<div class="toast panel">${t.toast}</div>`),`<div class="root">${n}</div>`}function d({ui:e}){return`<div class="title">
    <h1 class="serif">宗门内奸</h1>
    <div class="sub">雨夜，藏经阁的镇派秘籍失窃。五个会撒谎的弟子，天亮前找出魔门内奸。</div>
    <div class="menu">
      <button class="${e.settings.tutorialDone?``:`primary`}" data-act="tutorial">新手教学${e.settings.tutorialDone?``:`（第一次玩点这里）`}</button>
      <button class="${e.settings.tutorialDone?`primary`:``}" data-act="new">开始新案</button>
      ${e.hasSave?`<button data-act="continue">继续本局</button>`:``}
      <button data-act="howto">怎么玩</button>
      <button data-act="settings">设置</button>
    </div>
    <div class="notice" style="margin-top:14px">AI：${a(e.aiLabel)}</div>
  </div>`}function f({ui:e,game:t}){let n=t.introLines(),r=Math.min(e.introStep,n.length-1);return`<div class="intro panel" data-act="intro-next">
    <div class="line"><span class="who">严长老</span><span data-typing>${a(n[r])}</span></div>
    <div class="bar"><button class="ghost" data-act="intro-skip">跳过</button><button class="primary" data-act="intro-next">${r<n.length-1?`继续`:`开始审案`}</button></div>
  </div>`}function p({game:e,data:t,ui:n}){let r=e,i=r.state.questionsLeft;return`<div class="top">
    <div class="censer panel ${i<=t.config.dawn_warning_at?`low`:``}" title="剩余问话">
      ${m()}<span class="num">${i}</span><span class="lbl">炷香<br>天亮前</span>
    </div>
    <div class="case-info panel">案发${a(r.case.time_slot)} · 失窃${a(r.case.stolen_item.name)} · 案件 ${r.case.seed}</div>
    <div class="spacer"></div>
    <button class="ghost" data-act="howto" title="怎么玩">？</button>
    <button class="ghost" data-act="settings" title="设置">设置</button>
  </div>`}function m(){return`<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M7 16h20l-3 9H10z" fill="#b8893f"/><rect x="5" y="14" width="24" height="3" rx="1" fill="#d9a54a"/><path d="M11 25l-2 5M23 25l2 5M17 25v5" stroke="#8a6630" stroke-width="2"/><path d="M14 13c0-3 3-3 2-7M18 13c0-3 3-3 2-7" stroke="#cfc6b4" stroke-width="1.5" fill="none" opacity=".8"/></svg>`}function h(e){let t=e.game;return`<div class="cast panel">${t.case.disciples.map(n=>{let r=o(e.data,n.id),i=t.state.disciples[n.id];return`<button class="card ghost ${i.refused?`refused`:``}" data-act="talk" data-id="${n.id}" title="审问${a(r.name)}">
        ${c(i.emotion)}${i.confessed?`<span class="tag">已坦白</span>`:i.refused?`<span class="tag">拒答</span>`:``}
        <img src="${e.portrait(n.id)}" alt="">
        <span class="nm">${a(r.name)}</span><span class="id">${a(r.identity)}</span>${l(i.stress)}
      </button>`}).join(``)}</div>`}function g(e){return`<div class="actions">
    <button class="ghost" data-act="map">勘察各处</button>
    <button class="ghost" data-act="cluebook">线索簿（${e.game.state.clues.length}）</button>
    <button class="danger" data-act="accuse">指认内奸</button>
  </div>`}function _(e){if(!e.ui.showStats||!e.game)return``;let t=e.game.state.stats;return`<div class="stats panel">开发 · ${a(e.ui.aiLabel)} · 调用 ${t.calls}/${e.data.config.budget.max_calls_per_case} · token ${t.inputTokens}/${t.outputTokens}（缓存 ${t.cachedInputTokens}） · 平均 ${e.game.averageLatencyMs()} 毫秒 · 兜底 ${t.fallbackTurns}/${t.turns}</div>`}function v(e){let t=e.ui.tutorialStep;if(t===void 0)return``;let n=e.data.templates.elder.tutorial;return`<div class="coach panel"><b>严长老：</b>${a(n[Math.min(t,n.length-1)])}</div>`}function y(e){let{ui:t}=e,n=p(e)+v(e);return t.screen===`main`&&(n+=b(e)+h(e)+g(e)),t.screen===`map`&&(n+=x(e)),t.screen===`location`&&(n+=C(e)),t.screen===`talk`&&(n+=w(e)),n+_(e)}function b(e){let t=e.game;return t.case.disciples.map(e=>`<div class="float head-mood" data-float-char="${e.id}">${c(t.state.disciples[e.id].emotion)}</div>`).join(``)}function x(e){let t=e.game;return`${e.data.locations.map(e=>`<button class="float loc-label ${t.state.visited.includes(e.id)?`visited`:``}" data-act="goto" data-loc="${e.id}" data-float-loc="${e.id}">${a(e.name)}</button>`).join(``)}<div class="sheet panel"><div class="row"><span style="flex:1">点一处地点前去勘察。勘察不耗问话，找到的物证会自动记进线索簿。</span><button class="primary" data-act="plaza">回广场</button></div></div>`}function S(e,t,n={}){return`<div class="clue ${n.isNew?`new`:``} ${n.button?`pickable`:``} ${n.extra??``}">${a(t.text)}${n.meta?`<div class="meta">${n.meta}</div>`:``}${n.button??``}</div>`}function C(e){let t=e.game,n=e.data.locations.find(t=>t.id===e.ui.location),r=t.case.investigation[n.id]??[],i=r.map(n=>S(e,t.fact(n),{isNew:e.ui.newClues.includes(n)})).join(``);return`<div class="sheet panel">
    <h2 class="serif">${a(n.name)}</h2>
    <div class="desc">${a(n.desc)}${r.length?``:a(n.empty_text)}</div>
    ${i}
    ${r.length?`<div class="notice">已记进线索簿。</div>`:``}
    <div class="row" style="margin-top:8px"><button data-act="map">看看别处</button><button class="primary" data-act="plaza">回广场</button></div>
  </div>`}function w(e){let t=e.game,r=e.ui.focus,i=o(e.data,r),s=t.state.disciples[r],l=t.state.transcripts[r],u=l.map((e,t)=>{let n=t===l.length-1;return e.from===`player`?`<div class="msg player"><span>${a(e.text)}</span></div>`:e.from===`system`?`<div class="msg ${e.text.startsWith(`【矛盾成立`)?`verdict`:e.text.startsWith(`【`)?`verdict ok`:`system`}"><span>${a(e.text)}</span></div>`:`<div class="msg disciple"><span ${n?`data-typing`:``}>${a(e.text)}</span></div>`}).join(``),d=n(t),f=e.ui.thinking||s.refused||t.state.questionsLeft<=0?`disabled`:``;return`<div class="talk panel">
    <header>
      <img src="${e.portrait(r)}" alt="">
      <div><div class="who">${a(i.name)}</div><div class="notice">${a(i.identity)} · ${a(i.personality)}</div></div>
      ${c(s.emotion)}
      <div class="stress" style="width:110px" title="压力"><i style="width:${s.stress}%"></i></div>
      <div class="spacer"></div>
      <button class="ghost" data-act="dossier" data-id="${r}">档案</button>
      <button class="ghost" data-act="plaza">返回</button>
    </header>
    <div class="log" data-log>${u||`<div class="msg system"><span>${a(i.name)}站在你面前，等你开口。问一句或出示一条证据，都要烧掉一炷香。</span></div>`}
      ${e.ui.thinking?`<div class="msg system"><span class="thinking">（${a(i.name)}思索中……）</span></div>`:``}</div>
    <div class="quick">
      ${d.map((e,t)=>`<button data-act="quick" data-i="${t}" ${f}>${a(e)}</button>`).join(``)}
      <button data-act="askAbout" ${f}>问某人的事</button>
      <button class="primary" data-act="present" ${f}>出示证据</button>
    </div>
    <form class="inputrow" data-form="ask">
      <input data-input="ask" maxlength="${e.data.config.input_max_chars}" placeholder="${s.refused?`${a(i.name)}不肯再开口了`:`想问什么？（最多 60 字）`}" ${f} enterkeyhint="send" autocomplete="off">
      <button class="primary" type="submit" ${f}>问</button>
    </form>
  </div>`}function T(e){switch(e.ui.modal){case`cluebook`:return D(e);case`dossier`:return A(e);case`accuse`:return j(e);case`confirm`:return N(e);case`settings`:return F(e);case`askAbout`:return P(e);case`help`:return I();default:return``}}var E={physical:`物证（勘察所得）`,testimony:`证词（弟子说的话）`,confession:`坦白与失言`};function D(e){let t=e.game,n=e.ui.clueMode===`present`&&e.ui.focus,r=t.state.intuition,i=!n&&e.ui.markMode,s=n?t.state.disciples[e.ui.focus]:void 0,c=[`physical`,`testimony`,`confession`].map(o=>{let c=t.state.clues.filter(e=>e.category===o);return c.length?`<div class="group"><h3>${E[o]}</h3>${c.map(o=>{let c=t.fact(o.factId),l=s?.presented.includes(o.factId),u=e.ui.markPick.includes(o.factId),d=n?l?`<button disabled>已出示</button>`:`<button class="primary" data-act="present-fact" data-fact="${o.factId}">出示</button>`:i?`<button class="${u?``:`primary`}" data-act="mark-pick" data-fact="${o.factId}">${u?`已选`:`选`}</button>`:void 0,f=r&&(r.evidence===o.factId||r.claim===o.factId);return S(e,c,{meta:`第 ${o.order} 条 · 来自${a(o.via)}${f?` · <b>掌门直觉：这两条对不上</b>`:``}`,button:d,extra:`${f?`intuit`:``} ${u?`picked`:``}`})}).join(``)}</div>`:``}).join(``),l=n?`向${a(o(e.data,e.ui.focus).name)}出示证据`:`线索簿`,u=t.state.marks.map((e,n)=>`<div class="markrow">你标记的矛盾：${a(t.fact(e[0]).text)} <b>↔</b> ${a(t.fact(e[1]).text)} <button data-act="unmark" data-i="${n}">取消</button></div>`).join(``),d=n?``:`<div class="row" style="margin-top:6px">
        <button data-act="intuition" ${r?`disabled`:``}>掌门直觉${r?`（已用）`:`（剩 1 次）`}</button>
        <button class="${i?`primary`:``}" data-act="mark-mode">${i?`标记中：选 2 条（已选 ${e.ui.markPick.length}）`:`标记矛盾`}</button>
      </div>${u}`;return`<div class="modal"><div class="panel">
    <div class="row"><h2 class="serif" style="flex:1">${l}</h2><button data-act="close">关闭</button></div>
    ${n?`<div class="notice">出示一条证据要烧掉一炷香。和他的说法对不上，他就会慌；同一条证据对同一个人只能出示一次。</div>`:d}
    <div class="scroll">${c||`<div class="notice">线索簿还是空的。先去各处勘察，或者问问弟子们。</div>`}</div>
  </div></div>`}var O={robe:`外袍`,habit:`习惯`,item:`随身物`};function k(e,t){return e.state.clues.map(t=>e.fact(t.factId)).filter(e=>{if(e.holder===t)return!0;switch(e.kind){case`presence`:case`empty_room`:case`claim`:return e.params.person===t;case`exclusive`:return e.params.people.includes(t);default:return!1}}).map(e=>e.id)}function A(e){let t=e.game,n=e.ui.focus,r=o(e.data,n),i=r.traits.map(t=>e.data.traits.find(e=>e.id===t)).map(e=>`<span class="${e.visible?``:`hidden-trait`}" title="${e.visible?`看得出来`:`看不出来，档案里写着`}">${O[e.category]}：${a(e.name)}</span>`).join(``),s=k(t,n).map(n=>S(e,t.fact(n))).join(``);return`<div class="modal"><div class="panel">
    <div class="row"><img src="${e.portrait(n)}" style="width:64px;height:64px;image-rendering:pixelated;border-radius:10px" alt="">
      <div style="flex:1"><h2 class="serif">${a(r.name)}</h2><div class="notice">${a(r.identity)} · ${a(r.personality)}</div></div>
      <button data-act="close">关闭</button></div>
    <div class="traits">${i}</div>
    <div class="notice">${a(r.bio)}</div>
    <div class="scroll"><div class="group"><h3>与${a(r.name)}相关的线索</h3>${s||`<div class="notice">还没有。</div>`}</div></div>
  </div></div>`}function j(e){let t=e.game,n=e.ui.accuse,r=t.state.phase===`accuse`&&t.state.questionsLeft<=0,i=t.case.disciples.map(t=>{let r=o(e.data,t.id);return`<button class="card ghost ${n.who===t.id?`on`:``}" data-act="pick-who" data-id="${t.id}"><img src="${e.portrait(t.id)}" alt=""><span class="nm">${a(r.name)}</span></button>`}).join(``),s=t.state.clues.map(e=>{let r=t.fact(e.factId),i=n.evidence.includes(e.factId);return`<div class="clue pickable ${i?`picked`:``}">${a(r.text)}<div class="meta">${M(r)} · 来自${a(e.via)}</div><button class="${i?``:`primary`}" data-act="pick-ev" data-fact="${e.factId}">${i?`取消`:`选它`}</button></div>`}).join(``),c=n.who&&n.evidence.length===2;return`<div class="modal"><div class="panel">
    <div class="row"><h2 class="serif" style="flex:1">${r?`天亮了，必须指认`:`指认内奸`}</h2>${r?``:`<button data-act="close">再想想</button>`}</div>
    <div class="notice">选出你认定的内奸，再从线索簿里挑 2 条最能定罪的证据。</div>
    <div class="pick" style="margin:8px 0">${i}</div>
    <div class="notice">已选证据 ${n.evidence.length}/2</div>
    <div class="scroll">${s||`<div class="notice">线索簿是空的。</div>`}</div>
    <button class="danger" data-act="accuse-confirm" ${c?``:`disabled`}>就是${n.who?a(o(e.data,n.who).name):`他`}！</button>
  </div></div>`}function M(t){return{physical:`物证`,testimony:`证词`,confession:`坦白与失言`}[e(t)]}function N(e){let t=o(e.data,e.ui.accuse.who).name;return`<div class="modal"><div class="panel" style="width:min(420px,100%)">
    <h2 class="serif">确定指认${a(t)}？</h2>
    <div class="notice" style="margin:10px 0">指认之后就不能反悔了。</div>
    <div class="row"><button data-act="accuse-back">再想想</button><button class="danger" data-act="accuse-final">确定</button></div>
  </div></div>`}function P(e){let t=e.game,n=t.case.disciples.filter(t=>t.id!==e.ui.focus).map(t=>`<button class="card ghost" data-act="ask-about" data-id="${t.id}"><img src="${e.portrait(t.id)}" alt=""><span class="nm">${a(o(e.data,t.id).name)}</span></button>`).join(``);return`<div class="modal"><div class="panel" style="width:min(620px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">问问他见没见过谁</h2><button data-act="close">关闭</button></div>
    <div class="notice">会问：「你${a(t.case.time_slot)}见过某某吗？」</div>
    <div class="pick" style="margin-top:10px">${n}</div>
  </div></div>`}function F(e){let t=e.ui.settings,n=(e,t,n,r)=>`<button class="${r===t?`primary`:``}" data-act="set" data-k="${e}" data-v="${t}">${n}</button>`;return`<div class="modal"><div class="panel" style="width:min(560px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">设置</h2><button data-act="close">关闭</button></div>
    <div class="group"><h3>文字速度</h3><div class="row">${n(`textSpeed`,`slow`,`慢`,t.textSpeed)}${n(`textSpeed`,`normal`,`中`,t.textSpeed)}${n(`textSpeed`,`fast`,`快`,t.textSpeed)}${n(`textSpeed`,`instant`,`立即`,t.textSpeed)}</div></div>
    <div class="group"><h3>AI 由谁来演</h3><div class="row">${n(`provider`,`auto`,`自动`,t.provider)}${n(`provider`,`template`,`模板应答（离线）`,t.provider)}${n(`provider`,`proxy`,`本地代理（开发）`,t.provider)}</div>
      <div class="notice" style="margin-top:6px">当前：${a(e.ui.aiLabel)}。发布版接入模型服务前，用模板应答也能完整玩一局。</div></div>
    <div class="group"><h3>音量</h3><div class="row">${[[`0`,`关`],[`0.3`,`低`],[`0.6`,`中`],[`1`,`高`]].map(([e,n])=>`<button class="${Number(e)===t.volume?`primary`:``}" data-act="set" data-k="volume" data-v="${e}">${n}</button>`).join(``)}</div>
      <div class="notice" style="margin-top:6px">雨声、钟声、翻书声都是现场合成的。</div></div>
  </div></div>`}function I(){return`<div class="modal"><div class="panel" style="width:min(640px,100%)">
    <div class="row"><h2 class="serif" style="flex:1">怎么玩</h2><button data-act="close">知道了</button></div>
    <div class="scroll" style="line-height:1.8">
      <p>藏经阁的秘籍被偷了。五名弟子里藏着一个魔门内奸。天亮前（30 炷香）找出他。</p>
      <p><b>勘察各处</b>：不耗香。藏经阁里留着窃贼的特征（比如穿什么颜色的袍子、个子高不高），其他地方可能有人留下的痕迹。</p>
      <p><b>审问</b>：点下方的弟子。每问一句、每出示一条证据，烧掉一炷香。</p>
      <p><b>出示证据</b>：和他的说法对不上，他就会慌。被逼急了，有秘密的人会坦白；内奸会说漏嘴。</p>
      <p><b>推理</b>：先用特征缩小嫌疑；再看谁的不在场证明有别人或物证作证；剩下那个说法被戳穿的人，就是内奸。</p>
      <p><b>指认</b>：选出内奸，再附 2 条证据。证据越硬、剩的香越多，评级越高。</p>
    </div>
  </div></div>`}function L(e){let n=e.game,r=n.state.ending,i=r.rating.grade,s=n.truthTable().map(e=>`<tr class="${e.role===`内奸`?`culprit`:``}"><td><b>${a(e.name)}</b><br><span class="notice">${a(e.role)}</span></td><td>${a(e.truth)}</td><td>${a(e.claim)}${e.truth===e.claim?``:` ✗`}</td><td>${e.secret?a(e.secret):`—`}${e.role===`内奸`?e.flaws.map(e=>`<div class="flaw">破绽：${a(e)}</div>`).join(``):``}</td></tr>`).join(``);return`<div class="modal"><div class="panel">
    <div class="grade serif ${i===`fail`?`fail`:``}">${a(t[i])}</div>
    <div class="notice" style="text-align:center">指认：${a(o(e.data,r.accused).name)} · 真正的内奸：${a(o(e.data,n.case.culprit).name)} · 有效证据 ${r.rating.validEvidence.length}/2 · 剩余 ${n.state.questionsLeft} 炷香</div>
    <div class="scroll">
      <div class="epilogue">${e.ui.epilogueLoading?`（尾声撰写中……）`:`<span data-typing>${a(r.epilogue??``)}</span>`}</div>
      <h3 style="color:var(--gold);margin:14px 0 4px">真相复盘 · 案发${a(n.case.time_slot)}</h3>
      <table class="truth"><tr><th>弟子</th><th>真实位置</th><th>对掌门说</th><th>秘密 / 破绽</th></tr>${s}</table>
      <div class="notice" style="margin-top:8px">案件编号 ${n.case.seed}，把它告诉朋友，可以挑战同一个案子。</div>
    </div>
    <div class="row"><button class="primary" data-act="new">再来一局</button><button data-act="replay">重玩本案</button><button data-act="title">回标题</button></div>
  </div></div>`}export{u as a,k as i,a as n,s as r,r as t};