import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import {Activity, Brain, Gauge, Radar, History, Settings, ShieldAlert, Search, Zap, Layers, Play, Pause, X} from "lucide-react";
import "./styles.css";


const API = "";

window.addEventListener("error", (e) => {
  document.body.innerHTML = `<pre style="color:#fff;background:#061426;padding:20px;font-size:16px;white-space:pre-wrap">
ApexQuant dashboard crashed:

${e.message}

${e.filename}:${e.lineno}:${e.colno}
</pre>`;
});

function arr(v){
  if(Array.isArray(v)) return v;
  if(!v) return [];
  if(typeof v === "object") return Object.values(v);
  return [];
}

const TARGET = 200;

const money = (v) => `£${Number(v || 0).toFixed(2)}`;
const num = (v) => Number(v || 0);
const cls = (v) => num(v) >= 0 ? "good" : "bad";
const safe = (v, fallback = "—") => v === undefined || v === null || v === "" ? fallback : v;

function App(){
  const [tab,setTab]=useState("dashboard");
  const [state,setState]=useState(null);
  const [lastGood,setLastGood]=useState(null);
  const [error,setError]=useState("");
  const [modal,setModal]=useState(false);
  const [busy,setBusy]=useState(false);
  const [selectedPair,setSelectedPair]=useState(null);
  const [filter,setFilter]=useState("ALL");

  async function load(){
    try{
      const r=await fetch(`${API}/api/state`);
      const d=await r.json();
      setState(d); setLastGood(d); setError("");
    }catch(e){
      setError("API disconnected");
      if(lastGood) setState(lastGood);
    }
  }

  useEffect(()=>{load(); const id=setInterval(load,3000); return()=>clearInterval(id)},[]);

  async function action(path,confirmText){
    if(confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try{ await fetch(`${API}${path}`,{method:"POST"}); await load(); }
    finally{ setBusy(false); }
  }

  const d = state;
  if(!d) return <div className="loading">Loading ApexQuant Command Centre...</div>;

  const scalp=d.portfolios?.scalp || {openTrades:[],closedTrades:[],dailyPnlGbp:0};
  const strategy=d.portfolios?.strategy || {openTrades:[],closedTrades:[],dailyPnlGbp:0};
  const openTrades=[...arr(scalp.openTrades),...arr(strategy.openTrades)];
  const closed=arr(d.recentTrades);
  const allClosed=[...arr(scalp.closedTrades),...arr(strategy.closedTrades)];
  const totalPnl=num(scalp.dailyPnlGbp)+num(strategy.dailyPnlGbp);
  const progress=Math.max(0,Math.min(100,(totalPnl/TARGET)*100));

  let sum=0;
  const equity=[...closed].reverse().map((t,i)=>({name:i+1,pnl:sum+=num(t.pnl?.netGbp)}));

  const stats=performanceStats(allClosed);
  const learningRows=Object.values(d.setupLearning?.setups||{});
  const whatIfRows=arr(d.whatIf);
  const reviewed=arr(d.reviewedPairs);

  return <div className="app">
    <Sidebar tab={tab} setTab={setTab} running={d.engine?.running} paused={d.engine?.paused}/>
    <main className="main">
      <TopBar d={d} error={error} busy={busy} onStart={()=>action("/api/start")} onPause={()=>action("/api/pause")} onSellAll={()=>action("/api/close-all","Sell ALL open positions now?")}/>
      {tab==="dashboard" && <Dashboard d={d} scalp={scalp} strategy={strategy} totalPnl={totalPnl} progress={progress} openTrades={openTrades} closed={closed} equity={equity} stats={stats} learningRows={learningRows} whatIfRows={whatIfRows} setTab={setTab} setModal={setModal} sellTrade={(id)=>action(`/api/trades/${id}/panic-sell`,"Sell this trade now?")}/>}
      {tab==="live" && <LiveTrades openTrades={openTrades} setModal={setModal} sellTrade={(id)=>action(`/api/trades/${id}/panic-sell`,"Sell this trade now?")} sellAll={()=>action("/api/close-all","Sell ALL open positions now?")}/>}
      {tab==="scanner" && <MarketScanner reviewed={reviewed} filter={filter} setFilter={setFilter} setSelectedPair={setSelectedPair}/>}
      {tab==="learning" && <LearningBrain rows={learningRows} recent={d.setupLearning?.recent||[]}/>}
      {tab==="whatif" && <WhatIf rows={whatIfRows}/>}
      {tab==="closed" && <ClosedTrades trades={closed}/>}
      {tab==="analytics" && <Analytics scalp={scalp} strategy={strategy} allClosed={allClosed} learningRows={learningRows}/>}
      {tab==="system" && <SystemStatus d={d}/>}
    </main>

    {modal && <ExpandedTradesModal trades={openTrades} onClose={()=>setModal(false)} sellTrade={(id)=>action(`/api/trades/${id}/panic-sell`,"Sell this trade now?")}/>}
    {selectedPair && <PairPanel pair={selectedPair} learningRows={learningRows} onClose={()=>setSelectedPair(null)}/>}
  </div>
}

function Sidebar({tab,setTab,running,paused}){
  const items=[
    ["dashboard",Activity,"Dashboard"],
    ["live",Zap,"Live Trades"],
    ["scanner",Radar,"Market Scanner"],
    ["learning",Brain,"Learning Brain"],
    ["whatif",Layers,"WhatIf Intelligence"],
    ["closed",History,"Closed Trades"],
    ["analytics",Gauge,"Analytics"],
    ["system",Settings,"System"]
  ];
  return <aside className="sidebar">
    <div className="brand"><div className="brandMark">AQ</div><div><b>ApexQuant</b><span>Command Centre</span></div></div>
    <nav>{items.map(([id,Icon,label])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><Icon size={18}/>{label}</button>)}</nav>
    <div className="sideStatus">
      <div className={running&&!paused?"pulse green":"pulse amber"}></div>
      <b>{running&&!paused?"RUNNING":"PAUSED"}</b>
      <small>Paper trading command mode</small>
    </div>
  </aside>
}

function TopBar({d,error,busy,onStart,onPause,onSellAll}){
  return <div className="topbar">
    <div className="searchBox"><Search size={18}/><input placeholder="Search pairs, trades, setups, learning..." /></div>
    <div className="topActions">
      <span className={`badge ${d.market?.feedStatus==="connected"?"green":"bad"}`}>{error || d.market?.feedStatus}</span>
      <span className="badge">V{d.version}</span>
      <span className="badge">{d.market?.messageCount||0} msgs</span>
      <button onClick={onStart} disabled={busy}><Play size={15}/>Start</button>
      <button onClick={onPause} disabled={busy}><Pause size={15}/>Pause</button>
      <button className="danger" onClick={onSellAll} disabled={busy}><ShieldAlert size={15}/>Sell All</button>
    </div>
  </div>
}

function Dashboard({d,scalp,strategy,totalPnl,progress,openTrades,closed,equity,stats,learningRows,whatIfRows,setTab,setModal,sellTrade}){
  const potPie=[
    {name:"Strategy",value:Math.abs(num(strategy.dailyPnlGbp))||1},
    {name:"Scalp",value:Math.abs(num(scalp.dailyPnlGbp))||1}
  ];

  return <section className="grid">
    <Kpi title="Strategy P&L" value={money(strategy.dailyPnlGbp)} tone={cls(strategy.dailyPnlGbp)} sub={`${strategy.openTrades?.length||0} open / ${strategy.closedTrades?.length||0} closed`}/>
    <Kpi title="Scalp P&L" value={money(scalp.dailyPnlGbp)} tone={cls(scalp.dailyPnlGbp)} sub={`${scalp.openTrades?.length||0} open / ${scalp.closedTrades?.length||0} closed`}/>
    <Kpi title="Total Today" value={money(totalPnl)} tone={cls(totalPnl)} sub={`Target ${money(200)}`}/>
    <Kpi title="Open Trades" value={openTrades.length} tone="cyan" sub="Live positions"/>
    <Kpi title="Win Rate" value={`${stats.winRate}%`} tone="blue" sub={`${stats.wins} wins / ${stats.losses} losses`}/>
    <Kpi title="Profit Factor" value={stats.profitFactor} tone="cyan" sub={`Avg win ${money(stats.avgWin)}`}/>

    <Card wide title="Live Trading Cockpit">
      <div className="cockpit">
        <div>
          <h2>What the bot is doing now</h2>
          <p>{openTrades.length ? `Managing ${openTrades.length} open positions and reviewing ${d.reviewedPairs?.length||0} pair setups.` : `Scanning ${d.reviewedPairs?.length||0} pair setups for next entry.`}</p>
          <Pipeline reviewed={d.reviewedPairs||[]} openTrades={openTrades}/>
        </div>
        <div className="aiFeed">
          {arr(d.brain).slice(0,8).map((b,i)=><div key={i} className="feedItem"><span></span><b>{safe(b.type)}</b><p>{safe(b.message)}</p></div>)}
        </div>
      </div>
    </Card>

    <Card title="Daily Target Progress">
      <Radial value={progress} label={`${Math.round(progress)}%`}/>
    </Card>

    <Card wide title="Equity Curve">
      <ResponsiveContainer height={300}><AreaChart data={equity}><defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#29dfff" stopOpacity={0.75}/><stop offset="95%" stopColor="#29dfff" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#17314b"/><XAxis dataKey="name" hide/><YAxis stroke="#6ea9c9"/><Tooltip/><Area type="monotone" dataKey="pnl" stroke="#29dfff" fill="url(#eq)" strokeWidth={3}/></AreaChart></ResponsiveContainer>
    </Card>

    <Card title="P&L By Pot">
      <ResponsiveContainer height={260}><PieChart><Pie data={potPie} innerRadius={60} outerRadius={95} dataKey="value"><Cell fill="#29dfff"/><Cell fill="#27ff9d"/></Pie><Tooltip/></PieChart></ResponsiveContainer>
    </Card>

    <Card wide title="Open Trades">
      <div className="sectionHead"><button onClick={()=>setModal(true)}>Expand Live Trades</button></div>
      <div className="tradeGrid">{openTrades.slice(0,4).map(t=><OpenTradeCard key={t.id} t={t} sellTrade={sellTrade}/>)}</div>
    </Card>

    <Card title="Market Environment"><MarketEnvironment env={d.environment}/></Card>

    <Card title="Learning Snapshot"><LearningMini rows={learningRows}/></Card>
    <Card title="WhatIf Snapshot"><WhatIfMini rows={whatIfRows}/></Card>
  </section>
}

function Kpi({title,value,sub,tone}){return <div className={`kpi ${tone}`}><span>{title}</span><b>{value}</b><small>{sub}</small><div className="kpiGlow"></div></div>}
function Card({title,children,wide}){return <div className={`card ${wide?"wide":""}`}><h3>{title}</h3>{children}</div>}

function Pipeline({reviewed,openTrades}){
  const ready=reviewed.filter(r=>r.canBuy).length;
  const high=reviewed.filter(r=>num(r.confidence)>=80).length;
  const blocked=reviewed.filter(r=>!r.canBuy).length;
  const stages=[["Scanning",reviewed.length],["Interested",high],["Ready",ready],["Open",openTrades.length],["Blocked",blocked]];
  return <div className="pipeline">{stages.map(([s,c])=><div key={s}><b>{c}</b><span>{s}</span></div>)}</div>
}

function OpenTradeCard({t,sellTrade}){
  const pnl=num(t.pnl?.netGbp);
  const target=Math.max(1,Math.abs(num(t.targetNetGbp)||10));
  const progress=Math.max(0,Math.min(100,(pnl/target)*100));
  return <div className={`tradeCard ${cls(pnl)}`}>
    <div className="tradeTop"><div><b>{t.symbol}</b><span>{t.pot}</span></div><em className={t.side==="LONG"?"long":"short"}>{t.side}</em></div>
    <div className={`tradePnl ${cls(pnl)}`}>{money(pnl)}</div>
    <div className="riskbar"><i style={{width:`${progress}%`}}></i></div>
    <div className="tradeStats"><span>Entry <b>{safe(t.entryPrice)}</b></span><span>Now <b>{safe(t.currentPrice)}</b></span><span>Conf <b>{safe(t.confidence)}%</b></span></div>
    <p><b>Thinking:</b> {safe(t.botThinking,"Collecting live reasoning...")}</p>
    <p><b>Exit:</b> Target {money(t.targetNetGbp)} / Stop {money(t.stopLossNetGbp)} / Trail {safe(t.trailingStopPrice)}</p>
    <button className="danger full" onClick={()=>sellTrade(t.id)}>SELL NOW</button>
  </div>
}

function LiveTrades({openTrades,setModal,sellTrade,sellAll}){return <section><div className="pageHead"><h1>Live Trades</h1><div><button onClick={()=>setModal(true)}>Expand</button><button className="danger" onClick={sellAll}>Sell All</button></div></div><div className="tradeGrid bigCards">{openTrades.map(t=><OpenTradeCard key={t.id} t={t} sellTrade={sellTrade}/>)}</div></section>}

function MarketScanner({reviewed,filter,setFilter,setSelectedPair}){
  const filtered=reviewed.filter(r=>{
    if(filter==="ALL")return true;
    if(filter==="STRATEGY")return r.pot==="strategy";
    if(filter==="SCALP")return r.pot==="scalp";
    if(filter==="LONG")return r.signal==="LONG";
    if(filter==="SHORT")return r.signal==="SHORT";
    if(filter==="CANBUY")return r.canBuy;
    if(filter==="BLOCKED")return !r.canBuy;
    if(filter==="HIGH")return num(r.confidence)>=80;
    return true;
  });
  return <section><h1>Market Scanner</h1><div className="filters">{["ALL","STRATEGY","SCALP","LONG","SHORT","CANBUY","BLOCKED","HIGH"].map(f=><button className={filter===f?"active":""} onClick={()=>setFilter(f)} key={f}>{f}</button>)}</div><div className="radarGrid">{filtered.sort((a,b)=>num(b.confidence)-num(a.confidence)).map(r=><div className="radarTile" onClick={()=>setSelectedPair(r)} key={`${r.pot}-${r.symbol}`}><b>{r.symbol}</b><span>{r.pot}</span><em className={r.signal==="LONG"?"long":r.signal==="SHORT"?"short":""}>{r.signal}</em><div className="conf"><i style={{width:`${num(r.confidence)}%`}}></i></div><small>{num(r.confidence)}% · {money(r.expectedNetGbp)}</small><p>{safe(r.whyNotBuying,"Ready")}</p></div>)}</div></section>
}

function LearningBrain({rows,recent}){
  const sorted=[...rows].sort((a,b)=>num(b.totalPnlGbp)-num(a.totalPnlGbp));
  return <section className="grid"><Card wide title="Best Setups"><SetupTable rows={sorted.slice(0,20)}/></Card><Card wide title="Worst Setups"><SetupTable rows={[...rows].sort((a,b)=>num(a.totalPnlGbp)-num(b.totalPnlGbp)).slice(0,20)}/></Card><Card wide title="Recent Learning Events"><table><tbody>{recent.slice(0,30).map((r,i)=><tr key={i}><td>{safe(r.time)}</td><td>{r.symbol}</td><td>{r.setupType}</td><td className={cls(r.pnlGbp)}>{money(r.pnlGbp)}</td><td>{r.exitReason}</td><td><Advice v={r.adviceAfterTrade}/></td></tr>)}</tbody></table></Card></section>
}

function SetupTable({rows}){return <table><thead><tr><th>Pair</th><th>Pot</th><th>Side</th><th>Setup</th><th>Trades</th><th>Win %</th><th>P&L</th><th>Advice</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.symbol}</td><td>{r.pot}</td><td>{r.side}</td><td>{r.setupType}</td><td>{r.trades}</td><td>{r.winRatePercent}%</td><td className={cls(r.totalPnlGbp)}>{money(r.totalPnlGbp)}</td><td><Advice v={r.advice}/></td></tr>)}</tbody></table>}
function Advice({v}){return <span className={`advice ${String(v||"LEARNING").toLowerCase()}`}>{safe(v,"LEARNING")}</span>}

function WhatIf({rows}){
  const data=rows.slice(0,20).map((w,i)=>({name:w.symbol||i,actual:num(w.actualNetPnlGbp),optimal:num(w.optimalNetPnlGbp),diff:num(w.optimalDifferenceGbp)}));
  return <section className="grid"><Card wide title="Actual vs Optimal"><ResponsiveContainer height={320}><BarChart data={data}><CartesianGrid stroke="#17314b"/><XAxis dataKey="name" stroke="#7fb9d9"/><YAxis stroke="#7fb9d9"/><Tooltip/><Bar dataKey="actual" fill="#29dfff"/><Bar dataKey="optimal" fill="#27ff9d"/></BarChart></ResponsiveContainer></Card><Card title="Exit Quality">{rows.length?<Radial value={Math.round(rows.filter(w=>num(w.optimalDifferenceGbp)<=0).length/rows.length*100)} label="Optimal %"/>:<p>Collecting WhatIf data...</p>}</Card><Card wide title="AI Replay Cards"><div className="whatGrid">{rows.slice(0,12).map((w,i)=><div className={`whatCard ${num(w.optimalDifferenceGbp)>25?"bad":num(w.optimalDifferenceGbp)>10?"warn":"good"}`} key={i}><b>{w.symbol} {w.side}</b><span>{w.pot}</span><h2>{money(w.actualNetPnlGbp)} → {money(w.optimalNetPnlGbp)}</h2><p>Difference: {money(w.optimalDifferenceGbp)}</p><p>{safe(w.lesson,"No lesson yet")}</p><div className="timeline"><i>Actual</i><i>+5m</i><i>+10m</i><i>+20m</i></div></div>)}</div></Card></section>
}

function ClosedTrades({trades}){return <section><h1>Closed Trades</h1><table><thead><tr><th>Exit</th><th>Pot</th><th>Pair</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Reason</th></tr></thead><tbody>{trades.map((t,i)=><tr key={i}><td>{safe(t.exitTime)}</td><td>{t.pot}</td><td>{t.symbol}</td><td>{t.side}</td><td>{safe(t.entryPrice)}</td><td>{safe(t.exitPrice)}</td><td className={cls(t.pnl?.netGbp)}>{money(t.pnl?.netGbp)}</td><td>{safe(t.reasonExit)}</td></tr>)}</tbody></table></section>}

function Analytics({scalp,strategy,allClosed,learningRows}){
  const pairMap={}; allClosed.forEach(t=>{pairMap[t.symbol]=(pairMap[t.symbol]||0)+num(t.pnl?.netGbp)});
  const pairs=Object.entries(pairMap).map(([symbol,pnl])=>({symbol,pnl})).sort((a,b)=>b.pnl-a.pnl);
  return <section className="grid"><Card wide title="Pair Performance"><ResponsiveContainer height={350}><BarChart data={pairs.slice(0,15)}><CartesianGrid stroke="#17314b"/><XAxis dataKey="symbol" stroke="#7fb9d9"/><YAxis stroke="#7fb9d9"/><Tooltip/><Bar dataKey="pnl" fill="#29dfff"/></BarChart></ResponsiveContainer></Card><Card title="Scalp Summary"><Summary pot={scalp}/></Card><Card title="Strategy Summary"><Summary pot={strategy}/></Card><Card wide title="Setup Performance"><SetupTable rows={learningRows}/></Card></section>
}
function Summary({pot}){const st=performanceStats(pot.closedTrades||[]);return <div className="summary"><p>Trades: {st.trades}</p><p>Win rate: {st.winRate}%</p><p>Total: {money(st.total)}</p><p>Avg win: {money(st.avgWin)}</p><p>Avg loss: {money(st.avgLoss)}</p></div>}

function MarketEnvironment({env={}}){return <div className="envPanel"><Env label="Fear & Greed" value={env.fearGreed?.value} text={env.fearGreed?.label}/><Env label="BTC Regime" value={60} text={env.btcRegime}/><Env label="BTC Momentum" value={50} text={env.btcMomentum}/><Env label="ETH Momentum" value={50} text={env.ethMomentum}/><Env label="Macro Risk" value={70} text={env.macroRisk}/><small>Updated: {safe(env.updatedAt,"collecting data")}</small></div>}
function Env({label,value,text}){return <div className="env"><div><b>{label}</b><span>{safe(text,"Collecting")}</span></div><div className="meter"><i style={{width:`${num(value)}%`}}></i></div></div>}

function LearningMini({rows}){return <div>{rows.slice(0,6).map((r,i)=><div className="miniRow" key={i}><b>{r.symbol}</b><span>{r.setupType}</span><em className={cls(r.totalPnlGbp)}>{money(r.totalPnlGbp)}</em></div>)}</div>}
function WhatIfMini({rows}){return <div>{rows.slice(0,6).map((r,i)=><div className="miniRow" key={i}><b>{r.symbol}</b><span>{r.optimalLabel}</span><em className={cls(r.optimalDifferenceGbp)}>{money(r.optimalDifferenceGbp)}</em></div>)}</div>}

function Radial({value,label}){return <ResponsiveContainer height={220}><RadialBarChart innerRadius="70%" outerRadius="100%" data={[{name:"v",value}]} startAngle={90} endAngle={-270}><RadialBar dataKey="value" fill="#29dfff"/><text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#eaf8ff" fontSize="28" fontWeight="900">{label}</text></RadialBarChart></ResponsiveContainer>}

function ExpandedTradesModal({trades,onClose,sellTrade}){return <div className="modal"><div className="modalBox"><div className="modalHead"><h1>Expanded Live Trades</h1><button onClick={onClose}><X/>Close</button></div><div className="tradeGrid bigCards">{trades.map(t=><OpenTradeCard key={t.id} t={t} sellTrade={sellTrade}/>)}</div></div></div>}
function PairPanel({pair,learningRows,onClose}){const mem=learningRows.filter(r=>r.symbol===pair.symbol);return <div className="modal"><div className="modalBox"><div className="modalHead"><h1>{pair.symbol} Intelligence</h1><button onClick={onClose}><X/>Close</button></div><div className="grid"><Card title="Current Review"><pre>{JSON.stringify(pair,null,2)}</pre></Card><Card wide title="Learning Memory"><SetupTable rows={mem}/></Card></div></div></div>}

function SystemStatus({d}){return <section><h1>System Status</h1><pre>{JSON.stringify({version:d.version,engine:d.engine,market:d.market,environment:d.environment},null,2)}</pre></section>}

function performanceStats(trades=[]){
  const wins=trades.filter(t=>num(t.pnl?.netGbp)>0),losses=trades.filter(t=>num(t.pnl?.netGbp)<=0);
  const winP=wins.reduce((s,t)=>s+num(t.pnl?.netGbp),0), lossP=Math.abs(losses.reduce((s,t)=>s+num(t.pnl?.netGbp),0));
  return {trades:trades.length,wins:wins.length,losses:losses.length,total:winP-lossP,winRate:Math.round(wins.length/Math.max(1,trades.length)*100),avgWin:winP/Math.max(1,wins.length),avgLoss:-(lossP/Math.max(1,losses.length)),profitFactor:(winP/Math.max(1,lossP)).toFixed(2)};
}

createRoot(document.getElementById("root")).render(<App/>);
