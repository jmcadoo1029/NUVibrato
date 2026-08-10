import { useState, useMemo, useEffect, useRef } from "react";

// ── Pricing constants ─────────────────────────────────────────────────────────
const NOISE_BASE_30={"<=140dB":3950,"145dB":4500,"150dB":5250,"155dB":5950,"160dB":7450,"165dB":8500,"170dB":12500};
const NOISE_BASE_60={"<=140dB":4925,"145dB":5750,"150dB":6875,"155dB":7925,"160dB":9175,"165dB":10750,"170dB":15750};

// Noise duration-based pricing
// ≤30 min → BASE_30, ≤60 min → BASE_60
// >1 hr: hours 2-20 = $500/hr; once total > 20 hrs, ALL overage = $375/hr
// Every 40 hrs resets with a new base
function noiseTestingPrice(durVal, durUnit, level, compCost){
  const base30 = NOISE_BASE_30[level]||0;
  const base60 = NOISE_BASE_60[level]||0;
  const compUp = (compCost||0)*1.25;
  const raw = parseFloat(durVal)||0;
  if(raw<=0) return Math.round(base30 + compUp);
  const totalHrs = durUnit==="hours"
    ? Math.ceil(raw)
    : raw<=30 ? null : Math.ceil(raw/60);
  if(totalHrs===null) return Math.round(base30 + compUp);
  if(totalHrs<=1)     return Math.round(base60 + compUp);
  // Multi-hour: every 40 hrs resets to a new base
  const BLOCK=40;
  const fullBlocks=Math.floor((totalHrs-1)/BLOCK);
  const remaining=totalHrs-(fullBlocks*BLOCK); // hours in current block (1..40)
  const blockAdder=(h)=>{
    if(h<=1)return 0;
    const extra=h-1; // hours beyond base hour
    if(h>20) return extra*375; // once block exceeds 20h, ALL extra hours at $375
    return extra*500; // hours 2-20 → $500/hr
  };
  return Math.round((base60*(fullBlocks+1))+blockAdder(remaining)+compUp);
}
const NOISE_FAC={"Speakerbox":1000,"64 Reverb Chamber":1500,"300 Reverb Chamber":2000,"Prog Wave Tube":2750};
// HFV testing price: $1225 flat ≤1hr, +$750/hr for hrs 1-3, +$525/hr for hrs 3+
function hfvTestingPrice(durMin){
  const m=parseFloat(durMin)||30;
  const hrs=m/60;
  if(hrs<=1) return 1225;
  if(hrs<=3) return Math.round((1225+750*(hrs-1))/25)*25;
  return Math.round((1225+750*2+525*(hrs-3))/25)*25;
}
const ENV_TH_PRICES={"0 to 1 Day":1000,"3 Days":1350,"5 Days":1875,"7 Days":2275,"10 Days":2950};
const PROC_BASE=1600, REPORT_BASE=950;
const EMI_SR=1600, PQ_SR=1450, DCM_SR=1600;
const PQ_ROWS=[
  {key:"5.3.1",label:"Voltage Variation",sh:1},
  {key:"5.3.2",label:"Voltage Modulation",sh:1},
  {key:"5.3.3",label:"Voltage Spike (300B)",sh:2},
  {key:"5.3.4",label:"Voltage Dropout",sh:1},
  {key:"5.3.5",label:"Voltage Spike (P1)",sh:2},
  {key:"5.3.6",label:"Frequency Variation",sh:1},
  {key:"5.3.7",label:"Current Waveform",sh:1},
  {key:"5.3.8",label:"DC Offset",sh:1},
  {key:"5.3.9",label:"Fault Clearing",sh:1},
];

const money = n => "$"+Math.round(n).toLocaleString();

// Turn an email address into a friendlier display string for notifications.
// "jordanmcadoo@nulabs.com" -> "Jordan Mcadoo" (best-effort, not perfect).
// Splits on common separators in the local part: dot, underscore, hyphen.
// For all-lowercase no-separator locals like "jordanmcadoo" the result is
// just title-cased ("Jordanmcadoo"). Acceptable for now — the alternative
// is wiring a full employees-table name lookup, deferred until needed.
const prettifyEmail = (email) => {
  if (!email || typeof email !== "string") return "";
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
};
const r25 = n => Math.round(n/25)*25;
const sf = (v,d=0) => { const n=parseFloat(v); return isNaN(n)?d:n; };
// Workspace clients page — opened in a new tab (with the typed name) to create a
// client when none exists in NUForce. NUForce stays read-only on clients.
const WORKSPACE_CLIENTS_URL = "https://workspace.nulabs.com/#clients";
const mwDisc=vs=>{if(vs<=4000)return 1000;if(vs<=5000)return 1250;if(vs<=7000)return 1500;if(vs<=9000)return 1750;return 2000;};
const lwDisc=vs=>{if(vs<=2000)return 500;if(vs<=3000)return 750;return 1000;};
// MW testing price based on unit weight (lbs)
const mwTesting=wt=>{if(!wt||wt<=0)return 4575;if(wt<=2500)return 4575;if(wt<=3500)return 5575;return 6250;};

// ── Workspace project creation helpers ───────────────────────────────────────

// Build the labeled-list test article description from the ti state object.
// Russ stores this as a single text field in project_info.test_article_description.
// Only includes lines where NUForce has a value — empty fields are omitted.
// Formatting follows the same conventions used in the quote PDF generators
// (e.g. "440 V AC, 3 Ph, 60 Hz" combined on one line). Produces a labeled,
// human-readable block for the workspace project's description text area.
const buildTestArticleDescription = (ti) => {
  if (!ti) return "";
  const lines = [];
  const push = (label, value) => {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (s === "" || s === "0") return;
    lines.push(`${label}: ${s}`);
  };
  // Labeled fields, in display order
  push("Test Item", ti.item);
  push("Model No", ti.model);
  push("Drawing No", ti.drawing);
  const sizeStr = [ti.dimL && ti.dimL + '"', ti.dimW && ti.dimW + '"', ti.dimH && ti.dimH + '"']
    .filter(Boolean).join(' x ');
  if (sizeStr) lines.push(`Size: ${sizeStr}`);
  if (ti.wt) lines.push(`Weight: ${ti.wt} lbs`);
  const pwrParts = [
    ti.volt && ti.volt + ' V ' + (ti.pwrType || 'AC'),
    ti.phase && ti.phase + ' Ph',
    ti.hz && ti.hz + ' Hz',
    ti.amps && ti.amps + ' A',
  ].filter(Boolean);
  if (pwrParts.length) lines.push(`Power: ${pwrParts.join(', ')}`);
  // Loads and Mounting render as their own unlabeled sentences (they are
  // typically full prose descriptions, not short values).
  if (ti.loads && String(ti.loads).trim()) lines.push(String(ti.loads).trim());
  if (ti.mounting && String(ti.mounting).trim()) lines.push(String(ti.mounting).trim());
  if (ti.pressureFlow && String(ti.pressureFlow).trim()) lines.push(String(ti.pressureFlow).trim());
  return lines.join("\n");
};

// Collect all quote line items from the three possible sources
// (pickerLines is current, summary.lines is legacy, custom.rows is edge case),
// normalize them into a single shape for the RPC payload.
// task_num is NOT included — workspace owns numbering per Russ's contract.
const collectQuoteLineItems = ({ pickerLines, summary, custom, lineOverrides, quoteNumber, poNumber }) => {
  const items = [];
  // Fold any line-item description into the task name, comma-separated, so it reads
  // as a single line in Workspace (e.g. "Tear Down" + "Unit 1" → "Tear Down, Unit 1")
  // regardless of how Workspace renders a separate description field. description is
  // left null so the text can't show twice if Workspace also surfaces that field.
  const combineName = (label, desc) => {
    const l = (label || "").trim();
    const d = (desc && String(desc).trim()) ? String(desc).trim() : "";
    return d ? (l ? l + ", " + d : d) : l;
  };
  (pickerLines || []).forEach(l => {
    if (!l.label && !l.price) return;
    items.push({
      name: combineName(l.label, l.desc) || "Line Item",
      description: null,
      sales_category: l.code || null,
      fixed_price: parseFloat(l.price) || 0,
      quote_number: quoteNumber,
      po_number: poNumber,
    });
  });
  // Auto-calc (summary) lines carry their per-line description, price edit, and
  // delete flag in lineOverrides (keyed by index) — the same treatment used for
  // the quote PDF and the saved line_items. Honor all three so the Workspace
  // tasks match what's actually on the quote (previously the description was
  // dropped, and deleted/re-priced lines were ignored here).
  (summary?.lines || []).forEach((l, i) => {
    const ov = (lineOverrides || {})[i] || {};
    if (ov.deleted) return;
    if (!l.label && !l.val) return;
    items.push({
      name: combineName(l.label, ov.desc) || "Line Item",
      description: null,
      sales_category: l.code || null,
      fixed_price: ov.price !== undefined ? (parseFloat(ov.price) || 0) : (parseFloat(l.val) || 0),
      quote_number: quoteNumber,
      po_number: poNumber,
    });
  });
  if (custom?.on) {
    (custom?.rows || []).forEach(r => {
      if (!r.label && !r.price) return;
      items.push({
        name: combineName(r.label, r.desc) || "Custom Item",
        description: null,
        sales_category: r.pcode || "94",
        fixed_price: parseFloat(r.price) || 0,
        quote_number: quoteNumber,
        po_number: poNumber,
      });
    });
  }
  return items;
};

// Collect budget materials rows into the expenses payload shape.
// Budget rows: { desc, qty, unitCost } — desc is the field name (not "description").
const collectBudgetExpenses = (budget) => {
  const expenses = [];
  (budget?.rows || []).forEach(r => {
    const qty = parseFloat(r.qty) || 1;
    const unitCost = parseFloat(r.unitCost) || 0;
    const planned = qty * unitCost;
    if (!r.desc && planned === 0) return;
    expenses.push({
      name: r.desc || "Budget Material",
      planned_amount: planned,
    });
  });
  return expenses;
};

// Map NUForce's related contacts list into the workspace payload shape.
// NUForce stores: qi.relatedContacts = [{ name, email, contactId? }]
// Workspace wants:                     [{ full_name, email }]
const collectRelatedContacts = (qi) => {
  return (qi?.relatedContacts || [])
    .filter(rc => rc && (rc.name || rc.email))
    .map(rc => ({
      full_name: rc.name || "",
      email: rc.email || "",
    }));
};

// ── Theme ─────────────────────────────────────────────────────────────────────
const C={
  bg:"#f0f2f5",panel:"#e8ecf0",card:"#ffffff",border:"#d0d7de",
  red:"#c0392b",redDim:"#e74c3c",muted:"#6b7a8d",dim:"#9aa5b1",
  text:"#1a2332",accent:"#1a5276",green:"#1e8449",warn:"#b7791f",
};
const inp={background:"#f8f9fa",border:"1px solid "+C.border,borderRadius:6,padding:"5px 8px",
  color:C.text,fontSize:12,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
const sel={...inp,cursor:"pointer"};
const card={background:C.card,border:"1px solid "+C.border,borderRadius:10,
  padding:12,marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.07)"};

// ── Base components ───────────────────────────────────────────────────────────
function Toggle({checked,onChange,label,small}){
  return(
    <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",userSelect:"none"}}>
      <div onClick={()=>onChange(!checked)} style={{width:small?30:34,height:small?17:19,borderRadius:10,
        background:checked?C.red:C.dim,position:"relative",transition:"background .15s",flexShrink:0}}>
        <div style={{position:"absolute",top:2,left:checked?(small?15:17):2,
          width:small?13:15,height:small?13:15,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
      </div>
      {label&&<span style={{fontSize:small?11:12,color:C.muted}}>{label}</span>}
    </label>
  );
}

function Inp({value,onChange,width=90,right,placeholder}){
  return <input value={value} onChange={e=>onChange(e.target.value)}
    placeholder={placeholder||""}
    style={{...inp,width,textAlign:right?"right":"left"}}/>;
}
function Sel({value,onChange,options,width=160}){
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{...sel,width}}>
    {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
  </select>;
}
function Row({label,children,mb=8}){
  return <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:mb}}>
    <span style={{fontSize:11,color:C.muted,minWidth:120}}>{label}</span>{children}
  </div>;
}
function PRow({label,val,onChange}){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
      <span style={{fontSize:11,color:C.muted,flex:1}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:3}}>
        <span style={{fontSize:11,color:C.muted}}>$</span>
        <Inp value={val} onChange={onChange} width={80} right/>
      </div>
    </div>
  );
}
const HR=()=><div style={{height:1,background:C.border,margin:"10px 0"}}/>;

function Pia({s,set}){
  const levels=[{p:"PIA 1",m:1.10},{p:"PIA 2",m:1.15},{p:"PIA 3",m:1.20}];
  const cur=s.pia||0;
  return(
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
      <span style={{fontSize:11,color:C.muted,minWidth:30}}>PIA:</span>
      {levels.map((l,i)=>(
        <label key={i} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer"}}>
          <input type="checkbox" checked={cur===l.m}
            onChange={()=>set(prev=>({...prev,pia:prev.pia===l.m?0:l.m}))}
            style={{accentColor:C.red,width:13,height:13}}/>
          <span style={{fontSize:11,color:cur===l.m?C.redDim:C.muted}}>{l.p}</span>
        </label>
      ))}
      {cur>0&&<span style={{fontSize:10,color:C.redDim,marginLeft:4}}>
        +{Math.round((cur-1)*100)}%
      </span>}
    </div>
  );
}

function ProcReport({s,set,procPrice,reportPrice,sectionCode}){
  const pp=procPrice||PROC_BASE;
  const rp=reportPrice||REPORT_BASE;
  return(
    <div style={{marginTop:8}}>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
        <Toggle small checked={s.proc||false} onChange={v=>set({...s,proc:v})}
          label={"Procedure $"+pp.toLocaleString()}/>
        <Toggle small checked={s.report||false} onChange={v=>set({...s,report:v})}
          label={"Report $"+rp.toLocaleString()}/>
      </div>
      <SectionCustom s={s} set={set} sectionCode={sectionCode}/>
    </div>
  );
}

function SectionCustom({s,set,sectionCode}){
  const rows=s.customRows||[];
  const add=()=>set({...s,customRows:[...rows,{label:"",price:"0",code:sectionCode||""}]});
  const rem=i=>set({...s,customRows:rows.filter((_,j)=>j!==i)});
  const upd=(i,k,v)=>set({...s,customRows:rows.map((r,j)=>j===i?{...r,[k]:v}:r)});
  return(
    <div>
      {rows.map((r,i)=>(
        <div key={i} style={{display:"flex",gap:5,alignItems:"center",marginBottom:4}}>
          <Inp value={r.label} onChange={v=>upd(i,"label",v)} width={160} placeholder="Custom line item"/>
          <span style={{fontSize:11,color:C.muted}}>$</span>
          <Inp value={r.price} onChange={v=>upd(i,"price",v)} width={70} right/>
          <button onClick={()=>rem(i)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:13}}>✕</button>
        </div>
      ))}
      <button onClick={add} style={{background:"none",border:"none",color:C.accent,cursor:"pointer",fontSize:11,padding:0,marginTop:2}}>
        + Add custom line
      </button>
    </div>
  );
}

// ── Section wrapper with expand-on-enable ─────────────────────────────────────
function Section({title,enabled,onToggle,tag,children}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(enabled)setOpen(true);},[enabled]);
  const handleToggle=v=>{onToggle(v);if(v)setOpen(true);};
  return(
    <div style={{...card,padding:0,overflow:"hidden",
      border:"1px solid "+(enabled?C.red+"66":C.border),
      boxShadow:enabled?"0 1px 4px rgba(192,57,43,0.12)":"0 1px 3px rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 14px",
        background:enabled?"#fdf3f2":C.card,cursor:"pointer",
        borderBottom:enabled&&open?"1px solid "+C.border:"none"}}
        onClick={()=>{if(enabled)setOpen(o=>!o);}}>
        <div onClick={e=>{e.stopPropagation();handleToggle(!enabled);}}>
          <Toggle checked={enabled} onChange={handleToggle}/>
        </div>
        <span style={{fontWeight:600,fontSize:12,color:enabled?C.red:C.muted,flex:1,letterSpacing:.3}}>{title}</span>
        {tag&&<span style={{fontSize:10,background:C.red+"18",color:C.red,borderRadius:4,padding:"2px 6px",fontWeight:600}}>{tag}</span>}
        {enabled&&<span style={{color:C.dim,fontSize:11}}>{open?"▲":"▼"}</span>}
      </div>
      {enabled&&open&&<div style={{padding:"12px 14px 14px",background:"#fff"}}>{children}</div>}
      {enabled&&!open&&(
        <div style={{padding:"3px 14px 7px",cursor:"pointer",background:"#fdf3f2"}}
          onClick={()=>setOpen(true)}>
          <span style={{fontSize:10,color:C.redDim}}>click to expand ▼</span>
        </div>
      )}
    </div>
  );
}

// Identifier input that buffers locally — avoids losing focus on parent re-render
function IdentifierInput({value,onCommit,style}){
  const [local,setLocal]=React.useState(value||"");
  const lastCommit=React.useRef(value||"");
  React.useEffect(()=>{
    if(value!==lastCommit.current){
      lastCommit.current=value||"";
      setLocal(value||"");
    }
  },[value]);
  return <input value={local}
    onChange={e=>setLocal(e.target.value)}
    onBlur={e=>{lastCommit.current=e.target.value;onCommit(e.target.value);}}
    placeholder="Identifier (e.g. S/N, Unit #)"
    style={style}/>;
}

function TestInstance({inst,idx,total,Form,formProps,onUpdate,onRemove,newInstance}){
  const [localId,setLocalId]=useState(inst.identifier||"");
  useEffect(()=>setLocalId(inst.identifier||""),[inst.id]);
  const commitId=()=>onUpdate(idx,prev=>({...prev,identifier:localId}));
  const handleIdChange=(e)=>{
    setLocalId(e.target.value);
    onUpdate(idx,prev=>({...prev,identifier:e.target.value}));
  };
  return(
    <div data-testinstance={idx} style={{
      border:idx>0?"1px solid "+C.border:"none",
      borderRadius:idx>0?8:0,padding:idx>0?10:0,marginBottom:idx>0?10:0,
      background:idx>0?C.panel:"transparent"}}>
      {idx>0&&(
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <Toggle small checked={inst.on} onChange={v=>{
              if(!v){const fresh=newInstance?newInstance():{};onUpdate(idx,{...fresh,id:inst.id,on:false});}
              else onUpdate(idx,{...inst,on:v});
            }}
            label={"Test #"+(idx+1)}/>
          <input value={localId} onChange={handleIdChange} onBlur={commitId}
            placeholder="Identifier (e.g. S/N, Unit #)"
            style={{...inp,flex:1,fontSize:11}}/>
          <button onClick={()=>onRemove(idx)}
            style={{background:"none",border:"none",color:C.redDim,cursor:"pointer",fontSize:12,padding:"0 6px",fontWeight:600}}>
            Remove
          </button>
        </div>
      )}
      {idx===0&&total>1&&(
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Test #1</span>
          <input value={localId} onChange={handleIdChange} onBlur={commitId}
            placeholder="Identifier (e.g. S/N, Unit #)"
            style={{...inp,flex:1,fontSize:11}}/>
        </div>
      )}
      <Form s={inst} set={s=>onUpdate(idx,s)} {...formProps}/>
    </div>
  );
}

function MultiSection({title,instances,onAdd,onRemove,onUpdate,tag,newInstance,Form,formProps}){
  const anyOn=instances.some(i=>i.on);
  const [open,setOpen]=useState(false);
  // Auto-expand when any instance turns on
  useEffect(()=>{if(anyOn)setOpen(true);},[anyOn]);
  const handleToggle=v=>{
    if(v&&instances.length===0){onAdd();setOpen(true);}
    else if(v){onUpdate(0,{...instances[0],on:true});setOpen(true);}
    else if(!v&&instances.length>0){
      // Unchecking: reset ALL instances to fresh defaults, keep only first one
      const fresh={...newInstance(),id:instances[0].id,on:false};
      onUpdate(0,fresh);
      // Remove any additional instances
      for(let i=instances.length-1;i>0;i--)onRemove(i);
    }
  };
  return(
    <div style={{...card,padding:0,overflow:"hidden",
      border:"1px solid "+(anyOn?C.red+"66":C.border),
      boxShadow:anyOn?"0 1px 4px rgba(192,57,43,0.12)":"0 1px 3px rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",alignItems:"center",gap:9,padding:"10px 14px",
        background:anyOn?"#fdf3f2":C.card,cursor:"pointer",
        borderBottom:anyOn&&open?"1px solid "+C.border:"none"}}
        onClick={()=>{if(anyOn)setOpen(o=>!o);}}>
        <div onClick={e=>{e.stopPropagation();handleToggle(!anyOn);}}>
          <Toggle checked={anyOn} onChange={()=>{}}/>
        </div>
        <span style={{fontWeight:600,fontSize:12,color:anyOn?C.red:C.muted,flex:1,letterSpacing:.3}}>{title}</span>
        {instances.length>1&&<span style={{fontSize:10,background:C.accent+"22",color:C.accent,borderRadius:4,padding:"2px 6px",fontWeight:600}}>{instances.length}x</span>}
        {tag&&<span style={{fontSize:10,background:C.red+"18",color:C.red,borderRadius:4,padding:"2px 6px",fontWeight:600}}>{tag}</span>}
        {anyOn&&<span style={{color:C.dim,fontSize:11}}>{open?"▲":"▼"}</span>}
      </div>
      {anyOn&&open&&(
        <div style={{padding:"12px 14px 14px",background:"#fff"}}>
          {instances.map((inst,idx)=>(
            <TestInstance key={"ti-"+inst.id}
              inst={inst} idx={idx} total={instances.length}
              Form={Form} formProps={formProps}
              onUpdate={onUpdate} onRemove={onRemove} newInstance={newInstance}/>
          ))}
          <button onClick={()=>{onAdd();setTimeout(()=>{
              const els=document.querySelectorAll('[data-testinstance]');
              if(els.length)els[els.length-1].scrollIntoView({behavior:'smooth',block:'center'});
            },100);}}
            style={{width:"100%",marginTop:8,background:"none",border:"1px dashed "+C.border,
              borderRadius:7,color:C.accent,padding:"7px 0",cursor:"pointer",fontSize:11,fontWeight:600}}>
            + Add Additional Test
          </button>
        </div>
      )}
      {anyOn&&!open&&(
        <div style={{padding:"3px 14px 7px",cursor:"pointer",background:"#fdf3f2"}}
          onClick={()=>setOpen(true)}>
          <span style={{fontSize:10,color:C.redDim}}>
            {instances.length>1?instances.length+"x tests — ":""}click to expand ▼
          </span>
        </div>
      )}
    </div>
  );
}

// ── Form components ───────────────────────────────────────────────────────────
function VibForm({s,set,setup}){
  const pm=s.pia||1;
  const std=sf(s.stdSetup||s.setup||900);
  const dr=Math.round(sf(setup.holes)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1));
  const fab=Math.round(sf(setup.fabHours)*sf(setup.techRate,175));
  const addl=sf(s.addlCosts,0);
  const setupTotal=std+dr+fab+addl;
  return <div>
    <div style={{fontSize:10,color:C.muted,marginBottom:6,fontWeight:600}}>MIL-STD-167</div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="Freq Range"><Inp value={s.freqRange||""} onChange={v=>set({...s,freqRange:v})} width={120}/>
      <span style={{fontSize:11,color:C.muted}}>Hz</span>
    </Row>
    <Pia s={s} set={set}/>
    <Toggle small checked={s.circ||false} onChange={v=>set({...s,circ:v})} label="Circulating System (+$2,500)"/>
    <div style={{display:"flex",gap:16,marginTop:6,flexWrap:"wrap"}}>
      <Toggle small checked={s.hydroPre||false} onChange={v=>set({...s,hydroPre:v})} label="Pre-Test Hydrostatic"/>
      <Toggle small checked={s.hydroPost||false} onChange={v=>set({...s,hydroPost:v})} label="Post-Test Hydrostatic"/>
    </div>
    <HR/>
    <PRow label="Std Setup" val={s.stdSetup||s.setup||"900"} onChange={v=>set({...s,stdSetup:v})}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label={"Testing"+(pm>1?" (x"+pm+")":"")} val={s.testing} onChange={v=>set({...s,testing:v})}/>
    {(s.hydroPre||s.hydroPost)&&<PRow label="Hydrostatic" val={s.hydroPrice||"500"} onChange={v=>set({...s,hydroPrice:v})}/>}
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      <span style={{color:C.dim,fontSize:9}}>{" = "}{"$"+sf(s.stdSetup||s.setup||900).toLocaleString()}{dr>0?" + $"+dr.toLocaleString()+" drill":""}{fab>0?" + $"+fab.toLocaleString()+" fab":""}{addl>0?" + $"+addl.toLocaleString()+" addl":""}{pm>1?" x "+pm+" PIA":""}</span>
    </div>
    <div style={{borderTop:"1px solid "+C.border,paddingTop:8,marginTop:6}}>
      <Toggle small checked={(s.fixtureFab||{}).on||false}
        onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{hours:"0",techRate:"175"}),on:v}})}
        label="Fixture Fabrication"/>
      {(s.fixtureFab||{}).on&&(
        <div style={{background:C.panel,borderRadius:6,padding:"8px 10px",marginTop:6}}>
          <div style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:.5,marginBottom:6}}>FIXTURE FAB LABOR</div>
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Hours</div>
              <Inp value={(s.fixtureFab||{}).hours||"0"} onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{}),hours:v}})} width={60} right/>
            </div>
            <div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Tech Rate</div>
              <Inp value={(s.fixtureFab||{}).techRate||"175"} onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{}),techRate:v}})} width={65} right/>
            </div>
            <div style={{fontSize:10,color:C.muted,marginTop:12}}>
              {"= $"+Math.round(sf((s.fixtureFab||{}).hours,0)*sf((s.fixtureFab||{}).techRate,175)).toLocaleString()+" labor"}
            </div>
          </div>
          <div style={{fontSize:9,color:C.dim,marginTop:6}}>Add budget materials and set "Roll Into" to "Fixture Fabrication – Vibration" to include them in this line.</div>
        </div>
      )}
    </div>
    <ProcReport s={s} set={set} sectionCode="94"/>
  </div>;
}

function ShockForm({s,set,vibSetup,setup,ti}){
  const disc=s.cat==="Medium Weight"?mwDisc(vibSetup):lwDisc(vibSetup);
  const pm=s.pia||1;
  const dr=Math.round(sf(setup.holes)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1));
  const fab=Math.round(sf(setup.fabHours)*sf(setup.techRate,175));
  const std=s.fromVib&&vibSetup>0?disc:sf(s.stdSetup||s.setup||1500);
  const addl=sf(s.addlCosts,0);
  const setupTotal=s.fromVib&&vibSetup>0?disc:std+dr+fab+addl;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="Category">
      <Sel value={s.cat} onChange={v=>set({...s,cat:v,testing:v==="Medium Weight"?"4575":"1450",stdSetup:v==="Medium Weight"?"1500":"900"})}
        options={["Medium Weight","Lightweight"]} width={160}/>
    </Row>
    <Row label="Grade"><Inp value={s.grade||""} onChange={v=>set({...s,grade:v})} width={60}/></Row>
    <Row label="Class"><Inp value={s.class_||""} onChange={v=>set({...s,class_:v})} width={60}/></Row>
    <Row label="Type"><Inp value={s.type_||""} onChange={v=>set({...s,type_:v})} width={60}/></Row>
    <Row label="Location">
      <Sel value={s.location||"Hull"} onChange={v=>set({...s,location:v})}
        options={["Hull","Deck","Hull/Deck","Conventional Deck","Mitigated Deck","Isolated Deck","Shell","Wetted-Surface","Frame"]} width={220}/>
    </Row>
    <div style={{marginBottom:8,marginTop:-4}}>
      <Toggle small checked={s.submarine||false} onChange={v=>set({...s,submarine:v})} label="Submarine"/>
    </div>
    <Row label="Orientation">
      <Sel value={s.orientation||"Unrestricted"} onChange={v=>set({...s,orientation:v})}
        options={["Unrestricted","Vertical Axis Specified","Restricted","Custom","Unknown"]} width={180}/>
    </Row>
    <Row label="# Blows">
      <Inp value={s.blows||""} onChange={v=>set({...s,blows:v})} width={60}/>
      <span style={{fontSize:10,color:C.dim,marginLeft:6}}>leave blank if standard</span>
    </Row>
    {s.cat==="Medium Weight"&&(
      <Row label="Unit Weight (lbs)">
        <Inp value={s.weight||(ti?.wt||"")} onChange={v=>set({...s,weight:v,testing:v&&sf(v)>0?String(mwTesting(sf(v))):s.testing})} width={80}/>
        <span style={{fontSize:10,color:C.dim,marginLeft:6}}>{ti?.wt&&!s.weight?"from unit details":"auto-sets testing price"}</span>
      </Row>
    )}
    <Pia s={s} set={set}/>
    <Toggle small checked={s.fromVib||false} onChange={v=>set({...s,fromVib:v})} label="Moving from Vib (discounted setup)"/>
    <Toggle small checked={s.circ||false} onChange={v=>set({...s,circ:v})} label="Circulating System"/>
    <div style={{display:"flex",gap:16,marginTop:6,flexWrap:"wrap"}}>
      <Toggle small checked={s.hydroPre||false} onChange={v=>set({...s,hydroPre:v})} label="Pre-Test Hydrostatic"/>
      <Toggle small checked={s.hydroPost||false} onChange={v=>set({...s,hydroPost:v})} label="Post-Test Hydrostatic"/>
    </div>
    <HR/>
    {!(s.fromVib&&vibSetup>0)&&<PRow label="Std Setup" val={s.stdSetup||s.setup||"1500"} onChange={v=>set({...s,stdSetup:v})}/>}
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    {!(s.fromVib&&vibSetup>0)&&<PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>}
    <PRow label={"Testing"+(pm>1?" (x"+pm+")":"")+(s.cat==="Medium Weight"?" (auto: $"+mwTesting(sf(s.weight||ti?.wt||0)).toLocaleString()+")":"")} val={s.testing} onChange={v=>set({...s,testing:v})}/>
    {s.cat==="Medium Weight"&&<div style={{fontSize:10,color:C.dim,marginBottom:4}}>Weight-based: ≤2,500lb $4,575 · 2,501–3,500lb $5,575 · &gt;3,500lb $6,250<br/>Set weight in Unit Details above to auto-suggest.</div>}
    {(s.hydroPre||s.hydroPost)&&<PRow label="Hydrostatic (each)" val={s.hydroPrice||"500"} onChange={v=>set({...s,hydroPrice:v})}/>}
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      {s.fromVib&&vibSetup>0
        ? <span style={{color:C.dim,fontSize:9}}>{" (discounted from vib setup $"+vibSetup.toLocaleString()+")"}</span>
        : <span style={{color:C.dim,fontSize:9}}>{" = $"+sf(s.stdSetup||s.setup||1500).toLocaleString()+(dr>0?" + $"+dr.toLocaleString()+" drill":"")+(fab>0?" + $"+fab.toLocaleString()+" fab":"")+(addl>0?" + $"+addl.toLocaleString()+" addl":"")+(pm>1?" x "+pm+" PIA":"")}</span>
      }
    </div>
    <div style={{borderTop:"1px solid "+C.border,paddingTop:8,marginTop:6}}>
      <Toggle small checked={(s.fixtureFab||{}).on||false}
        onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{hours:"0",techRate:"175"}),on:v}})}
        label="Fixture Fabrication"/>
      {(s.fixtureFab||{}).on&&(
        <div style={{background:C.panel,borderRadius:6,padding:"8px 10px",marginTop:6}}>
          <div style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:.5,marginBottom:6}}>FIXTURE FAB LABOR</div>
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Hours</div>
              <Inp value={(s.fixtureFab||{}).hours||"0"} onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{}),hours:v}})} width={60} right/>
            </div>
            <div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Tech Rate</div>
              <Inp value={(s.fixtureFab||{}).techRate||"175"} onChange={v=>set({...s,fixtureFab:{...(s.fixtureFab||{}),techRate:v}})} width={65} right/>
            </div>
            <div style={{fontSize:10,color:C.muted,marginTop:12}}>
              {"= $"+Math.round(sf((s.fixtureFab||{}).hours,0)*sf((s.fixtureFab||{}).techRate,175)).toLocaleString()+" labor"}
            </div>
          </div>
          <div style={{fontSize:9,color:C.dim,marginTop:6}}>Add budget materials and set "Roll Into" to "Fixture Fabrication – Shock" to include them in this line.</div>
        </div>
      )}
    </div>
    <ProcReport s={s} set={set} sectionCode={s.cat==="Medium Weight"?"91":"92"}/>
  </div>;
}

function NoiseForm({s,set,setup,ti}){
  const COMP_COST={"<=140dB":0,"145dB":750,"150dB":1500,"155dB":1500,"160dB":1500,"165dB":2000,"170dB":3500};
  const autoComp=COMP_COST[s.level]||0;
  const compNeedsSync=autoComp>0&&(s.compBudget==="0"||s.compBudget===undefined||s.compBudget==="");
  const compCost=compNeedsSync?autoComp:sf(s.compBudget,autoComp);
  // Auto testing price uses duration-based pricing
  const autoTesting=noiseTestingPrice(s.durVal,s.durUnit,s.level,compCost);
  // Setup price = chamber standard setup
  const chamberSetup=NOISE_FAC[s.chamber]||1000;
  const pm=s.pia||1;
  // Chamber recommendation based on unit dims AND dB level
  const L=sf(ti?.dimL,0), W=sf(ti?.dimW,0), H=sf(ti?.dimH,0);
  const cuIn=L*W*H;
  const cuFt=cuIn/1728;
  const dbNum=s.level==="<=140dB"?140:parseInt(s.level)||0;

  // Determine recommended chamber per spec:
  // Speakerbox:        ≤500 in³ AND ≤145 dB
  // 64 Reverb:         ≤6.4 ft³ (no dB cap)
  // 300 Reverb:        ≤30 ft³  AND ≤165 dB
  // Prog Wave Tube:    H≤40" AND W≤40" AND ≤165 dB
  // (>165 dB in any chamber: disclaimer about custom build)
  const fitsSpkr  = cuIn>0 && cuIn<=500  && dbNum<=145;
  const fits64    = cuIn>0 && cuFt<=6.4;
  const fits300   = cuIn>0 && cuFt<=30   && dbNum<=165;
  const fitsPWT   = cuIn>0 && H<=40 && W<=40 && dbNum<=165;
  const over165   = dbNum>165;

  const chamberRec = cuIn>0 ? (
    fitsSpkr  ? "Speakerbox" :
    fits64    ? "64 Reverb Chamber" :
    fits300   ? "300 Reverb Chamber" :
    fitsPWT   ? "Prog Wave Tube" :
    over165   ? "Prog Wave Tube" : // show with disclaimer
    "Prog Wave Tube"
  ) : "";

  // Is the currently selected chamber valid for this unit?
  const chamberOk = !cuIn || (
    s.chamber==="Speakerbox"         ? fitsSpkr  :
    s.chamber==="64 Reverb Chamber"  ? fits64    :
    s.chamber==="300 Reverb Chamber" ? fits300   :
    s.chamber==="Prog Wave Tube"     ? fitsPWT   :
    false
  );

  // Disclaimer for >165dB
  const highDbDisclaimer = over165
    ? "⚠ Levels above 165dB: NU Labs can build a new chamber to accommodate depending on size — contact us to discuss."
    : null;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="OASPL (pricing)">
      <Sel value={s.level} onChange={v=>{const nc=COMP_COST[v]||0;set({...s,level:v,compBudget:String(nc),testing:String(noiseTestingPrice(s.durVal,s.durUnit,v,nc))});}}
        options={["<=140dB","145dB","150dB","155dB","160dB","165dB","170dB"]} width={110}/>
    </Row>
    <Row label="OASPL (spec)"><Inp value={s.oaspl||""} onChange={v=>set({...s,oaspl:v})} width={90}/></Row>
    <Row label="Chamber">
      <Sel value={s.chamber} onChange={v=>set({...s,chamber:v,stdSetup:String(NOISE_FAC[v]||1000)})}
        options={["Speakerbox","64 Reverb Chamber","300 Reverb Chamber","Prog Wave Tube"]} width={200}/>
    </Row>
    {cuIn>0&&(
      <div style={{fontSize:10,borderRadius:5,padding:"4px 8px",marginBottom:6,
        background:chamberOk?"#f0fdf4":"#fdf3f2",color:chamberOk?"#15803d":C.red}}>
        {(()=>{
          // Check dB range for selected chamber
          const dbOk=
            s.chamber==="Speakerbox"?dbNum<=145:
            s.chamber==="64 Reverb Chamber"?true:
            s.chamber==="300 Reverb Chamber"?dbNum<=165:
            s.chamber==="Prog Wave Tube"?dbNum<=165:true;
          // Check size — 10% of chamber volume allowance
          // Chamber volumes: Speakerbox ~500 in³, 64 Reverb ~6.4 ft³=11059 in³, 300 Reverb ~30 ft³=51840 in³, PWT: H≤40" W≤40"
          const chamberVol={"Speakerbox":500,"64 Reverb Chamber":6.4*1728,"300 Reverb Chamber":30*1728,"Prog Wave Tube":null};
          const vol=chamberVol[s.chamber];
          const sizeOk=s.chamber==="Prog Wave Tube"?(H<=40&&W<=40):(vol?cuIn<=vol:true);
          const at10=vol?cuIn>vol*0.9:false; // within 10% of limit
          return(<>
            {!dbOk&&<div style={{color:C.red,fontWeight:600}}>⚠ OASPL is not within standard range of this chamber — check with production.</div>}
            {!sizeOk&&<div style={{color:C.red,fontWeight:600}}>⚠ This unit exceeds the chamber volume allowance — check with production.</div>}
            {sizeOk&&at10&&<div style={{color:C.warn,fontWeight:600}}>⚠ Unit is within 10% of chamber volume limit — check with production.</div>}
            {dbOk&&sizeOk&&!at10&&<div style={{color:"#15803d"}}>✓ {s.chamber} is suitable for this unit ({cuIn.toFixed(0)} in³ / {cuFt.toFixed(2)} ft³)</div>}
            {!chamberOk&&chamberRec&&<button onClick={()=>set({...s,chamber:chamberRec})}
              style={{marginTop:4,fontSize:9,background:"none",border:"1px solid "+C.red,borderRadius:4,
                color:C.red,cursor:"pointer",padding:"1px 5px",display:"block"}}>Switch to recommended: {chamberRec}</button>}
            {highDbDisclaimer&&<div style={{marginTop:4,color:C.warn,fontWeight:600}}>{highDbDisclaimer}</div>}
          </>);
        })()}
      </div>
    )}

    <Row label="Duration">
      <Inp value={s.durVal} onChange={v=>set({...s,durVal:v,testing:String(noiseTestingPrice(v,s.durUnit,s.level,compCost))})} width={55}/>
      <Sel value={s.durUnit} onChange={v=>set({...s,durUnit:v,testing:String(noiseTestingPrice(s.durVal,v,s.level,compCost))})} options={["minutes","hours"]} width={85}/>
    </Row>
    <Row label="Compressor ($)">
      <Inp value={s.compBudget!==undefined&&s.compBudget!==""?s.compBudget:String(autoComp)} onChange={v=>set({...s,compBudget:v})} width={80}/>
      <span style={{fontSize:10,color:autoComp>0?C.warn:C.dim,marginLeft:4}}>
        {autoComp>0?"auto: $"+autoComp.toLocaleString()+" → $"+Math.round(autoComp*1.25).toLocaleString()+" w/markup":"25% markup applied"}
      </span>
    </Row>
    {sf(s.compBudget,0)>0&&(
      <div style={{fontSize:10,background:"#f0fdf4",border:"1px solid #86efac",borderRadius:5,
        padding:"5px 8px",marginBottom:6,color:"#166534"}}>
        ✓ Compressor rental (${sf(s.compBudget,0).toLocaleString()}) auto-added to Budget Materials as "Noise – Testing".
      </div>
    )}
    <Pia s={s} set={set}/>
    <HR/>
    <PRow label={"Std Setup (auto: "+money(chamberSetup)+")"} val={s.stdSetup||String(chamberSetup)} onChange={v=>set({...s,stdSetup:v})}/>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label={"Testing (auto: "+money(autoTesting)+")"} val={s.testing} onChange={v=>set({...s,testing:v})}/>
    {(()=>{
      const hrs=s.durUnit==="hours"?Math.ceil(parseFloat(s.durVal)||1):Math.ceil((parseFloat(s.durVal)||30)/60);
      if(hrs<=1)return null;
      const base60=NOISE_BASE_60[s.level]||0;
      const fullBlocks=Math.floor((hrs-1)/40);
      const remaining=hrs-(fullBlocks*40);
      const extraHrs=remaining-1;
      const blockCost=remaining>20?extraHrs*375:extraHrs*500;
      const rateNote=remaining>20?"all $375/hr":"$500/hr";
      return(
        <div style={{fontSize:10,color:"#6b7a8d",marginBottom:6,padding:"4px 8px",
          background:"#f8f9fb",borderRadius:5}}>
          {fullBlocks>0&&<span>{fullBlocks+1}× base ${base60.toLocaleString()} · </span>}
          {extraHrs>0&&<span>hrs 2–{remaining} ({rateNote}): ${blockCost.toLocaleString()} · </span>}
          <strong>Total: {money(autoTesting)}</strong>
        </div>
      );
    })()}
    {s.level==="170dB"&&(
      <div style={{fontSize:11,color:C.warn,marginBottom:6}}>⚠ 170dB performed as best effort</div>
    )}
    <ProcReport s={s} set={set} sectionCode="11"/>
  </div>;
}

function EnvForm({s,set}){
  const ENV_ITEMS=[
    {key:"th",label:"Temperature & Humidity",setup:500,testing:1000,td:500},
    {key:"sf",label:"Salt Fog (96 hrs)",setup:0,testing:1750,td:500},
    {key:"alt",label:"Altitude",setup:500,testing:1000,td:500},
    {key:"ess",label:"ESS",setup:0,testing:1000,td:500},
    {key:"acc",label:"Acceleration",setup:2000,testing:1950,td:750},
    {key:"incl",label:"Inclination",setup:1250,testing:1750,td:500},
    {key:"rd",label:"Rapid Decompression",setup:1000,testing:2275,td:500},
    {key:"ed",label:"Explosive Decompression",setup:1250,testing:2450,td:500},
    {key:"drip",label:"Drip Test",setup:500,testing:750,td:300},
    {key:"sub",label:"Submergence",setup:500,testing:750,td:300},
    {key:"spray",label:"Spray Test",setup:1250,testing:1250,td:500},
    {key:"insres",label:"Insulation Resistance & Dielectric Strength",setup:0,testing:500,td:0},
  ];
  return <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Lines</label>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
      {ENV_ITEMS.map(({key,label,setup,testing,td})=>{
        const checked=s.items?.[key]?.on||false;
        return(
          <div key={key} style={{background:checked?"#fdf3f2":C.panel,
            border:"1px solid "+(checked?C.red+"44":C.border),borderRadius:7,padding:"7px 10px"}}>
            <Toggle small checked={checked}
              onChange={v=>set({...s,items:{...s.items,[key]:{...(s.items?.[key]||{}),on:v,setup:String(setup),testing:String(testing),td:String(td)}}})}
              label={label}/>
          </div>
        );
      })}
    </div>
    {/* Per-item detail panels for active tests */}
    {[
      {key:"th",label:"Temperature & Humidity"},
      {key:"sf",label:"Salt Fog (96 hrs)"},
      {key:"alt",label:"Altitude"},
      {key:"ess",label:"ESS"},
      {key:"acc",label:"Acceleration"},
      {key:"incl",label:"Inclination"},
      {key:"rd",label:"Rapid Decompression"},
      {key:"ed",label:"Explosive Decompression"},
      {key:"drip",label:"Drip Test"},
      {key:"sub",label:"Submergence"},
      {key:"spray",label:"Spray Test"},
      {key:"insres",label:"Insulation Resistance & Dielectric Strength"},
    ].filter(({key})=>s.items?.[key]?.on).map(({key,label})=>{
      const item=s.items[key];
      const upd=patch=>set({...s,items:{...s.items,[key]:{...item,...patch}}});
      return(
        <div key={key} style={{background:C.panel,borderRadius:7,padding:"8px 10px",marginBottom:6,border:"1px solid "+C.red+"33"}}>
          <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:6}}>{label}</div>
          <Row label="Spec" mb={6}>
            <Inp value={item.spec||""} onChange={v=>upd({spec:v})} width={200}/>
          </Row>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {item.setup!=="0"&&item.setup!==undefined&&<div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Setup ($)</div>
              <Inp value={item.setup||"0"} onChange={v=>upd({setup:v})} width={80}/>
            </div>}
            <div>
              <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Testing ($)</div>
              {key==="th"
                ? <span style={{fontSize:12,fontWeight:600,color:C.text,padding:"3px 6px",background:C.bg,borderRadius:5,border:"1px solid "+C.border,display:"inline-block",minWidth:80}}>
                    {(ENV_TH_PRICES[s.thDur]||1000).toLocaleString()}
                  </span>
                : <Inp value={item.testing||"0"} onChange={v=>upd({testing:v})} width={80}/>
              }
            </div>
          </div>
          {key==="th"&&<>
            <Row label="Duration" mb={4}>
              <Sel value={s.thDur||"0 to 1 Day"} onChange={v=>set({...s,thDur:v})} options={Object.keys(ENV_TH_PRICES)} width={130}/>
            </Row>
            <Row label="Custom Duration" mb={4}>
              <Inp value={s.thDurVal||""} onChange={v=>set({...s,thDurVal:v})} width={60} placeholder="e.g. 24"/>
              <Sel value={s.thDurUnit||"hours"} onChange={v=>set({...s,thDurUnit:v})}
                options={["minutes","hours","days"]} width={90}/>
              <span style={{fontSize:9,color:C.dim,marginLeft:4}}>→ used in spec text</span>
            </Row>
            <Row label="Type" mb={0}>
              <Sel value={s.thType||"Temperature & Humidity"} onChange={v=>set({...s,thType:v})}
                options={["Temperature & Humidity","Temperature Only","Humidity Only"]} width={200}/>
            </Row>
          </>}
          {key==="alt"&&<Row label="Dwell" mb={0}>
            <Sel value={s.altDwell||"1-30 min"} onChange={v=>set({...s,altDwell:v})}
              options={["1-30 min","31-60 min","1-2 hr"]} width={120}/>
          </Row>}
          {key==="ess"&&<Row label="Duration/Axis" mb={0}>
            <Inp value={s.essDur||"10 minutes"} onChange={v=>set({...s,essDur:v})} width={120}/>
          </Row>}
        </div>
      );
    })}
    <Pia s={s} set={set}/>
    <ProcReport s={s} set={set} sectionCode="53"/>
  </div>;
}

function calcEmiShifts(s){
  const L=sf(s.dimL)*2.54, W=sf(s.dimW)*2.54, H=sf(s.dimH)*2.54;
  // Cables: prefer EMI-instance value if explicitly > 0, else fall back to Setup Details cables
  const emiCables=sf(s.cables,0);
  const setupCables=sf(s.setupCables,0);
  const cables=Math.max(1,emiCables>0?emiCables:setupCables);
  const phases=Math.max(1,sf(s.phases||3,3));
  const ru=x=>x>0?Math.ceil(x):0;
  const rp=x=>Math.max(1,Math.ceil(x)); // round up, minimum 1 position
  // Rev resolution: G if checked (alone or with F); F if only F or neither
  const revF=(s.revs||{})['Rev F']||false;
  const revG=(s.revs||{})['Rev G']||false;
  const useG=revG; // G wins when both checked (conservative)
  const revLabel=useG?'461G':'461F';
  const res={};
  // CE101 / CE102 — rev × phase lookup
  // F: 1Ph=4hr, 3Ph=6hr  /  G: 1Ph=6hr, 3Ph=8hr
  const ce_F={1:4,3:6}, ce_G={1:6,3:8};
  const ceHrs=(useG?ce_G:ce_F)[phases]||(useG?ce_G[3]:ce_F[3]);
  const ce=ceHrs/8;
  res.CE101={raw:ce,rounded:ru(ce),
    bd:[["Quote time ("+revLabel+", "+phases+"-phase, "+ceHrs+"hr)",ce]]};
  res.CE102={raw:ce,rounded:ru(ce),
    bd:[["Quote time ("+revLabel+", "+phases+"-phase, "+ceHrs+"hr)",ce]]};
  // CS101 — flat 6 hr both revs, both phases
  const cs101=6/8;
  res.CS101={raw:cs101,rounded:ru(cs101),
    bd:[["Quote time (6hr flat)",cs101]]};
  // CS106 — 461F only (excluded from G test list elsewhere); 1Ph=4hr, 3Ph=3hr
  const cs106Hrs=phases===1?4:3;
  const cs106=cs106Hrs/8;
  res.CS106={raw:cs106,rounded:ru(cs106),
    bd:[["Quote time (461F only, "+phases+"-phase, "+cs106Hrs+"hr)",cs106]]};
  // CS114 — rev-aware setup/cal, 90 min/test, F/G power test counts
  // F: 1Ph=2, 3Ph=3 power tests; setup/cal = 9 hr (6 cal + 2 setup + 1 add'l 4kHz-1MHz)
  // G: 1Ph=3, 3Ph=4 power tests; setup/cal = 15 hr (6 cal + 2 setup + 1 add'l + 6 verification)
  // Throughput-based: lab caps CS114 at 3 tests/day (signal + power combined).
  // Updated from 2/day after observing pricing trended high — actual lab
  // throughput is closer to 3/day with current setup workflow.
  const cs114PwrTests=phases===1?(useG?3:2):(useG?4:3);
  const cs114SetupHrs=useG?15:9;
  const cs114Setup=cs114SetupHrs/8;
  const cs114TotalTests=cables+cs114PwrTests;
  const cs114TestsPerDay=3;
  const cs114TestShifts=cs114TotalTests>0?Math.ceil(cs114TotalTests/cs114TestsPerDay):0;
  const cs114=cs114Setup+cs114TestShifts;
  res.CS114={raw:cs114,rounded:ru(cs114),
    sigTests:cables, pwrTests:cs114PwrTests, totalTests:cs114TotalTests,
    bd:[["Setup/Cal ("+revLabel+", "+cs114SetupHrs+"hr)",cs114Setup],["Tests ("+cs114TotalTests+" tests @ "+cs114TestsPerDay+"/day)",cs114TestShifts]]};
  // CS109 — Not performed by NU Labs; subcontract only, no shift cost
  res.CS109={raw:0,rounded:0,bd:[["Not performed at NU Labs -- subcontract required",0]]};
  // CS115 — Impulse Excitation; same test count as CS114, 5 min per test, 0.5 shift setup/cal
  const cs115Total=cables+cs114PwrTests;
  const cs115=0.5+((5*cs115Total)/60)/8;
  res.CS115={raw:cs115,rounded:ru(cs115),
    sigTests:cables, pwrTests:cs114PwrTests, totalTests:cs115Total,
    bd:[["Setup/Cal",0.5],["Tests (5min x "+cs115Total+")",((5*cs115Total)/60)/8]]};
  // CS116 — rev-aware power test counts (mirrors CS114), throughput-based: 4 tests/day
  // F: 1Ph=2, 3Ph=3 power tests
  // G: 1Ph=3, 3Ph=4 power tests
  const cs116PwrTests=phases===1?(useG?3:2):(useG?4:3);
  const cs116Setup=3.5/8;
  const cs116TotalTests=cables+cs116PwrTests;
  const cs116TestsPerDay=4;
  const cs116TestShifts=cs116TotalTests>0?Math.ceil(cs116TotalTests/cs116TestsPerDay):0;
  const cs116=cs116Setup+cs116TestShifts;
  res.CS116={raw:cs116,rounded:ru(cs116),
    sigTests:cables, pwrTests:cs116PwrTests, totalTests:cs116TotalTests,
    bd:[["Setup/Cal/Sweep ("+revLabel+", 3.5hr)",cs116Setup],["Tests ("+cs116TotalTests+" tests @ "+cs116TestsPerDay+"/day)",cs116TestShifts]]};
  // RE101 — Radiated Emissions, Magnetic Field
  // Engineer: 60 min cal + 15 min/position. 6 sides x 2 positions/side base + 1 per cable connector.
  // Floor: never less than 1.5 shifts (12 hr).
  const re101BasePos=12; // 6 sides × 2 positions
  const re101Pos=re101BasePos+cables;
  const re101Hrs=1+(15*re101Pos)/60; // 60 min cal + 15 min/pos
  const re101Raw=Math.max(1.5,re101Hrs/8);
  res.RE101={raw:re101Raw,rounded:ru(re101Raw),
    bd:[["Cal (60min)",1/8],
        ["Positions ("+re101Pos+" pos: 12 sides + "+cables+" cables, 15min ea)",(15*re101Pos)/60/8],
        ...(re101Raw>=1.5&&re101Hrs/8<1.5?[["Floor 1.5 shifts applied",1.5-(re101Hrs/8)]]:[])]};

  // RE102 — Radiated Emissions, Electric Field, 10 kHz to 18 GHz
  // 461F: width-only positions per spec. 461G: width × height positions above 200 MHz
  // (directional antennas scanned across both width and height of EUT to cover the
  // test boundary within the antenna's 3dB beamwidth).
  // 461F: 1 sweep all bands. 461G: 1 sweep <30 MHz, 2 sweeps (H+V) ≥30 MHz.
  // Per-sweep times independently calibrated for F vs G per engineer doc.
  // Below 1 GHz: 200 MHz-1 GHz uses 50 cm beamwidth (35 cm cable allowance baked in, no +7).
  // ≥1 GHz bands: +7 cm cable allowance.
  const re102Pos={
    b10k_30M:  1,                          // ≤3m boundary, 1 fixed position (active rod antenna)
    b30_200M:  1,                          // ≤3m boundary, 1 fixed position (biconical)
    sub1GHz:   useG ? rp(W/50)*rp(H/50)         : rp(W/50),         // 200 MHz-1 GHz, 50cm beamwidth
    b1_4:      useG ? rp((W+7)/93)*rp((H+7)/93) : rp((W+7)/93),     // 1-4 GHz, 93cm beamwidth
    b4_15:     useG ? rp((W+7)/52)*rp((H+7)/52) : rp((W+7)/52),     // 4-15 GHz, 52cm beamwidth
    b15_18:    useG ? rp((W+7)/14)*rp((H+7)/14) : rp((W+7)/14),     // 15-18 GHz, 14cm beamwidth
  };
  // Per-sweep times (minutes) — engineer doc 461F & 461G
  const re102Times = useG
    ? {b10k_30M:3,    b30_200M:130/60, sub1GHz:340/60, b1_4:307/60, b4_15:307/60, b15_18:55/60}
    : {b10k_30M:4,    b30_200M:5,      sub1GHz:12,     b1_4:6,      b4_15:15.5,   b15_18:3.5};
  // Polarization sweeps: 461F=1 all bands; 461G=1 below 30 MHz, 2 above
  const sweepLow = 1;                  // <30 MHz: vertical only (both revs)
  const sweepHigh = useG ? 2 : 1;      // ≥30 MHz: F=1 (price assumes width only), G=2 (H+V)
  const re102Setup = 1.5;              // setup/cal baseline
  const tLow = (re102Pos.b10k_30M  * re102Times.b10k_30M  * sweepLow ) / 60 / 8;
  const t30  = (re102Pos.b30_200M  * re102Times.b30_200M  * sweepHigh) / 60 / 8;
  const tSub = (re102Pos.sub1GHz   * re102Times.sub1GHz   * sweepHigh) / 60 / 8;
  const tRe1_4 = (re102Pos.b1_4    * re102Times.b1_4      * sweepHigh) / 60 / 8;
  const tRe4_15= (re102Pos.b4_15   * re102Times.b4_15     * sweepHigh) / 60 / 8;
  const tRe15_18=(re102Pos.b15_18  * re102Times.b15_18    * sweepHigh) / 60 / 8;
  const re102 = re102Setup + tLow + t30 + tSub + tRe1_4 + tRe4_15 + tRe15_18;
  const swLabel = useG ? '2 sweeps H+V' : '1 sweep';
  res.RE102={raw:re102,rounded:ru(re102),pos:re102Pos,
    bd:[["Setup/Cal",re102Setup],
        ["10 kHz-30 MHz ("+re102Pos.b10k_30M+" pos x "+re102Times.b10k_30M+"min, V only)",tLow],
        ["30-200 MHz ("+re102Pos.b30_200M+" pos x "+re102Times.b30_200M.toFixed(2)+"min, "+swLabel+")",t30],
        ["200 MHz-1 GHz ("+re102Pos.sub1GHz+" pos x "+re102Times.sub1GHz.toFixed(2)+"min, "+swLabel+")",tSub],
        ["1-4 GHz ("+re102Pos.b1_4+" pos x "+re102Times.b1_4.toFixed(2)+"min, "+swLabel+")",tRe1_4],
        ["4-15 GHz ("+re102Pos.b4_15+" pos x "+re102Times.b4_15.toFixed(2)+"min, "+swLabel+")",tRe4_15],
        ["15-18 GHz ("+re102Pos.b15_18+" pos x "+re102Times.b15_18.toFixed(2)+"min, "+swLabel+")",tRe15_18]]};

  // RS101 — Radiated Susceptibility, Magnetic Field
  // Engineer: 3 hr setup/cal, 22 min/position, face-area positions + 1 per cable connector
  // Reduction: any single dim >30 cm → ×0.7 on per-position time only (not setup)
  const rs101FacePos={
    LW: Math.max(1,Math.ceil((L*W)/900))*2,
    LH: Math.max(1,Math.ceil((L*H)/900))*2,
    WH: Math.max(1,Math.ceil((W*H)/900))*2,
  };
  const rs101FaceTotal=rs101FacePos.LW+rs101FacePos.LH+rs101FacePos.WH;
  const rs101CableCount=cables;
  const rs101OverSized=(L>30||W>30||H>30);
  const rs101Mult=rs101OverSized?0.7:1.0;
  const rs101Setup=3/8; // 3 hr
  const rs101FaceHrs=(rs101FaceTotal*22*rs101Mult)/60;
  const rs101CableHrs=(rs101CableCount*22*rs101Mult)/60;
  const rs101=rs101Setup + rs101FaceHrs/8 + rs101CableHrs/8;
  const rs101Pos={
    ...rs101FacePos,
    cables: rs101CableCount,
    get total(){ return this.LW+this.LH+this.WH+this.cables; }
  };
  res.RS101={raw:rs101,rounded:ru(rs101),pos:rs101Pos,
    bd:[["Setup/Cal (3hr)",rs101Setup],
        ["Face positions ("+rs101FaceTotal+" pos: "+rs101FacePos.LW+" LxW + "+rs101FacePos.LH+" LxH + "+rs101FacePos.WH+" WxH, 22min ea"+(rs101OverSized?" x0.7":"")+")",rs101FaceHrs/8],
        ["Cable connectors ("+rs101CableCount+" pos, 22min ea"+(rs101OverSized?" x0.7":"")+")",rs101CableHrs/8]]};

  // RS103 — shifts and positions per band (461F/G times, F=G)
  // Engineer per-position times: 2-30=16min(2 fixed), 30-200=25min(1 fixed),
  //   200-1G=21min(89.5cm bw), 1-4G=32min(93cm bw), 4-15G=30min(52cm bw), 15-18G=12min(14cm bw)
  // Setup/Field Adj/Antenna baseline: 3.0 shifts (1 hr setup + 2 hr field adj + antenna/amp changes)
  const rs103Pos={
    b2_30:   Math.max(2, rp((200+W)/188)), // boundary = 2m + unit width; coverage 188cm; min 2
    b30_200: 1, // fixed per spec (≤3m boundary)
    b200_1G: rp(L/89.5)+rp(W/89.5),
    b1_4:    rp(L/93)+rp(W/93),
    b4_15:   rp(L/52)+rp(W/52),
    b15_18:  rp(L/14)+rp(W/14),
  };
  const t2_30=((rs103Pos.b2_30*16)/60)/8;
  const t30_200=((rs103Pos.b30_200*25)/60)/8;
  const t200_1G=((rs103Pos.b200_1G*21)/60)/8;
  const t1_4=((rs103Pos.b1_4*32)/60)/8;
  const t4_15=((rs103Pos.b4_15*30)/60)/8;
  const t15_18=((rs103Pos.b15_18*12)/60)/8;
  const rs103=3.0+t2_30+t30_200+t200_1G+t1_4+t4_15+t15_18;
  res.RS103={raw:rs103,rounded:ru(rs103),pos:rs103Pos,
    bd:[["Setup/Field Adj/Antenna",3.0],
        ["2-30 MHz ("+rs103Pos.b2_30+" pos x 16min)",t2_30],
        ["30-200 MHz ("+rs103Pos.b30_200+" pos x 25min)",t30_200],
        ["200MHz-1GHz ("+rs103Pos.b200_1G+" pos x 21min)",t200_1G],
        ["1-4 GHz ("+rs103Pos.b1_4+" pos x 32min)",t1_4],
        ["4-15 GHz ("+rs103Pos.b4_15+" pos x 30min)",t4_15],
        ["15-18 GHz ("+rs103Pos.b15_18+" pos x 12min)",t15_18]]};

  // RS105 fixed
  res.RS105={raw:1.5,rounded:1.5,bd:[["Fixed",1.5]]};
  return res;
}

function EmiForm({s,set,ti,setup}){
  // Auto-populate dims from Test Item Description if not manually set
  const autoL=ti?.dimL||""; const autoW=ti?.dimW||""; const autoH=ti?.dimH||"";
  const autoWt=ti?.wt||"";
  const autoCables=setup?.cables||""; // Auto from Setup Details
  const autoPhases=ti?.phase||""; const autoVolt=ti?.volt||"";
  // Use instance value if set, else fall back to ti / setup
  const dispL=s.dimL||autoL; const dispW=s.dimW||autoW; const dispH=s.dimH||autoH;
  const dispWt=s.weight||autoWt; const dispPhases=s.phases||autoPhases;
  const dispCables=(s.cables&&s.cables!=="0")?s.cables:autoCables;
  // Rev-aware test list: F has CS106+RS105, G has CS109+CS115
  const isRevF=(s.revs||{})['Rev F']||false;
  const isRevG=(s.revs||{})['Rev G']||false;
  const TESTS_F=["CE101","CE102","CS101","CS106","CS114","CS116","RE101","RE102","RS101","RS103","RS105"];
  const TESTS_G=["CE101","CE102","CS101","CS109","CS114","CS115","CS116","RE101","RE102","RS101","RS103"];
  // If Rev G only → G list; if Rev F only or neither → F list; if both → combined
  const TESTS=isRevG&&!isRevF ? TESTS_G : !isRevG&&isRevF ? TESTS_F : isRevG&&isRevF ? [...new Set([...TESTS_F,...TESTS_G])] : TESTS_F;
  const TEST_LABELS={
    CE101:"Conducted Emissions, Power Leads",
    CE102:"Conducted Emissions, RF Potentials, Power Leads",
    CS101:"Conducted Susceptibility, Power Leads",
    CS106:"Conducted Susceptibility, Transients (461F)",
    CS109:"Conducted Susceptibility, Structure Current (461G)",
    CS114:"Conducted Susceptibility, Bulk Cable Injection",
    CS115:"Conducted Susceptibility, Bulk Cable Injection, Impulse (461G)",
    CS116:"Conducted Susceptibility, Damped Sinusoidal Transients",
    RE101:"Radiated Emissions, Magnetic Field",
    RE102:"Radiated Emissions, Electric Field",
    RS101:"Radiated Susceptibility, Magnetic Field",
    RS103:"Radiated Susceptibility, Electric Field",
    RS105:"Radiated Susceptibility, Transients (461F)",
  };
  const PLATS=["Surface Ships","Submarines"];
  const LOCS_CAN=[
    "Below Deck","Below Deck Non-metallic","Subs Internal",
    "Aircraft Fixed Wing Internal ≥25m",
    "Ground Navy Fixed","Ground Air Force","Space System Internal",
  ];
  const LOCS_TBD=[
    "High-Gain Preamp (≥48 dB) — Feasibility TBD",
  ];
  const LOCS_CANT=[
    "Above Deck","Subs External",
    "Aircraft Fixed Wing Internal <25m","Aircraft Fixed Wing External",
    "Ground Navy Mobile","Ground Army",
  ];
  const LOCS=[...LOCS_CAN,...LOCS_TBD,...LOCS_CANT];
  const REVS=["Rev F","Rev G"];
  const [expanded,setExpanded]=useState({});

  // ── Unit detail values for warning logic ──
  const eutAmps   = sf(s.phases&&s.phases?s.phases:ti?.phase||'3',3)>=1 ? sf(ti?.amps||'0',0) : 0;
  const eutHz     = sf(ti?.hz||'0',0);
  const isSub          = (s.plats||{})['Submarines']||false;
  const isAboveDeck    = (s.locs||{})['Above Deck']||false;
  const isBelowDeck    = (s.locs||{})['Below Deck']||false;
  // "Below Deck Non-metallic" is a separate selector from "Below Deck" (which
  // is metallic). The two have different RS103 / RE102 limits per MIL-STD-461.
  const isBelowDeckNonMetallic = (s.locs||{})['Below Deck Non-metallic']||false;
  const isSubsInternal = (s.locs||{})['Subs Internal']||false;
  const isSubsExternal = (s.locs||{})['Subs External']||false;
  const isGndNavyFixed = (s.locs||{})['Ground Navy Fixed']||false;
  const isGndNavyMob   = (s.locs||{})['Ground Navy Mobile']||false;
  const isGndArmy      = (s.locs||{})['Ground Army']||false;
  const isGndAF        = (s.locs||{})['Ground Air Force']||false;
  const isAircraftIntBig  = (s.locs||{})['Aircraft Fixed Wing Internal ≥25m']||false;
  const isAircraftIntSm   = (s.locs||{})['Aircraft Fixed Wing Internal <25m']||false;
  const isAircraftExt  = (s.locs||{})['Aircraft Fixed Wing External']||false;
  const isSpaceInt     = (s.locs||{})['Space System Internal']||false;
  const isPreampTBD    = (s.locs||{})['High-Gain Preamp (≥48 dB) — Feasibility TBD']||false;
  const isDC           = (ti?.pwrType||'AC')==='DC';

  // ── Per-test flags: { greyed: bool, greyReason: string, warnings: string[] } ──
  const getTestFlags=(t)=>{
    const warnings=[];
    let greyed=false, greyReason='';

    if(t==='CS101'){
      if(isRevF && eutAmps>0 && eutAmps>100){
        greyed=true; greyReason='CS101 generally does not apply for EUT currents >100 A/phase (Rev F).';
      } else if(isRevG && eutAmps>0 && eutAmps>30 && eutHz>150000){
        greyed=true; greyReason='CS101 generally does not apply for >30 A/phase when operating frequency >150 kHz (Rev G).';
      } else if(isRevG && eutAmps>0 && eutAmps>30){
        warnings.push('Rev G: CS101 applies for >30 A/phase only if operating frequency ≤150 kHz AND sensitivity better than 1 µV. Verify before including.');
      }
      if(eutAmps>0 && eutAmps>18){
        warnings.push('Amplifier limit: transformer secondary current max ~23 A. Feasibility should be checked at time of test if EUT current is close to this limit.');
      }
    }

    if(t==='CS109'){
      // CS109 is never performed by NU Labs — always show as non-selectable
      greyed=true;
      greyReason=eutHz>0&&eutHz>100000
        ?'CS109 does not apply for operating frequency >100 kHz.'
        :'NU Labs does not perform CS109. This test must be subcontracted if required.';
    }

    if(t==='RS101'){
      if(eutHz>0 && eutHz>100000){
        greyed=true; greyReason='RS101 does not apply for operating frequency >100 kHz.';
      } else {
        warnings.push('RS101 applicability requires operating frequency ≤100 kHz AND sensitivity better than 1 µV. Verify with customer before including.');
        if(isSub) warnings.push('Army curve is feasible but pushes our Crown 5002 amp to its limits. Navy curve is OK.');
      }
    }

    if(t==='RS103'){
      warnings.push('NU Labs RS103 capability is limited to 10 V/m (Ships metallic below deck / Subs internal). Max frequency: 18 GHz.');
      if(isBelowDeckNonMetallic){
        warnings.push('Ships non-metallic below deck (50/10 V/m) requires our rented 500 W amp for the 2–30 MHz portion at 50 V/m. Confirm amp availability or subcontract.');
      }
      if(isAboveDeck){
        warnings.push('Ships above deck / exposed below deck (50 V/m 2–30 MHz) requires a rented 500 W amp — subcontract or add rental cost.');
      }
      if(isSubsExternal||isAircraftExt||isGndNavyMob||isGndArmy){
        warnings.push('Selected location may require higher field strengths (>10 V/m) — verify limits with customer. Subcontracting may be required.');
      }
    }

    if(t==='RE102'){
      const re102Sub = isAboveDeck||isSubsExternal||isAircraftIntSm||isAircraftExt||isGndNavyMob||isGndArmy;
      if(re102Sub){
        greyed=true;
        greyReason='RE102 subcontract required for selected location(s): '
          +[isAboveDeck&&'Ships Above Deck',isSubsExternal&&'Subs External',
            isAircraftIntSm&&'Aircraft Fixed Wing Internal <25m',isAircraftExt&&'Aircraft Fixed Wing External',
            isGndNavyMob&&'Ground Navy Mobile',isGndArmy&&'Ground Army'].filter(Boolean).join(', ')+'.';
      } else {
        if(isAircraftIntBig) warnings.push('Aircraft Fixed Wing Internal ≥25 m: NU Labs can perform this in-house. Verify nose-to-tail length before quoting.');
        if(isSpaceInt) warnings.push('Space System Internal: May be doable — verify limits with production before committing.');
        if(isPreampTBD) warnings.push('High-gain preamp (≥48 dB) may extend RE102 capability for some limits. Feasibility not yet confirmed — check with production.');
        const re102CanDo=isBelowDeck||isBelowDeckNonMetallic||isSubsInternal||isGndNavyFixed||isGndAF||isAircraftIntBig||isSpaceInt||isPreampTBD;
        if(!re102CanDo) warnings.push('No location selected — verify RE102 applicability and limits with customer.');
      }
    }

    if(t==='RE101'){
      if(eutHz>0 && eutHz>100000){
        warnings.push('RE101 applicability should be verified for operating frequency >100 kHz.');
      }
    }

    if(isDC){
      if(['CS101','CS106','CS114','CS115','CS116'].includes(t)){
        warnings.push('EUT is DC powered — this test still applies but limits may differ. Confirm applicable figure with customer.');
      }
    }

    return {greyed, greyReason, warnings};
  };

  // Compute shifts from unit details dimensions
  const shifts=useMemo(()=>calcEmiShifts({dimL:dispL,dimW:dispW,dimH:dispH,cables:dispCables||"0",setupCables:setup?.cables||"0",phases:dispPhases||"3",revs:s.revs}),[dispL,dispW,dispH,dispCables,setup?.cables,dispPhases,s.revs]);

  // "All selected" considers only non-greyed tests — greyed tests are never
  // selectable, so they shouldn't prevent the button from saying "Deselect All"
  // when every selectable test is on.
  const allSelected=TESTS.filter(t=>!getTestFlags(t).greyed).every(t=>s.tests?.[t]||false);
  const toggleAll=()=>{
    const v=!allSelected;
    const tests={};
    // When selecting all, skip tests that are currently greyed-out
    // (unavailable for this EUT configuration — e.g. CS109 which NU Labs
    // can't perform, or frequency-disqualified tests). When deselecting
    // all, just clear everything.
    TESTS.forEach(t=>{
      if (v && getTestFlags(t).greyed) return; // skip greyed when bulk-selecting
      tests[t]=v;
    });
    set({...s,tests});
  };

  const selCount=TESTS.filter(t=>s.tests?.[t]).length;
  const selShifts=TESTS.filter(t=>s.tests?.[t]).reduce((a,t)=>a+(shifts[t]?.rounded||0),0);
  const rate=sf(s.rate,EMI_SR);

  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <div style={{marginBottom:8}}>
      <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Spec Revision</div>
      <div style={{display:"flex",gap:12}}>
        {REVS.map(r=>(
          <label key={r} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
            <input type="checkbox" checked={(s.revs||{})[r]||false}
              onChange={e=>set({...s,revs:{...(s.revs||{}),[r]:e.target.checked}})}
              style={{accentColor:C.red,width:13,height:13}}/>
            <span style={{fontSize:11,color:(s.revs||{})[r]?C.red:C.muted}}>{r}</span>
          </label>
        ))}
      </div>
    </div>
    {(autoL||autoW||autoH)&&(
      <div style={{fontSize:10,color:C.accent,background:"#eef4fb",borderRadius:6,padding:"4px 8px",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
        <span>⟳</span>
        <span>{"Auto-filled from Test Item Description — override below if needed"}</span>
      </div>
    )}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
      <Row label="L (in)" mb={0}><Inp value={dispL} onChange={v=>set({...s,dimL:v})} width={60}/>{s.dimL&&<span style={{fontSize:9,color:C.dim,marginLeft:2}}>▲</span>}</Row>
      <Row label="W (in)" mb={0}><Inp value={dispW} onChange={v=>set({...s,dimW:v})} width={60}/>{s.dimW&&<span style={{fontSize:9,color:C.dim,marginLeft:2}}>▲</span>}</Row>
      <Row label="H (in)" mb={0}><Inp value={dispH} onChange={v=>set({...s,dimH:v})} width={60}/>{s.dimH&&<span style={{fontSize:9,color:C.dim,marginLeft:2}}>▲</span>}</Row>
      <Row label="Weight (lbs)" mb={0}><Inp value={dispWt} onChange={v=>set({...s,weight:v})} width={60}/></Row>
      <Row label="Cables" mb={0}><Inp value={dispCables||"0"} onChange={v=>set({...s,cables:v})} width={60}/>{autoCables&&(!s.cables||s.cables==="0")&&<span style={{fontSize:9,color:C.dim,marginLeft:2}}>auto</span>}</Row>
      <Row label="Phases" mb={0}><Inp value={dispPhases||"3"} onChange={v=>set({...s,phases:v})} width={60}/>{autoPhases&&!s.phases&&<span style={{fontSize:9,color:C.dim,marginLeft:2}}>auto</span>}</Row>
    </div>
    <Row label="Shift Rate ($)"><Inp value={s.rate} onChange={v=>set({...s,rate:v})} width={80}/></Row>
    <Row label="Addl Costs ($)"><Inp value={s.addl} onChange={v=>set({...s,addl:v})} width={80}/></Row>
    <Row label="Setup Shifts"><Inp value={s.setupShifts} onChange={v=>set({...s,setupShifts:v})} width={60}/></Row>
    <Row label="Teardown Shifts"><Inp value={s.tdShifts} onChange={v=>set({...s,tdShifts:v})} width={60}/></Row>
    <div style={{marginBottom:8}}>
      <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Platform</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {PLATS.map(p=><Toggle key={p} small checked={(s.plats||{})[p]||false}
          onChange={v=>set({...s,plats:{...(s.plats||{}),[p]:v}})} label={p}/>)}
      </div>
    </div>
    <div style={{marginBottom:8}}>
      <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Location / RE102 Limits</div>
      <div style={{marginBottom:6}}>
        <div style={{fontSize:9,color:"#166534",fontWeight:700,marginBottom:4,letterSpacing:.5}}>✓ IN-HOUSE CAPABLE</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {LOCS_CAN.map(l=><Toggle key={l} small checked={(s.locs||{})[l]||false}
            onChange={v=>set({...s,locs:{...(s.locs||{}),[l]:v}})} label={l}/>)}
        </div>
      </div>
      <div style={{marginBottom:6}}>
        <div style={{fontSize:9,color:"#b7791f",fontWeight:700,marginBottom:4,letterSpacing:.5}}>? FEASIBILITY TBD</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {LOCS_TBD.map(l=><Toggle key={l} small checked={(s.locs||{})[l]||false}
            onChange={v=>set({...s,locs:{...(s.locs||{}),[l]:v}})} label={l}/>)}
        </div>
      </div>
      <div>
        <div style={{fontSize:9,color:C.red,fontWeight:700,marginBottom:4,letterSpacing:.5}}>✗ SUBCONTRACT REQUIRED</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {LOCS_CANT.map(l=><Toggle key={l} small checked={(s.locs||{})[l]||false}
            onChange={v=>set({...s,locs:{...(s.locs||{}),[l]:v}})} label={l}/>)}
        </div>
      </div>
    </div>
    <Pia s={s} set={set}/>
    <HR/>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
      <div style={{fontSize:11,color:C.muted,fontWeight:600}}>TESTS ({selCount}/{TESTS.length} selected, {selShifts} shifts)</div>
      <button onClick={toggleAll}
        style={{background:"none",border:"1px solid "+C.border,borderRadius:5,padding:"2px 10px",
          cursor:"pointer",fontSize:11,color:allSelected?C.red:C.accent,fontWeight:600}}>
        {allSelected?"Deselect All":"Select All"}
      </button>
    </div>
    {TESTS.map(t=>{
      const on=s.tests?.[t]||false;
      const sh=shifts[t];
      const isExp=expanded[t]||false;
      const {greyed,greyReason,warnings}=getTestFlags(t);
      // Determine row state: greyed=N/A (red), hasWarning=amber, else green
      const hasWarnings=warnings.length>0;
      const rowBg=greyed?(on?"#fef2f2":C.panel):hasWarnings?(on?"#fffbeb":C.panel):(on?"#f0fdf4":C.panel);
      const rowBorder=greyed?"#fca5a5":hasWarnings?(on?"#b7791f":C.border):(on?"#86efac":C.border);
      const keyColor=greyed?C.muted:hasWarnings?(on?"#92400e":C.text):(on?"#166534":C.text);
      const labelColor=greyed?C.dim:hasWarnings?(on?"#b45309":C.dim):(on?"#15803d":C.dim);
      return <div key={t} style={{marginBottom:4}}>
        <div style={{display:"flex",alignItems:"center",gap:6,
          background:rowBg,
          border:"1px solid "+rowBorder,
          borderRadius:6,padding:"5px 8px",
          opacity:greyed?0.7:1}}>
          <input type="checkbox" checked={on}
            onChange={e=>set({...s,tests:{...s.tests,[t]:e.target.checked}})}
            disabled={t==="CS109"}
            style={{accentColor:greyed?C.red:hasWarnings?"#b7791f":"#166534",width:13,height:13,flexShrink:0,cursor:t==="CS109"?"not-allowed":"pointer"}}/>
          <span style={{fontSize:11,fontWeight:600,color:keyColor,minWidth:50}}>{t}</span>
          <span style={{fontSize:10,color:labelColor,flex:1,marginLeft:2}}>{TEST_LABELS[t]||""}</span>
          {greyed&&<span style={{fontSize:9,color:"#6b7a8d",background:"#e8ecf0",borderRadius:4,padding:"1px 5px",flexShrink:0}}>N/A</span>}
          {sh&&!greyed&&(()=>{
            // Override-aware shift display. The computed value lives in sh.rounded;
            // the user can override per-test via s.shiftOverrides[t]. Empty input
            // means "use computed." Override persists per quote.
            const ov = s.shiftOverrides?.[t];
            const hasOv = ov !== undefined && ov !== null && ov !== "";
            const displayVal = hasOv ? String(ov) : "";
            return (
              <div style={{display:"flex",alignItems:"center",gap:3,flexShrink:0,marginLeft:4}}>
                <input type="number" step="0.25" min="0"
                  value={displayVal}
                  placeholder={String(sh.rounded)}
                  onChange={e=>{
                    const v = e.target.value;
                    const next = {...(s.shiftOverrides||{})};
                    if (v === "" || isNaN(parseFloat(v))) delete next[t];
                    else next[t] = parseFloat(v);
                    set({...s, shiftOverrides: next});
                  }}
                  title={hasOv ? `Manual override (computed: ${sh.rounded})` : "Click to override the suggested shift count"}
                  style={{
                    width:42,fontSize:10,padding:"1px 4px",textAlign:"center",
                    border:"1px solid "+(hasOv?"#b7791f":"#d0d7de"),
                    borderRadius:4,
                    background:hasOv?"#fffbeb":"#fff",
                    color:hasOv?"#92400e":C.muted,
                    fontWeight:hasOv?600:400,
                  }}/>
                <span style={{fontSize:10,color:C.muted}}>sh{(hasOv?ov:sh.rounded)!==1?"s":""}</span>
                {hasOv&&(
                  <button onClick={()=>{
                    const next = {...(s.shiftOverrides||{})};
                    delete next[t];
                    set({...s, shiftOverrides: next});
                  }}
                  title="Clear override (use computed)"
                  style={{background:"none",border:"none",color:"#b7791f",fontSize:11,cursor:"pointer",padding:"0 2px",lineHeight:1}}>✕</button>
                )}
              </div>
            );
          })()}
          {t==="RS103"&&on&&(
            <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:4}}>
              <span style={{fontSize:10,color:C.warn,flexShrink:0}}>Amp $</span>
              <input type="text" value={s.rs103amp||"5000"}
                onChange={e=>set({...s,rs103amp:e.target.value})}
                style={{...inp,width:60,fontSize:10,padding:"2px 5px"}}/>
            </div>
          )}
          {/* CE101/CE102 Power Source Rental — only when 440V AC, attached to CE101 if both selected */}
          {(()=>{
            const is440AC=sf(ti?.volt,0)>=440&&(ti?.pwrType||"AC")==="AC";
            if(!is440AC||!on)return null;
            const ce101On=s.tests?.["CE101"]||false;
            const ce102On=s.tests?.["CE102"]||false;
            // Show on CE101 if it's selected; else show on CE102 if only it's selected
            const showHere=(t==="CE101"&&ce101On)||(t==="CE102"&&ce102On&&!ce101On);
            if(!showHere)return null;
            return(
              <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:4}}>
                <span style={{fontSize:10,color:C.warn,flexShrink:0}}>Pwr Src $</span>
                <input type="text" value={s.ce101pwrSrc||"6500"}
                  onChange={e=>set({...s,ce101pwrSrc:e.target.value})}
                  style={{...inp,width:60,fontSize:10,padding:"2px 5px"}}/>
              </div>
            );
          })()}
          {sh&&sh.bd&&<button onClick={()=>setExpanded({...expanded,[t]:!isExp})}
            style={{background:"none",border:"none",color:C.accent,cursor:"pointer",fontSize:11,padding:"0 4px"}}>
            {isExp?"▲":"▼"}
          </button>}
        </div>
        {/* Grey-out reason banner */}
        {greyed&&(
          <div style={{background:"#f0f2f5",border:"1px solid #d0d7de",borderTop:"none",
            borderRadius:"0 0 6px 6px",padding:"5px 10px",display:"flex",gap:6,alignItems:"flex-start"}}>
            <span style={{fontSize:12,flexShrink:0}}>ℹ️</span>
            <span style={{fontSize:10,color:"#6b7a8d",lineHeight:1.5}}>{greyReason}</span>
          </div>
        )}
        {/* Warning banners */}
        {!greyed&&warnings.length>0&&(
          <div style={{background:"#fffbeb",border:"1px solid #b7791f",borderTop:"none",
            borderRadius:"0 0 6px 6px",padding:"6px 10px",display:"flex",flexDirection:"column",gap:4}}>
            {warnings.map((w,i)=>(
              <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                <span style={{fontSize:12,flexShrink:0}}>⚠️</span>
                <span style={{fontSize:10,color:"#7b4f12",lineHeight:1.5}}>{w}</span>
              </div>
            ))}
          </div>
        )}
        {/* CS109 — always subcontracted, prominent banner under greyed row */}
        {t==="CS109"&&greyed&&(
          <div style={{background:"#fef2f2",border:"1px solid #dc2626",borderTop:"none",
            borderRadius:"0 0 6px 6px",padding:"8px 10px",display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{fontSize:15,flexShrink:0}}>🚫</span>
            <span style={{fontSize:10,color:"#7f1d1d",lineHeight:1.6}}>
              <b>NU Labs does not perform CS109.</b> If this test is required by the specification, it must be <b>subcontracted</b>. Add a separate subcontract line item to this quote and notify the customer.
            </span>
          </div>
        )}
        {isExp&&sh&&(
          <div style={{background:"#f7f9fb",border:"1px solid "+C.border,borderTop:"none",
            borderRadius:"0 0 6px 6px",padding:"6px 10px"}}>
            {sh.bd.map(([lbl,val],i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted,marginBottom:2}}>
                <span>{lbl}</span>
                <span style={{fontFamily:"monospace"}}>{val.toFixed(4)} shifts</span>
              </div>
            ))}
            <div style={{fontSize:10,color:C.text,fontWeight:600,borderTop:"1px solid "+C.border,marginTop:4,paddingTop:4,display:"flex",justifyContent:"space-between"}}>
              <span>Total (rounded up)</span>
              <span style={{fontFamily:"monospace"}}>{sh.rounded} shifts = {"$"}{r25(Math.round(sh.rounded*rate)).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>;
    })}
    {selShifts>0&&(()=>{
      const selTests=TESTS.filter(t=>s.tests?.[t]);
      const hasRS103=selTests.includes("RS103");
      const rs103Amt=hasRS103?sf(s.rs103amp,5000):0;
      // CE101/CE102 Power Source Rental — 440V AC, charged once
      const has440AC=sf(ti?.volt,0)>=440&&(ti?.pwrType||"AC")==="AC";
      const hasCE=selTests.includes("CE101")||selTests.includes("CE102");
      const ce101Amt=(has440AC&&hasCE)?sf(s.ce101pwrSrc,6500):0;
      const ce101Label=selTests.includes("CE101")?"CE101":"CE102";
      const shiftTotal=r25(Math.round(selShifts*rate));
      const grandTotal=r25(shiftTotal+rs103Amt+ce101Amt);
      return(
        <div style={{fontSize:11,color:C.redDim,fontWeight:600,marginTop:6,padding:"6px 8px",background:"#fdf3f2",borderRadius:6}}>
          <div>{"Testing: "}{selShifts}{" shifts x $"}{rate.toLocaleString()}{" = $"}{shiftTotal.toLocaleString()}</div>
          {rs103Amt>0&&<div style={{marginTop:3}}>RS103 amplifier budget: +${rs103Amt.toLocaleString()}</div>}
          {ce101Amt>0&&<div style={{marginTop:3}}>{ce101Label} power source rental (440V AC): +${ce101Amt.toLocaleString()}</div>}
          {(rs103Amt>0||ce101Amt>0)&&<div style={{marginTop:3,borderTop:"1px solid #f5c6c6",paddingTop:3}}>Suggested Testing Total: ${grandTotal.toLocaleString()}</div>}
        </div>
      );
    })()}
    <ProcReport s={s} set={set} procPrice={3425} reportPrice={2850} sectionCode="21"/>
  </div>;
}

function PqForm({s,set,ti}){
  const autoPhase=ti?.phase||"";
  const PQ_P1=[
    {key:"5.3.1",label:"Grounding (susceptibility) test",sh:0.5,sh3p:null},
    {key:"5.3.2",label:"User equipment power profile test",sh:1.0,sh3p:null},
    {key:"5.3.3",label:"Voltage and frequency maximum departure tolerance test",sh:1.0,sh3p:null},
    {key:"5.3.4",label:"Voltage and frequency transient tolerance and recovery test",sh:1.0,sh3p:null},
    {key:"5.3.5",label:"Voltage spike (susceptibility) test",sh:1.5,sh3p:2.0},
    {key:"5.3.6",label:"Emergency conditions (susceptibility) test",sh:2.0,sh3p:null},
    {key:"5.3.7",label:"Current waveform (emission) test",sh:0.75,sh3p:1.0},
    {key:"5.3.8",label:"Voltage and frequency modulation test",sh:2.0,sh3p:null},
    {key:"5.3.9",label:"Simulated human body impedance ground current test",sh:0.75,sh3p:null},
    {key:"5.3.10.1",label:"Equipment line-to-ground voltage test",sh:0.5,sh3p:null},
    {key:"5.3.10.2",label:"Equipment line-to-ground voltage test (AGD)",sh:0.5,sh3p:null},
  ];
  const PQ_300B=[
    {key:"B5.3.1",label:"Voltage and frequency tolerance test",sh:1.0,sh3p:null},
    {key:"B5.3.2",label:"Voltage and frequency transient tolerance and recovery test",sh:1.0,sh3p:null},
    {key:"B5.3.3",label:"Voltage spike test",sh:1.5,sh3p:2.0},
    {key:"B5.3.4",label:"Emergency condition test",sh:2.0,sh3p:null},
    {key:"B5.3.5",label:"Grounding test",sh:0.5,sh3p:null},
    {key:"B5.3.6",label:"User equipment power profile test",sh:1.0,sh3p:null},
    {key:"B5.3.7",label:"Current waveform test",sh:0.75,sh3p:1.0},
    {key:"B5.3.8",label:"Voltage and frequency modulation test",sh:2.0,sh3p:null},
    {key:"B5.3.9",label:"Simulated human body leakage current test",sh:0.75,sh3p:null},
    {key:"B5.3.10.1",label:"Equipment insulation resistance test",sh:0.5,sh3p:null},
    {key:"B5.3.10.2",label:"Active ground detection test",sh:0.5,sh3p:null},
  ];
  const rate=sf(s.rate,PQ_SR);
  const is3ph=sf(s.phases||autoPhase||3,3)>=3;
  // Use phase-aware shifts; effective value honors s.shiftOverrides[key] when set
  const getShifts=r=>{
    const ov = s.shiftOverrides?.[r.key];
    if (ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov))) return parseFloat(ov);
    return is3ph&&r.sh3p!=null?r.sh3p:r.sh;
  };
  const p1Shifts=PQ_P1.reduce((a,r)=>a+(s.rows?.[r.key]?getShifts(r):0),0);
  const b3Shifts=PQ_300B.reduce((a,r)=>a+(s.rows?.[r.key]?getShifts(r):0),0);
  const totalShifts=p1Shifts+b3Shifts;
  const su=r25(sf(s.setupShifts,1.5)*rate), td=r25(sf(s.tdShifts,1.0)*rate);
  const testCost=r25(totalShifts*rate);
  const allP1=PQ_P1.every(r=>s.rows?.[r.key]);
  const allB3=PQ_300B.every(r=>s.rows?.[r.key]);
  const toggleP1=()=>{const v=!allP1;const rows={...s.rows};PQ_P1.forEach(r=>rows[r.key]=v);set({...s,rows});};
  const toggleB3=()=>{const v=!allB3;const rows={...s.rows};PQ_300B.forEach(r=>rows[r.key]=v);set({...s,rows});};

  const renderTable=(rows,title,allSel,onToggleAll)=>(
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{fontSize:11,color:C.accent,fontWeight:700}}>{title}</div>
        <button onClick={onToggleAll}
          style={{background:"none",border:"1px solid "+C.border,borderRadius:5,padding:"2px 8px",
            cursor:"pointer",fontSize:10,color:allSel?C.red:C.accent,fontWeight:600}}>
          {allSel?"Deselect All":"Select All"}
        </button>
      </div>
      <div style={{border:"1px solid "+C.border,borderRadius:7,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"20px 80px 1fr 60px",
          background:C.panel,padding:"4px 8px",fontSize:9,color:C.dim,fontWeight:700,gap:6}}>
          <div/>
          <div>Section</div>
          <div>Requirement</div>
          <div style={{textAlign:"right"}}>Shifts</div>
        </div>
        {rows.map((r,i)=>{
          const checked=s.rows?.[r.key]||false;
          const sh=getShifts(r);
          const isCwRow=(r.key==="5.3.7"||r.key==="B5.3.7");
          const showCwNote=isCwRow&&checked&&(s.cw||false);
          return(
            <div key={r.key}>
              <div style={{display:"grid",gridTemplateColumns:"20px 80px 1fr 60px",
                padding:"5px 8px",gap:6,alignItems:"center",
                background:checked?"#f0fdf4":i%2===0?C.card:C.panel,
                borderTop:"1px solid "+(checked?"#86efac":C.border)}}>
                <input type="checkbox" checked={checked}
                  onChange={e=>{const rows={...s.rows};rows[r.key]=e.target.checked;set({...s,rows});}}
                  style={{accentColor:"#166534",width:12,height:12}}/>
                <span style={{fontSize:10,fontWeight:600,color:checked?"#166534":C.accent}}>{r.key.replace("B","")}</span>
                <span style={{fontSize:10,color:checked?"#15803d":C.text}}>{r.label}</span>
                {(()=>{
                  // Override-aware shift display, same pattern as EMI.
                  // sh is the computed value (already phase-aware).
                  // Override per-test in s.shiftOverrides[r.key].
                  const ov = s.shiftOverrides?.[r.key];
                  const hasOv = ov !== undefined && ov !== null && ov !== "";
                  const displayVal = hasOv ? String(ov) : "";
                  const phaseAdj = sh!==r.sh;
                  return (
                    <div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"flex-end"}}>
                      <input type="number" step="0.25" min="0"
                        value={displayVal}
                        placeholder={String(sh)}
                        onChange={e=>{
                          const v = e.target.value;
                          const next = {...(s.shiftOverrides||{})};
                          if (v === "" || isNaN(parseFloat(v))) delete next[r.key];
                          else next[r.key] = parseFloat(v);
                          set({...s, shiftOverrides: next});
                        }}
                        title={hasOv ? `Manual override (computed: ${sh})` : (phaseAdj ? "Phase-adjusted shift count — click to override" : "Click to override")}
                        style={{
                          width:38,fontSize:10,padding:"1px 3px",textAlign:"center",
                          border:"1px solid "+(hasOv?"#b7791f":"#d0d7de"),
                          borderRadius:4,
                          background:hasOv?"#fffbeb":"#fff",
                          color:hasOv?"#92400e":C.muted,
                          fontFamily:"monospace",
                          fontWeight:hasOv?600:400,
                        }}/>
                      {!hasOv&&phaseAdj&&<span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>*</span>}
                      {hasOv&&(
                        <button onClick={()=>{
                          const next = {...(s.shiftOverrides||{})};
                          delete next[r.key];
                          set({...s, shiftOverrides: next});
                        }}
                        title="Clear override"
                        style={{background:"none",border:"none",color:"#b7791f",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>✕</button>
                      )}
                    </div>
                  );
                })()}
              </div>
              {showCwNote&&(
                <div style={{padding:"3px 8px 5px 38px",background:checked?"#f0fdf4":i%2===0?C.card:C.panel,
                  fontSize:9,fontStyle:"italic",color:"#7b4f12",borderTop:"none"}}>
                  ↳ Current Waveform testing performed using facility power.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return <div>
    <Row label="Shift Rate ($)"><Inp value={s.rate} onChange={v=>set({...s,rate:v})} width={80}/></Row>
    <Row label="Phases">
      <Inp value={s.phases||autoPhase||"3"} onChange={v=>set({...s,phases:v})} width={50}/>
      {autoPhase&&!s.phases&&<span style={{fontSize:9,color:C.accent,marginLeft:4}}>auto from TI</span>}
      {is3ph&&<span style={{fontSize:10,color:C.warn,marginLeft:6}}>3-phase: shifts adjusted</span>}
    </Row>
    <Row label="Setup Shifts"><Inp value={s.setupShifts} onChange={v=>set({...s,setupShifts:v})} width={60}/></Row>
    <Row label="Teardown Shifts"><Inp value={s.tdShifts} onChange={v=>set({...s,tdShifts:v})} width={60}/></Row>
    <Pia s={s} set={set}/>
    <Toggle small checked={s.cw||false} onChange={v=>set({...s,cw:v})} label="Current Waveform (facility power)"/>
    {(()=>{
      const eutAmps=sf(ti?.amps||'0',0);
      const numPhases=sf(s.phases||autoPhase||'3',3);
      const isSubPQ=s.submarine||false;
      const agdSelected=(s.rows||{})['5.3.10.2']||(s.rows||{})['B5.3.10.2'];
      const cwSelected=(s.rows||{})['5.3.7']||(s.rows||{})['B5.3.7'];
      const spikeSelected=(s.rows||{})['5.3.5']||(s.rows||{})['B5.3.3'];
      const pqWarnings=[];
      if(eutAmps>0&&eutAmps<1&&cwSelected)
        pqWarnings.push('Current Waveform test (5.3.7 / B5.3.7) is not required for EUT currents <1 A per NAVSEA. Consider removing this test.');
      if(agdSelected)
        pqWarnings.push('AGD test (5.3.10.2 / B5.3.10.2): If required (common for submarines), a high-voltage power supply rental will likely be needed.');
      if(numPhases>3||sf(ti?.phase||'3',3)>3)
        pqWarnings.push('Unit has multiple power feeds — discuss with customer which lines require testing and which tests apply to each feed before finalizing scope.');
      if(spikeSelected)
        pqWarnings.push('Voltage Spike testing: NU Labs uses an IEC 61000-4-5 waveform instead of the MIL-STD waveform, as noted in the Test Specifications.');
      if(pqWarnings.length===0)return null;
      return(
        <div style={{background:"#fffbeb",border:"1px solid #b7791f",borderRadius:7,padding:"8px 10px",marginTop:6,marginBottom:4}}>
          {pqWarnings.map((w,i)=>(
            <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start",marginBottom:i<pqWarnings.length-1?5:0}}>
              <span style={{fontSize:12,flexShrink:0}}>⚠️</span>
              <span style={{fontSize:10,color:"#7b4f12",lineHeight:1.5}}>{w}</span>
            </div>
          ))}
        </div>
      );
    })()}
    <HR/>
    {renderTable(PQ_P1,"MIL-STD-1399 Section 300 Part 1",allP1,toggleP1)}
    {renderTable(PQ_300B,"MIL-STD-1399 Section 300B",allB3,toggleB3)}
    <HR/>
    <div style={{fontSize:11,color:C.dim,marginBottom:4}}>
      {"Setup: "}{money(su)}{"  ·  Testing: "}{money(testCost)}{" ("}{totalShifts}{" shifts)  ·  TD: "}{money(td)}
    </div>
    <div style={{fontSize:12,color:C.redDim,fontWeight:600,marginBottom:4}}>
      {"PQ Total: "}{money(su+testCost+td)}
    </div>
    <ProcReport s={s} set={set} procPrice={2925} reportPrice={2450} sectionCode="22"/>
  </div>;
}

function DcmForm({s,set}){
  const rate=sf(s.rate,DCM_SR);
  const total=(sf(s.setupShifts,1.5)+sf(s.testShifts,2.0))*rate;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="Shift Rate ($)"><Inp value={s.rate} onChange={v=>set({...s,rate:v})} width={80}/></Row>
    <Row label="Setup Shifts"><Inp value={s.setupShifts} onChange={v=>set({...s,setupShifts:v})} width={60}/></Row>
    <Row label="Testing Shifts"><Inp value={s.testShifts} onChange={v=>set({...s,testShifts:v})} width={60}/></Row>
    <HR/>
    <div style={{fontSize:12,color:C.redDim,fontWeight:600}}>
      {"DCM Total: "}{money(total)}
    </div>
    <Pia s={s} set={set}/>
    <ProcReport s={s} set={set} procPrice={1950} reportPrice={1500} sectionCode="23"/>
  </div>;
}

function HfvForm({s,set,setup}){
  const pm=s.pia||1;
  const fab=setup?Math.round(sf(setup.fabHours)*sf(setup.techRate,175)):0;
  const std=sf(s.stdSetup||s.setup||500);
  const addl=sf(s.addlCosts,0);
  const setupTotal=std+fab+addl;
  const autoTesting=hfvTestingPrice(s.dur||30);
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="Duration/Axis (min)"><Inp value={s.dur} onChange={v=>set({...s,dur:v,testing:String(hfvTestingPrice(v))})} width={60}/>
      <span style={{fontSize:10,color:C.dim,marginLeft:6}}>→ ${autoTesting.toLocaleString()}</span>
    </Row>
    <Pia s={s} set={set}/>
    <HR/>
    <PRow label="Std Setup" val={s.stdSetup||s.setup||"500"} onChange={v=>set({...s,stdSetup:v})}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label="Testing (auto)" val={s.testing} onChange={v=>set({...s,testing:v})}/>
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      <span style={{color:C.dim,fontSize:9}}>{" = $"+std.toLocaleString()+(fab>0?" + $"+fab.toLocaleString()+" fab":""+(addl>0?" + $"+addl.toLocaleString()+" addl":""))+(pm>1?" x "+pm+" PIA":"")}</span>
    </div>
    <ProcReport s={s} set={set} sectionCode="52"/>
  </div>;
}

function CopyEmailButton({qi,ti,emis,pqs,dcms,showToast}){
  const firstName=(qi.contact||"").trim().split(/\s+/)[0]||"";
  const hasSpecialTest=emis.some(s=>s.on)||pqs.some(s=>s.on)||dcms.some(s=>s.on);
  const emailBody=
    "Dear "+(firstName||qi.contact||"[Contact]")+",\n\n"+
    "Please see the attached quotation "+(qi.opp||"[Quote #]")+
    " for testing the "+(ti.item||"[Item]")+
    ". If you have any questions, don't hesitate to reach out.\n\n"+
    (hasSpecialTest?"Additional attachments have been included with further testing descriptions.\n\n":"")+
    "Also attached is our Terms and Conditions page for your signature and return with your purchase order.\n\n"+
    "Thank you,";
  return(
    <button onClick={()=>{navigator.clipboard.writeText(emailBody);showToast("✉️ Email copied to clipboard","success",3000);}}
      style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
        borderRadius:5,padding:"3px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
      📋 Copy Email
    </button>
  );
}

function ShoForm({s,set,setup}){
  const pm=s.pia||1;
  const fab=setup?Math.round(sf(setup.fabHours)*sf(setup.techRate,175)):0;
  const std=sf(s.stdSetup||s.setup||500);
  const addl=sf(s.addlCosts,0);
  const hfvOn=false; // HFV discount handled in calcSummary
  const setupTotal=std+fab+addl;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <Row label="Pulse Shape">
      <Sel value={s.shape} onChange={v=>set({...s,shape:v})}
        options={["Half Sine","Sawtooth","Bench Handling","Drop Shock"]} width={160}/>
    </Row>
    <Row label="G Level"><Inp value={s.gLevel||""} onChange={v=>set({...s,gLevel:v})} width={70}/></Row>
    <Row label="Pulse Duration (ms)"><Inp value={s.pDur||""} onChange={v=>set({...s,pDur:v})} width={70}/></Row>
    <Row label="# Pulses"><Inp value={s.nPulses||""} onChange={v=>set({...s,nPulses:v})} width={60}/></Row>
    <Pia s={s} set={set}/>
    <HR/>
    <PRow label="Std Setup" val={s.stdSetup||s.setup||"500"} onChange={v=>set({...s,stdSetup:v})}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label="Testing" val={s.testing} onChange={v=>set({...s,testing:v})}/>
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      <span style={{color:C.dim,fontSize:9}}>{" = $"+std.toLocaleString()+(fab>0?" + $"+fab.toLocaleString()+" fab":"")+(addl>0?" + $"+addl.toLocaleString()+" addl":"")+(pm>1?" x "+pm+" PIA":"")}</span>
      {fab===0&&<span style={{color:C.dim,fontSize:9}}>{" (25% disc if HFV active)"}</span>}
    </div>
    <ProcReport s={s} set={set} sectionCode="51"/>
  </div>;
}

function InstForm({s,set}){
  const ITEMS=[
    {key:"shock",label:"Shock Instrumentation",price:525,ch:true},
    {key:"cmShock",label:"Contact Monitoring (Shock)",price:350,ch:true},
    {key:"vib",label:"Vib Addl Channels",price:325,ch:true},
    {key:"cmVib",label:"Contact Monitoring (Vibe)",price:750,ch:true},
    {key:"hsv",label:"High Speed Video",price:1950,ch:false},
  ];
  return <div>
    {ITEMS.map(item=>{
      const on=s.items?.[item.key]?.on||false;
      const channels=s.items?.[item.key]?.channels??"1";
      return(
        <div key={item.key} style={{background:on?"#fdf3f2":C.panel,
          border:"1px solid "+(on?C.red+"44":C.border),borderRadius:7,padding:"8px 10px",marginBottom:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Toggle small checked={on}
              onChange={v=>set({...s,items:{...s.items,[item.key]:v?{on:true,channels:"1"}:{on:false,channels:"1"}}})}
              label={item.label+" — "+money(item.price)+(item.ch?"/ch":"")}/>
            {on&&item.ch&&(
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:11,color:C.muted}}>Ch:</span>
                <Inp value={channels}
                  onChange={v=>set({...s,items:{...s.items,[item.key]:{...s.items?.[item.key],channels:v}}})}
                  width={45}/>
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>;
}

function CustomForm({s,set}){
  const PCODE_OPTS=[
    {code:"11",label:"Noise"},{code:"12",label:"AB/SB Noise"},
    {code:"32",label:"High Speed Video"},{code:"33",label:"Instrumentation"},
    {code:"41",label:"Report/CoC"},{code:"42",label:"Procedure"},
    {code:"43",label:"EMI Report"},{code:"43",label:"DC Mag Report"},{code:"43",label:"PQ Report"},
    {code:"44",label:"EMI Procedure"},{code:"44",label:"DC Mag Procedure"},{code:"44",label:"PQ Procedure"},
    {code:"51",label:"EMI"},{code:"51",label:"Power Quality"},{code:"51",label:"DC Magnetics"},{code:"52",label:"HFV/Shock Other"},
    {code:"53",label:"T&H"},{code:"54",label:"ESS"},{code:"55",label:"Salt Fog"},
    {code:"56",label:"Altitude"},{code:"57",label:"Acceleration"},{code:"58",label:"Drip/Sub/Spray"},
    {code:"59",label:"Insulation Resistance"},
    {code:"91",label:"MW Shock"},{code:"92",label:"LW Shock"},{code:"93",label:"Inclination"},
    {code:"94",label:"Vibration"},{code:"95",label:"Hydrostatic"},{code:"96",label:"Tear Down"},
    {code:"98",label:"Subcontract"},
  ];
  const add=()=>set({...s,rows:[...s.rows,{label:"Custom Item",price:"0",pcode:"94"}]});
  const rem=i=>set({...s,rows:s.rows.filter((_,j)=>j!==i)});
  const upd=(i,k,v)=>set({...s,rows:s.rows.map((r,j)=>j===i?{...r,[k]:v}:r)});
  return <div>
    {s.rows.map((r,i)=>(
      <div key={i} style={{background:C.panel,borderRadius:7,padding:"7px 10px",marginBottom:6}}>
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
          <select value={r.pcode||"94"} onChange={e=>upd(i,"pcode",e.target.value)}
            style={{...sel,fontSize:10,padding:"2px 5px",width:160}}>
            {PCODE_OPTS.map(p=><option key={p.code} value={p.code}>{p.code} – {p.label}</option>)}
          </select>
          <Inp value={r.label} onChange={v=>upd(i,"label",v)} width={170}/>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.muted}}>$</span>
          <Inp value={r.price} onChange={v=>upd(i,"price",v)} width={90} right/>
          <button onClick={()=>rem(i)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:14}}>✕</button>
        </div>
      </div>
    ))}
    <button onClick={add}
      style={{background:"none",border:"1px dashed "+C.border,borderRadius:7,
        color:C.muted,padding:"7px 14px",cursor:"pointer",fontSize:12,width:"100%"}}>
      + Add Custom Line Item
    </button>
  </div>;
}

function AbForm({s,set,setup}){
  const dr=setup?Math.round(sf(setup.holes)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1)):0;
  const fab=setup?Math.round(sf(setup.fabHours)*sf(setup.techRate,175)):0;
  const std=sf(s.stdSetup||s.setup||1000);
  const addl=sf(s.addlCosts,0);
  const setupTotal=std+dr+fab+addl;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <HR/>
    <PRow label="Std Setup" val={s.stdSetup||s.setup||"1000"} onChange={v=>set({...s,stdSetup:v})}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label="Testing" val={s.testing} onChange={v=>set({...s,testing:v})}/>
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      <span style={{color:C.dim,fontSize:9}}>{" = $"+std.toLocaleString()+(dr>0?" + $"+dr.toLocaleString()+" drill":"")+(fab>0?" + $"+fab.toLocaleString()+" fab":"")+(addl>0?" + $"+addl.toLocaleString()+" addl":"")}</span>
    </div>
    <ProcReport s={s} set={set} sectionCode="12"/>
  </div>;
}

function SbForm({s,set,setup}){
  const dr=setup?Math.round(sf(setup.holes)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1)):0;
  const fab=setup?Math.round(sf(setup.fabHours)*sf(setup.techRate,175)):0;
  const std=sf(s.stdSetup||s.setup||850);
  const addl=sf(s.addlCosts,0);
  const setupTotal=std+dr+fab+addl;
  return <div>
    <Row label="Spec"><Inp value={s.spec||""} onChange={v=>set({...s,spec:v})} width={200}/></Row>
    <HR/>
    <PRow label="Std Setup" val={s.stdSetup||s.setup||"850"} onChange={v=>set({...s,stdSetup:v})}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
      <input type="checkbox" checked={s.showSetup!==false}
        onChange={e=>set({...s,showSetup:e.target.checked})}
        style={{cursor:"pointer"}}/>
      <label style={{fontSize:11,color:C.dim,cursor:"pointer"}}>Include Setup Line</label>
    </div>
    <PRow label="Add'l Costs" val={s.addlCosts||"0"} onChange={v=>set({...s,addlCosts:v})}/>
    <PRow label="Testing" val={s.testing} onChange={v=>set({...s,testing:v})}/>
    <div style={{fontSize:10,background:C.panel,borderRadius:5,padding:"5px 8px",marginBottom:6}}>
      <span style={{color:C.dim}}>Setup: </span>
      <span style={{color:C.text,fontWeight:600}}>{money(setupTotal)}</span>
      <span style={{color:C.dim,fontSize:9}}>{" = $"+std.toLocaleString()+(dr>0?" + $"+dr.toLocaleString()+" drill":"")+(fab>0?" + $"+fab.toLocaleString()+" fab":"")+(addl>0?" + $"+addl.toLocaleString()+" addl":"")}</span>
    </div>
    <ProcReport s={s} set={set} sectionCode="12"/>
  </div>;
}

function BudgetSection({budget,setBudget}){
  const add=()=>setBudget({...budget,rows:[...budget.rows,{desc:"",qty:"1",unitCost:"0"}]});
  const rem=i=>setBudget({...budget,rows:budget.rows.filter((_,j)=>j!==i)});
  const upd=(i,k,v)=>setBudget({...budget,rows:budget.rows.map((r,j)=>j===i?{...r,[k]:v}:r)});
  const mp=sf(budget.markup,25)/100;
  const total=budget.rows.reduce((s,r)=>s+sf(r.qty,1)*sf(r.unitCost,0),0);

  if(!budget.on) return(
    <div style={{marginBottom:10}}>
      <Toggle small checked={false} onChange={v=>setBudget({...budget,on:v})} label="Budget Materials"/>
    </div>
  );
  return(
    <div style={{...card}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <Toggle small checked={budget.on} onChange={v=>setBudget({...budget,on:v})} label="BUDGET MATERIALS"/>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11,color:C.muted}}>Markup %</span>
          <Inp value={budget.markup} onChange={v=>setBudget({...budget,markup:v})} width={50} right/>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 55px 75px 75px 22px",gap:4,marginBottom:4}}>
        {["Description","Qty","Unit Cost","Marked Up",""].map((h,i)=>(
          <div key={i} style={{fontSize:9,color:C.dim,padding:"0 4px"}}>{h}</div>
        ))}
      </div>
      {budget.rows.map((r,i)=>(
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 55px 75px 75px 22px",gap:4,marginBottom:4,alignItems:"center"}}>
          <Inp value={r.desc} onChange={v=>upd(i,"desc",v)} width="100%"/>
          <Inp value={r.qty} onChange={v=>upd(i,"qty",v)} width={55} right/>
          <Inp value={r.unitCost} onChange={v=>upd(i,"unitCost",v)} width={75} right/>
          <div style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:4}}>
            {"$"}{Math.round(sf(r.qty,1)*sf(r.unitCost,0)*(1+mp)).toLocaleString()}
          </div>
          <button onClick={()=>rem(i)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:0}}>✕</button>
        </div>
      ))}
      <button onClick={add}
        style={{background:"none",border:"1px dashed "+C.border,borderRadius:7,
          color:C.muted,padding:"5px 12px",cursor:"pointer",fontSize:11,width:"100%",marginTop:4}}>
        + Add Item
      </button>
      {total>0&&(
        <div style={{marginTop:8,fontSize:12,color:C.redDim,fontWeight:600,textAlign:"right"}}>
          {"Hard: $"}{Math.round(total).toLocaleString()}{" · Marked up: $"}{Math.round(total*(1+mp)).toLocaleString()}
        </div>
      )}
      {/* Internal notes — budget PDF only */}
      <div style={{marginTop:12,borderTop:"1px solid "+C.border,paddingTop:10}}>
        <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:3}}>INTERNAL NOTES</div>
        <div style={{fontSize:9,color:C.dim,marginBottom:4}}>For internal use only. Appears on budget PDF, not the quote.</div>
        <textarea
          value={budget.notes||""}
          onChange={e=>setBudget({...budget,notes:e.target.value})}
          placeholder="Add internal notes for this budget (vendor info, lead times, sourcing, etc.)..."
          rows={3}
          style={{...inp,width:"100%",resize:"vertical",fontSize:11,lineHeight:1.6}}/>
      </div>
    </div>
  );
}

// ── Quote Search panel ─────────────────────────────────────────────────────────
import { supabase } from "./supabaseClient";
import { getAccessToken } from "./getAccessToken";

// ── Direct-PostgREST bypass ────────────────────────────────────────────────────
// supabase-js 2.x wedges getSession() and query operations on a healthy session,
// upstream of fetch (confirmed across versions 2.58 and 2.100). A direct fetch to
// PostgREST returns instantly during the hang. For the operations that hang —
// quote save, rev-check, load, dashboard queries, reminders — we route around the
// library using restFetch + a token read straight from the cookie (getAccessToken).
// Auth/session detection stays on supabase-js; only the hot-path data ops bypass it.
const REST_BASE = "https://swuuxzmgmldvvomsgmjf.supabase.co/rest/v1";
const REST_APIKEY = "sb_publishable_bmrPY65INpUkea8VUX1Wag_T7Vrz9ZZ";
const REST_TIMEOUT_MS = 15000;

// Sentinel so callers can distinguish "no valid session" from other failures.
class NoSessionError extends Error {
  constructor() { super("NO_SESSION: getAccessToken returned null (expired or missing)"); this.name = "NoSessionError"; this.isNoSession = true; }
}

// Thin direct-PostgREST fetch. method: GET/POST/PATCH/DELETE. path: e.g.
// "quotes?id=eq.123&select=id". body: object for writes. Returns parsed JSON
// (array for selects, array/obj for writes per Prefer). Throws on non-2xx,
// on timeout (AbortController), or NoSessionError when there's no valid token.
async function restFetch(method, path, { body, returnRepresentation = false, upsert = false } = {}) {
  const token = getAccessToken();
  if (!token) throw new NoSessionError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);

  const headers = {
    "apikey": REST_APIKEY,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // Combine Prefer headers when both are set. PostgREST accepts comma-separated values.
  const prefer = [];
  if (returnRepresentation) prefer.push("return=representation");
  if (upsert) prefer.push("resolution=merge-duplicates");
  if (prefer.length) headers["Prefer"] = prefer.join(",");

  try {
    const res = await fetch(`${REST_BASE}/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) {
      // Token rejected — treat like an expired session.
      throw new NoSessionError();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`REST ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    // 204 No Content (some writes/deletes) → no body
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return null;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error(`REST ${method} ${path} timed out after ${REST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

// Invoke a Workspace/Supabase edge function via direct fetch, mirroring
// restFetch's session-token bypass pattern. Hits the same project's
// /functions/v1/ endpoint with the authenticated user's token + the project
// apikey, so the function sees the actual signed-in user and can do
// permission checks. Returns parsed JSON response. Best-effort: throws
// on errors but the caller (notifications) typically swallows them so a
// failed email doesn't break the user-visible action.
const FN_BASE = "https://swuuxzmgmldvvomsgmjf.supabase.co/functions/v1";

// PostgREST RPC bypass — same wedge avoidance pattern as restFetch for table
// queries, applied to RPC calls. Posts to /rest/v1/rpc/<fn> with args in body.
// Response body IS the function's return value (not wrapped). Throws on error.
async function rpcCall(fnName, args = {}) {
  const token = getAccessToken();
  if (!token) throw new NoSessionError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${REST_BASE}/rpc/${fnName}`, {
      method: "POST",
      headers: {
        "apikey": REST_APIKEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "(no body)");
      throw new Error(`RPC ${fnName} failed: ${res.status} ${errBody.slice(0,300)}`);
    }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  } catch (e) {
    if (e?.name === "AbortError") {
      console.warn(`[RPC ${fnName}] timed out after ${REST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function invokeFunction(fnName, body) {
  const token = getAccessToken();
  if (!token) throw new NoSessionError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${FN_BASE}/${fnName}`, {
      method: "POST",
      headers: {
        "apikey": REST_APIKEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) throw new NoSessionError();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FN ${fnName} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return null;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error(`FN ${fnName} timed out after ${REST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}


// ── Supabase storage helpers ──────────────────────────────────────────────────
// ── PDF Save-As helper ───────────────────────────────────────────────────────
async function savePdfAs(doc, suggestedName) {
  const blob = doc.output('blob');
  // Try modern File System Access API (Chrome 86+) for native Save As dialog
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types:[{description:'PDF File',accept:{'application/pdf':['.pdf']}}],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }catch(e){
      if(e.name==='AbortError')return; // user cancelled
      // Fall through to legacy method
    }
  }
  // Legacy fallback — auto-download (same as before)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

async function saveQuoteToSupabase(quote, autoSpecs, autoNotes, opts) {
  const forceInsert = opts && opts.forceInsert;
  const row = {
    id: forceInsert ? undefined : (quote.id || undefined),
    opportunity:      quote.qi?.opp    || quote.opp    || null,
    customer:         quote.qi?.account|| quote.customer|| null,
    rfq:              quote.qi?.rfq    || quote.rfq    || null,
    revision:         quote.qi?.rev    || null,
    stage:            quote.qi?.stage  || quote.stage  || null,
    total:            quote.total      || null,
    job_number:       quote.wonInfo?.jobNum  || null,
    po_number:        quote.wonInfo?.poNum   || null,
    won_date:         (()=>{const d=quote.wonInfo?.wonDate;if(!d)return null;const p=new Date(d);return isNaN(p)?null:p.toISOString().slice(0,10);})(),
    approval_status:  quote.approval?.status || "none",
    won_approval_status: quote.wonApproval?.status || "none",
    submitted_by:     quote.approval?.submittedBy || null,
    approved_by:      quote.approval?.decidedBy   || null,
    specifications:   combineSpecs(quote.ti?.tiSpecs, autoSpecs) || null,
    notes:            combineSpecs(quote.ti?.tiNotes, autoNotes) || null,
    line_items:       (quote.summary?.lines||[]).map((line,i)=>{
      const ov=(quote.lineOverrides||{})[i]||{};
      if(ov.deleted)return null; // exclude deleted lines
      return {...line, val: ov.price!==undefined ? parseFloat(ov.price)||0 : line.val};
    }).filter(Boolean) || null,
    budget_items:     quote.budget?.rows   || null,
    budget_markup:    quote.budget?.markup ? parseFloat(quote.budget.markup) : null,
    budget_notes:     quote.budget?.notes  || null,
    workspace_project_id: quote.workspace_project_id || null,
    data:             quote,
    search_text:      [
      quote.qi?.opp    || quote.opp    || "",
      quote.qi?.account|| quote.customer|| "",
      quote.qi?.rfq    || quote.rfq    || "",
      quote.qi?.rev    || "",
      quote.qi?.contact|| "",
      quote.qi?.email  || "",
      quote.qi?.prepby || "",
      quote.qi?.stage  || quote.stage  || "",
      quote.qi?.relatedOpps || "",
      quote.wonInfo?.jobNum  || "",
      quote.wonInfo?.poNum   || "",
      quote.ti?.item   || "",
      quote.ti?.model  || "",
      quote.ti?.drawing|| "",
      combineSpecs(quote.ti?.tiSpecs, autoSpecs) || "",
      combineSpecs(quote.ti?.tiNotes, autoNotes) || "",
      (quote.summary?.lines||[]).map(l=>l.label||"").join(" "),
    ].filter(Boolean).join(" ").toLowerCase(),
  };

  // ── BYPASS: write directly to PostgREST (supabase-js wedges on save) ───────
  // Routes around the library entirely. getAccessToken reads the workspace-
  // refreshed token from the cookie; restFetch does the direct write with its
  // own 15s AbortController timeout. No getSession(), no query builder.
  try {
    if (row.id) {
      const { id, ...updateRow } = row;
      const result = await restFetch("PATCH", `quotes?id=eq.${encodeURIComponent(id)}&select=id`, {
        body: updateRow,
        returnRepresentation: true,
      });
      const saved = Array.isArray(result) ? result[0] : result;
      return saved?.id || id;
    } else {
      const result = await restFetch("POST", `quotes?select=id`, {
        body: row,
        returnRepresentation: true,
      });
      const saved = Array.isArray(result) ? result[0] : result;
      return saved?.id || null;
    }
  } catch (err) {
    if (err && err.isNoSession) {
      console.warn("[SAVE] no valid session — bouncing for re-auth");
      // Surface as a failed save; the session is expired and needs re-auth.
      // (supabaseClient's authAwareFetch handles the actual bounce on 401s
      // from other supabase-js calls; here we just fail the save visibly.)
      return null;
    }
    console.error("Save failed (REST bypass):", err);
    return null;
  }
}

// DEPRECATED — caused statement timeouts on growing databases (full 2-year scan with `data` blob).
// All callers were replaced with loadPendingQuotes(). Kept here in case something we missed depends on it.
// Safe to delete after confirming the app works without it for a session or two.
async function loadQuotesFromSupabase() {
  // Load recent quotes (last 2 years) for approval queue badge — search handles full history
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  let allData = [];
  let from = 0;
  const batchSize = 1000;
  while(true){
    let data = null;
    try {
      data = await restFetch("GET",
        `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data&updated_at=gte.${encodeURIComponent(cutoff.toISOString())}&order=updated_at.desc&limit=${batchSize}&offset=${from}`);
    } catch(e) {
      console.error("[LOAD-ALL-QUOTES] failed:", e?.message||e);
      break;
    }
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const map = {};
  allData.forEach(row => {
    const q = row.data || {};
    map[row.id] = {
      ...q,
      id:          row.id,
      opp:         row.opportunity || q.opp,
      customer:    row.customer    || q.customer,
      rfq:         row.rfq         || q.rfq,
      total:       row.total       ?? q.total,
      savedAt:     row.updated_at,
      approval:    { ...(q.approval||{}), status: row.approval_status || q.approval?.status || "none" },
      wonApproval: { ...(q.wonApproval||{}), status: row.won_approval_status || q.wonApproval?.status || "none" },
    };
  });
  return map;
}

async function loadPendingQuotes() {
  // Bypass conversion: was three sequential supabase-js queries; same shape now
  // via restFetch. Runs on app mount AND on every realtime row change, so
  // a wedge here used to leave the approval queue widget in loading state
  // indefinitely. The two metadata queries run in parallel; the blob fetch
  // runs after we know the IDs.
  const metaCols = "id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at";
  let data = [], wonData = [];
  try {
    [data, wonData] = await Promise.all([
      restFetch("GET", `quotes?select=${metaCols}&approval_status=eq.pending&order=updated_at.desc&limit=50`),
      restFetch("GET", `quotes?select=${metaCols}&won_approval_status=eq.pending_won&order=updated_at.desc&limit=50`),
    ]);
    data = data || [];
    wonData = wonData || [];
  } catch (e) {
    console.error("[PENDING] metadata load failed:", e?.message || e);
    return {};
  }

  // Now fetch the data blobs only for the actual pending IDs
  const pendingIds = [...data, ...wonData].map(r => r.id);
  let blobMap = {};
  if (pendingIds.length > 0) {
    try {
      const idList = pendingIds.map(id => encodeURIComponent(id)).join(",");
      const blobs = await restFetch("GET", `quotes?select=id,data&id=in.(${idList})`);
      (blobs || []).forEach(b => { blobMap[b.id] = b.data || {}; });
    } catch (e) {
      console.warn("[PENDING] blob load failed (proceeding without blobs):", e?.message || e);
      // Proceed with metadata-only — queue still shows rows, just without full quote data.
    }
  }

  // Merge metadata rows to look like the old shape
  const mergeBlob = row => ({ ...row, data: blobMap[row.id] || {} });
  const mergedData    = data.map(mergeBlob);
  const mergedWonData = wonData.map(mergeBlob);

  const map = {};
  [...mergedData, ...mergedWonData].forEach(row => {
    const q = row.data || {};
    map[row.id] = {
      ...q,
      id:          row.id,
      opp:         row.opportunity || q.opp,
      customer:    row.customer    || q.customer,
      rfq:         row.rfq         || q.rfq,
      total:       row.total       ?? q.total,
      savedAt:     row.updated_at,
      approval:    { ...(q.approval||{}), status: row.approval_status || q.approval?.status || "none" },
      wonApproval: { ...(q.wonApproval||{}), status: row.won_approval_status || q.wonApproval?.status || "none" },
    };
  });
  return map;
}

async function deleteQuoteFromSupabase(id) {
  try {
    await restFetch("DELETE", `quotes?id=eq.${encodeURIComponent(id)}`);
  } catch(e) {
    console.error("[QUOTE-DELETE] failed:", e?.message||e);
    throw e; // let caller decide how to react
  }
}

// ── Client / Contact picker ───────────────────────────────────────────────────
function ClientContactPicker({qi, setQi, resetKey, onAccountEdited}){
  const [clientSearch, setClientSearch]     = useState(qi.account||"");
  const [clientResults, setClientResults]   = useState([]);
  const [clientOpen, setClientOpen]         = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [contacts, setContacts]             = useState([]);
  const [contactOpen, setContactOpen]       = useState(false);
  const [customContact, setCustomContact]   = useState(false);
  const clientRef  = useRef(null);
  const contactRef = useRef(null);
  const clientTimer = useRef(null);
  const externalUpdate = useRef(false);

  // When resetKey changes (quote loaded), sync everything from qi
  useEffect(()=>{
    setClientSearch(qi.account||"");
    setSelectedClient(null);
    setContacts([]);
    setCustomContact(false);
  },[resetKey]);

  useEffect(()=>{
    clearTimeout(clientTimer.current);
    if(!clientSearch.trim()){setClientResults([]);return;}
    clientTimer.current=setTimeout(async()=>{
      const term=clientSearch.trim();
      try {
        const data = await restFetch("GET",
          `clients?select=id,name,address,city,state,zip&name=ilike.${encodeURIComponent("*"+term+"*")}&order=name&limit=30`);
        setClientResults(data||[]);
      } catch(e) {
        console.warn("[CLIENT-SEARCH] failed:", e?.message||e);
        setClientResults([]);
      }
    },250);
    return()=>clearTimeout(clientTimer.current);
  },[clientSearch]);

  useEffect(()=>{
    if(!selectedClient){setContacts([]);return;}
    (async()=>{
      try {
        const data = await restFetch("GET",
          `contacts?select=id,first_name,last_name,email&client_id=eq.${encodeURIComponent(selectedClient.id)}&order=last_name`);
        setContacts(data||[]);
      } catch(e) {
        console.warn("[CONTACTS-LOAD] failed:", e?.message||e);
        setContacts([]);
      }
    })();
  },[selectedClient]);

  useEffect(()=>{
    const h=e=>{
      if(clientRef.current&&!clientRef.current.contains(e.target))setClientOpen(false);
      if(contactRef.current&&!contactRef.current.contains(e.target))setContactOpen(false);
    };
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  const selectClient=(c)=>{
    setSelectedClient(c);
    setClientSearch(c.name);
    const billTo=c.address||"";
    const billToCity=[c.city,c.state,c.zip].filter(Boolean).join(", ");
    setQi(q=>({...q, account:c.name, contact:"", email:"", billTo, billToCity, clientId:c.id}));
    setClientOpen(false);
    setClientResults([]);
    setCustomContact(false);
  };

  const selectContact=(ct)=>{
    const name=((ct.first_name||"")+" "+(ct.last_name||"")).trim();
    setQi(q=>({...q, contact:name, email:ct.email||""}));
    setContactOpen(false);
    setCustomContact(false);
  };

  const ddStyle={position:"absolute",top:"100%",left:0,right:0,zIndex:2000,
    background:"#fff",border:"1px solid "+C.border,borderRadius:7,
    boxShadow:"0 4px 16px rgba(0,0,0,0.12)",maxHeight:200,overflowY:"auto",marginTop:2};
  const itemBase={padding:"8px 12px",cursor:"pointer",fontSize:12,
    borderBottom:"1px solid #f0f2f5",transition:"background .1s"};
  const hasContacts=contacts.length>0;

  return(
    <div>
      <div style={{marginBottom:6,position:"relative"}} ref={clientRef}>
        <div style={{fontSize:9,color:C.dim,marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
          <span>Account</span>
          {(selectedClient||qi.clientId)
            ? <span style={{color:"#15803d",fontWeight:700}}>✓ linked</span>
            : (clientSearch.trim()?<span style={{color:"#b7791f",fontWeight:700}}>not linked</span>:null)}
        </div>
        <input
          value={clientSearch}
          onChange={e=>{
            setClientSearch(e.target.value);
            setQi(q=>({...q,account:e.target.value,clientId:null}));
            setSelectedClient(null);
            setContacts([]);
            setClientOpen(true);
            onAccountEdited&&onAccountEdited();
          }}
          onFocus={()=>setClientOpen(true)}
          placeholder="Type to search clients..."
          style={{...inp,width:"100%"}}/>
        {clientOpen&&!!clientSearch.trim()&&(()=>{
          const exact=clientResults.some(c=>(c.name||"").trim().toLowerCase()===clientSearch.trim().toLowerCase());
          return(
          <div style={ddStyle}>
            {clientResults.map(c=>(
              <div key={c.id}
                onMouseDown={()=>selectClient(c)}
                style={itemBase}
                onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {c.name}
              </div>
            ))}
            {!exact&&(
              <div
                onMouseDown={()=>{window.open(WORKSPACE_CLIENTS_URL+"?name="+encodeURIComponent(clientSearch.trim()),"_blank","noopener");setClientOpen(false);}}
                style={{...itemBase,display:"flex",alignItems:"center",gap:8,background:"#f5f9ff",color:C.accent,fontWeight:600}}
                onMouseEnter={e=>e.currentTarget.style.background="#e9f2ff"}
                onMouseLeave={e=>e.currentTarget.style.background="#f5f9ff"}>
                <span>＋ Create "{clientSearch.trim()}" in Workspace ↗</span>
                <span style={{marginLeft:"auto",fontSize:9,color:C.dim,fontWeight:400}}>opens new tab</span>
              </div>
            )}
            {clientResults.length===0&&(
              <div style={{padding:"6px 12px",fontSize:9,color:C.dim,fontStyle:"italic"}}>
                No matching clients. Create it in Workspace, then re-search to link it.
              </div>
            )}
          </div>
          );
        })()}
      </div>

      <div style={{marginBottom:6,position:"relative"}} ref={contactRef}>
        <div style={{fontSize:9,color:C.dim,marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
          <span>Contact</span>
          {hasContacts&&!customContact&&(
            <span style={{color:C.accent,fontSize:9,cursor:"pointer",fontWeight:600}}
              onClick={()=>{setCustomContact(true);setContactOpen(false);}}>
              + custom
            </span>
          )}
          {customContact&&(
            <span style={{color:C.muted,fontSize:9,cursor:"pointer"}}
              onClick={()=>setCustomContact(false)}>
              back to list
            </span>
          )}
        </div>
        {hasContacts&&!customContact?(
          <div style={{position:"relative"}}>
            <div
              onClick={()=>setContactOpen(o=>!o)}
              style={{...inp,width:"100%",cursor:"pointer",display:"flex",alignItems:"center",
                justifyContent:"space-between",userSelect:"none",
                color:qi.contact?C.text:C.dim}}>
              <span>{qi.contact||"Select a contact..."}</span>
              <span style={{fontSize:9,color:C.dim}}>▼</span>
            </div>
            {contactOpen&&(
              <div style={ddStyle}>
                {contacts.map(ct=>{
                  const name=((ct.first_name||"")+" "+(ct.last_name||"")).trim();
                  return(
                    <div key={ct.id}
                      onMouseDown={()=>selectContact(ct)}
                      style={itemBase}
                      onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{fontWeight:600}}>{name||"(no name)"}</div>
                      {ct.email&&<div style={{fontSize:10,color:C.muted}}>{ct.email}</div>}
                    </div>
                  );
                })}
                <div
                  onMouseDown={()=>{setCustomContact(true);setContactOpen(false);}}
                  style={{...itemBase,color:C.accent,fontWeight:600}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  + Enter custom contact
                </div>
              </div>
            )}
          </div>
        ):(
          <input
            value={qi.contact||""}
            onChange={e=>setQi(q=>({...q,contact:e.target.value}))}
            placeholder="Contact name"
            style={{...inp,width:"100%"}}/>
        )}
      </div>

      <div style={{marginBottom:6}}>
        <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Email</div>
        <input
          value={qi.email||""}
          onChange={e=>setQi(q=>({...q,email:e.target.value}))}
          placeholder="Email address"
          style={{...inp,width:"100%"}}/>
      </div>
    </div>
  );
}

function RelatedContactsField({qi, setQi}){
  // qi.relatedContacts is an array of {name, email, contactId?}
  const rcs = Array.isArray(qi.relatedContacts) ? qi.relatedContacts : [];
  // Ensure there's always at least one input row visible
  const displayRows = rcs.length > 0 ? rcs : [{name:"", email:"", contactId:null}];
  const MAX = 10;

  const setRow = (idx, updates) => {
    const next = [...displayRows];
    next[idx] = {...next[idx], ...updates};
    // Persist; if the array is the placeholder single empty row, only save once user types
    setQi(q => ({...q, relatedContacts: next}));
  };
  const removeRow = (idx) => {
    const next = displayRows.filter((_, i) => i !== idx);
    setQi(q => ({...q, relatedContacts: next}));
  };
  const addRow = () => {
    if (displayRows.length >= MAX) return;
    const next = [...displayRows, {name:"", email:"", contactId:null}];
    setQi(q => ({...q, relatedContacts: next}));
  };

  return(
    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid "+C.border}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
        <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:1.5}}>RELATED CONTACTS</div>
        <span style={{fontSize:9,color:C.muted}}>{displayRows.filter(r=>r.name||r.email).length} / {MAX}</span>
      </div>
      {displayRows.map((row, idx) => (
        <RelatedContactRow key={idx}
          row={row}
          existingIds={displayRows.filter((_,i)=>i!==idx).map(r=>r.contactId).filter(Boolean)}
          accountName={qi.account||""}
          onChange={updates => setRow(idx, updates)}
          onRemove={displayRows.length > 1 ? () => removeRow(idx) : null}/>
      ))}
      {displayRows.length < MAX && (
        <div onClick={addRow}
          style={{display:"inline-block",marginTop:4,fontSize:10,color:C.accent,cursor:"pointer",fontWeight:600}}>
          + Add Contact
        </div>
      )}
    </div>
  );
}

function RelatedContactRow({row, existingIds, accountName, onChange, onRemove}){
  const [search, setSearch] = useState(row.name || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hasPhone, setHasPhone] = useState(true);
  const wrapRef = useRef(null);
  const timer = useRef(null);

  // Keep input synced with external row changes (e.g. on row delete/clear)
  useEffect(() => { setSearch(row.name || ""); }, [row.name]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search
  useEffect(() => {
    clearTimeout(timer.current);
    const term = search.trim();
    if (!term) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const tokens = term.split(/\s+/).filter(Boolean);
      const firstToken = tokens[0];
      const select = hasPhone
        ? "id,first_name,last_name,email,phone,client_id,clients(name)"
        : "id,first_name,last_name,email,client_id,clients(name)";
      const orParam = `or=(first_name.ilike.*${encodeURIComponent(firstToken)}*,last_name.ilike.*${encodeURIComponent(firstToken)}*,email.ilike.*${encodeURIComponent(firstToken)}*)`;
      let data = null;
      try {
        data = await restFetch("GET",
          `contacts?select=${encodeURIComponent(select)}&${orParam}&order=last_name&limit=50`);
      } catch (e) {
        if (hasPhone && /phone/i.test(e?.message || "")) {
          setHasPhone(false);
          try {
            data = await restFetch("GET",
              `contacts?select=id,first_name,last_name,email,client_id,clients(name)&${orParam}&order=last_name&limit=50`);
          } catch (e2) {
            console.error("[CONTACT-SEARCH retry] failed:", e2?.message||e2);
            setResults([]);
            return;
          }
        } else {
          console.error("[CONTACT-SEARCH] failed:", e?.message||e);
          setResults([]);
          return;
        }
      }
      // Client-side multi-word filter
      const matches = (data || []).filter(c => {
        const hay = ((c.first_name||"")+" "+(c.last_name||"")+" "+(c.email||"")+" "+(c.clients?.name||"")).toLowerCase();
        return tokens.every(t => hay.includes(t.toLowerCase()));
      });
      // Exclude already-added contacts
      const excludeSet = new Set(existingIds);
      const filtered = matches.filter(c => !excludeSet.has(c.id));
      // Bias account contacts to top
      const acctLower = (accountName||"").toLowerCase().trim();
      filtered.sort((a, b) => {
        const aIs = (a.clients?.name||"").toLowerCase() === acctLower;
        const bIs = (b.clients?.name||"").toLowerCase() === acctLower;
        if (aIs !== bIs) return aIs ? -1 : 1;
        return (a.last_name||"").localeCompare(b.last_name||"");
      });
      setResults(filtered.slice(0, 20));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [search, accountName, hasPhone, existingIds.join(",")]);

  const pickContact = (ct) => {
    const name = ((ct.first_name||"")+" "+(ct.last_name||"")).trim();
    setSearch(name);
    setOpen(false);
    onChange({name, email: ct.email||"", contactId: ct.id});
  };

  return(
    <div ref={wrapRef} style={{position:"relative",marginBottom:5,display:"flex",gap:4,alignItems:"flex-start"}}>
      <input
        value={search}
        onChange={e => {
          setSearch(e.target.value);
          setOpen(true);
          // If user clears or edits past the saved name, clear the contactId binding
          if (row.contactId && e.target.value !== row.name) {
            onChange({name: e.target.value, email: "", contactId: null});
          } else {
            onChange({name: e.target.value});
          }
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search name or email…"
        style={{...inp,flex:1.3}}/>
      <input
        value={row.email||""}
        onChange={e => onChange({email: e.target.value})}
        placeholder="Email"
        style={{...inp,flex:1,fontSize:11}}/>
      {onRemove && (
        <button onClick={onRemove}
          title="Remove this contact"
          style={{background:"none",border:"1px solid "+C.border,borderRadius:5,
            color:C.muted,fontSize:14,cursor:"pointer",padding:"2px 8px",lineHeight:1}}>×</button>
      )}
      {open && search.trim() && results.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:2000,
          background:"#fff",border:"1px solid "+C.border,borderRadius:7,
          boxShadow:"0 4px 16px rgba(0,0,0,0.12)",maxHeight:240,overflowY:"auto",marginTop:2}}>
          {results.map(ct => {
            const name = ((ct.first_name||"")+" "+(ct.last_name||"")).trim();
            const company = ct.clients?.name||"";
            return(
              <div key={ct.id}
                onMouseDown={() => pickContact(ct)}
                style={{padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid #f0f2f5",fontSize:11}}
                onMouseEnter={e => e.currentTarget.style.background=C.panel}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                <div style={{fontWeight:600,color:C.text}}>{name||"(no name)"}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:1}}>
                  {company && <span>{company}</span>}
                  {company && ct.email && <span> · </span>}
                  {ct.email && <span>{ct.email}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuoteSearch({onLoad}){
  const [search,setSearch]=useState("");
  const [results,setResults]=useState([]);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [showModal,setShowModal]=useState(false);
  const [modalResults,setModalResults]=useState([]);
  const [modalLoading,setModalLoading]=useState(false);
  const ref=useRef(null);
  const searchTimer=useRef(null);
  const inputRef=useRef(null);

  const buildRow=(row)=>{
    const q=row.data||{};
    return{
      ...q,
      id:row.id,
      opp:row.opportunity||q.opp,
      rev:row.revision||q.qi?.rev||q.rev||"",
      customer:row.customer||q.customer,
      rfq:row.rfq||q.rfq,
      total:row.total??q.total,
      savedAt:row.updated_at,
      stage:row.stage||q.qi?.stage||"",
      item:q.ti?.item||"",
      approval:{...(q.approval||{}),status:row.approval_status||q.approval?.status||"none"},
    };
  };

  const doSearch=async(term,limit=50)=>{
    // Bypass conversion. Same shape as before — pulls metadata+blob, ordered by
    // opportunity desc. Wrapping the term in CSV-style quotes lets PostgREST's
    // or() filter handle commas and parens in the user's text.
    const selectCols = "id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data";
    let path = `quotes?select=${selectCols}&order=opportunity.desc&limit=${limit}`;
    if(term.trim()){
      const t = term.trim().toLowerCase();
      // Pattern: opportunity.ilike."*foo*" — quotes protect commas/parens in t.
      // Inner double-quotes don't need escaping inside ilike per PostgREST.
      const searchCols = ["opportunity","customer","rfq","revision","stage","search_text"];
      const orExpr = searchCols.map(c=>`${c}.ilike."*${t}*"`).join(",");
      path += `&or=(${encodeURIComponent(orExpr)})`;
    }
    try {
      const data = await restFetch("GET", path);
      return (data||[]).map(buildRow);
    } catch(e) {
      console.warn("[SEARCH] failed:", e?.message||e);
      return [];
    }
  };

  // Dropdown search (debounced, 50 results)
  useEffect(()=>{
    if(!open)return;
    clearTimeout(searchTimer.current);
    searchTimer.current=setTimeout(async()=>{
      setLoading(true);
      const r=await doSearch(search,50);
      setResults(r);
      setLoading(false);
    },300);
    return()=>clearTimeout(searchTimer.current);
  },[open,search]);

  // Close dropdown on outside click
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  // Enter key opens full modal
  const handleKeyDown=async(e)=>{
    if(e.key!=="Enter")return;
    e.preventDefault();
    setOpen(false);
    setShowModal(true);
    setModalLoading(true);
    // Fetch all matching results via paginated restFetch.
    // Same query shape as doSearch but with offset-based pagination.
    const selectCols = "id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data";
    let orPart = "";
    if(search.trim()){
      const t = search.trim().toLowerCase();
      const searchCols = ["opportunity","customer","rfq","revision","stage","search_text"];
      const orExpr = searchCols.map(c=>`${c}.ilike."*${t}*"`).join(",");
      orPart = `&or=(${encodeURIComponent(orExpr)})`;
    }
    let allResults=[], offset=0, batchSize=500;
    try {
      while(true){
        const path = `quotes?select=${selectCols}&order=opportunity.desc${orPart}&limit=${batchSize}&offset=${offset}`;
        const data = await restFetch("GET", path);
        if(!data || data.length===0) break;
        allResults = allResults.concat(data.map(buildRow));
        if(data.length < batchSize) break;
        offset += batchSize;
      }
    } catch(e) {
      console.warn("[SEARCH-ALL] failed:", e?.message||e);
    }
    setModalResults(allResults);
    setModalLoading(false);
  };

  const handleSelect=(q)=>{
    onLoad(q);
    setOpen(false);
    setShowModal(false);
    setSearch("");
  };

  const stageColor=(stage)=>{
    if(!stage)return C.dim;
    if(stage.includes("Won"))return"#1e8449";
    if(stage.includes("Lost")||stage.includes("Cancelled"))return"#c0392b";
    if(stage.includes("Pending")||stage.includes("RFQ"))return"#b7791f";
    return C.muted;
  };

  return(
    <>
    <div ref={ref} style={{position:"relative"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,background:C.card,
        border:"1px solid "+C.border,borderRadius:7,padding:"5px 10px",cursor:"text"}}
        onClick={()=>{setOpen(true);inputRef.current?.focus();}}>
        <span style={{fontSize:14,color:C.muted}}>🔍</span>
        <input ref={inputRef} value={search}
          onChange={e=>{setSearch(e.target.value);setOpen(true);}}
          onKeyDown={handleKeyDown}
          placeholder="Search quotes… (Enter for full results)"
          style={{border:"none",outline:"none",background:"transparent",color:C.text,fontSize:12,width:220}}/>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,width:360,
          background:C.card,border:"1px solid "+C.border,borderRadius:10,
          boxShadow:"0 4px 20px rgba(0,0,0,0.15)",zIndex:1000,maxHeight:380,overflow:"hidden",
          display:"flex",flexDirection:"column"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid "+C.border,
            fontSize:11,color:C.muted,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>{loading?"Searching…":results.length+" found"+(results.length===50?" · Press Enter for all":"")}</span>
            {!loading&&results.length===50&&(
              <button onClick={()=>inputRef.current?.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))}
                style={{background:"none",border:"none",color:C.accent,fontSize:10,cursor:"pointer",fontWeight:600,padding:0}}>
                Show all →
              </button>
            )}
          </div>
          <div style={{overflowY:"auto",flex:1}}>
            {!loading&&results.length===0&&(
              <div style={{padding:20,textAlign:"center",color:C.dim,fontSize:12}}>No quotes found</div>
            )}
            {results.map(q=>(
              <div key={q.id} onClick={()=>handleSelect(q)}
                style={{padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid "+C.border,transition:"background .1s"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.panel}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontWeight:600,fontSize:13,color:C.text,marginBottom:2}}>{q.opp||"Untitled"}</div>
                <div style={{fontSize:11,color:C.muted}}>{q.customer||""}</div>
                <div style={{fontSize:10,color:C.dim,marginTop:2}}>
                  {q.savedAt?new Date(q.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""}
                  {q.total?" · "+money(q.total):""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* ── Full Search Modal ── */}
    {showModal&&(
      <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.5)",
        display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:60}}
        onClick={e=>{if(e.target===e.currentTarget)setShowModal(false);}}>
        <div style={{background:"#fff",borderRadius:14,width:760,maxWidth:"95vw",maxHeight:"80vh",
          boxShadow:"0 8px 40px rgba(0,0,0,0.3)",display:"flex",flexDirection:"column"}}>

          {/* Header */}
          <div style={{padding:"16px 24px",borderBottom:"1px solid #e8ecf0",display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:18}}>🔍</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15,color:"#1a2332"}}>
                Search Results{search.trim()?` — "${search.trim()}"`:""}</div>
              <div style={{fontSize:11,color:"#6b7a8d",marginTop:2}}>
                {modalLoading?"Searching…":modalResults.length+" quote"+(modalResults.length!==1?"s":"")+" found"}
              </div>
            </div>
            <button onClick={()=>setShowModal(false)}
              style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7a8d"}}>×</button>
          </div>

          {/* Column headers */}
          <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 2fr 1.5fr 1fr",gap:8,
            padding:"8px 24px",background:"#f8f9fb",borderBottom:"1px solid #e8ecf0",
            fontSize:9,color:"#9aa5b1",fontWeight:700,letterSpacing:.8}}>
            <div>OPPORTUNITY</div><div>ACCOUNT</div><div>TEST ITEM</div><div>STAGE</div><div>MODIFIED</div>
          </div>

          {/* Results */}
          <div style={{flex:1,overflowY:"auto"}}>
            {modalLoading&&(
              <div style={{padding:40,textAlign:"center",color:"#6b7a8d",fontSize:13}}>Searching…</div>
            )}
            {!modalLoading&&modalResults.length===0&&(
              <div style={{padding:40,textAlign:"center",color:"#6b7a8d",fontSize:13}}>No quotes found</div>
            )}
            {!modalLoading&&modalResults.map(q=>(
              <div key={q.id}
                onClick={()=>handleSelect(q)}
                style={{display:"grid",gridTemplateColumns:"2fr 2fr 2fr 1.5fr 1fr",gap:8,
                  padding:"10px 24px",borderBottom:"1px solid #f0f2f5",cursor:"pointer",
                  transition:"background .1s"}}
                onMouseEnter={e=>e.currentTarget.style.background="#f8f9fb"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontWeight:600,fontSize:12,color:"#1a2332",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {q.opp||"—"}
                </div>
                <div style={{fontSize:11,color:"#6b7a8d",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {q.customer||"—"}
                </div>
                <div style={{fontSize:11,color:"#6b7a8d",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {q.item||"—"}
                </div>
                <div style={{fontSize:11,fontWeight:600,color:stageColor(q.stage),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {q.stage||"—"}
                </div>
                <div style={{fontSize:10,color:"#9aa5b1",whiteSpace:"nowrap"}}>
                  {q.savedAt?new Date(q.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ── Initial state factories ───────────────────────────────────────────────────
const newAb=()=>({id:Date.now(),on:false,showSetup:true,spec:"",rev:"1474",testing:"2850",stdSetup:"1000",addlCosts:"0",proc:false,report:false});
const newSb=()=>({id:Date.now(),on:false,showSetup:true,spec:"",rev:"167 Type II",testing:"2650",stdSetup:"850",addlCosts:"0",proc:false,report:false});
const newVib=()=>({id:Date.now(),on:false,showSetup:true,cat:"LAB Vibration (MIL-STD-167)",spec:"",freqRange:"",circ:false,hydroPre:false,hydroPost:false,hydroPrice:"500",pia:0,testing:"3250",stdSetup:"900",addlCosts:"0",proc:false,report:false,fixtureFab:{on:false,hours:"0",techRate:"175"}});
const newShock=()=>({id:Date.now(),on:false,showSetup:true,cat:"Medium Weight",spec:"",grade:"A",class_:"I",type_:"A",location:"Hull",submarine:false,orientation:"Unrestricted",blows:"",fromVib:false,hydroPre:false,hydroPost:false,hydroPrice:"500",pia:0,testing:"4575",stdSetup:"1500",addlCosts:"0",proc:false,report:false,fixtureFab:{on:false,hours:"0",techRate:"175"}});
const newNoise=()=>({id:Date.now(),on:false,showSetup:true,spec:"",level:"<=140dB",oaspl:"",chamber:"Speakerbox",durVal:"30",durUnit:"minutes",compBudget:"0",pia:0,testing:"3950",stdSetup:"1000",addlCosts:"0",proc:false,report:false});
const newEnv=()=>({id:Date.now(),on:false,showSetup:true,spec:"",items:{},thDur:"0 to 1 Day",thType:"Temperature & Humidity",proc:false,report:false});
const newEmi=()=>({id:Date.now(),on:false,spec:"",rate:"1600",addl:"0",setupShifts:"3.0",tdShifts:"1.0",dimL:"",dimW:"",dimH:"",weight:"",cables:"",rs103amp:"",plats:{},locs:{},revs:{},pia:0,tests:{},proc:false,report:false});
const newPq=()=>({id:Date.now(),on:false,rate:"1450",setupShifts:"1.5",tdShifts:"1.0",rows:{},pia:0,cw:false,proc:false,report:false});
const newDcm=()=>({id:Date.now(),on:false,spec:"",rate:"1600",setupShifts:"1.5",testShifts:"3.0",pia:0,proc:false,report:false});
const newHfv=()=>({id:Date.now(),on:false,showSetup:true,spec:"",dur:"30",pia:0,testing:"1225",stdSetup:"500",addlCosts:"0",proc:false,report:false});
const newSho=()=>({id:Date.now(),on:false,showSetup:true,spec:"",shape:"Half Sine",pia:0,testing:"1250",stdSetup:"500",addlCosts:"0",proc:false,report:false});

// ── EMI test description lookup (platform/location-aware) ────────────────
// Built from the tech-reviewed spreadsheet of test specifications.
// Lookup key: locsObj (the user's selected locations) + test + rev.
// Returns the description for each in-house-capable location selected.
// Locations marked OUT_OF_HOUSE are skipped here — the existing capability-
// flagging logic in getTestFlags already greys those tests out, so they
// don't appear as line items in the quote. Combos missing from this table
// fall back to the existing hardcoded text in EMI_461F/EMI_461G arrays.
//
// Placeholders left intentionally for Deploy 3 substitution:
//   (limit)       — figure number, substituted from this same table
//   (location)    — friendly location name
//   X positions   — position counts from RE102/RS103 pos calculations
//   XXX           — values the user fills in (current value, etc.)
const OUT_OF_HOUSE = "__OUTSOURCE__";

const EMI_TEXT_LOOKUP = {
  RE102: {
    F: {
      "Below Deck":            { fig:"Figure RE102-1", limit:"Metallic Ships below deck" },
      "Below Deck Non-metallic":{ fig:"Figure RE102-1", limit:"Non-metallic Ships below deck" },
      "Subs Internal":         { fig:"Figure RE102-2", limit:"Submarine internal" },
      "Ground Navy Fixed":     { fig:"Figure RE102-4", limit:"Ground Navy Fixed" },
      "Ground Air Force":      { fig:"Figure RE102-4", limit:"Ground Air Force" },
      "Aircraft Fixed Wing Internal ≥25m":{ fig:"Figure RE102-3", limit:"Aircraft Internal" },
      "Space System Internal": { fig:"Figure RE102-3", limit:"Space System Internal" },
      "Above Deck":            OUT_OF_HOUSE,
      "Subs External":         OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal <25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing External": OUT_OF_HOUSE,
      "Ground Navy Mobile":    OUT_OF_HOUSE,
      "Ground Army":           OUT_OF_HOUSE,
    },
    G: {
      "Below Deck":            { fig:"Figure RE102-1", limit:"Metallic Ships below deck" },
      "Below Deck Non-metallic":{ fig:"Figure RE102-1", limit:"Non-metallic Ships below deck" },
      "Subs Internal":         { fig:"Figure RE102-2", limit:"Submarine internal" },
      "Ground Navy Fixed":     { fig:"Figure RE102-4", limit:"Ground Navy Fixed" },
      "Ground Air Force":      { fig:"Figure RE102-4", limit:"Ground Air Force" },
      "Aircraft Fixed Wing Internal ≥25m":{ fig:"Figure RE102-3", limit:"Aircraft Internal" },
      "Space System Internal": { fig:"Figure RE102-3", limit:"Space System Internal" },
      "Above Deck":            OUT_OF_HOUSE,
      "Subs External":         OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal <25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing External": OUT_OF_HOUSE,
      "Ground Navy Mobile":    OUT_OF_HOUSE,
      "Ground Army":           OUT_OF_HOUSE,
    },
  },
  RS103: {
    F: {
      "Below Deck":            { ref:"Table VII", limit:"10 V/m", text:"Tested to MIL-STD-461F Table VII for Ships Metallic Below Deck from 2 MHz to 18 GHz at 10 V/m." },
      "Below Deck Non-metallic":{ ref:"Table VII", limit:"50/10 V/m", text:"Tested to MIL-STD-461F Table VII for Ships Non-metallic Below Deck from 2 MHz to 18 GHz at 50 V/m (2-30 MHz), 10 V/m (30 MHz-18 GHz)." },
      "Subs Internal":         { ref:"Table VII", limit:"5/10 V/m", text:"Tested to MIL-STD-461F Table VII for Submarine Internal from 2 MHz to 18 GHz at 5 V/m (2-30 MHz), 10 V/m (30 MHz-18 GHz)." },
      "Above Deck":            OUT_OF_HOUSE,
      "Subs External":         OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal ≥25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal <25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing External": OUT_OF_HOUSE,
      "Ground Navy Fixed":     OUT_OF_HOUSE,
      "Ground Navy Mobile":    OUT_OF_HOUSE,
      "Ground Army":           OUT_OF_HOUSE,
      "Ground Air Force":      OUT_OF_HOUSE,
      "Space System Internal": OUT_OF_HOUSE,
    },
    G: {
      "Below Deck":            { ref:"Table XI", limit:"10 V/m", text:"Tested to MIL-STD-461G Table XI for Ships Metallic Below Deck from 2 MHz to 18 GHz at 10 V/m." },
      "Below Deck Non-metallic":{ ref:"Table XI", limit:"50/10 V/m", text:"Tested to MIL-STD-461G Table XI for Ships Non-metallic Below Deck from 2 MHz to 18 GHz at 50 V/m (2-30 MHz), 10 V/m (30 MHz-18 GHz)." },
      "Subs Internal":         { ref:"Table XI", limit:"5/10 V/m", text:"Tested to MIL-STD-461G Table XI for Submarine Internal from 2 MHz to 18 GHz at 5 V/m (2-30 MHz), 10 V/m (30 MHz-18 GHz)." },
      "Above Deck":            OUT_OF_HOUSE,
      "Subs External":         OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal ≥25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing Internal <25m": OUT_OF_HOUSE,
      "Aircraft Fixed Wing External": OUT_OF_HOUSE,
      "Ground Navy Fixed":     OUT_OF_HOUSE,
      "Ground Navy Mobile":    OUT_OF_HOUSE,
      "Ground Army":           OUT_OF_HOUSE,
      "Ground Air Force":      OUT_OF_HOUSE,
      "Space System Internal": OUT_OF_HOUSE,
    },
  },
  CE101: {
    F: {
      // CE101 wording depends on power type, not location. Lookup keyed by
      // "60 Hz" / "400 Hz" / "DC" but those aren't first-class locations in
      // NUForce yet — leaving the table here for future use. For now, the
      // resolver falls back to the existing default text.
    },
    G: {},
  },
  CE102: {
    F: { ALL:{ text:"Tested on each AC (or DC) power input lead for a total of two (2) tests. Tested to MIL-STD-461F Figure CE102-1 from 10 kHz to 10 MHz with 6 dB relaxation." } },
    G: { ALL:{ text:"Tested on each AC (or DC) power input lead for a total of two (2) tests. Tested to MIL-STD-461G Figure CE102-1 from 10 kHz to 10 MHz with 6 dB relaxation." } },
  },
  CS101: {
    F: { ALL:{ text:"Tested on each AC (or DC) high side for a total of one (1) test. Tested to MIL-STD-461F Figure CS101-1, Curve 1 and Figure CS101-2." } },
    G: { ALL:{ text:"Tested on each AC (or DC) high side for a total of one (1) test. Tested to MIL-STD-461G Figure CS101-1, Curve 1 and Figure CS101-2." } },
  },
  CS115: {
    F: { ALL:{ text:"Bulk injection on the AC power input and on the high side individually. Tested to MIL-STD-461F Figure CS115-1." } },
    G: { ALL:{ text:"Bulk injection on the AC power input and on the high side individually. Tested to MIL-STD-461G Figure CS115-1." } },
  },
  CS116: {
    F: { ALL:{ text:"Bulk injection on the AC power input lead and on each lead individually. Tested to MIL-STD-461F Figure CS116-2 at discrete frequencies: 10 kHz, 100 kHz, 1 MHz, 10 MHz, 30 MHz and 100 MHz." } },
    G: { ALL:{ text:"Bulk injection on the AC power input lead and on each lead individually. Tested to MIL-STD-461G Figure CS116-2 at discrete frequencies: 10 kHz, 100 kHz, 1 MHz, 10 MHz, 30 MHz and 100 MHz." } },
  },
  RE101: {
    F: { ALL:{ text:"Applicable to all enclosures including electrical cable interfaces. Tested to MIL-STD-461F Figure RE101-2 (Navy) or RE101-1 (Army) from 30 Hz to 100 kHz." } },
    G: { ALL:{ text:"Applicable to all enclosures including electrical cable interfaces. Tested to MIL-STD-461G Figure RE101-2 (Navy) or RE101-1 (Army) from 30 Hz to 100 kHz." } },
  },
  RS101: {
    F: { ALL:{ text:"Applicable to all equipment enclosures including electrical cable interfaces. Applicability depends on application. Tested to MIL-STD-461F Figure RS101-1 (Navy) or RS101-2 (Army) from 30 Hz to 100 kHz." } },
    G: { ALL:{ text:"Applicable to all equipment enclosures including electrical cable interfaces. Applicability depends on application. Tested to MIL-STD-461G Figure RS101-1 (Navy) or RS101-2 (Army) from 30 Hz to 100 kHz." } },
  },
};

// Resolve description text for one test+rev given the user's location selections.
// Returns null when no lookup match exists (caller falls back to hardcoded default).
// rev is "F" or "G" (matches the table keys).
function getEmiTestText(testKey, rev, locsObj) {
  const table = EMI_TEXT_LOOKUP[testKey];
  if (!table) return null;
  const revMap = table[rev];
  if (!revMap) return null;
  // "ALL" key means location doesn't matter for this test — return the single entry
  if (revMap.ALL) return revMap.ALL.text || null;
  // Otherwise, collect entries for each selected in-house-capable location
  const entries = [];
  Object.entries(locsObj||{}).forEach(([locKey, isSelected])=>{
    if (!isSelected) return;
    const entry = revMap[locKey];
    if (!entry || entry === OUT_OF_HOUSE) return;   // skip outsource / unknown
    if (typeof entry === 'string') { entries.push(entry); return; }
    if (entry.text) { entries.push(entry.text); return; }
    // Compact form (RE102): construct the sentence from {fig, limit}
    entries.push(`Tested to MIL-STD-461${rev} ${entry.fig} for ${entry.limit} applications.`);
  });
  if (entries.length === 0) return null;
  return entries.join(" Additionally, ");
}

// ── EMI 461F test definitions — shared between PDF export and Spec Builder ────
// Given a single active EMI section (already chosen by caller), produces the
// FULL list of MIL-STD-461F test definitions with descriptions interpolated
// using that section's parameters (dimensions, cables, phases, power type).
// The caller is responsible for filtering by which tests are actually selected.
// Used by both buildEmi461fPDF (for the in-app PDF export) and the Spec Builder
// payload builder (for the standalone HTML tool).
function getEmi461fTestDefinitions(activeEmi, ti, setup) {
  const dispL = activeEmi.dimL || ti?.dimL || '0';
  const dispW = activeEmi.dimW || ti?.dimW || '0';
  const dispH = activeEmi.dimH || ti?.dimH || '0';
  const emiCalcData = calcEmiShifts({
    dimL: dispL, dimW: dispW, dimH: dispH,
    cables: activeEmi.cables || '0',
    setupCables: setup?.cables || '0',
    phases: activeEmi.phases || ti?.phase || '3',
    revs: {'Rev F': true},
  });
  const c114 = emiCalcData.CS114;
  const c116 = emiCalcData.CS116;
  const re102p = emiCalcData.RE102.pos;
  const rs101p = emiCalcData.RS101.pos;
  const rs103p = emiCalcData.RS103.pos;
  const pos = (n) => n + ' position' + (n !== 1 ? 's' : '');
  const isDCquote = (ti?.pwrType || 'AC') === 'DC';
  const acdc = isDCquote ? 'DC' : 'AC';

  return [
    {key:"CE101", label:"Conducted Emissions, Power Leads, 30 Hz to 10 kHz",
     desc:"Tested on each AC power input lead for a total of two (2) tests. Tested to MIL-STD-461F Figure CE101-2 from 30 Hz to 10 kHz with a relaxation of the limit determined during testing.",
     note:null},
    {key:"CE102", label:"Conducted Emissions, Power Leads, 10 kHz to 10 MHz",
     desc: "Tested on each "+acdc+" power input lead for a total of two (2) tests. Tested to MIL-STD-461F Figure CE102-1 from 10 kHz to 10 MHz with 6 dB relaxation.",
     note:null},
    {key:"CS101", label:"Conducted Susceptibility, Power Leads, 30 Hz to 150 kHz",
     desc: "Tested on each "+acdc+" high side for a total of one (1) test. Tested to MIL-STD-461F Figure CS101-1 (Curve 1 or 2) and Figure CS101-2.",
     note:null},
    {key:"CS106", label:"Conducted Susceptibility, Transients, Power Leads",
     desc: isDCquote
           ? "Tested on the DC high side for a total of one (1) test. Tested to MIL-STD-461F Figure CS106-1. Testing performed with a test generator compliant with CS06. Tested in charged mode of operation only."
           : "Tested on each AC high side for a total of two (2) tests. Tested to MIL-STD-461F Figure CS106-1. Testing performed with a test generator compliant with CS06. Tested in charged mode of operation only.",
     note:"The overshoot on this generator is slightly higher than specified in CS106 but test results are generally accepted as this is considered worst case."},
    {key:"CS114", label:"Conducted Susceptibility, Bulk Cable Injection, 10 kHz to 200 MHz and 4 kHz to 1 MHz at 77 dB uA",
     desc:"Bulk injection on AC power input lead and on one lead individually. Common mode test on input leads for a total of "+c114.pwrTests+" tests for power leads. "+c114.sigTests+" test(s) on signal leads for a total of "+c114.totalTests+" tests. Tested to MIL-STD-461F Figure CS114-1, Curve 2 from 10 kHz to 200 MHz and from 4 kHz to 1 MHz at 77 dB uA.",
     note:null},
    {key:"CS116", label:"Conducted Susceptibility, Damped Sinusoidal Transients, Cables and Power Leads, 10 kHz to 100 MHz",
     desc:"Bulk injection on AC power input lead and on each lead individually for a total of "+c116.pwrTests+" tests for power leads. "+c116.sigTests+" test(s) on signal leads for a total of "+c116.totalTests+" tests. Tested to MIL-STD-461F Figure CS116-2 at discrete frequencies: 10 kHz, 100 kHz, 1 MHz, 10 MHz, 30 MHz and 100 MHz.",
     note:null},
    {key:"RE101", label:"Radiated Emissions, Magnetic Field, 30 Hz to 100 kHz",
     desc: getEmiTestText("RE101","F",activeEmi.locs) ||
           "Applicable to all enclosures including electrical cable interfaces. Tested to MIL-STD-461F Figure RE101-2 (Navy) or RE101-1 (Army) from 30 Hz to 100 kHz.",
     note:null},
    {key:"RE102", label:"Radiated Emissions, Electric Field, 10 kHz to 18 GHz",
     desc: getEmiTestText("RE102","F",activeEmi.locs) ||
           "Tested to MIL-STD-461F Figure RE102-1 for Metallic Ships below deck applications.",
     positions:[
       {range:"10 kHz - 30 MHz",   pos:pos(1)},
       {range:"30 MHz - 200 MHz",  pos:pos(1)},
       {range:"200 MHz - 1 GHz",   pos:pos(re102p.sub1GHz)},
       {range:"1 GHz - 4 GHz",     pos:pos(re102p.b1_4)},
       {range:"4 GHz - 15 GHz",    pos:pos(re102p.b4_15)},
       {range:"15 GHz - 18 GHz",   pos:pos(re102p.b15_18)},
     ],
     note:"Tested at width and cables only. Testing required to 10x the highest operating frequency or 1 GHz (whichever is greater), or if not known, to 18 GHz."},
    {key:"RS101", label:"Radiated Susceptibility, Magnetic Field, 30 Hz to 100 kHz",
     desc:"Applicable to all equipment enclosures including electrical cable interfaces. Tested to MIL-STD-461F Figure RS101-1 (Navy) or RS101-2 (Army) from 30 Hz to 100 kHz at approximately "+rs101p.total+" positions ("+rs101p.LW+" LxW + "+rs101p.LH+" LxH + "+rs101p.WH+" WxH).",
     note:"Applicability depends on application."},
    {key:"RS103", label:"Radiated Susceptibility, Electric Field, 2 MHz to 18 GHz",
     desc: getEmiTestText("RS103","F",activeEmi.locs) ||
           "Tested to MIL-STD-461F Table VII for Ships metallic below deck from 2 MHz to 18 GHz at 10 V/m.",
     positions:[
       {range:"2 MHz - 30 MHz",    pos:pos(rs103p.b2_30)},
       {range:"30 MHz - 200 MHz",  pos:pos(rs103p.b30_200)},
       {range:"200 MHz - 1 GHz",   pos:pos(rs103p.b200_1G)},
       {range:"1 GHz - 4 GHz",     pos:pos(rs103p.b1_4)},
       {range:"4 GHz - 15 GHz",    pos:pos(rs103p.b4_15)},
       {range:"15 GHz - 18 GHz",   pos:pos(rs103p.b15_18)},
     ],
     note:null},
  ];
}

// ── EMI 461G test definitions — shared between PDF export and Spec Builder ────
// Same pattern as getEmi461fTestDefinitions: returns the full list of MIL-STD-
// 461G test definitions with descriptions interpolated from the section's
// parameters. Caller filters by selected keys.
function getEmi461gTestDefinitions(activeEmi, ti, setup) {
  const dispL = activeEmi.dimL || ti?.dimL || '0';
  const dispW = activeEmi.dimW || ti?.dimW || '0';
  const dispH = activeEmi.dimH || ti?.dimH || '0';
  const emiCalcG = calcEmiShifts({
    dimL: dispL, dimW: dispW, dimH: dispH,
    cables: activeEmi.cables || '0',
    setupCables: setup?.cables || '0',
    phases: activeEmi.phases || ti?.phase || '3',
    revs: {'Rev G': true},
  });
  const c114 = emiCalcG.CS114;
  const c116 = emiCalcG.CS116;
  const re102p = emiCalcG.RE102.pos;
  const rs101p = emiCalcG.RS101.pos;
  const rs103p = emiCalcG.RS103.pos;
  const cs115 = emiCalcG.CS115;
  const c109 = emiCalcG.CS109; // eslint-disable-line no-unused-vars — kept for symmetry with PDF builder
  const pos = (n) => n + ' position' + (n !== 1 ? 's' : '');
  const isDCquote = (ti?.pwrType || 'AC') === 'DC';
  const acdc = isDCquote ? 'DC' : 'AC';

  return [
    {key:"CE101", label:"Conducted Emissions, Audio Frequency Currents, Power Leads",
     desc:"Tested on each AC power input lead for a total of two (2) tests. Tested to MIL-STD-461G Figure CE101-2 from 120 Hz to 10 kHz with a relaxation of the limit determined during testing.",
     note:null},
    {key:"CE102", label:"Conducted Emissions, Radio Frequency Potentials, Power Leads",
     desc: "Tested on each "+acdc+" power input lead for a total of two (2) tests. Tested to MIL-STD-461G Figure CE102-1 from 10 kHz to 10 MHz, basic curve relaxed by 6 dB.",
     note:null},
    {key:"CS101", label:"Conducted Susceptibility, Power Leads, 30 Hz to 150 kHz",
     desc: "Tested on the "+acdc+" high side for a total of one (1) test. Tested to MIL-STD-461G Figure CS101-1 (Curve 1 or 2) and Figure CS101-2 from 30 Hz to 150 kHz.",
     note:"Exempt from testing for normal operating current >30 A per phase, or if >30 A per phase with sensitivity worse than 1 uV or operating frequency >150 kHz."},
    {key:"CS109", label:"Conducted Susceptibility, Structure Current",
     desc:"Tested to MIL-STD-461G CS109 requirements.",
     note:"Test not applicable to equipment with an operating sensitivity worse than 1 uV or operating frequency >100 kHz."},
    {key:"CS114", label:"Conducted Susceptibility, Bulk Cable Injection, 10 kHz to 200 MHz and 4 kHz to 1 MHz at 77 dB uA",
     desc:"Bulk injection on AC power input and on the high side of the AC input leads. Common mode test on input leads for a total of "+c114.pwrTests+" tests for power leads. "+c114.sigTests+" test(s) on signal leads for a total of "+c114.totalTests+" tests. Tested to MIL-STD-461G Figure CS114-1, Curve 2 from 10 kHz to 200 MHz and from 4 kHz to 1 MHz at 77 dB uA.",
     note:null},
    {key:"CS115", label:"Conducted Susceptibility, Bulk Cable Injection, Impulse Excitation",
     desc:"Bulk injection on AC power input and on the high side individually for a total of "+cs115.pwrTests+" tests for power leads. "+cs115.sigTests+" test(s) on signal leads for a total of "+cs115.totalTests+" tests. Tested to MIL-STD-461G Figure CS115-1 for one minute using 30 ns pulse at 5 amps, 30 Hz.",
     note:null},
    {key:"CS116", label:"Conducted Susceptibility, Damped Sinusoidal Transients, Cables and Power Leads",
     desc:"Bulk injection on AC power input and on the high side and return individually for a total of "+c116.pwrTests+" tests for power leads. "+c116.sigTests+" test(s) on signal leads for a total of "+c116.totalTests+" tests. Tested at discrete frequencies: 10 kHz, 100 kHz, 1 MHz, 10 MHz, 30 MHz and 100 MHz.",
     note:null},
    {key:"RE101", label:"Radiated Emissions, Magnetic Field, 30 Hz to 100 kHz",
     desc: getEmiTestText("RE101","G",activeEmi.locs) ||
           "Applicable to all enclosures including electrical cable interfaces. Tested to MIL-STD-461G Figure RE101-2 (Navy) or RE101-1 (Army) from 30 Hz to 100 kHz.",
     note:null},
    {key:"RE102", label:"Radiated Emissions, Electric Field, 10 kHz to 18 GHz",
     desc: getEmiTestText("RE102","G",activeEmi.locs) ||
           "Tested to MIL-STD-461G Figure RE102-1 for Metallic Ships below deck applications.",
     positions:[
       {range:"10 kHz - 30 MHz",   pos:pos(1)},
       {range:"30 MHz - 200 MHz",  pos:pos(1)},
       {range:"200 MHz - 1 GHz",   pos:pos(re102p.sub1GHz)},
       {range:"1 GHz - 4 GHz",     pos:pos(re102p.b1_4)},
       {range:"4 GHz - 15 GHz",    pos:pos(re102p.b4_15)},
       {range:"15 GHz - 18 GHz",   pos:pos(re102p.b15_18)},
     ],
     note:"For 461G: tested in both horizontal and vertical polarizations. Testing required to 10x the highest operating frequency or 1 GHz (whichever is greater), or if not known, to 18 GHz."},
    {key:"RS101", label:"Radiated Susceptibility, Magnetic Field, 30 Hz to 100 kHz",
     desc:"Applicable to all equipment enclosures including electrical cable interfaces. Tested to MIL-STD-461G Figure RS101-1 (Navy) or RS101-2 (Army) from 30 Hz to 100 kHz at approximately "+rs101p.total+" positions ("+rs101p.LW+" LxW + "+rs101p.LH+" LxH + "+rs101p.WH+" WxH).",
     note:"Applicability depends on application. Test not applicable to equipment with an operating sensitivity worse than 1 uV or operating frequency >100 kHz."},
    {key:"RS103", label:"Radiated Susceptibility, Electric Field, 2 MHz to 18 GHz",
     desc: getEmiTestText("RS103","G",activeEmi.locs) ||
           "Tested to MIL-STD-461G Table XI for Ships metallic below deck from 2 MHz to 18 GHz at 10 V/m.",
     positions:[
       {range:"2 MHz - 30 MHz",    pos:pos(rs103p.b2_30)},
       {range:"30 MHz - 200 MHz",  pos:pos(rs103p.b30_200)},
       {range:"200 MHz - 1 GHz",   pos:pos(rs103p.b200_1G)},
       {range:"1 GHz - 4 GHz",     pos:pos(rs103p.b1_4)},
       {range:"4 GHz - 15 GHz",    pos:pos(rs103p.b4_15)},
       {range:"15 GHz - 18 GHz",   pos:pos(rs103p.b15_18)},
     ],
     note:null},
  ];
}

// ── PQ 300B test definitions — shared between PDF export and Spec Builder ────
// Static list (no dynamic interpolation today). Same pattern as the EMI
// helpers — the array lives in one place so the PDF builder and the Spec
// Builder payload reader can both use it.
function getPq300bTestDefinitions() {
  return [
    {key:"B5.3.1", label:"Voltage and frequency tolerance test",
     req:"Type 1 single phase (123/107) V ac, (62/57) Hz",
     ref:"Table II for shipboard and submarine applications",
     note:null},
    {key:"B5.3.2", label:"Voltage and frequency transient tolerance and recovery test",
     req:"138 V ac / 63.3 Hz; 92 V ac / 56.7 Hz",
     ref:"Table III",
     note:null},
    {key:"B5.3.3", label:"Voltage spike test",
     req:"900 to 1000 V peak line-to-line and line-to-ground, or 2400 to 2500 V peak line-to-line and line-to-ground",
     ref:"Figure 23, 24 or 25",
     note:"Voltage spike impulse wave shape using IEC 61000-4-5 1.2/50 uS open circuit waveform definition. Overshoot may exceed figure. Or voltage spike impulse wave shape of Figure 6 NAVSEA deviation for light fixtures (MIL-DTL-16377 SSL)."},
    {key:"B5.3.4", label:"Emergency condition test",
     req:"70 ms dropout, 2 minute dropout; voltage and frequency decay characteristics for half-load curve; 67.2 Hz for 2 minutes / 155.25 V ac for 2 min",
     ref:"Figure 8, Table VI",
     note:null},
    {key:"B5.3.5", label:"Grounding test",
     req:"100,000-ohm; each lead grounded individually for 5 minutes",
     ref:null,
     note:null},
    {key:"B5.3.6", label:"User equipment power profile test",
     req:"User voltage and power characteristics per Section 5.3.6 a. through m. as required",
     ref:null,
     note:"Inrush current measurement may be limited by the capabilities of the AC source used, which may not cover 10x nominal current or higher. If inrush exceeds source capability the measurement cannot be made as desired. Will report what is measured and make a best effort attempt using facility power directly (5 attempts)."},
    {key:"B5.3.7", label:"Current waveform test",
     req:"120 Hz to 20 kHz, < 1 kVA limits as applicable",
     ref:null,
     note:"Requirement met using MIL-STD-461F/G test method CE101 with frequency extended to 20 kHz. A non-regulated power source may be needed as regulated source switching produces inconsistent current waveform data. Not required for currents < 1 A per NAVSEA."},
    {key:"B5.3.8", label:"Voltage and frequency modulation test",
     req:"Frequency modulation 0.5%; voltage modulation 2%. Periods of 17 ms, 75 ms, 250 ms, 500 ms, 1 s, 5 s and 10 s each repeated ten consecutive times",
     ref:"Table VII",
     note:null},
    {key:"B5.3.9", label:"Simulated human body leakage current test",
     req:"60 Hz to 700 Hz < 5 mA; 700 Hz to 100 kHz < 70 mA",
     ref:"Figure 28, Figure 31",
     note:null},
    {key:"B5.3.10.1", label:"Equipment insulation resistance test",
     req:"500 V dc for 60 seconds; resistance to ground > 10 MOhm",
     ref:null,
     note:null},
    {key:"B5.3.10.2", label:"Active ground detection test",
     req:"For 440 V rms EUT: AC source 622.2 V peak, DC source 505 VDC. For 115 V rms EUT: AC source 162.6 V peak, DC source 155 VDC.",
     ref:null,
     note:"AGD is run on one line only per NAVSEA direction. Verify if legacy requirements apply."},
  ];
}

// ── PQ 300 Part 1 test definitions — shared between PDF export and Spec Builder ──
function getPq300p1TestDefinitions() {
  return [
    {key:"5.3.1", label:"Grounding (susceptibility) test",
     req:"100,000-ohm; each lead grounded individually for 5 minutes",
     ref:null, note:null},
    {key:"5.3.2", label:"User equipment power profile test",
     req:"User voltage and power characteristics per Section 5.3.2 a. through o. as required",
     ref:null,
     note:"Inrush current measurement may be limited by the capabilities of the AC source used, which may not cover 10x nominal current or higher. If inrush exceeds source capability the measurement cannot be made as desired. Will report what is measured and make a best effort attempt using facility power directly (5 attempts)."},
    {key:"5.3.3", label:"Voltage and frequency maximum departure tolerance test",
     req:"Type 1 single phase (127/104) VAC, (63/57) Hz or Type 1 single phase (484/396) VAC, (63/57) Hz",
     ref:"Table III for shipboard and submarine applications. Tested for 30 minutes in four (4) modes after temperature stability.",
     note:null},
    {key:"5.3.4", label:"Voltage and frequency transient tolerance and recovery test",
     req:"138 VAC / 63.3 Hz; 92 VAC / 56.7 Hz or 528 VAC / 63.3 Hz; 352 VAC / 56.7 Hz",
     ref:"Table IV, duration 2 seconds",
     note:null},
    {key:"5.3.5", label:"Voltage spike (susceptibility) test",
     req:"900 to 1000 V peak line-to-line and line-to-ground, or 2400 to 2500 V peak line-to-line and line-to-ground",
     ref:"Figure 28, 29 or 30",
     note:"Voltage spike impulse wave shape using IEC 61000-4-5 1.2/50 uS open circuit waveform definition. Overshoot may exceed figure. Or voltage spike impulse wave shape of Figure 6 NAVSEA deviation for light fixtures (MIL-DTL-16377 SSL)."},
    {key:"5.3.6", label:"Emergency conditions (susceptibility) test",
     req:"70 ms dropout, 2 minute dropout; voltage and frequency decay for half-load curve; 67.2 Hz for 2 min / 155.25 VAC for 2 min or 594 VAC for 2 min",
     ref:"Figure 9, Table VII",
     note:"Tc time to be provided by supplier, otherwise default times shall be used."},
    {key:"5.3.7", label:"Current waveform (emission) test",
     req:"Per Section 5.3.7, performed in accordance with CE101 testing",
     ref:null,
     note:"Requirement met using MIL-STD-461G test method CE101 with frequency extended to 20 kHz. A non-regulated power source may be needed as regulated source switching produces inconsistent current waveform data. Not required for currents < 1 A per NAVSEA."},
    {key:"5.3.8", label:"Voltage and frequency modulation (susceptibility) test",
     req:"Frequency modulation 0.5%; voltage modulation 2%. Periods of 50 ms, 500 ms, 1 s and 10 s each repeated ten consecutive times",
     ref:"Table VIII",
     note:null},
    {key:"5.3.9", label:"Simulated human body impedance ground current test",
     req:"60 Hz to 700 Hz < 5 mA; 700 Hz to 100 kHz < 70 mA",
     ref:"Figure 33 through Figure 36 depending on source voltage",
     note:null},
    {key:"5.3.10.1", label:"Equipment line-to-ground voltage (susceptibility) test",
     req:"150 VDC (for 115 VAC) or 500 VDC (for 440 VAC) for 60 seconds; resistance to ground > 10 MOhm",
     ref:null, note:null},
    {key:"5.3.10.2", label:"Equipment line-to-ground voltage test (AGD)",
     req:"For 440 V rms EUT: AC source 622.2 V peak, DC source 505 VDC. For 115 V rms EUT: AC source 162.6 V peak, DC source 155 VDC.",
     ref:null,
     note:"AGD is run on one line only per NAVSEA direction. Verify if legacy requirements apply."},
  ];
}

// ── Summary calculation helper ────────────────────────────────────────────────
// Compute a section's total setup = stdSetup + global drilling + global fab + addlCosts
function sectionSetup(s, globalSetup){
  const std   = sf(s.stdSetup, sf(s.setup, 0));  // fallback to old 'setup' field for loaded quotes
  const drill = sf(globalSetup.holes) * 0.5 * sf(globalSetup.techRate, 175) * (globalSetup.drillTap ? 1.5 : 1);
  const fab   = sf(globalSetup.fabHours) * sf(globalSetup.techRate, 175);
  const addl  = sf(s.addlCosts, 0);
  return Math.round(std + drill + fab + addl);
}

function pcode(label){
  const dl=label.toLowerCase();
  if(dl.includes("procedure")||dl.includes("proc"))return dl.includes("emi")||dl.includes("dcm")||dl.includes("dc mag")||dl.includes("pq")||dl.includes("power quality")?"44":"42";
  if(dl.includes("report"))return dl.includes("emi")||dl.includes("dcm")||dl.includes("dc mag")||dl.includes("pq")||dl.includes("power quality")?"43":"41";
  if(dl.includes("certificate"))return "41";
  if(dl.includes("tear down")||dl.includes("teardown"))return "96";
  if(dl.includes("hydrostatic"))return "95";
  if(dl.includes("circulating"))return "94";
  if(dl.includes("high frequency vib")||dl.includes("hfv"))return "52";
  if(dl.includes("shock (other)"))return "52";
  if(dl.includes("airborne")||dl.includes("structureborne"))return "12";
  if(dl.includes("noise"))return "11";
  if(dl.includes("emi")||dl.includes("dc magnet")||dl.includes("power quality")||dl.includes(" pq ")||dl.startsWith("pq ")||dl.includes(" dcm ")||dl.startsWith("dcm "))return "51";
  if(dl.includes("humidity")||dl.includes("temperature")||dl.includes("t&h"))return "53";
  if(dl.includes("ess")||dl.includes("environmental stress"))return "54";
  if(dl.includes("salt fog"))return "55";
  if(dl.includes("altitude")||dl.includes("rapid decomp")||dl.includes("explosive decomp"))return "56";
  if(dl.includes("acceleration"))return "57";
  if(dl.includes("drip")||dl.includes("submerg")||dl.includes("spray"))return "58";
  if(dl.includes("inclination"))return "93";
  if(dl.includes("medium weight")||(dl.includes("shock")&&dl.includes("medium")))return "91";
  if(dl.includes("lightweight")||(dl.includes("shock")&&dl.includes("light")))return "92";
  if(dl.includes("shock"))return "91";
  if(dl.includes("high speed video")||dl.includes("hsv"))return "32";
  if(dl.includes("instrument")||dl.includes("channel")||dl.includes("contact monitor"))return "33";
  if(dl.includes("vibration"))return "94";
  if(dl.includes("overtime"))return "";
  return "";
}

function calcSummary(vibs,shocks,noises,envs,hfvs,shos,emis,pqs,dcms,abs,sbs,inst,ot,custom,td,coc,sub,globalPR,budget,globalSetup,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal){
  const lines=[];
  let currentUnit=0;
  let seq=0;
  const add=(label,val,_bucket,code)=>{const v=r25(sf(val));if(v>0)lines.push({label,val:v,code:code||pcode(label),unit:currentUnit,seq:seq++});};
  // addUser: like add but allows $0 (for user-defined custom items)
  const addUser=(label,val,_bucket,code)=>{const v=r25(sf(val));lines.push({label,val:v,code:code||pcode(label),unit:currentUnit,seq:seq++,userDefined:true});};

  // Vibration instances
  vibs.filter(s=>s.on).forEach((s,idx)=>{
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const pm=s.pia||1;
    // Fixture Fabrication — first line for this test block
    if(s.fixtureFab?.on){
      const fabLabel="Fixture Fabrication – Vibration"+(pre?pre:"");
      const laborAmt=r25(sf(s.fixtureFab.hours,0)*sf(s.fixtureFab.techRate,175));
      lines.push({label:fabLabel,val:laborAmt,code:"94",unit:currentUnit,seq:seq++,isFabLine:true});
    }
    if(s.hydroPre)add("Vib"+pre+" – Pre-Test Hydrostatic",sf(s.hydroPrice||500),null,"95");
    if(s.circ)add("Circulating System",2500,null,"94");
    if(s.showSetup!==false)add("Vibration"+pre+" – Setup",sectionSetup(s,globalSetup)*pm,null,"94");
    // Vib instrumentation: between setup and testing
    if(inst.on){
      if(inst.items?.vib?.on)add("Vib Instrumentation",325*sf(inst.items.vib.channels,1),null,"33");
      if(inst.items?.cmVib?.on)add("Contact Monitoring (Vibe)",750*sf(inst.items.cmVib.channels,1),null,"33");
    }
    add("Vibration"+pre+" – Testing",sf(s.testing)*pm,null,"94");
    if(s.hydroPost)add("Vib"+pre+" – Post-Test Hydrostatic",sf(s.hydroPrice||500),null,"95");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // Shock instances (from-vib discount uses first active vib setup)
  const firstVibSetup=vibs.find(v=>v.on)?sectionSetup(vibs.find(v=>v.on),globalSetup):0;
  shocks.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const pm=s.pia||1;
    const isMW=s.cat==="Medium Weight";
    const code=isMW?"91":"92";
    let su=sectionSetup(s,globalSetup);
    if(s.fromVib&&firstVibSetup>0)su=isMW?mwDisc(firstVibSetup):lwDisc(firstVibSetup);
    // Fixture Fabrication — first line for this test block
    if(s.fixtureFab?.on){
      const fabLabel="Fixture Fabrication – Shock"+(pre?pre:"");
      const laborAmt=r25(sf(s.fixtureFab.hours,0)*sf(s.fixtureFab.techRate,175));
      lines.push({label:fabLabel,val:laborAmt,code:code,unit:currentUnit,seq:seq++,isFabLine:true});
    }
    if(s.circ)add("Circulating System",2500,null,code);
    if(s.hydroPre)add("Shock"+pre+" – Pre-Test Hydrostatic",sf(s.hydroPrice||500),null,"95");
    const shockCat=isMW?"Medium Weight Shock":"Lightweight Shock";
    const shockSetupLabel=shockCat+pre+" – Setup"+(s.fromVib&&firstVibSetup>0?" (disc.)":"");
    const shockSetupDesc=s.fromVib&&firstVibSetup>0?"Pricing assumes the unit is coming directly from vibration testing.":null;
    if(s.showSetup!==false){const v=Math.round(sf(su*pm));if(v>0){const u=currentUnit;const sq=seq++;lines.push({label:shockSetupLabel,val:v,code:code,desc:shockSetupDesc,unit:u,seq:sq});}}
    // Shock instrumentation + HSV: between setup and testing
    if(inst.on){
      if(inst.items?.shock?.on)add("Shock Instrumentation",525*sf(inst.items.shock.channels,1),null,"33");
      if(inst.items?.cmShock?.on)add("Contact Monitoring (Shock)",350*sf(inst.items.cmShock.channels,1),null,"33");
      if(inst.items?.hsv?.on)add("High Speed Video",1950,null,"32");
    }
    add(shockCat+pre+" – Testing",sf(s.testing)*pm,null,code);
    if(s.hydroPost)add("Shock"+pre+" – Post-Test Hydrostatic",sf(s.hydroPrice||500),null,"95");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // Noise instances
  noises.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const pm=s.pia||1;
    // Noise setup: chamber factor is the base; addlCosts from section can be added but NOT globalSetup fab/drill
    const noiseBase=sf(s.stdSetup,sf(NOISE_FAC[s.chamber],1000));
    const noiseSetup=Math.round(noiseBase+sf(s.addlCosts,0));
    if(s.showSetup!==false)add("Noise"+pre+" – Setup",noiseSetup*pm,null,"11");
    add("Noise"+pre+" – Testing",sf(s.testing)*pm,null,"11");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // ENV instances
  envs.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=s.identifier?" ("+s.identifier+")":"";
    // Use T&H type in label
    const thTypeLabel={"Temperature & Humidity":"Temp & Humidity","Temperature Only":"Temperature","Humidity Only":"Humidity"};
    const LBL={th:thTypeLabel[s.thType]||"T&H",sf:"Salt Fog",alt:"Altitude",ess:"ESS",acc:"Acceleration",incl:"Inclination",rd:"Rapid Decomp.",ed:"Explosive Decomp.",drip:"Drip Test",sub:"Submergence",spray:"Spray Test",insres:"Insulation Resistance & Dielectric Strength"};
    const ENV_CODE={th:"53",sf:"55",alt:"56",ess:"54",acc:"57",incl:"93",rd:"56",ed:"56",drip:"58",sub:"58",spray:"58",insres:"59"};
    Object.entries(s.items||{}).forEach(([k,v])=>{
      if(!v?.on)return;
      const lbl=(LBL[k]||k)+pre;
      const code=ENV_CODE[k]||"";
      const testing=k==="th"?(ENV_TH_PRICES[s.thDur]||sf(v.testing,1000)):sf(v.testing);
      const setupAmt=sf(v.setup,0);
      if(setupAmt>0&&s.showSetup!==false)add(lbl+" – Setup",setupAmt,null,code);
      if(testing>0)add(lbl+" – Testing",testing,null,code);
    });
  });

  // HFV instances
  hfvs.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const pm=s.pia||1;
    const hfvStd = sf(s.stdSetup||s.setup||"500", 500);
    const hfvDrill = sf(globalSetup?.holes,0)*0.5*sf(globalSetup?.techRate,175)*(globalSetup?.drillTap?1.5:1);
    const hfvFab = sf(globalSetup?.fabHours,0)*sf(globalSetup?.techRate,175);
    const hfvAddl = sf(s.addlCosts,0);
    const hfvSetupRaw = Math.round((hfvStd+hfvDrill+hfvFab+hfvAddl)*pm);
    const hfvSetupVal = isNaN(hfvSetupRaw)||hfvSetupRaw<=0 ? Math.round(hfvStd*pm)||500 : hfvSetupRaw;
    // Force push setup line directly — bypasses add()'s v>0 guard in case of edge cases
    if(s.showSetup!==false)lines.push({label:"HF Vibration"+pre+" – Setup",val:r25(hfvSetupVal),code:"52",unit:currentUnit,seq:seq++});
    add("HF Vibration"+pre+" – Testing",sf(s.testing)*pm,null,"52");
  });

  // SHO instances
  const hfvOn=hfvs.some(s=>s.on);
  shos.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const pm=s.pia||1;
    const baseSetup=sectionSetup(s,globalSetup); const shoSetup=hfvOn?Math.ceil(baseSetup*0.75/25)*25:baseSetup;
    if(s.showSetup!==false)add("Shock (Other)"+pre+" – Setup"+(hfvOn?" (HFV disc.)":""),shoSetup*pm,null,"52");
    add("Shock (Other)"+pre+" – Testing",sf(s.testing)*pm,null,"52");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // EMI instances
  emis.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const r=sf(s.rate,EMI_SR),pm=s.pia||1;
    // Use auto-calculated shifts from unit details
    // Use ti dims as fallback if emi instance has no manual dims set
    const emiForCalc={...s,dimL:s.dimL||"0",dimW:s.dimW||"0",dimH:s.dimH||"0",setupCables:globalSetup?.cables||"0"};
    const emiShifts=calcEmiShifts(emiForCalc);
    const selectedTests=Object.entries(s.tests||{}).filter(([,v])=>v).map(([k])=>k);
    const testShifts=selectedTests.reduce((a,t)=>a+(emiShifts[t]?.rounded||0),0);
    const rs103AmpCost=selectedTests.includes("RS103")?sf(s.rs103amp,5000):0;
    add("EMI"+pre+" – Setup",sf(s.setupShifts,3)*r*pm,null,"51");
    if(testShifts>0)add("EMI"+pre+" – Testing",(testShifts*r+rs103AmpCost)*pm,null,"51");
    add("EMI"+pre+" – Teardown",sf(s.tdShifts,1)*r,null,"51");
    if(sf(s.addl)>0)add("EMI"+pre+" – Addl Costs",s.addl,null,"51");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // PQ instances
  pqs.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const r=sf(s.rate,PQ_SR),pm=s.pia||1;
    const is3ph=sf(s.phases||3,3)>=3;
    const PQ_ALL_SH={"5.3.1":0.5,"5.3.2":1.0,"5.3.3":1.0,"5.3.4":1.0,"5.3.5":is3ph?2.0:1.5,"5.3.6":2.0,"5.3.7":is3ph?1.0:0.75,"5.3.8":2.0,"5.3.9":0.75,"5.3.10.1":0.5,"5.3.10.2":0.5,
      "B5.3.1":1.0,"B5.3.2":1.0,"B5.3.3":is3ph?2.0:1.5,"B5.3.4":2.0,"B5.3.5":0.5,"B5.3.6":1.0,"B5.3.7":is3ph?1.0:0.75,"B5.3.8":2.0,"B5.3.9":0.75,"B5.3.10.1":0.5,"B5.3.10.2":0.5};
    const ts=Object.entries(s.rows||{}).reduce((a,[k,v])=>v?a+(PQ_ALL_SH[k]||0):a,0);
    add("PQ"+pre+" – Setup",sf(s.setupShifts,1.5)*r*pm,null,"51");
    add("PQ"+pre+" – Testing",ts*r*pm,null,"51");
    add("PQ"+pre+" – Teardown",sf(s.tdShifts,1.0)*r,null,"51");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // DCM instances
  dcms.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const r=sf(s.rate,DCM_SR),pm=s.pia||1;
    add("DCM"+pre+" – Setup",sf(s.setupShifts,1.5)*r*pm,null,"51");
    add("DCM"+pre+" – Testing",sf(s.testShifts,2.0)*r*pm,null,"51");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // AB/SB instances
  abs.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    if(s.showSetup!==false)add("Airborne Noise"+pre+" – Setup",sectionSetup(s,globalSetup),null,"12");
    add("Airborne Noise"+pre+" – Testing",sf(s.testing),null,"12");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });
  sbs.filter(s=>s.on).forEach((s,idx)=>{
    currentUnit=idx;
    const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
    if(s.showSetup!==false)add("Structureborne Noise"+pre+" – Setup",sectionSetup(s,globalSetup),null,"12");
    add("Structureborne Noise"+pre+" – Testing",sf(s.testing),null,"12");
    (s.customRows||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Custom",r.price,null,r.code||pcode(r.label||""));});
  });

  // Instrumentation — non-shock/vib items not already placed inline
  if(inst.on){
    // Items handled inline within vib/shock loops — only add here if no active vib/shock
    const hasActiveVib=vibs.some(s=>s.on);
    const hasActiveShock=shocks.some(s=>s.on);
    const INLINE=new Set(["shock","cmShock","vib","cmVib","hsv"]);
    const PRICES={shock:525,cmShock:350,vib:325,cmVib:750,hsv:1950,addl:1200};
    const LABELS={shock:"Shock Instrumentation",cmShock:"Contact Monitoring (Shock)",
      vib:"Vib Instrumentation",cmVib:"Contact Monitoring (Vibe)",hsv:"High Speed Video"};
    const CODES={shock:"33",cmShock:"33",vib:"33",cmVib:"33",hsv:"32"};
    Object.entries(inst.items||{}).forEach(([k,v])=>{
      if(!v?.on)return;
      // Skip inline items if their parent test section is active (already added inline)
      if(INLINE.has(k)){
        if(k==="vib"||k==="cmVib"){if(hasActiveVib)return;}
        else if(k==="shock"||k==="cmShock"||k==="hsv"){if(hasActiveShock)return;}
      }
      const price=PRICES[k]||0;
      const label=LABELS[k]||k;
      const code=CODES[k]||"33";
      if(price>0)add(label,price*sf(v.channels,1),null,code);
    });
  }

  const anyMain=vibs.some(s=>s.on)||shocks.some(s=>s.on)||noises.some(s=>s.on)||
    envs.some(s=>s.on)||hfvs.some(s=>s.on)||shos.some(s=>s.on)||
    emis.some(s=>s.on)||pqs.some(s=>s.on)||dcms.some(s=>s.on);
  if(anyMain){
    const hasMW=shocks.some(s=>s.on&&s.cat==="Medium Weight");
    const hasLW=shocks.some(s=>s.on&&s.cat==="Lightweight");
    const hasVib=vibs.some(s=>s.on);
    const hasNoise=noises.some(s=>s.on);
    const hasAb=abs.some(s=>s.on)||sbs.some(s=>s.on);
    const hasEnvOnly=envs.some(s=>s.on)&&!hasMW&&!hasLW&&!hasVib&&!hasNoise&&!hasAb;
    const SIMPLE_ENV=["th","sf","alt","insres"];
    const onlySimpleEnv=hasEnvOnly&&envs.every(s=>!s.on||Object.keys(s.items||{}).filter(k=>s.items[k]?.on).every(k=>SIMPLE_ENV.includes(k)));
    // totalSetup: vib + shock + noise + ab + sb setups (matching desktop)
    const totalSetup=
      vibs.filter(s=>s.on).reduce((a,s)=>a+sectionSetup(s,globalSetup),0)+
      shocks.filter(s=>s.on).reduce((a,s)=>a+(s.fromVib?
        (s.cat==="Medium Weight"?mwDisc(sectionSetup(vibs.find(v=>v.on)||{std:1000},globalSetup)):lwDisc(sectionSetup(vibs.find(v=>v.on)||{std:1000},globalSetup)))
        :sectionSetup(s,globalSetup)),0)+
      noises.filter(s=>s.on).reduce((a,s)=>a+sectionSetup(s,globalSetup),0)+
      abs.filter(s=>s.on).reduce((a,s)=>a+sectionSetup(s,globalSetup),0)+
      sbs.filter(s=>s.on).reduce((a,s)=>a+sectionSetup(s,globalSetup),0);
    // Teardown rules:
    // Base:       Vib=$750, LW shock only=$500, MW shock only=$750
    // Vib+MW:     $1000
    // Each of: Noise, AB/SB, complex Env, HFV/SHO adds $250, capped at $1500
    // Simple env only (T&H/SF/Alt): $500 flat
    // Skip if ONLY EMI/PQ/DCM (they include their own teardown shifts)
    const onlyShiftTests=!hasMW&&!hasLW&&!hasVib&&!hasNoise&&!hasAb&&
      !envs.some(s=>s.on)&&!hfvs.some(s=>s.on)&&!shos.some(s=>s.on)&&
      (emis.some(s=>s.on)||pqs.some(s=>s.on)||dcms.some(s=>s.on));
    if(!onlyShiftTests){
      let autoTd=0;
      if(onlySimpleEnv){
        autoTd=500;
      } else {
        // Base value from primary test type
        const hasHfv=hfvs.some(s=>s.on);
        const hasSho=shos.some(s=>s.on);
        if(hasVib && hasMW)       autoTd=1000;
        else if(hasVib)           autoTd=750;
        else if(hasMW)            autoTd=1000;
        else if(hasLW)            autoTd=500;
        else if(hasAb)            autoTd=750;
        else if(hasHfv||hasSho)   autoTd=500;
        // Additive bumps (each +$250, capped at $1500)
        if(hasNoise)                                      autoTd=Math.min(autoTd+250,1500);
        if(hasAb && (hasVib||hasMW||hasLW||hasNoise))     autoTd=Math.min(autoTd+250,1500);
        const hasComplexEnv=envs.some(s=>s.on)&&!onlySimpleEnv;
        if(hasComplexEnv)                                 autoTd=Math.min(autoTd+250,1500);
        if((hasHfv||hasSho) && (hasVib||hasMW||hasLW||hasNoise||hasAb)) autoTd=Math.min(autoTd+250,1500);
        if(autoTd===0) autoTd=500; // fallback for anything not covered
      }
      autoTd=Math.max(Math.min(autoTd,1500),500); // never less than 500
      const tdVal=sf(td)>0?sf(td):autoTd;
      add("Tear Down",tdVal,null,"96");
    }
  }

  // Subcontracting — added before budget so rollInto can target sub lines
  if(sub.on)sub.rows.forEach(r=>{if(sf(r.price)>0)add(r.desc||"Subcontract Item",r.price,null,"98");});

  // Budget materials: add marked-up total to the selected setup line
  if(ot.on)ot.rows.forEach(r=>{
    const b=r.type==="Weekday"?300:825,h=r.type==="Weekday"?262.5:350;
    const total=b+sf(r.techs,1)*sf(r.hours,0)*h;
    if(total>0)add(r.label||"Overtime",total,null,r.pcode||"94");
  });
  if(custom.on)custom.rows.forEach(r=>{if(r.label||String(r.price).trim())addUser(r.label||"Custom Item",r.price,null,r.pcode||"94");});

  // Budget - tracking only, does not add a line item to quote summary

  // Combined proc/report across all instances of all sections
  // Section proc/report prices — keyed by section type
  const PROC_PRICES={vib:PROC_BASE,shock:PROC_BASE,noise:PROC_BASE,env:PROC_BASE,hfv:PROC_BASE,sho:PROC_BASE,
    dcm:1950,pq:2925,emi:3425,ab:PROC_BASE,sb:PROC_BASE};
  const REP_PRICES={vib:REPORT_BASE,shock:REPORT_BASE,noise:REPORT_BASE,env:REPORT_BASE,hfv:REPORT_BASE,sho:REPORT_BASE,
    dcm:1500,pq:2450,emi:2850,ab:REPORT_BASE,sb:REPORT_BASE};
  const allSections=[
    ...vibs.filter(s=>s.on).map((s,i)=>({s,lbl:"Vibration"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"vib",unit:i})),
    ...shocks.filter(s=>s.on).map((s,i)=>({s,lbl:"Shock"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"shock",unit:i})),
    ...noises.filter(s=>s.on).map((s,i)=>({s,lbl:"Noise"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"noise",unit:i})),
    ...envs.filter(s=>s.on).map((s,i)=>({s,lbl:"Env"+(s.identifier?" ("+s.identifier+")":""),type:"env",unit:i})),
    ...hfvs.filter(s=>s.on).map((s,i)=>({s,lbl:"HF Vibration"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"hfv",unit:i})),
    ...shos.filter(s=>s.on).map((s,i)=>({s,lbl:"Shock (Other)"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"sho",unit:i})),
    ...dcms.filter(s=>s.on).map((s,i)=>({s,lbl:"DCM"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"dcm",unit:i})),
    ...pqs.filter(s=>s.on).map((s,i)=>({s,lbl:"PQ"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"pq",unit:i})),
    ...emis.filter(s=>s.on).map((s,i)=>({s,lbl:"EMI"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"emi",unit:i})),
    ...abs.filter(s=>s.on).map((s,i)=>({s,lbl:"Airborne Noise"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"ab",unit:i})),
    ...sbs.filter(s=>s.on).map((s,i)=>({s,lbl:"Structureborne Noise"+(i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):""),type:"sb",unit:i})),
  ];
  const procSecs=allSections.filter(({s})=>s.proc);
  const repSecs=allSections.filter(({s})=>s.report);

  // Get unique unit indices that have any procs/reports
  const procUnits=[...new Set(procSecs.map(x=>x.unit))].sort((a,b)=>a-b);
  const repUnits=[...new Set(repSecs.map(x=>x.unit))].sort((a,b)=>a-b);

  const addProcRepForUnit=(sections,type,unitIdx)=>{
    // type: 'proc' or 'rep'
    const unitSecs=sections.filter(x=>x.unit===unitIdx);
    if(unitSecs.length===0)return;
    const PRICES=type==='proc'?PROC_PRICES:REP_PRICES;
    const baseCode=type==='proc'?'42':'41';
    const specialCode=type==='proc'?'44':'43';
    const isUnit1=unitIdx===0;
    const unitLabel=unitIdx>0?" (Unit "+(unitIdx+1)+")":"";

    if(splitProcReport){
      unitSecs.forEach(({lbl,type:t})=>{
        const price=PRICES[t]||(type==='proc'?PROC_BASE:REPORT_BASE);
        const code=(t==="emi"||t==="dcm"||t==="pq")?specialCode:baseCode;
        const lineLabel=lbl+(type==='proc'?" – Test Procedure":" – Test Report");
        currentUnit=unitIdx; add(lineLabel,price,null,code);
      });
    } else {
      if(unitSecs.length===1){
        const {lbl,type:t}=unitSecs[0];
        const price=PRICES[t]||(type==='proc'?PROC_BASE:REPORT_BASE);
        const code=(t==="emi"||t==="dcm"||t==="pq")?specialCode:baseCode;
        const lineLabel=lbl+(type==='proc'?" – Test Procedure":" – Test Report");
        currentUnit=unitIdx; add(lineLabel,price,null,code);
      } else {
        const maxPrice=Math.max(...unitSecs.map(({type:t})=>PRICES[t]||(type==='proc'?PROC_BASE:REPORT_BASE)));
        const combined=Math.round((maxPrice+maxPrice*0.075*(unitSecs.length-1))/25)*25;
        const hasSpecial=unitSecs.some(({type:t})=>t==="emi"||t==="dcm"||t==="pq");
        const lineLabel=(isUnit1?"Combined ":"Combined ")+(type==='proc'?"Test Procedure":"Test Report")+unitLabel;
        currentUnit=unitIdx; add(lineLabel,combined,null,hasSpecial?specialCode:baseCode);
      }
    }
  };

  procUnits.forEach(u=>addProcRepForUnit(procSecs,'proc',u));
  repUnits.forEach(u=>addProcRepForUnit(repSecs,'rep',u));

  // Global proc/report/coc rows — procs go to procLines, reps/coc go to repLines via their codes
  (globalPR?.procs||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Test Procedure",r.price,null,r.code||"42");});
  (globalPR?.reps||[]).forEach(r=>{if(sf(r.price)>0)add(r.label||"Test Report",r.price,null,r.code||"41");});
  if(globalPR?.coc)add("Certificate of Compliance",globalPR.cocPrice||"250",null,"41");
  // Fixture Drawing (code 42, sorts before modal analysis and EMI/PQ/DCM procs)
  if(fixtureDrawing?.on)add("Fixture Drawings",fixtureDrawing.price||"2950",null,"42");
  // Modal Analysis (code 67, sorts after fixture drawing, before EMI/PQ/DCM procs)
  if(modalAnalysis?.on){
    // If in-stock modal applies to a proc line, bump that proc's price to 3750
    // (handled by inStockModal state on the proc side — modal analysis itself is always added)
    add("Modal Analysis",modalAnalysis.price||"6750",null,"67");
  }
  // Sort: procs first, then test lines grouped by unit, then reports last
  const procLines=lines.filter(l=>l.code==="42"||l.code==="44"||l.label.toLowerCase().includes("procedure"));
  const repLines=lines.filter(l=>l.code==="41"||l.code==="43"||l.label.toLowerCase().includes("test report")||l.label.toLowerCase().includes("combined test report"));
  const mainLines=lines.filter(l=>!procLines.includes(l)&&!repLines.includes(l)&&l.code!=="67");

  // Separate Tear Down from mainLines — it needs special placement
  const tdLine=mainLines.find(l=>l.label==="Tear Down");
  const mainNoTd=mainLines.filter(l=>l.label!=="Tear Down");

  // Split mainLines into mechanical (vib/shock/noise/env/hfv/sho/ab/sb/inst) vs shift-based (emi/pq/dcm)
  const SHIFT_CODES=new Set(["51"]);
  const mechLines=mainNoTd.filter(l=>!SHIFT_CODES.has(l.code));
  const shiftLines=mainNoTd.filter(l=>SHIFT_CODES.has(l.code));

  // Sort by seq — calcSummary inserts lines in correct display order
  mechLines.sort((a,b)=>(a.seq||0)-(b.seq||0));
  shiftLines.sort((a,b)=>(a.seq||0)-(b.seq||0));

  // Tear Down goes after all mechanical lines, before shift-based lines
  const sortedMain=[...mechLines,...(tdLine?[tdLine]:[]),...shiftLines];
  // Proc order: general procs (42) first, then EMI (44), then DCM (44), then PQ (44)
  // Fixture drawings and modal analysis use codes 42 and 67 — sort them between regular procs and EMI/PQ/DCM
  const allProcAndSpecial=[...procLines,...lines.filter(l=>l.code==="67")];
  const sortedProcs=allProcAndSpecial.sort((a,b)=>{
    const order=l=>{
      if(l.label.toLowerCase().includes("fixture drawing"))return 1;
      if(l.code==="67"||l.label.toLowerCase().includes("modal analysis"))return 2;
      if(l.label.toLowerCase().includes("emi"))return 3;
      if(l.label.toLowerCase().includes("dc mag")||l.label.toLowerCase().includes("dcm"))return 4;
      if(l.label.toLowerCase().includes("pq")||l.label.toLowerCase().includes("power quality"))return 5;
      return 0;
    };
    return order(a)-order(b);
  });
  // Report order: general (41) first, then EMI (43), then DCM, then PQ
  const sortedReps=repLines.sort((a,b)=>{
    const order=l=>{
      if(l.label.toLowerCase().includes("emi"))return 2;
      if(l.label.toLowerCase().includes("dc mag")||l.label.toLowerCase().includes("dcm"))return 3;
      if(l.label.toLowerCase().includes("pq")||l.label.toLowerCase().includes("power quality"))return 4;
      return 1;
    };
    return order(a)-order(b);
  });
  const sorted=[...sortedProcs,...sortedMain,...sortedReps].filter(l=>l.val>0||l.userDefined);
  // Apply in-stock modal analysis price override to the targeted procedure line
  if(inStockModal?.on&&inStockModal.targetProc){
    const target=sorted.find(l=>l.label===inStockModal.targetProc);
    if(target){target.val=3750;target.display="$3,750";}
  }
  const setupLineLabels=sorted.filter(l=>l.label.toLowerCase().includes("setup")).map(l=>l.label);
  return{lines:sorted,total:sorted.reduce((s,l)=>s+l.val,0),setupLineLabels};
}

// ── Combine manual + auto-generated specs (append new lines, don't replace) ──
function combineSpecs(manual, auto){
  const m=(manual||"").trim();
  const a=(auto||"").trim();
  if(!m)return a;
  if(!a)return m;
  const newLines=a.split("\n\n").filter(line=>!m.includes(line.trim()));
  return newLines.length?m+"\n\n"+newLines.join("\n\n"):m;
}

// ── Auto-specs helper ─────────────────────────────────────────────────────────
function buildSpecs(vibs,shocks,noises,envs,hfvs,shos,dcms,emis,pqs,abs,sbs){
  const lines=[];
  const sc=spec=>spec?" in accordance with "+spec:"";
  vibs.filter(s=>s.on&&s.spec).forEach((s,i)=>{
    const fp=s.freqRange?", "+s.freqRange+" Hz":"";
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    lines.push("Type I Vibration"+pre+sc(s.spec)+fp+".");
  });
  shocks.filter(s=>s.on&&s.spec).forEach((s,i)=>{
    const parts=[];
    if(s.grade)parts.push("Grade "+s.grade);
    if(s.class_)parts.push("Class "+s.class_);
    if(s.type_)parts.push("Type "+s.type_);
    // Location — append "Mounted" for all options
    const loc=s.location||"Hull";
    const locStr=loc+" Mounted";
    if(s.submarine)parts.push("Submarine");
    parts.push(locStr);
    const orientStr=s.orientation&&s.orientation!=="Unrestricted"?s.orientation+" Orientation":"Unrestricted Orientation";
    parts.push(orientStr);
    if(s.blows)parts.push(s.blows+" blows");
    const det=parts.length?", "+parts.join(", "):"";
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    lines.push(s.cat+" Shock"+pre+sc(s.spec)+det+".");
  });
  noises.filter(s=>s.on).forEach((s,i)=>{
    const oasp=s.oaspl?", "+s.oaspl+" OASPL":"";
    const dur=s.durVal?" for "+s.durVal+" "+s.durUnit:"";
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    lines.push("Noise Susceptibility"+pre+sc(s.spec)+oasp+dur+".");
  });
  envs.filter(s=>s.on).forEach((s,i)=>{
    const pre=s.identifier?" ("+s.identifier+")":"";
    const thMap={"Temperature & Humidity":"Temperature & Humidity","Temperature Only":"Temperature","Humidity Only":"Humidity"};
    const it=s.items||{};
    if(it.th?.on){const t=thMap[s.thType]||s.thType;const customDur=s.thDurVal?(s.thDurVal+" "+(s.thDurUnit||"hours")):s.thDur?s.thDur:"";const dur=customDur?", "+customDur:"";lines.push(t+" testing"+pre+sc(it.th.spec||s.spec)+dur+".");}
    if(it.sf?.on)lines.push("Salt Fog testing"+pre+sc(it.sf.spec||s.spec)+".");
    if(it.alt?.on){const dw=s.altDwell?", "+s.altDwell+" dwell":"";lines.push("Altitude testing"+pre+sc(it.alt.spec||s.spec)+dw+".");}
    if(it.ess?.on){const dur=s.essDur||"10 minutes";lines.push("ESS testing"+pre+sc(it.ess.spec||s.spec)+", "+dur+" per axis.");}
    if(it.acc?.on)lines.push("Acceleration testing"+pre+sc(it.acc.spec||s.spec)+".");
    if(it.incl?.on)lines.push("Inclination testing"+pre+sc(it.incl.spec||s.spec)+".");
    if(it.rd?.on)lines.push("Rapid Decompression testing"+pre+sc(it.rd.spec||s.spec)+".");
    if(it.ed?.on)lines.push("Explosive Decompression testing"+pre+sc(it.ed.spec||s.spec)+".");
    if(it.drip?.on)lines.push("Drip Test"+pre+sc(it.drip.spec||s.spec)+".");
    if(it.sub?.on)lines.push("Submergence testing"+pre+sc(it.sub.spec||s.spec)+".");
    if(it.spray?.on)lines.push("Spray Test"+pre+sc(it.spray.spec||s.spec)+".");
  });
  hfvs.filter(s=>s.on&&s.spec).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    lines.push("Vibration testing"+pre+sc(s.spec)+", tested for "+(s.dur||"30")+" minutes per axis.");
  });
  shos.filter(s=>s.on&&s.spec).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    if((s.shape==="Half Sine"||s.shape==="Sawtooth")&&(s.nPulses||s.gLevel||s.pDur)){
      const pulseDetails=[
        s.nPulses?"Perform "+s.nPulses:"",
        s.gLevel?s.gLevel+"g":"",
        s.pDur?s.pDur+"ms shock pulses":"",
      ].filter(Boolean).join(", ");
      lines.push("Shock testing"+pre+" in accordance with "+s.spec+". "+pulseDetails+".");
    } else if(s.shape==="Drop Shock"){
      lines.push("Drop Shock testing"+pre+" in accordance with "+s.spec+".");
    } else if(s.shape==="Bench Handling"){
      lines.push("Bench Handling Shock testing"+pre+" in accordance with "+s.spec+".");
    } else {
      lines.push("Shock testing"+pre+sc(s.spec)+".");
    }
  });
  dcms.filter(s=>s.on&&s.spec).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    lines.push("DC Magnetics"+pre+" in accordance with "+s.spec+".");
  });
  emis.filter(s=>s.on).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const selectedRev=Object.entries(s.revs||{}).filter(([,v])=>v).map(([k])=>k.replace("Rev ",""))[0]||"";
    const specStr=s.spec?s.spec:("MIL-STD-461"+selectedRev);
    if(!specStr)return;
    const plats=Object.entries(s.plats||{}).filter(([,v])=>v).map(([k])=>k.toLowerCase());
    const locs=Object.entries(s.locs||{}).filter(([,v])=>v).map(([k])=>k.toLowerCase()+" applications");
    const parts=[specStr,...plats,...locs];
    lines.push("EMI testing"+pre+" in accordance with "+parts.join(", ")+".");
  });
  pqs.filter(s=>s.on).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const hasPart1=Object.entries(s.rows||{}).some(([k,v])=>v&&!k.includes("300b"));
    const has300b=Object.entries(s.rows||{}).some(([k,v])=>v&&k.includes("5.3.3"));
    if(hasPart1)lines.push("Power Quality testing"+pre+" in accordance with MIL-STD-1399, Section 300 Part 1.");
    if(has300b)lines.push("Power Quality testing"+pre+" in accordance with MIL-STD-1399, Section 300B.");
  });
  abs.filter(s=>s.on).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const spec=s.spec||("MIL-STD-"+s.rev);
    lines.push("Airborne Noise testing"+pre+" in accordance with "+spec+".");
  });
  sbs.filter(s=>s.on).forEach((s,i)=>{
    const pre=i>0?" #"+(i+1)+(s.identifier?" ("+s.identifier+")":""):"";
    const spec=s.spec||("MIL-STD-"+s.rev);
    lines.push("Structureborne Noise testing"+pre+" in accordance with "+spec+".");
  });
  return lines.join("\n\n");
}



// ── Account Dashboard Modal ───────────────────────────────────────────────────
function AccountDashboard({accountName, onClose, onLoadQuote, onNewQuote}){
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedYear, setExpandedYear] = useState(null);

  useEffect(()=>{
    if(!accountName)return;
    (async()=>{
      setLoading(true);
      // Fetch all quotes for this exact account name
      let allRows=[], from=0, batch=500;
      while(true){
        let rows = null;
        try {
          rows = await restFetch("GET",
            `quotes?select=id,opportunity,revision,stage,total,won_date,data,source,created_at&customer=eq.${encodeURIComponent(accountName)}&order=opportunity.desc&limit=${batch}&offset=${from}`);
        } catch(e) {
          console.error("[ACCOUNT-LOAD] failed:", e?.message||e);
          break;
        }
        if(!rows||rows.length===0)break;
        allRows=allRows.concat(rows);
        if(rows.length<batch)break;
        from+=batch;
      }

      // Group by year prefix from opportunity number
      const yearMap={};
      allRows.forEach(row=>{
        const opp=row.opportunity||"";
        const match=opp.match(/^(\d{2})-/);
        const yr=match?"20"+match[1]:"Unknown";
        if(!yearMap[yr])yearMap[yr]={year:yr,quotes:[],wonCount:0,wonTotal:0,total:0,count:0};
        const total=row.total||0;
        const isWon=row.stage==="Closed Won";
        const rev=row.data?.qi?.rev||row.revision||"";
        yearMap[yr].quotes.push({
          id:row.id,
          opp:opp,
          rev,
          stage:row.stage||"",
          total,
          data:row.data,
          source:row.source,
        });
        yearMap[yr].count++;
        yearMap[yr].total+=total;
        if(isWon){yearMap[yr].wonCount++;yearMap[yr].wonTotal+=total;}
      });

      // Sort years newest first, Unknown at bottom
      const years=Object.values(yearMap).sort((a,b)=>{
        if(a.year==="Unknown")return 1;
        if(b.year==="Unknown")return-1;
        return b.year.localeCompare(a.year);
      });

      const lifetimeCount=allRows.length;
      const lifetimeTotal=allRows.reduce((a,r)=>a+(r.total||0),0);
      const lifetimeWon=allRows.filter(r=>r.stage==="Closed Won").length;
      const winRate=lifetimeCount>0?Math.round((lifetimeWon/lifetimeCount)*100):0;

      setData({years, lifetimeCount, lifetimeTotal, lifetimeWon, winRate});
      setLoading(false);
    })();
  },[accountName]);

  const money=n=>"$"+Math.round(n).toLocaleString();
  const stageColor=s=>{
    if(!s)return"#9aa5b1";
    if(s.includes("Won"))return"#1e8449";
    if(s.includes("Lost")||s.includes("Cancelled"))return"#c0392b";
    if(s.includes("Pending")||s.includes("RFQ"))return"#b7791f";
    return"#6b7a8d";
  };

  return(
    <div style={{position:"fixed",inset:0,zIndex:4000,background:"rgba(0,0,0,0.5)",
      display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:48}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:14,width:780,maxWidth:"95vw",maxHeight:"85vh",
        boxShadow:"0 8px 40px rgba(0,0,0,0.3)",display:"flex",flexDirection:"column"}}>

        {/* Header */}
        <div style={{padding:"20px 28px",borderBottom:"1px solid #e8ecf0",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:4}}>
                ACCOUNT DASHBOARD
              </div>
              <div style={{fontSize:20,fontWeight:800,color:"#1a2332"}}>{accountName}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button
                onClick={()=>{onNewQuote&&onNewQuote(accountName);onClose();}}
                style={{background:"#1a5276",border:"none",borderRadius:7,padding:"7px 16px",
                  color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:.5}}>
                + New Quote
              </button>
              <button onClick={onClose}
                style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#6b7a8d",marginTop:-4}}>
                ×
              </button>
            </div>
          </div>
          {!loading&&data&&(
            <div style={{display:"flex",gap:28,marginTop:14,flexWrap:"wrap"}}>
              {[
                {label:"Total Quotes",val:data.lifetimeCount},
                {label:"Lifetime Value",val:money(data.lifetimeTotal)},
                {label:"Closed Won",val:data.lifetimeWon},
                {label:"Win Rate",val:data.winRate+"%"},
              ].map(({label,val})=>(
                <div key={label}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:1,color:"#9aa5b1"}}>{label}</div>
                  <div style={{fontSize:18,fontWeight:800,color:"#1a2332",marginTop:2}}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 28px"}}>
          {loading?(
            <div style={{textAlign:"center",padding:60,color:"#9aa5b1",fontSize:13}}>Loading…</div>
          ):!data||data.years.length===0?(
            <div style={{textAlign:"center",padding:60,color:"#9aa5b1",fontSize:13}}>No quotes found for this account</div>
          ):(
            <>
              {/* Column headers */}
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 1fr 1fr 60px",
                gap:8,padding:"6px 12px",
                fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:4}}>
                <div>YEAR</div><div>QUOTES</div><div>TOTAL VALUE</div>
                <div>CLOSED WON</div><div>WON VALUE</div><div>WIN %</div>
              </div>
              {data.years.map(y=>{
                const winPct=y.count>0?Math.round((y.wonCount/y.count)*100):0;
                const isOpen=expandedYear===y.year;
                return(
                  <div key={y.year} style={{marginBottom:6}}>
                    {/* Year row */}
                    <div
                      onClick={()=>setExpandedYear(isOpen?null:y.year)}
                      style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 1fr 1fr 60px",
                        gap:8,padding:"10px 12px",borderRadius:8,cursor:"pointer",
                        background:isOpen?"#f0f4ff":"#f8f9fb",
                        border:"1px solid "+(isOpen?"#1a5276":"#e8ecf0"),
                        transition:"all .15s"}}>
                      <div style={{fontWeight:800,fontSize:14,color:y.year==="Unknown"?"#9aa5b1":"#1a2332"}}>
                        {y.year}
                      </div>
                      <div style={{fontSize:12,color:"#1a2332",fontWeight:600}}>{y.count}</div>
                      <div style={{fontSize:12,color:"#1a5276",fontWeight:600}}>{money(y.total)}</div>
                      <div style={{fontSize:12,color:"#1e8449",fontWeight:600}}>{y.wonCount}</div>
                      <div style={{fontSize:12,color:"#1e8449",fontWeight:600}}>{money(y.wonTotal)}</div>
                      <div style={{fontSize:12,color:winPct>=50?"#1e8449":"#6b7a8d",fontWeight:600,
                        display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        {winPct}%
                        <span style={{fontSize:10,color:"#9aa5b1"}}>{isOpen?"▲":"▼"}</span>
                      </div>
                    </div>
                    {/* Expanded quote list */}
                    {isOpen&&(
                      <div style={{marginTop:4,marginLeft:12,borderLeft:"2px solid #1a5276",paddingLeft:12}}>
                        <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr",
                          gap:8,padding:"4px 8px",
                          fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:2}}>
                          <div>OPPORTUNITY</div><div>STAGE</div><div style={{textAlign:"right"}}>TOTAL</div>
                        </div>
                        {y.quotes.map(q=>(
                          <div key={q.id}
                            onClick={()=>{
                              const blob=q.data||{};
                              onLoadQuote({
                                ...blob,
                                id:q.id,
                                opp:q.opp||blob.opp,
                                rev:q.rev||blob.qi?.rev||"",
                                customer:accountName,
                                total:q.total||blob.total,
                                source:blob.source||q.source||"nuforce",
                              });
                              onClose();
                            }}
                            style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr",
                              gap:8,padding:"7px 8px",borderRadius:6,cursor:"pointer",
                              borderBottom:"1px solid #f0f2f5",transition:"background .1s"}}
                            onMouseEnter={e=>e.currentTarget.style.background="#f0f4ff"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <div style={{fontWeight:600,fontSize:12,color:"#1a5276",
                              textDecoration:"underline",textDecorationColor:"rgba(26,82,118,0.3)"}}>
                              {q.opp||"—"}
                            </div>
                            <div style={{fontSize:11,fontWeight:600,color:stageColor(q.stage)}}>
                              {q.stage||"—"}
                            </div>
                            <div style={{fontSize:11,fontWeight:600,color:"#1a2332",textAlign:"right"}}>
                              {money(q.total||0)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({onEnterQuote, onLoadQuote, onNewQuoteForAccount, currentUser, isApprover, isFollowUpUser, pendingQuotes, onQueueDecision, needsRefresh, onRefreshComplete}){
  const [data, setData]       = useState(null);
  const [qSelected, setQSelected] = useState(new Set());
  const [qComments, setQComments] = useState("");
  const [acctSearch, setAcctSearch]   = useState("");
  const [acctResults, setAcctResults] = useState([]);
  const [acctOpen, setAcctOpen]       = useState(false);
  const [acctModal, setAcctModal]     = useState(null); // account name string
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState(null); // for Last-4-Months chart tooltip
  // Last-4-Months chart: "count" shows quote counts, "value" shows dollar totals.
  // Persisted in localStorage so the user's preferred view sticks across sessions.
  const [chartMode, setChartMode] = useState(
    () => localStorage.getItem("nuforce_chart_mode") === "value" ? "value" : "count"
  );
  useEffect(()=>{
    localStorage.setItem("nuforce_chart_mode", chartMode);
  },[chartMode]);
  // Ready to Send widget state — { mode: 'send'|'dismiss', row: {id, opportunity, ...} } | null
  const [rtsConfirm, setRtsConfirm] = useState(null);
  const [rtsBusy, setRtsBusy] = useState(false);
  const acctRef  = useRef(null);
  const acctTimer = useRef(null);

  // Debounced account search against distinct customer values in quotes table
  useEffect(()=>{
    clearTimeout(acctTimer.current);
    if(!acctSearch.trim()){setAcctResults([]);setAcctOpen(false);return;}
    acctTimer.current=setTimeout(async()=>{
      const t = acctSearch.trim().toLowerCase();
      try {
        // Quotes the term so commas/parens in account names don't break the ilike pattern.
        const path = `quotes?select=customer&customer=ilike.${encodeURIComponent(`*${t}*`)}&limit=200`;
        const rows = await restFetch("GET", path);
        const seen = new Set();
        const unique = (rows||[]).map(r=>r.customer).filter(n=>{
          if(!n || seen.has(n)) return false;
          seen.add(n); return true;
        }).sort();
        setAcctResults(unique);
        setAcctOpen(unique.length>0);
      } catch(e) {
        console.warn("[ACCT-LOOKUP] failed:", e?.message||e);
        setAcctResults([]);
        setAcctOpen(false);
      }
    },250);
    return()=>clearTimeout(acctTimer.current);
  },[acctSearch]);

  // Close account dropdown on outside click
  useEffect(()=>{
    const h=e=>{if(acctRef.current&&!acctRef.current.contains(e.target))setAcctOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  const [loading, setLoading] = useState(true);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [showNewCampaignForm, setShowNewCampaignForm] = useState(false);

  // Load campaigns list
  const loadCampaigns = async () => {
    setCampaignsLoading(true);
    let data = [];
    try {
      data = await restFetch("GET",
        `campaigns?select=id,name,description,created_at&order=created_at.desc`);
    } catch(e) {
      console.error("[LOAD-CAMPAIGNS] failed:", e?.message||e);
    }
    setCampaigns(data || []);
    setCampaignsLoading(false);
  };

  // Open modal & load — always starts unselected
  const openCampaignsModal = () => {
    setCampaignsOpen(true);
    setSelectedCampaignId(null);
    loadCampaigns();
  };

  // Create campaign
  const createCampaign = async () => {
    const name = newCampaignName.trim();
    if (!name) return;
    let row = null;
    try {
      const rows = await restFetch("POST", "campaigns",
        {body:[{name, description: newCampaignDesc.trim() || null}], returnRepresentation:true});
      row = (rows||[])[0];
    } catch(e) {
      alert("Could not create campaign: " + (e?.message||e));
      return;
    }
    if (!row) {
      alert("Could not create campaign: no row returned");
      return;
    }
    // Newest at top
    setCampaigns(prev => [row, ...prev]);
    setNewCampaignName("");
    setNewCampaignDesc("");
    setShowNewCampaignForm(false);
    setSelectedCampaignId(row.id);
  };

  // Delete campaign (memberships cascade)
  const deleteCampaign = async (id) => {
    const c = campaigns.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Delete campaign "${c.name}"? Contacts themselves won't be deleted, only their membership in this campaign.`)) return;
    try {
      await restFetch("DELETE", `campaigns?id=eq.${encodeURIComponent(id)}`);
    } catch(e) {
      alert("Could not delete: " + (e?.message||e));
      return;
    }
    setCampaigns(prev => prev.filter(x => x.id !== id));
    if (selectedCampaignId === id) setSelectedCampaignId(null);
  };

  // ── Stage 2: campaign contacts ──
  const [campaignContacts, setCampaignContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsHasPhone, setContactsHasPhone] = useState(true); // optimistic; flips false if column doesn't exist
  const [contactSearchTerm, setContactSearchTerm] = useState("");
  const [contactSearchResults, setContactSearchResults] = useState([]);
  const [contactSearchOpen, setContactSearchOpen] = useState(false);
  const contactSearchTimer = useRef(null);

  // Build contact select string based on whether phone column exists
  const contactSelect = () => contactsHasPhone
    ? "id,first_name,last_name,email,phone,client_id,clients(name)"
    : "id,first_name,last_name,email,client_id,clients(name)";

  // Load contacts in selected campaign (joined with contact details + client name)
  const loadCampaignContacts = async (campaignId) => {
    if (!campaignId) { setCampaignContacts([]); return; }
    setContactsLoading(true);
    let data = null;
    try {
      data = await restFetch("GET",
        `campaign_contacts?select=${encodeURIComponent("contact_id,added_at,contacts("+contactSelect()+")")}&campaign_id=eq.${encodeURIComponent(campaignId)}`);
    } catch(e) {
      if (contactsHasPhone && /phone/i.test(e?.message || "")) {
        setContactsHasPhone(false);
        try {
          data = await restFetch("GET",
            `campaign_contacts?select=${encodeURIComponent("contact_id,added_at,contacts(id,first_name,last_name,email,client_id,clients(name))")}&campaign_id=eq.${encodeURIComponent(campaignId)}`);
        } catch(e2) {
          console.error("[LOAD-CAMPAIGN-CONTACTS retry] failed:", e2?.message||e2);
          setCampaignContacts([]);
          setContactsLoading(false);
          return;
        }
      } else {
        console.error("[LOAD-CAMPAIGN-CONTACTS] failed:", e?.message||e);
        setCampaignContacts([]);
        setContactsLoading(false);
        return;
      }
    }
    const flat = (data || []).map(r => ({
      contact_id: r.contact_id,
      added_at: r.added_at,
      ...r.contacts,
      company: r.contacts?.clients?.name || "",
    })).sort((a,b) => (a.last_name||"").localeCompare(b.last_name||""));
    setCampaignContacts(flat);
    setContactsLoading(false);
  };

  // Auto-load contacts when selectedCampaignId changes
  useEffect(() => {
    loadCampaignContacts(selectedCampaignId);
    // Clear add-search state on campaign switch
    setContactSearchTerm("");
    setContactSearchResults([]);
    setContactSearchOpen(false);
  }, [selectedCampaignId]);

  // Debounced contact search across name+email — multi-word support; flags already-added
  useEffect(() => {
    clearTimeout(contactSearchTimer.current);
    if (!contactSearchTerm.trim() || !selectedCampaignId) {
      setContactSearchResults([]);
      return;
    }
    contactSearchTimer.current = setTimeout(async () => {
      const term = contactSearchTerm.trim();
      const tokens = term.split(/\s+/).filter(Boolean);
      const firstToken = tokens[0];
      // Server-side: match the FIRST token against any of first_name/last_name/email
      // Then client-side filter requires ALL tokens to appear somewhere in (first_name + " " + last_name + " " + email)
      const orParam = `or=(first_name.ilike.*${encodeURIComponent(firstToken)}*,last_name.ilike.*${encodeURIComponent(firstToken)}*,email.ilike.*${encodeURIComponent(firstToken)}*)`;
      let data = null;
      try {
        data = await restFetch("GET",
          `contacts?select=${encodeURIComponent(contactSelect())}&${orParam}&order=last_name&limit=50`);
      } catch(e) {
        if (contactsHasPhone && /phone/i.test(e?.message || "")) {
          setContactsHasPhone(false);
          try {
            data = await restFetch("GET",
              `contacts?select=id,first_name,last_name,email,client_id,clients(name)&${orParam}&order=last_name&limit=50`);
          } catch(e2) {
            console.error("[CAMPAIGN-CONTACT-SEARCH retry] failed:", e2?.message||e2);
            setContactSearchResults([]);
            return;
          }
        } else {
          console.error("[CAMPAIGN-CONTACT-SEARCH] failed:", e?.message||e);
          setContactSearchResults([]);
          return;
        }
      }
      // Client-side: every token must appear in (first + last + email + company)
      const matches = (data || []).filter(c => {
        const haystack = ((c.first_name||"")+" "+(c.last_name||"")+" "+(c.email||"")+" "+(c.clients?.name||"")).toLowerCase();
        return tokens.every(t => haystack.includes(t.toLowerCase()));
      });
      // Mark already-in-campaign contacts so the dropdown can show a tag
      const existing = new Set(campaignContacts.map(c => c.id));
      const annotated = matches.map(c => ({ ...c, _alreadyInCampaign: existing.has(c.id) }));
      // Sort: not-yet-added first, then already-added
      annotated.sort((a,b) => {
        if (a._alreadyInCampaign !== b._alreadyInCampaign) return a._alreadyInCampaign ? 1 : -1;
        return (a.last_name||"").localeCompare(b.last_name||"");
      });
      setContactSearchResults(annotated.slice(0, 25));
    }, 250);
    return () => clearTimeout(contactSearchTimer.current);
  }, [contactSearchTerm, selectedCampaignId, campaignContacts, contactsHasPhone]);

  // Add a contact to selected campaign
  const addContactToCampaign = async (contact) => {
    if (!selectedCampaignId) return;
    try {
      await restFetch("POST", "campaign_contacts",
        {body:[{campaign_id: selectedCampaignId, contact_id: contact.id}]});
    } catch(e) {
      // Likely duplicate key — silently re-load
      console.error("[CAMPAIGN-ADD-CONTACT] failed:", e?.message||e);
    }
    setContactSearchTerm("");
    setContactSearchResults([]);
    setContactSearchOpen(false);
    loadCampaignContacts(selectedCampaignId);
  };

  // Remove a contact from the selected campaign
  const removeContactFromCampaign = async (contactId) => {
    if (!selectedCampaignId) return;
    const c = campaignContacts.find(x => x.id === contactId);
    const name = c ? ((c.first_name||"") + " " + (c.last_name||"")).trim() || c.email || "this contact" : "this contact";
    if (!confirm(`Remove ${name} from this campaign? (The contact record itself is not deleted.)`)) return;
    try {
      await restFetch("DELETE",
        `campaign_contacts?campaign_id=eq.${encodeURIComponent(selectedCampaignId)}&contact_id=eq.${encodeURIComponent(contactId)}`);
    } catch(e) {
      alert("Could not remove: " + (e?.message||e));
      return;
    }
    setCampaignContacts(prev => prev.filter(x => x.id !== contactId));
  };
  const [followUpsCollapsed, setFollowUpsCollapsed] = useState(true);
  const [quotesThisMonthCollapsed, setQuotesThisMonthCollapsed] = useState(true);
  const [quotesThisMonthFilter, setQuotesThisMonthFilter] = useState("new"); // "all" | "new" | "revisions"
  const [showRecentApproved, setShowRecentApproved] = useState(false);
  const [recentApproved, setRecentApproved] = useState(null);
  const [recentApprovedLoading, setRecentApprovedLoading] = useState(false);
  const [recentDays, setRecentDays] = useState(7);
  const [showPrevMonth, setShowPrevMonth] = useState(false);
  const [prevMonthData, setPrevMonthData] = useState(null);
  const [prevMonthLoading, setPrevMonthLoading] = useState(false);
  // Tracks which Closed Won breakdown card is hovered ("new" | "ex" | null) so
  // we can show a popover listing the underlying quotes for that bucket.
  const [pmWonHover, setPmWonHover] = useState(null);
  // ── Product Codes report state ────────────────────────────────────────────
  // codeReportData: flat array of { code, label, price, opp, customer, stage,
  //   year, quoteId, lineLabel, src }. One entry per code-bearing line item across
  //   all quotes. Loaded fresh on panel open. Year derived from opp prefix.
  const [codeReportLoading, setCodeReportLoading] = useState(false);
  const [codeReportData, setCodeReportData] = useState(null);   // null = not loaded yet
  const [codeReportYear, setCodeReportYear] = useState("all");  // "all" | "2026" | etc | "unknown"
  const [codeReportCode, setCodeReportCode] = useState("");     // empty = no code chosen
  const [codeReportPanelOpen, setCodeReportPanelOpen] = useState(false);
  // Code Comparison panel — two codes selected, charted across all history
  const [codeCompareOpen, setCodeCompareOpen] = useState(false);
  const [codeCompareA, setCodeCompareA] = useState("");
  const [codeCompareB, setCodeCompareB] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(()=>{
    // Default to last completed month (never current or future)
    const d = new Date();
    const m = d.getMonth(); // 0-indexed current month
    return {
      month: m === 0 ? 11 : m - 1,
      year:  m === 0 ? d.getFullYear() - 1 : d.getFullYear()
    };
  });
  const [followUps, setFollowUps]   = useState([]);
  const [fuLoading, setFuLoading]   = useState(false);
  const [flaggedQuotes,setFlaggedQuotes]=useState([]);
  const [flagsLoading,setFlagsLoading]=useState(false);
  const [aiInput,setAiInput]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [aiMessages,setAiMessages]=useState([]);

  const askAI = async (question) => {
    if(!question.trim()||aiLoading) return;
    const userMsg = {role:'user', content: question};
    setAiMessages(prev=>[...prev, userMsg]);
    setAiInput("");
    setAiLoading(true);
    try {
      // Fetch quotes — rich data for Claude to reason about
      let quotes = [];
      try {
        quotes = await restFetch("GET",
          `quotes?select=opportunity,customer,total,created_at,won_date,data&order=created_at.desc&limit=1000`) || [];
      } catch(e) {
        console.warn("[AI-FETCH quotes] failed:", e?.message||e);
      }

      let followUpsData = [];
      try {
        followUpsData = await restFetch("GET",
          `follow_ups?select=opportunity,customer,sent_at,followed_up,followup_again_at&followed_up=eq.false&limit=500`) || [];
      } catch(e) {
        console.warn("[AI-FETCH followups] failed:", e?.message||e);
      }

      // Build compact but rich summary — enough for Claude to answer specific questions
      const quoteSummary = (quotes||[]).map(q=>{
        const d=q.data||{};
        const tests=[];
        if(d.vibs?.some(s=>s.on))tests.push('Vib');
        if(d.shocks?.some(s=>s.on))tests.push('Shock');
        if(d.noises?.some(s=>s.on))tests.push('Noise');
        if(d.envs?.some(s=>s.on))tests.push('Env');
        if(d.hfvs?.some(s=>s.on))tests.push('HFV');
        if(d.emis?.some(s=>s.on))tests.push('EMI');
        if(d.pqs?.some(s=>s.on))tests.push('PQ');
        if(d.dcms?.some(s=>s.on))tests.push('DCM');
        return {
          o:q.opportunity, c:q.customer, t:q.total,
          s:d.qi?.stage||'', dt:q.created_at?.slice(0,10),
          i:d.ti?.item||'', ct:d.qi?.contact||'',
          ts:tests.join(','),
        };
      });

      const today = new Date().toISOString().slice(0,10);
      // Abbreviated keys to save tokens: o=opp,c=customer,t=total,s=stage,dt=date,i=item,ct=contact,ts=tests
      const systemPrompt = `NU Labs sales assistant. Today:${today}. Answer concisely, bullet points for lists.\nQUOTES(${quoteSummary.length})[o=opp,c=customer,t=$total,s=stage,dt=date,i=item,ct=contact,ts=tests]:${JSON.stringify(quoteSummary)}\nFOLLOWUPS(${(followUpsData||[]).length})[o=opp,c=customer,s=sent,d=due]:${JSON.stringify((followUpsData||[]).map(f=>({o:f.opportunity,c:f.customer,s:f.sent_at?.slice(0,10),d:f.followup_again_at})))}`;

      const response = await fetch(
        'https://swuuxzmgmldvvomsgmjf.supabase.co/functions/v1/ai-analysis',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3dXV4em1nbWxkdnZvbXNnbWpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjcyMzMsImV4cCI6MjA4ODQwMzIzM30.GinbXqvBHcvYRaACBhgpd_Si8-qIDDj7PlbTCINcSU8',
          },
          body: JSON.stringify({
            system: systemPrompt,
            messages: [...aiMessages, userMsg].map(m=>({role:m.role,content:m.content})),
          })
        }
      );
      const data = await response.json();
      const answer = data.content?.[0]?.text || data.text || data.error || 'Sorry, I could not get a response.';
      setAiMessages(prev=>[...prev, {role:'assistant', content:answer}]);
    } catch(e) {
      setAiMessages(prev=>[...prev, {role:'assistant', content:'Error: '+e.message}]);
    }
    setAiLoading(false);
  };

  const loadFlags = async () => {
    setFlagsLoading(true);
    try {
      const data = await restFetch("GET",
        "quote_flags?select=id,quote_id,opportunity,customer,flagged_by,flagged_at,note&resolved=eq.false&order=flagged_at.desc");
      setFlaggedQuotes(data||[]);
    } catch(e){ console.warn("[FLAGS] load failed:", e?.message||e); }
    setFlagsLoading(false);
  };

  const loadFollowUps = async () => {
    if(!isFollowUpUser)return;
    setFuLoading(true);
    const today = new Date().toISOString().slice(0,10);
    // Pull all pending follow-ups (followed_up=false). We build the family-latest
    // map from ALL pending rows, then apply the due-date and family filters
    // client-side. This lets a brand-new revision that isn't due yet still
    // suppress an older revision that IS due (otherwise the older one would
    // appear on the list incorrectly).
    let data = [];
    try {
      // PostgREST embedded join: `quotes(...)` resolves the FK from follow_ups
      // to the quotes table and selects those columns into the row.
      data = await restFetch("GET",
        `follow_ups?select=*,quotes(id,opportunity,revision,customer,data)&followed_up=eq.false&or=(voided.is.null,voided.eq.false)`);
      data = data || [];
    } catch(e) {
      console.warn("[FOLLOW-UPS-LOAD] failed:", e?.message||e);
      setFuLoading(false);
      setFollowUps([]);
      return;
    }
    {
      const rows = data || [];
      const baseOf = (opp) => {
        if(!opp) return "";
        // strip trailing single capital letter (rev letter): 26-010A -> 26-010
        const m = opp.match(/^(.+?)([A-Z])?$/);
        return m ? m[1] : opp;
      };
      // Family grouping: latest revision per opportunity family across ALL pending
      // rows (whether due or not), so a newer-but-not-due revision suppresses the
      // older revision's stale follow-up.
      const familyLatest = new Map();   // baseKey -> highest revision letter
      rows.forEach(fu => {
        const opp = fu.quotes?.opportunity || fu.opportunity || "";
        const baseKey = baseOf(opp);
        if(!baseKey) return;
        const rev = (fu.quotes?.revision || "").toString();
        const cur = familyLatest.get(baseKey);
        if(!cur || rev > cur) familyLatest.set(baseKey, rev);
      });
      // Due semantics:
      //   - row has followup_again_at: due iff that date <= today
      //     (the 30-day-from-sent rule does NOT apply once a reschedule was set)
      //   - row has no followup_again_at: due iff sent_at >= 30 days ago
      const todayMs = new Date(today + "T00:00:00").getTime();
      const thirtyMs = Date.now() - 30*24*60*60*1000;
      const isDue = (fu) => {
        if(fu.followup_again_at){
          return new Date(fu.followup_again_at).getTime() <= todayMs;
        }
        return fu.sent_at && new Date(fu.sent_at).getTime() <= thirtyMs;
      };
      const filtered = rows.filter(fu => {
        // Drop Closed Won/Closed Lost
        const stage = fu.quotes?.data?.qi?.stage || "";
        if(stage==="Closed Won" || stage==="Closed Lost") return false;
        // Drop superseded revisions
        const opp = fu.quotes?.opportunity || fu.opportunity || "";
        const baseKey = baseOf(opp);
        const rev = (fu.quotes?.revision || "").toString();
        if(familyLatest.get(baseKey) !== rev) return false;
        // Drop rows that aren't due yet
        if(!isDue(fu)) return false;
        return true;
      });
      // Sort by "oldest on the list" — when did this row first become eligible?
      //   - initial: sent_at + 30 days (would have appeared then)
      //   - rescheduled: followup_again_at (would have appeared then)
      // Earliest of those -> oldest on the list -> top.
      const dueAt = (fu) => {
        if(fu.followup_again_at) return new Date(fu.followup_again_at).getTime();
        return fu.sent_at ? new Date(fu.sent_at).getTime() + 30*24*60*60*1000 : Infinity;
      };
      filtered.sort((a,b) => dueAt(a) - dueAt(b));
      setFollowUps(filtered);
    }
    setFuLoading(false);
  };

  const markFollowedUp = async (fuId, scheduleAgain) => {
    if(scheduleAgain){
      // Primary path: record this follow-up AND set the row to reappear in 90 days.
      // The list query filters on followed_up=false AND (sent>=30d OR
      // followup_again_at<=today). Keeping followed_up=false plus a future
      // followup_again_at makes the row dormant — it will return when that
      // date arrives. We record the most recent action via followed_up_at.
      const d = new Date();
      d.setDate(d.getDate()+90);
      const update = {
        followed_up: false,
        followed_up_at: new Date().toISOString(),
        followed_up_by: currentUser,
        followup_again_at: d.toISOString().slice(0,10),
      };
      try {
        await restFetch("PATCH", `follow_ups?id=eq.${encodeURIComponent(fuId)}`, {body:update});
      } catch(e) {
        console.warn("[FU-RESCHEDULE] failed:", e?.message||e);
      }
    } else {
      // Secondary path: never show again. Clear any future reminder to be safe.
      const update = {
        followed_up: true,
        followed_up_at: new Date().toISOString(),
        followed_up_by: currentUser,
        followup_again_at: null,
      };
      try {
        await restFetch("PATCH", `follow_ups?id=eq.${encodeURIComponent(fuId)}`, {body:update});
      } catch(e) {
        console.warn("[FU-DISMISS] failed:", e?.message||e);
      }
    }
    // Either action removes the row from the visible list. Reschedules reappear
    // 90 days later via a fresh load. Permanent removals never reappear.
    setFollowUps(prev=>prev.filter(fu=>fu.id!==fuId));
  };



  const loadPrevMonth = async (mon, yr) => {
    setPrevMonthLoading(true);
    const prevStart = new Date(yr, mon, 1).toISOString();
    const prevEnd   = new Date(yr, mon + 1, 1).toISOString();
    const prevLabel = new Date(yr, mon, 1).toLocaleString("en-US",{month:"long",year:"numeric"});

    let createdRaw = [], wonRaw = [];
    try {
      [createdRaw, wonRaw] = await Promise.all([
        restFetch("GET",
          `quotes?select=id,opportunity,customer,total,data,source&created_at=gte.${encodeURIComponent(prevStart)}&created_at=lt.${encodeURIComponent(prevEnd)}`),
        restFetch("GET",
          `quotes?select=id,opportunity,customer,total,won_date,data&stage=eq.Closed%20Won&won_date=gte.${encodeURIComponent(prevStart.slice(0,10))}&won_date=lt.${encodeURIComponent(prevEnd.slice(0,10))}`),
      ]);
    } catch(e) {
      console.warn("[PREV-MONTH] failed:", e?.message||e);
      setPrevMonthData(null);
      setPrevMonthLoading(false);
      return;
    }

    const created = createdRaw || [];
    const won     = (wonRaw || []).map(q=>({...q, type:q.data?.qi?.type||"New Business", total:q.total||0}));
    const wonNew  = won.filter(q=>q.type==="New Business");
    const wonEx   = won.filter(q=>q.type==="Existing Business");

    // Top accounts
    const acctMap = {};
    created.forEach(q=>{
      const name=q.customer||q.data?.qi?.account||"(Unknown)";
      if(!acctMap[name])acctMap[name]={name,total:0,count:0};
      acctMap[name].total+=q.total||0;
      acctMap[name].count+=1;
    });
    const topAccounts=Object.values(acctMap).sort((a,b)=>b.total-a.total).slice(0,5);

    // Top product codes
    // Sources (additive): pickerLines (current standard), summary.lines (legacy),
    // custom.rows (edge case). Different field names per source.
    const pcodeMap = {};
    const addLine=(code,amount)=>{
      if(!code||!amount)return;
      if(!pcodeMap[code])pcodeMap[code]={code,total:0,count:0};
      pcodeMap[code].total+=amount;
      pcodeMap[code].count+=1;
    };
    created.forEach(q=>{
      (q.data?.pickerLines||[]).forEach(l=>addLine(l.code,sf(l.price)));
      (q.data?.summary?.lines||[]).forEach(l=>addLine(l.code,sf(l.val)));
      (q.data?.custom?.rows||[]).forEach(l=>addLine(l.pcode||l.code,sf(l.price)));
    });
    const topCodes=Object.values(pcodeMap).sort((a,b)=>b.total-a.total).slice(0,8);

    const quoteTotal = created.reduce((a,q)=>a+(q.total||0),0);
    const wonTotal   = won.reduce((a,q)=>a+(q.total||0),0);
    const wonNewTotal= wonNew.reduce((a,q)=>a+(q.total||0),0);
    const wonExTotal = wonEx.reduce((a,q)=>a+(q.total||0),0);
    const capPct     = created.length>0?Math.round((won.length/created.length)*100):0;
    const avgQuote   = created.length>0?Math.round(quoteTotal/created.length):0;

    setPrevMonthData({
      label:prevLabel, created, won, wonNew, wonEx,
      quoteCount:created.length, quoteTotal,
      wonTotal, wonNewTotal, wonExTotal,
      wonCount:won.length, wonNewCount:wonNew.length, wonExCount:wonEx.length,
      capPct, avgQuote, topAccounts, topCodes,
    });
    setPrevMonthLoading(false);
  };

  const goMonth=(mon,yr)=>{
    const now=new Date();
    // Don't allow future months
    if(yr>now.getFullYear()||(yr===now.getFullYear()&&mon>=now.getMonth()))return;
    setSelectedMonth({month:mon,year:yr});
    setPrevMonthData(null);
    loadPrevMonth(mon,yr);
  };

  const loadRecentApproved = async (days) => {
    setRecentApprovedLoading(true);
    const since = new Date(Date.now() - days*24*60*60*1000).toISOString();
    // Fetch recently approved — filter by updated_at broadly, then narrow by decidedAt client-side
    // Use a wider window (3x) to catch quotes approved recently but saved earlier
    const wideSince = new Date(Date.now() - Math.max(days,30)*3*24*60*60*1000).toISOString();
    const cols = "id,opportunity,customer,total,updated_at,approval_status,won_approval_status,data";
    let approvedData = [], wonData = [];
    try {
      [approvedData, wonData] = await Promise.all([
        restFetch("GET",
          `quotes?select=${cols}&approval_status=eq.approved&updated_at=gte.${encodeURIComponent(wideSince)}&order=updated_at.desc&limit=500`),
        restFetch("GET",
          `quotes?select=${cols}&won_approval_status=eq.won_approved&updated_at=gte.${encodeURIComponent(wideSince)}&order=updated_at.desc&limit=500`),
      ]);
      approvedData = approvedData || [];
      wonData = wonData || [];
    } catch(e) {
      console.warn("[RECENT-APPROVED] failed:", e?.message||e);
      setRecentApproved([]);
      setRecentApprovedLoading(false);
      return;
    }
    // Merge, deduplicate, then filter by actual decidedAt within the requested window
    const seen = new Set();
    const merged = [...approvedData, ...wonData]
      .filter(q => { if(seen.has(q.id))return false; seen.add(q.id); return true; });
    const rows = merged.map(q=>({
      id: q.id,
      opp: q.opportunity || q.data?.qi?.opp || "—",
      customer: q.customer || q.data?.qi?.account || "—",
      total: q.total || 0,
      updatedAt: q.updated_at,
      // Use the actual decision date from the blob, fall back to updated_at
      decidedAt: q.won_approval_status==="won_approved"
        ? (q.data?.wonApproval?.decidedAt || q.updated_at)
        : (q.data?.approval?.decidedAt || q.updated_at),
      type: q.won_approval_status==="won_approved" ? "Closed Won" : "Quote",
      decidedBy: q.won_approval_status==="won_approved"
        ? (q.data?.wonApproval?.decidedBy||"")
        : (q.data?.approval?.decidedBy||""),
    }));
    // Filter by actual decidedAt within the requested window, then sort
    const filteredRows = rows.filter(r => r.decidedAt && new Date(r.decidedAt) >= new Date(since));
    filteredRows.sort((a,b)=>new Date(b.decidedAt)-new Date(a.decidedAt));
    setRecentApproved(filteredRows);
    setRecentApprovedLoading(false);
  };

  // ── Product Codes report ──────────────────────────────────────────────────
  // The canonical PCODE_OPTS list (mirrors CustomForm and ProductPicker — would
  // be nice to share via module-level constant, but duplicating for now to
  // avoid disturbing working code).
  const CODE_REPORT_PCODES = [
    {code:"11",label:"Noise"},{code:"12",label:"AB/SB Noise"},
    {code:"32",label:"High Speed Video"},{code:"33",label:"Instrumentation"},
    {code:"41",label:"Report/CoC"},{code:"42",label:"Procedure"},
    {code:"43",label:"EMI/DC Mag/PQ Report"},{code:"44",label:"EMI/DC Mag/PQ Procedure"},
    {code:"51",label:"EMI / PQ / DC Magnetics"},{code:"52",label:"HFV/Shock Other"},
    {code:"53",label:"T&H"},{code:"54",label:"ESS"},{code:"55",label:"Salt Fog"},
    {code:"56",label:"Altitude"},{code:"57",label:"Acceleration"},{code:"58",label:"Drip/Sub/Spray"},
    {code:"59",label:"Insulation Resistance"},
    {code:"91",label:"MW Shock"},{code:"92",label:"LW Shock"},{code:"93",label:"Inclination"},
    {code:"94",label:"Vibration"},{code:"95",label:"Hydrostatic"},{code:"96",label:"Tear Down"},
    {code:"98",label:"Subcontract"},
  ];
  const codeLabelLookup = (code) => {
    const opt = CODE_REPORT_PCODES.find(p => p.code === code);
    return opt?.label || "";
  };

  const loadCodeReport = async () => {
    setCodeReportLoading(true);
    setCodeReportData(null);
    // Paginate through all quotes pulling the data blob; for each quote, extract
    // line items from pickerLines, custom.rows, and summary.lines. One report
    // entry per code-bearing line.
    const cols = "id,opportunity,customer,total,stage,won_date,created_at,source,data";
    let allQuotes = [], offset = 0, batchSize = 500;
    try {
      while(true){
        const path = `quotes?select=${cols}&order=opportunity.desc&limit=${batchSize}&offset=${offset}`;
        const data = await restFetch("GET", path);
        if(!data || data.length===0) break;
        allQuotes = allQuotes.concat(data);
        if(data.length < batchSize) break;
        offset += batchSize;
      }
    } catch(e) {
      console.warn("[CODE-REPORT-LOAD] failed:", e?.message||e);
      setCodeReportLoading(false);
      return;
    }

    // Extract line items into a flat report-friendly structure
    const yearFromOpp = (opp) => {
      if (!opp) return "unknown";
      const m = opp.match(/^(\d{2})-/);
      if (!m) return "unknown";
      // 20YY for any reasonable 2-digit prefix
      return "20" + m[1];
    };
    // Year from an ISO date string ("2024-03-15") or any other date format. Only
    // returns a year if it's plausible (2000-2099). Returns null otherwise so the
    // fallback chain can try opp prefix instead. This guards against odd values
    // in the wonDate field (some imports had non-date content there).
    const yearFromDate = (s) => {
      if (!s) return null;
      // Try a clean ISO-like prefix first: "2024-03-15" -> "2024"
      if (typeof s === "string") {
        const m = s.match(/^(\d{4})-\d{2}-\d{2}/);
        if (m) {
          const y = parseInt(m[1], 10);
          if (y >= 2000 && y <= 2099) return String(y);
        }
      }
      // Fallback: try Date parsing. Catches "3/15/2024", "March 15, 2024", etc.
      const d = new Date(s);
      if (!isNaN(d)) {
        const y = d.getFullYear();
        if (y >= 2000 && y <= 2099) return String(y);
      }
      return null;
    };
    const entries = [];
    for (const q of allQuotes) {
      const blob = q.data || {};
      // For Closed Won quotes, year buckets by WHEN THE QUOTE WAS WON, not when
      // the opp was created. Fallback chain: won_date column → wonInfo.wonDate
      // in blob (handles pre-fix SF imports) → opp prefix. For everything else
      // (open / lost / etc), use opp prefix — those don't have a meaningful
      // "won year" to bucket by.
      const isWon = (q.stage || blob.qi?.stage) === "Closed Won";
      let year;
      if (isWon) {
        year = yearFromDate(q.won_date)
            || yearFromDate(blob.wonInfo?.wonDate)
            || yearFromOpp(q.opportunity);
      } else {
        year = yearFromOpp(q.opportunity);
      }
      const common = {
        quoteId: q.id,
        opp: q.opportunity || "",
        customer: q.customer || blob.qi?.account || "(Unknown)",
        stage: q.stage || blob.qi?.stage || "",
        year,
      };
      // Source 1: pickerLines (current standard)
      (blob.pickerLines || []).forEach(l => {
        const code = (l.code || "").toString().trim();
        if (!code) return;
        entries.push({
          ...common,
          code,
          lineLabel: l.label || "",
          price: sf(l.price, 0),
          src: "picker",
        });
      });
      // Source 2: custom.rows (uses pcode)
      (blob.custom?.rows || []).forEach(l => {
        const code = (l.pcode || l.code || "").toString().trim();
        if (!code) return;
        entries.push({
          ...common,
          code,
          lineLabel: l.label || "",
          price: sf(l.price, 0),
          src: "custom",
        });
      });
      // Source 3: summary.lines (auto-generated from test sections plus the
      // contents of custom.rows — calcSummary appends every custom row as a
      // 'user line' into summary.lines). So custom and summary overlap by
      // design on any quote with custom rows. Dedup content-based: for each
      // summary line, if there's an exact match in custom.rows (same code +
      // label + price), skip it — it's the mirror, not a new line.
      const customSet = new Set((blob.custom?.rows || []).map(r => {
        const code = (r.pcode || r.code || "").toString().trim();
        const label = (r.label || "").trim();
        const price = sf(r.price, 0);
        return code + "|" + label + "|" + price;
      }));
      (blob.summary?.lines || []).forEach(l => {
        const code = (l.code || "").toString().trim();
        if (!code) return;
        const label = (l.label || "").trim();
        const price = sf(l.val, 0);
        // Skip summary lines that mirror a custom row exactly
        if (customSet.has(code + "|" + label + "|" + price)) return;
        entries.push({
          ...common,
          code,
          lineLabel: label,
          price,
          src: "summary",
        });
      });
    }
    setCodeReportData(entries);
    setCodeReportLoading(false);
  };

  const load = async () => {
    setLoading(true);
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    // Build month boundaries for current + 3 prior months
    const months = [];
    for(let i=3; i>=0; i--){
      const d   = new Date(year, month - i, 1);
      const end = new Date(year, month - i + 1, 1);
      months.push({
        label: d.toLocaleString("en-US",{month:"short", year:"numeric"}),
        start: d.toISOString(),
        end:   end.toISOString(),
        isCurrent: i === 0,
      });
    }

    // ── Quotes created this month + Closed Won this month — run in parallel ──
    const thisMonth = months[3];
    let createdRaw = [], wonRaw = [];
    try {
      [createdRaw, wonRaw] = await Promise.all([
        restFetch("GET",
          `quotes?select=id,opportunity,customer,total,created_at,revision,data,source&created_at=gte.${encodeURIComponent(thisMonth.start)}&created_at=lt.${encodeURIComponent(thisMonth.end)}&order=opportunity.asc`),
        restFetch("GET",
          `quotes?select=id,opportunity,customer,total,won_date,data&stage=eq.Closed%20Won&won_date=gte.${encodeURIComponent(thisMonth.start.slice(0,10))}&won_date=lt.${encodeURIComponent(thisMonth.end.slice(0,10))}`),
      ]);
    } catch(e) { console.warn("[DASHBOARD] thisMonth created/won:", e?.message||e); }
    const createdAll = createdRaw || [];
    // Group by base opportunity (strip trailing rev letter).
    // For each group:
    //   - "New" if ANY row in this group is the blank-rev original (means the original was created this month)
    //   - "Revision" otherwise (the original is older; only rev rows landed this month)
    // Display: keep the highest-rev row per group.
    const revRank = (r) => {
      const s = (r || "").toString().trim().toUpperCase();
      return s.length === 0 ? -1 : s.charCodeAt(0) - 64; // blank → -1, A → 1, B → 2, ...
    };
    const baseOppOf = (opp) => {
      if (!opp) return "";
      const m = opp.match(/^(.+?)([A-Z])?$/);
      return m ? m[1] : opp;
    };
    const groupMap = new Map(); // baseKey → { rows: [], hasBlank: bool, latest: row }
    for (const q of createdAll) {
      const baseKey = baseOppOf(q.opportunity) || ("__no_opp_" + q.id);
      let g = groupMap.get(baseKey);
      if (!g) { g = { rows: [], hasBlank: false, latest: null }; groupMap.set(baseKey, g); }
      g.rows.push(q);
      if (!q.revision || q.revision.toString().trim() === "") g.hasBlank = true;
      if (!g.latest || revRank(q.revision) > revRank(g.latest.revision)) g.latest = q;
    }
    // Annotate each "latest" row with bucket info, then build the displayed list
    const created = Array.from(groupMap.values())
      .map(g => ({ ...g.latest, _bucket: g.hasBlank ? "new" : "revision" }))
      .sort((a, b) => (a.opportunity || "").localeCompare(b.opportunity || "", undefined, { numeric: true }));

    // ── Also catch Closed Won quotes where won_date column is null but wonInfo has a date this month ──
    // This covers quotes where won details were saved but won_date column wasn't written (e.g. pre-fix SF imports)
    let wonNullRaw = [];
    try {
      wonNullRaw = await restFetch("GET",
        `quotes?select=id,opportunity,total,won_date,data&stage=eq.Closed%20Won&won_date=is.null&updated_at=gte.${encodeURIComponent(thisMonth.start)}&updated_at=lt.${encodeURIComponent(thisMonth.end)}`);
    } catch(e) { console.warn("[DASHBOARD] wonNullRaw:", e?.message||e); }
    const monthStart = new Date(thisMonth.start);
    const monthEnd   = new Date(thisMonth.end);
    const wonNullFiltered = (wonNullRaw||[]).filter(q => {
      const d = q.data?.wonInfo?.wonDate;
      if(!d) return false;
      const parsed = new Date(d);
      return !isNaN(parsed) && parsed >= monthStart && parsed < monthEnd;
    });
    // Merge — deduplicate by id in case any overlap
    const wonRawMerged = [...(wonRaw||[])];
    const wonRawIds = new Set(wonRawMerged.map(q=>q.id));
    wonNullFiltered.forEach(q=>{ if(!wonRawIds.has(q.id)) wonRawMerged.push(q); });

    // ── Top 10 product codes this month ──
    // Sources (additive): pickerLines (current standard), summary.lines (legacy),
    // custom.rows (edge case). Different field names per source.
    const pcodeMap = {};
    const addLine = (code, amount) => {
      if(!code || !amount) return;
      if(!pcodeMap[code]) pcodeMap[code] = {code, total:0, count:0};
      pcodeMap[code].total += amount;
      pcodeMap[code].count += 1;
    };
    created.forEach(q => {
      (q.data?.pickerLines || []).forEach(l => addLine(l.code, sf(l.price)));
      (q.data?.summary?.lines || []).forEach(l => addLine(l.code, sf(l.val)));
      (q.data?.custom?.rows || []).forEach(l => addLine(l.pcode || l.code, sf(l.price)));
    });
    const topCodes = Object.values(pcodeMap)
      .sort((a,b) => b.total - a.total)
      .slice(0, 10);

    // ── Top 5 accounts this month ──
    const acctMap = {};
    created.forEach(q => {
      const name = q.customer || q.data?.qi?.account || "(Unknown)";
      if(!acctMap[name]) acctMap[name] = {name, total:0, count:0};
      acctMap[name].total += q.total || 0;
      acctMap[name].count += 1;
    });
    const topAccounts = Object.values(acctMap)
      .sort((a,b) => b.total - a.total)
      .slice(0, 5);

    // ── Net Total Value: revision deltas for revs APPROVED this month ──
    // Includes a revision only when ALL three hold:
    //   1. approval.status === "approved" and decidedAt is within this month
    //   2. The family's original (blank-rev base) was created in a PRIOR month
    //      (same-month families are already bundled into Total Value)
    //   3. The immediately preceding revision exists in the DB
    //      (orphan revs from legacy SF imports get skipped — no meaningful delta)
    // Delta = (this rev's total) - (immediately preceding revision's total)
    // Prior rev letter is derived from the `revision` column, NOT the trailing letter
    // of the opportunity string (the two can disagree on legacy SF-imported rows).
    let revisionDelta = 0;
    try {
      // Pull all approved-status revs (have a non-empty rev letter)
      const approvedRevs = await restFetch("GET",
        `quotes?select=id,opportunity,revision,total,created_at,data&approval_status=eq.approved&revision=not.is.null&revision=neq.`);
      const monthStartMs = new Date(thisMonth.start).getTime();
      const monthEndMs   = new Date(thisMonth.end).getTime();
      const revsDecidedThisMonth = (approvedRevs||[]).filter(r=>{
        const d = r.data?.approval?.decidedAt;
        if(!d) return false;
        const t = new Date(d).getTime();
        return !isNaN(t) && t>=monthStartMs && t<monthEndMs;
      });
      if(revsDecidedThisMonth.length>0){
        // Strip ANY trailing letter from opportunity to get the family base.
        // Then build prior-rev opp string by appending one-less-letter from `revision` col.
        // (rev "A" → blank base; rev "B" → base+"A"; rev "C" → base+"B"; etc.)
        const baseOppOf = (opp)=>{
          if(!opp) return "";
          const m = opp.match(/^(.+?)([A-Z])?$/);
          return m ? m[1] : opp;
        };
        const priorRevOppOf = (opp, revColValue)=>{
          const letter = (revColValue||"").toString().trim().toUpperCase();
          if(!letter || !/^[A-Z]$/.test(letter)) return null;
          const base = baseOppOf(opp);
          if(letter==="A") return base;                                   // prior is blank original
          return base + String.fromCharCode(letter.charCodeAt(0)-1);      // prior letter
        };
        // Collect lookups: prior-rev opp (for delta) + base opp (for rule #2 origin date)
        const lookupOppStrings = new Set();
        revsDecidedThisMonth.forEach(r=>{
          const prior = priorRevOppOf(r.opportunity, r.revision);
          if(prior) lookupOppStrings.add(prior);
          lookupOppStrings.add(baseOppOf(r.opportunity));
        });
        const oppList = Array.from(lookupOppStrings).map(o => encodeURIComponent(o)).join(",");
        const lookupRows = await restFetch("GET",
          `quotes?select=opportunity,total,created_at&opportunity=in.(${oppList})`);
        const rowByOpp = {};
        (lookupRows||[]).forEach(p=>{ rowByOpp[p.opportunity] = p; });
        revsDecidedThisMonth.forEach(r=>{
          // Rule #3: skip if prior rev doesn't exist in DB (orphan)
          const priorOpp = priorRevOppOf(r.opportunity, r.revision);
          const priorRow = priorOpp ? rowByOpp[priorOpp] : null;
          if(!priorRow) return;
          // Rule #2: skip if the family's original was created this month
          // Use the blank-rev base if it exists; otherwise use the prior rev's row as
          // a proxy for "family origin" (for legacy families with no blank in DB).
          const base = baseOppOf(r.opportunity);
          const baseRow = rowByOpp[base];
          const originRow = baseRow || priorRow;
          const originCreatedMs = new Date(originRow.created_at).getTime();
          if(isNaN(originCreatedMs) || originCreatedMs >= monthStartMs) return;
          // Compute delta
          revisionDelta += (r.total||0) - (priorRow.total||0);
        });
      }
    } catch(e) { console.warn("[DASHBOARD] revisionDelta:", e?.message||e); }

    // ── Month-over-month quote counts + totals ──
    // Each month produces 4 metrics matching the Quotes This Month widget:
    //   newCount  = families whose blank-rev original was created that month
    //   allCount  = newCount + revision rows of prior-month families that landed that month
    //   newTotal  = sum of those new families' totals (latest rev per group, like dashboard `created`)
    //   netTotal  = newTotal + sum of revision deltas APPROVED that month for prior-month families
    const monthCounts = await Promise.all(months.map(async m => {
      // 1) Pull all rows whose created_at is in this month
      let monthRows = [];
      try {
        monthRows = await restFetch("GET",
          `quotes?select=id,opportunity,revision,total,created_at&created_at=gte.${encodeURIComponent(m.start)}&created_at=lt.${encodeURIComponent(m.end)}`);
        monthRows = monthRows || [];
      } catch(e) { console.warn("[DASHBOARD] monthRows "+m.label+":", e?.message||e); }

      // 2) Compute base opp for each row, then determine which families have a
      //    blank-rev member in this month (those are the "new" families).
      const baseOf = (opp)=>{
        if(!opp) return "";
        const x = opp.match(/^(.+?)([A-Z])?$/);
        return x ? x[1] : opp;
      };
      const baseHasBlank = new Set();
      monthRows.forEach(r => {
        if(!r.revision || r.revision === "") baseHasBlank.add(baseOf(r.opportunity));
      });
      // Group by base; keep latest rev per group (same pattern as `created` array)
      const groups = new Map();
      monthRows.forEach(r => {
        const b = baseOf(r.opportunity);
        const g = groups.get(b) || { rows: [], latest: null };
        g.rows.push(r);
        if(!g.latest || (r.revision||"") > (g.latest.revision||"")) g.latest = r;
        groups.set(b, g);
      });
      // newCount = groups whose base has a blank-rev member this month
      // allCount = total groups this month (new + prior-month-family revisions)
      let newCount = 0, allCount = 0, newTotal = 0;
      for(const [b, g] of groups){
        allCount += 1;
        if(baseHasBlank.has(b)){
          newCount += 1;
          newTotal += (g.latest.total || 0);
        }
      }

      // 3) Revision delta for this month: approved revs whose decidedAt is in this
      //    month AND family base was created in a prior month. Same logic as the
      //    revisionDelta calc above, but scoped to this loop's month.
      let monthRevDelta = 0;
      try {
        const approvedRevs = await restFetch("GET",
          `quotes?select=id,opportunity,revision,total,data&approval_status=eq.approved&revision=not.is.null&revision=neq.`);
        const mStartMs = new Date(m.start).getTime();
        const mEndMs   = new Date(m.end).getTime();
        const revsDecidedHere = (approvedRevs||[]).filter(r => {
          const d = r.data?.approval?.decidedAt;
          if(!d) return false;
          const t = new Date(d).getTime();
          return !isNaN(t) && t>=mStartMs && t<mEndMs;
        });
        if(revsDecidedHere.length > 0){
          const priorRevOppOf = (opp, rev) => {
            const letter = (rev||"").toString().trim().toUpperCase();
            if(!letter || !/^[A-Z]$/.test(letter)) return null;
            const base = baseOf(opp);
            if(letter === "A") return base;
            return base + String.fromCharCode(letter.charCodeAt(0)-1);
          };
          const lookupOpps = new Set();
          revsDecidedHere.forEach(r => {
            const p = priorRevOppOf(r.opportunity, r.revision);
            if(p) lookupOpps.add(p);
            lookupOpps.add(baseOf(r.opportunity));
          });
          const oppList = Array.from(lookupOpps).map(o => encodeURIComponent(o)).join(",");
          const lookupRows = await restFetch("GET",
            `quotes?select=opportunity,total,created_at&opportunity=in.(${oppList})`);
          const rowByOpp = {};
          (lookupRows||[]).forEach(p => { rowByOpp[p.opportunity] = p; });
          revsDecidedHere.forEach(r => {
            const priorOpp = priorRevOppOf(r.opportunity, r.revision);
            const priorRow = priorOpp ? rowByOpp[priorOpp] : null;
            if(!priorRow) return;                          // orphan: skip
            const base = baseOf(r.opportunity);
            const baseRow = rowByOpp[base];
            const originRow = baseRow || priorRow;
            const originCreatedMs = new Date(originRow.created_at).getTime();
            if(isNaN(originCreatedMs) || originCreatedMs >= mStartMs) return;  // same-month: skip
            monthRevDelta += (r.total||0) - (priorRow.total||0);
          });
        }
      } catch(e) { console.warn("[DASHBOARD] monthRevDelta "+m.label+":", e?.message||e); }

      const netTotal = newTotal + monthRevDelta;
      return {
        label: m.label,
        // Back-compat keys (old code reads .count/.total — leave them mapped to "all" semantics for now)
        count: allCount,
        total: newTotal + monthRevDelta,
        // New explicit keys for the redesigned chart
        newCount, allCount, newTotal, netTotal,
        isCurrent: m.isCurrent,
      };
    }));

    const sortByOpp = arr => [...arr].sort((a,b) => {
      const oa = a.opportunity||a.data?.qi?.opp||"";
      const ob = b.opportunity||b.data?.qi?.opp||"";
      return oa.localeCompare(ob, undefined, {numeric:true, sensitivity:"base"});
    });

    const won         = sortByOpp(wonRawMerged.map(q => ({...q, type: q.data?.qi?.type||"New Business", total: q.total||0})));
    const wonNew      = won.filter(q => q.type === "New Business");
    const wonExisting = won.filter(q => q.type === "Existing Business");
    const wonTotal    = won.reduce((a,q) => a + (q.total||0), 0);

    // ── Ready to Send queue ────────────────────────────────────────────
    // Approved + still-open + not manually dismissed, deduped to the LATEST
    // revision per opportunity family, filtered to only those that haven't
    // been sent since the most recent approval.
    let readyToSend = [];
    try {
      const approvedRows = await restFetch("GET",
        `quotes?select=id,opportunity,revision,customer,total,data,ready_to_send_dismissed_at&approval_status=eq.approved&ready_to_send_dismissed_at=is.null&stage=not.in.(${encodeURIComponent("Closed Won")},${encodeURIComponent("Closed Lost")})&limit=2000`);
      const approved = approvedRows || [];

      // Group by base-opp; keep latest revision per family (matches dashboard
      // `created` array pattern at ~line 3995 — see `groupMap` there).
      const baseOf = (opp) => {
        if(!opp) return "";
        const m = opp.match(/^(.+?)([A-Z])?$/);
        return m ? m[1] : opp;
      };
      const familyMap = new Map();   // baseKey → latest row
      approved.forEach(r => {
        const baseKey = baseOf(r.opportunity) || ("__no_opp_" + r.id);
        const cur = familyMap.get(baseKey);
        const rev = (r.revision || "").toString();
        const curRev = cur ? (cur.revision || "").toString() : "";
        if(!cur || rev > curRev) familyMap.set(baseKey, r);
      });
      const latestApprovedPerFamily = Array.from(familyMap.values());

      // Look up the most recent send per quote (single query for the whole set).
      // We pull all follow_ups rows for these quote_ids, then keep the max sent_at.
      const candidateIds = latestApprovedPerFamily.map(r => r.id);
      const sendMaxByQuoteId = {};
      if(candidateIds.length > 0){
        const idList = candidateIds.map(id => encodeURIComponent(id)).join(",");
        const fuRows = await restFetch("GET",
          `follow_ups?select=quote_id,sent_at&quote_id=in.(${idList})&sent_by=neq.manually_dismissed&or=(voided.is.null,voided.eq.false)`);
        (fuRows || []).forEach(fu => {
          const prev = sendMaxByQuoteId[fu.quote_id];
          if(!prev || new Date(fu.sent_at) > new Date(prev)) sendMaxByQuoteId[fu.quote_id] = fu.sent_at;
        });
      }

      const nowMs = Date.now();
      readyToSend = latestApprovedPerFamily
        .map(r => {
          const decidedAt = r.data?.approval?.decidedAt;
          if(!decidedAt) return null;        // can't compare; skip
          const lastSent = sendMaxByQuoteId[r.id];
          if(lastSent && new Date(lastSent) >= new Date(decidedAt)) return null;  // already sent post-approval
          const approvedMs = new Date(decidedAt).getTime();
          if(isNaN(approvedMs)) return null;
          const daysInQueue = Math.floor((nowMs - approvedMs) / (1000*60*60*24));
          return {
            id: r.id,
            opportunity: r.opportunity || r.data?.qi?.opp || "",
            customer: r.customer || r.data?.qi?.account || "",
            total: r.total || 0,
            approvedAt: decidedAt,
            daysInQueue,
          };
        })
        .filter(Boolean)
        .sort((a,b) => new Date(a.approvedAt) - new Date(b.approvedAt));  // oldest first
    } catch(e) { console.warn("readyToSend calc failed:", e); }

    const yrPrefix = String(year).slice(-2);
    const ytdStart = new Date(year, 0, 1).toISOString();
    const ytdEnd   = new Date(year + 1, 0, 1).toISOString();
    let ytdCreatedRaw = [], ytdWonRaw = [];
    try {
      [ytdCreatedRaw, ytdWonRaw] = await Promise.all([
        restFetch("GET", `quotes?select=id,opportunity,total,revision,created_at&created_at=gte.${encodeURIComponent(ytdStart)}&created_at=lt.${encodeURIComponent(ytdEnd)}&limit=2000`),
        restFetch("GET", `quotes?select=id,opportunity,total,won_date,revision,created_at,data->qi->>type&stage=eq.Closed%20Won&won_date=gte.${encodeURIComponent(ytdStart.slice(0,10))}&won_date=lt.${encodeURIComponent(ytdEnd.slice(0,10))}&limit=2000`),
      ]);
    } catch(e) { console.warn("[DASHBOARD] YTD queries failed:", e?.message||e); }
    // Collapse revisions: a revised quote (e.g. 26-224 → 26-224A) is the SAME
    // opportunity, so counting both rows double-counts the pipeline. Keep only the
    // latest revision per opportunity for BOTH the created and won YTD numbers, so
    // the count is distinct opportunities and the value is net (not stacked).
    const ytdBaseOpp = (o) => {
      const s = String(o || "").trim();
      const m = s.match(/^(.*?)([A-Za-z])$/);
      return (m ? m[1] : s).toUpperCase();
    };
    const ytdRevRank = (row) => {
      const rev = String(row.revision || "").trim().toUpperCase();
      if (/^[A-Z]$/.test(rev)) return rev.charCodeAt(0) - 64; // A=1, B=2…
      const o = String(row.opportunity || "").trim().toUpperCase();
      return /[A-Z]$/.test(o) ? (o.charCodeAt(o.length - 1) - 64) : 0; // base = 0
    };
    const ytdLatestPerOpp = (rows) => {
      const best = new Map();
      (rows || []).forEach((row) => {
        const key = ytdBaseOpp(row.opportunity);
        const cur = best.get(key);
        if (!cur) { best.set(key, row); return; }
        const d = ytdRevRank(row) - ytdRevRank(cur);
        if (d > 0 || (d === 0 && String(row.created_at || "") > String(cur.created_at || ""))) best.set(key, row);
      });
      return [...best.values()];
    };
    const ytdCreated     = ytdLatestPerOpp(ytdCreatedRaw);
    const ytdWonAll      = ytdLatestPerOpp(ytdWonRaw).map(q => ({...q, type: q.type||"New Business"}));
    const ytdWonNew      = ytdWonAll.filter(q => q.type === "New Business");
    const ytdWonExisting = ytdWonAll.filter(q => q.type === "Existing Business");
    const ytdQuoteTotal  = ytdCreated.reduce((a,q) => a + (q.total||0), 0);
    const ytdWonNewTotal = ytdWonNew.reduce((a,q) => a + (q.total||0), 0);
    const ytdWonExTotal  = ytdWonExisting.reduce((a,q) => a + (q.total||0), 0);
    const ytdWonTotal    = ytdWonNewTotal + ytdWonExTotal;
    setData({ created, monthCounts, won, wonNew, wonExisting, wonTotal, topCodes, topAccounts, revisionDelta, readyToSend,
      ytdQuoteCount: ytdCreated.length, ytdQuoteTotal, ytdWonNewTotal, ytdWonExTotal, ytdWonTotal, yrPrefix });
    setLoading(false);
  };

  useEffect(()=>{ load(); loadFollowUps(); loadFlags(); },[]);

  const TARGET = 175000;
  const money  = n => "$"+(isNaN(n)||n==null?0:Math.round(n)).toLocaleString();
  const pct    = v => Math.round((v/TARGET)*100);


  return(
    <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:"#f0f2f5",fontFamily:"Segoe UI,system-ui,sans-serif"}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>

        {/* Title row */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24,flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,color:"#1a2332"}}>Dashboard</div>
            <div style={{fontSize:12,color:"#6b7a8d",marginTop:2}}>
              {new Date().toLocaleString("en-US",{month:"long",year:"numeric"})}
            </div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            {/* Campaigns button */}
            <button onClick={openCampaignsModal}
              style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:8,padding:"8px 18px",
                fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332",letterSpacing:.2}}>
              Campaigns
            </button>
            {/* Privacy Mode toggle */}
            <button onClick={()=>setPrivacyMode(v=>!v)}
              style={{background:privacyMode?"#1a2332":"#fff",border:"1px solid "+(privacyMode?"#1a2332":"#d0d7de"),borderRadius:8,padding:"8px 18px",
                fontWeight:600,fontSize:12,cursor:"pointer",color:privacyMode?"#fff":"#1a2332",letterSpacing:.2}}>
              Privacy Mode
            </button>
            {/* Account lookup */}
            <div ref={acctRef} style={{position:"relative"}}>
              <div style={{display:"flex",gap:0,alignItems:"center",background:"#fff",
                border:"1px solid #d0d7de",borderRadius:8,overflow:"hidden"}}>
                <span style={{padding:"0 10px",fontSize:14,color:"#9aa5b1"}}>🏢</span>
                <input
                  value={acctSearch}
                  onChange={e=>{setAcctSearch(e.target.value);}}
                  placeholder="Account lookup…"
                  style={{border:"none",outline:"none",padding:"8px 4px",fontSize:12,
                    fontFamily:"inherit",width:180,color:"#1a2332"}}/>
                {acctSearch&&(
                  <button onClick={()=>{setAcctSearch("");setAcctResults([]);setAcctOpen(false);}}
                    style={{background:"none",border:"none",padding:"0 10px",cursor:"pointer",
                      color:"#9aa5b1",fontSize:14}}>×</button>
                )}
              </div>
              {acctOpen&&acctResults.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:3000,
                  background:"#fff",border:"1px solid #d0d7de",borderRadius:8,
                  boxShadow:"0 4px 16px rgba(0,0,0,0.12)",maxHeight:240,overflowY:"auto",marginTop:3}}>
                  {acctResults.map(name=>(
                    <div key={name}
                      onMouseDown={()=>{setAcctModal(name);setAcctSearch("");setAcctOpen(false);}}
                      style={{padding:"9px 14px",cursor:"pointer",fontSize:12,
                        borderBottom:"1px solid #f0f2f5",transition:"background .1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#f0f4ff"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={()=>{load();loadFollowUps();loadFlags();if(onRefreshComplete)onRefreshComplete();}}              style={{background:needsRefresh?"#1a5276":"#fff",border:"1px solid "+(needsRefresh?"#1a5276":"#d0d7de"),borderRadius:8,padding:"8px 18px",
                fontWeight:600,fontSize:12,cursor:"pointer",color:needsRefresh?"#fff":"#1a2332",display:"flex",alignItems:"center",gap:6}}>
              {needsRefresh?"↻ Updates available":"↻ Refresh"}
            </button>
            <button onClick={()=>{setShowPrevMonth(true);if(!prevMonthData)loadPrevMonth(selectedMonth.month,selectedMonth.year);}}
              style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:8,padding:"8px 18px",
                fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332",display:"flex",alignItems:"center",gap:6}}>
              📅 Last Month
            </button>
            <button onClick={onEnterQuote}
              style={{background:"#1a5276",border:"none",borderRadius:8,padding:"8px 20px",
                fontWeight:700,fontSize:12,cursor:"pointer",color:"#fff",letterSpacing:.5}}>
              + New Quote
            </button>
          </div>
        </div>
        {/* Previous Month Snapshot Modal */}
        {showPrevMonth&&(
          <div onClick={e=>{if(e.target===e.currentTarget)setShowPrevMonth(false);}}
            style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.45)",
              display:"flex",alignItems:"flex-start",justifyContent:"center",
              overflowY:"auto",padding:"40px 16px"}}>
            <div style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:760,
              boxShadow:"0 8px 40px rgba(0,0,0,0.18)",padding:"28px 32px",position:"relative"}}>
              {/* Close */}
              <button onClick={()=>setShowPrevMonth(false)}
                style={{position:"absolute",top:16,right:16,background:"none",border:"none",
                  fontSize:20,cursor:"pointer",color:"#9aa5b1",lineHeight:1}}>✕</button>

              <div style={{fontSize:18,fontWeight:800,color:"#1a2332",marginBottom:16}}>
                📅 Monthly Snapshot
              </div>

              {/* Month / Year picker */}
              {(()=>{
                const MONTHS=["January","February","March","April","May","June",
                              "July","August","September","October","November","December"];
                const currentYear=new Date().getFullYear();
                const currentMonthIdx=new Date().getMonth();
                // Go back to 2016 to cover all SF-imported historical data
                const oldestYear=2016;
                const years=Array.from({length:currentYear-oldestYear+1},(_,i)=>currentYear-i);
                const prevM=selectedMonth.month===0?11:selectedMonth.month-1;
                const prevY=selectedMonth.month===0?selectedMonth.year-1:selectedMonth.year;
                const nextM=selectedMonth.month===11?0:selectedMonth.month+1;
                const nextY=selectedMonth.month===11?selectedMonth.year+1:selectedMonth.year;
                const now=new Date();
                const nextDisabled=nextY>now.getFullYear()||(nextY===now.getFullYear()&&nextM>=now.getMonth());
                return(
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
                    <button onClick={()=>goMonth(prevM,prevY)}
                      style={{background:"#f0f2f5",border:"none",borderRadius:6,width:30,height:30,
                        cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      ‹
                    </button>
                    <select value={selectedMonth.month}
                      onChange={e=>goMonth(Number(e.target.value),selectedMonth.year)}
                      style={{border:"1px solid #d0d7de",borderRadius:6,padding:"6px 10px",
                        fontSize:13,fontWeight:600,color:"#1a2332",cursor:"pointer",fontFamily:"inherit"}}>
                      {MONTHS.map((m,i)=>{
                        const now=new Date();
                        // Disable current and future months
                        const disabled=selectedMonth.year===now.getFullYear()&&i>=now.getMonth();
                        return <option key={m} value={i} disabled={disabled}>{m}</option>;
                      })}
                    </select>
                    <select value={selectedMonth.year}
                      onChange={e=>goMonth(selectedMonth.month,Number(e.target.value))}
                      style={{border:"1px solid #d0d7de",borderRadius:6,padding:"6px 10px",
                        fontSize:13,fontWeight:600,color:"#1a2332",cursor:"pointer",fontFamily:"inherit"}}>
                      {years.map(y=><option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={()=>!nextDisabled&&goMonth(nextM,nextY)}
                      style={{background:"#f0f2f5",border:"none",borderRadius:6,width:30,height:30,
                        cursor:nextDisabled?"not-allowed":"pointer",fontSize:16,
                        opacity:nextDisabled?0.35:1,
                        display:"flex",alignItems:"center",justifyContent:"center"}}>
                      ›
                    </button>
                    {prevMonthLoading&&(
                      <span style={{fontSize:12,color:"#9aa5b1",marginLeft:8}}>Loading…</span>
                    )}
                  </div>
                );
              })()}

              {prevMonthLoading?(
                <div style={{textAlign:"center",padding:40,color:"#9aa5b1",fontSize:13}}>Loading…</div>
              ):!prevMonthData?(
                <div style={{textAlign:"center",padding:40,color:"#9aa5b1",fontSize:13}}>Select a month above</div>
              ):prevMonthData&&(()=>{
                const pm=prevMonthData;
                const money=n=>"$"+(isNaN(n)||n==null?0:Math.round(n)).toLocaleString();
                const capColor=pm.capPct>=50?"#1e8449":pm.capPct>=25?"#b7791f":"#c0392b";
                return(
                  <div>
                    {/* Top stat row */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                      {[
                        {label:"QUOTES CREATED", val:pm.quoteCount, sub:money(pm.quoteTotal)+" total value", color:"#1a2332"},
                        {label:"AVG QUOTE VALUE", val:money(pm.avgQuote), sub:pm.quoteCount+" quotes", color:"#1a2332"},
                        {label:"CLOSED WON", val:money(pm.wonTotal), sub:pm.wonCount+" quote"+(pm.wonCount!==1?"s":""), color:"#1e8449"},
                        {label:"CAPTURE RATE", val:pm.capPct+"%", sub:pm.wonCount+" won / "+pm.quoteCount+" quoted", color:capColor},
                      ].map(s=>(
                        <div key={s.label} style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",border:"1px solid #e8ecf0"}}>
                          <div style={{fontSize:9,fontWeight:700,letterSpacing:1.2,color:"#9aa5b1",marginBottom:6}}>{s.label}</div>
                          <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1}}>{s.val}</div>
                          <div style={{fontSize:11,color:"#9aa5b1",marginTop:4}}>{s.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* Closed Won breakdown — hover the card to see the quotes; click a row to open it */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                      {[
                        {key:"new", label:"NEW BUSINESS",      val:pm.wonNewTotal, count:pm.wonNewCount, color:"#1e8449", list:pm.wonNew||[]},
                        {key:"ex",  label:"EXISTING BUSINESS", val:pm.wonExTotal,  count:pm.wonExCount,  color:"#2e6da4", list:pm.wonEx ||[]},
                      ].map(s=>{
                        const hovering = pmWonHover === s.key;
                        const canHover = s.count > 0;
                        return (
                          <div key={s.label}
                            onMouseEnter={()=>canHover && setPmWonHover(s.key)}
                            onMouseLeave={()=>setPmWonHover(null)}
                            style={{position:"relative"}}>
                            <div style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",
                              border:"1px solid #e8ecf0"}}>
                              <div style={{fontSize:9,fontWeight:700,letterSpacing:1.2,color:"#9aa5b1",marginBottom:4}}>CLOSED WON — {s.label}</div>
                              <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1}}>{money(s.val)}</div>
                              <div style={{fontSize:11,color:"#9aa5b1",marginTop:3}}>
                                {s.count} quote{s.count!==1?"s":""}
                                {canHover && <span style={{marginLeft:6,color:"#1a5276",fontStyle:"italic"}}>hover to view</span>}
                              </div>
                            </div>
                            {hovering && s.list.length>0 && (
                              <div style={{position:"absolute",top:"100%",left:0,right:0,
                                background:"#fff",border:"1px solid #d8dde3",
                                borderRadius:10,boxShadow:"0 6px 18px rgba(0,0,0,0.12)",
                                zIndex:50,maxHeight:280,overflowY:"auto",padding:"6px 0"}}>
                                {s.list.map((q,i)=>(
                                  <div key={q.id}
                                    onClick={async()=>{
                                      if(!onLoadQuote)return;
                                      try {
                                        const rows = await restFetch("GET",
                                          `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(q.id)}&limit=1`);
                                        const row = (rows||[])[0];
                                        if(row){
                                          const blob=row.data||{};
                                          onLoadQuote({...blob,id:row.id,
                                            opp:row.opportunity||blob.opp,
                                            customer:row.customer||blob.customer,
                                            rfq:row.rfq||blob.rfq,
                                            total:row.total??blob.total,
                                            savedAt:row.updated_at,
                                            source:row.source||"nuforce",
                                            approval:{...(blob.approval||{}),status:row.approval_status||"none"},
                                            wonApproval:{...(blob.wonApproval||{}),status:row.won_approval_status||"none"},
                                          });
                                        }
                                      } catch(e) {
                                        console.warn("[POPOVER-LOAD] failed:", e?.message||e);
                                      }
                                      setShowPrevMonth(false);
                                      setPmWonHover(null);
                                    }}
                                    onMouseEnter={e=>e.currentTarget.style.background="#f0f4f8"}
                                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{display:"grid",gridTemplateColumns:"90px 1fr 90px",
                                      gap:8,padding:"8px 14px",cursor:"pointer",
                                      borderTop:i>0?"1px solid #f0f2f5":"none",alignItems:"center"}}>
                                    <div style={{fontWeight:700,color:s.color,fontSize:12}}>{q.opportunity||"(no opp)"}</div>
                                    <div style={{fontSize:12,color:"#1a2332",overflow:"hidden",
                                      textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.customer||"—"}</div>
                                    <div style={{fontSize:12,color:"#1a5276",fontWeight:600,textAlign:"right"}}>{money(q.total||0)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Top accounts + top codes side by side */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      {/* Top accounts */}
                      <div style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",border:"1px solid #e8ecf0"}}>
                        <div style={{fontSize:9,fontWeight:700,letterSpacing:1.2,color:"#9aa5b1",marginBottom:10}}>TOP ACCOUNTS BY QUOTE VALUE</div>
                        {pm.topAccounts.length===0?(
                          <div style={{fontSize:12,color:"#9aa5b1",fontStyle:"italic"}}>None</div>
                        ):pm.topAccounts.map((a,i)=>(
                          <div key={a.name} style={{display:"flex",justifyContent:"space-between",
                            alignItems:"center",padding:"5px 0",
                            borderTop:i>0?"1px solid #e8ecf0":"none",fontSize:12}}>
                            <span style={{color:"#1a2332",fontWeight:i===0?700:400,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              maxWidth:"60%"}}>{a.name}</span>
                            <span style={{color:"#1a5276",fontWeight:600,flexShrink:0}}>{money(a.total)}</span>
                          </div>
                        ))}
                      </div>
                      {/* Top product codes */}
                      <div style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",border:"1px solid #e8ecf0"}}>
                        <div style={{fontSize:9,fontWeight:700,letterSpacing:1.2,color:"#9aa5b1",marginBottom:10}}>TOP PRODUCT CODES</div>
                        {pm.topCodes.length===0?(
                          <div style={{fontSize:12,color:"#9aa5b1",fontStyle:"italic"}}>None</div>
                        ):pm.topCodes.map((c,i)=>(
                          <div key={c.code} style={{display:"flex",justifyContent:"space-between",
                            alignItems:"center",padding:"5px 0",
                            borderTop:i>0?"1px solid #e8ecf0":"none",fontSize:12}}>
                            <span style={{color:"#1a2332",fontWeight:600}}>{c.code}</span>
                            <span style={{color:"#6b7a8d"}}>{c.count}×</span>
                            <span style={{color:"#1a5276",fontWeight:600}}>{money(c.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Recently Approved Modal */}
        {showRecentApproved&&(
          <div onClick={e=>{if(e.target===e.currentTarget)setShowRecentApproved(false);}}
            style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.45)",
              display:"flex",alignItems:"flex-start",justifyContent:"center",
              overflowY:"auto",padding:"40px 16px"}}>
            <div style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:700,
              boxShadow:"0 8px 40px rgba(0,0,0,0.18)",padding:"28px 32px",position:"relative"}}>
              <button onClick={()=>setShowRecentApproved(false)}
                style={{position:"absolute",top:16,right:16,background:"none",border:"none",
                  fontSize:20,cursor:"pointer",color:"#9aa5b1",lineHeight:1}}>✕</button>
              <div style={{fontSize:18,fontWeight:800,color:"#1a2332",marginBottom:4}}>
                ✓ Recently Approved
              </div>
              {/* Day selector */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20}}>
                <span style={{fontSize:12,color:"#6b7a8d"}}>Show last</span>
                {[7,14,30].map(d=>(
                  <button key={d} onClick={()=>{setRecentDays(d);setRecentApproved(null);loadRecentApproved(d);}}
                    style={{background:recentDays===d?"#1a5276":"#f0f2f5",
                      border:"none",borderRadius:6,padding:"4px 12px",
                      fontSize:12,fontWeight:600,cursor:"pointer",
                      color:recentDays===d?"#fff":"#1a2332"}}>
                    {d} days
                  </button>
                ))}
                {recentApprovedLoading&&<span style={{fontSize:12,color:"#9aa5b1",marginLeft:4}}>Loading…</span>}
              </div>
              {/* Results */}
              {!recentApprovedLoading&&recentApproved&&(
                recentApproved.length===0?(
                  <div style={{textAlign:"center",padding:"32px 0",color:"#9aa5b1",fontSize:13}}>
                    No approvals in the last {recentDays} days
                  </div>
                ):(
                  <div>
                    {/* Header row */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1.2fr 80px 100px 100px",
                      gap:8,padding:"6px 0",borderBottom:"2px solid #e8ecf0",marginBottom:4}}>
                      {["OPP #","CUSTOMER","TYPE","TOTAL","APPROVED"].map(h=>(
                        <div key={h} style={{fontSize:9,fontWeight:700,letterSpacing:1,color:"#9aa5b1"}}>{h}</div>
                      ))}
                    </div>
                    {recentApproved.map((q,i)=>(
                      <div key={q.id}
                        onClick={async()=>{
                          if(!onLoadQuote)return;
                          try {
                            const rows = await restFetch("GET",
                              `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(q.id)}&limit=1`);
                            const row = (rows||[])[0];
                            if(row){
                              const blob=row.data||{};
                              onLoadQuote({...blob,id:row.id,
                                opp:row.opportunity||blob.opp,
                                customer:row.customer||blob.customer,
                                rfq:row.rfq||blob.rfq,
                                total:row.total??blob.total,
                                savedAt:row.updated_at,
                                source:row.source||"nuforce",
                                approval:{...(blob.approval||{}),status:row.approval_status||"none"},
                                wonApproval:{...(blob.wonApproval||{}),status:row.won_approval_status||"none"},
                              });
                            }
                          } catch(e) {
                            console.warn("[QUOTE-LOAD recent] failed:", e?.message||e);
                          }
                          setShowRecentApproved(false);
                        }}
                        style={{display:"grid",gridTemplateColumns:"1fr 1.2fr 80px 100px 100px",
                          gap:8,padding:"9px 0",cursor:"pointer",
                          borderBottom:"1px solid #f0f2f5",
                          background:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#f8f9fb"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{fontWeight:700,color:"#1a5276",fontSize:12}}>{q.opp}</div>
                        <div style={{fontSize:12,color:"#1a2332",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.customer}</div>
                        <div>
                          <span style={{fontSize:10,fontWeight:700,
                            background:q.type==="Closed Won"?"#d1fae5":"#eff6ff",
                            color:q.type==="Closed Won"?"#065f46":"#1e40af",
                            borderRadius:4,padding:"2px 6px"}}>
                            {q.type}
                          </span>
                        </div>
                        <div style={{fontSize:12,fontWeight:600,color:"#1e8449"}}>
                          {"$"+(q.total||0).toLocaleString()}
                        </div>
                        <div style={{fontSize:11,color:"#6b7a8d"}}>
                          {new Date(q.decidedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                          {q.decidedBy&&<div style={{fontSize:10,color:"#9aa5b1"}}>{q.decidedBy.split("@")[0]}</div>}
                        </div>
                      </div>
                    ))}
                    <div style={{marginTop:12,fontSize:11,color:"#9aa5b1",textAlign:"right"}}>
                      {recentApproved.length} approval{recentApproved.length!==1?"s":""} · click a row to open the quote
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Account Dashboard modal */}
        {acctModal&&(
          <AccountDashboard
            accountName={acctModal}
            onClose={()=>setAcctModal(null)}
            onLoadQuote={q=>{onLoadQuote&&onLoadQuote(q);setAcctModal(null);}}
            onNewQuote={name=>{onNewQuoteForAccount&&onNewQuoteForAccount(name);setAcctModal(null);}}
          />
        )}

        <div style={{filter:privacyMode?"blur(9px)":"none",transition:"filter 0.2s ease",pointerEvents:privacyMode?"none":"auto",userSelect:privacyMode?"none":"auto"}}>
        {loading?(
          <div style={{textAlign:"center",padding:80,color:"#9aa5b1",fontSize:14}}>Loading…</div>
        ):(
          <div>
            {/* ── Top stat cards — 2 cols: Quotes | Won+Target ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:16,marginBottom:20}}>
              <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0"}}>
                {(()=>{
                  // "New families this month" = quotes whose blank-rev original was created this month.
                  // _bucket==="new" already encodes this (set in load() at created-array build time).
                  // Orphan-letter rows (SF imports with letter but no blank in DB) are correctly tagged "revision".
                  const newFamilies = (data.created||[]).filter(q=>q._bucket==="new");
                  const createdCount = newFamilies.length;
                  const totalVal = newFamilies.reduce((a,q)=>a+(q.total||0),0);
                  const delta = data.revisionDelta||0;
                  const wonCount = data.won.length;
                  const capPct = createdCount>0?Math.round((wonCount/createdCount)*100):0;
                  const capColor = capPct>=50?"#1e8449":capPct>=25?"#b7791f":"#c0392b";
                  return (
                    <>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:8}}>QUOTES THIS MONTH</div>
                      <div style={{fontSize:36,fontWeight:800,color:"#1a2332",lineHeight:1}}>{createdCount}</div>
                      <div style={{fontSize:12,color:"#6b7a8d",marginTop:6}}>
                        Total value: <span style={{fontWeight:700,color:"#1a5276"}}>{money(totalVal)}</span>
                      </div>
                      {delta!==0 && (()=>{
                        const net = totalVal + delta;
                        const deltaColor = delta>0?"#1e8449":"#c0392b";
                        const deltaSign  = delta>0?"+":"−";
                        return (
                          <div style={{fontSize:12,color:"#6b7a8d",marginTop:3}}>
                            Net total value: <span style={{fontWeight:700,color:"#1a5276"}}>{money(net)}</span>
                            <span style={{marginLeft:6,fontSize:11,color:deltaColor,fontWeight:600}}>
                              ({deltaSign}{money(Math.abs(delta))} rev.)
                            </span>
                          </div>
                        );
                      })()}
                      {createdCount>0 && (
                        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #f0f2f5"}}>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:1,color:"#9aa5b1",marginBottom:4}}>CAPTURE RATE</div>
                          <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                            <span style={{fontSize:24,fontWeight:800,color:capColor}}>{capPct}%</span>
                            <span style={{fontSize:11,color:"#6b7a8d"}}>{wonCount} won / {createdCount} quoted</span>
                          </div>
                          <div style={{marginTop:6,height:6,background:"#e8ecf0",borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:capPct+"%",background:capColor,borderRadius:4,transition:"width 0.6s ease"}}/>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              {(()=>{
                const over=data.wonTotal>=TARGET;
                const rawPct=pct(data.wonTotal);
                const barColor=over?"#1e8449":data.wonTotal>TARGET*0.7?"#b7791f":"#1a5276";
                const overflowAmt=over?data.wonTotal-TARGET:0;
                const overflowPct=over?Math.round((overflowAmt/TARGET)*100):0;
                const displayScale=Math.max(1,data.wonTotal/TARGET);
                const targetBarW=Math.round((1/displayScale)*100);
                const overBarW=Math.round((overflowAmt/TARGET)/displayScale*100);
                return(
                  <div style={{background:over?"#f0faf4":"#fff",borderRadius:12,padding:"20px 24px",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid "+(over?"#a7f3d0":"#e8ecf0")}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>CLOSED WON THIS MONTH · MONTHLY TARGET</div>
                      {over&&<span style={{fontSize:10,background:"#d1fae5",color:"#065f46",borderRadius:4,padding:"2px 7px",fontWeight:700}}>🎉 EXCEEDED</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"baseline",gap:16,marginBottom:4}}>
                      <div>
                        <div style={{fontSize:32,fontWeight:800,color:over?"#1e8449":"#1a2332",lineHeight:1}}>{money(data.wonTotal)}</div>
                        <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>
                          {data.won.length} quote{data.won.length!==1?"s":""} · {data.wonNew.length} new · {data.wonExisting.length} existing
                        </div>
                      </div>
                      <div style={{color:"#d0d7de",fontSize:28,fontWeight:200,lineHeight:1,alignSelf:"center"}}>/</div>
                      <div>
                        <div style={{fontSize:32,fontWeight:800,color:"#9aa5b1",lineHeight:1}}>{money(TARGET)}</div>
                        <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>monthly target · <span style={{fontWeight:700,color:over?"#1e8449":barColor}}>{rawPct}%</span></div>
                      </div>
                    </div>
                    <div style={{margin:"12px 0 8px"}}>
                      <div style={{position:"relative",height:16,background:"#e8ecf0",borderRadius:8,overflow:"hidden"}}>
                        <div style={{position:"absolute",left:0,top:0,bottom:0,
                          width:(over?targetBarW:Math.round(Math.min(data.wonTotal/TARGET,1)*100))+"%",
                          background:barColor,borderRadius:"8px 0 0 8px",transition:"width 0.6s ease"}}/>
                        {over&&<div style={{position:"absolute",left:targetBarW+"%",top:2,bottom:2,
                          width:overBarW+"%",background:"#34d399",borderRadius:"0 6px 6px 0",transition:"width 0.6s ease"}}/>}
                        <div style={{position:"absolute",left:targetBarW+"%",top:0,bottom:0,width:2,background:"rgba(255,255,255,0.8)"}}/>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:"#6b7a8d",display:"flex",justifyContent:"space-between"}}>
                      {over
                        ?<><span style={{color:"#1e8449",fontWeight:700}}>+{money(overflowAmt)} over target</span><span>+{overflowPct}%</span></>
                        :<><span>{money(TARGET-data.wonTotal)} remaining</span><span>{100-rawPct}% to go</span></>
                      }
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Closed Won breakdown ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
              {[
                {label:"New Business", items:data.wonNew, color:"#1e8449"},
                {label:"Existing Business", items:data.wonExisting, color:"#2e6da4"},
              ].map(({label,items,color})=>(
                <div key={label} style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0"}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:12}}>
                    CLOSED WON — {label.toUpperCase()}
                  </div>
                  {items.length===0?(
                    <div style={{fontSize:12,color:"#9aa5b1",fontStyle:"italic"}}>None this month</div>
                  ):(
                    <>
                      <div style={{fontSize:22,fontWeight:800,color,marginBottom:8}}>
                        {money(items.reduce((a,q)=>a+(q.total||0),0))}
                      </div>
                      {/* Column headers */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",
                        borderBottom:"1px solid #e8ecf0",paddingBottom:4,marginBottom:2,gap:8}}>
                        <span style={{flexShrink:0}}>OPP #</span>
                        <span style={{flex:1}}>ACCOUNT</span>
                        <span style={{flexShrink:0}}>TOTAL</span>
                      </div>
                      {items.map(q=>{
                        const acct=q.customer||q.data?.qi?.account||"";
                        return(
                          <div key={q.id} style={{display:"flex",alignItems:"center",
                            justifyContent:"space-between",fontSize:11,color:"#6b7a8d",
                            borderTop:"1px solid #f0f2f5",padding:"5px 0",gap:8}}>
                            <span
                              onClick={()=>{
                                if(!onLoadQuote)return;
                                const blob=q.data||{};
                                onLoadQuote({
                                  ...blob,
                                  id:q.id,
                                  source:blob.source||"nuforce",
                                  customer:q.customer||blob.customer,
                                  total:q.total||blob.total,
                                });
                              }}
                              style={{fontWeight:700,color:"#1a5276",cursor:"pointer",
                                textDecoration:"underline",textDecorationColor:"rgba(26,82,118,0.4)",
                                flexShrink:0}}>
                              {q.opportunity}
                            </span>
                            <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",
                              whiteSpace:"nowrap",color:"#6b7a8d"}}>
                              {acct}
                            </span>
                            <span style={{fontWeight:600,color:"#1a2332",flexShrink:0}}>
                              {money(q.total||0)}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* ── YTD Metrics ── */}
            {(()=>{
              const yr="20"+data.yrPrefix;
              return(
                <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0",marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:14}}>
                    YEAR TO DATE — {yr} (ALL QUOTES)
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:16}}>
                    <div>
                      <div style={{fontSize:10,color:"#9aa5b1",fontWeight:600,letterSpacing:.8,marginBottom:4}}>QUOTES CREATED</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#1a2332",lineHeight:1}}>{data.ytdQuoteCount}</div>
                      <div style={{fontSize:11,color:"#6b7a8d",marginTop:3}}>{money(data.ytdQuoteTotal)} total value</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#9aa5b1",fontWeight:600,letterSpacing:.8,marginBottom:4}}>CLOSED WON TOTAL</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#1e8449",lineHeight:1}}>{money(data.ytdWonTotal)}</div>
                      <div style={{fontSize:11,color:"#6b7a8d",marginTop:3}}>
                        {data.ytdQuoteTotal>0?Math.round((data.ytdWonTotal/data.ytdQuoteTotal)*100):0}% of quoted value
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#9aa5b1",fontWeight:600,letterSpacing:.8,marginBottom:4}}>WON — NEW BUSINESS</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#1e8449",lineHeight:1}}>{money(data.ytdWonNewTotal)}</div>
                      <div style={{fontSize:11,color:"#6b7a8d",marginTop:3}}>
                        {data.ytdWonTotal>0?Math.round((data.ytdWonNewTotal/data.ytdWonTotal)*100):0}% of won total
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#9aa5b1",fontWeight:600,letterSpacing:.8,marginBottom:4}}>WON — EXISTING BUSINESS</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#2e6da4",lineHeight:1}}>{money(data.ytdWonExTotal)}</div>
                      <div style={{fontSize:11,color:"#6b7a8d",marginTop:3}}>
                        {data.ytdWonTotal>0?Math.round((data.ytdWonExTotal/data.ytdWonTotal)*100):0}% of won total
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Quotes this month table ── */}
            {(()=>{
              const filtered=(data.created||[]).filter(q=>{
                if(quotesThisMonthFilter==="new")return q._bucket==="new";
                if(quotesThisMonthFilter==="revisions")return q._bucket==="revision";
                return true;
              });
              const newCount=(data.created||[]).filter(q=>q._bucket==="new").length;
              const revCount=(data.created||[]).filter(q=>q._bucket==="revision").length;
              const allCount=(data.created||[]).length;
              return(
                <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                  border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
                  <div onClick={()=>setQuotesThisMonthCollapsed(v=>!v)}
                    style={{padding:"16px 24px",borderBottom:quotesThisMonthCollapsed?"none":"1px solid #e8ecf0",
                    fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",
                    display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none"}}>
                    <span style={{fontSize:11,color:"#9aa5b1"}}>{quotesThisMonthCollapsed?"▶":"▼"}</span>
                    ALL QUOTES THIS MONTH ({filtered.length})
                  </div>
                  {!quotesThisMonthCollapsed&&(
                    <div>
                      {/* Filter pills */}
                      <div style={{display:"flex",gap:6,padding:"10px 24px",borderBottom:"1px solid #f0f2f5",alignItems:"center"}}>
                        {[["new","New",newCount],["revisions","Revisions",revCount],["all","All",allCount]].map(([key,label,count])=>{
                          const active=quotesThisMonthFilter===key;
                          return(
                            <button key={key} onClick={()=>setQuotesThisMonthFilter(key)}
                              style={{background:active?"#1a5276":"#f0f2f5",color:active?"#fff":"#6b7a8d",
                                border:"none",borderRadius:14,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",letterSpacing:.3}}>
                              {label} ({count})
                            </button>
                          );
                        })}
                      </div>
                      {filtered.length===0?(
                        <div style={{padding:32,textAlign:"center",color:"#9aa5b1",fontSize:13}}>
                          {quotesThisMonthFilter==="all"?"No quotes created this month yet":
                            quotesThisMonthFilter==="new"?"No new quotes this month":
                            "No revisions this month"}
                        </div>
                      ):(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr",
                            padding:"8px 24px",background:"#f8f9fb",
                            fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1"}}>
                            <div>OPPORTUNITY</div><div>ACCOUNT</div><div style={{textAlign:"right"}}>TOTAL</div>
                          </div>
                          {filtered.map(q=>(
                            <div key={q.id} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr",
                              padding:"10px 24px",borderTop:"1px solid #f0f2f5",fontSize:12}}>
                              <div
                                onClick={()=>{
                                  if(!onLoadQuote)return;
                                  // Hydrate the raw dashboard row into a full quote object for handleLoad
                                  const blob=q.data||{};
                                  onLoadQuote({
                                    ...blob,
                                    id:q.id,
                                    opp:q.opportunity||blob.opp,
                                    rev:q.revision||blob.qi?.rev||blob.rev||"",
                                    customer:q.customer||blob.customer,
                                    total:q.total||blob.total,
                                    source:blob.source||"nuforce",
                                    savedAt:q.created_at,
                                  });
                                }}
                                style={{fontWeight:600,color:"#1a5276",cursor:"pointer",
                                  textDecoration:"underline",textDecorationColor:"rgba(26,82,118,0.4)"}}>
                                {q.opportunity||"—"}
                              </div>
                              <div style={{color:"#6b7a8d"}}>{q.customer||"—"}</div>
                              <div style={{textAlign:"right",fontWeight:600,color:"#1a5276"}}>{money(q.total||0)}</div>
                            </div>
                          ))}
                          <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr",
                            padding:"10px 24px",borderTop:"2px solid #e8ecf0",
                            fontSize:12,fontWeight:700,background:"#f8f9fb"}}>
                            <div style={{color:"#1a2332"}}>Total</div>
                            <div/>
                            <div style={{textAlign:"right",color:"#1a5276"}}>
                              {money(filtered.reduce((a,q)=>a+(q.total||0),0))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 3-Month Running Averages ── */}
            {(()=>{
              const months=data.monthCounts;
              const prior3=months.slice(0,3);
              const current=months[3];
              // NEW-quote semantics: # quotes uses newCount, total value uses netTotal
              // (newTotal + net revision delta), avg quote value uses newTotal/newCount.
              // Comparisons stay weighted (sum-of-totals / sum-of-counts across the 3 months).
              const avgNewCount=prior3.length>0?prior3.reduce((a,m)=>a+(m.newCount||0),0)/prior3.length:0;
              const avgNetTotal=prior3.length>0?prior3.reduce((a,m)=>a+(m.netTotal||0),0)/prior3.length:0;
              const sumPriorNewCount=prior3.reduce((a,m)=>a+(m.newCount||0),0);
              const sumPriorNewTotal=prior3.reduce((a,m)=>a+(m.newTotal||0),0);
              const avgPriorQuoteValue=sumPriorNewCount>0?sumPriorNewTotal/sumPriorNewCount:0;
              const countDiff=(current.newCount||0)-avgNewCount;
              const totalDiff=(current.netTotal||0)-avgNetTotal;
              const countUp=countDiff>=0;
              const totalUp=totalDiff>=0;
              const currentQuoteValue=(current.newCount||0)>0?(current.newTotal||0)/(current.newCount||0):0;
              const fmt=n=>n>=1000?"$"+(n/1000).toFixed(1)+"k":"$"+Math.round(n);
              const diffColor=(up)=>up?"#1e8449":"#c0392b";
              const arrow=(up)=>up?"▲":"▼";
              return(
                <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0",marginBottom:20}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:14}}>
                    3-MONTH RUNNING AVERAGES (vs. CURRENT MONTH)
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0}}>
                    <div style={{fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",paddingBottom:8,borderBottom:"1px solid #f0f2f5"}}></div>
                    {prior3.map(m=>(
                      <div key={m.label} style={{fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",
                        paddingBottom:8,borderBottom:"1px solid #f0f2f5",textAlign:"center"}}>{m.label}</div>
                    ))}
                    <div style={{fontSize:10,fontWeight:700,color:"#6b7a8d",padding:"10px 0 6px",borderBottom:"1px solid #f0f2f5"}}># QUOTES</div>
                    {prior3.map(m=>(
                      <div key={m.label} style={{textAlign:"center",padding:"10px 0 6px",borderBottom:"1px solid #f0f2f5"}}>
                        <span style={{fontSize:16,fontWeight:700,color:"#1a2332"}}>{m.newCount||0}</span>
                      </div>
                    ))}
                    <div style={{fontSize:10,fontWeight:700,color:"#6b7a8d",padding:"10px 0 6px",borderBottom:"1px solid #f0f2f5"}}>AVG QUOTE VALUE</div>
                    {prior3.map(m=>(
                      <div key={m.label} style={{textAlign:"center",padding:"10px 0 6px",borderBottom:"1px solid #f0f2f5"}}>
                        <span style={{fontSize:13,fontWeight:600,color:"#1a2332"}}>{(m.newCount||0)>0?fmt((m.newTotal||0)/(m.newCount||0)):"—"}</span>
                      </div>
                    ))}
                    <div style={{fontSize:10,fontWeight:700,color:"#6b7a8d",padding:"10px 0 0"}}>TOTAL VALUE</div>
                    {prior3.map(m=>(
                      <div key={m.label} style={{textAlign:"center",padding:"10px 0 0"}}>
                        <span style={{fontSize:13,fontWeight:600,color:"#1a5276"}}>{fmt(m.netTotal||0)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:14,paddingTop:14,borderTop:"2px solid #f0f2f5",
                    display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:4}}>
                        {current.label.toUpperCase()} — QUOTES
                      </div>
                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                        <span style={{fontSize:22,fontWeight:800,color:"#1a5276"}}>{current.newCount||0}</span>
                        <span style={{fontSize:11,fontWeight:700,color:diffColor(countUp)}}>
                          {arrow(countUp)} {Math.abs(countDiff).toFixed(1)} vs 3-mo avg ({Math.round(avgNewCount)})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:4}}>
                        {current.label.toUpperCase()} — AVG QUOTE VALUE
                      </div>
                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                        <span style={{fontSize:22,fontWeight:800,color:"#1a2332"}}>{(current.newCount||0)>0?fmt(currentQuoteValue):"—"}</span>
                        {(current.newCount||0)>0&&avgPriorQuoteValue>0&&(
                          <span style={{fontSize:11,fontWeight:700,color:diffColor(currentQuoteValue>=avgPriorQuoteValue)}}>
                            {arrow(currentQuoteValue>=avgPriorQuoteValue)} {fmt(Math.abs(currentQuoteValue-avgPriorQuoteValue))} vs avg
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:4}}>
                        {current.label.toUpperCase()} — TOTAL VALUE
                      </div>
                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                        <span style={{fontSize:22,fontWeight:800,color:"#1a5276"}}>{fmt(current.netTotal||0)}</span>
                        <span style={{fontSize:11,fontWeight:700,color:diffColor(totalUp)}}>
                          {arrow(totalUp)} {fmt(Math.abs(totalDiff))} vs 3-mo avg
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Flagged Quotes widget ── */}
            {flaggedQuotes.length>0&&(
              <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                border:"1px solid #fca5a5",overflow:"hidden",marginBottom:20}}>
                <div style={{padding:"14px 24px",borderBottom:"1px solid #fca5a5",
                  display:"flex",alignItems:"center",justifyContent:"space-between",
                  background:"#fff5f5"}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#b91c1c"}}>
                      🚩 FLAGGED QUOTES
                    </div>
                    <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>
                      {flaggedQuotes.length} quote{flaggedQuotes.length!==1?"s":""} need attention
                    </div>
                  </div>
                  <button onClick={loadFlags}
                    style={{background:"none",border:"1px solid #fca5a5",borderRadius:6,
                      padding:"4px 12px",fontSize:11,cursor:"pointer",color:"#b91c1c"}}>
                    ↻ Refresh
                  </button>
                </div>
                <div>
                  {flaggedQuotes.map(f=>(
                    <div key={f.id}
                      data-quoteid={String(f.quote_id)}
                      onClick={async(e)=>{
                        if(!onLoadQuote)return;
                        const qid=Number(e.currentTarget.getAttribute('data-quoteid'));
                        try {
                          const rows = await restFetch("GET",
                            `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(qid)}&limit=1`);
                          const row = (rows||[])[0];
                          if(!row)return;
                          const q=row.data||{};
                          const match={...q,id:row.id,opp:row.opportunity||q.opp,
                            customer:row.customer||q.customer,rfq:row.rfq||q.rfq,
                            total:row.total??q.total,savedAt:row.updated_at,
                            source:"nuforce",
                            approval:{...(q.approval||{}),status:row.approval_status||q.approval?.status||"none"}};
                          onLoadQuote(match);
                        } catch(err) {
                          console.warn("[QUOTE-LOAD flagged] failed:", err?.message||err);
                        }
                      }}
                      style={{padding:"12px 24px",borderBottom:"1px solid #fee2e2",
                        cursor:"pointer",display:"flex",alignItems:"flex-start",
                        justifyContent:"space-between",gap:12,
                        transition:"background 0.1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#fff5f5"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                          <span style={{fontWeight:700,fontSize:13,color:"#b91c1c"}}>{f.opportunity}</span>
                          <span style={{fontSize:12,color:"#4a5568"}}>{f.customer}</span>
                        </div>
                        {f.note&&(
                          <div style={{fontSize:11,color:"#6b7a8d",fontStyle:"italic",marginBottom:2}}>
                            "{f.note}"
                          </div>
                        )}
                        <div style={{fontSize:10,color:"#9aa5b1"}}>
                          Flagged by {f.flagged_by} · {new Date(f.flagged_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                        </div>
                      </div>
                      <span style={{fontSize:11,color:"#b91c1c",flexShrink:0}}>→</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Approval Queue widget (approvers only) ── */}
            {isApprover&&(
              <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
                <div style={{padding:"14px 24px",borderBottom:"1px solid #e8ecf0",
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>
                    APPROVAL QUEUE
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={()=>{setShowRecentApproved(true);if(!recentApproved)loadRecentApproved(recentDays);}}
                      style={{background:"none",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"3px 10px",fontSize:11,cursor:"pointer",color:"#1a5276",fontWeight:600}}>
                      ✓ Recently Approved
                    </button>
                    {pendingQuotes.length>0&&(
                      <span style={{background:"#c0392b",color:"#fff",borderRadius:10,
                        fontSize:10,fontWeight:700,padding:"2px 8px"}}>
                        {pendingQuotes.length} pending
                      </span>
                    )}
                  </div>
                </div>
                {pendingQuotes.length===0?(
                  <div style={{padding:"24px",textAlign:"center",color:"#9aa5b1",fontSize:12}}>
                    ✓ No pending approvals
                  </div>
                ):(
                  <div>
                    {/* Select all */}
                    <div style={{padding:"8px 24px",background:"#f8f9fb",borderBottom:"1px solid #e8ecf0",
                      display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}
                      onClick={()=>{
                        if(qSelected.size===pendingQuotes.length)setQSelected(new Set());
                        else setQSelected(new Set(pendingQuotes.map(q=>String(q.id))));
                      }}>
                      <input type="checkbox" readOnly
                        checked={qSelected.size===pendingQuotes.length&&pendingQuotes.length>0}
                        style={{accentColor:"#6d28d9",width:13,height:13}}/>
                      <span style={{fontSize:10,fontWeight:700,color:"#6b7a8d",letterSpacing:.5}}>SELECT ALL</span>
                    </div>
                    {/* Queue rows */}
                    {pendingQuotes.map(q=>{
                      const sel=qSelected.has(String(q.id));
                      const subAt=q.approval?.submittedAt?new Date(q.approval.submittedAt).toLocaleDateString():"";
                      const isWon=q.wonApproval?.status==="pending_won";
                      return(
                        <div key={q.id}
                          style={{padding:"12px 24px",borderBottom:"1px solid #f0f2f5",
                            background:sel?"#f5f3ff":"#fff",
                            display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}
                          onClick={()=>{
                            const s=new Set(qSelected);
                            if(s.has(String(q.id)))s.delete(String(q.id));
                            else s.add(String(q.id));
                            setQSelected(s);
                          }}>
                          <input type="checkbox" readOnly checked={sel}
                            style={{accentColor:"#6d28d9",width:13,height:13,flexShrink:0,pointerEvents:"none"}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:13,color:"#1a2332",marginBottom:2,
                              display:"flex",alignItems:"center",gap:8}}>
                              <span
                                onClick={e=>{e.stopPropagation();onLoadQuote&&onLoadQuote(q);}}
                                style={{color:"#1a5276",cursor:"pointer",textDecoration:"underline",
                                  textDecorationColor:"rgba(26,82,118,0.4)"}}>
                                {q.qi?.opp||q.opp||"(no opp)"}
                              </span>
                              {isWon
                                ?<span style={{fontSize:9,background:"#d1fae5",color:"#065f46",borderRadius:4,padding:"2px 6px",fontWeight:700}}>🏆 CLOSED WON</span>
                                :<span style={{fontSize:9,background:"#ede9fe",color:"#4c1d95",borderRadius:4,padding:"2px 6px",fontWeight:700}}>📋 QUOTE</span>
                              }
                            </div>
                            <div style={{fontSize:11,color:"#6b7a8d",display:"flex",gap:12,flexWrap:"wrap"}}>
                              {(q.qi?.customer||q.customer)&&<span>{q.qi?.customer||q.customer}</span>}
                              {subAt&&<span>Submitted: {subAt}</span>}
                              {(isWon?q.wonApproval?.submittedBy:q.approval?.submittedBy)&&<span>By: {isWon?q.wonApproval.submittedBy:q.approval.submittedBy}</span>}
                            </div>
                          </div>
                          <div style={{fontWeight:700,fontSize:13,color:"#1e8449",flexShrink:0}}>
                            {money(q.total||0)}
                          </div>
                        </div>
                      );
                    })}
                    {/* Action footer */}
                    <div style={{padding:"14px 24px",borderTop:"1px solid #e8ecf0",background:"#f8f9fb"}}>
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:11,color:"#6b7a8d",fontWeight:600,marginBottom:4}}>
                          COMMENTS (applied to selected decisions)
                        </div>
                        <textarea value={qComments} onChange={e=>setQComments(e.target.value)}
                          placeholder="Optional comments..."
                          style={{width:"100%",height:48,border:"1px solid #d0d7de",borderRadius:7,
                            padding:"6px 10px",fontSize:12,resize:"none",fontFamily:"inherit",
                            boxSizing:"border-box"}}/>
                      </div>
                      <div style={{display:"flex",gap:8,justifyContent:"flex-end",alignItems:"center"}}>
                        {qSelected.size===0&&(
                          <span style={{fontSize:11,color:"#6b7a8d",marginRight:8}}>Select quotes above to act</span>
                        )}
                        <button disabled={qSelected.size===0}
                          onClick={()=>{onQueueDecision("rejected",[...qSelected]);setQSelected(new Set());setQComments("");}}
                          style={{background:qSelected.size===0?"#e8ecf0":"#c0392b",border:"none",borderRadius:7,
                            padding:"7px 18px",color:qSelected.size===0?"#9aa5b1":"#fff",
                            fontWeight:700,fontSize:12,cursor:qSelected.size===0?"default":"pointer"}}>
                          ✗ Reject
                        </button>
                        <button disabled={qSelected.size===0}
                          onClick={()=>{onQueueDecision("approved",[...qSelected]);setQSelected(new Set());setQComments("");}}
                          style={{background:qSelected.size===0?"#e8ecf0":"#1e8449",border:"none",borderRadius:7,
                            padding:"7px 18px",color:qSelected.size===0?"#9aa5b1":"#fff",
                            fontWeight:700,fontSize:12,cursor:qSelected.size===0?"default":"pointer"}}>
                          ✓ Approve
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── AI Quote Assistant ── */}
            {isFollowUpUser&&(
              <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>                <div style={{padding:"14px 24px",borderBottom:"1px solid #e8ecf0",
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>                  <div>                    <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>🤖 QUOTE ASSISTANT</div>
                    <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>Ask anything about your quotes or follow-ups</div>
                  </div>
                  {aiMessages.length>0&&(
                    <button onClick={()=>setAiMessages([])}
                      style={{background:"none",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"4px 12px",fontSize:11,cursor:"pointer",color:"#6b7a8d"}}>
                      Clear
                    </button>
                  )}
                </div>
                {aiMessages.length>0&&(
                  <div style={{maxHeight:320,overflowY:"auto",padding:"12px 24px",
                    display:"flex",flexDirection:"column",gap:10}}>
                    {aiMessages.map((msg,i)=>(
                      <div key={i} style={{
                        alignSelf:msg.role==="user"?"flex-end":"flex-start",
                        maxWidth:"85%",
                        background:msg.role==="user"?"#1a2332":"#f4f6f9",
                        color:msg.role==="user"?"#fff":"#1a2332",
                        borderRadius:msg.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",
                        padding:"8px 12px",fontSize:12,lineHeight:1.6,
                        whiteSpace:"pre-wrap",wordBreak:"break-word",
                      }}>
                        {msg.content}
                      </div>
                    ))}
                    {aiLoading&&(
                      <div style={{alignSelf:"flex-start",background:"#f4f6f9",
                        borderRadius:"12px 12px 12px 2px",padding:"8px 14px",
                        fontSize:12,color:"#9aa5b1"}}>
                        ●●● thinking...
                      </div>
                    )}
                  </div>
                )}
                <div style={{padding:"12px 24px",borderTop:aiMessages.length>0?"1px solid #e8ecf0":"none",
                  display:"flex",gap:8}}>
                  <input
                    value={aiInput}
                    onChange={e=>setAiInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();askAI(aiInput);}}}
                    placeholder="Ask about quotes, follow-ups, accounts..."
                    style={{flex:1,fontSize:12,borderRadius:8,border:"1px solid #d0d7de",
                      padding:"8px 12px",outline:"none",fontFamily:"inherit",
                      background:"#f8f9fb",color:"#1a2332"}}
                    disabled={aiLoading}
                  />
                  <button
                    onClick={()=>askAI(aiInput)}
                    disabled={aiLoading||!aiInput.trim()}
                    style={{background:aiLoading||!aiInput.trim()?"#e8ecf0":"#1a2332",
                      border:"none",borderRadius:8,padding:"8px 16px",
                      color:aiLoading||!aiInput.trim()?"#9aa5b1":"#fff",
                      fontSize:12,fontWeight:700,cursor:aiLoading||!aiInput.trim()?"default":"pointer",
                      transition:"all 0.15s"}}>
                    {aiLoading?"...":"Ask"}
                  </button>
                </div>
                {aiMessages.length===0&&(
                  <div style={{padding:"0 24px 14px",display:"flex",flexWrap:"wrap",gap:6}}>
                    {[
                      "Quotes not followed up in 60 days",
                      "Open proposals over $50k",
                      "What does Lockheed have outstanding?",
                      "Who has the most pending quotes?",
                    ].map(q=>(
                      <button key={q} onClick={()=>askAI(q)}
                        style={{background:"#f4f6f9",border:"1px solid #e8ecf0",borderRadius:20,
                          padding:"4px 10px",fontSize:11,cursor:"pointer",color:"#4a5568",
                          transition:"background 0.1s"}}
                        onMouseEnter={e=>e.target.style.background="#e8ecf0"}
                        onMouseLeave={e=>e.target.style.background="#f4f6f9"}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Product Codes panel — drilldown by code with year filter ── */}
            <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
              border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
              <div style={{padding:"14px 24px",borderBottom:codeReportPanelOpen?"1px solid #e8ecf0":"none",
                display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}
                onClick={()=>{
                  const next = !codeReportPanelOpen;
                  setCodeReportPanelOpen(next);
                  if (next) loadCodeReport(); // Fresh load every open per Jordan's pref
                }}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>📊 PRODUCT CODES</div>
                  <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>
                    Drilldown by product code — totals, win rate, per quote
                  </div>
                </div>
                <div style={{fontSize:14,color:"#9aa5b1"}}>{codeReportPanelOpen?"▼":"▶"}</div>
              </div>
              {codeReportPanelOpen&&(
                <div style={{padding:"14px 24px"}}>
                  {codeReportLoading&&(
                    <div style={{padding:"24px",textAlign:"center",color:"#9aa5b1",fontSize:12}}>
                      Loading product code data...
                    </div>
                  )}
                  {!codeReportLoading&&codeReportData&&(()=>{
                    // Compute year options: all years present in data, plus "all" and "unknown" if present
                    const yearSet = new Set(codeReportData.map(e=>e.year));
                    const sortedYears = [...yearSet].filter(y=>y!=="unknown").sort().reverse();
                    const hasUnknown = yearSet.has("unknown");
                    const years = ["all", ...sortedYears, ...(hasUnknown?["unknown"]:[])];
                    // Apply year filter
                    const yearFiltered = codeReportYear==="all"
                      ? codeReportData
                      : codeReportData.filter(e=>e.year===codeReportYear);
                    // Code dropdown options: union of canonical PCODES + any extra codes found in data
                    const dataCodes = [...new Set(yearFiltered.map(e=>e.code))].sort();
                    // Filtered by selected code
                    const selected = codeReportCode
                      ? yearFiltered.filter(e=>e.code===codeReportCode)
                      : [];
                    // Aggregate metrics for the selected code
                    const winStages = new Set(["Closed Won"]);
                    const lostStages = new Set(["Closed Lost"]);
                    const wonItems = selected.filter(e=>winStages.has(e.stage));
                    const lostItems = selected.filter(e=>lostStages.has(e.stage));
                    const openItems = selected.filter(e=>!winStages.has(e.stage)&&!lostStages.has(e.stage));
                    const uniqueQuotes = new Set(selected.map(e=>e.quoteId)).size;
                    const totalValue = selected.reduce((a,e)=>a+(e.price||0),0);
                    const wonValue = wonItems.reduce((a,e)=>a+(e.price||0),0);
                    const lostValue = lostItems.reduce((a,e)=>a+(e.price||0),0);
                    const openValue = openItems.reduce((a,e)=>a+(e.price||0),0);
                    const uniqueWonQuotes = new Set(wonItems.map(e=>e.quoteId)).size;
                    const uniqueLostQuotes = new Set(lostItems.map(e=>e.quoteId)).size;
                    const uniqueOpenQuotes = new Set(openItems.map(e=>e.quoteId)).size;
                    // Win rate: won quotes / total quotes (includes open/pending in denominator)
                    const winRate = uniqueQuotes>0
                      ? Math.round((uniqueWonQuotes/uniqueQuotes)*100)
                      : null;
                    // Won value rate: dollars won / total dollars quoted at this code
                    const wonValueRate = totalValue>0
                      ? Math.round((wonValue/totalValue)*100)
                      : null;

                    // ── Lifetime + 3yr-average won-value-rate (volume-weighted) ──
                    // Computed across ALL entries for this code (ignoring the year filter)
                    // so they don't shift when the user switches year pills.
                    const allForCode = codeReportCode
                      ? codeReportData.filter(e=>e.code===codeReportCode)
                      : [];
                    const lifetimeWonItems = allForCode.filter(e=>winStages.has(e.stage));
                    const lifetimeTotal = allForCode.reduce((a,e)=>a+(e.price||0),0);
                    const lifetimeWon = lifetimeWonItems.reduce((a,e)=>a+(e.price||0),0);
                    const lifetimeRate = lifetimeTotal>0
                      ? Math.round((lifetimeWon/lifetimeTotal)*100)
                      : null;

                    // 3yr avg = volume-weighted rate across the 3 years immediately
                    // BEFORE the selected year. Excludes the selected year itself so
                    // it's a clean past-vs-current comparison.
                    let threeYrRate = null;
                    let threeYrLabel = "";
                    if (codeReportYear !== "all" && codeReportYear !== "unknown") {
                      const yr = parseInt(codeReportYear, 10);
                      if (!isNaN(yr)) {
                        const includedYears = [String(yr-1), String(yr-2), String(yr-3)];
                        threeYrLabel = `${yr-3}–${yr-1}`;
                        const threeYrItems = allForCode.filter(e=>includedYears.includes(e.year));
                        const threeYrTotal = threeYrItems.reduce((a,e)=>a+(e.price||0),0);
                        const threeYrWon = threeYrItems.filter(e=>winStages.has(e.stage))
                          .reduce((a,e)=>a+(e.price||0),0);
                        threeYrRate = threeYrTotal>0
                          ? Math.round((threeYrWon/threeYrTotal)*100)
                          : null;
                      }
                    }
                    // Comparison arrow vs lifetime (only meaningful when viewing a specific year)
                    const isYearSpecific = codeReportYear !== "all" && codeReportYear !== "unknown";
                    let trendArrow = "", trendColor = "#9aa5b1";
                    if (isYearSpecific && wonValueRate !== null && lifetimeRate !== null) {
                      const diff = wonValueRate - lifetimeRate;
                      if (diff > 5) { trendArrow = "↑"; trendColor = "#239b56"; }
                      else if (diff < -5) { trendArrow = "↓"; trendColor = "#b91c1c"; }
                    }
                    return (<>
                      {/* Year filter — pill row */}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                        {years.map(y=>(
                          <button key={y} onClick={()=>setCodeReportYear(y)}
                            style={{background:codeReportYear===y?"#1a2332":"#f4f6f9",
                              border:"1px solid "+(codeReportYear===y?"#1a2332":"#e8ecf0"),
                              borderRadius:14,padding:"3px 10px",fontSize:11,cursor:"pointer",
                              color:codeReportYear===y?"#fff":"#4a5568",fontWeight:600}}>
                            {y==="all"?"All Time":(y==="unknown"?"Unknown":y)}
                          </button>
                        ))}
                      </div>
                      {/* Code selector */}
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                        <span style={{fontSize:11,color:"#6b7a8d",fontWeight:600}}>Code:</span>
                        <select value={codeReportCode}
                          onChange={e=>setCodeReportCode(e.target.value)}
                          style={{fontSize:11,padding:"4px 8px",borderRadius:6,
                            border:"1px solid #d0d7de",background:"#fff",color:"#1a2332",minWidth:220}}>
                          <option value="">— Select a code —</option>
                          {dataCodes.map(c=>{
                            const label = codeLabelLookup(c);
                            return (
                              <option key={c} value={c}>
                                {c}{label?" – "+label:" – (unknown)"}
                              </option>
                            );
                          })}
                        </select>
                        <span style={{fontSize:11,color:"#9aa5b1"}}>
                          {dataCodes.length} codes in {codeReportYear==="all"?"all time":codeReportYear}
                        </span>
                      </div>
                      {/* Summary cards (only if a code is selected) */}
                      {codeReportCode&&(<>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
                          <div style={{background:"#f8f9fb",border:"1px solid #e8ecf0",borderRadius:8,padding:"10px 12px"}}>
                            <div style={{fontSize:9,color:"#9aa5b1",fontWeight:700,letterSpacing:1}}>TOTAL LINE ITEMS</div>
                            <div style={{fontSize:20,fontWeight:800,color:"#1a2332",marginTop:4}}>{selected.length}</div>
                            <div style={{fontSize:10,color:"#6b7a8d",marginTop:2}}>in {uniqueQuotes} quotes</div>
                          </div>
                          <div style={{background:"#f8f9fb",border:"1px solid #e8ecf0",borderRadius:8,padding:"10px 12px"}}>
                            <div style={{fontSize:9,color:"#9aa5b1",fontWeight:700,letterSpacing:1}}>TOTAL VALUE</div>
                            <div style={{fontSize:20,fontWeight:800,color:"#1a2332",marginTop:4}}>${Math.round(totalValue).toLocaleString()}</div>
                            <div style={{fontSize:10,color:"#6b7a8d",marginTop:2}}>across all stages</div>
                          </div>
                          <div style={{background:"#eafaf1",border:"1px solid #cbeed6",borderRadius:8,padding:"10px 12px"}}>
                            <div style={{fontSize:9,color:"#239b56",fontWeight:700,letterSpacing:1}}>WON</div>
                            <div style={{fontSize:20,fontWeight:800,color:"#1a6b3a",marginTop:4}}>${Math.round(wonValue).toLocaleString()}</div>
                            <div style={{fontSize:10,color:"#1a6b3a",marginTop:2}}>{uniqueWonQuotes} quotes</div>
                          </div>
                          <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 12px"}}>
                            <div style={{fontSize:9,color:"#b91c1c",fontWeight:700,letterSpacing:1}}>LOST</div>
                            <div style={{fontSize:20,fontWeight:800,color:"#b91c1c",marginTop:4}}>${Math.round(lostValue).toLocaleString()}</div>
                            <div style={{fontSize:10,color:"#b91c1c",marginTop:2}}>{uniqueLostQuotes} quotes</div>
                          </div>
                        </div>
                        {/* Win rate + won value + open */}
                        <div style={{display:"flex",gap:14,fontSize:11,color:"#6b7a8d",marginBottom:8,
                          padding:"8px 12px",background:"#f8f9fb",borderRadius:6,flexWrap:"wrap"}}>
                          <div><b>Win rate:</b> {winRate===null?"—":winRate+"%"} <span style={{color:"#9aa5b1"}}>({uniqueWonQuotes} won / {uniqueQuotes} total)</span></div>
                          <div><b>Won value:</b> {wonValueRate===null?"—":wonValueRate+"%"} {trendArrow&&<span style={{color:trendColor,fontWeight:700,marginLeft:2}}>{trendArrow}</span>} <span style={{color:"#9aa5b1"}}>(${Math.round(wonValue).toLocaleString()} / ${Math.round(totalValue).toLocaleString()} quoted)</span></div>
                          <div><b>Open:</b> ${Math.round(openValue).toLocaleString()} <span style={{color:"#9aa5b1"}}>({uniqueOpenQuotes} quotes)</span></div>
                        </div>
                        {/* Won-value-rate comparison row: this year vs 3yr avg vs lifetime */}
                        <div style={{display:"flex",gap:14,fontSize:11,color:"#6b7a8d",marginBottom:12,
                          padding:"8px 12px",background:"#fafbfc",border:"1px dashed #e8ecf0",borderRadius:6,flexWrap:"wrap"}}>
                          {isYearSpecific && (
                            <div><b>{codeReportYear} won value:</b> {wonValueRate===null?"—":wonValueRate+"%"}</div>
                          )}
                          {threeYrRate !== null && (
                            <div><b>{threeYrLabel} avg:</b> {threeYrRate}%</div>
                          )}
                          <div><b>Lifetime avg:</b> {lifetimeRate===null?"—":lifetimeRate+"%"} <span style={{color:"#9aa5b1"}}>(volume-weighted across all years)</span></div>
                        </div>
                        {/* Per-quote rows */}
                        <div style={{maxHeight:360,overflowY:"auto",border:"1px solid #e8ecf0",borderRadius:8}}>
                          <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                            <thead style={{background:"#f4f6f9",position:"sticky",top:0}}>
                              <tr>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}>OPP</th>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}>CUSTOMER</th>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}>LINE LABEL</th>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}>STAGE</th>
                                <th style={{padding:"6px 10px",textAlign:"right",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}>$ AT CODE</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:9,color:"#9aa5b1",letterSpacing:1,fontWeight:700}}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {selected.sort((a,b)=>(b.opp||"").localeCompare(a.opp||"")).map((e,i)=>{
                                const isWon = winStages.has(e.stage);
                                const isLost = lostStages.has(e.stage);
                                const stageColor = isWon?"#239b56":(isLost?"#b91c1c":"#1a5276");
                                return (
                                  <tr key={i} style={{borderBottom:"1px solid #f0f2f5"}}>
                                    <td style={{padding:"6px 10px",fontWeight:600,color:"#1a2332"}}>{e.opp}</td>
                                    <td style={{padding:"6px 10px",color:"#4a5568"}}>{e.customer}</td>
                                    <td style={{padding:"6px 10px",color:"#6b7a8d",fontSize:10}}>{e.lineLabel||"(no label)"}</td>
                                    <td style={{padding:"6px 10px",color:stageColor,fontWeight:600,fontSize:10}}>{e.stage||"(none)"}</td>
                                    <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,color:"#1a2332"}}>${Math.round(e.price).toLocaleString()}</td>
                                    <td style={{padding:"6px 10px",textAlign:"center"}}>
                                      <button onClick={async()=>{
                                          if(!onLoadQuote)return;
                                          try {
                                            const rows = await restFetch("GET",
                                              `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(e.quoteId)}&limit=1`);
                                            const row = (rows||[])[0];
                                            if(!row)return;
                                            const blob=row.data||{};
                                            onLoadQuote({...blob,id:row.id,
                                              opp:row.opportunity||blob.opp,
                                              customer:row.customer||blob.customer,
                                              rfq:row.rfq||blob.rfq,
                                              total:row.total??blob.total,
                                              savedAt:row.updated_at,
                                              source:row.source||"nuforce",
                                              approval:{...(blob.approval||{}),status:row.approval_status||"none"},
                                              wonApproval:{...(blob.wonApproval||{}),status:row.won_approval_status||"none"},
                                            });
                                          } catch(err) {
                                            console.warn("[CODE-REPORT-OPEN] failed:", err?.message||err);
                                          }
                                        }}
                                        style={{background:"none",border:"1px solid #d0d7de",
                                          borderRadius:5,padding:"2px 8px",fontSize:10,
                                          cursor:"pointer",color:"#1a5276",fontWeight:600}}>
                                        Open
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>)}
                      {!codeReportCode&&(
                        <div style={{padding:"20px",textAlign:"center",color:"#9aa5b1",fontSize:12,
                          background:"#f8f9fb",borderRadius:8}}>
                          Pick a code from the dropdown above to see metrics and quotes.
                        </div>
                      )}
                      <div style={{fontSize:10,color:"#9aa5b1",marginTop:10,textAlign:"right"}}>
                        Loaded {codeReportData.length.toLocaleString()} code-tagged line items from {new Set(codeReportData.map(e=>e.quoteId)).size.toLocaleString()} quotes
                        <button onClick={loadCodeReport}
                          style={{marginLeft:10,background:"none",border:"none",color:"#1a5276",
                            fontSize:10,cursor:"pointer",textDecoration:"underline"}}>
                          Reload
                        </button>
                      </div>
                    </>);
                  })()}
                </div>
              )}
            </div>

            {/* ── Code Comparison panel — chart won-value-rate of two codes across all years ── */}
            <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
              border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
              <div style={{padding:"14px 24px",borderBottom:codeCompareOpen?"1px solid #e8ecf0":"none",
                display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}
                onClick={()=>{
                  const next = !codeCompareOpen;
                  setCodeCompareOpen(next);
                  // If opening and data hasn't been loaded yet, kick off a load.
                  // The Product Codes panel uses the same dataset.
                  if (next && !codeReportData && !codeReportLoading) loadCodeReport();
                }}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>📈 CODE COMPARISON</div>
                  <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>
                    Compare won value % between two product codes across all years
                  </div>
                </div>
                <div style={{fontSize:14,color:"#9aa5b1"}}>{codeCompareOpen?"▼":"▶"}</div>
              </div>
              {codeCompareOpen&&(
                <div style={{padding:"14px 24px"}}>
                  {codeReportLoading&&(
                    <div style={{padding:"24px",textAlign:"center",color:"#9aa5b1",fontSize:12}}>
                      Loading product code data...
                    </div>
                  )}
                  {!codeReportLoading&&codeReportData&&(()=>{
                    // Comparison panel scope: exclude pre-2016 data entirely.
                    // Both the chart and the summary numbers respect this cutoff.
                    const CUTOFF_YEAR = 2016;
                    const inScope = codeReportData.filter(e => {
                      if (e.year === "unknown") return false;
                      const y = parseInt(e.year, 10);
                      return !isNaN(y) && y >= CUTOFF_YEAR;
                    });
                    // Build the list of available codes (only those with any data in-scope)
                    const dataCodes = [...new Set(inScope.map(e=>e.code))].sort();
                    // Each selected code: compute yearly won-value-rate + lifetime + 3yr avg
                    const computeStats = (code) => {
                      if (!code) return null;
                      const all = inScope.filter(e => e.code === code);
                      // Group by year (skip "unknown")
                      const byYear = {};
                      const winStages = new Set(["Closed Won"]);
                      all.forEach(e => {
                        if (e.year === "unknown") return;
                        if (!byYear[e.year]) byYear[e.year] = {total:0, won:0};
                        byYear[e.year].total += e.price || 0;
                        if (winStages.has(e.stage)) byYear[e.year].won += e.price || 0;
                      });
                      const series = Object.entries(byYear)
                        .map(([yr, v]) => ({
                          year: yr,
                          rate: v.total > 0 ? Math.round((v.won / v.total) * 100) : null,
                          total: v.total,
                          won: v.won,
                        }))
                        .filter(p => p.rate !== null)
                        .sort((a, b) => a.year.localeCompare(b.year));
                      // Lifetime + 3yr (volume-weighted, last 3 complete years before current)
                      const lifetimeTotal = all.reduce((a,e)=>a+(e.price||0),0);
                      const lifetimeWon = all.filter(e=>winStages.has(e.stage)).reduce((a,e)=>a+(e.price||0),0);
                      const lifetimeRate = lifetimeTotal > 0 ? Math.round((lifetimeWon/lifetimeTotal)*100) : null;
                      // 3yr: last 3 years present in the data (excluding current year)
                      const nowYr = new Date().getFullYear();
                      const threeYrItems = all.filter(e => {
                        if (e.year === "unknown") return false;
                        const y = parseInt(e.year, 10);
                        return y >= nowYr-3 && y < nowYr;
                      });
                      const threeYrTotal = threeYrItems.reduce((a,e)=>a+(e.price||0),0);
                      const threeYrWon = threeYrItems.filter(e=>winStages.has(e.stage)).reduce((a,e)=>a+(e.price||0),0);
                      const threeYrRate = threeYrTotal > 0 ? Math.round((threeYrWon/threeYrTotal)*100) : null;
                      return {code, series, lifetimeRate, threeYrRate};
                    };
                    const statsA = computeStats(codeCompareA);
                    const statsB = computeStats(codeCompareB);
                    // Build x-axis: union of all years present in either series
                    const allYearsSet = new Set();
                    if (statsA) statsA.series.forEach(p => allYearsSet.add(p.year));
                    if (statsB) statsB.series.forEach(p => allYearsSet.add(p.year));
                    const xYears = [...allYearsSet].sort();

                    return (<>
                      {/* Two code selectors side by side */}
                      <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:"#1a5276",fontWeight:700,
                            background:"#dbe9f7",padding:"2px 6px",borderRadius:4}}>A</span>
                          <select value={codeCompareA}
                            onChange={e=>setCodeCompareA(e.target.value)}
                            style={{fontSize:11,padding:"4px 8px",borderRadius:6,
                              border:"1px solid #d0d7de",background:"#fff",color:"#1a2332",minWidth:220}}>
                            <option value="">— Select first code —</option>
                            {dataCodes.map(c=>{
                              const label = codeLabelLookup(c);
                              return (
                                <option key={c} value={c}>{c}{label?" – "+label:" – (unknown)"}</option>
                              );
                            })}
                          </select>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,color:"#92400e",fontWeight:700,
                            background:"#fef3c7",padding:"2px 6px",borderRadius:4}}>B</span>
                          <select value={codeCompareB}
                            onChange={e=>setCodeCompareB(e.target.value)}
                            style={{fontSize:11,padding:"4px 8px",borderRadius:6,
                              border:"1px solid #d0d7de",background:"#fff",color:"#1a2332",minWidth:220}}>
                            <option value="">— Select second code —</option>
                            {dataCodes.map(c=>{
                              const label = codeLabelLookup(c);
                              return (
                                <option key={c} value={c}>{c}{label?" – "+label:" – (unknown)"}</option>
                              );
                            })}
                          </select>
                        </div>
                      </div>

                      {/* Summary numbers + chart */}
                      {(statsA || statsB) && (
                        <>
                          {/* Summary block: lifetime + 3yr avg for each */}
                          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                            {statsA && (
                              <div style={{flex:1,minWidth:220,background:"#f4f7fb",
                                border:"1px solid #dbe9f7",borderRadius:8,padding:"10px 12px"}}>
                                <div style={{fontSize:10,color:"#1a5276",fontWeight:700,marginBottom:4}}>
                                  A — {statsA.code}{codeLabelLookup(statsA.code)?" – "+codeLabelLookup(statsA.code):""}
                                </div>
                                <div style={{display:"flex",gap:18,fontSize:11,color:"#4a5568"}}>
                                  <div><b>Lifetime:</b> {statsA.lifetimeRate===null?"—":statsA.lifetimeRate+"%"}</div>
                                  <div><b>3yr avg:</b> {statsA.threeYrRate===null?"—":statsA.threeYrRate+"%"}</div>
                                </div>
                              </div>
                            )}
                            {statsB && (
                              <div style={{flex:1,minWidth:220,background:"#fffbeb",
                                border:"1px solid #fef3c7",borderRadius:8,padding:"10px 12px"}}>
                                <div style={{fontSize:10,color:"#92400e",fontWeight:700,marginBottom:4}}>
                                  B — {statsB.code}{codeLabelLookup(statsB.code)?" – "+codeLabelLookup(statsB.code):""}
                                </div>
                                <div style={{display:"flex",gap:18,fontSize:11,color:"#4a5568"}}>
                                  <div><b>Lifetime:</b> {statsB.lifetimeRate===null?"—":statsB.lifetimeRate+"%"}</div>
                                  <div><b>3yr avg:</b> {statsB.threeYrRate===null?"—":statsB.threeYrRate+"%"}</div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Chart — hand-built SVG */}
                          {xYears.length > 0 && (()=>{
                            // SVG dimensions
                            const W = 700, H = 240;
                            const PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 30;
                            const innerW = W - PAD_L - PAD_R;
                            const innerH = H - PAD_T - PAD_B;
                            // X: years evenly spaced
                            const xStep = xYears.length > 1 ? innerW / (xYears.length - 1) : 0;
                            const xFor = (yr) => {
                              const idx = xYears.indexOf(yr);
                              return PAD_L + (xYears.length > 1 ? idx * xStep : innerW/2);
                            };
                            // Y: 0-100% (top of chart = 100, bottom = 0)
                            const yFor = (rate) => PAD_T + innerH * (1 - rate/100);
                            // Build point arrays
                            const pointsFor = (series) => series
                              .filter(p => xYears.includes(p.year))
                              .map(p => ({x: xFor(p.year), y: yFor(p.rate), year: p.year, rate: p.rate}));
                            const ptsA = statsA ? pointsFor(statsA.series) : [];
                            const ptsB = statsB ? pointsFor(statsB.series) : [];
                            const pathFor = (pts) => pts.length === 0 ? "" :
                              "M " + pts.map(p => p.x+","+p.y).join(" L ");
                            return (
                              <div style={{background:"#fafbfc",border:"1px solid #e8ecf0",borderRadius:8,padding:14}}>
                                <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
                                  preserveAspectRatio="xMidYMid meet"
                                  style={{display:"block"}}>
                                  {/* Y-axis gridlines + labels: 0, 25, 50, 75, 100 */}
                                  {[0,25,50,75,100].map(pct => {
                                    const y = yFor(pct);
                                    return (
                                      <g key={pct}>
                                        <line x1={PAD_L} y1={y} x2={W-PAD_R} y2={y}
                                          stroke="#e8ecf0" strokeWidth="1" strokeDasharray={pct===0?"":"2,3"}/>
                                        <text x={PAD_L-6} y={y+3} textAnchor="end"
                                          fontSize="10" fill="#9aa5b1">{pct}%</text>
                                      </g>
                                    );
                                  })}
                                  {/* X-axis year labels */}
                                  {xYears.map(yr => (
                                    <text key={yr} x={xFor(yr)} y={H-PAD_B+16}
                                      textAnchor="middle" fontSize="10" fill="#6b7a8d">{yr}</text>
                                  ))}
                                  {/* Line A (blue) */}
                                  {ptsA.length > 1 && (
                                    <path d={pathFor(ptsA)} fill="none" stroke="#1a5276" strokeWidth="2"/>
                                  )}
                                  {ptsA.map((p,i) => (
                                    <g key={"a"+i}>
                                      <circle cx={p.x} cy={p.y} r="4" fill="#1a5276"/>
                                      <title>{statsA.code} — {p.year}: {p.rate}%</title>
                                    </g>
                                  ))}
                                  {/* Line B (amber) */}
                                  {ptsB.length > 1 && (
                                    <path d={pathFor(ptsB)} fill="none" stroke="#92400e" strokeWidth="2"/>
                                  )}
                                  {ptsB.map((p,i) => (
                                    <g key={"b"+i}>
                                      <circle cx={p.x} cy={p.y} r="4" fill="#92400e"/>
                                      <title>{statsB.code} — {p.year}: {p.rate}%</title>
                                    </g>
                                  ))}
                                </svg>
                                {/* Legend */}
                                <div style={{display:"flex",gap:18,marginTop:8,fontSize:11,color:"#6b7a8d",
                                  justifyContent:"center"}}>
                                  {statsA && (
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <span style={{width:16,height:3,background:"#1a5276",display:"inline-block",borderRadius:1}}></span>
                                      A — {statsA.code}
                                    </div>
                                  )}
                                  {statsB && (
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <span style={{width:16,height:3,background:"#92400e",display:"inline-block",borderRadius:1}}></span>
                                      B — {statsB.code}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </>
                      )}
                      {!statsA && !statsB && (
                        <div style={{padding:"20px",textAlign:"center",color:"#9aa5b1",fontSize:12,
                          background:"#f8f9fb",borderRadius:8}}>
                          Pick two product codes above to compare their won-value-rate over time.
                        </div>
                      )}
                    </>);
                  })()}
                  {!codeReportLoading&&!codeReportData&&(
                    <div style={{padding:"20px",textAlign:"center",color:"#9aa5b1",fontSize:12,
                      background:"#f8f9fb",borderRadius:8}}>
                      Click to load product code data...
                    </div>
                  )}
                </div>
              )}
            </div>


            {/* ── Ready to Send widget (visible to everyone) ── */}
            {data?.readyToSend && (
              <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
                <div style={{padding:"14px 24px",borderBottom:"1px solid #e8ecf0",
                  display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>
                    ✉️ READY TO SEND
                  </div>
                  {data.readyToSend.length>0&&(
                    <span style={{background:"#1a5276",color:"#fff",borderRadius:10,
                      fontSize:10,fontWeight:700,padding:"2px 8px"}}>
                      {data.readyToSend.length} {data.readyToSend.length===1?"quote":"quotes"}
                    </span>
                  )}
                </div>
                {data.readyToSend.length===0?(
                  <div style={{padding:"24px",textAlign:"center",color:"#9aa5b1",fontSize:12}}>
                    ✓ All approved quotes have been sent
                  </div>
                ):(
                  <div>
                    {data.readyToSend.map(rts=>{
                      // Age coloring — readability prioritized: dark text on tinted background.
                      // 0-6 days: white | 7-13 days: yellow | 14+ days: light-red + OVERDUE pill
                      let bg = "#fff";
                      let showOverdue = false;
                      if(rts.daysInQueue >= 14){ bg = "#fee"; showOverdue = true; }
                      else if(rts.daysInQueue >= 7){ bg = "#fff8e1"; }
                      const dateStr = new Date(rts.approvedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"});
                      const moneyStr = "$"+Math.round(rts.total||0).toLocaleString();
                      return (
                        <div key={rts.id}
                          style={{display:"flex",alignItems:"center",gap:12,padding:"10px 24px",
                            borderBottom:"1px solid #f0f2f5",background:bg}}>
                          <div style={{flex:"0 0 auto",minWidth:90}}>
                            <div style={{fontSize:12,fontWeight:700,color:"#1a2332"}}>{rts.opportunity}</div>
                            <div style={{fontSize:10,color:"#6b7a8d",marginTop:1}}>
                              Approved {dateStr} · {rts.daysInQueue}d
                              {showOverdue&&(
                                <span style={{marginLeft:6,background:"#c0392b",color:"#fff",
                                  borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:700,letterSpacing:.5}}>
                                  OVERDUE
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{flex:1,fontSize:12,color:"#1a2332",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {rts.customer||"(no customer)"}
                          </div>
                          <div style={{flex:"0 0 auto",fontSize:12,fontWeight:600,color:"#1a5276",minWidth:80,textAlign:"right"}}>
                            {moneyStr}
                          </div>
                          <div style={{flex:"0 0 auto",display:"flex",gap:6}}>
                            <button onClick={async()=>{
                                try {
                                  const rows = await restFetch("GET",
                                    `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(rts.id)}&limit=1`);
                                  const row = (rows||[])[0];
                                  if(!row){ alert("Could not open quote — please refresh and try again."); return; }
                                  const blob=row.data||{};
                                  onLoadQuote({...blob,id:row.id,
                                    opp:row.opportunity||blob.opp,
                                    customer:row.customer||blob.customer,
                                    rfq:row.rfq||blob.rfq,
                                    total:row.total??blob.total,
                                    savedAt:row.updated_at,
                                    source:row.source||"nuforce",
                                    approval:{...(blob.approval||{}),status:row.approval_status||"none"},
                                    wonApproval:{...(blob.wonApproval||{}),status:row.won_approval_status||"none"},
                                  });
                                } catch(e) {
                                  console.warn("[QUOTE-LOAD ready-to-send] failed:", e?.message||e);
                                  alert("Could not open quote — please refresh and try again.");
                                }
                              }}
                              style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:5,
                                padding:"4px 10px",fontSize:11,cursor:"pointer",color:"#1a2332",fontWeight:600}}>
                              Open
                            </button>
                            <button onClick={()=>setRtsConfirm({mode:"send",row:rts})}
                              style={{background:"#1e8449",border:"none",borderRadius:5,
                                padding:"4px 12px",fontSize:11,cursor:"pointer",color:"#fff",fontWeight:700}}>
                              Send
                            </button>
                            <button onClick={()=>setRtsConfirm({mode:"dismiss",row:rts})}
                              title="Remove from this list"
                              style={{background:"transparent",border:"1px solid #d0d7de",borderRadius:5,
                                padding:"4px 8px",fontSize:11,cursor:"pointer",color:"#6b7a8d",fontWeight:600,lineHeight:1}}>
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Ready to Send confirmation modal ── */}
            {rtsConfirm && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,
                display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
                onClick={()=>{ if(!rtsBusy) setRtsConfirm(null); }}>
                <div onClick={e=>e.stopPropagation()}
                  style={{background:"#fff",borderRadius:12,padding:24,maxWidth:420,width:"100%",
                    boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#1a2332",marginBottom:8}}>
                    {rtsConfirm.mode==="send"?"Mark as Sent?":"Remove from Ready to Send?"}
                  </div>
                  <div style={{fontSize:13,color:"#6b7a8d",marginBottom:20,lineHeight:1.5}}>
                    {rtsConfirm.mode==="send"
                      ? <>Mark <b>{rtsConfirm.row.opportunity}</b> as sent? This will record the send event and remove it from this list.</>
                      : <>Remove <b>{rtsConfirm.row.opportunity}</b> from Ready to Send? You can still send it manually from the quote later.</>}
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <button onClick={()=>{ if(!rtsBusy) setRtsConfirm(null); }}
                      disabled={rtsBusy}
                      style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"8px 16px",fontSize:12,cursor:rtsBusy?"not-allowed":"pointer",
                        color:"#1a2332",fontWeight:600,opacity:rtsBusy?0.6:1}}>
                      Cancel
                    </button>
                    <button onClick={async()=>{
                        setRtsBusy(true);
                        try {
                          if(rtsConfirm.mode==="send"){
                            await restFetch("POST", "follow_ups", {body:{
                              quote_id: rtsConfirm.row.id,
                              opportunity: rtsConfirm.row.opportunity,
                              customer: rtsConfirm.row.customer,
                              sent_by: currentUser,
                            }});
                          } else {
                            await restFetch("PATCH",
                              `quotes?id=eq.${encodeURIComponent(rtsConfirm.row.id)}`,
                              {body:{ready_to_send_dismissed_at: new Date().toISOString()}});
                          }
                          // Optimistically remove the row from the widget without reloading the whole dashboard.
                          setData(d => d ? {...d, readyToSend: d.readyToSend.filter(r=>r.id!==rtsConfirm.row.id)} : d);
                          setRtsConfirm(null);
                        } catch(e){
                          console.warn("[RTS-ACTION] failed:", e?.message||e);
                          alert("Action failed — " + (e?.message||"please try again."));
                        } finally {
                          setRtsBusy(false);
                        }
                      }}
                      disabled={rtsBusy}
                      style={{background: rtsConfirm.mode==="send"?"#1e8449":"#c0392b",
                        border:"none",borderRadius:6,padding:"8px 16px",fontSize:12,
                        cursor:rtsBusy?"not-allowed":"pointer",color:"#fff",fontWeight:700,
                        opacity:rtsBusy?0.6:1}}>
                      {rtsBusy?"Working...":(rtsConfirm.mode==="send"?"Confirm Send":"Remove")}
                    </button>
                  </div>
                </div>
              </div>
            )}


            {/* ── Follow-ups widget ── */}
            {isFollowUpUser&&(
              <div style={{background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
                border:"1px solid #e8ecf0",overflow:"hidden",marginBottom:20}}>
                <div onClick={()=>setFollowUpsCollapsed(v=>!v)}
                  style={{padding:"14px 24px",borderBottom:followUpsCollapsed?"none":"1px solid #e8ecf0",
                  display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",userSelect:"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:"#9aa5b1"}}>{followUpsCollapsed?"▶":"▼"}</span>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>
                        ✉️ FOLLOW-UPS DUE {!fuLoading&&"("+followUps.length+")"}
                      </div>
                      <div style={{fontSize:11,color:"#9aa5b1",marginTop:2}}>
                        Quotes sent 30+ days ago with no follow-up
                      </div>
                    </div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();loadFollowUps();}}
                    style={{background:"none",border:"1px solid #d0d7de",borderRadius:6,
                      padding:"4px 12px",fontSize:11,cursor:"pointer",color:"#6b7a8d"}}>
                    ↻ Refresh
                  </button>
                </div>
                {!followUpsCollapsed&&(fuLoading?(
                  <div style={{padding:24,textAlign:"center",color:"#9aa5b1",fontSize:12}}>Loading…</div>
                ):followUps.length===0?(
                  <div style={{padding:24,textAlign:"center",color:"#9aa5b1",fontSize:12}}>
                    🎉 No follow-ups due right now.
                  </div>
                ):(
                  <div>
                    {followUps.map(fu=>{
                      const daysSinceSent=Math.floor((Date.now()-new Date(fu.sent_at).getTime())/(1000*60*60*24));
                      return(
                        <div key={fu.id} style={{borderTop:"1px solid #f0f2f5",padding:"14px 24px"}}>
                          {/* Quote info row */}
                          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                                <span style={{fontWeight:700,fontSize:13,color:"#1a5276"}}>
                                  {fu.opportunity||"—"}
                                </span>
                                <span style={{fontSize:12,color:"#6b7a8d"}}>{fu.customer||"—"}</span>
                                {fu.quotes?.data?.ti?.item&&(
                                  <span style={{fontSize:11,color:"#9aa5b1",fontStyle:"italic"}}>
                                    {fu.quotes.data.ti.item}
                                  </span>
                                )}
                              </div>
                              <div style={{fontSize:11,color:"#9aa5b1",marginTop:3}}>
                                Sent {daysSinceSent} day{daysSinceSent!==1?"s":""} ago by {fu.sent_by}
                                {fu.followup_again_at&&(
                                  <span style={{marginLeft:8,color:"#b7791f"}}>· 90-day reminder</span>
                                )}
                              </div>
                            </div>
                            {/* Action buttons */}
                            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                              <button
                                onClick={e=>{e.preventDefault();markFollowedUp(fu.id,true);}}
                                style={{background:"#1e8449",border:"none",borderRadius:6,
                                  padding:"6px 14px",color:"#fff",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                                ✓ Followed Up
                              </button>
                              <button
                                onClick={e=>{e.preventDefault();markFollowedUp(fu.id,false);}}
                                style={{background:"none",border:"1px solid #6b7a8d",borderRadius:6,
                                  padding:"6px 14px",color:"#6b7a8d",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                                Don't Show Again
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}


            {/* ── Month over month chart (toggleable Count vs Value) ── */}
            {(()=>{
              const months = data.monthCounts;
              // Mode-aware data resolution. Each month exposes:
              //   - count mode: newCount (front bar), allCount (back bar)
              //   - value mode: newTotal (front bar), netTotal (back bar incl. revision deltas)
              const isValueMode = chartMode === "value";
              const getBack = (m) => isValueMode ? (m.netTotal||0) : (m.allCount||m.count||0);
              const getFront = (m) => isValueMode ? (m.newTotal||0) : (m.newCount||0);
              const maxVal = Math.max(...months.map(getBack), 1);
              const W=560, H=160, PAD={t:24,r:24,b:32,l:54}; // wider left for $ labels, narrower right (no second axis)
              const chartW=W-PAD.l-PAD.r, chartH=H-PAD.t-PAD.b;
              const barW=chartW/months.length*0.45;
              const xCenter=i=>PAD.l+(i+0.5)*(chartW/months.length);
              const barX=i=>xCenter(i)-barW/2;
              const barH=v=>Math.max(0,Math.round((v/maxVal)*chartH));
              const fmtVal = (v) => {
                if (isValueMode) {
                  return v>=1000 ? "$"+(v/1000).toFixed(1)+"k" : "$"+Math.round(v);
                }
                return String(v);
              };
              const fmtAxis = (v) => {
                if (isValueMode) {
                  return v>=1000 ? "$"+(v/1000).toFixed(0)+"k" : "$"+Math.round(v);
                }
                return String(Math.round(v));
              };
              return(
                <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0",marginBottom:20,position:"relative"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1"}}>
                      QUOTES — LAST 4 MONTHS
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:14,fontSize:10,color:"#6b7a8d",flexWrap:"wrap"}}>
                      {/* Mode toggle */}
                      <div style={{display:"flex",gap:0,background:"#f4f6f9",border:"1px solid #e8ecf0",borderRadius:14,padding:2}}>
                        {[["count","Count"],["value","Value"]].map(([key,label])=>(
                          <button key={key} onClick={()=>setChartMode(key)}
                            style={{background:chartMode===key?"#1a2332":"transparent",
                              border:"none",borderRadius:12,padding:"3px 10px",fontSize:10,
                              color:chartMode===key?"#fff":"#6b7a8d",fontWeight:600,cursor:"pointer"}}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:12,height:12,borderRadius:2,background:"#1a5276"}}/>
                        <span>New</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:12,height:12,borderRadius:2,background:"#5499c7"}}/>
                        <span>+ Revs</span>
                      </div>
                    </div>
                  </div>
                  <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",overflow:"visible"}}>
                    {/* Y-axis gridlines + labels */}
                    {[0,0.25,0.5,0.75,1].map(t=>{
                      const y=PAD.t+chartH*(1-t);
                      return <g key={t}>
                        <line x1={PAD.l} y1={y} x2={PAD.l+chartW} y2={y} stroke="#f0f2f5" strokeWidth="1"/>
                        <text x={PAD.l-6} y={y+4} textAnchor="end" fontSize="9" fill="#9aa5b1">
                          {fmtAxis(maxVal*t)}
                        </text>
                      </g>;
                    })}
                    {/* Bars — overlay: light "+ Revs" bar in back, dark "New" bar in front */}
                    {months.map((m,i)=>{
                      const back = getBack(m);
                      const front = getFront(m);
                      const backH = barH(back);
                      const frontH = barH(front);
                      const lightFill = m.isCurrent?"#5499c7":"#d0d7de";
                      const darkFill  = m.isCurrent?"#1a5276":"#7a8593";
                      return (
                        <g key={m.label}>
                          {/* Back bar: revision-inclusive total */}
                          <rect x={barX(i)} y={PAD.t+chartH-backH}
                            width={barW} height={backH}
                            fill={lightFill} rx="3"/>
                          {/* Front bar: new only */}
                          <rect x={barX(i)} y={PAD.t+chartH-frontH}
                            width={barW} height={frontH}
                            fill={darkFill} rx="3"/>
                          {/* Label above the taller bar */}
                          <text x={xCenter(i)} y={PAD.t+chartH-backH-5}
                            textAnchor="middle" fontSize="10"
                            fontWeight={m.isCurrent?"500":"400"}
                            fill={m.isCurrent?"#1a5276":"#6b7a8d"}>
                            {isValueMode
                              ? (back===front?fmtVal(front):fmtVal(back))
                              : (back===front?front:(front+" / "+back))}
                          </text>
                        </g>
                      );
                    })}
                    {/* X-axis labels */}
                    {months.map((m,i)=>(
                      <text key={m.label} x={xCenter(i)} y={H-6}
                        textAnchor="middle" fontSize="10"
                        fontWeight={m.isCurrent?"500":"400"}
                        fill={m.isCurrent?"#1a5276":"#9aa5b1"}>
                        {m.label}
                      </text>
                    ))}
                    {/* Invisible hover zones — one per month column, full chart height.
                        These sit ON TOP of all other shapes so they always catch the mouse. */}
                    {months.map((m,i)=>{
                      const colW = chartW / months.length;
                      const zoneX = PAD.l + i*colW;
                      return (
                        <rect key={"hz-"+m.label}
                          x={zoneX} y={PAD.t}
                          width={colW} height={chartH}
                          fill="transparent"
                          onMouseEnter={()=>setHoveredMonthIdx(i)}
                          onMouseLeave={()=>setHoveredMonthIdx(null)}
                          style={{cursor:"default"}}/>
                      );
                    })}
                  </svg>
                  {/* Tooltip overlay — appears on month-column hover */}
                  {hoveredMonthIdx !== null && months[hoveredMonthIdx] && (()=>{
                    const m = months[hoveredMonthIdx];
                    // SVG renders at width:100% inside card padding of 24px on each side.
                    // To get the card-pixel x of an SVG point: 24px + (svgX/W) * (100% - 48px)
                    const svgX = xCenter(hoveredMonthIdx);
                    const ratio = svgX / W;     // 0..1 along the SVG width
                    const newT = m.newTotal||0;
                    const netT = m.netTotal||0;
                    const delta = netT - newT;
                    const fmt = v => v>=1000?"$"+(v/1000).toFixed(1)+"k":"$"+Math.round(v);
                    const fmtFull = v => "$"+Math.round(v).toLocaleString();
                    const deltaColor = delta>0?"#1e8449":delta<0?"#c0392b":"#6b7a8d";
                    // Anchor strategy by column position:
                    //  - first column: anchor tooltip to its right (so it doesn't clip left)
                    //  - last column: anchor to its left (so it doesn't clip right)
                    //  - middle columns: centered above the column
                    let xform = "translateX(-50%)";
                    if(hoveredMonthIdx === 0) xform = "translateX(0)";
                    if(hoveredMonthIdx >= months.length - 1) xform = "translateX(-100%)";
                    return (
                      <div style={{
                        position:"absolute",
                        left: `calc(24px + ${ratio} * (100% - 48px))`,
                        top: 60,
                        transform: xform,
                        background:"#1a2332",
                        color:"#fff",
                        borderRadius:8,
                        padding:"10px 12px",
                        fontSize:11,
                        lineHeight:1.5,
                        boxShadow:"0 4px 12px rgba(0,0,0,0.18)",
                        pointerEvents:"none",
                        minWidth:160,
                        zIndex:10,
                      }}>
                        <div style={{fontWeight:700,letterSpacing:0.5,marginBottom:6,fontSize:11}}>
                          {m.label}
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                          <span style={{color:"#9aa5b1"}}>New families:</span>
                          <span style={{fontWeight:600}}>{m.newCount}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                          <span style={{color:"#9aa5b1"}}>+ Revisions:</span>
                          <span style={{fontWeight:600}}>{m.allCount}</span>
                        </div>
                        <div style={{borderTop:"1px solid #2d3a4a",margin:"6px 0"}}/>
                        <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                          <span style={{color:"#9aa5b1"}}>New total:</span>
                          <span style={{fontWeight:600}}>{fmtFull(newT)}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
                          <span style={{color:"#9aa5b1"}}>Net total:</span>
                          <span style={{fontWeight:600}}>{fmtFull(netT)}</span>
                        </div>
                        {Math.abs(delta) >= 1 && (
                          <div style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:2}}>
                            <span style={{color:"#9aa5b1"}}>Rev delta:</span>
                            <span style={{fontWeight:600,color:deltaColor}}>
                              {delta>0?"+":"−"}{fmt(Math.abs(delta))}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* ── Top codes + Top accounts ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>

              {/* Top 10 product codes */}
              <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:12}}>
                  TOP PRODUCT CODES THIS MONTH
                </div>
                {data.topCodes.length===0?(
                  <div style={{fontSize:12,color:"#9aa5b1",fontStyle:"italic"}}>No data yet</div>
                ):(
                  <>
                    {data.topCodes.map((p,i)=>{
                      const maxVal = data.topCodes[0].total;
                      return(
                        <div key={p.code} style={{marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                            <span style={{fontWeight:700,color:"#1a2332"}}>
                              <span style={{color:"#9aa5b1",marginRight:6,fontSize:10}}>#{i+1}</span>
                              {p.code}
                            </span>
                            <span style={{color:"#1a5276",fontWeight:600}}>{money(p.total)}</span>
                          </div>
                          <div style={{height:5,background:"#e8ecf0",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:Math.round((p.total/maxVal)*100)+"%",
                              background:"#1a5276",borderRadius:3}}/>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Top 5 accounts */}
              <div style={{background:"#fff",borderRadius:12,padding:"20px 24px",
                boxShadow:"0 1px 4px rgba(0,0,0,0.07)",border:"1px solid #e8ecf0"}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#9aa5b1",marginBottom:12}}>
                  TOP 5 ACCOUNTS THIS MONTH
                </div>
                {data.topAccounts.length===0?(
                  <div style={{fontSize:12,color:"#9aa5b1",fontStyle:"italic"}}>No data yet</div>
                ):(
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{fontSize:9,color:"#9aa5b1",fontWeight:700,letterSpacing:.8}}>
                        <th style={{textAlign:"left",paddingBottom:8,fontWeight:700}}>#</th>
                        <th style={{textAlign:"left",paddingBottom:8,fontWeight:700}}>ACCOUNT</th>
                        <th style={{textAlign:"center",paddingBottom:8,fontWeight:700}}>QUOTES</th>
                        <th style={{textAlign:"right",paddingBottom:8,fontWeight:700}}>TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topAccounts.map((a,i)=>(
                        <tr key={a.name} style={{borderTop:"1px solid #f0f2f5",fontSize:11}}>
                          <td style={{padding:"7px 0",color:"#9aa5b1",fontWeight:600}}>{i+1}</td>
                          <td style={{padding:"7px 8px",fontWeight:600,color:"#1a2332",
                            maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {a.name}
                          </td>
                          <td style={{padding:"7px 0",textAlign:"center",color:"#6b7a8d"}}>{a.count}</td>
                          <td style={{padding:"7px 0",textAlign:"right",fontWeight:600,color:"#1a5276"}}>
                            {money(a.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>



          </div>
        )}
        </div>{/* end privacy-mode wrapper */}

        {/* ── Campaigns Modal ── */}
        {campaignsOpen&&(
          <div onClick={()=>setCampaignsOpen(false)}
            style={{position:"fixed",inset:0,background:"rgba(26,35,50,0.55)",
              zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:"#fff",borderRadius:12,boxShadow:"0 8px 40px rgba(0,0,0,0.2)",
                width:"100%",maxWidth:1500,height:"calc(100vh - 48px)",display:"flex",flexDirection:"column",
                overflow:"hidden"}}>
              {/* Modal header */}
              <div style={{padding:"16px 24px",borderBottom:"1px solid #e8ecf0",
                display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:14,fontWeight:700,color:"#1a2332",letterSpacing:.3}}>
                  CAMPAIGNS
                </div>
                <button onClick={()=>setCampaignsOpen(false)}
                  style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9aa5b1",
                    padding:"0 4px",lineHeight:1}}>×</button>
              </div>
              {/* Modal body — sidebar + detail */}
              <div style={{display:"flex",flex:1,minHeight:0}}>
                {/* Left: campaigns list */}
                <div style={{width:280,borderRight:"1px solid #e8ecf0",display:"flex",flexDirection:"column",overflow:"hidden"}}>
                  <div style={{padding:"12px 16px",borderBottom:"1px solid #e8ecf0"}}>
                    {!showNewCampaignForm?(
                      <button onClick={()=>setShowNewCampaignForm(true)}
                        style={{width:"100%",background:"#1a5276",color:"#fff",border:"none",
                          borderRadius:6,padding:"7px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        + New Campaign
                      </button>
                    ):(
                      <div>
                        <input value={newCampaignName} autoFocus
                          onChange={e=>setNewCampaignName(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter")createCampaign();if(e.key==="Escape"){setShowNewCampaignForm(false);setNewCampaignName("");setNewCampaignDesc("");}}}
                          placeholder="Campaign name"
                          style={{width:"100%",fontSize:11,padding:"5px 8px",borderRadius:5,
                            border:"1px solid #d0d7de",marginBottom:5,boxSizing:"border-box"}}/>
                        <input value={newCampaignDesc}
                          onChange={e=>setNewCampaignDesc(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter")createCampaign();}}
                          placeholder="Description (optional)"
                          style={{width:"100%",fontSize:11,padding:"5px 8px",borderRadius:5,
                            border:"1px solid #d0d7de",marginBottom:5,boxSizing:"border-box"}}/>
                        <div style={{display:"flex",gap:5}}>
                          <button onClick={createCampaign}
                            style={{flex:1,background:"#1a5276",color:"#fff",border:"none",
                              borderRadius:5,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                            Create
                          </button>
                          <button onClick={()=>{setShowNewCampaignForm(false);setNewCampaignName("");setNewCampaignDesc("");}}
                            style={{flex:1,background:"#fff",color:"#6b7a8d",border:"1px solid #d0d7de",
                              borderRadius:5,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{overflow:"auto",flex:1}}>
                    {campaignsLoading?(
                      <div style={{padding:16,fontSize:11,color:"#9aa5b1",textAlign:"center"}}>Loading…</div>
                    ):campaigns.length===0?(
                      <div style={{padding:16,fontSize:11,color:"#9aa5b1",textAlign:"center",fontStyle:"italic"}}>
                        No campaigns yet. Click "+ New Campaign" above.
                      </div>
                    ):(
                      campaigns.map(c=>(
                        <div key={c.id} onClick={()=>setSelectedCampaignId(c.id)}
                          style={{padding:"10px 16px",borderBottom:"1px solid #f0f2f5",cursor:"pointer",
                            background:selectedCampaignId===c.id?"#eaf2ff":"#fff",
                            borderLeft:"3px solid "+(selectedCampaignId===c.id?"#1a5276":"transparent")}}>
                          <div style={{fontSize:12,fontWeight:600,color:"#1a2332"}}>{c.name}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                {/* Right: detail */}
                <div style={{flex:1,padding:24,overflow:"auto"}}>
                  {!selectedCampaignId?(
                    <div style={{color:"#9aa5b1",fontSize:13,fontStyle:"italic",marginTop:40,textAlign:"center"}}>
                      Select a campaign on the left to view its contacts.
                    </div>
                  ):(()=>{
                    const c=campaigns.find(x=>x.id===selectedCampaignId);
                    if(!c)return null;
                    return(
                      <div>
                        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14}}>
                          <div>
                            <div style={{fontSize:18,fontWeight:700,color:"#1a2332",marginBottom:4}}>{c.name}</div>
                            {c.created_at&&(
                              <div style={{fontSize:11,color:"#6b7a8d"}}>
                                Created {new Date(c.created_at).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}
                              </div>
                            )}
                            <div style={{fontSize:11,color:"#9aa5b1",marginTop:4}}>
                              {contactsLoading?"Loading…":`${campaignContacts.length} contact${campaignContacts.length!==1?'s':''}`}
                            </div>
                          </div>
                          <button onClick={()=>deleteCampaign(c.id)}
                            style={{background:"#fff",color:"#c0392b",border:"1px solid #f5b7b1",borderRadius:6,
                              padding:"5px 12px",fontSize:11,cursor:"pointer",fontWeight:600}}>
                            Delete Campaign
                          </button>
                        </div>

                        {/* Add contact autocomplete */}
                        <div style={{position:"relative",marginBottom:14}}>
                          <input value={contactSearchTerm}
                            onChange={e=>{setContactSearchTerm(e.target.value);setContactSearchOpen(true);}}
                            onFocus={()=>setContactSearchOpen(true)}
                            placeholder="+ Add contact — type name or email"
                            style={{width:"100%",fontSize:12,padding:"8px 12px",borderRadius:6,
                              border:"1px solid #d0d7de",boxSizing:"border-box"}}/>
                          {contactSearchOpen&&contactSearchTerm.trim()&&(
                            <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:2,
                              background:"#fff",border:"1px solid #d0d7de",borderRadius:6,
                              boxShadow:"0 4px 12px rgba(0,0,0,0.1)",maxHeight:400,overflow:"auto",zIndex:10}}>
                              {contactSearchResults.length===0?(
                                <div style={{padding:"10px 12px",fontSize:11,color:"#9aa5b1",fontStyle:"italic"}}>
                                  No matching contacts found.
                                </div>
                              ):(
                                contactSearchResults.map(ct=>{
                                  const name=((ct.first_name||"")+" "+(ct.last_name||"")).trim();
                                  const company=ct.clients?.name||"";
                                  const inCampaign=ct._alreadyInCampaign;
                                  return(
                                    <div key={ct.id}
                                      onClick={()=>{
                                        if(inCampaign){
                                          alert(`${name||"This contact"} is already in this campaign.`);
                                        }else{
                                          addContactToCampaign(ct);
                                        }
                                      }}
                                      style={{padding:"7px 12px",borderBottom:"1px solid #f0f2f5",cursor:"pointer",
                                        opacity:inCampaign?0.6:1,
                                        display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}
                                      onMouseEnter={e=>e.currentTarget.style.background="#f8f9fb"}
                                      onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{fontSize:12,fontWeight:600,color:"#1a2332"}}>{name||"(no name)"}</div>
                                        <div style={{fontSize:10,color:"#6b7a8d",marginTop:1}}>
                                          {company&&<span>{company}</span>}
                                          {company&&ct.email&&<span> · </span>}
                                          {ct.email&&<span>{ct.email}</span>}
                                        </div>
                                      </div>
                                      {inCampaign&&(
                                        <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,color:"#15803d",
                                          background:"#f0fdf4",border:"1px solid #86efac",borderRadius:4,
                                          padding:"2px 6px",flexShrink:0}}>IN CAMPAIGN</span>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* Contacts table */}
                        {contactsLoading?(
                          <div style={{padding:"20px 0",color:"#9aa5b1",fontSize:12,textAlign:"center"}}>Loading contacts…</div>
                        ):campaignContacts.length===0?(
                          <div style={{padding:"24px 0",color:"#9aa5b1",fontSize:12,fontStyle:"italic",textAlign:"center",
                            border:"1px dashed #e0e4ea",borderRadius:8}}>
                            No contacts in this campaign yet. Use the search above to add some.
                          </div>
                        ):(
                          <div style={{border:"1px solid #e8ecf0",borderRadius:8,overflow:"hidden"}}>
                            <div style={{display:"grid",gridTemplateColumns:"1.5fr 1.5fr 1fr 1.5fr 60px",
                              padding:"8px 12px",background:"#f8f9fb",fontSize:9,fontWeight:700,
                              letterSpacing:.8,color:"#9aa5b1"}}>
                              <div>NAME</div>
                              <div>COMPANY</div>
                              <div>PHONE</div>
                              <div>EMAIL</div>
                              <div></div>
                            </div>
                            {campaignContacts.map(ct=>{
                              const name=((ct.first_name||"")+" "+(ct.last_name||"")).trim()||"(no name)";
                              return(
                                <div key={ct.id} style={{display:"grid",gridTemplateColumns:"1.5fr 1.5fr 1fr 1.5fr 60px",
                                  padding:"8px 12px",borderTop:"1px solid #f0f2f5",fontSize:11,alignItems:"center"}}>
                                  <div style={{color:"#1a2332",fontWeight:500}}>{name}</div>
                                  <div style={{color:"#6b7a8d"}}>{ct.company||"—"}</div>
                                  <div style={{color:"#6b7a8d",fontFamily:"monospace",fontSize:10}}>{ct.phone||"—"}</div>
                                  <div style={{color:"#6b7a8d",fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ct.email||"—"}</div>
                                  <div style={{textAlign:"right"}}>
                                    <button onClick={()=>removeContactFromCampaign(ct.id)}
                                      title="Remove from campaign"
                                      style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",
                                        fontSize:14,padding:"2px 6px"}}>×</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────


// ── Pricing Calculator sub-components (defined outside to prevent focus loss) ──
function CalcInp({value,onChange,width=70}){
  return <input value={value} onChange={e=>onChange(e.target.value)}
    style={{width,fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #d0d7de",fontFamily:"monospace"}}/>;
}
function CalcSel({value,onChange,options,width=160}){
  return <select value={value} onChange={e=>onChange(e.target.value)}
    style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #d0d7de",width}}>
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>;
}
function CalcRow2({label,children}){
  return <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
    <span style={{fontSize:11,color:"#6b7a8d",minWidth:110}}>{label}</span>
    {children}
  </div>;
}
function CalcResult({setupAmt,testAmt}){
  return <div style={{marginTop:12,padding:"10px 12px",background:"#1a2332",borderRadius:8,display:"flex",gap:24}}>
    {setupAmt!==undefined&&<div>
      <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:2}}>SUGGESTED SETUP</div>
      <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:"monospace"}}>{money(setupAmt)}</div>
    </div>}
    {testAmt!==undefined&&<div>
      <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:2}}>SUGGESTED TESTING</div>
      <div style={{fontSize:16,fontWeight:700,color:"#5dade2",fontFamily:"monospace"}}>{money(testAmt)}</div>
    </div>}
  </div>;
}

function SpecSuggestion({text}){
  const [copied,setCopied]=useState(false);
  if(!text||!text.trim())return null;
  const copy=()=>{
    navigator.clipboard.writeText(text).then(()=>{
      setCopied(true);
      setTimeout(()=>setCopied(false),2000);
    });
  };
  return(
    <div style={{marginTop:10,padding:"8px 10px",background:"#f0f4ff",borderRadius:6,border:"1px solid #c7d4f0"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontSize:9,fontWeight:700,color:"#4a6fa5",letterSpacing:1}}>SPEC SUGGESTION</span>
        <button onClick={copy}
          style={{fontSize:9,background:copied?"#276749":"#4a6fa5",color:"#fff",border:"none",
            borderRadius:4,padding:"2px 8px",cursor:"pointer",fontWeight:700}}>
          {copied?"✓ Copied":"📋 Copy"}
        </button>
      </div>
      <pre style={{fontSize:10,color:"#2c3e6b",fontFamily:"monospace",margin:0,whiteSpace:"pre-wrap",lineHeight:1.6}}>{text}</pre>
    </div>
  );
}

// ── EMI CRR View ──────────────────────────────────────────────────────────────
// Read-mostly second view inside the EMI calc tab. Reads test rows from the
// CRR workup (crrWorkup.data.specRows.emi461f / emi461g) and converts each
// row's free-text Time cell into a shift count (ceil hours/8). Each test's
// shift count is editable via emiCalc.crrShiftOverrides — independent of
// computed-mode's shiftOverrides, so the two views never overwrite each other.
function EmiCrrView({crrWorkup, emiCalc, setEmiCalc, emiRate, ti}){
  // Handle the empty / not-fetched cases up front
  if (crrWorkup === null) {
    return <div style={{fontSize:11,color:"#6b7a8d",fontStyle:"italic",padding:"12px 0"}}>
      Loading CRR workup…
    </div>;
  }
  if (crrWorkup === false || !crrWorkup.data) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      (no CRR workup found for this quote)
    </div>;
  }

  const enabled = crrWorkup.data.enabledSpecs || {};
  const allRows = crrWorkup.data.specRows || {};

  // Collect tests from both revs. Don't dedupe — if the tech has CS101 in
  // both emi461f and emi461g, that's intentional (testing under both revs).
  // Override keys are namespaced by rev to keep them independent.
  // collected: [{rev, key, label, time, comments, shifts, override}]
  const PARSE_HOURS = (timeStr) => {
    const s = String(timeStr || "").trim();
    if (!s) return null;
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? parseFloat(m[1]) : null;
  };

  const collectFromRev = (specKey, revLabel) => {
    if (!enabled[specKey]) return [];
    const rows = allRows[specKey] || [];
    return rows.map((row, idx) => {
      const testKey = String(row[0] || "").trim();
      // Skip rows that don't have a test key at all
      if (!testKey) return null;
      const label = String(row[1] || "");
      const timeRaw = String(row[2] || "");
      const comments = String(row[3] || "");
      const hours = PARSE_HOURS(timeRaw);
      const computedShifts = hours !== null ? Math.round((hours / 8) * 100) / 100 : null;
      const ovKey = revLabel + ":" + testKey + ":" + idx; // include idx for dupes within a rev
      const ov = emiCalc.crrShiftOverrides?.[ovKey];
      const hasOv = ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov));
      const effectiveShifts = hasOv ? parseFloat(ov) : computedShifts;
      return {
        rev: revLabel, testKey, label, timeRaw, comments,
        computedShifts, effectiveShifts, hasOv, ovKey,
        skipped: computedShifts === null && !hasOv,
      };
    }).filter(Boolean);
  };

  const tests = [...collectFromRev("emi461f", "F"), ...collectFromRev("emi461g", "G")];
  const counted = tests.filter(t => !t.skipped);
  const skipped = tests.filter(t => t.skipped);
  const totalTestShifts = counted.reduce((a, t) => a + (t.effectiveShifts || 0), 0);
  const totalTestHours = counted.reduce((a, t) => a + (PARSE_HOURS(t.timeRaw) || 0), 0);
  // Suggested billable shifts: round the REAL shift total up to a whole shift once,
  // instead of rounding each test row up individually (which over-counted shifts).
  const suggestedShifts = Math.ceil(Math.round(totalTestShifts * 100) / 100);

  // Rental budgets — same conditions as Computed mode
  const has440AC = sf(ti?.volt, 0) >= 440 && (ti?.pwrType || "AC") === "AC";
  const hasRS103 = counted.some(t => t.testKey === "RS103");
  const hasCe101or102 = counted.some(t => t.testKey === "CE101" || t.testKey === "CE102");
  const rs103Cost = hasRS103 ? sf(emiCalc.rs103amp, 5000) : 0;
  const ce101PwrCost = (has440AC && hasCe101or102) ? sf(emiCalc.ce101pwrSrc, 6500) : 0;

  // Use NUForce's setup/teardown shifts from emiCalc; CRR doesn't provide these
  const setupShifts = sf(emiCalc.setupShifts, 3);
  const tdShifts = sf(emiCalc.tdShifts, 1);
  const pia = sf(emiCalc.pia, 1);
  const setupCost = r25(setupShifts * emiRate * pia);
  const testCost = r25((suggestedShifts * emiRate + rs103Cost + ce101PwrCost) * pia);
  const tdCost = r25(tdShifts * emiRate);

  // Update an override for a test
  const setOverride = (ovKey, value) => {
    const next = {...(emiCalc.crrShiftOverrides || {})};
    if (value === "" || isNaN(parseFloat(value))) delete next[ovKey];
    else next[ovKey] = parseFloat(value);
    setEmiCalc(s => ({...s, crrShiftOverrides: next}));
  };

  if (tests.length === 0) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      CRR workup exists but no EMI tests are enabled or populated.
    </div>;
  }

  return (
    <div>
      <div style={{fontSize:10,color:"#1a5276",background:"#eaf2ff",borderRadius:6,
        padding:"5px 10px",marginBottom:8}}>
        Shift counts derived from CRR Time column (ceiling of hours ÷ 8). Edit any shift to override.
      </div>

      {/* Test rows */}
      <div style={{border:"1px solid #e0e4ea",borderRadius:6,overflow:"hidden",marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"24px 80px 1fr 90px 110px",
          background:"#f5f7fa",padding:"5px 8px",fontSize:9,color:"#6b7a8d",fontWeight:700,gap:6,
          textTransform:"uppercase",letterSpacing:.3}}>
          <div>Rev</div>
          <div>Test</div>
          <div>Description</div>
          <div style={{textAlign:"center"}}>Hours</div>
          <div style={{textAlign:"right"}}>Shifts</div>
        </div>
        {counted.map((t, i) => (
          <div key={t.ovKey} style={{display:"grid",gridTemplateColumns:"24px 80px 1fr 90px 110px",
            padding:"5px 8px",gap:6,alignItems:"center",
            background:i%2===0?"#fff":"#fafbfc",
            borderTop:"1px solid #f0f2f5",fontSize:10}}>
            <div style={{fontWeight:700,color:t.rev==="F"?"#1a2332":"#4a1942"}}>{t.rev}</div>
            <div style={{fontWeight:600,color:"#1a2332"}}>{t.testKey}</div>
            <div style={{color:"#6b7a8d"}}>{t.label}</div>
            <div style={{textAlign:"center",color:"#6b7a8d",fontFamily:"monospace"}}>{t.timeRaw}</div>
            <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"flex-end"}}>
              <input type="number" step="0.25" min="0"
                value={t.hasOv ? String(emiCalc.crrShiftOverrides[t.ovKey]) : ""}
                placeholder={String(t.computedShifts)}
                onChange={e=>setOverride(t.ovKey, e.target.value)}
                title={t.hasOv ? `Override (computed: ${t.computedShifts})` : "Override the CRR-derived shift count"}
                style={{
                  width:48,fontSize:10,padding:"1px 4px",textAlign:"center",
                  border:"1px solid "+(t.hasOv?"#b7791f":"#d0d7de"),
                  borderRadius:4,
                  background:t.hasOv?"#fffbeb":"#fff",
                  color:t.hasOv?"#92400e":"#6b7a8d",
                  fontFamily:"monospace",
                  fontWeight:t.hasOv?600:400,
                }}/>
              <span style={{fontSize:10,color:"#6b7a8d"}}>sh</span>
              {t.hasOv && (
                <button onClick={()=>setOverride(t.ovKey, "")}
                  title="Clear override"
                  style={{background:"none",border:"none",color:"#b7791f",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>✕</button>
              )}
            </div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"24px 80px 1fr 90px 110px",
          padding:"7px 8px",gap:6,alignItems:"center",background:"#eef2f7",
          borderTop:"2px solid #cfd8e3",fontSize:10,fontWeight:700,color:"#1a2332"}}>
          <div></div>
          <div></div>
          <div style={{textAlign:"right",color:"#6b7a8d",letterSpacing:.3}}>TOTAL</div>
          <div style={{textAlign:"center",fontFamily:"monospace"}}>{Number(totalTestHours.toFixed(2))} hr</div>
          <div style={{textAlign:"right",fontFamily:"monospace",paddingRight:24}}>{Number(totalTestShifts.toFixed(2))} sh</div>
        </div>
        <div style={{padding:"7px 10px",background:"#1a2332",display:"flex",
          justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,color:"rgba(255,255,255,0.6)"}}>SUGGESTED (BILLABLE) SHIFTS — total rounded up</span>
          <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:"#fff"}}>{suggestedShifts} sh</span>
        </div>
      </div>

      {/* Skipped tests (non-numeric time) */}
      {skipped.length > 0 && (
        <div style={{padding:"6px 10px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#92400e",marginBottom:3}}>
            {skipped.length} test{skipped.length!==1?"s":""} skipped (non-numeric time):
          </div>
          {skipped.map(t => (
            <div key={t.ovKey} style={{fontSize:10,color:"#78350f",marginLeft:4}}>
              • <strong>{t.rev}</strong> {t.testKey} — time: <code style={{background:"#fef3c7",padding:"0 4px",borderRadius:3}}>{t.timeRaw || "(empty)"}</code>
            </div>
          ))}
        </div>
      )}

      {/* Rental budgets */}
      {(rs103Cost > 0 || ce101PwrCost > 0) && (
        <div style={{padding:"6px 10px",background:"#f0f4f7",borderRadius:6,marginBottom:8,fontSize:10,color:"#1a2332"}}>
          <div style={{fontWeight:700,marginBottom:2,color:"#1a5276"}}>Rental budgets (included in Testing total)</div>
          {rs103Cost > 0 && <div>• RS103 amplifier: {money(rs103Cost)}</div>}
          {ce101PwrCost > 0 && <div>• CE101 power source (440V AC): {money(ce101PwrCost)}</div>}
        </div>
      )}

      <CalcResult setupAmt={setupCost} testAmt={testCost}/>
      <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>
        Teardown: {money(tdCost)} &nbsp;·&nbsp; Total: {money(setupCost+testCost+tdCost)}
        &nbsp;·&nbsp; <span style={{fontStyle:"italic"}}>{suggestedShifts} billable shift{suggestedShifts!==1?"s":""} × {emiRate}/sh × PIA {pia}</span>
      </div>
    </div>
  );
}

// ── PQ CRR View ──────────────────────────────────────────────────────────────
// Read-mostly second view inside the PQ calc tab. Mirrors EmiCrrView but
// pulls from crrWorkup.data.specRows.pq300b / pq300p1. PQ CRR rows are
// 5-col: [Requirement, Time (hr), 1399 Paragraph, Test Requirement, Tables/Figures].
function PqCrrView({crrWorkup, pqCalc, setPqCalc, pqRate, ti}){
  if (crrWorkup === null) {
    return <div style={{fontSize:11,color:"#6b7a8d",fontStyle:"italic",padding:"12px 0"}}>
      Loading CRR workup…
    </div>;
  }
  if (crrWorkup === false || !crrWorkup.data) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      (no CRR workup found for this quote)
    </div>;
  }

  const enabled = crrWorkup.data.enabledSpecs || {};
  const allRows = crrWorkup.data.specRows || {};

  const PARSE_HOURS = (timeStr) => {
    const s = String(timeStr || "").trim();
    if (!s) return null;
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? parseFloat(m[1]) : null;
  };

  // PQ rows: [Requirement, Time, 1399 Paragraph, Test Requirement, Tables/Figures]
  // Time is at index 1, 1399 Paragraph (the actual test identifier) at index 2.
  const collectFromSpec = (specKey, standardLabel) => {
    if (!enabled[specKey]) return [];
    const rows = allRows[specKey] || [];
    return rows.map((row, idx) => {
      const requirement = String(row[0] || "").trim();
      const timeRaw = String(row[1] || "");
      const paragraph = String(row[2] || "").trim();
      // Need at least a requirement or paragraph to count as a real row
      if (!requirement && !paragraph) return null;
      const hours = PARSE_HOURS(timeRaw);
      const computedShifts = hours !== null ? Math.round((hours / 8) * 100) / 100 : null;
      const ovKey = standardLabel + ":" + (paragraph || requirement) + ":" + idx;
      const ov = pqCalc.crrShiftOverrides?.[ovKey];
      const hasOv = ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov));
      const effectiveShifts = hasOv ? parseFloat(ov) : computedShifts;
      return {
        standard: standardLabel, paragraph, requirement, timeRaw,
        computedShifts, effectiveShifts, hasOv, ovKey,
        skipped: computedShifts === null && !hasOv,
      };
    }).filter(Boolean);
  };

  const tests = [...collectFromSpec("pq300b", "300B"), ...collectFromSpec("pq300p1", "300P1")];
  const counted = tests.filter(t => !t.skipped);
  const skipped = tests.filter(t => t.skipped);
  const totalTestShifts = counted.reduce((a, t) => a + (t.effectiveShifts || 0), 0);
  const totalTestHours = counted.reduce((a, t) => a + (PARSE_HOURS(t.timeRaw) || 0), 0);
  // Suggested billable shifts: round the REAL shift total up to a whole shift once,
  // instead of rounding each test row up individually (which over-counted shifts).
  const suggestedShifts = Math.ceil(Math.round(totalTestShifts * 100) / 100);

  // Use NUForce's setup/teardown shifts from pqCalc; CRR doesn't provide these
  const setupShifts = sf(pqCalc.setupShifts, 1.5);
  const tdShifts = sf(pqCalc.tdShifts, 1.0);
  const pia = sf(pqCalc.pia, 1);
  const setupCost = r25(setupShifts * pqRate * pia);
  const testCost = r25(suggestedShifts * pqRate * pia);
  const tdCost = r25(tdShifts * pqRate);

  const setOverride = (ovKey, value) => {
    const next = {...(pqCalc.crrShiftOverrides || {})};
    if (value === "" || isNaN(parseFloat(value))) delete next[ovKey];
    else next[ovKey] = parseFloat(value);
    setPqCalc(s => ({...s, crrShiftOverrides: next}));
  };

  if (tests.length === 0) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      CRR workup exists but no PQ tests are enabled or populated.
    </div>;
  }

  return (
    <div>
      <div style={{fontSize:10,color:"#1a5276",background:"#eaf2ff",borderRadius:6,
        padding:"5px 10px",marginBottom:8}}>
        Shift counts derived from CRR Time column (ceiling of hours ÷ 8). Edit any shift to override.
      </div>

      <div style={{border:"1px solid #e0e4ea",borderRadius:6,overflow:"hidden",marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"40px 70px 1fr 90px 110px",
          background:"#f5f7fa",padding:"5px 8px",fontSize:9,color:"#6b7a8d",fontWeight:700,gap:6,
          textTransform:"uppercase",letterSpacing:.3}}>
          <div>Std</div>
          <div>Para</div>
          <div>Requirement</div>
          <div style={{textAlign:"center"}}>Hours</div>
          <div style={{textAlign:"right"}}>Shifts</div>
        </div>
        {counted.map((t, i) => (
          <div key={t.ovKey} style={{display:"grid",gridTemplateColumns:"40px 70px 1fr 90px 110px",
            padding:"5px 8px",gap:6,alignItems:"center",
            background:i%2===0?"#fff":"#fafbfc",
            borderTop:"1px solid #f0f2f5",fontSize:10}}>
            <div style={{fontWeight:700,color:t.standard==="300B"?"#1a2332":"#4a1942",fontSize:9}}>{t.standard}</div>
            <div style={{fontWeight:600,color:"#1a2332",fontFamily:"monospace"}}>{t.paragraph}</div>
            <div style={{color:"#6b7a8d"}}>{t.requirement}</div>
            <div style={{textAlign:"center",color:"#6b7a8d",fontFamily:"monospace"}}>{t.timeRaw}</div>
            <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"flex-end"}}>
              <input type="number" step="0.25" min="0"
                value={t.hasOv ? String(pqCalc.crrShiftOverrides[t.ovKey]) : ""}
                placeholder={String(t.computedShifts)}
                onChange={e=>setOverride(t.ovKey, e.target.value)}
                title={t.hasOv ? `Override (computed: ${t.computedShifts})` : "Override the CRR-derived shift count"}
                style={{
                  width:48,fontSize:10,padding:"1px 4px",textAlign:"center",
                  border:"1px solid "+(t.hasOv?"#b7791f":"#d0d7de"),
                  borderRadius:4,
                  background:t.hasOv?"#fffbeb":"#fff",
                  color:t.hasOv?"#92400e":"#6b7a8d",
                  fontFamily:"monospace",
                  fontWeight:t.hasOv?600:400,
                }}/>
              <span style={{fontSize:10,color:"#6b7a8d"}}>sh</span>
              {t.hasOv && (
                <button onClick={()=>setOverride(t.ovKey, "")}
                  title="Clear override"
                  style={{background:"none",border:"none",color:"#b7791f",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>✕</button>
              )}
            </div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"40px 70px 1fr 90px 110px",
          padding:"7px 8px",gap:6,alignItems:"center",background:"#eef2f7",
          borderTop:"2px solid #cfd8e3",fontSize:10,fontWeight:700,color:"#1a2332"}}>
          <div></div>
          <div></div>
          <div style={{textAlign:"right",color:"#6b7a8d",letterSpacing:.3}}>TOTAL</div>
          <div style={{textAlign:"center",fontFamily:"monospace"}}>{Number(totalTestHours.toFixed(2))} hr</div>
          <div style={{textAlign:"right",fontFamily:"monospace",paddingRight:24}}>{Number(totalTestShifts.toFixed(2))} sh</div>
        </div>
        <div style={{padding:"7px 10px",background:"#1a2332",display:"flex",
          justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,color:"rgba(255,255,255,0.6)"}}>SUGGESTED (BILLABLE) SHIFTS — total rounded up</span>
          <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:"#fff"}}>{suggestedShifts} sh</span>
        </div>
      </div>

      {skipped.length > 0 && (
        <div style={{padding:"6px 10px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#92400e",marginBottom:3}}>
            {skipped.length} test{skipped.length!==1?"s":""} skipped (non-numeric time):
          </div>
          {skipped.map(t => (
            <div key={t.ovKey} style={{fontSize:10,color:"#78350f",marginLeft:4}}>
              • <strong>{t.standard}</strong> {t.paragraph} — time: <code style={{background:"#fef3c7",padding:"0 4px",borderRadius:3}}>{t.timeRaw || "(empty)"}</code>
            </div>
          ))}
        </div>
      )}

      <CalcResult setupAmt={setupCost} testAmt={testCost}/>
      <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>
        Teardown: {money(tdCost)} &nbsp;·&nbsp; Total: {money(setupCost+testCost+tdCost)}
        &nbsp;·&nbsp; <span style={{fontStyle:"italic"}}>{suggestedShifts} billable shift{suggestedShifts!==1?"s":""} × {pqRate}/sh × PIA {pia}</span>
      </div>
    </div>
  );
}

// ── DC Mag CRR View ──────────────────────────────────────────────────────────
// DC Mag is simpler than EMI/PQ — typically one row, no per-test selection.
// CRR rows are 4-col [Test, Description, Time, Comments]. We sum any numeric
// Time cells and display the result, same override pattern as EMI/PQ.
function DcmCrrView({crrWorkup, dcmCalc, setDcmCalc, dcmRate}){
  if (crrWorkup === null) {
    return <div style={{fontSize:11,color:"#6b7a8d",fontStyle:"italic",padding:"12px 0"}}>
      Loading CRR workup…
    </div>;
  }
  if (crrWorkup === false || !crrWorkup.data) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      (no CRR workup found for this quote)
    </div>;
  }

  const enabled = crrWorkup.data.enabledSpecs || {};
  const allRows = crrWorkup.data.specRows || {};

  if (!enabled.dcmag) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      DC Magnetics is not enabled in the CRR workup for this quote.
    </div>;
  }

  const PARSE_HOURS = (timeStr) => {
    const s = String(timeStr || "").trim();
    if (!s) return null;
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
    return m ? parseFloat(m[1]) : null;
  };

  const rows = (allRows.dcmag || []).map((row, idx) => {
    const testKey = String(row[0] || "").trim();
    const label = String(row[1] || "");
    const timeRaw = String(row[2] || "");
    if (!testKey && !label) return null;
    const hours = PARSE_HOURS(timeRaw);
    const computedShifts = hours !== null ? Math.round((hours / 8) * 100) / 100 : null;
    const ovKey = "DCM:" + (testKey || "row" + idx) + ":" + idx;
    const ov = dcmCalc.crrShiftOverrides?.[ovKey];
    const hasOv = ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov));
    const effectiveShifts = hasOv ? parseFloat(ov) : computedShifts;
    return {
      testKey: testKey || "(no test name)", label, timeRaw,
      computedShifts, effectiveShifts, hasOv, ovKey,
      skipped: computedShifts === null && !hasOv,
    };
  }).filter(Boolean);

  const counted = rows.filter(t => !t.skipped);
  const skipped = rows.filter(t => t.skipped);
  const totalTestShifts = counted.reduce((a, t) => a + (t.effectiveShifts || 0), 0);
  const totalTestHours = counted.reduce((a, t) => a + (PARSE_HOURS(t.timeRaw) || 0), 0);
  // Suggested billable shifts: round the REAL shift total up to a whole shift once,
  // instead of rounding each test row up individually (which over-counted shifts).
  const suggestedShifts = Math.ceil(Math.round(totalTestShifts * 100) / 100);

  const setupShifts = sf(dcmCalc.setupShifts, 1.5);
  const pia = sf(dcmCalc.pia, 1);
  const setupCost = r25(setupShifts * dcmRate * pia);
  const testCost = r25(suggestedShifts * dcmRate * pia);

  const setOverride = (ovKey, value) => {
    const next = {...(dcmCalc.crrShiftOverrides || {})};
    if (value === "" || isNaN(parseFloat(value))) delete next[ovKey];
    else next[ovKey] = parseFloat(value);
    setDcmCalc(s => ({...s, crrShiftOverrides: next}));
  };

  if (rows.length === 0) {
    return <div style={{fontSize:11,color:"#6b7a8d",padding:"16px 12px",
      background:"#f5f7fa",border:"1px dashed #d0d7de",borderRadius:6,textAlign:"center"}}>
      DC Magnetics is enabled in CRR but no rows are populated.
    </div>;
  }

  return (
    <div>
      <div style={{fontSize:10,color:"#1a5276",background:"#eaf2ff",borderRadius:6,
        padding:"5px 10px",marginBottom:8}}>
        Shift counts derived from CRR Time column (ceiling of hours ÷ 8). Edit any shift to override.
      </div>

      <div style={{border:"1px solid #e0e4ea",borderRadius:6,overflow:"hidden",marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"100px 1fr 90px 110px",
          background:"#f5f7fa",padding:"5px 8px",fontSize:9,color:"#6b7a8d",fontWeight:700,gap:6,
          textTransform:"uppercase",letterSpacing:.3}}>
          <div>Test</div>
          <div>Description</div>
          <div style={{textAlign:"center"}}>Hours</div>
          <div style={{textAlign:"right"}}>Shifts</div>
        </div>
        {counted.map((t, i) => (
          <div key={t.ovKey} style={{display:"grid",gridTemplateColumns:"100px 1fr 90px 110px",
            padding:"5px 8px",gap:6,alignItems:"center",
            background:i%2===0?"#fff":"#fafbfc",
            borderTop:"1px solid #f0f2f5",fontSize:10}}>
            <div style={{fontWeight:600,color:"#1a2332"}}>{t.testKey}</div>
            <div style={{color:"#6b7a8d"}}>{t.label}</div>
            <div style={{textAlign:"center",color:"#6b7a8d",fontFamily:"monospace"}}>{t.timeRaw}</div>
            <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"flex-end"}}>
              <input type="number" step="0.25" min="0"
                value={t.hasOv ? String(dcmCalc.crrShiftOverrides[t.ovKey]) : ""}
                placeholder={String(t.computedShifts)}
                onChange={e=>setOverride(t.ovKey, e.target.value)}
                title={t.hasOv ? `Override (computed: ${t.computedShifts})` : "Override the CRR-derived shift count"}
                style={{
                  width:48,fontSize:10,padding:"1px 4px",textAlign:"center",
                  border:"1px solid "+(t.hasOv?"#b7791f":"#d0d7de"),
                  borderRadius:4,
                  background:t.hasOv?"#fffbeb":"#fff",
                  color:t.hasOv?"#92400e":"#6b7a8d",
                  fontFamily:"monospace",
                  fontWeight:t.hasOv?600:400,
                }}/>
              <span style={{fontSize:10,color:"#6b7a8d"}}>sh</span>
              {t.hasOv && (
                <button onClick={()=>setOverride(t.ovKey, "")}
                  title="Clear override"
                  style={{background:"none",border:"none",color:"#b7791f",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>✕</button>
              )}
            </div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"100px 1fr 90px 110px",
          padding:"7px 8px",gap:6,alignItems:"center",background:"#eef2f7",
          borderTop:"2px solid #cfd8e3",fontSize:10,fontWeight:700,color:"#1a2332"}}>
          <div></div>
          <div style={{textAlign:"right",color:"#6b7a8d",letterSpacing:.3}}>TOTAL</div>
          <div style={{textAlign:"center",fontFamily:"monospace"}}>{Number(totalTestHours.toFixed(2))} hr</div>
          <div style={{textAlign:"right",fontFamily:"monospace",paddingRight:24}}>{Number(totalTestShifts.toFixed(2))} sh</div>
        </div>
        <div style={{padding:"7px 10px",background:"#1a2332",display:"flex",
          justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,color:"rgba(255,255,255,0.6)"}}>SUGGESTED (BILLABLE) SHIFTS — total rounded up</span>
          <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:"#fff"}}>{suggestedShifts} sh</span>
        </div>
      </div>

      {skipped.length > 0 && (
        <div style={{padding:"6px 10px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#92400e",marginBottom:3}}>
            {skipped.length} row{skipped.length!==1?"s":""} skipped (non-numeric time):
          </div>
          {skipped.map(t => (
            <div key={t.ovKey} style={{fontSize:10,color:"#78350f",marginLeft:4}}>
              • <strong>{t.testKey}</strong> — time: <code style={{background:"#fef3c7",padding:"0 4px",borderRadius:3}}>{t.timeRaw || "(empty)"}</code>
            </div>
          ))}
        </div>
      )}

      <CalcResult setupAmt={setupCost} testAmt={testCost}/>
      <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>
        Total: {money(setupCost+testCost)}
        &nbsp;·&nbsp; <span style={{fontStyle:"italic"}}>{suggestedShifts} billable shift{suggestedShifts!==1?"s":""} × {dcmRate}/sh × PIA {pia}</span>
      </div>
    </div>
  );
}

// ── Pricing Calculator ────────────────────────────────────────────────────────
function PricingCalculator({setup, ti, onExportEmiF, onExportEmiG, onExportPq300b, onExportPq300p1, calcStatesRef, crrWorkup, onRefreshCrr}){
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("vib");
  // CRR view toggle per calc tab. "computed" = NUForce calc (existing), "crr" = read from crrWorkup
  const [emiViewMode, setEmiViewMode] = useState("computed");
  const [pqViewMode, setPqViewMode] = useState("computed");
  const [dcmViewMode, setDcmViewMode] = useState("computed");
  // Customer Questions modal — opens a textarea with editable pre-populated
  // EMI questions the user can send to a customer to gather info before
  // finalizing a quote. Editable so the user can trim/tailor per customer.
  const [customerQModalOpen, setCustomerQModalOpen] = useState(false);
  const EMI_CUSTOMER_QUESTIONS_DEFAULT =
`Revision of MIL-STD-461, Rev F or Rev G?

Classification of testing per table in standard (Army, Navy, Air Force; aircraft (external, safety critical, internal, flight line), ship (metallic or non-metallic), submarine (internal or external), ground, space).

Location of the unit if on a ship (above deck & exposed below deck, below deck, hangar deck)  e.g., Navy, ships, metallic, below deck.

Dimensions of EUT(s) (drawings if possible) including dimensions where cables enter/exit.

Weight of EUT(s)

Input power requirements (AC or DC voltage, # phases and nominal current, inrush current, if 3 phase is it delta or wye)

Number, size (OD), shielded or unshielded, length (in application) and location of cables on EUT (helpful to know what is on each cable and how shields are terminated)

Special interface requirements (test box, monitoring equipment needed to ensure functionality and/or susceptibility measurement, peripherals, pumps, compressed air, etc.)

General operation description, a block diagram with all peripherals shown would be very helpful.

How many modes of operation must be tested?

Does this unit have an operating frequency of 100 kHz or less (or 150 kHz or less for Rev G CS101) AND an operating sensitivity of 1 uV or better (such as 0.5 uV)? If yes, specify the operating frequency.

Are there any UPS/batteries involved or battery backup? If yes, what is the time to discharge from 100% to 20% at the fastest achievable rate, and the time to charge from 20-80% in the operating mode that will be used?

What is the highest operating frequency of any oscillators (461 Rev F only)

Any procurement specification extended frequency range requirements or optional tests.`;
  const [customerQText, setCustomerQText] = useState(EMI_CUSTOMER_QUESTIONS_DEFAULT);
  const [customerQCopiedMsg, setCustomerQCopiedMsg] = useState("");

  // Shared inputs
  const techRate = sf(setup?.techRate,175);
  const fabHours = sf(setup?.fabHours,4);
  const holes    = sf(setup?.holes,0);
  const drillTap = setup?.drillTap||false;
  const drill    = holes*0.5*techRate*(drillTap?1.5:1);
  const fab      = fabHours*techRate;
  const smartBase= (std)=>Math.round(sf(std,0)+drill+fab);

  // Per-tab local state
  const [vib,   setVib]   = useState({std:"900",testing:"3250",pia:"1",spec:"",freqRange:""});
  const [shock, setShock] = useState({cat:"Medium Weight",std:"1500",testing:"4575",fromVib:false,wt:"",pia:"1",spec:"",grade:"",class_:"",type_:"",location:"Hull",blows:""});
  const [noise, setNoise] = useState({chamber:"Speakerbox",level:"<=140dB",durVal:"30",durUnit:"minutes",pia:"1"});
  const [env,   setEnv]   = useState({type:"Temperature & Humidity",thDur:"0 to 1 Day",altDwell:"1-30 min",testing:"1000",std:"500",spec:"",essDur:"10 minutes",thDurVal:"",thDurUnit:"hours"});
  const [hfv,   setHfv]   = useState({std:"500",testing:"1225",pia:"1",dur:"30",spec:""});
  const [sho,   setSho]   = useState({std:"500",testing:"1250",hfvDisc:false,pia:"1",shape:"Half Sine",gLevel:"",pDur:"",nPulses:"",spec:""});
  const [ab,    setAb]    = useState({std:"1000",testing:"2850",pia:"1",spec:""});
  const [sb,    setSb]    = useState({std:"850",testing:"2650",pia:"1",spec:""});

  // Instrumentation tab — folded in from the former standalone Instrumentation Calculator.
  const [instr,setInstr]=useState({
    shock:false, shockCh:"1",
    cmShock:false, cmShockCh:"1",
    vib:false, vibCh:"1",
    cmVib:false, cmVibCh:"1",
    hsv:false,
  });
  const INSTR_ITEMS=[
    {key:"shock",  chKey:"shockCh",  label:"Shock Instrumentation",     price:525},
    {key:"cmShock",chKey:"cmShockCh",label:"Contact Monitoring (Shock)", price:350},
    {key:"vib",    chKey:"vibCh",    label:"Vib Additional Channels",    price:325},
    {key:"cmVib",  chKey:"cmVibCh",  label:"Contact Monitoring (Vibe)",  price:750},
  ];
  const instrTotal =
    INSTR_ITEMS.reduce((a,i)=>a+(instr[i.key]?i.price*sf(instr[i.chKey],1):0),0)+
    (instr.hsv?1950:0);

  // Overtime tab — suggest-only. Reuses the weekday/weekend formula that the
  // old OVERTIME quote section used, but does NOT add a line item to the quote.
  const [otRows,setOtRows]=useState([{type:"Weekday",techs:"1",hours:"0"}]);
  const calcOtRow=(r)=>{
    const isWknd=r.type==="Weekend";
    const min=isWknd?825:300, rate=isWknd?350:262.5;
    return min+sf(r.techs,1)*sf(r.hours,0)*rate;
  };
  const otTotal=otRows.reduce((a,r)=>a+calcOtRow(r),0);

  const TH_PRICES={"0 to 1 Day":1000,"3 Days":1350,"5 Days":1875,"7 Days":2275,"10 Days":2950};
  const NOISE_CHAMBERS={"Speakerbox":1000,"64 Reverb Chamber":1500,"300 Reverb Chamber":2000,"Prog Wave Tube":2750};

  // Weight-based shock testing — uses mwTesting() for source-of-truth tiers
  const wt = sf(shock.wt||ti?.wt,0);
  const isMW = (shock.cat||"Medium Weight")==="Medium Weight";
  const mwsTestPrice = isMW
    ? (wt>0?mwTesting(wt):sf(shock.testing,4575))
    : sf(shock.testing,1450);

  // Vib setup for shock discount
  const vibSetupAmt = smartBase(vib.std);
  const shockSetup = shock.fromVib
    ? (shock.std==="1500"?mwDisc(vibSetupAmt):lwDisc(vibSetupAmt))
    : smartBase(shock.std);

  const TABS=[
    {key:"vib",  label:"Vibration"},
    {key:"shock",label:"Shock"},
    {key:"noise",label:"Noise"},
    {key:"env",  label:"Environmental"},
    {key:"hfv",  label:"HF Vibration"},
    {key:"sho",  label:"Shock (Other)"},
    {key:"ab",   label:"Airborne"},
    {key:"sb",   label:"Structureborne"},
    {key:"emi",  label:"EMI"},
    {key:"pq",   label:"Power Quality"},
    {key:"dcm",  label:"DC Magnetics"},
    {key:"instr",label:"Instrumentation"},
    {key:"ot",   label:"Overtime"},
  ];

  // EMI state
  const [emiCalc,setEmiCalc]=useState({
    spec:"MIL-STD-461",revs:{},plats:{},locs:{},tests:{},
    dimL:"",dimW:"",dimH:"",cables:"",phases:"3",
    rate:String(EMI_SR),setupShifts:"3",tdShifts:"1",rs103amp:"5000",addl:"0",pia:1,
  });
  // PQ state
  const [pqCalc,setPqCalc]=useState({
    rate:String(PQ_SR),phases:"3",setupShifts:"1.5",tdShifts:"1.0",rows:{},cw:false,pia:1,
  });
  // DCM state
  const [dcmCalc,setDcmCalc]=useState({
    spec:"",rate:String(DCM_SR),setupShifts:"1.5",testShifts:"2.0",pia:1,include:false,
  });

  // Mirror the three calculator states up to the parent via a ref. The App's
  // export-panel buttons (like "Spec Builder from Quote") live outside this
  // component but need read access to whatever's currently configured. Using a
  // ref avoids prop drilling or lifting state, and avoids extra re-renders.
  if (calcStatesRef) {
    calcStatesRef.current = { emiCalc, pqCalc, dcmCalc };
  }
  const [specText,setSpecText]=useState("");
  const [copyMsg,setCopyMsg]=useState("");

  // EMI shifts computed from calculator state
  const emiShifts=useMemo(()=>calcEmiShifts({
    dimL:emiCalc.dimL||ti?.dimL||"0",
    dimW:emiCalc.dimW||ti?.dimW||"0",
    dimH:emiCalc.dimH||ti?.dimH||"0",
    cables:emiCalc.cables||"0",
    setupCables:setup?.cables||"0",
    phases:emiCalc.phases||ti?.phase||"3",
    revs:emiCalc.revs,
  }),[emiCalc.dimL,emiCalc.dimW,emiCalc.dimH,emiCalc.cables,setup?.cables,emiCalc.phases,emiCalc.revs,ti?.dimL,ti?.dimW,ti?.dimH,ti?.phase]);

  const emiRate=sf(emiCalc.rate,EMI_SR);
  const emiSelTests=Object.entries(emiCalc.tests||{}).filter(([,v])=>v).map(([k])=>k);
  // Per-test shifts: use shiftOverrides if the user has manually edited a
  // test's shift count, otherwise use the computed value from emiShifts.
  const emiTestShifts=emiSelTests.reduce((a,t)=>{
    const ov = emiCalc.shiftOverrides?.[t];
    if (ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov))) {
      return a + parseFloat(ov);
    }
    return a + (emiShifts[t]?.rounded || 0);
  }, 0);
  const rs103Cost=emiSelTests.includes("RS103")?sf(emiCalc.rs103amp,5000):0;
  // CE101/CE102 Power Source Rental — 440V AC, charged once, attributed to CE101 if both selected
  const has440AC=sf(ti?.volt,0)>=440&&(ti?.pwrType||"AC")==="AC";
  const hasCe101or102=emiSelTests.includes("CE101")||emiSelTests.includes("CE102");
  const ce101PwrCost=(has440AC&&hasCe101or102)?sf(emiCalc.ce101pwrSrc,6500):0;
  const ce101PwrAttribTo=emiSelTests.includes("CE101")?"CE101":"CE102";
  const emiSetupCost=r25(sf(emiCalc.setupShifts,3)*emiRate*sf(emiCalc.pia,1));
  // Suggested EMI setup based on cables + weight
  // Base: 1 shift; +1hr per cable; tier bumps at 6/10/15/20 cables; weight multipliers ≥800lb / ≥1500lb
  const suggSetup=useMemo(()=>{
    const cablesEff=Math.max(0,sf(emiCalc.cables,0)>0?sf(emiCalc.cables,0):sf(setup?.cables,0));
    const wt=sf(emiCalc.weight||ti?.wt,0);
    const baseHrs=8 + cablesEff*1; // 1 shift + 1 hr per cable
    let tierBumpShifts=0;
    if(cablesEff>=6)  tierBumpShifts+=1;
    if(cablesEff>=10) tierBumpShifts+=1;
    if(cablesEff>=15) tierBumpShifts+=1;
    if(cablesEff>=20) tierBumpShifts+=2;
    let totalHrs=baseHrs + tierBumpShifts*8;
    let wtMult=1.0, wtNote='';
    if(wt>=1500){ wtMult=1.20; wtNote=' incl. +20% over 1500 lb'; }
    else if(wt>=800){ wtMult=1.10; wtNote=' incl. +10% over 800 lb'; }
    totalHrs *= wtMult;
    const shifts=Math.ceil(totalHrs/8);
    const cost=r25(shifts*emiRate*sf(emiCalc.pia,1));
    return {shifts, cost, cablesEff, wt, wtNote, totalHrs};
  },[emiCalc.cables,setup?.cables,emiCalc.weight,ti?.wt,emiRate,emiCalc.pia]);
  const emiTestCost=r25((emiTestShifts*emiRate+rs103Cost+ce101PwrCost)*sf(emiCalc.pia,1));
  const emiTdCost=r25(sf(emiCalc.tdShifts,1)*emiRate);

  // PQ computed
  const PQ_P1=[
    {key:"5.3.1",label:"Grounding (susceptibility) test",sh:0.5,sh3p:null},
    {key:"5.3.2",label:"User equipment power profile test",sh:1.0,sh3p:null},
    {key:"5.3.3",label:"Voltage and frequency maximum departure tolerance test",sh:1.0,sh3p:null},
    {key:"5.3.4",label:"Voltage and frequency transient tolerance and recovery test",sh:1.0,sh3p:null},
    {key:"5.3.5",label:"Voltage spike (susceptibility) test",sh:1.5,sh3p:2.0},
    {key:"5.3.6",label:"Emergency conditions (susceptibility) test",sh:2.0,sh3p:null},
    {key:"5.3.7",label:"Current waveform (emission) test",sh:0.75,sh3p:1.0},
    {key:"5.3.8",label:"Voltage and frequency modulation test",sh:2.0,sh3p:null},
    {key:"5.3.9",label:"Simulated human body impedance ground current test",sh:0.75,sh3p:null},
    {key:"5.3.10.1",label:"Equipment line-to-ground voltage test",sh:0.5,sh3p:null},
    {key:"5.3.10.2",label:"Equipment line-to-ground voltage test (AGD)",sh:0.5,sh3p:null},
  ];
  const PQ_300B=[
    {key:"B5.3.1",label:"Voltage and frequency tolerance test",sh:1.0,sh3p:null},
    {key:"B5.3.2",label:"Voltage and frequency transient tolerance and recovery test",sh:1.0,sh3p:null},
    {key:"B5.3.3",label:"Voltage spike test",sh:1.5,sh3p:2.0},
    {key:"B5.3.4",label:"Emergency condition test",sh:2.0,sh3p:null},
    {key:"B5.3.5",label:"Grounding test",sh:0.5,sh3p:null},
    {key:"B5.3.6",label:"User equipment power profile test",sh:1.0,sh3p:null},
    {key:"B5.3.7",label:"Current waveform test",sh:0.75,sh3p:1.0},
    {key:"B5.3.8",label:"Voltage and frequency modulation test",sh:2.0,sh3p:null},
    {key:"B5.3.9",label:"Simulated human body leakage current test",sh:0.75,sh3p:null},
    {key:"B5.3.10.1",label:"Equipment insulation resistance test",sh:0.5,sh3p:null},
    {key:"B5.3.10.2",label:"Active ground detection test",sh:0.5,sh3p:null},
  ];
  const pqIs3ph=sf(pqCalc.phases||ti?.phase||3,3)>=3;
  // Effective shift count for a PQ row: prefer pqCalc.shiftOverrides[r.key]
  // if set, otherwise use phase-aware computed value.
  const getShifts=r=>{
    const ov = pqCalc.shiftOverrides?.[r.key];
    if (ov !== undefined && ov !== null && ov !== "" && !isNaN(parseFloat(ov))) return parseFloat(ov);
    return pqIs3ph&&r.sh3p!=null?r.sh3p:r.sh;
  };
  const pqRate=sf(pqCalc.rate,PQ_SR);
  const p1Shifts=PQ_P1.reduce((a,r)=>a+(pqCalc.rows?.[r.key]?getShifts(r):0),0);
  const b3Shifts=PQ_300B.reduce((a,r)=>a+(pqCalc.rows?.[r.key]?getShifts(r):0),0);
  const pqTotalShifts=p1Shifts+b3Shifts;
  const pqSetupCost=r25(sf(pqCalc.setupShifts,1.5)*pqRate*sf(pqCalc.pia,1));
  const pqTestCost=r25(pqTotalShifts*pqRate*sf(pqCalc.pia,1));
  const pqTdCost=r25(sf(pqCalc.tdShifts,1.0)*pqRate);

  // DCM computed
  const dcmRate=sf(dcmCalc.rate,DCM_SR);
  // DC Mag has no per-test selection like EMI/PQ, but the user does configure
  // setup/test shifts. Break the total into Setup vs Testing components so
  // the summary display matches EMI/PQ style.
  const dcmSetupCost=r25(sf(dcmCalc.setupShifts,1.5)*dcmRate*sf(dcmCalc.pia,1));
  const dcmTestCost=r25(sf(dcmCalc.testShifts,2.0)*dcmRate*sf(dcmCalc.pia,1));
  const dcmTotal=r25(dcmSetupCost+dcmTestCost);

  const EMI_NOTES="EMI Notes:\n* This quote assumes that the susceptibility criteria can be determined in less than 3 seconds during real-time operation of the EUT, and that if additional monitoring personnel are needed, they would be provided by the customer. Customer to supply cables and all peripheral and monitoring equipment, and one mode of operation (operating or standby). Susceptibility determination provided by the customer. Pricing is based on customer-supplied information, the assumptions listed here, and acceptance of an approved test procedure.\n* Pricing and feasibility may be reevaluated upon completion and review of the NU Laboratories Test Configuration Form.\n* This quote assumes that the number of cables and outside diameter of the cables under test are within NU Laboratories capabilities/limitations.\n* Pricing assumes the standard list of tests from MIL-STD-461G, and that all testing is performed at NU Labs. Any tests requiring subcontracting will incur additional charges.";

  const copyToClipboard=(text)=>{
    navigator.clipboard.writeText(text).then(()=>{setCopyMsg("Copied!");setTimeout(()=>setCopyMsg(""),2000);});
  };



  // CalcInp, CalcSel, CalcRow2, CalcResult are defined outside as stable components

  const SmartNote=({label})=>(
    <div style={{fontSize:9,color:"#9aa5b1",marginBottom:8}}>
      ↳ Setup reads from form: tech rate ${techRate}/hr, {fabHours}h fab{holes>0?`, ${holes} holes`:""}
      {drill>0?` (+$${Math.round(drill).toLocaleString()} drill)`:""}
      {fab>0?` (+$${Math.round(fab).toLocaleString()} fab)`:""}
    </div>
  );

  return(
    <div style={{marginTop:10,border:"1px solid #e0e4ea",borderRadius:10,overflow:"hidden",fontFamily:"Segoe UI,system-ui,sans-serif"}}>
      {/* Header */}
      <div style={{background:"#f8f9fb",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",
        cursor:"pointer",borderBottom:open?"1px solid #e0e4ea":"none"}}
        onClick={()=>setOpen(v=>!v)}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#1a2332",letterSpacing:.2}}>Pricing Calculator</span>
          <span style={{fontSize:10,color:"#9aa5b1"}}>— reference tool, does not affect quote</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {onRefreshCrr&&(
            <button onClick={(e)=>{e.stopPropagation();onRefreshCrr();}}
              title="Re-check Workspace for this quote's CRR workup — use after editing the workup in Workspace"
              style={{fontSize:10,fontWeight:600,color:"#1a5276",background:"#eaf2ff",
                border:"1px solid #b6d4f0",borderRadius:6,padding:"3px 9px",cursor:"pointer"}}>
              ↻ Refresh CRR
            </button>
          )}
          <span style={{fontSize:12,color:"#9aa5b1"}}>{open?"▲":"▼"}</span>
        </div>
      </div>

      {open&&(
        <div style={{padding:"12px 14px",background:"#fff"}}>
          {/* Tabs */}
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
            {TABS.map(t=>{
              // Green dot indicator: shown on emi/pq/dcm tabs when a CRR workup
              // exists for this quote. The CRR view toggle inside the tab is
              // where the user actually sees the data; the dot is just a hint
              // that there's something to look at.
              const showCrrDot = !!crrWorkup && (t.key === "emi" || t.key === "pq" || t.key === "dcm");
              return (
                <button key={t.key} onClick={()=>setTab(t.key)}
                  style={{fontSize:10,fontWeight:tab===t.key?700:400,padding:"4px 10px",borderRadius:20,
                    border:"1px solid "+(tab===t.key?"#1a2332":"#d0d7de"),
                    background:tab===t.key?"#1a2332":"#fff",
                    color:tab===t.key?"#fff":"#6b7a8d",cursor:"pointer",
                    position:"relative",display:"inline-flex",alignItems:"center",gap:6}}>
                  {t.label}
                  {showCrrDot && (
                    <span title="CRR workup available for this quote"
                      style={{display:"inline-block",width:7,height:7,borderRadius:"50%",
                        background:"#22c55e",flexShrink:0}}/>
                  )}
                </button>
              );
            })}
          </div>

          {/* Vibration */}
          {tab==="vib"&&(
            <div>
              <SmartNote/>
              <CalcRow2 label="Spec"><CalcInp value={vib.spec||""} onChange={v=>setVib(s=>({...s,spec:v}))} width={150}/></CalcRow2>
              <CalcRow2 label="Freq Range">
                <CalcInp value={vib.freqRange||""} onChange={v=>setVib(s=>({...s,freqRange:v}))} width={80}/>
                <span style={{fontSize:10,color:"#9aa5b1",marginLeft:4}}>Hz</span>
              </CalcRow2>
              <CalcRow2 label="Std Setup Base ($)"><CalcInp value={vib.std} onChange={v=>setVib(s=>({...s,std:v}))}/></CalcRow2>
              <CalcRow2 label="Testing ($)"><CalcInp value={vib.testing} onChange={v=>setVib(s=>({...s,testing:v}))}/></CalcRow2>
              <CalcRow2 label="PIA Multiplier"><CalcInp value={vib.pia} onChange={v=>setVib(s=>({...s,pia:v}))} width={50}/></CalcRow2>
              <CalcResult setupAmt={Math.round(smartBase(vib.std)*sf(vib.pia,1))} testAmt={Math.round(sf(vib.testing)*sf(vib.pia,1))}/>
              <SpecSuggestion text={(()=>{
                const sc=s=>s?" in accordance with "+s:"";
                const fp=vib.freqRange?", "+vib.freqRange+" Hz":"";
                return vib.spec?"Type I Vibration"+sc(vib.spec)+fp+".":"";
              })()}/>
            </div>
          )}
          {tab==="shock"&&(()=>{
            const wt=sf(shock.wt||ti?.wt,0);
            const isMW=(shock.cat||"Medium Weight")==="Medium Weight";
            const mwsTestPrice=isMW
              ?(wt>0?mwTesting(wt):sf(shock.testing,4575))
              :sf(shock.testing,1450);
            const shockSetup=shock.fromVib?Math.ceil(smartBase(shock.std)*0.75/25)*25:smartBase(shock.std);
            return(
              <div>
                <SmartNote/>
                <CalcRow2 label="Spec"><CalcInp value={shock.spec||""} onChange={v=>setShock(s=>({...s,spec:v}))} width={150}/></CalcRow2>
                <CalcRow2 label="Weight Class">
                  <CalcSel value={shock.cat||"Medium Weight"} width={150}
                    onChange={v=>setShock(s=>({...s,cat:v,std:v==="Medium Weight"?"1500":"900",testing:v==="Medium Weight"?"4575":"1450"}))}
                    options={["Medium Weight","Lightweight"]}/>
                </CalcRow2>
                <CalcRow2 label="Grade"><CalcInp value={shock.grade||""} onChange={v=>setShock(s=>({...s,grade:v}))} width={60}/></CalcRow2>
                <CalcRow2 label="Class"><CalcInp value={shock.class_||""} onChange={v=>setShock(s=>({...s,class_:v}))} width={60}/></CalcRow2>
                <CalcRow2 label="Type"><CalcInp value={shock.type_||""} onChange={v=>setShock(s=>({...s,type_:v}))} width={60}/></CalcRow2>
                <CalcRow2 label="Location">
                  <CalcSel value={shock.location||"Hull"} onChange={v=>setShock(s=>({...s,location:v}))} width={180}
                    options={["Hull","Deck","Hull/Deck","Conventional Deck","Mitigated Deck","Isolated Deck","Shell","Wetted-Surface","Frame"]}/>
                </CalcRow2>
                <CalcRow2 label="# Blows"><CalcInp value={shock.blows||""} onChange={v=>setShock(s=>({...s,blows:v}))} width={60}/></CalcRow2>
                {isMW&&(
                  <CalcRow2 label="Unit Weight (lbs)">
                    <CalcInp value={shock.wt} onChange={v=>setShock(s=>({...s,wt:v}))} width={70}/>
                    {wt>0&&<span style={{fontSize:10,color:"#5dade2",marginLeft:6}}>→ ${mwsTestPrice.toLocaleString()}</span>}
                  </CalcRow2>
                )}
                <CalcRow2 label="From Vib?">
                  <input type="checkbox" checked={shock.fromVib||false} onChange={e=>setShock(s=>({...s,fromVib:e.target.checked}))}/>
                  <span style={{fontSize:10,color:"#9aa5b1",marginLeft:4}}>25% disc on setup</span>
                </CalcRow2>
                <CalcRow2 label="PIA Multiplier"><CalcInp value={shock.pia} onChange={v=>setShock(s=>({...s,pia:v}))} width={50}/></CalcRow2>
                <CalcResult setupAmt={Math.round(shockSetup*sf(shock.pia,1))} testAmt={Math.round(mwsTestPrice*sf(shock.pia,1))}/>
                <SpecSuggestion text={(()=>{
                  const sc=s=>s?" in accordance with "+s:"";
                  const parts=[];
                  if(shock.grade)parts.push("Grade "+shock.grade);
                  if(shock.class_)parts.push("Class "+shock.class_);
                  if(shock.type_)parts.push("Type "+shock.type_);
                  const loc=shock.location||"Hull";
                  parts.push(loc+" Mounted");
                  if(shock.blows)parts.push(shock.blows+" blows");
                  const det=parts.length?", "+parts.join(", "):"";
                  return (shock.cat||"Medium Weight")+" Shock"+sc(shock.spec)+det+".";
                })()}/>
              </div>
            );
          })()}
          {tab==="noise"&&(()=>{
            const COMP_COST_CALC={"<=140dB":0,"145dB":750,"150dB":1500,"155dB":2500,"160dB":2500,"165dB":3500,"170dB":3500};
            const isPWT=noise.chamber==="Prog Wave Tube";
            const lvl=noise.level||"<=140dB";
            const compCost=isPWT?3500:(COMP_COST_CALC[lvl]||0);
            const compMarkup=Math.round(compCost*1.25);
            const durVal=noise.durVal||"30";
            const durUnit=noise.durUnit||"minutes";
            const autoTestCalc=noiseTestingPrice(durVal,durUnit,lvl,compCost);
            const chamberSetupCalc=NOISE_CHAMBERS[noise.chamber]||1000;
            const L=sf(ti?.dimL,0),W=sf(ti?.dimW,0),H=sf(ti?.dimH,0);
            const cuIn=L*W*H; const cuFt=cuIn/1728;
            const dbNum=lvl==="<=140dB"?140:parseInt(lvl)||0;
            const fitsSpkr=cuIn>0&&cuIn<=500&&dbNum<=145;
            const fits64=cuIn>0&&cuFt<=6.4;
            const fits300=cuIn>0&&cuFt<=30&&dbNum<=165;
            const fitsPWT=cuIn>0&&H<=40&&W<=40&&dbNum<=165;
            const rec=cuIn>0?(fitsSpkr?"Speakerbox":fits64?"64 Reverb Chamber":fits300?"300 Reverb Chamber":"Prog Wave Tube"):"";
            const chamberOk=!cuIn||(noise.chamber==="Speakerbox"?fitsSpkr:noise.chamber==="64 Reverb Chamber"?fits64:noise.chamber==="300 Reverb Chamber"?fits300:fitsPWT);
            const base30=NOISE_BASE_30[lvl]||0;
            const base60=NOISE_BASE_60[lvl]||0;
            const raw=parseFloat(durVal)||0;
            const totalHrs=durUnit==="hours"?Math.ceil(raw):raw<=30?null:Math.ceil(raw/60);
            const BLOCK=40;
            const mathLines=[];
            if(totalHrs===null||totalHrs<=0){
              mathLines.push("≤30 min → base (30-min rate): $"+base30.toLocaleString());
            } else if(totalHrs<=1){
              mathLines.push("≤1 hr → base (60-min rate): $"+base60.toLocaleString());
            } else {
              const fullBlocks=Math.floor((totalHrs-1)/BLOCK);
              const remaining=totalHrs-(fullBlocks*BLOCK);
              const extraHrs=remaining-1;
              const blockCost=remaining>20?extraHrs*375:extraHrs*500;
              const rateLabel=remaining>20?"$375/hr (>20h rate)":"$500/hr";
              if(fullBlocks===0){
                mathLines.push("Base (1 hr): $"+base60.toLocaleString());
                if(extraHrs>0){
                  if(remaining>20) mathLines.push("Hours 2–"+remaining+" (block >20h → all at $375/hr): +$"+blockCost.toLocaleString());
                  else mathLines.push("Hours 2–"+remaining+" ($500/hr): +$"+blockCost.toLocaleString());
                }
              } else {
                mathLines.push("Full 40-hr blocks: "+(fullBlocks+1)+" × $"+base60.toLocaleString()+" = $"+((fullBlocks+1)*base60).toLocaleString());
                mathLines.push("  Note: blocks ≤20 extra hrs → $500/hr; blocks >20 extra hrs → all $375/hr");
                if(remaining>1){
                  mathLines.push("Final block ("+remaining+" hrs): base $"+base60.toLocaleString());
                  mathLines.push("  Hours 2–"+remaining+" ("+rateLabel+"): +$"+blockCost.toLocaleString());
                }
              }
            }
            if(compMarkup>0) mathLines.push("Compressor markup ("+compCost.toLocaleString()+" × 1.25): +$"+compMarkup.toLocaleString());
            return(
              <div>
                <CalcRow2 label="Spec">
                  <CalcInp value={noise.spec||""} onChange={v=>setNoise(s=>({...s,spec:v}))} width={200}/>
                </CalcRow2>
                {!(noise.spec||"").trim()&&(
                  <div style={{fontSize:10,color:"#c0392b",marginTop:-4,marginBottom:6,marginLeft:120}}>⚠ Spec required for spec suggestion text</div>
                )}
                <CalcRow2 label="Chamber">
                  <CalcSel value={noise.chamber} onChange={v=>setNoise(s=>({...s,chamber:v}))}
                    options={Object.keys(NOISE_CHAMBERS)} width={200}/>
                </CalcRow2>
                {rec&&(
                  <div style={{fontSize:10,borderRadius:5,padding:"4px 8px",marginBottom:6,
                    background:chamberOk?"#f0fdf4":"#fdf3f2",color:chamberOk?"#15803d":"#dc2626"}}>
                    {chamberOk?"✓ "+noise.chamber+" is appropriate":"⚠ Recommended: "+rec+" — "+noise.chamber+" may not be suitable"}
                  </div>
                )}
                <CalcRow2 label="OASPL Level">
                  <CalcSel value={lvl} onChange={v=>setNoise(s=>({...s,level:v}))}
                    options={["<=140dB","145dB","150dB","155dB","160dB","165dB","170dB"]} width={120}/>
                </CalcRow2>
                <CalcRow2 label="Test OASPL (dB)">
                  <CalcInp value={noise.testOaspl||""} onChange={v=>setNoise(s=>({...s,testOaspl:v}))} width={70}/>
                </CalcRow2>
                {!(noise.testOaspl||"").toString().trim()&&(
                  <div style={{fontSize:10,color:"#c0392b",marginTop:-4,marginBottom:6,marginLeft:120}}>⚠ Test OASPL required for spec suggestion text</div>
                )}
                <CalcRow2 label="Duration">
                  <CalcInp value={noise.durVal||"30"} onChange={v=>setNoise(s=>({...s,durVal:v}))} width={55}/>
                  <CalcSel value={noise.durUnit||"minutes"} onChange={v=>setNoise(s=>({...s,durUnit:v}))}
                    options={["minutes","hours"]} width={90}/>
                </CalcRow2>
                {compCost>0&&(
                  <div style={{fontSize:10,color:"#b45309",background:"#fffbeb",borderRadius:5,padding:"4px 8px",marginBottom:6}}>
                    {isPWT?"Prog Wave Tube always requires":"Level requires"} compressor: ${compCost.toLocaleString()} → ${compMarkup.toLocaleString()} marked up
                  </div>
                )}
                <CalcRow2 label="PIA Multiplier"><CalcInp value={noise.pia} onChange={v=>setNoise(s=>({...s,pia:v}))} width={50}/></CalcRow2>
                <CalcResult setupAmt={Math.round(chamberSetupCalc*sf(noise.pia,1))} testAmt={Math.round(autoTestCalc*sf(noise.pia,1))}/>
                {mathLines.length>0&&(
                  <div style={{marginTop:8,padding:"8px 10px",background:"#f8f9fb",borderRadius:6,border:"1px solid #e8ecf0"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#9aa5b1",letterSpacing:1,marginBottom:4}}>CALCULATION BREAKDOWN</div>
                    {mathLines.map((l,i)=>(
                      <div key={i} style={{fontSize:10,color:"#9aa5b1",fontFamily:"monospace",lineHeight:1.6}}>{l}</div>
                    ))}
                    <div style={{fontSize:10,color:"#6b7a8d",fontWeight:700,borderTop:"1px solid #e8ecf0",marginTop:4,paddingTop:4,fontFamily:"monospace"}}>
                      Total: ${autoTestCalc.toLocaleString()}
                      {sf(noise.pia,1)>1?" × "+noise.pia+" PIA = $"+Math.round(autoTestCalc*sf(noise.pia,1)).toLocaleString():""}
                    </div>
                  </div>
                )}
                <SpecSuggestion text={(()=>{
                  const specVal=(noise.spec||"").trim();
                  const oasplVal=(noise.testOaspl||"").toString().trim();
                  if(!specVal||!oasplVal)return ""; // hide suggestion until both required fields filled
                  const dur=(noise.durVal&&noise.durUnit)?" for "+noise.durVal+" "+noise.durUnit:"";
                  return "Noise Susceptibility testing in accordance with "+specVal+", "+oasplVal+" dB OASPL"+dur+".";
                })()}/>
                <SpecSuggestion text={"Frequencies below 100 Hz are to be performed as a best effort. All cabling connecting to the EUT should be a minimum of 20' long."}/>
                {lvl==="170dB"&&(
                  <SpecSuggestion text={"OASPL's above 170dB are to be performed as a best effort"}/>
                )}
              </div>
            );
          })()}
          {/* Environmental */}
          {tab==="env"&&(()=>{
            const isTH=["Temperature & Humidity","Temperature Only","Humidity Only"].includes(env.type);
            const isAlt=env.type==="Altitude";
            const isAcc=env.type==="Acceleration";
            const isIncl=env.type==="Inclination";
            const isESS=env.type==="ESS";
            const isDrip=env.type==="Drip Test";
            const isSpray=env.type==="Spray Test";
            const typeToKey={
              "Temperature & Humidity":"th","Temperature Only":"th","Humidity Only":"th",
              "Altitude":"alt","Salt Fog":"sf","ESS":"ess","Rapid Decompression":"rd",
              "Explosive Decompression":"ed","Acceleration":"acc","Inclination":"incl",
              "Drip Test":"drip","Submergence":"sub","Spray Test":"spray",
              "Insulation Resistance":"insres",
            };
            const ENV_BASE_PRICING={
              th:{setup:500,testing:null},sf:{setup:0,testing:1750},alt:{setup:500,testing:null},
              ess:{setup:0,testing:1000},acc:{setup:null,testing:1950},incl:{setup:null,testing:1750},
              rd:{setup:1000,testing:2275},ed:{setup:1250,testing:2450},drip:{setup:null,testing:1250},
              sub:{setup:750,testing:1250},spray:{setup:null,testing:1500},insres:{setup:0,testing:500},
            };
            const envKey=typeToKey[env.type]||"alt";
            const base=ENV_BASE_PRICING[envKey]||{setup:500,testing:1000};
            // Acceleration/Inclination and Drip/Spray fold the Setup-form fab + drill
            // (holes/drilling math, same as Lightweight Shock) onto a flat base.
            const fabDrillBase=isAcc?2000:isIncl?1250:(isDrip||isSpray)?750:null;
            const smartSetupAmt=fabDrillBase!=null?Math.round(fabDrillBase+drill+fab):base.setup;
            const ALT_DWELL_PRICES={"1-30 min":1000,"31-60 min":1500,"1-2 hr":2275};
            const altTestAmt=ALT_DWELL_PRICES[env.altDwell||"1-30 min"]||1000;
            const testAmt=isTH?(ENV_TH_PRICES[env.thDur]||1000):isAlt?altTestAmt:(base.testing||1000);
            const setupAmt=smartSetupAmt;
            // Build spec suggestion
            const specLines=[];
            if(env.spec) specLines.push("Spec: "+env.spec);
            if(isTH){
              specLines.push("Test Type: "+env.type);
              if(env.thDurVal) specLines.push("Duration: "+env.thDurVal+" "+(env.thDurUnit||"hours"));
              else specLines.push("Duration: "+env.thDur);
            } else if(isAlt){
              specLines.push("Altitude Testing");
              specLines.push("Dwell: "+env.altDwell);
            } else if(isESS){
              specLines.push("Environmental Stress Screening (ESS)");
              if(env.essDur) specLines.push("Duration/Axis: "+env.essDur);
            } else {
              specLines.push(env.type);
            }
            return(
              <div>
                <CalcRow2 label="Test Type">
                  <CalcSel value={env.type} onChange={v=>setEnv(s=>({...s,type:v}))} width={220}
                    options={["Temperature & Humidity","Temperature Only","Humidity Only","Altitude","Salt Fog","ESS","Rapid Decompression","Explosive Decompression","Acceleration","Inclination","Drip Test","Submergence","Spray Test","Insulation Resistance"]}/>
                </CalcRow2>
                <CalcRow2 label="Spec"><CalcInp value={env.spec||""} onChange={v=>setEnv(s=>({...s,spec:v}))} width={150}/></CalcRow2>
                {isTH&&(<>
                  <CalcRow2 label="T&H Type">
                    <CalcSel value={env.thType||"Temperature & Humidity"} onChange={v=>setEnv(s=>({...s,thType:v}))}
                      options={["Temperature & Humidity","Temperature Only","Humidity Only"]} width={200}/>
                  </CalcRow2>
                  <CalcRow2 label="Duration (preset)">
                    <CalcSel value={env.thDur||"0 to 1 Day"} onChange={v=>setEnv(s=>({...s,thDur:v}))}
                      options={Object.keys(ENV_TH_PRICES)} width={130}/>
                    <span style={{fontSize:10,color:"#5dade2",marginLeft:6}}>→ ${(ENV_TH_PRICES[env.thDur||"0 to 1 Day"]||1000).toLocaleString()}</span>
                  </CalcRow2>
                  <CalcRow2 label="Custom Duration">
                    <CalcInp value={env.thDurVal||""} onChange={v=>setEnv(s=>({...s,thDurVal:v}))} width={55}/>
                    <CalcSel value={env.thDurUnit||"hours"} onChange={v=>setEnv(s=>({...s,thDurUnit:v}))}
                      options={["minutes","hours","days"]} width={90}/>
                    <span style={{fontSize:9,color:"#9aa5b1",marginLeft:4}}>spec text only</span>
                  </CalcRow2>
                </>)}
                {isAlt&&(
                  <CalcRow2 label="Dwell Time">
                    <CalcSel value={env.altDwell||"1-30 min"} onChange={v=>setEnv(s=>({...s,altDwell:v}))}
                      options={["1-30 min","31-60 min","1-2 hr"]} width={120}/>
                    <span style={{fontSize:10,color:"#5dade2",marginLeft:6}}>→ ${altTestAmt.toLocaleString()}</span>
                  </CalcRow2>
                )}
                {isESS&&(
                  <CalcRow2 label="Duration/Axis">
                    <CalcInp value={env.essDur||"10 minutes"} onChange={v=>setEnv(s=>({...s,essDur:v}))} width={120}/>
                  </CalcRow2>
                )}
                {(() => {
                  let note=null;
                  if(isTH) note=<>Setup <strong>{money(base.setup)}</strong> flat. Testing is set by the duration preset — <strong>{env.thDur}</strong> = <strong>{money(testAmt)}</strong> (0–1 Day $1,000 · 3 Days $1,350 · 5 Days $1,875 · 7 Days $2,275 · 10 Days $2,950). The custom-duration field is spec text only and does not change price.</>;
                  else if(isAlt) note=<>Setup <strong>$500</strong> flat. Testing is set by dwell time — <strong>{env.altDwell}</strong> = <strong>{money(testAmt)}</strong> (1–30 min $1,000 · 31–60 min $1,500 · 1–2 hr $2,275).</>;
                  else if(env.type==="Salt Fog") note=<>Testing <strong>$1,750</strong> for a <strong>96-hour</strong> exposure. No separate setup line.</>;
                  else if(isESS) note=<>Flat <strong>$1,000</strong>, reflecting up to <strong>20 minutes per axis</strong>. For anything longer than 20 min/axis, quote it under <strong>HF Vibration</strong> instead.</>;
                  else if(isAcc) note=<>Setup = <strong>$2,000</strong> base + {money(fab)} fab + {money(drill)} drill = <strong>{money(setupAmt)}</strong> (fab &amp; drill come from the Setup form). Testing <strong>$1,950</strong> flat.</>;
                  else if(isIncl) note=<>Setup = <strong>$1,250</strong> base + {money(fab)} fab + {money(drill)} drill = <strong>{money(setupAmt)}</strong> (fab &amp; drill come from the Setup form). Testing <strong>$1,750</strong> flat.</>;
                  else if(isDrip) note=<>Setup = <strong>$750</strong> base + {money(fab)} fab + {money(drill)} drill = <strong>{money(setupAmt)}</strong> (fab &amp; drill come from the Setup form, same holes/drilling math as Lightweight Shock). Testing <strong>$1,250</strong> minimum.</>;
                  else if(isSpray) note=<>Setup = <strong>$750</strong> base + {money(fab)} fab + {money(drill)} drill = <strong>{money(setupAmt)}</strong> (fab &amp; drill come from the Setup form, same holes/drilling math as Lightweight Shock). Testing <strong>$1,500</strong> minimum.</>;
                  else if(env.type==="Submergence") note=<>Setup <strong>$750</strong> flat. Testing <strong>$1,250</strong>.</>;
                  if(!note) return null;
                  return (
                    <div style={{fontSize:9,color:"#6b7a8d",marginBottom:6,padding:"6px 9px",background:"#f8f9fb",borderRadius:5,lineHeight:1.5}}>
                      <span style={{fontWeight:700,color:"#5dade2"}}>How this price is set: </span>{note}
                    </div>
                  );
                })()}
                <CalcResult setupAmt={setupAmt>0?setupAmt:undefined} testAmt={testAmt}/>
                <SpecSuggestion text={(()=>{
                  const sc=s=>s?" in accordance with "+s:"";
                  const sp=env.spec||"";
                  if(isTH){
                    const thMap={"Temperature & Humidity":"Temperature & Humidity","Temperature Only":"Temperature","Humidity Only":"Humidity"};
                    const t=thMap[env.thType||"Temperature & Humidity"]||"Temperature & Humidity";
                    const customDur=env.thDurVal?(env.thDurVal+" "+(env.thDurUnit||"hours")):env.thDur||"";
                    const dur=customDur?", "+customDur:"";
                    return t+" testing"+sc(sp)+dur+".";
                  } else if(isAlt){
                    const dw=env.altDwell?", "+env.altDwell+" dwell":"";
                    return "Altitude testing"+sc(sp)+dw+".";
                  } else if(isESS){
                    const dur=env.essDur||"10 minutes";
                    return "ESS testing"+sc(sp)+", "+dur+" per axis.";
                  } else if(env.type==="Salt Fog") return "Salt Fog testing"+sc(sp)+".";
                  else if(env.type==="Acceleration") return "Acceleration testing"+sc(sp)+".";
                  else if(env.type==="Inclination") return "Inclination testing"+sc(sp)+".";
                  else if(env.type==="Rapid Decompression") return "Rapid Decompression testing"+sc(sp)+".";
                  else if(env.type==="Explosive Decompression") return "Explosive Decompression testing"+sc(sp)+".";
                  else if(env.type==="Drip Test") return "Drip Test"+sc(sp)+".";
                  else if(env.type==="Submergence") return "Submergence testing"+sc(sp)+".";
                  else if(env.type==="Spray Test") return "Spray Test"+sc(sp)+".";
                  else if(env.type==="Insulation Resistance") return "Insulation Resistance"+sc(sp)+".";
                  return env.type+" testing"+sc(sp)+".";
                })()}/>
              </div>
            );
          })()}
          {tab==="hfv"&&(()=>{
            const durMin=sf(hfv.dur||"30",30);
            const autoTest=hfvTestingPrice(durMin);
            const hrs=durMin/60;
            const setupAmt=Math.round(smartBase(hfv.std)*sf(hfv.pia,1));
            const testAmt=Math.round(autoTest*sf(hfv.pia,1));
            return(
              <div>
                <SmartNote/>
                <CalcRow2 label="Spec"><CalcInp value={hfv.spec||""} onChange={v=>setHfv(s=>({...s,spec:v}))} width={150}/></CalcRow2>
                <CalcRow2 label="Std Setup Base ($)"><CalcInp value={hfv.std} onChange={v=>setHfv(s=>({...s,std:v}))}/></CalcRow2>
                <CalcRow2 label="Duration/Axis (min)">
                  <CalcInp value={hfv.dur||"30"} onChange={v=>setHfv(s=>({...s,dur:v}))} width={55}/>
                  <span style={{fontSize:10,color:"#5dade2",marginLeft:6}}>→ ${autoTest.toLocaleString()}/axis</span>
                </CalcRow2>
                <div style={{fontSize:9,color:"#9aa5b1",marginBottom:6,padding:"4px 8px",background:"#f8f9fb",borderRadius:5,fontFamily:"monospace"}}>
                  {hrs<=1?"≤60 min: $1,225":hrs<=3?"1–3 hr: $1,225 + $750×"+(hrs-1).toFixed(2)+"h":"3+ hr: $1,225 + $1,500 + $525×"+(hrs-3).toFixed(2)+"h"}
                  {" = $"+autoTest.toLocaleString()+" per axis"}
                </div>
                <CalcRow2 label="PIA Multiplier"><CalcInp value={hfv.pia} onChange={v=>setHfv(s=>({...s,pia:v}))} width={50}/></CalcRow2>
                <CalcResult setupAmt={setupAmt} testAmt={testAmt}/>
                <SpecSuggestion text={(()=>{
                  const sc=s=>s?" in accordance with "+s:"";
                  return "Vibration testing"+sc(hfv.spec)+", tested for "+(hfv.dur||"30")+" minutes per axis.";
                })()}/>
              </div>
            );
          })()}
          {tab==="sho"&&(()=>{
            const hfvDiscount=sho.hfvDisc;
            const baseSetup=smartBase(sho.std);
            const setupAmt=hfvDiscount?Math.ceil(baseSetup*0.75/25)*25:baseSetup;
            const testAmt=Math.round(sf(sho.testing,1250)*sf(sho.pia,1));
            const setupAmtPIA=Math.round(setupAmt*sf(sho.pia,1));
            return(
              <div>
                <SmartNote/>
                <CalcRow2 label="Pulse Shape">
                  <CalcSel value={sho.shape||"Half Sine"} onChange={v=>setSho(s=>({...s,shape:v}))}
                    options={["Half Sine","Sawtooth","Bench Handling","Drop Shock"]} width={150}/>
                </CalcRow2>
                <CalcRow2 label="G Level">
                  <CalcInp value={sho.gLevel||""} onChange={v=>setSho(s=>({...s,gLevel:v}))} width={70}/>
                </CalcRow2>
                <CalcRow2 label="Pulse Duration (ms)">
                  <CalcInp value={sho.pDur||""} onChange={v=>setSho(s=>({...s,pDur:v}))} width={70}/>
                </CalcRow2>
                <CalcRow2 label="# Pulses">
                  <CalcInp value={sho.nPulses||""} onChange={v=>setSho(s=>({...s,nPulses:v}))} width={60}/>
                </CalcRow2>
                <CalcRow2 label="Spec"><CalcInp value={sho.spec||""} onChange={v=>setSho(s=>({...s,spec:v}))} width={150}/></CalcRow2>
                <CalcRow2 label="Std Setup Base ($)"><CalcInp value={sho.std} onChange={v=>setSho(s=>({...s,std:v}))}/></CalcRow2>
                <CalcRow2 label="Testing ($)"><CalcInp value={sho.testing} onChange={v=>setSho(s=>({...s,testing:v}))}/></CalcRow2>
                <CalcRow2 label="HFV Discount?">
                  <input type="checkbox" checked={sho.hfvDisc||false} onChange={e=>setSho(s=>({...s,hfvDisc:e.target.checked}))}/>
                  <span style={{fontSize:10,color:"#9aa5b1",marginLeft:4}}>25% off setup</span>
                </CalcRow2>
                <CalcRow2 label="PIA Multiplier"><CalcInp value={sho.pia} onChange={v=>setSho(s=>({...s,pia:v}))} width={50}/></CalcRow2>
                {hfvDiscount&&(
                  <div style={{fontSize:9,color:"#b45309",background:"#fffbeb",borderRadius:5,padding:"4px 8px",marginBottom:6}}>
                    HFV discount applied: ${baseSetup.toLocaleString()} × 75% = ${setupAmt.toLocaleString()}
                  </div>
                )}
                <CalcResult setupAmt={setupAmtPIA} testAmt={testAmt}/>
                <SpecSuggestion text={(()=>{
                  if(!sho.spec)return "";
                  const shape=sho.shape||"Half Sine";
                  if(shape==="Drop Shock") return "Drop Shock testing in accordance with "+sho.spec+".";
                  if(shape==="Bench Handling") return "Bench Handling Shock testing in accordance with "+sho.spec+".";
                  if((shape==="Half Sine"||shape==="Sawtooth")&&(sho.nPulses||sho.gLevel||sho.pDur)){
                    const pd=[
                      sho.nPulses?"Perform "+sho.nPulses:"",
                      sho.gLevel?sho.gLevel+"g":"",
                      sho.pDur?sho.pDur+"ms shock pulses":"",
                    ].filter(Boolean).join(", ");
                    return "Shock testing in accordance with "+sho.spec+". "+pd+".";
                  }
                  return "Shock testing in accordance with "+sho.spec+".";
                })()}/>
              </div>
            );
          })()}
          {tab==="ab"&&(
            <div>
              <SmartNote/>
              <CalcRow2 label="Spec"><CalcInp value={ab.spec||""} onChange={v=>setAb(s=>({...s,spec:v}))} width={150}/></CalcRow2>
              <CalcRow2 label="Std Setup Base ($)"><CalcInp value={ab.std} onChange={v=>setAb(s=>({...s,std:v}))}/></CalcRow2>
              <CalcRow2 label="Testing ($)"><CalcInp value={ab.testing} onChange={v=>setAb(s=>({...s,testing:v}))}/></CalcRow2>
              <CalcRow2 label="PIA Multiplier"><CalcInp value={ab.pia} onChange={v=>setAb(s=>({...s,pia:v}))} width={50}/></CalcRow2>
              <CalcResult setupAmt={Math.round(smartBase(ab.std)*sf(ab.pia,1))} testAmt={Math.round(sf(ab.testing)*sf(ab.pia,1))}/>
              <SpecSuggestion text={ab.spec?"Airborne Noise testing in accordance with "+ab.spec+".":""}/>
            </div>
          )}
          {tab==="sb"&&(
            <div>
              <SmartNote/>
              <CalcRow2 label="Spec"><CalcInp value={sb.spec||""} onChange={v=>setSb(s=>({...s,spec:v}))} width={150}/></CalcRow2>
              <CalcRow2 label="Std Setup Base ($)"><CalcInp value={sb.std} onChange={v=>setSb(s=>({...s,std:v}))}/></CalcRow2>
              <CalcRow2 label="Testing ($)"><CalcInp value={sb.testing} onChange={v=>setSb(s=>({...s,testing:v}))}/></CalcRow2>
              <CalcRow2 label="PIA Multiplier"><CalcInp value={sb.pia} onChange={v=>setSb(s=>({...s,pia:v}))} width={50}/></CalcRow2>
              <CalcResult setupAmt={Math.round(smartBase(sb.std)*sf(sb.pia,1))} testAmt={Math.round(sf(sb.testing)*sf(sb.pia,1))}/>
              <SpecSuggestion text={sb.spec?"Structureborne Noise testing in accordance with "+sb.spec+".":""}/>
            </div>
          )}
          {tab==="emi"&&(
            <div>
              {/* View toggle: Computed (NUForce calc) vs CRR Workup (from Supabase) */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:10,color:"#6b7a8d",fontWeight:600,letterSpacing:.4,textTransform:"uppercase"}}>View:</span>
                <div style={{display:"inline-flex",border:"1px solid #d0d7de",borderRadius:6,overflow:"hidden"}}>
                  <button onClick={()=>setEmiViewMode("computed")}
                    style={{fontSize:10,fontWeight:emiViewMode==="computed"?700:400,padding:"4px 10px",
                      border:"none",
                      background:emiViewMode==="computed"?"#1a2332":"#fff",
                      color:emiViewMode==="computed"?"#fff":"#6b7a8d",cursor:"pointer"}}>
                    Computed
                  </button>
                  <button onClick={()=>setEmiViewMode("crr")}
                    style={{fontSize:10,fontWeight:emiViewMode==="crr"?700:400,padding:"4px 10px",
                      border:"none",borderLeft:"1px solid #d0d7de",
                      background:emiViewMode==="crr"?"#1a2332":"#fff",
                      color:emiViewMode==="crr"?"#fff":"#6b7a8d",cursor:"pointer",
                      display:"inline-flex",alignItems:"center",gap:5}}>
                    CRR Workup
                    {crrWorkup && crrWorkup !== false && (
                      <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",
                        background:emiViewMode==="crr"?"#22c55e":"#22c55e",flexShrink:0}}/>
                    )}
                  </button>
                </div>
              </div>

              {emiViewMode === "computed" && (
                <>
                  {(ti?.dimL||ti?.dimW||ti?.wt||ti?.phase)&&(
                    <div style={{fontSize:10,color:"#1a5276",background:"#eaf2ff",borderRadius:6,
                      padding:"5px 10px",marginBottom:8}}>
                      Dimensions, weight and power are pre-filled from the Test Item Description above.
                    </div>
                  )}
                  <EmiForm s={emiCalc} set={setEmiCalc} ti={ti} setup={setup}/>
                  <CalcResult setupAmt={suggSetup.cost} testAmt={emiTestCost}/>
                  <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>Teardown: {money(emiTdCost)} &nbsp;·&nbsp; Total: {money(suggSetup.cost+emiTestCost+emiTdCost)}</div>
                </>
              )}

              {emiViewMode === "crr" && (
                <EmiCrrView
                  crrWorkup={crrWorkup}
                  emiCalc={emiCalc}
                  setEmiCalc={setEmiCalc}
                  emiRate={emiRate}
                  ti={ti}/>
              )}

              <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>copyToClipboard(EMI_NOTES)}
                  style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #1a5276",background:"#eaf2ff",color:"#1a5276",cursor:"pointer",fontWeight:600}}>
                  Copy EMI Notes
                </button>
                <button onClick={()=>{setCustomerQCopiedMsg("");setCustomerQModalOpen(true);}}
                  title="Open a pre-written list of questions to send to the customer for EMI info gathering"
                  style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #4a1942",background:"#fdf0f7",color:"#4a1942",cursor:"pointer",fontWeight:600}}>
                  Customer Questions
                </button>
                {(emiCalc.revs||{})["Rev F"]&&onExportEmiF&&(
                  <button onClick={()=>onExportEmiF(emiCalc)}
                    style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"none",background:"#1a2332",color:"#fff",cursor:"pointer",fontWeight:600}}>
                    Export 461F Spec PDF
                  </button>
                )}
                {(emiCalc.revs||{})["Rev G"]&&onExportEmiG&&(
                  <button onClick={()=>onExportEmiG(emiCalc)}
                    style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"none",background:"#4a1942",color:"#fff",cursor:"pointer",fontWeight:600}}>
                    Export 461G Spec PDF
                  </button>
                )}
                {!(emiCalc.revs||{})["Rev F"]&&!(emiCalc.revs||{})["Rev G"]&&onExportEmiF&&(
                  <button onClick={()=>onExportEmiF(emiCalc)}
                    style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"none",background:"#1a2332",color:"#fff",cursor:"pointer",fontWeight:600}}>
                    Export Spec PDF
                  </button>
                )}
                {copyMsg&&<span style={{fontSize:11,color:"#166534",alignSelf:"center"}}>{copyMsg}</span>}
              </div>
            </div>
          )}

          {/* PQ Tab — full PqForm */}
          {tab==="pq"&&(
            <div>
              {/* View toggle: Computed (NUForce calc) vs CRR Workup */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:10,color:"#6b7a8d",fontWeight:600,letterSpacing:.4,textTransform:"uppercase"}}>View:</span>
                <div style={{display:"inline-flex",border:"1px solid #d0d7de",borderRadius:6,overflow:"hidden"}}>
                  <button onClick={()=>setPqViewMode("computed")}
                    style={{fontSize:10,fontWeight:pqViewMode==="computed"?700:400,padding:"4px 10px",
                      border:"none",
                      background:pqViewMode==="computed"?"#1a2332":"#fff",
                      color:pqViewMode==="computed"?"#fff":"#6b7a8d",cursor:"pointer"}}>
                    Computed
                  </button>
                  <button onClick={()=>setPqViewMode("crr")}
                    style={{fontSize:10,fontWeight:pqViewMode==="crr"?700:400,padding:"4px 10px",
                      border:"none",borderLeft:"1px solid #d0d7de",
                      background:pqViewMode==="crr"?"#1a2332":"#fff",
                      color:pqViewMode==="crr"?"#fff":"#6b7a8d",cursor:"pointer",
                      display:"inline-flex",alignItems:"center",gap:5}}>
                    CRR Workup
                    {crrWorkup && crrWorkup !== false && (
                      <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",
                        background:"#22c55e",flexShrink:0}}/>
                    )}
                  </button>
                </div>
              </div>

              {pqViewMode === "computed" && (
                <>
                  {(ti?.phase||ti?.amps)&&(
                    <div style={{fontSize:10,color:"#1a5276",background:"#eaf2ff",borderRadius:6,
                      padding:"5px 10px",marginBottom:8}}>
                      Phase and amperage are pre-filled from the Test Item Description above.
                    </div>
                  )}
                  <PqForm s={pqCalc} set={setPqCalc} ti={ti}/>
                  <CalcResult setupAmt={pqSetupCost} testAmt={pqTestCost}/>
                  {sf(ti?.volt,0)>=440&&(ti?.pwrType||"AC")==="AC"&&(
                    <div style={{marginTop:6,padding:"6px 10px",background:"#fffbeb",border:"1px solid #b7791f",
                      borderRadius:6,fontSize:11,color:"#7b4f12",fontWeight:600}}>
                      ⚠ 440 VAC — power source rental required (not included in suggested price above).
                    </div>
                  )}
                  <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>Teardown: {money(pqTdCost)} &nbsp;·&nbsp; Total: {money(pqSetupCost+pqTestCost+pqTdCost)}</div>
                </>
              )}

              {pqViewMode === "crr" && (
                <PqCrrView
                  crrWorkup={crrWorkup}
                  pqCalc={pqCalc}
                  setPqCalc={setPqCalc}
                  pqRate={pqRate}
                  ti={ti}/>
              )}

              <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
                {pqCalc.rows&&Object.entries(pqCalc.rows).some(([k,v])=>v&&k.startsWith("B"))&&onExportPq300b&&(
                  <button onClick={()=>onExportPq300b(pqCalc)}
                    style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"none",background:"#154360",color:"#fff",cursor:"pointer",fontWeight:600}}>
                    Export PQ 300B Spec PDF
                  </button>
                )}
                {pqCalc.rows&&Object.entries(pqCalc.rows).some(([k,v])=>v&&!k.startsWith("B"))&&onExportPq300p1&&(
                  <button onClick={()=>onExportPq300p1(pqCalc)}
                    style={{fontSize:11,padding:"5px 12px",borderRadius:6,border:"none",background:"#1a3a4a",color:"#fff",cursor:"pointer",fontWeight:600}}>
                    Export PQ 300 Part 1 Spec PDF
                  </button>
                )}
              </div>
            </div>
          )}

          {/* DC Magnetics Tab */}
          {tab==="dcm"&&(
            <div>
              {/* View toggle: Computed (NUForce calc) vs CRR Workup */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:10,color:"#6b7a8d",fontWeight:600,letterSpacing:.4,textTransform:"uppercase"}}>View:</span>
                <div style={{display:"inline-flex",border:"1px solid #d0d7de",borderRadius:6,overflow:"hidden"}}>
                  <button onClick={()=>setDcmViewMode("computed")}
                    style={{fontSize:10,fontWeight:dcmViewMode==="computed"?700:400,padding:"4px 10px",
                      border:"none",
                      background:dcmViewMode==="computed"?"#1a2332":"#fff",
                      color:dcmViewMode==="computed"?"#fff":"#6b7a8d",cursor:"pointer"}}>
                    Computed
                  </button>
                  <button onClick={()=>setDcmViewMode("crr")}
                    style={{fontSize:10,fontWeight:dcmViewMode==="crr"?700:400,padding:"4px 10px",
                      border:"none",borderLeft:"1px solid #d0d7de",
                      background:dcmViewMode==="crr"?"#1a2332":"#fff",
                      color:dcmViewMode==="crr"?"#fff":"#6b7a8d",cursor:"pointer",
                      display:"inline-flex",alignItems:"center",gap:5}}>
                    CRR Workup
                    {crrWorkup && crrWorkup !== false && (
                      <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",
                        background:"#22c55e",flexShrink:0}}/>
                    )}
                  </button>
                </div>
              </div>

              {dcmViewMode === "computed" && (
                <>
                  {/* "Include in spec output" — signals to Spec Builder from Quote
                      that this quote covers DC Mag. Unchecked by default so DC Mag
                      doesn't leak into specs for quotes that don't use it. */}
                  <div style={{marginBottom:8,padding:"6px 10px",background:"#f0f4f7",borderRadius:6,
                    display:"flex",alignItems:"center",gap:8}}>
                    <input type="checkbox" id="dcmIncludeCb"
                      checked={!!dcmCalc.include}
                      onChange={e=>setDcmCalc(s=>({...s,include:e.target.checked}))}
                      style={{cursor:"pointer"}}/>
                    <label htmlFor="dcmIncludeCb"
                      style={{fontSize:11,fontWeight:600,color:"#1a2332",cursor:"pointer"}}>
                      Include DC Magnetics in spec output
                    </label>
                  </div>
                  <CalcRow2 label="Spec"><input value={dcmCalc.spec} onChange={e=>setDcmCalc(s=>({...s,spec:e.target.value}))}
                    style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #d0d7de",width:200}}/></CalcRow2>
                  <CalcRow2 label="Shift Rate ($)"><CalcInp value={dcmCalc.rate} onChange={v=>setDcmCalc(s=>({...s,rate:v}))}/></CalcRow2>
                  <CalcRow2 label="Setup Shifts"><CalcInp value={dcmCalc.setupShifts} onChange={v=>setDcmCalc(s=>({...s,setupShifts:v}))}/></CalcRow2>
                  <CalcRow2 label="Testing Shifts"><CalcInp value={dcmCalc.testShifts} onChange={v=>setDcmCalc(s=>({...s,testShifts:v}))}/></CalcRow2>
                  <CalcRow2 label="PIA"><CalcInp value={String(dcmCalc.pia)} onChange={v=>setDcmCalc(s=>({...s,pia:parseFloat(v)||1}))} width={50}/></CalcRow2>
                  <CalcResult setupAmt={dcmSetupCost} testAmt={dcmTestCost}/>
                  <div style={{marginTop:6,fontSize:10,color:"#6b7a8d"}}>Total: {money(dcmTotal)}</div>
                </>
              )}

              {dcmViewMode === "crr" && (
                <DcmCrrView
                  crrWorkup={crrWorkup}
                  dcmCalc={dcmCalc}
                  setDcmCalc={setDcmCalc}
                  dcmRate={dcmRate}/>
              )}
            </div>
          )}

          {/* Instrumentation */}
          {tab==="instr"&&(
            <div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {INSTR_ITEMS.map(item=>(
                  <div key={item.key} style={{display:"flex",alignItems:"center",gap:8,
                    padding:"6px 10px",borderRadius:7,
                    background:instr[item.key]?"#eaf2ff":"#f8f9fb",
                    border:"1px solid "+(instr[item.key]?"#1a5276":"#e8ecf0")}}>
                    <input type="checkbox" checked={instr[item.key]}
                      onChange={e=>setInstr(prev=>({...prev,[item.key]:e.target.checked}))}
                      style={{cursor:"pointer"}}/>
                    <span style={{fontSize:11,color:"#1a2332",flex:1,fontWeight:instr[item.key]?600:400}}>
                      {item.label}
                    </span>
                    <span style={{fontSize:10,color:"#9aa5b1"}}>${item.price}/ch</span>
                    {instr[item.key]&&(
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:"#6b7a8d"}}>Channels:</span>
                        <input type="number" min="1" value={instr[item.chKey]}
                          onChange={e=>setInstr(prev=>({...prev,[item.chKey]:e.target.value}))}
                          style={{width:45,fontSize:11,padding:"2px 4px",borderRadius:5,
                            border:"1px solid #1a5276",textAlign:"center"}}/>
                        <span style={{fontSize:11,fontWeight:600,color:"#1a5276",minWidth:55,textAlign:"right"}}>
                          {money(item.price*sf(instr[item.chKey],1))}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {/* HSV */}
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,
                  background:instr.hsv?"#eaf2ff":"#f8f9fb",
                  border:"1px solid "+(instr.hsv?"#1a5276":"#e8ecf0")}}>
                  <input type="checkbox" checked={instr.hsv}
                    onChange={e=>setInstr(prev=>({...prev,hsv:e.target.checked}))}
                    style={{cursor:"pointer"}}/>
                  <span style={{fontSize:11,color:"#1a2332",flex:1,fontWeight:instr.hsv?600:400}}>
                    High Speed Video
                  </span>
                  <span style={{fontSize:10,color:"#9aa5b1"}}>flat rate</span>
                  {instr.hsv&&<span style={{fontSize:11,fontWeight:600,color:"#1a5276",minWidth:55,textAlign:"right"}}>{money(1950)}</span>}
                </div>
              </div>
              {instrTotal>0&&(
                <div style={{marginTop:12,padding:"10px 12px",background:"#1a2332",borderRadius:8,
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",letterSpacing:1}}>SUGGESTED INSTRUMENTATION</span>
                  <span style={{fontSize:16,fontWeight:700,color:"#5dade2",fontFamily:"monospace"}}>{money(instrTotal)}</span>
                </div>
              )}
            </div>
          )}
          {/* Overtime */}
          {tab==="ot"&&(
            <div>
              <div style={{fontSize:9,color:"#9aa5b1",marginBottom:8}}>
                ↳ Weekday: $300 min call + $262.50/tech/hr · Weekend: $825 min call + $350/tech/hr
              </div>
              {otRows.map((r,i)=>{
                const rowTotal=calcOtRow(r);
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
                    padding:"8px 10px",marginBottom:6,borderRadius:7,background:"#f8f9fb",border:"1px solid #e8ecf0"}}>
                    <CalcSel value={r.type} width={100}
                      onChange={v=>setOtRows(rows=>rows.map((x,j)=>j===i?{...x,type:v}:x))}
                      options={["Weekday","Weekend"]}/>
                    <span style={{fontSize:10,color:"#6b7a8d"}}>Techs</span>
                    <CalcInp value={r.techs} width={45}
                      onChange={v=>setOtRows(rows=>rows.map((x,j)=>j===i?{...x,techs:v}:x))}/>
                    <span style={{fontSize:10,color:"#6b7a8d"}}>Hours</span>
                    <CalcInp value={r.hours} width={45}
                      onChange={v=>setOtRows(rows=>rows.map((x,j)=>j===i?{...x,hours:v}:x))}/>
                    <span style={{fontSize:11,fontWeight:600,color:"#1a5276",marginLeft:"auto"}}>{money(rowTotal)}</span>
                    {otRows.length>1&&(
                      <button onClick={()=>setOtRows(rows=>rows.filter((_,j)=>j!==i))}
                        style={{background:"none",border:"none",color:"#9aa5b1",cursor:"pointer",fontSize:14,padding:"0 4px"}}>✕</button>
                    )}
                  </div>
                );
              })}
              <button onClick={()=>setOtRows(rows=>[...rows,{type:"Weekday",techs:"1",hours:"0"}])}
                style={{background:"none",border:"1px dashed #d0d7de",borderRadius:7,
                  color:"#6b7a8d",padding:"7px 14px",cursor:"pointer",fontSize:11,width:"100%",marginBottom:4}}>
                + Add Overtime Row
              </button>
              {otTotal>0&&(
                <div style={{marginTop:12,padding:"10px 12px",background:"#1a2332",borderRadius:8,
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,0.5)",letterSpacing:1}}>SUGGESTED OVERTIME</span>
                  <span style={{fontSize:16,fontWeight:700,color:"#5dade2",fontFamily:"monospace"}}>{money(otTotal)}</span>
                </div>
              )}
            </div>
          )}
          <div style={{marginTop:10,fontSize:9,color:"#c0c8d0",fontStyle:"italic"}}>
            These are suggested prices only and do not affect the quote.
          </div>
        </div>
      )}

      {/* Customer Questions modal — editable list of EMI info-gathering
          questions to send to a customer. Renders as a floating overlay so
          it's independent of which calc tab is active. */}
      {customerQModalOpen && (
        <div onClick={()=>setCustomerQModalOpen(false)}
          style={{position:"fixed",top:0,left:0,right:0,bottom:0,
            background:"rgba(0,0,0,0.5)",zIndex:1000,
            display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#fff",borderRadius:10,maxWidth:820,width:"100%",
              maxHeight:"90vh",display:"flex",flexDirection:"column",
              boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
            {/* Header */}
            <div style={{padding:"14px 18px",borderBottom:"1px solid #e0e4ea",
              display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#1a2332"}}>Customer Questions — EMI</div>
                <div style={{fontSize:11,color:"#6b7a8d",marginTop:2}}>
                  Edit as needed for this customer, then copy to your email
                </div>
              </div>
              <button onClick={()=>setCustomerQModalOpen(false)}
                style={{background:"none",border:"none",fontSize:20,color:"#6b7a8d",cursor:"pointer",padding:"0 6px",lineHeight:1}}>×</button>
            </div>
            {/* Body */}
            <div style={{padding:"14px 18px",flex:1,overflow:"auto"}}>
              <textarea value={customerQText}
                onChange={e=>{setCustomerQText(e.target.value);setCustomerQCopiedMsg("");}}
                style={{width:"100%",minHeight:"55vh",fontSize:12,fontFamily:"system-ui,sans-serif",
                  padding:12,borderRadius:6,border:"1px solid #d0d7de",
                  resize:"vertical",boxSizing:"border-box",lineHeight:1.5,color:"#1a2332"}}/>
            </div>
            {/* Footer */}
            <div style={{padding:"12px 18px",borderTop:"1px solid #e0e4ea",
              display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>{
                if(confirm("Reset to the default questions? Any edits you've made will be lost."))
                  {setCustomerQText(EMI_CUSTOMER_QUESTIONS_DEFAULT);setCustomerQCopiedMsg("");}
              }}
                style={{fontSize:11,padding:"6px 14px",borderRadius:6,
                  border:"1px solid #d0d7de",background:"#fff",color:"#6b7a8d",cursor:"pointer",fontWeight:500}}>
                Reset to default
              </button>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {customerQCopiedMsg && <span style={{fontSize:11,color:"#166534",fontWeight:600}}>{customerQCopiedMsg}</span>}
                <button onClick={()=>{
                  navigator.clipboard.writeText(customerQText)
                    .then(()=>setCustomerQCopiedMsg("Copied to clipboard"))
                    .catch(()=>setCustomerQCopiedMsg("Copy failed — select and Ctrl+C"));
                }}
                  style={{fontSize:11,padding:"6px 16px",borderRadius:6,
                    border:"none",background:"#1a2332",color:"#fff",cursor:"pointer",fontWeight:600}}>
                  Copy to clipboard
                </button>
                <button onClick={()=>setCustomerQModalOpen(false)}
                  style={{fontSize:11,padding:"6px 14px",borderRadius:6,
                    border:"1px solid #d0d7de",background:"#fff",color:"#1a2332",cursor:"pointer",fontWeight:500}}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── V2 Product Picker ─────────────────────────────────────────────────────────
function ProductPicker({onAdd, onClose, setup, ti, vibs, hfvs, summary}){
  const [selected, setSelected] = useState({}); // {productKey: qty}
  const [thDur, setThDur] = useState("0 to 1 Day");
  const [sortMode, setSortMode] = useState("code"); // "code" | "name"
  // Custom-line-item slot. Mirrors the Custom Line Items section's PCODE_OPTS
  // and field shape (pcode/label/price). When `on` is true, handleAdd pushes
  // one line built from these fields, then resets.
  const [customItem, setCustomItem] = useState({on:false, pcode:"94", label:"", price:""});
  // Same product-code list the Custom Line Items section uses (CustomForm).
  // Kept identical here so quoter sees the same options in both spots.
  const PCODE_OPTS=[
    {code:"11",label:"Noise"},{code:"12",label:"AB/SB Noise"},
    {code:"32",label:"High Speed Video"},{code:"33",label:"Instrumentation"},
    {code:"41",label:"Report/CoC"},{code:"42",label:"Procedure"},
    {code:"43",label:"EMI Report"},{code:"43",label:"DC Mag Report"},{code:"43",label:"PQ Report"},
    {code:"44",label:"EMI Procedure"},{code:"44",label:"DC Mag Procedure"},{code:"44",label:"PQ Procedure"},
    {code:"51",label:"EMI"},{code:"51",label:"Power Quality"},{code:"51",label:"DC Magnetics"},{code:"52",label:"HFV/Shock Other"},
    {code:"53",label:"T&H"},{code:"54",label:"ESS"},{code:"55",label:"Salt Fog"},
    {code:"56",label:"Altitude"},{code:"57",label:"Acceleration"},{code:"58",label:"Drip/Sub/Spray"},
    {code:"59",label:"Insulation Resistance"},
    {code:"91",label:"MW Shock"},{code:"92",label:"LW Shock"},{code:"93",label:"Inclination"},
    {code:"94",label:"Vibration"},{code:"95",label:"Hydrostatic"},{code:"96",label:"Tear Down"},
    {code:"98",label:"Subcontract"},
  ];


  // Smart pricing helpers
  const techRate = sf(setup?.techRate,175);
  const fabHours = sf(setup?.fabHours,4);
  const holes = sf(setup?.holes,0);
  const drillTap = setup?.drillTap||false;
  const drillCost = holes*0.5*techRate*(drillTap?1.5:1);
  const fabCost = fabHours*techRate;
  const smartSetup = Math.round(900 + drillCost + fabCost); // base 900 + fab + drill
  const hfvOn = hfvs?.some(s=>s.on)||false;
  const vibSetupAmt = Math.round(sf(vibs?.[0]?.stdSetup||900)+drillCost+fabCost);

  // T&H prices
  const TH_PRICES = {"0 to 1 Day":1000,"3 Days":1350,"5 Days":1875,"7 Days":2275,"10 Days":2950};

  // Weight-based shock testing
  const wt = sf(ti?.wt,0);
  const mwsTest = wt>0 ? (wt<=200?3975:wt<=500?4575:wt<=1000?5275:5975) : 4575;



  const PRODUCTS = [
    // Vibration
    {key:"vib_setup",cat:"Vibration",label:"Vibration – Setup",code:"94",price:smartSetup,smart:true},
    {key:"vib_test",cat:"Vibration",label:"Vibration – Testing",code:"94",price:3250},
    // Medium Weight Shock
    {key:"mws_setup",cat:"Medium Weight Shock",label:"Medium Weight Shock – Setup",code:"91",price:Math.round(1500+drillCost+fabCost),smart:true},
    {key:"mws_test",cat:"Medium Weight Shock",label:"Medium Weight Shock – Testing",code:"91",price:mwsTest,smart:wt>0},
    // Lightweight Shock
    {key:"lws_setup",cat:"Lightweight Shock",label:"Lightweight Shock – Setup",code:"92",price:Math.round(900+drillCost+fabCost),smart:true},
    {key:"lws_test",cat:"Lightweight Shock",label:"Lightweight Shock – Testing",code:"92",price:1450},
    // HF Vibration
    {key:"hfv_setup",cat:"HF Vibration",label:"HF Vibration – Setup",code:"52",price:Math.round(500+drillCost+fabCost),smart:true},
    {key:"hfv_test",cat:"HF Vibration",label:"HF Vibration – Testing",code:"52",price:1225},
    // Shock Other
    {key:"sho_setup",cat:"Shock (Other)",label:"Shock (Other) – Setup",code:"52",price:hfvOn?Math.round((500+drillCost+fabCost)*0.75):Math.round(500+drillCost+fabCost),smart:true},
    {key:"sho_test",cat:"Shock (Other)",label:"Shock (Other) – Testing",code:"52",price:1250},
    // Temp & Humidity
    {key:"th_setup",cat:"Temp & Humidity",label:"Temperature & Humidity – Setup",code:"53",price:500},
    {key:"th_test",cat:"Temp & Humidity",label:"Temperature & Humidity – Testing",code:"53",price:TH_PRICES[thDur]||1000,smart:true},
    {key:"to_setup",cat:"Temp & Humidity",label:"Temperature Only – Setup",code:"53",price:500},
    {key:"to_test",cat:"Temp & Humidity",label:"Temperature Only – Testing",code:"53",price:TH_PRICES[thDur]||1000,smart:true},
    {key:"hu_setup",cat:"Temp & Humidity",label:"Humidity Only – Setup",code:"53",price:500},
    {key:"hu_test",cat:"Temp & Humidity",label:"Humidity Only – Testing",code:"53",price:TH_PRICES[thDur]||1000,smart:true},
    // ESS
    {key:"ess_setup",cat:"ESS",label:"ESS – Setup",code:"54",price:500},
    {key:"ess_test",cat:"ESS",label:"ESS – Testing",code:"54",price:1000},
    // Salt Fog
    {key:"sf_setup",cat:"Salt Fog",label:"Salt Fog – Setup",code:"55",price:500},
    {key:"sf_test",cat:"Salt Fog",label:"Salt Fog – Testing",code:"55",price:1750},
    // Altitude
    {key:"alt_setup",cat:"Altitude",label:"Altitude – Setup",code:"56",price:500},
    {key:"alt_test",cat:"Altitude",label:"Altitude – Testing",code:"56",price:1000},
    // Rapid Decompression
    {key:"rd_setup",cat:"Rapid Decompression",label:"Rapid Decompression – Setup",code:"56",price:1000},
    {key:"rd_test",cat:"Rapid Decompression",label:"Rapid Decompression – Testing",code:"56",price:2275},
    // Explosive Decompression
    {key:"ed_setup",cat:"Explosive Decompression",label:"Explosive Decompression – Setup",code:"56",price:1250},
    {key:"ed_test",cat:"Explosive Decompression",label:"Explosive Decompression – Testing",code:"56",price:2450},
    // Acceleration
    {key:"acc_setup",cat:"Acceleration",label:"Acceleration – Setup",code:"57",price:2000},
    {key:"acc_test",cat:"Acceleration",label:"Acceleration – Testing",code:"57",price:1950},
    // Inclination
    {key:"incl_setup",cat:"Inclination",label:"Inclination – Setup",code:"93",price:1250},
    {key:"incl_test",cat:"Inclination",label:"Inclination – Testing",code:"93",price:1750},
    // Drip
    {key:"drip_setup",cat:"Drip Test",label:"Drip Test – Setup",code:"58",price:500},
    {key:"drip_test",cat:"Drip Test",label:"Drip Test – Testing",code:"58",price:750},
    // Submergence
    {key:"sub_setup",cat:"Submergence",label:"Submergence – Setup",code:"58",price:500},
    {key:"sub_test",cat:"Submergence",label:"Submergence – Testing",code:"58",price:750},
    // Spray
    {key:"spray_setup",cat:"Spray Test",label:"Spray Test – Setup",code:"58",price:1250},
    {key:"spray_test",cat:"Spray Test",label:"Spray Test – Testing",code:"58",price:1250},
    // Insulation Resistance
    {key:"insres",cat:"Insulation Resistance",label:"Insulation Resistance & Dielectric Strength",code:"59",price:500},
    // Noise
    {key:"noise_setup",cat:"Noise Susceptibility",label:"Noise Susceptibility – Setup",code:"11",price:1000},
    {key:"noise_test",cat:"Noise Susceptibility",label:"Noise Susceptibility – Testing",code:"11",price:3950},
    // Airborne
    {key:"ab_setup",cat:"Airborne Noise",label:"Airborne Noise – Setup",code:"12",price:Math.round(1000+drillCost+fabCost),smart:true},
    {key:"ab_test",cat:"Airborne Noise",label:"Airborne Noise – Testing",code:"12",price:2850},
    // Structureborne
    {key:"sb_setup",cat:"Structureborne Noise",label:"Structureborne Noise – Setup",code:"12",price:Math.round(850+drillCost+fabCost),smart:true},
    {key:"sb_test",cat:"Structureborne Noise",label:"Structureborne Noise – Testing",code:"12",price:2650},
    // Hydrostatic
    {key:"hydro_pre",cat:"Hydrostatic",label:"Pre-Test Hydrostatic",code:"95",price:500},
    {key:"hydro_post",cat:"Hydrostatic",label:"Post-Test Hydrostatic",code:"95",price:500},
    {key:"hydro_both",cat:"Hydrostatic",label:"Post & Pre-Test Hydrostatic",code:"95",price:1000},
    // Procedures & Reports
    {key:"proc",cat:"Procedures & Reports",label:"Test Procedure",code:"42",price:1750},
    {key:"rep",cat:"Procedures & Reports",label:"Test Report",code:"41",price:1050},
    {key:"coc",cat:"Procedures & Reports",label:"Certificate of Compliance",code:"41",price:250},
    {key:"modal_analysis",cat:"Procedures & Reports",label:"Modal Analysis",code:"67",price:6750},
    {key:"fixture_drawing",cat:"Procedures & Reports",label:"Test Fixture Drawings",code:"42",price:2950},
    // High Speed Video
    {key:"shock_inst",cat:"Instrumentation",label:"Instrumentation (Shock)",code:"33",price:525},
    {key:"cm_shock",cat:"Instrumentation",label:"Contact Monitoring (Shock)",code:"33",price:350},
    {key:"vib_ch",cat:"Instrumentation",label:"Instrumentation (Vibration)",code:"33",price:325},
    {key:"cm_vib",cat:"Instrumentation",label:"Contact Monitoring (Vibe)",code:"33",price:750},
    {key:"hsv",cat:"Instrumentation",label:"High Speed Video",code:"32",price:1950},
    // Tear Down
    {key:"td",cat:"Other",label:"Tear Down",code:"96",price:750},
    // EMI
    {key:"emi_setup",cat:"EMI",label:"EMI – Setup",code:"51",price:0,custom:true},
    {key:"emi_test",cat:"EMI",label:"EMI – Testing",code:"51",price:0,custom:true},
    {key:"emi_td",cat:"EMI",label:"EMI – Teardown",code:"51",price:0,custom:true},
    {key:"emi_proc",cat:"EMI",label:"EMI Procedure",code:"44",price:3425},
    {key:"emi_rep",cat:"EMI",label:"EMI Report",code:"43",price:2850},
    // PQ
    {key:"pq_setup",cat:"Power Quality",label:"PQ – Setup",code:"51",price:0,custom:true},
    {key:"pq_test",cat:"Power Quality",label:"PQ – Testing",code:"51",price:0,custom:true},
    {key:"pq_td",cat:"Power Quality",label:"PQ – Teardown",code:"51",price:0,custom:true},
    {key:"pq_proc",cat:"Power Quality",label:"PQ Procedure",code:"44",price:2925},
    {key:"pq_rep",cat:"Power Quality",label:"PQ Report",code:"43",price:2450},
    // DC Magnetics
    {key:"dcm_setup",cat:"DC Magnetics",label:"DC Magnetics – Setup",code:"51",price:0,custom:true},
    {key:"dcm_test",cat:"DC Magnetics",label:"DC Magnetics – Testing",code:"51",price:0,custom:true},
    {key:"dcm_td",cat:"DC Magnetics",label:"DC Magnetics – Teardown",code:"51",price:0,custom:true},
    {key:"dcm_proc",cat:"DC Magnetics",label:"DC Mag Procedure",code:"44",price:1950},
    {key:"dcm_rep",cat:"DC Magnetics",label:"DC Mag Report",code:"43",price:1500},
    // Subcontracting
    {key:"sub_item",cat:"Other",label:"Subcontracting",code:"98",price:0,custom:true},
  ];

  // Sort products — by code (numeric, then label) or by label
  const sortedProducts = [...PRODUCTS].sort((a,b)=>{
    if(sortMode==="name"){
      const cmp = a.label.localeCompare(b.label);
      if(cmp!==0) return cmp;
      // tiebreak by code
      return (parseInt(a.code)||0)-(parseInt(b.code)||0);
    }
    const codeA = parseInt(a.code)||0;
    const codeB = parseInt(b.code)||0;
    if(codeA!==codeB) return codeA-codeB;
    return a.label.localeCompare(b.label);
  });

  const toggle = (key) => {
    setSelected(prev => {
      if(prev[key]) { const n={...prev}; delete n[key]; return n; }
      return {...prev, [key]:1};
    });
  };

  const setQty = (key,val) => {
    const n = parseInt(val)||1;
    setSelected(prev=>({...prev,[key]:Math.max(1,n)}));
  };

  const handleAdd = () => {
    const lines = [];

    Object.entries(selected).forEach(([key,qty])=>{
      const prod = PRODUCTS.find(p=>p.key===key);
      if(!prod) return;
      for(let i=0;i<qty;i++){
        lines.push({label:prod.label,code:prod.code,price:prod.price,desc:""});
      }
    });
    // Custom one-off line item. Skip silently if both label and price are empty
    // (same convention as collectQuoteLineItems for picker/summary/custom).
    if (customItem.on) {
      const lbl = customItem.label.trim();
      const prc = parseFloat(customItem.price) || 0;
      if (lbl || prc) {
        lines.push({ label: lbl || "Custom Item", code: customItem.pcode || "94", price: prc, desc: "" });
      }
    }
    if(lines.length>0) onAdd(lines);
    onClose();
  };

  // selCount drives the footer enable/disable state. Counts the toggled custom
  // item too, regardless of whether its fields are filled in — that's a soft
  // signal "you're going to add something custom"; handleAdd filters empty.
  const selCount = Object.keys(selected).length + (customItem.on ? 1 : 0);

  return (
    <div style={{position:"fixed",inset:0,zIndex:2000,display:"flex",alignItems:"flex-start",justifyContent:"center",background:"rgba(0,0,0,0.4)",overflowY:"auto",padding:"20px 0"}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(700px,96vw)",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",fontFamily:"Segoe UI,system-ui,sans-serif"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid #e8ecf0",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#1a2332",borderRadius:"12px 12px 0 0"}}>
          <div style={{color:"#fff",fontWeight:700,fontSize:15,letterSpacing:.3}}>+ Add Line Items</div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:"rgba(255,255,255,0.6)",fontSize:10,fontWeight:600,letterSpacing:.5}}>SORT:</span>
              <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:"1px solid rgba(255,255,255,0.2)"}}>
                <button onClick={()=>setSortMode("code")}
                  style={{background:sortMode==="code"?"#fff":"transparent",
                    color:sortMode==="code"?"#1a2332":"rgba(255,255,255,0.7)",
                    border:"none",padding:"4px 10px",fontSize:10,fontWeight:600,cursor:"pointer",letterSpacing:.3}}>
                  CODE
                </button>
                <button onClick={()=>setSortMode("name")}
                  style={{background:sortMode==="name"?"#fff":"transparent",
                    color:sortMode==="name"?"#1a2332":"rgba(255,255,255,0.7)",
                    border:"none",padding:"4px 10px",fontSize:10,fontWeight:600,cursor:"pointer",letterSpacing:.3}}>
                  NAME
                </button>
              </div>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.7)",fontSize:18,cursor:"pointer",padding:"0 4px"}}>✕</button>
          </div>
        </div>

        {/* T&H duration selector — shown when T&H items selected */}
        {Object.keys(selected).some(k=>k.startsWith("th_")||k.startsWith("to_")||k.startsWith("hu_"))&&(
          <div style={{padding:"10px 20px",background:"#f8f9fb",borderBottom:"1px solid #e8ecf0",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:11,color:"#6b7a8d",fontWeight:600}}>T&H Duration:</span>
            <select value={thDur} onChange={e=>setThDur(e.target.value)}
              style={{fontSize:11,padding:"4px 8px",borderRadius:6,border:"1px solid #d0d7de",background:"#fff"}}>
              {Object.entries(TH_PRICES).map(([k,v])=>(
                <option key={k} value={k}>{k} — ${v.toLocaleString()}</option>
              ))}
            </select>
          </div>
        )}

        {/* Products — flat list sorted by code */}
        <div style={{padding:"12px 20px",maxHeight:"55vh",overflowY:"auto"}}>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {sortedProducts.map(prod=>{
              const isSel = !!selected[prod.key];
              return(
                <div key={prod.key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:7,
                  background:isSel?"#eaf2ff":"#f8f9fb",border:"1px solid "+(isSel?"#1a5276":"#e8ecf0"),
                  cursor:"pointer",transition:"all 0.1s"}}
                  onClick={()=>toggle(prod.key)}>
                  <div style={{width:16,height:16,borderRadius:4,border:"2px solid "+(isSel?"#1a5276":"#d0d7de"),
                    background:isSel?"#1a5276":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {isSel&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                  </div>
                  <span style={{fontSize:10,color:"#9aa5b1",minWidth:22,fontFamily:"monospace"}}>{prod.code}</span>
                  <span style={{flex:1,fontSize:12,color:"#1a2332",fontWeight:isSel?600:400}}>{prod.label}</span>
                  {isSel&&(
                    <div style={{display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
                      <span style={{fontSize:10,color:"#6b7a8d"}}>qty:</span>
                      <input type="number" min="1" max="20" value={selected[prod.key]}
                        onChange={e=>setQty(prod.key,e.target.value)}
                        style={{width:40,fontSize:11,padding:"2px 4px",borderRadius:5,border:"1px solid #1a5276",textAlign:"center"}}/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom line item — one-off slot for a quoter-defined entry.
              Visually separated from the fixed product list because it
              behaves differently (user types code/label/price). */}
          <div style={{marginTop:14,paddingTop:10,borderTop:"1px dashed #d0d7de"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:7,
              background:customItem.on?"#eaf2ff":"#f8f9fb",
              border:"1px solid "+(customItem.on?"#1a5276":"#e8ecf0"),
              cursor:"pointer",transition:"all 0.1s"}}
              onClick={()=>setCustomItem(prev=>({...prev,on:!prev.on}))}>
              <div style={{width:16,height:16,borderRadius:4,
                border:"2px solid "+(customItem.on?"#1a5276":"#d0d7de"),
                background:customItem.on?"#1a5276":"#fff",
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {customItem.on&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontSize:10,color:"#9aa5b1",minWidth:22,fontFamily:"monospace"}}>—</span>
              <span style={{flex:1,fontSize:12,color:"#1a2332",fontWeight:customItem.on?600:400}}>
                Custom Line Item
              </span>
            </div>
            {customItem.on&&(
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 8px 4px 32px"}}
                onClick={e=>e.stopPropagation()}>
                <select value={customItem.pcode}
                  onChange={e=>setCustomItem(prev=>({...prev,pcode:e.target.value}))}
                  style={{fontSize:10,padding:"3px 5px",borderRadius:5,border:"1px solid #1a5276",
                    background:"#fff",color:"#1a2332",width:170}}>
                  {PCODE_OPTS.map(p=>(
                    <option key={p.code+"-"+p.label} value={p.code}>{p.code} – {p.label}</option>
                  ))}
                </select>
                <input type="text" value={customItem.label}
                  onChange={e=>setCustomItem(prev=>({...prev,label:e.target.value}))}
                  placeholder="Description (e.g. Specialized test setup)"
                  style={{flex:1,fontSize:11,padding:"3px 7px",borderRadius:5,
                    border:"1px solid #1a5276",background:"#fff",color:"#1a2332"}}/>
                <span style={{fontSize:11,color:"#6b7a8d"}}>$</span>
                <input type="text" value={customItem.price}
                  onChange={e=>setCustomItem(prev=>({...prev,price:e.target.value}))}
                  placeholder="0"
                  style={{width:70,fontSize:11,padding:"3px 7px",borderRadius:5,
                    border:"1px solid #1a5276",background:"#fff",color:"#1a2332",textAlign:"right"}}/>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={{padding:"12px 20px",borderTop:"1px solid #e8ecf0",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#f8f9fb",borderRadius:"0 0 12px 12px"}}>
          <span style={{fontSize:11,color:"#9aa5b1"}}>{selCount} item{selCount!==1?"s":""} selected</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:7,padding:"7px 16px",fontSize:12,cursor:"pointer",color:"#6b7a8d"}}>Cancel</button>
            <button onClick={handleAdd} disabled={selCount===0}
              style={{background:selCount===0?"#e8ecf0":"#1a2332",border:"none",borderRadius:7,padding:"7px 20px",
                fontSize:12,fontWeight:700,cursor:selCount===0?"default":"pointer",
                color:selCount===0?"#9aa5b1":"#fff",transition:"all 0.15s"}}>
              Add {selCount>0?selCount+" ":""}{selCount===1?"Item":"Items"} to Quote
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App({onLogout,currentUser}){
  const [qi,setQi]=useState({opp:"",account:"",billTo:"",billToCity:"",contact:"",email:"",prepby:"",rev:"",revDate:"",date:new Date().toLocaleDateString("en-US"),rfq:"",stage:"Proposal/Price Quote",type:"New Business",relatedOpps:""});
  const [ti,setTi]=useState({item:"",qty:"1",model:"",drawing:"",loads:null,dimL:"",dimW:"",dimH:"",wt:"",volt:"",pwrType:"AC",phase:"",hz:"",inrush:"",amps:"",mounting:"",pressureFlow:"",gsi:"Unknown",witness:"Unknown",docRestriction:"None",dpas:"",tiSpecs:"",tiNotes:""});

  // Multi-instance section state — arrays of instance objects
  const [vibs,setVibs]=useState([newVib()]);
  const [shocks,setShocks]=useState([newShock()]);
  const [noises,setNoises]=useState([newNoise()]);
  const [envs,setEnvs]=useState([newEnv()]);
  const [hfvs,setHfvs]=useState([newHfv()]);
  const [shos,setShos]=useState([newSho()]);
  const [dcms,setDcms]=useState([newDcm()]);
  const [pqs,setPqs]=useState([newPq()]);
  const [emis,setEmis]=useState([newEmi()]);

  // Single-instance sections
  const [inst,setInst]=useState({on:false,items:{}});
  const [ot,setOt]=useState({on:false,rows:[]});
  const [custom,setCustom]=useState({on:false,rows:[]});
  const [budget,setBudget]=useState({on:false,rows:[],markup:"25"});

  // ── Auto-add/update compressor budget rows when noise sections have a compressor ─
  useEffect(()=>{
    const COMP_COST_B={"<=140dB":0,"145dB":750,"150dB":1500,"155dB":1500,"160dB":1500,"165dB":2000,"170dB":3500};
    const noiseWithComp=noises.filter(s=>s.on&&((COMP_COST_B[s.level]||0)>0||sf(s.compBudget,0)>0));
    if(noiseWithComp.length===0)return;
    setBudget(prev=>{
      let rows=[...prev.rows];
      let changed=false;
      noiseWithComp.forEach((s,idx)=>{
        const pre=idx>0?" #"+(idx+1)+(s.identifier?" ("+s.identifier+")":""):"";
        const label="Noise"+pre+" – Testing";
        const desc="Compressor Rental"+(pre?", "+pre:"");
        const ac=COMP_COST_B[s.level]||0;
        const cost=String(sf(s.compBudget,0)>0?sf(s.compBudget,0):ac);
        if(sf(cost,0)<=0)return;
        const existIdx=rows.findIndex(r=>r.desc===desc);
        if(existIdx>=0){
          if(rows[existIdx].unitCost!==cost){
            rows=rows.map((r,i)=>i===existIdx?{...r,unitCost:cost}:r);
            changed=true;
          }
        } else {
          rows=[...rows,{desc,qty:"1",unitCost:cost,rollInto:label}];
          changed=true;
        }
      });
      return changed?{...prev,rows,on:true}:prev;
    });
  },[noises]); // eslint-disable-line react-hooks/exhaustive-deps
  const [coc,setCoc]=useState({on:false,price:"250"});
  const [sub,setSub]=useState({on:false,rows:[]});
  const [td,setTd]=useState("0");
  const [setup,setSetup]=useState({techRate:"175",fabHours:"4",holes:"0",cables:"0",drillTap:false});
  const [globalPR,setGlobalPR]=useState({procs:[],reps:[],coc:false,cocPrice:"250"});
  const [notes,setNotes]=useState("");
  const [lineOverrides,setLineOverrides]=useState({}); // {idx:{price,desc,deleted}}
  const [lineOrder,setLineOrder]=useState(null);
  const [unifiedOrder,setUnifiedOrder]=useState(null); // [{type:'auto'|'picker',idx}] // null=use default order; array of original indices when reordered
  const [dragIdx,setDragIdx]=useState(null);
  const dragFromRef=useRef(null);
  const dragToRef=useRef(null);
  const [abs,setAbs]=useState([newAb()]);
  const [sbs,setSbs]=useState([newSb()]);
  const [locked,setLocked]=useState(false);
  const [splitProcReport,setSplitProcReport]=useState(false);
  const [openQuotesPanel,setOpenQuotesPanel]=useState(false);
  const [openQuotesList,setOpenQuotesList]=useState([]);
  const [openQuotesLoading,setOpenQuotesLoading]=useState(false);
  const [dragOverId,setDragOverId]=useState(null);
  const dragRowId=useRef(null);
  const [modalAnalysis,setModalAnalysis]=useState({on:false,price:"6750"});
  const [fixtureDrawing,setFixtureDrawing]=useState({on:false,price:"2950"});
  const [inStockModal,setInStockModal]=useState({on:false,targetProc:""});
  // persist to saves
  const [savedQuotes,setSavedQuotes]=useState({});
  const [dashboardNeedsRefresh,setDashboardNeedsRefresh]=useState(false);

  // ── Approval system ────────────────────────────────────────────────────────
  const [approval,setApproval]=useState({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:"",history:[]});
  const [showApprovalHistory,setShowApprovalHistory]=useState(false);
  const [showFabGuide,setShowFabGuide]=useState(false);
  const [approvalComments,setApprovalComments]=useState("");

  const [showApprovalModal,setShowApprovalModal]=useState(false);
  const [showChatter,setShowChatter]=useState(false);
  const [quoteSentAt,setQuoteSentAt]=useState(null); // date string if this quote has been marked sent
  const [showSendConfirm,setShowSendConfirm]=useState(false);   // confirmation popup before marking sent
  const [showSentHistory,setShowSentHistory]=useState(false);   // modal listing every send event for this quote
  const [sentHistory,setSentHistory]=useState([]);              // rows: {sent_at, sent_by, id, voided}
  // Void confirmation: when approver clicks Void, this holds the row id awaiting
  // confirmation. Null means no confirmation pending. Cleared on confirm/cancel.
  const [voidConfirmId,setVoidConfirmId]=useState(null);
  const [voidBusy,setVoidBusy]=useState(false);
  const [sentBusy,setSentBusy]=useState(false);                 // disables the Send button during the insert
  const [showFollowUpPopover,setShowFollowUpPopover]=useState(false);
  const [showProductPicker,setShowProductPicker]=useState(false);
  const [pickerDragIdx,setPickerDragIdx]=useState(null);
  // Revision history modal
  const [showRevHistory,setShowRevHistory]=useState(false);
  const [revHistoryList,setRevHistoryList]=useState([]); // all rows for current opportunity
  const [revHistoryLoading,setRevHistoryLoading]=useState(false);
  const [revCompareFromId,setRevCompareFromId]=useState(null); // older revision id
  const [revCompareToId,setRevCompareToId]=useState(null);     // newer revision id (defaults to current)
  const [advancedModeOpen,setAdvancedModeOpen]=useState(false);
  const [pickerLines,setPickerLines]=useState([]); // lines added via product picker
  const [quoteFlag,setQuoteFlag]=useState(null);
  const [showFlagPopover,setShowFlagPopover]=useState(false);
  const [flagNote,setFlagNote]=useState("");
  const [flagLoading,setFlagLoading]=useState(false);
  const [isDirty,setIsDirty]=useState(false); // true when test selections changed since last save
  const [snapshot,setSnapshot]=useState(null); // frozen prices/specs/notes from last save
  const [followUpDate,setFollowUpDate]=useState("");
  const [chatterEntries,setChatterEntries]=useState([]);
  const [chatterInput,setChatterInput]=useState("");
  const [chatterSaving,setChatterSaving]=useState(false);
  const [wonInfo,setWonInfo]=useState({wonDate:"",jobNum:"",poNum:""});
  const [wonLocked,setWonLocked]=useState(false);
  // True after stage transitions TO Closed Won in this session — wonDate must be Confirmed before save.
  // Already-Closed-Won quotes loaded from DB skip this (no friction on routine edits).
  const [wonDatePending,setWonDatePending]=useState(false);
  const [showWonModal,setShowWonModal]=useState(false);
  const [showCloneModal,setShowCloneModal]=useState(false);
  const [cloneOppInput,setCloneOppInput]=useState("");
  const [currentQuoteId,setCurrentQuoteId]=useState(null);
  const [wonApproval,setWonApproval]=useState({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:""});
  // ── Workspace project linkage ──────────────────────────────────────────────
  const [workspaceProjectId,setWorkspaceProjectId]=useState(null);
  const [workspaceBusy,setWorkspaceBusy]=useState(false);
  // Job # as it was when the quote loaded (persisted value). Used to distinguish
  // a first-time Job # entry (→ Create Project) from a pre-existing Job # whose
  // project presumably already exists (→ Open in Workspace).
  const [loadedJobNum,setLoadedJobNum]=useState("");
  const [showAppendConfirm,setShowAppendConfirm]=useState(null); // null or {project_id, project_name, client_company, existing_task_count, new_task_count, new_expense_count}
  const [showClearLinkConfirm,setShowClearLinkConfirm]=useState(false);
  const [currentQuoteSource,setCurrentQuoteSource]=useState("nuforce");
  const [showDashboard,setShowDashboard]=useState(true);

  // ── Browser back/forward button support ──────────────────────────────────
  // Push a history entry whenever we switch between dashboard and quote form
  const navigateTo = (toDash) => {
    if(toDash){
      window.history.pushState({page:'dashboard'},'','#dashboard');
    } else {
      window.history.pushState({page:'quote'},'','#quote');
    }
    setShowDashboard(toDash);
  };
  useEffect(()=>{
    // Set initial history state
    window.history.replaceState({page:showDashboard?'dashboard':'quote'},'',
      showDashboard?'#dashboard':'#quote');
    const handlePop = (e) => {
      const page = e.state?.page;
      if(page==='dashboard') setShowDashboard(true);
      else if(page==='quote') setShowDashboard(false);
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  },[]);
  const recentSaveRef=useRef(0); // timestamp of last local save — suppresses self-triggered realtime toast
  const isLoadingRef=useRef(false); // true during handleLoad — suppresses isDirty during load
  const accountEditedRef=useRef(false); // true once the user types in the Account field this session; gates the require-account-link check on save
  const reloadOpenQuoteRef=useRef(null); // set after handleLoad is defined — used by realtime toast button
  const [toast,setToast]=useState(null); // {msg, type: 'success'|'error'|'info'}
  const toastTimer=useRef(null);
  const showToast=(msg,type="success",duration=3000)=>{
    clearTimeout(toastTimer.current);
    setToast({msg,type});
    toastTimer.current=setTimeout(()=>setToast(null),duration);
  };

  // ── Permissions ─────────────────────────────────────────────────────────
  // Approver rights are sourced from Workspace's permission model:
  //   employees.role_id → permission_roles.capabilities.nuforce_approve_quotes
  // Looked up once on app load via the direct-PostgREST bypass (consistent
  // with our other reads; supabase-js wedges on the same shared session).
  // The .or() on email + personal_email covers users whose session may carry
  // either their work or personal address.
  // Default false until the lookup resolves — failsafe: no approve UI flashes
  // before we know for sure.
  const [isApprover, setIsApprover] = useState(false);
  const [permsLoaded, setPermsLoaded] = useState(false);
  // Workspace employees.id for the current user — used to identify them in
  // notifications (Russ's send-notification edge function keys on this UUID,
  // not on email). Pulled by the same lookup that resolves approver perms.
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState(null);
  useEffect(()=>{
    let cancelled = false;
    (async()=>{
      if(!currentUser){ setPermsLoaded(true); return; }
      try {
        const safeUser = encodeURIComponent(currentUser);
        // Pull the employee row (id + role_id) by either email or personal_email
        const empRows = await restFetch("GET",
          `employees?select=id,role_id&or=(email.eq.${safeUser},personal_email.eq.${safeUser})&limit=1`);
        const emp = (empRows||[])[0];
        let canApprove = false;
        if(emp?.role_id){
          const roleRows = await restFetch("GET",
            `permission_roles?select=capabilities&id=eq.${encodeURIComponent(emp.role_id)}&limit=1`);
          const role = (roleRows||[])[0];
          canApprove = !!(role?.capabilities?.nuforce_approve_quotes);
        }
        if(!cancelled){
          setCurrentUserEmployeeId(emp?.id || null);
          setIsApprover(canApprove);
          setPermsLoaded(true);
        }
      } catch(e){
        // Fail closed: if the lookup errors (network, RLS, missing table),
        // treat the user as a non-approver until the issue is resolved.
        console.warn("[PERMS] approver lookup failed:", e?.message||e);
        if(!cancelled) setPermsLoaded(true);
      }
    })();
    return ()=>{ cancelled = true; };
  },[currentUser]);
  // Anyone in NUForce can follow up — no permission gating needed.
  const isFollowUpUser = true;
  const isSalesforce=currentQuoteSource==="salesforce";

  // ── Browser tab title + history state for back button ─────────────────────
  useEffect(()=>{
    const opp=qi.opp||"";
    const label=showDashboard?"Dashboard":opp?opp:"NUForce";
    document.title=label;
    // Push a history state so the browser back button works within the app
    const state={showDashboard, quoteId:currentQuoteId};
    const currentState=window.history.state;
    // Only push if the view actually changed (avoid duplicate entries)
    if(!currentState||currentState.showDashboard!==showDashboard||currentState.quoteId!==currentQuoteId){
      window.history.pushState(state,"",window.location.pathname);
    }
    // Set favicon
    const existing=document.querySelector("link[rel='icon']");
    const link=existing||document.createElement("link");
    link.rel="icon";
    link.type="image/png";
    link.href="data:image/png;base64,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";
    if(!existing)document.head.appendChild(link);
  },[qi.opp,showDashboard]);


  // ── Sync noise compBudget when level changes or quote loads ────────────────
  useEffect(()=>{
    const COMP_COST_EFF={"<=140dB":0,"145dB":750,"150dB":1500,"155dB":1500,"160dB":1500,"165dB":2000,"170dB":3500};
    const anyNeedsSync=noises.some(n=>{
      if(!n.on)return false;
      const ac=COMP_COST_EFF[n.level]||0;
      return ac>0&&(n.compBudget==="0"||!n.compBudget);
    });
    if(!anyNeedsSync)return;
    setNoises(prev=>prev.map(n=>{
      if(!n.on)return n;
      const ac=COMP_COST_EFF[n.level]||0;
      if(ac>0&&(n.compBudget==="0"||!n.compBudget)){
        return {...n,
          compBudget:String(ac),
          testing:String(noiseTestingPrice(n.durVal,n.durUnit,n.level,ac))
        };
      }
      return n;
    }));
  },[noises]); // watches all noise changes

  // ── Persist last open quote ID to localStorage ───────────────────────────
  // Only update localStorage when we have a real ID — don't clear it on null
  // Persist current quote ID so reopening the app reloads it
  // (clearing happens explicitly in handleNewQuote and handleDeleteQuote)
  // Note: localStorage keys are prefixed "vibrato_" for historical reasons (pre-NUForce rebrand).
  // We leave them as-is to avoid breaking existing user sessions.
  useEffect(()=>{
    if(currentQuoteId){
      localStorage.setItem("vibrato_last_quote_id",String(currentQuoteId));
      // Load sent status for this quote
      (async()=>{
        try {
          const rows = await restFetch("GET",
            `follow_ups?select=sent_at,sent_by&quote_id=eq.${encodeURIComponent(currentQuoteId)}&sent_by=neq.salesforce_import&or=(voided.is.null,voided.eq.false)&order=sent_at.desc&limit=1`);
          setQuoteSentAt((rows||[])[0]?.sent_at || null);
        } catch(e) {
          console.warn("[QUOTE-SENT-IND] failed:", e?.message||e);
        }
      })();
      // Load flag
      (async()=>{
        try {
          const rows = await restFetch("GET",
            `quote_flags?select=id,note,flagged_by,flagged_at&quote_id=eq.${encodeURIComponent(currentQuoteId)}&resolved=eq.false&limit=1`);
          const data = (rows||[])[0] || null;
          setQuoteFlag(data);
          setFlagNote(data?.note||"");
        } catch(e) {
          console.warn("[QUOTE-FLAG-LOAD] failed:", e?.message||e);
        }
      })();
    } else {
      setQuoteSentAt(null);
      setQuoteFlag(null);
      setFlagNote("");
    }
  },[currentQuoteId]);

  // ── Browser back/forward button handler ────────────────────────────────────
  useEffect(()=>{
    const onPop=(e)=>{
      const state=e.state;
      if(state&&typeof state.showDashboard==="boolean"){
        setShowDashboard(state.showDashboard);
      }
    };
    window.addEventListener("popstate",onPop);
    return ()=>window.removeEventListener("popstate",onPop);
  },[]);

  // ── Load saved quotes on startup + Supabase Realtime sync ──────────────────
  // Note: we only need pending-approval quotes in savedQuotes state (used by the
  // approval queue). loadPendingQuotes is bounded and fast; loadQuotesFromSupabase
  // (2-year scan) was timing out on the free-tier DB and isn't needed for any
  // active feature.
  useEffect(()=>{
    loadPendingQuotes().then(q=>setSavedQuotes(q));

    const channel=supabase
      .channel("quotes-realtime")
      .on("postgres_changes",
        {event:"*", schema:"public", table:"quotes"},
        (payload)=>{
          loadPendingQuotes().then(fresh=>{
            setSavedQuotes(prev=>{
              const cleaned={...prev};
              Object.entries(cleaned).forEach(([id,q])=>{
                const wasPending=q.approval?.status==="pending"||q.wonApproval?.status==="pending_won";
                if(wasPending&&!fresh[id])delete cleaned[id];
              });
              return {...cleaned,...fresh};
            });
          });
          setDashboardNeedsRefresh(prev=>prev||true);
          setCurrentQuoteId(prevId=>{
            if(prevId&&String(payload.new?.id)===String(prevId)){
              // Only show if this wasn't our own save (grace window of 5 seconds)
              const msSinceSave=Date.now()-recentSaveRef.current;
              if(msSinceSave>5000){
                showToast(
                  <span>
                    ⚠️ This quote was updated by another user.{" "}
                    <span
                      onClick={()=>reloadOpenQuoteRef.current&&reloadOpenQuoteRef.current(String(prevId))}
                      style={{textDecoration:"underline",cursor:"pointer",fontWeight:700}}>
                      Reload quote
                    </span>
                  </span>,
                  "info", 10000
                );
              }
            }
            return prevId;
          });
        }
      )
      .subscribe();

    return ()=>{ supabase.removeChannel(channel); };
  },[]);

  // ── Refresh pending quotes every time dashboard becomes visible ──────────────
  useEffect(()=>{
    if(showDashboard){
      setDashboardNeedsRefresh(false);
      loadPendingQuotes().then(fresh=>{
        setSavedQuotes(prev=>{
          // Remove any previously-pending quotes that are no longer pending,
          // then merge in the freshly fetched ones
          const cleaned={...prev};
          Object.entries(cleaned).forEach(([id,q])=>{
            const wasQueuePending=q.approval?.status==="pending";
            const wasWonPending=q.wonApproval?.status==="pending_won";
            const stillInFresh=fresh[id];
            if((wasQueuePending||wasWonPending)&&!stillInFresh){
              // Re-fetch this quote's current state from fresh data or drop it
              delete cleaned[id];
            }
          });
          return {...cleaned,...fresh};
        });
      });
    }
  },[showDashboard]);

  const handleSubmitApproval=async()=>{
    recentSaveRef.current=Date.now();
    const evt={event:"submitted",by:currentUser,at:new Date().toISOString(),comments:""};
    const newApproval={
      status:"pending",
      submittedBy:currentUser,
      submittedById:currentUserEmployeeId,  // Workspace employees.id for notifications
      submittedAt:new Date().toISOString(),
      decidedBy:"", decidedAt:"", comments:"",
      history:[...(approval.history||[]),evt],
    };
    setApproval(newApproval);
    setLocked(true);
    setShowApprovalModal(false);
    const snapshotLines=(summary.lines||[]).map((l,i)=>{
      const ov=lineOverrides[i]||{};
      if(ov.deleted)return null;
      return {...l, val: ov.price!==undefined ? sf(ov.price,0) : l.val};
    }).filter(Boolean);
    const savedSnapshot={
      lines: snapshotLines,
      total: displayTotal,
      tiSpecs: ti.tiSpecs||"",
      tiNotes: ti.tiNotes||"",
      savedAt: new Date().toISOString(),
    };
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval:newApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId,snapshot:savedSnapshot};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);setSnapshot(savedSnapshot);setIsDirty(false);showToast("Submitted for approval","info");}
    else showToast("Submit failed — check your connection","error",5000);
    // Notify approvers via Workspace. The payload is the FULL current set of
    // pending quotes (not just this one) so the email shows everyone's queue
    // depth. Each item only needs submittedById; Workspace resolves recipients
    // (approvers minus self-submitted) and composes the message.
    // Older pending quotes from before this deploy may lack submittedById —
    // we drop those rather than backfill on-the-fly. They age out as decisions
    // get made.
    try {
      const pendingForPayload = [
        ...pendingQuotes
          .filter(q => q.approval?.submittedById)
          .map(q => ({ submittedById: q.approval.submittedById })),
        // Include the quote just submitted (not yet in savedQuotes/pendingQuotes)
        ...(currentUserEmployeeId ? [{ submittedById: currentUserEmployeeId }] : []),
      ];
      await invokeFunction("send-notification", {
        type: "nuforce_quote_submitted",
        data: {
          pending: pendingForPayload,
          approvalsUrl: "https://nuforce.nulabs.com/#dashboard",
        },
      });
    } catch(e) {
      // Never block the user on a failed notification — log and move on.
      console.warn("[NOTIFY] quote_submitted failed:", e?.message||e);
    }
  };


  const autoUnflag = async (qid) => {
    if(!qid) return;
    try {
      await restFetch("PATCH",
        `quote_flags?quote_id=eq.${encodeURIComponent(qid)}&resolved=eq.false`,
        {body:{resolved:true,resolved_by:"auto_approval",resolved_at:new Date().toISOString()}});
    } catch(e){ console.warn("[AUTO-UNFLAG] failed:",e?.message||e); }
  };
  const handleApprove=async()=>{
    const evtA={event:"approved",by:currentUser,at:new Date().toISOString(),comments:approvalComments};
    const newApproval={...approval,status:"approved",decidedBy:currentUser,decidedAt:new Date().toISOString(),comments:approvalComments,history:[...(approval.history||[]),evtA]};
    setApproval(newApproval);
    setLocked(true);
    setApprovalComments("");
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval:newApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);showToast("Quote approved ✓","success");autoUnflag(newId);}
    else showToast("Save failed — check your connection","error",5000);
    // Event 2: notify the "send approved quotes" group that this is ready to send.
    // Best-effort — failure here doesn't block the user-visible approval.
    try {
      await invokeFunction("send-notification", {
        type: "nuforce_quote_approved",
        data: {
          opportunity:   qi.opp || "",
          customer:      qi.account || "",
          total:         money(displayTotal),
          approverName:  prettifyEmail(currentUser),
          submitterName: prettifyEmail(approval.submittedBy || ""),
          linkUrl:       "https://nuforce.nulabs.com/#dashboard",
        },
      });
    } catch(e) { console.warn("[NOTIFY] quote_approved failed:", e?.message||e); }
  };

  const handleReject=async()=>{
    const evtR={event:"rejected",by:currentUser,at:new Date().toISOString(),comments:approvalComments};
    const newApproval={...approval,status:"rejected",decidedBy:currentUser,decidedAt:new Date().toISOString(),comments:approvalComments,history:[...(approval.history||[]),evtR]};
    setApproval(newApproval);
    setLocked(false);
    setApprovalComments("");
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval:newApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);showToast("Quote rejected","info");}
    else showToast("Save failed — check your connection","error",5000);
    // No notification on rejection per spec — submitter sees it via the dashboard.
  };

  const handleApproverUnlock=()=>{
    setLocked(false);
  };

  // ── Closed Won Approval ──────────────────────────────────────────────────────
  const handleSubmitWonApproval=async(explicitStage)=>{
    recentSaveRef.current=Date.now();
    const newWonApproval={status:"pending_won",submittedBy:currentUser,submittedAt:new Date().toISOString(),decidedBy:"",decidedAt:"",comments:""};
    setWonApproval(newWonApproval);
    setLocked(true);
    const effectiveQi=explicitStage?{...qi,stage:explicitStage}:qi;
    const snapshotLines=(summary.lines||[]).map((l,i)=>{
      const ov=lineOverrides[i]||{};
      if(ov.deleted)return null;
      return {...l, val: ov.price!==undefined ? sf(ov.price,0) : l.val};
    }).filter(Boolean);
    const savedSnapshot={
      lines: snapshotLines,
      total: displayTotal,
      tiSpecs: ti.tiSpecs||"",
      tiNotes: ti.tiNotes||"",
      savedAt: new Date().toISOString(),
    };
    const q={id:currentQuoteId||undefined,opp:effectiveQi.opp,customer:effectiveQi.account,rfq:effectiveQi.rfq,total:displayTotal,
      qi:effectiveQi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval:newWonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId,snapshot:savedSnapshot};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);setSnapshot(savedSnapshot);setIsDirty(false);showToast("Submitted for Closed Won approval","info");}
    else showToast("Submit failed — check your connection","error",5000);
  };

  const handleWonApprove=async(comments)=>{
    const newWonApproval={...wonApproval,status:"won_approved",decidedBy:currentUser,decidedAt:new Date().toISOString(),comments:comments||""};
    setWonApproval(newWonApproval);
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval:newWonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);showToast("Closed Won approved ✓","success");}
    else showToast("Save failed — check your connection","error",5000);
  };

  const handleWonReject=async(comments)=>{
    const newWonApproval={...wonApproval,status:"won_rejected",decidedBy:currentUser,decidedAt:new Date().toISOString(),comments:comments||""};
    setWonApproval(newWonApproval);
    setLocked(false);
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval:newWonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
    if(newId){setCurrentQuoteId(newId);showToast("Closed Won rejected","info");}
    else showToast("Save failed — check your connection","error",5000);
  };

  // ── Approval Queue (approver dashboard) ──
  const [queueSelected,setQueueSelected]=useState(new Set());
  const [queueComments,setQueueComments]=useState("");

  const pendingQuoteApprovals=Object.values(savedQuotes).filter(q=>q.approval?.status==="pending")
    .sort((a,b)=>new Date(b.approval?.submittedAt||0)-new Date(a.approval?.submittedAt||0));
  const pendingWonApprovals=Object.values(savedQuotes).filter(q=>q.wonApproval?.status==="pending_won")
    .sort((a,b)=>new Date(b.wonApproval?.submittedAt||0)-new Date(a.wonApproval?.submittedAt||0));
  const pendingQuotes=[...pendingQuoteApprovals,...pendingWonApprovals];

  const handleQueueDecision=async(decision,idsToProcess)=>{
    const now=new Date().toISOString();
    for(const id of idsToProcess){
      const q=savedQuotes[id];
      if(!q) continue;
      const isWon=q.wonApproval?.status==="pending_won";
      const evtQ={event:decision,by:currentUser,at:now,comments:queueComments};
      if(isWon){
        // Closed Won approval — update wonApproval, use won_approved/won_rejected statuses
        const wonStatus=decision==="approved"?"won_approved":"won_rejected";
        const newWonApproval={...q.wonApproval,status:wonStatus,decidedBy:currentUser,decidedAt:now,comments:queueComments,history:[...(q.wonApproval?.history||[]),evtQ]};
        await saveQuoteToSupabase({...q,wonApproval:newWonApproval,chatterEntries:q.chatterEntries||[]},autoSpecs,autoNotes);
        // Event 3 (closed won) notification: pending from Russ.
        // If this quote is currently open in the form, sync its state
        if(currentQuoteId&&String(currentQuoteId)===String(id)){
          setWonApproval(newWonApproval);
        }
      } else {
        // Regular quote approval
        const newApproval={...q.approval,status:decision,decidedBy:currentUser,decidedAt:now,comments:queueComments,history:[...(q.approval?.history||[]),evtQ]};
        await saveQuoteToSupabase({...q,approval:newApproval,chatterEntries:q.chatterEntries||[]},autoSpecs,autoNotes);
        if(decision==="approved"){
          await autoUnflag(id);
          // Event 2: notify the "send approved quotes" group. Same payload shape
          // as handleApprove's call, but the quote data comes from `q` (the
          // queue row), not the currently-loaded form. money() formats total
          // from the stored q.total field.
          try {
            await invokeFunction("send-notification", {
              type: "nuforce_quote_approved",
              data: {
                opportunity:   q.opp || "",
                customer:      q.customer || "",
                total:         money(q.total || 0),
                approverName:  prettifyEmail(currentUser),
                submitterName: prettifyEmail(q.approval?.submittedBy || ""),
                linkUrl:       "https://nuforce.nulabs.com/#dashboard",
              },
            });
          } catch(e) { console.warn("[NOTIFY] quote_approved (queue) failed:", e?.message||e); }
        }
        // If this quote is currently open in the form, sync its state
        if(currentQuoteId&&String(currentQuoteId)===String(id)){
          const evtQL={event:decision,by:currentUser,at:now,comments:queueComments};
          const newApprovalL={...approval,status:decision,decidedBy:currentUser,decidedAt:now,comments:queueComments,history:[...(approval.history||[]),evtQL]};
          setApproval(newApprovalL);
          if(decision==="approved")setLocked(true);
          if(decision==="rejected")setLocked(false);
        }
      }
    }
    // Reload from Supabase to ensure UI is fully in sync (pending only — see comment in useEffect)
    const refreshed=await loadPendingQuotes();
    setSavedQuotes(refreshed);
    setQueueSelected(new Set());
    setQueueComments("");
  };

  // ── Open Quotes panel handlers ───────────────────────────────────────────────
  const loadOpenQuotes=async()=>{
    setOpenQuotesLoading(true);
    try {
      const data = await restFetch("GET", "open_quotes?select=*&order=sort_order.asc,created_at.asc");
      setOpenQuotesList(data||[]);
    } catch(e) {
      console.error("[REMINDERS] load failed:", e?.message || e);
      if (e?.isNoSession) showToast("Session expired, please refresh","error",5000);
    } finally {
      setOpenQuotesLoading(false);
    }
  };

  const addOpenQuoteRow=async()=>{
    setOpenQuotesList(prev=>{
      const maxOrder=prev.length>0?Math.max(...prev.map(r=>r.sort_order||0)):0;
      const optimistic={id:"temp-"+Date.now(),opportunity:"",account:"",description:"",sort_order:maxOrder+1};
      restFetch("POST", "open_quotes?select=*", {
        body: {opportunity:"",account:"",description:"",sort_order:maxOrder+1},
        returnRepresentation: true,
      }).then(result => {
        const inserted = Array.isArray(result) ? result[0] : result;
        if (inserted) setOpenQuotesList(p=>p.map(r=>r.id===optimistic.id?inserted:r));
      }).catch(err => {
        alert("Could not add row: "+(err?.message||err));
        setOpenQuotesList(p=>p.filter(r=>r.id!==optimistic.id));
      });
      return [...prev,optimistic];
    });
  };

  const updateOpenQuoteRow=async(id,field,value)=>{
    setOpenQuotesList(prev=>prev.map(r=>r.id===id?{...r,[field]:value}:r));
    try {
      await restFetch("PATCH", `open_quotes?id=eq.${encodeURIComponent(id)}`, {
        body: {[field]:value},
      });
    } catch (e) {
      console.error("[REMINDERS] update failed:", e?.message || e);
    }
  };

  const deleteOpenQuoteRow=async(id)=>{
    setOpenQuotesList(prev=>prev.filter(r=>r.id!==id));
    try {
      await restFetch("DELETE", `open_quotes?id=eq.${encodeURIComponent(id)}`);
    } catch (e) {
      console.error("[REMINDERS] delete failed:", e?.message || e);
    }
  };

  const handleOpenQuoteDragStart=(id)=>{
    dragRowId.current=id;
  };

  const handleOpenQuoteDrop=async(targetId)=>{
    const fromId=dragRowId.current;
    if(!fromId||fromId===targetId)return;
    dragRowId.current=null;
    setDragOverId(null);
    setOpenQuotesList(prev=>{
      const list=[...prev];
      const fromIdx=list.findIndex(r=>r.id===fromId);
      const toIdx=list.findIndex(r=>r.id===targetId);
      if(fromIdx<0||toIdx<0)return prev;
      const [moved]=list.splice(fromIdx,1);
      list.splice(toIdx,0,moved);
      const reordered=list.map((r,i)=>({...r,sort_order:i+1}));
      // Persist all sort_orders directly via REST bypass
      reordered.forEach(r=>{
        restFetch("PATCH", `open_quotes?id=eq.${encodeURIComponent(r.id)}`, {
          body: {sort_order: r.sort_order},
        }).catch(e => console.error("[REMINDERS] reorder save failed:", e?.message || e));
      });
      return reordered;
    });
  };

  const handleOpenQuoteClick=async(row)=>{
    if(!row.opportunity.trim())return;
    // Only prompt to save if we're in the quote form with an active quote
    if(!showDashboard&&(qi.opp||currentQuoteId)){
      const result=window.confirm("Save the current quote before switching?\n\nClick OK to save, or Cancel to discard.");
      if(result){
        const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
          qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
        await saveQuoteToSupabase(q,autoSpecs,autoNotes);
      }
    }
    // Search by opportunity name via REST bypass — case-insensitive exact match.
    // The original used supabase-js .ilike() with no explicit wildcards, which
    // becomes a case-insensitive equality match. PostgREST behaves the same way:
    // an ilike pattern with no wildcards (* in PostgREST) matches the literal.
    let matchData = null;
    try {
      const oppTerm = row.opportunity.trim();
      const result = await restFetch("GET",
        `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&opportunity=ilike.${encodeURIComponent(oppTerm)}&limit=1`);
      matchData = Array.isArray(result) && result.length ? result[0] : null;
    } catch (e) {
      console.error("[REMINDERS] quote lookup failed:", e?.message || e);
    }
    if(matchData){
      const q=matchData.data||{};
      // When loading from Reminders, treat as a NUForce quote regardless of source
      // The user intentionally chose to work on this quote
      const match={...q,id:matchData.id,opp:matchData.opportunity||q.opp,
        customer:matchData.customer||q.customer,rfq:matchData.rfq||q.rfq,
        total:matchData.total??q.total,savedAt:matchData.updated_at,
        source:"nuforce",
        approval:{...(q.approval||{}),status:matchData.approval_status||q.approval?.status||"none"}};
      handleLoad(match);
      setOpenQuotesPanel(false);
      navigateTo(false);
    } else {
      const create=window.confirm("No quote found for \""+row.opportunity+"\"\n\nWould you like to create a new quote with this opportunity number?");
      if(create){
        accountEditedRef.current=false;
        setQi({opp:row.opportunity,account:row.account||"",billTo:"",billToCity:"",contact:"",email:"",prepby:"",rev:"",revDate:"",date:new Date().toLocaleDateString("en-US"),rfq:"",stage:"Proposal/Price Quote",type:"New Business",relatedOpps:""});
        setTi({item:"",qty:"1",model:"",drawing:"",loads:null,dimL:"",dimW:"",dimH:"",wt:"",volt:"",pwrType:"AC",phase:"",hz:"",inrush:"",amps:"",mounting:"",pressureFlow:"",gsi:"Unknown",witness:"Unknown",docRestriction:"None",dpas:"",tiSpecs:"",tiNotes:""});
        setVibs([newVib()]);setShocks([newShock()]);setNoises([newNoise()]);setEnvs([newEnv()]);
        setHfvs([newHfv()]);setShos([newSho()]);setDcms([newDcm()]);setPqs([newPq()]);
        setEmis([newEmi()]);setAbs([newAb()]);setSbs([newSb()]);
        setInst({on:false,items:{}});setOt({on:false,rows:[]});setCustom({on:false,rows:[]});
        setBudget({on:false,rows:[],markup:"25"});setSub({on:false,rows:[]});
        setTd("0");setSetup({techRate:"175",fabHours:"4",holes:"0",cables:"0",drillTap:false});
        setGlobalPR({procs:[],reps:[],coc:false,cocPrice:"250"});
        setNotes("");setLineOverrides({});setLineOrder(null);setPickerLines([]);userEditedSpecs.current=false;userEditedNotes.current=false;
        setModalAnalysis({on:false,price:"6750"});setFixtureDrawing({on:false,price:"2950"});setInStockModal({on:false,targetProc:""});
        setWonInfo({wonDate:"",jobNum:"",poNum:""});setWonLocked(false);setWonDatePending(false);
        setApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:"",history:[]});
        setChatterEntries([]);setChatterInput("");
        setWorkspaceProjectId(null);setShowAppendConfirm(null);setShowClearLinkConfirm(false);setLoadedJobNum("");
        setLocked(false);setCurrentQuoteId(null);setCurrentQuoteSource("nuforce");
        setOpenQuotesPanel(false);
        navigateTo(false);
        window.scrollTo({top:0,behavior:"smooth"});
      }
    }
  };
  // Multi-instance helpers
  const mkUpdater=(_arr,setArr)=>(idx,val)=>setArr(prev=>prev.map((x,i)=>i===idx?(typeof val==="function"?val(x):val):x));
  // New instances inherit settings from the first active instance (same chamber, level, etc.)
  // but get a fresh id, on:false, identifier:"", and reset custom rows
  const mkAdder=(_arr,setArr,newFn)=>()=>setArr(prev=>{
    const base=newFn();
    const firstOn=prev.find(i=>i.on);
    const inherit=firstOn?{
      ...base,           // start from fresh defaults
      // only copy pricing fields from firstOn, not UI/structural fields
      stdSetup: firstOn.stdSetup||base.stdSetup,
      testing:  firstOn.testing||base.testing,
      addlCosts:firstOn.addlCosts||base.addlCosts,
      id:Date.now(),
      on:false,
      identifier:"",
      customRows:[],
      proc:false,
      report:false,
    }:{...base,id:Date.now(),identifier:""};
    return [...prev,inherit];
  });
  const mkRemover=(_arr,setArr)=>idx=>setArr(prev=>prev.filter((_,i)=>i!==idx));

  const vibSetup=vibs.find(v=>v.on)?sf(vibs.find(v=>v.on).setup):0;

  const summary=useMemo(()=>calcSummary(vibs,shocks,noises,envs,hfvs,shos,emis,pqs,dcms,abs,sbs,inst,ot,custom,td,coc,sub,globalPR,budget,setup,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal),
    [vibs,shocks,noises,envs,hfvs,shos,emis,pqs,dcms,abs,sbs,inst,ot,custom,td,coc,sub,globalPR,budget,setup,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal]);

  // When summary length changes: reset lineOrder and remap deleted overrides by label
  useEffect(()=>{
    if(!isDirty)return; // never remap when not in edit mode — protects locked/submitted quotes
    if(lineOrder&&lineOrder.length!==summary.lines.length){
      const oldLen=lineOrder.length;
      const newLen=summary.lines.length;
      if(newLen>oldLen){
        // Lines were added — append new indices at end, preserving existing order
        const newIndices=[];
        for(let i=oldLen;i<newLen;i++)newIndices.push(i);
        setLineOrder([...lineOrder,...newIndices]);
      } else {
        // Lines were removed — rebuild order by keeping only valid indices
        // Map old positions to new positions using label matching
        const oldLabels=lineOrder.map(i=>summary.lines[i]?.label).filter(Boolean);
        const newLabelToIdx={};
        summary.lines.forEach((l,i)=>{newLabelToIdx[l.label]=i;});
        const rebuilt=oldLabels
          .map(lbl=>newLabelToIdx[lbl])
          .filter(i=>i!==undefined);
        // Add any new indices not already in rebuilt
        const usedIdxs=new Set(rebuilt);
        for(let i=0;i<newLen;i++){if(!usedIdxs.has(i))rebuilt.push(i);}
        setLineOrder(rebuilt.length===newLen?rebuilt:null);
      }
    }
    // Remap only deleted flags — use stored label to find correct new index
    // Price/desc overrides are left alone (harmless if slightly off)
    const hasDeleted=Object.values(lineOverrides).some(ov=>ov?.deleted&&ov?.label);
    if(!hasDeleted)return;
    const labelToNewIdx={};
    summary.lines.forEach((l,i)=>{labelToNewIdx[l.label]=i;});
    let changed=false;
    const next={...lineOverrides};
    // Remove ALL deleted entries first (labeled and unlabeled)
    Object.entries(next).forEach(([k,ov])=>{
      if(ov?.deleted){ delete next[k]; changed=true; }
    });
    // Re-insert labeled deletions at correct new positions
    Object.entries(lineOverrides).forEach(([,ov])=>{
      if(ov?.deleted&&ov?.label){
        const newIdx=labelToNewIdx[ov.label];
        if(newIdx!==undefined){next[newIdx]=ov; changed=true;}
        // else line no longer exists — drop silently
      }
      // Unlabeled deletions are dropped permanently
    });
    if(changed)setLineOverrides(next);
  },[summary.lines.map(l=>l.label).join('|')]);

  // Reset td override when no main tests are active
  useEffect(()=>{
    if(!isDirty)return; // don't reset td when not in edit mode
    const anyActive=vibs.some(s=>s.on)||shocks.some(s=>s.on)||noises.some(s=>s.on)||
      envs.some(s=>s.on)||hfvs.some(s=>s.on)||shos.some(s=>s.on)||
      abs.some(s=>s.on)||sbs.some(s=>s.on);
    if(!anyActive&&sf(td)>0)setTd("0");
  },[vibs,shocks,noises,envs,hfvs,shos,abs,sbs,hfvs,shos]);

  const autoSpecs=useMemo(()=>buildSpecs(vibs,shocks,noises,envs,hfvs,shos,dcms,emis,pqs,abs,sbs),
    [vibs,shocks,noises,envs,hfvs,shos,dcms,emis,pqs,abs,sbs]);

  const autoNotes=useMemo(()=>{
    const lines=[];
    if(noises.some(s=>s.on))lines.push("Frequencies below 100Hz to be performed as a best effort. All cabling that connects to the unit should be a minimum of 20 feet unless otherwise discussed.");
    if(noises.some(s=>s.on&&s.level==="170dB"))lines.push("OASPLs greater than 170dB will be performed as a best effort.");
    if(noises.some(s=>s.on&&(()=>{
      const hrs=s.durUnit==="hours"?Math.ceil(parseFloat(s.durVal)||0):Math.ceil((parseFloat(s.durVal)||0)/60);
      return hrs>8;
    })()))lines.push("Testing will be performed during normal business hours unless otherwise discussed, and it is assumed to be acceptable for this test to be stopped and restarted.");
    if(pqs.some(s=>s.on&&s.cw))lines.push("Current Waveform testing performed using facility power.");
    if(emis.some(s=>s.on)){
      lines.push("EMI Notes:\n"+
        "* This quote assumes that the susceptibility criteria can be determined in less than 3 seconds during real-time operation of the EUT, and that if additional monitoring personnel are needed, they would be provided by the customer. Customer to supply cables and all peripheral and monitoring equipment, and one mode of operation (operating or standby). Susceptibility determination provided by the customer. Pricing is based on customer-supplied information, the assumptions listed here, and acceptance of an approved test procedure.\n"+
        "* Pricing and feasibility may be reevaluated upon completion and review of the NU Laboratories Test Configuration Form.\n"+
        "* This quote assumes that the number of cables and outside diameter of the cables under test are within NU Laboratories capabilities/limitations.\n"+
        "* Pricing assumes the standard list of tests from MIL-STD-461G, and that all testing is performed at NU Labs. Any tests requiring subcontracting will incur additional charges."
      );
    }
    if(inStockModal?.on)lines.push("The test procedure will include an in-stock modal analysis of the proposed test fixture. Any additional analysis or alterations to the proposed test setup or fixture may incur additional charges.");
    if(modalAnalysis?.on)lines.push("The modal analysis reflects the initial run of the analysis. Additional runs may incur additional charges.");
    if(fixtureDrawing?.on)lines.push("Test fixture drawings represent the initial design. Alterations to the design of the proposed test fixture may incur additional charges. These changes also may affect the price of test fixture fabrication.");
    lines.push("Refer to the notes section at the bottom of this quote for additional details.");
    return lines.join("\n\n");
  },[noises,pqs,emis,abs,sbs,modalAnalysis,fixtureDrawing,inStockModal]);

  // ── Track isDirty when test selections change ──────────────────────────────
  // Only test selection changes mark the quote dirty (not metadata like account name)
  // isDirty=true means live calcSummary should be used; false means use snapshot
  useEffect(()=>{
    if(isLoadingRef.current)return; // suppress during load
    if(locked)return; // never mark dirty when quote is locked
    setIsDirty(true);
  },[vibs,shocks,noises,envs,hfvs,shos,emis,pqs,dcms,abs,sbs,inst,ot,custom,
     budget,globalPR,lineOverrides,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal]);

  // Sync auto-generated specs into tiSpecs when tests change
  // Stores what was actually inserted so it can always be removed cleanly
  const prevAutoSpecs=useRef("");
  const insertedAutoSpecs=useRef(""); // tracks what we actually put into tiSpecs
  const userEditedSpecs=useRef(false); // true once user manually edits tiSpecs

  // Refs + autosize logic for the spec/notes textareas. Each grows to fit its
  // content up to a 15-line visible cap; beyond that, normal scrollbar takes
  // over. Recalculated whenever the textarea's value changes.
  const tiSpecsRef = useRef(null);
  const tiNotesRef = useRef(null);
  // Ref kept in sync by PricingCalculator on every render — lets the App's
  // export buttons (which live outside PricingCalculator) read the calc
  // tab's current state. Read-only from App's side; PricingCalculator owns
  // the writes via the calcStatesRef prop passed below.
  const pricingCalcStateRef = useRef({ emiCalc: null, pqCalc: null, dcmCalc: null });

  // ── CRR workup data (read-only from NUForce) ─────────────────────────────────
  // When a quote is loaded, we fetch the matching row from public.crr_workups
  // (keyed by quote_number) and cache it here. Used by:
  //   • The "CRR" view toggle inside each calc tab (EMI / PQ / DC Mag)
  //   • The "Spec Builder from CRR" launcher option
  //   • The green-dot indicator next to the calc tabs
  // crrWorkup = null  → not yet fetched / no quote loaded
  // crrWorkup = false → fetched but no row exists in Supabase for this quote
  // crrWorkup = {...} → the parsed row
  const [crrWorkup, setCrrWorkup] = useState(null);
  // Bumped by the "Refresh CRR" button to force a re-fetch without changing the
  // opportunity number (e.g. after the workup is edited in Workspace mid-session).
  const [crrRefreshTick, setCrrRefreshTick] = useState(0);

  // Fetch CRR workup whenever the quote number changes.
  // Cached in state — never automatically refetched mid-session (per Phase 6
  // design decision). A future "Refresh CRR" button could clear+refetch.
  useEffect(() => {
    const quoteNum = (qi?.opp || "").trim();
    if (!quoteNum) {
      setCrrWorkup(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Match on the BASE opportunity number (strip a single trailing revision
        // letter), because Workspace may keep the CRR workup under the base number
        // (e.g. "26-224") even after the quote is revised to "26-224A". An exact
        // string match would then miss the workup entirely once the quote is revised.
        const m = quoteNum.match(/^(.*?)([A-Za-z])?$/);
        const base = (m ? m[1] : quoteNum).trim();
        const baseU = base.toUpperCase();
        const url = "crr_workups?quote_number=ilike." + encodeURIComponent(base + "*") +
                    "&select=*";
        const rows = await restFetch("GET", url);
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        // Keep only the base itself or base + a single trailing letter, so we don't
        // accidentally match e.g. "26-2240" or "26-224-2" when the base is "26-224".
        const revRank = (qn) => {
          const s = String(qn || "").toUpperCase();
          const suffix = s.length === baseU.length + 1 ? s.slice(-1) : "";
          return /[A-Z]/.test(suffix) ? (suffix.charCodeAt(0) - 64) : 0; // base=0, A=1, B=2…
        };
        const variants = list.filter((r) => {
          const qn = String(r.quote_number || "").toUpperCase();
          if (qn === baseU) return true;
          return qn.length === baseU.length + 1 && qn.startsWith(baseU) && /[A-Z]/.test(qn.slice(-1));
        });
        if (variants.length === 0) { setCrrWorkup(false); return; }
        // Prefer an exact match to the current opportunity number; otherwise take the
        // highest workup revision at or below the quote's revision, falling back to
        // the highest available if every workup is newer than the quote.
        const currentRank = revRank(quoteNum);
        const exact = variants.find(
          (r) => String(r.quote_number || "").toUpperCase() === quoteNum.toUpperCase()
        );
        const atOrBelow = variants.filter((r) => revRank(r.quote_number) <= currentRank);
        const pool = atOrBelow.length ? atOrBelow : variants;
        const chosen = exact || pool.slice().sort((a, b) => revRank(b.quote_number) - revRank(a.quote_number))[0];
        setCrrWorkup(chosen || false);
      } catch (e) {
        if (cancelled) return;
        console.warn("[CRR] fetch failed:", e?.message || e);
        setCrrWorkup(false); // treat fetch errors as "no CRR" so UI still works
      }
    })();
    return () => { cancelled = true; };
  }, [qi?.opp, crrRefreshTick]);
  const AUTOSIZE_MAX_PX = 280; // ~15 lines at lineHeight 1.6 * fontSize 11 + padding
  const fitTextarea = (el) => {
    if (!el) return;
    // Reset to 'auto' first so scrollHeight reflects actual content, not stale height
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, AUTOSIZE_MAX_PX);
    el.style.height = next + "px";
  };
  useEffect(()=>{ fitTextarea(tiSpecsRef.current); }, [ti.tiSpecs]);
  useEffect(()=>{ fitTextarea(tiNotesRef.current); }, [ti.tiNotes]);
  useEffect(()=>{
    const prev=prevAutoSpecs.current;
    prevAutoSpecs.current=autoSpecs;
    if(prev===autoSpecs)return;
    if(!isDirty)return; // never overwrite specs when not in edit mode
    if(userEditedSpecs.current)return; // user has manually edited specs — don't auto-update
    setTi(t=>{
      const cur=t.tiSpecs||"";
      const inserted=insertedAutoSpecs.current;
      let manual=cur;
      // Remove whatever we last inserted — try all possible positions
      if(inserted){
        if(manual.endsWith("\n\n"+inserted))manual=manual.slice(0,-(inserted.length+2)).trimEnd();
        else if(manual===inserted)manual="";
        else if(manual.includes("\n\n"+inserted))manual=manual.replace("\n\n"+inserted,"").trimEnd();
        else if(manual.includes(inserted+"\n\n"))manual=manual.replace(inserted+"\n\n","").trimEnd();
        else if(manual.includes(inserted))manual=manual.replace(inserted,"").trim();
        else if(inserted&&cur.length>0){
          // Format mismatch — inserted text not found verbatim in tiSpecs
          // Auto-text is always appended at the end — try to strip any trailing
          // auto-generated sentences by finding where manual text ends
          // Heuristic: split by double newline, keep lines that don't start with
          // known auto-text beginnings
          const AUTO_STARTS=["Vibration testing","Shock testing","Drop Shock","Bench Handling",
            "Noise testing","EMI testing","Power Quality","DC Magnetics","Airborne Noise",
            "Structureborne Noise","Temperature","Humidity","Altitude","Salt Fog","ESS",
            "Acceleration","Inclination","Rapid Decompression","Explosive Decompression",
            "Drip Test","Submergence","Spray Test","Insulation Resistance",
            "High Frequency","MIL-STD","Test procedure","Frequencies below","OASPLs",
            "Current Waveform","The modal","Test fixture","The test procedure","The drawings"];
          const parts=cur.split("\n\n");
          const manualParts=parts.filter(p=>!AUTO_STARTS.some(s=>p.trim().startsWith(s)));
          manual=manualParts.join("\n\n").trim();
        }
      }
      if(!autoSpecs){insertedAutoSpecs.current="";return {...t,tiSpecs:manual};}
      insertedAutoSpecs.current=autoSpecs;
      if(!manual)return {...t,tiSpecs:autoSpecs};
      return {...t,tiSpecs:manual+"\n\n"+autoSpecs};
    });
  },[autoSpecs]);

  const prevAutoNotes=useRef("");
  const insertedAutoNotes=useRef("");
  const userEditedNotes=useRef(false);
  useEffect(()=>{
    const prev=prevAutoNotes.current;
    prevAutoNotes.current=autoNotes;
    if(prev===autoNotes)return;
    if(!isDirty)return; // never overwrite notes when not in edit mode
    if(userEditedNotes.current)return; // user has manually edited notes — don't auto-update
    setTi(t=>{
      const cur=t.tiNotes||"";
      const inserted=insertedAutoNotes.current;
      let manual=cur;
      if(inserted){
        if(manual.endsWith("\n\n"+inserted))manual=manual.slice(0,-(inserted.length+2)).trimEnd();
        else if(manual===inserted)manual="";
        else if(manual.includes("\n\n"+inserted))manual=manual.replace("\n\n"+inserted,"").trimEnd();
        else if(manual.includes(inserted+"\n\n"))manual=manual.replace(inserted+"\n\n","").trimEnd();
        else if(manual.includes(inserted))manual=manual.replace(inserted,"").trim();
      }
      if(!autoNotes){insertedAutoNotes.current="";return {...t,tiNotes:manual};}
      insertedAutoNotes.current=autoNotes;
      if(!manual)return {...t,tiNotes:autoNotes};
      return {...t,tiNotes:manual+"\n\n"+autoNotes};
    });
  },[autoNotes]);

  const anyOn=vibs.some(s=>s.on)||shocks.some(s=>s.on)||noises.some(s=>s.on)||envs.some(s=>s.on)||
    hfvs.some(s=>s.on)||shos.some(s=>s.on)||dcms.some(s=>s.on)||pqs.some(s=>s.on)||emis.some(s=>s.on)||
    abs.some(s=>s.on)||sbs.some(s=>s.on)||inst.on||ot.on||custom.on||globalPR.coc||globalPR.procs.length>0||globalPR.reps.length>0;

  // Nav/display total respects lineOverrides (price edits + deleted lines), matching PDF behaviour
  // Use snapshot total when not dirty — immune to formula changes
  // Use live calcSummary when dirty (user is actively editing test selections)
  const liveTotal=useMemo(()=>{
    const baseTotal=summary.lines.reduce((a,l,idx)=>{
      const ov=lineOverrides[idx]||{};
      if(ov.deleted)return a;
      return a+(ov.price!==undefined?sf(ov.price,0):l.val);
    },0);
    const pickerTotal=(pickerLines||[]).reduce((a,l)=>a+(l.price||0),0);
    return baseTotal+pickerTotal;
  },[summary.lines,lineOverrides,pickerLines]);
  const displayTotal=(!isDirty&&snapshot!=null) ? (snapshot.total??liveTotal) : liveTotal;

  // Clone quote — optionally save original first, then open modal for new opp #
  const handleFlag = async () => {
    if(flagLoading)return;
    setFlagLoading(true);
    try {
      // Ensure quote is saved to Supabase before flagging
      // This handles SF-imported quotes that may not have a valid row yet
      let qid = currentQuoteId;
      if(!qid){
        const q={id:undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
          qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,
          budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,
          inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
        const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes);
        if(!newId){showToast("Save failed before flagging","error");setFlagLoading(false);return;}
        setCurrentQuoteId(newId);
        qid=newId;
      }
      if(quoteFlag){
        try {
          await restFetch("PATCH",
            `quote_flags?id=eq.${encodeURIComponent(quoteFlag.id)}`,
            {body:{resolved:true,resolved_by:currentUser,resolved_at:new Date().toISOString()}});
          setQuoteFlag(null);
          setFlagNote("");
          showToast("🚩 Flag removed","info");
        } catch(e) {
          showToast("Flag remove failed: " + (e?.message||e), "error");
        }
      } else {
        // Verify currentQuoteId is the right quote before inserting
        // Re-fetch to confirm it matches qi.opp
        let confirmedId = null;
        try {
          const checkRows = await restFetch("GET",
            `quotes?select=id,opportunity&id=eq.${encodeURIComponent(qid)}&limit=1`);
          const check = (checkRows||[])[0];
          confirmedId = check?.opportunity===qi.opp ? qid : null;
        } catch(e) {
          console.warn("[FLAG-VERIFY] failed:", e?.message||e);
        }
        if(!confirmedId){showToast("Flag error: quote ID mismatch, try again","error");setFlagLoading(false);setShowFlagPopover(false);return;}
        try {
          // UPSERT (insert-or-merge): the quote_flags table has a UNIQUE constraint
          // on quote_id, so a quote that was previously flagged + resolved has a
          // dormant row. A plain INSERT hits 409. With merge-duplicates, PostgREST
          // updates the existing row with our payload. We explicitly null out the
          // resolved fields so a re-flagged quote is "active" again.
          const rows = await restFetch("POST", "quote_flags?on_conflict=quote_id", {body:{
            quote_id:confirmedId,
            opportunity:qi.opp,
            customer:qi.account,
            flagged_by:currentUser,
            flagged_at: new Date().toISOString(),
            note:flagNote.trim()||null,
            resolved: false,
            resolved_by: null,
            resolved_at: null,
          }, returnRepresentation:true, upsert:true});
          const data = (rows||[])[0];
          if(data){setQuoteFlag(data);showToast("🚩 Quote flagged","success");setDashboardNeedsRefresh(true);}
          else showToast("Flag failed: insert returned no row","error");
        } catch(e) {
          showToast("Flag failed: " + (e?.message||e), "error");
        }
      }
    } catch(e){ showToast("Flag error: "+e.message,"error"); }
    setShowFlagPopover(false);
    setFlagLoading(false);
  };

  const sortPickerLines = (lines) => {
    const order = l => {
      const code = l.code||"";
      const label = (l.label||"").toLowerCase();
      if(code==="42"||code==="44"||label.includes("procedure")) return 0;
      if(code==="96"||label.includes("tear down")||label.includes("teardown")) return 8;
      if(code==="41"||code==="43"||label.includes("report")||label.includes("certificate")) return 9;
      return 5;
    };
    return [...lines].sort((a,b)=>order(a)-order(b));
  };

  const handleProductPickerAdd = (lines) => {
    const newLines = lines.map(l => ({
      id: Date.now()+Math.random(),
      label: l.label,
      code: l.code||"94",
      price: l.price||0,
      desc: l.desc||"",
    }));
    setPickerLines(prev => sortPickerLines([...prev, ...newLines]));
    // Preserve existing sort order — append new lines to END of unifiedOrder
    setUnifiedOrder(prev => {
      if(!prev) return null; // no existing order, stay null (default append)
      // Append new picker entries at the end of existing unified order
      const newEntries = newLines.map(l => ({type:'picker', id: l.id||l.label, label: l.label}));
      return [...prev, ...newEntries];
    });
    setIsDirty(true);
    showToast(`Added ${lines.length} line item${lines.length!==1?"s":""} to quote`, "success");
  };

  const handleClone=async()=>{
    const result=window.confirm("Save the current quote before cloning?\n\nClick OK to save first, or Cancel to clone without saving.");
    if(result){
      const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
        qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
      // Await the save before opening the clone modal. Previously this was fire-and-forget,
      // which caused the original save and the subsequent clone-save to race on the same
      // Supabase client, wedging it. Serializing prevents the deadlock.
      const newId = await saveQuoteToSupabase(q,autoSpecs,autoNotes);
      if (!newId) {
        showToast("Original quote couldn't save — clone anyway? Click Clone in the modal to proceed without saving the original, or close to retry.","warn",6000);
      }
    }
    setCloneOppInput("");
    setShowCloneModal(true);
  };

  const doClone=(newOpp)=>{
    setQi(q=>({...q,opp:newOpp,rfq:"",rev:"",revDate:"",date:new Date().toLocaleDateString("en-US"),stage:"Proposal/Price Quote"}));
    setWonInfo({wonDate:"",jobNum:"",poNum:""});
    setWonLocked(false);
    setWonDatePending(false);
    setCurrentQuoteId(null);
    setLineOrder(null);
    setLineOverrides({});
    setCurrentQuoteSource("nuforce");
    setLocked(false);
    setChatterEntries([]);setChatterInput("");
    setWonApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:""});
    setApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:"",history:[]});
    setShowCloneModal(false);
    setCloneOppInput("");
    window.scrollTo({top:0,behavior:"smooth"});
  };

  const handleNewQuote=async(skipConfirm=false)=>{
    isLoadingRef.current=true; accountEditedRef.current=false; // suppress isDirty during reset
    if(!skipConfirm){
      const result=window.confirm("Save the current quote before starting a new one?\n\nClick OK to save, or Cancel to discard and continue.");
      if(result){
        const id=currentQuoteId||undefined;
        const q={id,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
          qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
        // Await the save before resetting state. Previously this was fire-and-forget,
        // which caused the original save and the subsequent new-quote save to race on the
        // same Supabase client, wedging it. Serializing prevents the deadlock.
        const newId = await saveQuoteToSupabase(q,autoSpecs,autoNotes);
        if (!newId) {
          showToast("Original quote couldn't save — starting new quote anyway","warn",5000);
        }
      }
    }
    // Reset all state to blank defaults
    setQi({opp:"",account:"",billTo:"",billToCity:"",contact:"",email:"",prepby:"",rev:"",revDate:"",date:new Date().toLocaleDateString("en-US"),rfq:"",stage:"Proposal/Price Quote",type:"New Business",relatedOpps:""});
    setTi({item:"",qty:"1",model:"",drawing:"",loads:null,dimL:"",dimW:"",dimH:"",wt:"",volt:"",pwrType:"AC",phase:"",hz:"",inrush:"",amps:"",mounting:"",pressureFlow:"",gsi:"Unknown",witness:"Unknown",docRestriction:"None",dpas:"",tiSpecs:"",tiNotes:""});
    setVibs([newVib()]); setShocks([newShock()]); setNoises([newNoise()]); setEnvs([newEnv()]);
    setHfvs([newHfv()]); setShos([newSho()]); setDcms([newDcm()]); setPqs([newPq()]);
    setEmis([newEmi()]); setAbs([newAb()]); setSbs([newSb()]);
    setInst({on:false,items:{}}); setOt({on:false,rows:[]}); setCustom({on:false,rows:[]});
    setBudget({on:false,rows:[],markup:"25"}); setSub({on:false,rows:[]});
    setTd("0"); setSetup({techRate:"175",fabHours:"4",holes:"0",cables:"0",drillTap:false});
    setGlobalPR({procs:[],reps:[],coc:false,cocPrice:"250"});
    setNotes(""); setLineOverrides({}); setLineOrder(null); setPickerLines([]); setUnifiedOrder(null);
    setModalAnalysis({on:false,price:"6750"}); setFixtureDrawing({on:false,price:"2950"}); setInStockModal({on:false,targetProc:""});
    setWonInfo({wonDate:"",jobNum:"",poNum:""}); setWonLocked(false);setWonDatePending(false);
    setApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:"",history:[]});
    setLocked(false); setCurrentQuoteId(null); setCurrentQuoteSource("nuforce");
    setWonApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:""});
    setWorkspaceProjectId(null);setShowAppendConfirm(null);setShowClearLinkConfirm(false);setLoadedJobNum("");
    setChatterEntries([]);setChatterInput("");setQuoteSentAt(null);setShowFollowUpPopover(false);setFollowUpDate("");setSnapshot(null);setIsDirty(true); // new quote — no snapshot yet, all live
    setTimeout(()=>{ isLoadingRef.current=false; }, 50);
    localStorage.removeItem("vibrato_last_quote_id");
    window.scrollTo({top:0,behavior:"smooth"});
  };

  // Open revision history modal for current opportunity
  const openRevHistory = async () => {
    if (!qi.opp) {
      showToast("Save the quote first to view revision history", "warn");
      return;
    }
    setShowRevHistory(true);
    setRevHistoryLoading(true);
    // Parse out the base opportunity by stripping a single trailing letter (revision marker)
    // Examples: "24-173"→"24-173", "24-173A"→"24-173", "26-096B"→"26-096"
    const oppMatch = qi.opp.match(/^(.+?)([A-Z])?$/);
    const baseOpp = oppMatch ? oppMatch[1] : qi.opp;
    // Query for the base + any single-letter rev variants. Use ilike with a wildcard,
    // then client-side filter to ensure suffix is either empty or exactly one A-Z.
    let data = null;
    try {
      data = await restFetch("GET",
        `quotes?select=id,opportunity,revision,total,updated_at,created_at,data&opportunity=ilike.${encodeURIComponent(baseOpp+"*")}`);
    } catch(e) {
      console.warn("[REV-HISTORY] failed:", e?.message||e);
      setRevHistoryList([]);
      setRevHistoryLoading(false);
      return;
    }
    // Filter out unrelated matches (e.g. "24-1730" when querying "24-173")
    const filtered = (data || []).filter(row => {
      const opp = (row.opportunity || "").toUpperCase();
      const base = baseOpp.toUpperCase();
      if (opp === base) return true;
      if (opp.length === base.length + 1 && opp.startsWith(base) && /[A-Z]/.test(opp.slice(-1))) return true;
      return false;
    });
    // Sort: highest revision letter first (blank < A < B < C ...)
    const revRank = (r) => {
      const s = (r || "").toString().trim().toUpperCase();
      return s.length === 0 ? -1 : s.charCodeAt(0) - 64;
    };
    const list = filtered.slice().sort((a, b) => revRank(b.revision) - revRank(a.revision));
    setRevHistoryList(list);
    // Default: compare current (newest) to the one immediately prior
    if (list.length > 0) {
      setRevCompareToId(list[0].id);
      setRevCompareFromId(list[1] ? list[1].id : null);
    }
    setRevHistoryLoading(false);
  };

  // Save quote to Supabase
  const handleSave=async()=>{
    console.warn('[CLICK-DIAG] handleSave entered', new Date().toISOString());
    // Block save if Closed Won and wonDate hasn't been confirmed this session
    if(qi.stage==="Closed Won"&&wonDatePending){
      showToast("Confirm the Won Date first","warn",4000);
      return;
    }
    // ── Require a linked client — no text-only accounts ──
    // If the Account was typed/edited this session and never linked to a client
    // via the dropdown, block the save. If the name matches an existing client,
    // tell them to pick it; otherwise point them to "Create in Workspace".
    if (accountEditedRef.current && (qi.account||"").trim() && !qi.clientId) {
      const acct = qi.account.trim();
      let match = null;
      try {
        const rows = await restFetch("GET",
          `clients?select=id,name&name=ilike.${encodeURIComponent(acct)}&limit=1`);
        match = Array.isArray(rows) && rows.length ? rows[0] : null;
      } catch (e) {
        console.warn('[ACCOUNT-LINK] client lookup failed', e?.message || e);
      }
      if (match) {
        showToast(`"${match.name}" is a client in the database but isn't linked. Open the Account field and pick it from the dropdown to link it, then save again.`, "warn", 7000);
      } else {
        showToast(`"${acct}" isn't a linked client. Use "＋ Create in Workspace" in the Account dropdown to add it, then pick it from the list to link it.`, "warn", 7000);
      }
      return;
    }
    recentSaveRef.current=Date.now();
    // Build price snapshot — frozen at save time, immune to future formula changes
    const snapshotLines=(summary.lines||[]).map((l,i)=>{
      const ov=lineOverrides[i]||{};
      if(ov.deleted)return null;
      return {...l, val: ov.price!==undefined ? sf(ov.price,0) : l.val};
    }).filter(Boolean);
    const savedSnapshot={
      lines: snapshotLines,
      total: displayTotal,
      tiSpecs: ti.tiSpecs||"",
      tiNotes: ti.tiNotes||"",
      savedAt: new Date().toISOString(),
    };
    const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
      qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId,snapshot:savedSnapshot};

    // Detect opportunity-number and revision-letter changes on existing quotes.
    let saveOpts;
    if (currentQuoteId) {
      // Look up the currently-saved opportunity + rev letter for this row via the
      // REST bypass (supabase-js wedges here too). restFetch has its own 15s
      // timeout; if it fails we skip these checks and proceed with the save.
      let existing = null;
      try {
        const result = await restFetch("GET", `quotes?id=eq.${encodeURIComponent(currentQuoteId)}&select=revision,opportunity`);
        existing = Array.isArray(result) && result.length ? result[0] : null;
      } catch (e) {
        console.warn('[SAVE-CHECK] failed — skipping opp/rev-change detection on this save', e?.message || e);
      }

      // ── Opportunity-number change guard ─────────────────────────────────────
      // If the opportunity number differs from what's saved, confirm before
      // saving. When the change looks like a revision (e.g. "26-123" → "26-123A")
      // and the Quote Revision field doesn't reflect the new letter, remind the
      // user to update it so the revision is tracked in history.
      const oldOpp = (existing?.opportunity || "").toString().trim();
      const newOpp = (qi.opp || "").toString().trim();
      if (existing && oldOpp && oldOpp !== newOpp) {
        const splitRev = s => {
          const m = s.match(/^(.*?)([A-Za-z])$/);
          return m ? { base: m[1], letter: m[2].toUpperCase() } : { base: s, letter: "" };
        };
        const oldP = splitRev(oldOpp);
        const newP = splitRev(newOpp);
        const looksLikeRev = !!newP.letter
          && newP.base.toUpperCase() === oldP.base.toUpperCase()
          && newP.letter !== oldP.letter;
        const curRev = (qi.rev || "").toString().trim().toUpperCase();
        let msg = `You're changing the opportunity number:\n\n    ${oldOpp}  →  ${newOpp}\n\nSave with the new number?`;
        if (looksLikeRev && curRev !== newP.letter) {
          msg += `\n\n⚠ This looks like Revision ${newP.letter}, but the Quote Revision `
            + `field is ${curRev ? `"${curRev}"` : "blank"}.\n`
            + `Add "${newP.letter}" to the Quote Revision field so the revision change `
            + `is tracked in history.`;
        }
        if (!window.confirm(msg)) {
          showToast("Save cancelled", "warn");
          return;
        }
      }

      const oldRev = (existing?.revision || "").toString().trim();
      const newRev = (qi.rev || "").toString().trim();
      if (existing && oldRev !== newRev) {
        // Rev changed — ask user how to handle
        const oldLabel = oldRev || "(original)";
        const newLabel = newRev || "(original)";
        const choice = window.prompt(
          `Revision letter changed from "${oldLabel}" to "${newLabel}".\n\n` +
          `• Type "new" to save as a NEW REVISION (keeps the old one in history)\n` +
          `• Type "overwrite" to replace the existing revision (no history kept)\n` +
          `• Cancel to abort save`,
          "new"
        );
        if (choice === null) {
          showToast("Save cancelled", "warn");
          return;
        }
        const c = choice.trim().toLowerCase();
        if (c === "new" || c === "n") {
          saveOpts = { forceInsert: true };
        } else if (c === "overwrite" || c === "o") {
          saveOpts = undefined;
        } else {
          showToast("Save cancelled — unrecognized choice", "warn");
          return;
        }
      }
    }

    const newId=await saveQuoteToSupabase(q,autoSpecs,autoNotes,saveOpts);
    if(newId){
      // If we forced an insert, this is a new row — update currentQuoteId so subsequent saves edit this rev
      setCurrentQuoteId(newId);
      setSnapshot(savedSnapshot);
      setIsDirty(false); // quote is now clean — snapshot is current
      showToast("Saved — "+(qi.opp||"Untitled"),"success");
      // Update savedQuotes so approval queue reflects new total immediately
      setSavedQuotes(prev=>({
        ...prev,
        [newId]:{...(prev[newId]||{}), ...q, id:newId, total:displayTotal}
      }));
    } else {
      showToast("Save failed — check your connection and try again.","error",5000);
    }
  };

  // ── Workspace project creation handlers ──────────────────────────────────
  // Pushes the closed-won quote to NUWorkspace as a new project, or appends to
  // an existing one. Russ owns the three SECURITY DEFINER RPCs on the workspace
  // side; we just assemble and call. All-or-nothing transactions, error codes
  // come back prefixed (JOB_EXISTS, CLIENT_NOT_FOUND, PROJECT_NOT_FOUND, BAD_INPUT).

  // Maps a workspace RPC failure to plain language. The RPCs raise the prefixed
  // codes noted above and PostgREST wraps them in a JSON error body, so we
  // substring-match the code rather than parse. Unrecognized errors keep their raw
  // text — discarding it would leave support with nothing to go on.
  const describeWorkspaceError = (err, { accountName, actionLabel = "create the project" } = {}) => {
    const raw = (err?.message || String(err || "")).trim();
    const has = (code) => raw.toUpperCase().includes(code);

    // Client-side abort. The fetch died, but the server transaction may have
    // committed anyway — never imply a plain retry is safe.
    if (err?.name === "AbortError" || /timed out/i.test(raw)) {
      return { msg: "Lost contact with Workspace before it confirmed the project. It may or may not "
                  + "have been created — check Workspace for this Job # before trying again.",
               type: "error", duration: 9000 };
    }
    if (err?.isNoSession) {
      return { msg: `Your session expired. Sign in again, then ${actionLabel}.`,
               type: "error", duration: 7000 };
    }
    if (has("CLIENT_NOT_FOUND")) {
      const shown = accountName ? `"${accountName}"` : "— none is filled in on this quote —";
      return { msg: `The account name on this quote ${shown} doesn't match any client in Workspace. `
                  + `Check it's spelled exactly as it appears in the client database, then try again.`,
               type: "error", duration: 10000 };
    }
    if (has("JOB_EXISTS")) {
      return { msg: "That Job # is already used by a project in Workspace. Use “Add to Existing” "
                  + "to attach this quote to it, or enter a different Job #.",
               type: "error", duration: 8000 };
    }
    if (has("PROJECT_NOT_FOUND")) {
      return { msg: "Workspace couldn't find that project — it may have been renamed or deleted. "
                  + "Check the Job # in Workspace.", type: "error", duration: 8000 };
    }
    if (has("BAD_INPUT")) {
      return { msg: "Workspace rejected this quote's details as incomplete. Check the account name, "
                  + "contact and line items are filled in, then try again.",
               type: "error", duration: 8000 };
    }
    if (/no project_id/i.test(raw)) {
      return { msg: "Workspace returned an unexpected response, so the project may have been created "
                  + "without being linked here. Check Workspace for this Job # before retrying.",
               type: "error", duration: 9000 };
    }
    return { msg: `Couldn't ${actionLabel} in Workspace. ${raw}`, type: "error", duration: 9000 };
  };

  const handleCreateProject = async () => {
    const jobNum = (wonInfo?.jobNum || "").trim();
    if (!jobNum) { showToast("Enter a Job # before creating a project","error",3500); return; }
    if (!currentQuoteId) { showToast("Save the quote first before creating a project","error",3500); return; }
    setWorkspaceBusy(true);
    try {
      // 0. Persist the current quote state first — Won Details, line items, everything.
      // Otherwise users who fill in Won Date / Job # / PO # in the modal and click Create Project
      // would have those fields lost (they live in the data JSONB blob, not as top-level columns).
      // Build the same q={} payload handleSave builds, but bypass handleSave itself to avoid
      // its toast/prompt/guard side effects.
      const snapshotLines=(summary.lines||[]).map((l,i)=>{
        const ov=lineOverrides[i]||{};
        if(ov.deleted)return null;
        return {...l, val: ov.price!==undefined ? sf(ov.price,0) : l.val};
      }).filter(Boolean);
      const savedSnapshot={
        lines: snapshotLines, total: displayTotal,
        tiSpecs: ti.tiSpecs||"", tiNotes: ti.tiNotes||"",
        savedAt: new Date().toISOString(),
      };
      const q={id:currentQuoteId,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
        qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId,snapshot:savedSnapshot};
      const savedId = await saveQuoteToSupabase(q, autoSpecs, autoNotes);
      if (!savedId) {
        showToast("Couldn't save quote before creating project — try saving manually first","error",6000);
        return;
      }
      // Save succeeded — proceed with the workspace flow
      setSnapshot(savedSnapshot);
      setIsDirty(false);
      // 1. Pre-check: Job # must NOT already exist
      let lookup;
      try {
        lookup = await rpcCall('lookup_project_by_job_number', { job_number: jobNum });
      } catch (e) {
        showToast("Couldn't check workspace for existing project: " + (e?.message||e), "error", 6000);
        return;
      }
      if (lookup?.found) {
        showToast(
          `Job # "${jobNum}" already exists on project "${lookup.project_name}". Use Add to Existing instead, or change the Job #.`,
          "error", 6000
        );
        return;
      }
      // 2. Assemble payload
      const payload = {
        source: "nuforce",
        source_quote_id: currentQuoteId,
        source_quote_number: qi.opp,
        project: {
          name: jobNum,
          description: combineSpecs(
            combineSpecs(ti.tiSpecs, autoSpecs),
            combineSpecs(ti.tiNotes, autoNotes)
          ),
        },
        project_info: {
          po_number: wonInfo.poNum || null,
          quote_number: qi.opp || null,
          client_name: qi.account || null,
          client_salesforce_id: null,
          primary_contact: {
            full_name: qi.contact || null,
            email: qi.email || null,
            phone: null,
          },
          phase: "Waiting on TP Approval",
          status: "jobprep",
          test_article_description: buildTestArticleDescription(ti),
          dpas: ti.dpas || null,
          cui: ti.docRestriction || null,
          dcas: ti.gsi || null,
          customer_witness: ti.witness || null,
        },
        related_contacts: collectRelatedContacts(qi),
        tasks: collectQuoteLineItems({
          pickerLines, summary, custom, lineOverrides,
          quoteNumber: qi.opp, poNumber: wonInfo.poNum,
        }),
        expenses: collectBudgetExpenses(budget),
      };
      // ── DIAGNOSTIC: log budget state and collected expenses so we can see exactly what we're sending
      console.warn('[EXPENSE-DIAG] budget state:', JSON.stringify(budget));
      console.warn('[EXPENSE-DIAG] payload.expenses:', JSON.stringify(payload.expenses));
      // ── end diagnostic
      // 3. Call the RPC
      const result = await rpcCall('create_project_from_nuforce', { payload });
      if (!result?.project_id) throw new Error("Project creation returned no project_id");
      // 4. Persist the linkage to NUForce's quote row. Best-effort — if it
      // fails, the RPC already succeeded server-side. Log and continue.
      try {
        await restFetch("PATCH",
          `quotes?id=eq.${encodeURIComponent(currentQuoteId)}`,
          {body:{ workspace_project_id: result.project_id }});
      } catch (e) {
        console.error("[WS-LINK] Project created but failed to save workspace_project_id locally:", e?.message||e);
        showToast(
          "Project created in workspace, but couldn't save the link locally. Refresh and try again if needed.",
          "info", 6000
        );
      }
      // 5. Update local state — button swaps to "Open in Workspace ↗"
      setWorkspaceProjectId(result.project_id);
      showToast(
        `✓ Project "${jobNum}" created in NUWorkspace (${result.task_count||0} tasks, ${result.expense_count||0} expenses)`,
        "success", 4500
      );
      // Event 3: notify owners that a job has been opened. The trigger isn't
      // the stage flip to "Closed Won" — it's this moment, when the work
      // actually moves into Workspace as a real project. wonDate comes from
      // wonInfo, which the user filled in on the Won Details modal before
      // clicking Create Project; format is "M/D/YYYY" already.
      try {
        await invokeFunction("send-notification", {
          type: "nuforce_quote_closed_won",
          data: {
            opportunity:  qi.opp || "",
            customer:     qi.account || "",
            total:        money(displayTotal),
            wonDate:      wonInfo?.wonDate || "",
            closedByName: prettifyEmail(currentUser),
            linkUrl:      "https://nuforce.nulabs.com/#dashboard",
          },
        });
      } catch(e) { console.warn("[NOTIFY] quote_closed_won (create project) failed:", e?.message||e); }
    } catch (err) {
      console.error("[WS-CREATE] create project failed:", err);
      const { msg, type, duration } = describeWorkspaceError(err, {
        accountName: (qi.account || "").trim(),
      });
      showToast(msg, type, duration);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // Step A of Add to Existing: look up the project by Job #, show confirmation popup
  const handleAddToExistingLookup = async () => {
    const jobNum = (wonInfo?.jobNum || "").trim();
    if (!jobNum) { showToast("Enter a Job # to find the existing project","error",3500); return; }
    if (!currentQuoteId) { showToast("Save the quote first before adding to a project","error",3500); return; }
    setWorkspaceBusy(true);
    try {
      let lookup;
      try {
        lookup = await rpcCall('lookup_project_by_job_number', { job_number: jobNum });
      } catch (e) {
        showToast("Couldn't look up workspace project: " + (e?.message||e), "error", 6000);
        return;
      }
      if (!lookup?.found) {
        showToast(
          `No project with Job # "${jobNum}" found in workspace. Check the Job # or use Create Project instead.`,
          "error", 6000
        );
        return;
      }
      setShowAppendConfirm({
        project_id: lookup.project_id,
        project_name: lookup.project_name,
        client_company: lookup.client_company,
        existing_task_count: lookup.task_count,
        new_task_count: collectQuoteLineItems({
          pickerLines, summary, custom, lineOverrides,
          quoteNumber: qi.opp, poNumber: wonInfo.poNum,
        }).length,
        new_expense_count: collectBudgetExpenses(budget).length,
      });
    } catch (err) {
      showToast(`Lookup failed: ${err.message || err}`,"error",6000);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // Step B of Add to Existing: user confirmed — actually append
  const handleAddToExistingConfirm = async () => {
    if (!showAppendConfirm) return;
    const target = showAppendConfirm;
    const jobNum = (wonInfo?.jobNum || "").trim();
    setWorkspaceBusy(true);
    try {
      // 0. Persist the current quote state first (same reasoning as handleCreateProject)
      const snapshotLines=(summary.lines||[]).map((l,i)=>{
        const ov=lineOverrides[i]||{};
        if(ov.deleted)return null;
        return {...l, val: ov.price!==undefined ? sf(ov.price,0) : l.val};
      }).filter(Boolean);
      const savedSnapshot={
        lines: snapshotLines, total: displayTotal,
        tiSpecs: ti.tiSpecs||"", tiNotes: ti.tiNotes||"",
        savedAt: new Date().toISOString(),
      };
      const q={id:currentQuoteId,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
        qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId,snapshot:savedSnapshot};
      const savedId = await saveQuoteToSupabase(q, autoSpecs, autoNotes);
      if (!savedId) {
        showToast("Couldn't save quote before adding to project — try saving manually first","error",6000);
        return;
      }
      setSnapshot(savedSnapshot);
      setIsDirty(false);
      const payload = {
        source: "nuforce",
        source_quote_id: currentQuoteId,
        source_quote_number: qi.opp,
        project: { name: jobNum },
        // Mirror handleCreateProject by sending project_info so Workspace can
        // append this quote's number (and PO #) to the existing project's
        // metadata. For append, we deliberately only send fields that make
        // sense to add — quote_number and po_number — rather than overwriting
        // the project's primary contact, description, status, etc.
        project_info: {
          po_number:    wonInfo.poNum || null,
          quote_number: qi.opp || null,
        },
        tasks: collectQuoteLineItems({
          pickerLines, summary, custom, lineOverrides,
          quoteNumber: qi.opp, poNumber: wonInfo.poNum,
        }),
        expenses: collectBudgetExpenses(budget),
      };
      let result;
      try {
        result = await rpcCall('append_to_project_from_nuforce', { payload });
      } catch (e) {
        throw e;
      }
      // Persist the workspace_project_id linkage locally. Best-effort — if it
      // fails, the RPC already succeeded server-side, so we log and move on
      // rather than aborting the user-visible success flow.
      try {
        await restFetch("PATCH",
          `quotes?id=eq.${encodeURIComponent(currentQuoteId)}`,
          {body:{ workspace_project_id: result.project_id }});
      } catch (e) {
        console.error("[WS-LINK] Append succeeded but failed to save link locally:", e?.message||e);
      }
      setWorkspaceProjectId(result.project_id);
      setShowAppendConfirm(null);
      showToast(
        `✓ Added to "${target.project_name}" (${result.tasks_added||0} tasks, ${result.expenses_added||0} expenses)`,
        "success", 4500
      );
      // Event 3: same as Create Project — owners get the "job opened" notification.
      try {
        await invokeFunction("send-notification", {
          type: "nuforce_quote_closed_won",
          data: {
            opportunity:  qi.opp || "",
            customer:     qi.account || "",
            total:        money(displayTotal),
            wonDate:      wonInfo?.wonDate || "",
            closedByName: prettifyEmail(currentUser),
            linkUrl:      "https://nuforce.nulabs.com/#dashboard",
          },
        });
      } catch(e) { console.warn("[NOTIFY] quote_closed_won (add to existing) failed:", e?.message||e); }
    } catch (err) {
      console.error("[WS-APPEND] add to existing failed:", err);
      const { msg, type, duration } = describeWorkspaceError(err, {
        accountName: (qi.account || "").trim(),
        actionLabel: "add to the existing project",
      });
      showToast(msg, type, duration);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // Open the linked workspace project. When a Job # is present we treat Workspace
  // as the source of truth and re-resolve the project by Job # on every click —
  // this self-heals a stale cached UUID (e.g. the project was deleted/recreated),
  // which is what caused "Open in Workspace" to land on a blank page. We only fall
  // back to the cached UUID when there's no Job # to resolve from, or when the
  // lookup itself is unreachable (offline).
  const handleOpenInWorkspace = async () => {
    const openProject = (id) =>
      window.open(`https://workspace.nulabs.com/#project/${id}/info`, "_blank", "noopener,noreferrer");
    const jobNum = (wonInfo?.jobNum || "").trim();

    // No Job # to resolve from — fall back to the cached link if we have one.
    if (!jobNum) {
      if (workspaceProjectId) { openProject(workspaceProjectId); return; }
      showToast("No Job # on this quote to open in workspace","error",3500);
      return;
    }

    setWorkspaceBusy(true);
    try {
      let lookup;
      try {
        lookup = await rpcCall('lookup_project_by_job_number', { job_number: jobNum });
      } catch (e) {
        // Lookup unreachable — fall back to the cached link rather than blocking.
        if (workspaceProjectId) { openProject(workspaceProjectId); return; }
        showToast(`Couldn't look up the workspace project: ${e?.message || e}`,"error",6000);
        return;
      }
      if (!lookup?.found || !lookup?.project_id) {
        // Authoritative "no project for this Job #" — do NOT open a stale cached UUID
        // (that's the blank-page bug). Point the user at the right recovery action.
        showToast(`No workspace project found for Job # "${jobNum}". It may have been deleted or not created yet — use Create Project or Add to Existing.`,"error",7000);
        return;
      }
      // Self-heal: if the resolved project differs from what's cached, update state + DB.
      if (lookup.project_id !== workspaceProjectId) {
        setWorkspaceProjectId(lookup.project_id);
        if (currentQuoteId) {
          restFetch("PATCH",
            `quotes?id=eq.${encodeURIComponent(currentQuoteId)}`,
            {body:{ workspace_project_id: lookup.project_id }})
            .catch(e => console.warn("[WS-LINK-CACHE] failed:", e?.message||e));
        }
      }
      openProject(lookup.project_id);
    } catch (err) {
      showToast(`Couldn't open workspace project: ${err.message || err}`,"error",6000);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // Edge case: clear the workspace link (does NOT delete the workspace project, just unlinks here)
  const handleClearWorkspaceLink = async () => {
    if (!currentQuoteId) return;
    setWorkspaceBusy(true);
    try {
      await restFetch("PATCH",
        `quotes?id=eq.${encodeURIComponent(currentQuoteId)}`,
        {body:{ workspace_project_id: null }});
      setWorkspaceProjectId(null);
      setShowClearLinkConfirm(false);
      showToast("Workspace link cleared. Buttons re-enabled.","info",3500);
    } catch (err) {
      showToast(`Clear link failed: ${err.message || err}`,"error",6000);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  // Delete current quote from Supabase
  const handleDeleteQuote=async()=>{
    if(!currentQuoteId){alert("This quote hasn't been saved yet — nothing to delete.");return;}
    const confirmed=window.confirm("Are you sure you want to delete this quote? You cannot retrieve it once deleted.");
    if(!confirmed)return;
    try {
      await deleteQuoteFromSupabase(currentQuoteId);
      setCurrentQuoteId(null);
      localStorage.removeItem("vibrato_last_quote_id");
      alert("Quote deleted.");
    } catch(e) {
      alert("Delete failed: " + (e?.message||e));
    }
  };

  // Load quote from search
  const handleLoad=q=>{
    isLoadingRef.current=true; accountEditedRef.current=false; // suppress isDirty during load
    // Pre-seed prevAutoSpecs/prevAutoNotes so the sync useEffect doesn't re-append
    // on load (the saved tiSpecs already contains the auto-generated text)
    const loadedAutoSpecs=buildSpecs(
      q.vibs||[newVib()], q.shocks||[newShock()], q.noises||[newNoise()],
      q.envs||[newEnv()], q.hfvs||[newHfv()], q.shos||[newSho()],
      q.dcms||[newDcm()], q.emis||[newEmi()], q.pqs||[newPq()],
      q.abs||[newAb()], q.sbs||[newSb()]
    );
    prevAutoSpecs.current=loadedAutoSpecs;
    insertedAutoSpecs.current=loadedAutoSpecs;
    userEditedSpecs.current=false; // reset on load
    // Pre-seed autoNotes the same way — compute from loaded tests so the
    // guard fires correctly and doesn't re-append on load
    const loadedAutoNotes=(()=>{
      const lines=[];
      const n=q.noises||[newNoise()];
      const p=q.pqs||[newPq()];
      const e=q.emis||[newEmi()];
      const im=q.inStockModal||{on:false};
      const ma=q.modalAnalysis||{on:false};
      const fd=q.fixtureDrawing||{on:false};
      if(n.some(s=>s.on))lines.push("Frequencies below 100Hz to be performed as a best effort. All cabling that connects to the unit should be a minimum of 20 feet unless otherwise discussed.");
      if(n.some(s=>s.on&&s.level==="170dB"))lines.push("OASPLs greater than 170dB will be performed as a best effort.");
      if(p.some(s=>s.on&&s.cw))lines.push("Current Waveform testing performed using facility power.");
      if(e.some(s=>s.on))lines.push("EMI Notes:\n* This quote assumes that the susceptibility criteria can be determined in less than 3 seconds during real-time operation of the EUT, and that if additional monitoring personnel are needed, they would be provided by the customer. Customer to supply cables and all peripheral and monitoring equipment, and one mode of operation (operating or standby). Susceptibility determination provided by the customer. Pricing is based on customer-supplied information, the assumptions listed here, and acceptance of an approved test procedure.\n* Pricing and feasibility may be reevaluated upon completion and review of the NU Laboratories Test Configuration Form.\n* This quote assumes that the number of cables and outside diameter of the cables under test are within NU Laboratories capabilities/limitations.\n* Pricing assumes the standard list of tests from MIL-STD-461G, and that all testing is performed at NU Labs. Any tests requiring subcontracting will incur additional charges.");
      if(im?.on)lines.push("The test procedure will include an in-stock modal analysis of the proposed test fixture. Any additional analysis or alterations to the proposed test setup or fixture may incur additional charges.");
      if(ma?.on)lines.push("The modal analysis reflects the initial run of the analysis. Additional runs may incur additional charges.");
      if(fd?.on)lines.push("Test fixture drawings represent the initial design. Alterations to the design of the proposed test fixture may incur additional charges. These changes also may affect the price of test fixture fabrication.");
      lines.push("Refer to the notes section at the bottom of this quote for additional details.");
      return lines.join("\n\n");
    })();
    prevAutoNotes.current=loadedAutoNotes;
    insertedAutoNotes.current=loadedAutoNotes;
    userEditedNotes.current=false; // reset on load
    if(q.qi)setQi(q.qi);
    if(q.ti)setTi(q.ti);
    if(q.vibs)setVibs(q.vibs);
    if(q.shocks)setShocks(q.shocks);
    if(q.noises){
      // Recalculate noise testing prices on load in case compBudget was saved as "0"
      // but the level requires a compressor (saved before compressor logic existed)
      const COMP_COST_LOAD={"<=140dB":0,"145dB":750,"150dB":1500,"155dB":1500,"160dB":1500,"165dB":2000,"170dB":3500};
      const fixedNoises=q.noises.map(n=>{
        if(!n.on)return n;
        const ac=COMP_COST_LOAD[n.level]||0;
        if(ac>0&&(n.compBudget==="0"||!n.compBudget)){
          return {...n, compBudget:String(ac),
            testing:String(noiseTestingPrice(n.durVal,n.durUnit,n.level,ac))};
        }
        return n;
      });
      setNoises(fixedNoises);
    }
    if(q.envs)setEnvs(q.envs);
    if(q.hfvs)setHfvs(q.hfvs);
    if(q.shos)setShos(q.shos);
    if(q.dcms)setDcms(q.dcms);
    if(q.pqs)setPqs(q.pqs);
    if(q.emis)setEmis(q.emis);
    if(q.abs)setAbs(q.abs);
    if(q.sbs)setSbs(q.sbs);
    if(q.globalPR)setGlobalPR(q.globalPR);
    if(q.splitProcReport!==undefined)setSplitProcReport(q.splitProcReport);
    if(q.modalAnalysis)setModalAnalysis(q.modalAnalysis); else setModalAnalysis({on:false,price:"6750"});
    if(q.fixtureDrawing)setFixtureDrawing(q.fixtureDrawing); else setFixtureDrawing({on:false,price:"2950"});
    if(q.inStockModal)setInStockModal(q.inStockModal); else setInStockModal({on:false,targetProc:""});
    if(q.notes)setNotes(q.notes);
    if(q.inst)setInst(q.inst);
    if(q.ot)setOt(q.ot);
    if(q.custom)setCustom(q.custom);
    if(q.budget)setBudget(q.budget);
    // coc now in globalPR
    if(q.sub)setSub(q.sub);
    if(q.td)setTd(q.td);
    if(q.setup)setSetup(q.setup);
    if(q.approval)setApproval(q.approval); else setApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:"",history:[]});
    if(q.wonApproval)setWonApproval(q.wonApproval); else setWonApproval({status:"none",submittedBy:"",submittedAt:"",decidedBy:"",decidedAt:"",comments:""});
    if(q.wonInfo)setWonInfo(q.wonInfo); else setWonInfo({wonDate:"",jobNum:"",poNum:""});
    setLoadedJobNum((q.wonInfo?.jobNum||"").trim()); // remember the persisted Job # for button logic
    setWonDatePending(false); // Loaded quotes are already trusted; no re-confirmation needed
    setChatterEntries(q.chatterEntries||[]);
    if(q.lineOrder!==undefined)setLineOrder(q.lineOrder); else setLineOrder(null);
    {const wd=q.wonInfo?.wonDate||"";const validDate=wd&&!isNaN(new Date(wd))&&!/^\d+$/.test(wd.trim());setWonLocked(!!(validDate||q.wonInfo?.jobNum?.trim()||q.wonInfo?.poNum?.trim()));}
    setCurrentQuoteId(q.id||null);
    if(q.id){localStorage.setItem("vibrato_last_quote_id",String(q.id));}
    setCurrentQuoteSource(q.source||"nuforce");
    if(q.source==="salesforce")setLocked(true);
    // Load snapshot and clear dirty flag
    setSnapshot(q.snapshot||null);
    setIsDirty(false);
    // Validate lineOverrides on load:
    // - Deleted flags: keep only if the stored label exists somewhere in the saved summary
    //   (not necessarily at the same index — indices shift when tests change)
    // - Price/desc overrides: keep as-is
    setPickerLines(q.pickerLines||[]); setUnifiedOrder(q.unifiedOrder||null);
    // Workspace project linkage — pulled from the quote row (top-level column, not in data blob)
    setWorkspaceProjectId(q.workspace_project_id||null);
    setShowAppendConfirm(null);
    setShowClearLinkConfirm(false);
    if(q.lineOverrides!==undefined){
      const savedLines=q.summary?.lines||[];
      // Build a set of all labels in the saved summary for O(1) lookup
      const savedLabelSet=new Set(savedLines.map(l=>l.label));
      // Also build a label->index map so we can remap to the correct current index
      const savedLabelToIdx={};
      savedLines.forEach((l,i)=>{ savedLabelToIdx[l.label]=i; });
      const validated={};
      Object.entries(q.lineOverrides).forEach(([k,ov])=>{
        if(ov?.deleted){
          const storedLabel=ov.label;
          // Drop deletions with no stored label — can't verify
          if(!storedLabel) return;
          // Keep deletion if the label exists in saved summary — remap to correct index
          if(savedLabelSet.has(storedLabel)){
            const correctIdx=savedLabelToIdx[storedLabel];
            validated[String(correctIdx)]={...ov};
          }
          // else: label no longer exists in summary — drop silently
        } else {
          validated[k]=ov; // keep price/desc overrides as-is
        }
      });
      setLineOverrides(validated);
    } else {
      setLineOverrides({});
    }
    // Release loading lock after React has batched all state updates
    setTimeout(()=>{ isLoadingRef.current=false; }, 50);
    // ── Salesforce imported quotes: load line items into custom section ──
    // Only populate from SF data if the user hasn't already saved custom rows
    if(q.source==="salesforce"&&!(q.custom?.rows?.length>0)){
      const sfLines=(q.summary?.lines||[]).filter(l=>l.val>0);
      if(sfLines.length>0){
        setCustom({on:true,rows:sfLines.map(l=>({
          label:l.label||"Line Item",
          price:String(Math.round(l.val)),
          pcode:l.code||"",
        }))});
      }
      // wonInfo is already loaded from the blob at line 4165 above — no need to re-apply here
    }
  };
  // Keep ref pointing at latest handleLoad so realtime toast button can call it
  reloadOpenQuoteRef.current = async (id)=>{
    try {
      const rows = await restFetch("GET",
        `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(id)}&limit=1`);
      const row = (rows||[])[0];
      if(!row)return;
      const q=row.data||{};
      handleLoad({...q,id:row.id,opp:row.opportunity||q.opp,
        customer:row.customer||q.customer,rfq:row.rfq||q.rfq,
        total:row.total??q.total,savedAt:row.updated_at,
        source:row.source||"nuforce",
        approval:{...(q.approval||{}),status:row.approval_status||q.approval?.status||"none"},
        wonApproval:{...(q.wonApproval||{}),status:row.won_approval_status||q.wonApproval?.status||"none"},
      });
      showToast("Quote reloaded ✓","success");
    } catch(e) {
      console.warn("[RELOAD-QUOTE] failed:", e?.message||e);
    }
  };

  const setupProps={setup};

  // ── PDF Logo (dark text, transparent bg for white PDF background) ──
  const NU_LOGO_PDF = "data:image/png;base64,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";

  
  const JORDAN_SIG_PDF = "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAQABgADASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAcIBgkBBAUDAv/EAE4QAAIBAwMCBAMEBwUFBgUCBwABAgMEBQYHERIhCDFBURMiYRQyQnEJI1JicoGRFRYzgqEXJEOSoiVTY3ODsTQ1o7KzwVSTGETC0dLh/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=";
  // ── Restore last open quote on refresh ──────────────────────────────────────
  useEffect(()=>{
    const lastId=localStorage.getItem("vibrato_last_quote_id");
    if(!lastId)return;
    (async()=>{
      try {
        const rows = await restFetch("GET",
          `quotes?select=id,opportunity,customer,rfq,revision,stage,total,approval_status,won_approval_status,updated_at,data,source&id=eq.${encodeURIComponent(lastId)}&limit=1`);
        const data = (rows||[])[0];
        if(!data)return;
        const q=data.data||{};
        const restored={
          ...q,
          id:data.id,
          opp:data.opportunity||q.opp,
          customer:data.customer||q.customer,
          rfq:data.rfq||q.rfq,
          total:data.total??q.total,
          savedAt:data.updated_at,
          source:data.source||"nuforce",
          approval:{...(q.approval||{}),status:data.approval_status||q.approval?.status||"none"},
        };
        handleLoad(restored);
      } catch(e) {
        console.warn("[RESTORE-LAST] failed:", e?.message||e);
      }
    })();
  },[]);

const STANDARD_TERMS = [
    "All work to be performed during normal business hours unless specifically noted on this quote.",
    "Customer is to supply all installation hardware, cables, hoses, mating connections for power or fluid, electrical/resistive and dummy loads, and specialized monitoring equipment/peripheral equipment unless other arrangements with NU Laboratories, Inc. have been made. No functional testing shall be performed by NU Laboratories or its personnel unless specifically addressed in our quotation.",
    "All equipment, including the UUT, support equipment, test fixtures, mounting brackets, etc. are to be delivered to NU Laboratories no later than (5) business days prior to the scheduled testing start date.",
    "Return shipping arrangements are to be provided prior to the start of testing. If not, storage charges will apply beginning (5) business days after the completion of testing.",
    "If applicable, all import and export documentation is to be provided by the customer.",
    "Out of scope work including additional efforts and standby charges are to be determined at NU Laboratories' discretion and will be quoted separately.",
    "This quote does not guarantee a specific testing schedule, nor does it represent a fixed number of testing days. Scheduling will be secured with the receipt of a purchase order and/or test procedure approval.",
    "The provided quote is based on a pass scenario and does not account for any additional time required due to test item malfunctions or failures. Should the customer's representative request a retest or engineering evaluation, a separate quote will be issued.",
    "Any requested lead times are estimated and may be subject to change.",
    "This quote is based on a total purchase and is good for a period of 90 days.",
    "All hardware provided by NU Laboratories is assumed to be SAE Grade 5. All fixturing provided by NU Laboratories is assumed to be A36 Steel. All other hardware and fixture requirements will be quoted separately if not detailed on this quote.",
  ];

  // ── Calculator EMI/PQ PDF adapters ──────────────────────────────────────────
  // These adapt calculator state to the existing PDF builders which read from App scope
  // by temporarily injecting the calculator data as the active EMI/PQ instance

  const exportCalcEmi461fPDF = async (calcState) => {
    if(window.jspdf){await buildEmi461fPDF(calcState);return;}
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>buildEmi461fPDF(calcState);
    document.head.appendChild(s);
  };

  const exportCalcEmi461gPDF = async (calcState) => {
    if(window.jspdf){await buildEmi461gPDF(calcState);return;}
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>buildEmi461gPDF(calcState);
    document.head.appendChild(s);
  };

  const exportCalcPq300bPDF_calc = async (calcState) => {
    if(window.jspdf){await buildPq300bPDF(calcState);return;}
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>buildPq300bPDF(calcState);
    document.head.appendChild(s);
  };

  const exportCalcPq300Part1PDF_calc = async (calcState) => {
    if(window.jspdf){await buildPq300Part1PDF(calcState);return;}
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>buildPq300Part1PDF(calcState);
    document.head.appendChild(s);
  };

  const loadJsPDF = (cb) => {
    // Load jsPDF then autotable, always in sequence to be safe
    const doLoad = () => {
      const s2=document.createElement("script");
      s2.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      s2.onload=()=>{ try{cb();}catch(e){console.error('PDF build error:',e);} };
      document.head.appendChild(s2);
    };
    if(window.jspdf&&(window.jspdf.jsPDF||window.jspdf.default)){
      doLoad(); return;
    }
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload=doLoad;
    document.head.appendChild(s);
  };

  const exportPDF = async () => { loadJsPDF(()=>buildPDF(false)); };
  const exportBudgetPDF = async () => { loadJsPDF(()=>buildPDF(true)); };

  // Classic Spec Builder launcher — opens the standalone HTML tool in a new
  // tab with the current quote number prefilled via URL query string.
  const openClassicSpecBuilder = () => {
    const q = encodeURIComponent(qi?.opp || "");
    const url = q ? `/classic-spec-builder.html?quote=${q}` : `/classic-spec-builder.html`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Spec Builder from Quote — builds a payload of pre-filled sections (one per
  // active test module: EMI 461F, etc.) and writes to localStorage. The HTML
  // tool reads the payload on init when launched with ?mode=from-quote.
  // Phase 2 scope: EMI 461F only. 461G/PQ/DCM in later phases.
  const buildSpecBuilderPayload = () => {
    const sections = [];

    // Pull current EMI calc state from the PricingCalculator (where the user
    // actually enters their EMI selections). emis[] (Advanced Mode) is parallel
    // and unused — checking it first finds nothing.
    const emiCalc = pricingCalcStateRef.current?.emiCalc;
    if (emiCalc) {
      // What revs did the user pick? Default to F if neither selected
      // (matches PDF button display logic at lines 8146/8158).
      const hasF = !!emiCalc.revs?.['Rev F'];
      const hasG = !!emiCalc.revs?.['Rev G'];
      const includeF = hasF || (!hasF && !hasG); // F is the default
      const includeG = hasG;

      // Selected test keys (shared between F and G; the user picks one set
      // and the rev definitions interpret them differently).
      const selectedKeys = new Set();
      Object.entries(emiCalc.tests || {}).forEach(([k,v]) => { if (v) selectedKeys.add(k); });

      // Helper: build the rows for a given rev's definitions
      const rowsForRev = (defs) => {
        const selected = defs.filter(r => selectedKeys.has(r.key));
        return selected.map(r => {
          let desc = r.desc;
          if (r.positions && r.positions.length > 0) {
            const pl = r.positions.map(p => "  " + p.range + ": " + p.pos).join("\n");
            desc = desc + "\n" + pl;
          }
          return [r.key, r.label, desc];
        });
      };

      if (includeF && selectedKeys.size > 0) {
        const fRows = rowsForRev(getEmi461fTestDefinitions(emiCalc, ti, setup));
        if (fRows.length > 0) sections.push({ type: "EMI", rows: fRows });
      }
      if (includeG && selectedKeys.size > 0) {
        const gRows = rowsForRev(getEmi461gTestDefinitions(emiCalc, ti, setup));
        if (gRows.length > 0) sections.push({ type: "EMI", rows: gRows });
      }
    }

    // Phase 4: PQ 300B + PQ 300 Part 1. Both standards share the same
    // pqCalc.rows selection object — 300B uses keys prefixed with "B"
    // (e.g. "B5.3.1") while 300P1 uses unprefixed (e.g. "5.3.1"). Emit
    // a separate "Power Quality" section per standard that has any
    // selections, matching how the in-app PDF builders organize them.
    const pqCalc = pricingCalcStateRef.current?.pqCalc;
    if (pqCalc && pqCalc.rows) {
      const pqSelectedKeys = new Set();
      Object.entries(pqCalc.rows).forEach(([k,v]) => { if (v) pqSelectedKeys.add(k); });
      if (pqSelectedKeys.size > 0) {
        // Helper: map each PQ test definition to a 3-column row.
        // PQ test rows have key/label/req/ref/note; the Spec Builder uses
        // [TEST, DESCRIPTION, COMMENTS]. Combine req + ref into the
        // comments column so the engineer sees the requirement along with
        // its table/figure reference. Notes are dropped (per the same
        // policy as EMI — they were removed earlier as user-decided).
        //
        // The leading "B" on 300B keys (e.g. "B5.3.1") is stripped for the
        // Spec Builder display only — the PDF builder and calc UI continue
        // to use the prefixed keys so 300B/300P1 stay distinguishable in
        // pqCalc.rows. Stripping it in the user-facing output matches how
        // MIL-STD-1399 paragraph numbers are normally cited.
        const pqRowsFromDefs = (defs) => defs
          .filter(r => pqSelectedKeys.has(r.key))
          .map(r => {
            const parts = [];
            if (r.req) parts.push(r.req);
            if (r.ref) parts.push("Tables / Figures: " + r.ref);
            const displayKey = r.key.startsWith("B") ? r.key.slice(1) : r.key;
            return [displayKey, r.label, parts.join("\n")];
          });
        const b3Rows = pqRowsFromDefs(getPq300bTestDefinitions());
        if (b3Rows.length > 0) sections.push({ type: "Power Quality", rows: b3Rows });
        const p1Rows = pqRowsFromDefs(getPq300p1TestDefinitions());
        if (p1Rows.length > 0) sections.push({ type: "Power Quality", rows: p1Rows });
      }
    }

    // Phase 5: DC Magnetics. Unlike EMI/PQ, DC Mag has no per-test selection
    // mechanism — the standard is one fixed test set (DOD-STD-1399 Section 070,
    // 1,600 A/m, three orthogonal positions). Including it in the spec output
    // is gated by an explicit "Include DC Magnetics" checkbox in the calc UI
    // (dcmCalc.include) so it doesn't leak into quotes that aren't DC Mag jobs.
    const dcmCalc = pricingCalcStateRef.current?.dcmCalc;
    if (dcmCalc && dcmCalc.include) {
      sections.push({
        type: "DC Magnetics",
        rows: [
          [
            "DC Magnetics",
            "DOD-STD-1399 Section 070",
            "Field Strength: 1,600 A/m. Positions: Three (3) orthogonal positions.",
          ],
        ],
      });
    }

    return { quote: qi?.opp || "", sections };
  };

  const openSpecBuilderFromQuote = () => {
    const payload = buildSpecBuilderPayload();
    try {
      localStorage.setItem("nuforce_spec_builder_payload", JSON.stringify(payload));
    } catch (e) {
      console.warn("[SPEC-BUILDER] localStorage write failed:", e?.message || e);
      // Continue anyway — the HTML will just show empty if no payload
    }
    const q = encodeURIComponent(qi?.opp || "");
    const url = q
      ? `/classic-spec-builder.html?quote=${q}&mode=from-quote`
      : `/classic-spec-builder.html?mode=from-quote`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Build the Spec Builder payload from the CRR workup data. Mirrors
  // buildSpecBuilderPayload but reads from crrWorkup.data.specRows instead
  // of from the PricingCalculator's calc state. Maps CRR's 4-col EMI/DCM
  // and 5-col PQ row structures into the HTML's 3-col [test, label, comments]
  // format.
  const buildSpecBuilderPayloadFromCrr = () => {
    const sections = [];
    if (!crrWorkup || crrWorkup === false || !crrWorkup.data) return { quote: qi?.opp || "", sections };
    const data = crrWorkup.data;
    const enabled = data.enabledSpecs || {};
    const allRows = data.specRows || {};

    // Spec inclusion rule (matches calc CRR view): only include rows where
    // the Time cell contains a clean numeric value. Tests with blank or
    // non-numeric time ("TBD", "1 day", "depends on customer") are excluded
    // since the tech hasn't committed a duration to them yet.
    // Time column: index 2 for EMI/DC Mag (4-col), index 1 for PQ (5-col).
    const isNumeric = s => /^\s*\d+(?:\.\d+)?\s*$/.test(String(s || ""));
    const filterByTime = (rows, timeIdx) => (rows || []).filter(r =>
      Array.isArray(r) && isNumeric(r[timeIdx])
    );

    // EMI 461F: CRR cols are [Test, Description, Time, Comments] → drop Time
    if (enabled.emi461f) {
      const rows = filterByTime(allRows.emi461f, 2).map(r => [
        String(r[0] || ""),
        String(r[1] || ""),
        String(r[3] || ""),
      ]);
      if (rows.length > 0) sections.push({ type: "EMI", rows });
    }
    // EMI 461G: same mapping
    if (enabled.emi461g) {
      const rows = filterByTime(allRows.emi461g, 2).map(r => [
        String(r[0] || ""),
        String(r[1] || ""),
        String(r[3] || ""),
      ]);
      if (rows.length > 0) sections.push({ type: "EMI", rows });
    }
    // PQ 300B: CRR cols are [Requirement, Time, 1399 Paragraph, Test Requirement, Tables/Figures]
    // Map to [test=paragraph, label=requirement, comments=testReq + tables]
    const mapPq = arr => filterByTime(arr, 1).map(r => {
      const paragraph = String(r[2] || "");
      const requirement = String(r[0] || "");
      const testReq = String(r[3] || "");
      const tables = String(r[4] || "");
      const parts = [];
      if (testReq) parts.push(testReq);
      if (tables) parts.push("Tables / Figures: " + tables);
      return [paragraph, requirement, parts.join("\n")];
    });
    if (enabled.pq300b) {
      const rows = mapPq(allRows.pq300b);
      if (rows.length > 0) sections.push({ type: "Power Quality", rows });
    }
    if (enabled.pq300p1) {
      const rows = mapPq(allRows.pq300p1);
      if (rows.length > 0) sections.push({ type: "Power Quality", rows });
    }
    // DC Mag: same 4-col mapping as EMI
    if (enabled.dcmag) {
      const rows = filterByTime(allRows.dcmag, 2).map(r => [
        String(r[0] || ""),
        String(r[1] || ""),
        String(r[3] || ""),
      ]);
      if (rows.length > 0) sections.push({ type: "DC Magnetics", rows });
    }

    return { quote: qi?.opp || "", sections };
  };

  const openSpecBuilderFromCrr = () => {
    if (!crrWorkup || crrWorkup === false) {
      alert("No CRR workup found for quote " + (qi?.opp || "(unset)") +
            ". Create one in Workspace first.");
      return;
    }
    const payload = buildSpecBuilderPayloadFromCrr();
    if (payload.sections.length === 0) {
      if (!confirm("The CRR workup exists but has no enabled spec tables with content. Open the Spec Builder anyway with a blank section?")) {
        return;
      }
    }
    try {
      localStorage.setItem("nuforce_spec_builder_payload", JSON.stringify(payload));
    } catch (e) {
      console.warn("[SPEC-BUILDER] localStorage write failed:", e?.message || e);
    }
    const q = encodeURIComponent(qi?.opp || "");
    const url = q
      ? `/classic-spec-builder.html?quote=${q}&mode=from-quote`
      : `/classic-spec-builder.html?mode=from-quote`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Popup menu state for the unified "Spec Builder ↗" button
  const [specBuilderMenuOpen, setSpecBuilderMenuOpen] = useState(false);

  const exportDcMagPDF = async () => {
    if(window.jspdf){await buildDcMagPDF();return;}
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => buildDcMagPDF();
    document.head.appendChild(script);
  };

  const buildDcMagPDF = async () => {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED = [192,57,43], DARK = [30,30,30], MUTED = [100,100,100], LIGHT = [240,240,240], GREEN = [22,101,52];
    let y = 44;

    const setF = (style, size, color) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...(color||DARK));
    };
    const drawFooter = () => {
      setF('normal', 8, MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''), ML, PH-18);
      doc.text('Page 1 | '+(qi.revDate||qi.date||''), PW-MR, PH-18, {align:'right'});
      doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
      doc.line(ML, PH-26, PW-MR, PH-26);
    };

    // ── Header ──
    try { doc.addImage(NU_LOGO_PDF, 'PNG', ML, y, 180, 40); }
    catch(e) { setF('bold', 14, RED); doc.text('NU LABORATORIES', ML, y+28); }
    setF('normal', 8.5, DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i) => doc.text(l, PW-MR, y+14+i*11, {align:'right'}));
    y += 54;
    doc.setDrawColor(...RED); doc.setLineWidth(1.5);
    doc.line(ML, y, PW-MR, y);
    y += 18;

    // ── Title block ──
    setF('bold', 13, DARK); doc.text('DC MAGNETICS', ML, y);
    setF('normal', 8.5, MUTED); doc.text('Test Specifications', ML, y+13);
    setF('normal', 9, MUTED); doc.text('Date: '+(qi.revDate||qi.date||''), PW-MR, y, {align:'right'});
    if(qi.opp){ setF('bold',9,DARK); doc.text(qi.opp, PW-MR, y+13, {align:'right'}); }
    y += 34;
    doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
    doc.line(ML, y, PW-MR, y);
    y += 18;

    // ── Test Item Details ──
    doc.setFillColor(...LIGHT);
    doc.rect(ML, y-2, TW, 18, 'F');
    doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
    setF('bold', 9, RED); doc.text('TEST ITEM', ML+10, y+10);
    y += 22;

    const sizeStr = [ti.dimL&&ti.dimL+'"', ti.dimW&&ti.dimW+'"', ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
    const pwrParts = [ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'), ti.phase&&ti.phase+' Ph', ti.hz&&ti.hz+' Hz', ti.amps&&ti.amps+' A'].filter(Boolean);

    const tiRows = [
      ['Unit', ti.item],
      ['Dimensions', sizeStr],
      ['Weight', ti.wt&&ti.wt+' lbs'],
      ['Power', pwrParts.join(', ')],
    ].filter(r=>r[1]);

    tiRows.forEach(([label, value], i) => {
      doc.setFillColor(...(i%2===0?[255,255,255]:[247,248,250]));
      doc.rect(ML, y-2, TW, 16, 'F');
      setF('bold', 9, MUTED); doc.text(label, ML+8, y+9);
      setF('normal', 9, DARK); doc.text(String(value), ML+110, y+9);
      y += 16;
    });
    y += 16;

    // ── Test Specification block ──
    doc.setFillColor(...LIGHT);
    doc.rect(ML, y-2, TW, 18, 'F');
    doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
    setF('bold', 9, RED); doc.text('TEST SPECIFICATION', ML+10, y+10);
    y += 28;

    // Spec box — clean bordered card, no fill
    doc.setFillColor(247,248,250);
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.5);
    doc.rect(ML, y, TW, 90, 'FD');
    doc.setFillColor(...RED); doc.rect(ML, y, 3, 90, 'F');

    setF('bold', 11, DARK); doc.text('DC Magnetics', ML+14, y+18);
    setF('normal', 8.5, MUTED); doc.text('DOD-STD-1399 Section 070', ML+14, y+30);

    doc.setDrawColor(220,220,220); doc.setLineWidth(0.4);
    doc.line(ML+14, y+38, ML+TW-14, y+38);

    const specRows=[['Field Strength','1,600 A/m'],['Positions','Three (3) orthogonal positions']];
    specRows.forEach(([lbl,val],i)=>{
      setF('normal',9,MUTED); doc.text(lbl+':', ML+14, y+52+i*18);
      setF('bold',9,DARK);    doc.text(val,          ML+110, y+52+i*18);
    });
    y += 106;

    // ── General Notes ──
    y += 8;
    doc.setFillColor(...LIGHT);
    doc.rect(ML, y-2, TW, 18, 'F');
    doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
    setF('bold', 9, RED); doc.text('GENERAL NOTES', ML+10, y+10);
    y += 20;
    const generalNotes = [
      'Pricing is based on customer-supplied information and the assumptions listed herein.',
      'Feasibility of testing will be reviewed upon receipt of a purchase order and/or test procedure approval.',
      'The number of tests required for each test method and/or the number of test positions listed in this document are estimated values. Exact quantities will be determined and documented in the approved test procedure.',
    ];
    setF('normal', 9, DARK);
    generalNotes.forEach(note => {
      const w = doc.splitTextToSize('*  ' + note, TW - 10);
      checkY(w.length*13+6);
      doc.text(w, ML+6, y); y += w.length*13+6;
    });
    y += 4;

    // ── DCM instances — spec fields if filled ──
    const activeDcms = dcms.filter(s=>s.on);
    if(activeDcms.length>0 && activeDcms.some(s=>s.spec)){
      y += 8;
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y-2, TW, 18, 'F');
      doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
      setF('bold', 9, RED); doc.text('ADDITIONAL NOTES', ML+10, y+10);
      y += 22;
      activeDcms.forEach((s,i)=>{
        if(!s.spec) return;
        const label = activeDcms.length>1 ? 'Unit #'+(i+1)+(s.identifier?' ('+s.identifier+')':'') : 'Specification';
        setF('bold',9,MUTED); doc.text(label+':', ML+8, y);
        setF('normal',9,DARK); doc.text(s.spec, ML+110, y);
        y += 14;
      });
    }

    drawFooter();
    const fname = (qi.opp||'DC-Mag-Specs')+'.pdf';
    await savePdfAs(doc, fname);
  };

  const exportPq300bPDF = async () => {
    if(window.jspdf){await buildPq300bPDF();return;}
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => buildPq300bPDF();
    document.head.appendChild(script);
  };

  const buildPq300bPDF = async (pqOverride=null) => {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED = [192,57,43], DARK = [30,30,30], MUTED = [100,100,100], LIGHT = [240,240,240], BLUE = [26,82,118];
    let y = 44;
    let pageNum = 1;

    const setF = (style, size, color) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...(color||DARK));
    };
    const checkY = (need) => {
      if(y + (need||20) > PH - 52){
        drawFooter();
        doc.addPage();
        pageNum++;
        y = 54;
      }
    };
    const drawFooter = () => {
      const p = doc.internal.getCurrentPageInfo().pageNumber;
      setF('normal', 8, MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''), ML, PH-18);
      doc.text('Page '+p+' | '+(qi.revDate||qi.date||''), PW-MR, PH-18, {align:'right'});
      doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
      doc.line(ML, PH-26, PW-MR, PH-26);
    };
    const sectionHdr = (title) => {
      checkY(28);
      y += 8;
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y-2, TW, 18, 'F');
      doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
      setF('bold', 9, RED); doc.text(title.toUpperCase(), ML+10, y+10);
      y += 22;
    };

    // ── Header ──
    try { doc.addImage(NU_LOGO_PDF, 'PNG', ML, y, 180, 40); }
    catch(e) { setF('bold', 14, RED); doc.text('NU LABORATORIES', ML, y+28); }
    setF('normal', 8.5, DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i) => doc.text(l, PW-MR, y+14+i*11, {align:'right'}));
    y += 54;
    doc.setDrawColor(...RED); doc.setLineWidth(1.5);
    doc.line(ML, y, PW-MR, y);
    y += 18;

    // ── Title ──
    setF('bold', 13, DARK); doc.text('POWER QUALITY', ML, y);
    setF('normal', 8.5, MUTED); doc.text('MIL-STD-1399 Section 300B — Test Specifications', ML, y+13);
    setF('normal', 9, MUTED); doc.text('Date: '+(qi.revDate||qi.date||''), PW-MR, y, {align:'right'});
    if(qi.opp){ setF('bold',9,DARK); doc.text(qi.opp, PW-MR, y+13, {align:'right'}); }
    y += 34;
    doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
    doc.line(ML, y, PW-MR, y);
    y += 16;

    // ── Test Item ──
    sectionHdr('Test Item');
    const sizeStr = [ti.dimL&&ti.dimL+'"',ti.dimW&&ti.dimW+'"',ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
    const pwrParts = [ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'),ti.phase&&ti.phase+' Ph',ti.hz&&ti.hz+' Hz',ti.amps&&ti.amps+' A'].filter(Boolean);
    [['Unit',ti.item],['Dimensions',sizeStr],['Weight',ti.wt&&ti.wt+' lbs'],['Power',pwrParts.join(', ')]]
      .filter(r=>r[1]).forEach(([label,value],i)=>{
        doc.setFillColor(...(i%2===0?[255,255,255]:[247,248,250]));
        doc.rect(ML, y-2, TW, 16, 'F');
        setF('bold',9,MUTED); doc.text(label, ML+8, y+9);
        setF('normal',9,DARK); doc.text(String(value), ML+110, y+9);
        y += 16;
      });
    y += 10;

    // ── Full 300B test data — extracted to shared helper so the Spec Builder
    // payload can use the same definitions. ──
    const PQ_300B_FULL = getPq300bTestDefinitions();

    // Only show rows selected by the user across all active PQ instances
    const selectedKeys = new Set();
    pqs.filter(s=>s.on).forEach(s=>{
      PQ_300B_FULL.forEach(r=>{ if(s.rows?.[r.key]) selectedKeys.add(r.key); });
    });
    const activeRows = PQ_300B_FULL.filter(r=>selectedKeys.has(r.key));

    if(activeRows.length===0){
      setF('normal',10,MUTED); doc.text('No MIL-STD-1399 Section 300B tests selected.', ML, y); y+=20;
    } else {
      sectionHdr('MIL-STD-1399 Section 300B — Selected Tests');

      activeRows.forEach((r,idx)=>{
        const WRAP = TW - 20;
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
        const hdrLines  = doc.splitTextToSize(r.key.replace('B','')+' — '+r.label, WRAP);
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
        const reqLines  = r.req ? doc.splitTextToSize(r.req, WRAP) : [];
        doc.setFont('helvetica','normal'); doc.setFontSize(8);
        const refLines  = r.ref ? doc.splitTextToSize('Tables / Figures: '+r.ref, WRAP) : [];
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
        const noteLines = r.note ? doc.splitTextToSize('Note: '+r.note, WRAP) : [];
        const rowH = hdrLines.length*14+8
          + (reqLines.length>0 ? reqLines.length*12+6 : 0)
          + (refLines.length>0 ? refLines.length*11+5 : 0)
          + (noteLines.length>0 ? noteLines.length*12+6 : 0)
          + 10;

        checkY(rowH+2);
        doc.setFillColor(...(idx%2===0?[238,244,250]:[230,238,246]));
        doc.rect(ML, y, TW, hdrLines.length*13+10, 'F');
        doc.setFillColor(255,255,255);
        doc.rect(ML, y+hdrLines.length*13+10, TW, rowH-(hdrLines.length*13+10), 'F');

        let ry=y+12;
        setF('bold',8.5,BLUE); doc.text(hdrLines, ML+8, ry); ry+=hdrLines.length*14+4;
        if(reqLines.length>0){ setF('normal',8.5,DARK); doc.text(reqLines, ML+10, ry); ry+=reqLines.length*12+6; }
        if(refLines.length>0){ setF('normal',8,MUTED); doc.text(refLines, ML+10, ry); ry+=refLines.length*11+5; }
        if(noteLines.length>0){ setF('italic',7.5,[110,85,40]); doc.text(noteLines, ML+10, ry); ry+=noteLines.length*12+5; }

        doc.setDrawColor(...LIGHT); doc.setLineWidth(0.4);
        doc.line(ML, y+rowH, ML+TW, y+rowH);
        y += rowH;
      });
      y += 8;
    }

    // ── General Notes — force new page ──
    drawFooter();
    doc.addPage();
    y=54;
    sectionHdr('General Notes');
    y+=4;
    const generalNotes = [
      'Pricing is based on customer-supplied information and the assumptions listed herein.',
      'Feasibility of testing will be reviewed upon receipt of a purchase order and/or test procedure approval.',
      'The number of tests required for each test method and/or the number of test positions listed in this document are estimated values. Exact quantities will be determined and documented in the approved test procedure.',
    ];
    generalNotes.forEach((note,i)=>{
      const w=doc.splitTextToSize(note, TW-22);
      const blockH=w.length*13+10;
      checkY(blockH+4);
      doc.setFillColor(...LIGHT); doc.circle(ML+8,y+5,5,'F');
      setF('bold',8,MUTED); doc.text(String(i+1),ML+8,y+8,{align:'center'});
      setF('normal',9,DARK); doc.text(w, ML+20, y+8);
      y+=blockH;
    });
    y+=4;

    const fname=(qi.opp?(qi.opp+' Test Specifications'):'PQ-300B-Test-Specifications')+'.pdf';
    await savePdfAs(doc, fname);
  };

  const exportEmi461fPDF = async () => {
    if(window.jspdf){await buildEmi461fPDF();return;}
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => buildEmi461fPDF();
    document.head.appendChild(script);
  };

  const buildEmi461fPDF = async (emiOverride=null) => {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED=[192,57,43],DARK=[30,30,30],MUTED=[100,100,100],LIGHT=[240,240,240],BLUE=[26,82,118];
    let y = 44;

    const setF=(style,size,color)=>{doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(...(color||DARK));};
    const checkY=(need)=>{if(y+(need||20)>PH-52){drawFooter();doc.addPage();y=54;}};
    const drawFooter=()=>{
      const p=doc.internal.getCurrentPageInfo().pageNumber;
      setF('normal',8,MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''),ML,PH-18);
      doc.text('Page '+p+' | '+(qi.revDate||qi.date||''),PW-MR,PH-18,{align:'right'});
      doc.setDrawColor(...LIGHT);doc.setLineWidth(0.5);doc.line(ML,PH-26,PW-MR,PH-26);
    };
    const sectionHdr=(title)=>{
      checkY(28);y+=8;
      doc.setFillColor(...LIGHT);doc.rect(ML,y-2,TW,18,'F');
      doc.setFillColor(...RED);doc.rect(ML,y-2,3,18,'F');
      setF('bold',9,RED);doc.text(title.toUpperCase(),ML+10,y+10);y+=22;
    };

    // ── Header ──
    try{doc.addImage(NU_LOGO_PDF,'PNG',ML,y,180,40);}
    catch(e){setF('bold',14,RED);doc.text('NU LABORATORIES',ML,y+28);}
    setF('normal',8.5,DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i)=>doc.text(l,PW-MR,y+14+i*11,{align:'right'}));
    y+=54;
    doc.setDrawColor(...RED);doc.setLineWidth(1.5);doc.line(ML,y,PW-MR,y);y+=18;

    // ── Title ──
    setF('bold',13,DARK);doc.text('EMI TESTING',ML,y);
    setF('normal',8.5,MUTED);doc.text('MIL-STD-461F -- Test Specifications',ML,y+13);
    setF('normal',9,MUTED);doc.text('Date: '+(qi.revDate||qi.date||''),PW-MR,y,{align:'right'});
    if(qi.opp){setF('bold',9,DARK);doc.text(qi.opp,PW-MR,y+13,{align:'right'});}
    y+=34;
    doc.setDrawColor(...LIGHT);doc.setLineWidth(0.5);doc.line(ML,y,PW-MR,y);y+=16;

    // ── Test Item ──
    sectionHdr('Test Item');
    const sizeStr=[ti.dimL&&ti.dimL+'"',ti.dimW&&ti.dimW+'"',ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
    const pwrParts=[ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'),ti.phase&&ti.phase+' Ph',ti.hz&&ti.hz+' Hz',ti.amps&&ti.amps+' A'].filter(Boolean);
    [['Unit',ti.item],['Dimensions',sizeStr],['Weight',ti.wt&&ti.wt+' lbs'],['Power',pwrParts.join(', ')]]
      .filter(r=>r[1]).forEach(([label,value],i)=>{
        doc.setFillColor(...(i%2===0?[255,255,255]:[247,248,250]));
        doc.rect(ML,y-2,TW,16,'F');
        setF('bold',9,MUTED);doc.text(label,ML+8,y+9);
        const valLines=doc.splitTextToSize(String(value),TW-112);
        setF('normal',9,DARK);doc.text(valLines,ML+110,y+9);
        y+=16;
      });
    y+=10;

    // Compute all positions and test counts from the same math as shift calculations
    const activeEmi = emiOverride ? {...emiOverride, on:true} : (emis.find(s=>s.on)||(emis[0]||{}));

    // Full 461F test definitions — extracted to a shared helper so the Spec
    // Builder ("from quote" payload) can reuse exactly the same descriptions.
    const EMI_461F = getEmi461fTestDefinitions(activeEmi, ti, setup);

    // Only show tests selected by user
    const selectedKeys=new Set();
    if(emiOverride){
      Object.entries(emiOverride.tests||{}).forEach(([k,v])=>{if(v)selectedKeys.add(k);});
    } else {
      emis.filter(s=>s.on).forEach(s=>{
        Object.entries(s.tests||{}).forEach(([k,v])=>{if(v)selectedKeys.add(k);});
      });
    }
    const activeRows=EMI_461F.filter(r=>selectedKeys.has(r.key));

    if(activeRows.length===0){
      setF('normal',10,MUTED);doc.text('No MIL-STD-461F tests selected.',ML,y);y+=20;
    } else {
      sectionHdr('MIL-STD-461F -- Selected Tests');

      activeRows.forEach((r,idx)=>{
        const WRAP = TW - 20;
        // Set font BEFORE each splitTextToSize so measurements match rendering
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
        const lblLines  = doc.splitTextToSize(r.label, TW-54);
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
        const descLines = r.desc ? doc.splitTextToSize(r.desc, WRAP) : [];
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
        const noteLines = r.note ? doc.splitTextToSize('Note: '+r.note, WRAP) : [];
        doc.setFont('helvetica','normal'); doc.setFontSize(8);
        const posRows = r.positions ? r.positions.map(({range,pos})=>({
          rng: doc.splitTextToSize(range+':',120),
          pos: doc.splitTextToSize(pos, TW-160)
        })) : [];
        const posH = posRows.reduce((a,pr)=>a+Math.max(pr.rng.length,pr.pos.length)*12+2,0)+(posRows.length>0?4:0);
        const rowH = lblLines.length*14+8
          + (descLines.length>0 ? descLines.length*12+6 : 0)
          + posH
          + (noteLines.length>0 ? noteLines.length*12+6 : 0)
          + 10;
        checkY(rowH+2);

        // Row background
        doc.setFillColor(...(idx%2===0?[238,244,250]:[230,238,246]));
        doc.rect(ML,y,TW,lblLines.length*14+10,'F');
        doc.setFillColor(255,255,255);
        doc.rect(ML,y+lblLines.length*14+10,TW,rowH-(lblLines.length*14+10),'F');
        let ry = y+13;

        // Key + label
        setF('bold',8.5,BLUE); doc.text(r.key, ML+6, ry);
        setF('bold',8.5,DARK); doc.text(lblLines, ML+52, ry);
        ry += lblLines.length*14+4;

        // Description
        if(descLines.length>0){
          setF('normal',8.5,DARK); doc.text(descLines, ML+10, ry); ry+=descLines.length*12+6;
        }

        // Position table (RE102, RS103)
        if(posRows.length>0){
          posRows.forEach(({rng,pos})=>{
            const h=Math.max(rng.length,pos.length)*12+2;
            setF('normal',8,[80,80,80]); doc.text(rng,ML+14,ry);
            setF('bold',8,DARK); doc.text(pos,ML+145,ry); ry+=h;
          });
          ry+=4;
        }

        // Note
        if(noteLines.length>0){
          setF('italic',7.5,[110,85,40]); doc.text(noteLines, ML+10, ry); ry+=noteLines.length*12+5;
        }

        doc.setDrawColor(...LIGHT); doc.setLineWidth(0.4);
        doc.line(ML,y+rowH,ML+TW,y+rowH);
        y+=rowH;
      });
      y+=8;
    }

    // ── General Notes — force new page ──
    drawFooter();
    doc.addPage();
    y=54;
    sectionHdr('General Notes');
    y+=4;
    const generalNotes=[
      'Pricing is based on customer-supplied information and the assumptions listed herein.',
      'Feasibility of testing will be reviewed upon receipt of a purchase order and/or test procedure approval.',
      'This quote assumes that susceptibility criteria can be determined in less than 3 seconds during real-time operation of the EUT. Customer to supply cables and all peripheral/monitoring equipment and one mode of operation (operating or standby). Susceptibility determination provided by the customer.',
      'Pricing and feasibility may be reevaluated upon completion and review of the NU Laboratories Test Configuration Form.',
      'The number of tests required for each test method and/or the number of test positions listed in this document are estimated values. Exact quantities will be determined and documented in the approved test procedure.',
    ];
    generalNotes.forEach((note,i)=>{
      const w=doc.splitTextToSize(note, TW-22);
      const blockH=w.length*13+10;
      checkY(blockH+4);
      doc.setFillColor(...LIGHT); doc.circle(ML+8,y+5,5,'F');
      setF('bold',8,MUTED); doc.text(String(i+1),ML+8,y+8,{align:'center'});
      setF('normal',9,DARK); doc.text(w, ML+20, y+8);
      y+=blockH;
    });
    y+=4;

    const tp=doc.internal.getNumberOfPages();
    for(let p=1;p<=tp;p++){doc.setPage(p);drawFooter();}
    const fname=(qi.opp?(qi.opp+' Test Specifications'):'EMI-461F-Test-Specifications')+'.pdf';
    await savePdfAs(doc, fname);
  };

  const exportEmi461gPDF = async () => {
    if(window.jspdf){await buildEmi461gPDF();return;}
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => buildEmi461gPDF();
    document.head.appendChild(script);
  };

  const buildEmi461gPDF = async (emiOverride=null) => {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED=[192,57,43],DARK=[30,30,30],MUTED=[100,100,100],LIGHT=[240,240,240],BLUE=[26,82,118];
    let y = 44;

    const setF=(style,size,color)=>{doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(...(color||DARK));};
    const checkY=(need)=>{if(y+(need||20)>PH-52){drawFooter();doc.addPage();y=54;}};
    const drawFooter=()=>{
      const p=doc.internal.getCurrentPageInfo().pageNumber;
      setF('normal',8,MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''),ML,PH-18);
      doc.text('Page '+p+' | '+(qi.revDate||qi.date||''),PW-MR,PH-18,{align:'right'});
      doc.setDrawColor(...LIGHT);doc.setLineWidth(0.5);doc.line(ML,PH-26,PW-MR,PH-26);
    };
    const sectionHdr=(title)=>{
      checkY(28);y+=8;
      doc.setFillColor(...LIGHT);doc.rect(ML,y-2,TW,18,'F');
      doc.setFillColor(...RED);doc.rect(ML,y-2,3,18,'F');
      setF('bold',9,RED);doc.text(title.toUpperCase(),ML+10,y+10);y+=22;
    };

    // ── Header ──
    try{doc.addImage(NU_LOGO_PDF,'PNG',ML,y,180,40);}
    catch(e){setF('bold',14,RED);doc.text('NU LABORATORIES',ML,y+28);}
    setF('normal',8.5,DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i)=>doc.text(l,PW-MR,y+14+i*11,{align:'right'}));
    y+=54;
    doc.setDrawColor(...RED);doc.setLineWidth(1.5);doc.line(ML,y,PW-MR,y);y+=18;

    // ── Title ──
    setF('bold',13,DARK);doc.text('EMI TESTING',ML,y);
    setF('normal',8.5,MUTED);doc.text('MIL-STD-461G -- Test Specifications',ML,y+13);
    setF('normal',9,MUTED);doc.text('Date: '+(qi.revDate||qi.date||''),PW-MR,y,{align:'right'});
    if(qi.opp){setF('bold',9,DARK);doc.text(qi.opp,PW-MR,y+13,{align:'right'});}
    y+=34;
    doc.setDrawColor(...LIGHT);doc.setLineWidth(0.5);doc.line(ML,y,PW-MR,y);y+=16;

    // ── Test Item ──
    sectionHdr('Test Item');
    const sizeStr=[ti.dimL&&ti.dimL+'"',ti.dimW&&ti.dimW+'"',ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
    const pwrParts=[ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'),ti.phase&&ti.phase+' Ph',ti.hz&&ti.hz+' Hz',ti.amps&&ti.amps+' A'].filter(Boolean);
    [['Unit',ti.item],['Dimensions',sizeStr],['Weight',ti.wt&&ti.wt+' lbs'],['Power',pwrParts.join(', ')]]
      .filter(r=>r[1]).forEach(([label,value],i)=>{
        doc.setFillColor(...(i%2===0?[255,255,255]:[247,248,250]));
        doc.rect(ML,y-2,TW,16,'F');
        setF('bold',9,MUTED);doc.text(label,ML+8,y+9);
        const valLines=doc.splitTextToSize(String(value),TW-112);
        setF('normal',9,DARK);doc.text(valLines,ML+110,y+9);
        y+=16;
      });
    y+=10;

    // ── Compute positions and test counts from calcEmiShifts ──
    const activeEmi = emiOverride ? {...emiOverride,on:true} : (emis.find(s=>s.on)||(emis[0]||{}));

    // Full 461G test definitions — extracted to shared helper so Spec Builder
    // can reuse the same descriptions.
    const EMI_461G = getEmi461gTestDefinitions(activeEmi, ti, setup);

    // Only show tests selected by user
    const selectedKeys=new Set();
    if(emiOverride){
      Object.entries(emiOverride.tests||{}).forEach(([k,v])=>{if(v)selectedKeys.add(k);});
    } else {
      emis.filter(s=>s.on).forEach(s=>{
        Object.entries(s.tests||{}).forEach(([k,v])=>{if(v)selectedKeys.add(k);});
      });
    }
    const activeRows=EMI_461G.filter(r=>selectedKeys.has(r.key));

    if(activeRows.length===0){
      setF('normal',10,MUTED);doc.text('No MIL-STD-461G tests selected.',ML,y);y+=20;
    } else {
      sectionHdr('MIL-STD-461G -- Selected Tests');

      activeRows.forEach((r,idx)=>{
        const WRAP = TW - 20;
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
        const lblLines  = doc.splitTextToSize(r.label, TW-54);
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
        const descLines = r.desc ? doc.splitTextToSize(r.desc, WRAP) : [];
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
        const noteLines = r.note ? doc.splitTextToSize('Note: '+r.note, WRAP) : [];
        doc.setFont('helvetica','normal'); doc.setFontSize(8);
        const posRows = r.positions ? r.positions.map(({range,pos})=>({
          rng: doc.splitTextToSize(range+':',120),
          pos: doc.splitTextToSize(pos, TW-160)
        })) : [];
        const posH = posRows.reduce((a,pr)=>a+Math.max(pr.rng.length,pr.pos.length)*12+2,0)+(posRows.length>0?4:0);
        const rowH = lblLines.length*14+8
          + (descLines.length>0 ? descLines.length*12+6 : 0)
          + posH
          + (noteLines.length>0 ? noteLines.length*12+6 : 0)
          + 10;
        checkY(rowH+2);

        doc.setFillColor(...(idx%2===0?[238,244,250]:[230,238,246]));
        doc.rect(ML,y,TW,lblLines.length*14+10,'F');
        doc.setFillColor(255,255,255);
        doc.rect(ML,y+lblLines.length*14+10,TW,rowH-(lblLines.length*14+10),'F');
        let ry = y+13;

        setF('bold',8.5,BLUE); doc.text(r.key,ML+6,ry);
        setF('bold',8.5,DARK); doc.text(lblLines,ML+52,ry);
        ry += lblLines.length*14+4;

        if(descLines.length>0){setF('normal',8.5,DARK);doc.text(descLines,ML+10,ry);ry+=descLines.length*12+6;}

        if(posRows.length>0){
          posRows.forEach(({rng,pos})=>{
            const h=Math.max(rng.length,pos.length)*12+2;
            setF('normal',8,[80,80,80]); doc.text(rng,ML+14,ry);
            setF('bold',8,DARK); doc.text(pos,ML+145,ry); ry+=h;
          });
          ry+=4;
        }

        if(noteLines.length>0){setF('italic',7.5,[110,85,40]);doc.text(noteLines,ML+10,ry);ry+=noteLines.length*12+5;}

        doc.setDrawColor(...LIGHT);doc.setLineWidth(0.4);
        doc.line(ML,y+rowH,ML+TW,y+rowH);
        y+=rowH;
      });
      y+=8;
    }

    // ── General Notes — force new page ──
    drawFooter();
    doc.addPage();
    y=54;
    sectionHdr('General Notes');
    y+=4;
    const generalNotes=[
      'Pricing is based on customer-supplied information and the assumptions listed herein.',
      'Feasibility of testing will be reviewed upon receipt of a purchase order and/or test procedure approval.',
      'EMI tested in accordance with MIL-STD-461G for Ships metallic below deck applications. Customer to supply cables and all peripheral and monitoring equipment, one mode of operation (operating or standby). Susceptibility determination provided by customer.',
      'Pricing and feasibility may be reevaluated upon completion and review of the NU Laboratories Test Configuration Form.',
      'The number of tests required for each test method and/or the number of test positions listed in this document are estimated values. Exact quantities will be determined and documented in the approved test procedure.',
    ];
    generalNotes.forEach((note,i)=>{
      const w=doc.splitTextToSize(note, TW-22);
      const blockH=w.length*13+10;
      checkY(blockH+4);
      doc.setFillColor(...LIGHT); doc.circle(ML+8,y+5,5,'F');
      setF('bold',8,MUTED); doc.text(String(i+1),ML+8,y+8,{align:'center'});
      setF('normal',9,DARK); doc.text(w, ML+20, y+8);
      y+=blockH;
    });
    y+=4;

    const tp=doc.internal.getNumberOfPages();
    for(let p=1;p<=tp;p++){doc.setPage(p);drawFooter();}
    const fname=(qi.opp?(qi.opp+' Test Specifications'):'EMI-461G-Test-Specifications')+'.pdf';
    await savePdfAs(doc, fname);
  };

  const exportPq300Part1PDF = async () => {
    if(window.jspdf){await buildPq300Part1PDF();return;}
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => buildPq300Part1PDF();
    document.head.appendChild(script);
  };

  const buildPq300Part1PDF = async (pqOverride=null) => {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED = [192,57,43], DARK = [30,30,30], MUTED = [100,100,100], LIGHT = [240,240,240], BLUE = [26,82,118];
    let y = 44;
    let pageNum = 1;

    const setF = (style, size, color) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...(color||DARK));
    };
    const checkY = (need) => {
      if(y + (need||20) > PH - 52){
        drawFooter();
        doc.addPage();
        pageNum++;
        y = 54;
      }
    };
    const drawFooter = () => {
      const p = doc.internal.getCurrentPageInfo().pageNumber;
      setF('normal', 8, MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''), ML, PH-18);
      doc.text('Page '+p+' | '+(qi.revDate||qi.date||''), PW-MR, PH-18, {align:'right'});
      doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
      doc.line(ML, PH-26, PW-MR, PH-26);
    };
    const sectionHdr = (title) => {
      checkY(28);
      y += 8;
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y-2, TW, 18, 'F');
      doc.setFillColor(...RED); doc.rect(ML, y-2, 3, 18, 'F');
      setF('bold', 9, RED); doc.text(title.toUpperCase(), ML+10, y+10);
      y += 22;
    };

    // ── Header ──
    try { doc.addImage(NU_LOGO_PDF, 'PNG', ML, y, 180, 40); }
    catch(e) { setF('bold', 14, RED); doc.text('NU LABORATORIES', ML, y+28); }
    setF('normal', 8.5, DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i) => doc.text(l, PW-MR, y+14+i*11, {align:'right'}));
    y += 54;
    doc.setDrawColor(...RED); doc.setLineWidth(1.5);
    doc.line(ML, y, PW-MR, y);
    y += 18;

    // ── Title ──
    setF('bold', 13, DARK); doc.text('POWER QUALITY', ML, y);
    setF('normal', 8.5, MUTED); doc.text('MIL-STD-1399 Section 300 Part 1 -- Test Specifications', ML, y+13);
    setF('normal', 9, MUTED); doc.text('Date: '+(qi.revDate||qi.date||''), PW-MR, y, {align:'right'});
    if(qi.opp){ setF('bold',9,DARK); doc.text(qi.opp, PW-MR, y+13, {align:'right'}); }
    y += 34;
    doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
    doc.line(ML, y, PW-MR, y);
    y += 16;

    // ── Test Item ──
    sectionHdr('Test Item');
    const sizeStr = [ti.dimL&&ti.dimL+'"',ti.dimW&&ti.dimW+'"',ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
    const pwrParts = [ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'),ti.phase&&ti.phase+' Ph',ti.hz&&ti.hz+' Hz',ti.amps&&ti.amps+' A'].filter(Boolean);
    [['Unit',ti.item],['Dimensions',sizeStr],['Weight',ti.wt&&ti.wt+' lbs'],['Power',pwrParts.join(', ')]]
      .filter(r=>r[1]).forEach(([label,value],i)=>{
        doc.setFillColor(...(i%2===0?[255,255,255]:[247,248,250]));
        doc.rect(ML, y-2, TW, 16, 'F');
        setF('bold',9,MUTED); doc.text(label, ML+8, y+9);
        setF('normal',9,DARK); doc.text(String(value), ML+110, y+9);
        y += 16;
      });
    y += 10;

    // ── Part 1 test data — extracted to shared helper. ──
    const PQ_P1_FULL = getPq300p1TestDefinitions();

    // Only rows selected by user across all active PQ instances
    const selectedKeys = new Set();
    pqs.filter(s=>s.on).forEach(s=>{
      PQ_P1_FULL.forEach(r=>{ if(s.rows?.[r.key]) selectedKeys.add(r.key); });
    });
    const activeRows = PQ_P1_FULL.filter(r=>selectedKeys.has(r.key));

    if(activeRows.length===0){
      setF('normal',10,MUTED); doc.text('No MIL-STD-1399 Section 300 Part 1 tests selected.', ML, y); y+=20;
    } else {
      sectionHdr('MIL-STD-1399 Section 300 Part 1 -- Selected Tests');

      activeRows.forEach((r,idx)=>{
        const WRAP = TW - 20;
        doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
        const hdrLines  = doc.splitTextToSize(r.key+' — '+r.label, WRAP);
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
        const reqLines  = r.req ? doc.splitTextToSize(r.req, WRAP) : [];
        doc.setFont('helvetica','normal'); doc.setFontSize(8);
        const refLines  = r.ref ? doc.splitTextToSize('Tables / Figures: '+r.ref, WRAP) : [];
        doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
        const noteLines = r.note ? doc.splitTextToSize('Note: '+r.note, WRAP) : [];
        const rowH = hdrLines.length*14+8
          + (reqLines.length>0 ? reqLines.length*12+6 : 0)
          + (refLines.length>0 ? refLines.length*11+5 : 0)
          + (noteLines.length>0 ? noteLines.length*12+6 : 0)
          + 10;

        checkY(rowH+2);
        doc.setFillColor(...(idx%2===0?[238,244,250]:[230,238,246]));
        doc.rect(ML, y, TW, hdrLines.length*13+10, 'F');
        doc.setFillColor(255,255,255);
        doc.rect(ML, y+hdrLines.length*13+10, TW, rowH-(hdrLines.length*13+10), 'F');

        let ry=y+12;
        setF('bold',8.5,BLUE); doc.text(hdrLines, ML+8, ry); ry+=hdrLines.length*14+4;
        if(reqLines.length>0){ setF('normal',8.5,DARK); doc.text(reqLines, ML+10, ry); ry+=reqLines.length*12+6; }
        if(refLines.length>0){ setF('normal',8,MUTED); doc.text(refLines, ML+10, ry); ry+=refLines.length*11+5; }
        if(noteLines.length>0){ setF('italic',7.5,[110,85,40]); doc.text(noteLines, ML+10, ry); ry+=noteLines.length*12+5; }

        doc.setDrawColor(...LIGHT); doc.setLineWidth(0.4);
        doc.line(ML, y+rowH, ML+TW, y+rowH);
        y += rowH;
      });
      y += 8;
    }

    // ── General Notes — force new page ──
    drawFooter();
    doc.addPage();
    y=54;
    sectionHdr('General Notes');
    y+=4;
    const generalNotes = [
      'Pricing is based on customer-supplied information and the assumptions listed herein.',
      'Feasibility of testing will be reviewed upon receipt of a purchase order and/or test procedure approval.',
      'The number of tests required for each test method and/or the number of test positions listed in this document are estimated values. Exact quantities will be determined and documented in the approved test procedure.',
    ];
    generalNotes.forEach((note,i)=>{
      const w=doc.splitTextToSize(note, TW-22);
      const blockH=w.length*13+10;
      checkY(blockH+4);
      doc.setFillColor(...LIGHT); doc.circle(ML+8,y+5,5,'F');
      setF('bold',8,MUTED); doc.text(String(i+1),ML+8,y+8,{align:'center'});
      setF('normal',9,DARK); doc.text(w, ML+20, y+8);
      y+=blockH;
    });
    y+=4;

    const fname=(qi.opp?(qi.opp+' Test Specifications'):'PQ-300-Part1-Test-Specifications')+'.pdf';
    await savePdfAs(doc, fname);
  };

  const buildPDF = async (budgetOnly) => {
    const {jsPDF} = window.jspdf||{};
    if(!jsPDF){console.error('jsPDF not loaded');return;}
    const doc = new jsPDF({unit:"pt",format:"letter"});
    const PW = doc.internal.pageSize.getWidth();   // 612
    const PH = doc.internal.pageSize.getHeight();  // 792
    const ML = 54, MR = 54, TW = PW - ML - MR;
    const RED = [192,57,43], DARK = [30,30,30], MUTED = [100,100,100], LIGHT = [240,240,240];
    let y = 44;
    let pageNum = 1;

    // ── helpers ──────────────────────────────────────────────────────────────
    const sf2 = v => { const n = parseFloat(String(v).replace(/,/g,'')); return isNaN(n)?0:n; };
    const money = v => '$'+Math.round(sf2(v)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

    // Track current font state so drawFooter can save/restore around its own setF calls.
    // Without this, drawFooter's "8pt MUTED" font would leak past the page break and
    // style the first line of content on the new page (e.g. orphaned spec lines).
    let curFont = {style:'normal', size:9, color:DARK};

    const setF = (style, size, color) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...(color||DARK));
      curFont = {style, size, color: color||DARK};
    };

    const totalPages = () => doc.internal.getNumberOfPages();

    const drawFooter = () => {
      const p = doc.internal.getCurrentPageInfo().pageNumber;
      const prev = curFont;                              // remember caller's font
      setF('normal', 8, MUTED);
      doc.text('NU Laboratories, Inc. | '+(qi.opp||''), ML, PH-18);
      doc.text('Page '+p+' | '+(qi.revDate||qi.date||''), PW-MR, PH-18, {align:'right'});
      doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5);
      doc.line(ML, PH-26, PW-MR, PH-26);
      setF(prev.style, prev.size, prev.color);           // restore caller's font
    };

    const checkY = (need) => {
      if (y + (need||20) > PH - 52) {
        drawFooter();
        doc.addPage();
        pageNum++;
        y = 54;
      }
    };

    // Left-column bold label, right-column normal value
    const kvRow = (label, value) => {
      if (!value && value !== 0) return;
      checkY(16);
      setF('bold', 9.5, DARK);
      doc.text(String(label), ML, y);
      setF('normal', 9.5, DARK);
      const vlines = doc.splitTextToSize(String(value), TW - 120);
      doc.text(vlines, ML + 120, y);
      y += Math.max(14, vlines.length * 13);
    };

    // Red left-border section heading in a light gray band
    const sectionHdr = (title) => {
      checkY(30);
      y += 10;
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y - 10, TW, 20, 'F');
      doc.setFillColor(...RED);
      doc.rect(ML, y - 10, 3, 20, 'F');
      setF('bold', 9, RED);
      doc.text(title.toUpperCase(), ML + 10, y + 4);
      y += 16;
    };

    // ── PAGE 1 ──────────────────────────────────────────────────────────────

    if(!budgetOnly) {
    // Logo
    try { doc.addImage(NU_LOGO_PDF, 'PNG', ML, y, 180, 40); }
    catch(e) { setF('bold', 14, RED); doc.text('NU LABORATORIES', ML, y+28); }

    // Address block top-right
    setF('normal', 8.5, DARK);
    ['312 Old Allerton Road','Annandale, NJ 08801-3206',
     'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
      .forEach((l,i) => doc.text(l, PW-MR, y+14+i*11, {align:'right'}));
    y += 54;

    // Red rule under header
    doc.setDrawColor(...RED); doc.setLineWidth(1.5);
    doc.line(ML, y, PW-MR, y);
    y += 16;

    // Quote # and date
    setF('bold', 16, DARK);
    doc.text('Quote #'+(qi.opp||''), ML, y);
    setF('normal', 10, MUTED);
    doc.text('Date: '+(qi.revDate||qi.date||''), PW-MR, y, {align:'right'});
    y += 24;

    if(true) {
      // ── QUOTE INFORMATION ────────────────────────────────────────────────
      sectionHdr('Quote Information');
      y += 4;
      // Two-column layout: left = quote meta, right = customer info
      // Each row uses a bold label and normal value, half-width per column.
      // Rows advance by the ACTUAL wrapped line count of their value so long
      // values (e.g. a long account name) don't overlap the row below.
      const colW = TW / 2;
      const labelW = 60;          // label column width within each side
      const leftLabelX  = ML;
      const leftValueX  = ML + labelW;
      const rightLabelX = ML + colW;
      const rightValueX = ML + colW + labelW;
      const leftCol  = [
        ['Opportunity', qi.opp],
        ['Stage',       qi.stage],
        ['Type',        qi.type],
        ['Date',        qi.revDate||qi.date],
        ['RFQ',         qi.rfq],
      ].filter(r=>r[1]);
      const rightCol = [
        ['Account', qi.account],
        ['Address', qi.billTo],
        ['',        qi.billToCity],   // blank label = continuation line of Address
        ['Contact', qi.contact],
        ['Email',   qi.email],
      ].filter(r=>r[1]);
      const lineH = 11;             // vertical space per wrapped line
      const rowGap = 2;             // extra gap between rows
      const valueW = colW - labelW - 8;
      // Pre-measure each column's total height by summing wrapped line counts
      const measureColH = (col) => {
        setF('normal', 9.5, DARK);
        return col.reduce((h, r) => {
          const n = doc.splitTextToSize(String(r[1]), valueW).length;
          return h + n*lineH + rowGap;
        }, 0);
      };
      const blockH = Math.max(measureColH(leftCol), measureColH(rightCol));
      checkY(blockH + 4);
      const startY = y;
      const renderCol = (col, labelX, valueX) => {
        let cy = startY;
        col.forEach((r) => {
          setF('normal', 9.5, DARK);
          const vlines = doc.splitTextToSize(String(r[1]), valueW);
          if(r[0]){
            setF('bold', 9.5, DARK);
            doc.text(String(r[0]), labelX, cy);
            setF('normal', 9.5, DARK);
          }
          doc.text(vlines, valueX, cy);
          cy += vlines.length*lineH + rowGap;
        });
      };
      renderCol(leftCol, leftLabelX, leftValueX);
      renderCol(rightCol, rightLabelX, rightValueX);
      y = startY + blockH + 4;
      y += 6;

      // ── TEST ITEM DESCRIPTION ────────────────────────────────────────────
      sectionHdr('Test Item Description');
      y += 4;
      const sizeStr=[ti.dimL&&ti.dimL+'"',ti.dimW&&ti.dimW+'"',ti.dimH&&ti.dimH+'"'].filter(Boolean).join(' x ');
      const pwrParts=[ti.volt&&ti.volt+' V '+(ti.pwrType||'AC'),ti.phase&&ti.phase+' Ph',ti.hz&&ti.hz+' Hz',ti.amps&&ti.amps+' A'].filter(Boolean);
      [
        ti.item&&['Test Item', ti.item],
        ti.qty&&ti.qty!=='1'&&['Qty', ti.qty],
        ti.model&&['Model No.', ti.model],
        ti.drawing&&['Drawing No.', ti.drawing],
        sizeStr&&['Size', sizeStr],
        ti.wt&&['Weight', ti.wt+' lbs'],
        pwrParts.length&&['Power', pwrParts.join(', ')],
        (ti.loads!==''&&(ti.loads!=null||qi.account))&&['Loads', ti.loads!=null&&ti.loads!==''?ti.loads:(qi.account?'All electrical and/or resistive loads will be provided by '+qi.account+' unless otherwise discussed.':'')],
        ti.mounting&&['Mounting', ti.mounting],
        ti.pressureFlow&&['Pressure/Flow', ti.pressureFlow],
      ].filter(Boolean).filter(r=>r[1]).forEach(([l,v])=>kvRow(l,v));

      // GSI bar — always 2 rows: row1: GSI | Witness  row2: Doc Restriction | DPAS
      checkY(42);
      y += 6;
      doc.setFillColor(232,236,240);
      doc.rect(ML, y-2, TW, 30, 'F');
      setF('bold', 9, DARK);
      const gsiHalf = TW / 2;
      doc.text('GSI: '+(ti.gsi||'Unknown'), ML+6, y+10);
      doc.text('Customer Witness: '+(ti.witness||'Unknown'), ML+gsiHalf+6, y+10);
      doc.text('Document Restriction: '+(ti.docRestriction||'None'), ML+6, y+22);
      doc.text('DPAS: '+(ti.dpas||'None'), ML+gsiHalf+6, y+22);
      y += 34;

      // ── SPECIFICATIONS & NOTES ───────────────────────────────────────────
      // Use snapshot specs/notes when not dirty — immune to auto-note formula changes
      const specsText = (!isDirty&&snapshot?.tiSpecs!=null ? snapshot.tiSpecs : (ti.tiSpecs||"")).trim();
      const notesText = (!isDirty&&snapshot?.tiNotes!=null ? snapshot.tiNotes : (ti.tiNotes||"")).trim();
      // Render note/spec text preserving bullet lists: a leading •, -, *, or ◦ marker
      // is drawn as a real bullet dot with a hanging indent, and lines stay single-
      // spaced so a typed bulleted list looks the same on the PDF as on the page.
      const renderNoteLines = (text) => {
        text.split('\n').forEach(rawLine=>{
          const line = rawLine.replace(/\r$/,'');
          if(!line.trim()){ y += 4; return; }                    // blank line → small gap
          const sub = /^(\s{2,}|\t)/.test(line);                 // indented → sub-bullet
          const baseIndent = sub ? 20 : 8;
          const m = line.match(/^\s*[•\-\*◦·]\s+(.*)$/);         // bullet marker + text
          if (m) {
            const textX = ML + baseIndent + 10;                  // hang wrapped lines past the dot
            const w = doc.splitTextToSize(m[1], TW - (baseIndent+10) - 6);
            checkY(w.length*12+2);
            doc.setFillColor(...DARK);
            doc.circle(ML + baseIndent + 3, y - 2.5, 1.3, 'F');  // real bullet dot
            doc.text(w, textX, y);
            y += w.length*12+2;
          } else {
            const w = doc.splitTextToSize(line.replace(/^\s+/,''), TW - baseIndent - 6);
            checkY(w.length*12+2);
            doc.text(w, ML + baseIndent, y);
            y += w.length*12+2;
          }
        });
      };
      if(specsText||notesText){
        sectionHdr('Specifications & Notes');
        y += 4;
        if(specsText){
          setF('bold', 9.5, DARK); checkY(14); doc.text('Specifications:', ML, y); y += 13;
          setF('normal', 9, DARK);
          renderNoteLines(specsText);
          y += 4;
        }
        if(notesText){
          setF('bold', 9.5, DARK); checkY(14); doc.text('Notes:', ML, y); y += 13;
          setF('normal', 9, DARK);
          renderNoteLines(notesText);
          y += 4;
        }
        y += 4;
      }

      // ── Intro paragraph ───────────────────────────────────────────────────
      checkY(44);
      y += 4;
      setF('normal', 9, DARK);
      const intro = 'Pursuant to your request, we are pleased to offer the following quotation. All pricing is subject to the attached terms and conditions. Any additional terms and conditions must be clearly defined in writing and may be subject to negotiation. This quote is based on the following:';
      const iw = doc.splitTextToSize(intro, TW);
      checkY(iw.length*12+8);
      doc.text(iw, ML, y); y += iw.length*12+12;

      // ── PRICING SUMMARY ───────────────────────────────────────────────────
      sectionHdr('Pricing Summary');
      y += 4;

      // Table header row
      const cQty=28, cCode=36, cAmt=90, cDesc=TW-cQty-cCode-cAmt;
      doc.setFillColor(50,50,50);
      doc.rect(ML, y, TW, 16, 'F');
      setF('bold', 8.5, [255,255,255]);
      doc.text('Qty', ML+cQty/2, y+11, {align:'center'});
      doc.text('Code', ML+cQty+4, y+11);
      doc.text('Description', ML+cQty+cCode+4, y+11);
      doc.text('Amount', PW-MR-4, y+11, {align:'right'});
      y += 16;

      const drawTblHdr = () => {
        doc.setFillColor(50,50,50);
        doc.rect(ML, y, TW, 16, 'F');
        setF('bold', 8.5, [255,255,255]);
        doc.text('Qty', ML+cQty/2, y+11, {align:'center'});
        doc.text('Code', ML+cQty+4, y+11);
        doc.text('Description', ML+cQty+cCode+4, y+11);
        doc.text('Amount', PW-MR-4, y+11, {align:'right'});
        y += 16;
      };

      // Use snapshot lines when not dirty — prices frozen at last save
      // Use summary.lines for ORDER (matches sidebar/lineOrder)
      // Use snapshot prices by label for data integrity
      const snapPriceByLabel={};
      if(!isDirty&&snapshot?.lines?.length>0){
        snapshot.lines.forEach(l=>{ snapPriceByLabel[l.label]=l.val; });
      }
      const pdfLines = summary.lines;
      const order = lineOrder&&lineOrder.length===pdfLines.length ? lineOrder : pdfLines.map((_,i)=>i);
      // Override lookup
      const pdfLabelCount={};
      summary.lines.forEach(l=>{ pdfLabelCount[l.label]=(pdfLabelCount[l.label]||0)+1; });
      const pdfOvByLabel={};
      Object.entries(lineOverrides).forEach(([k,ov])=>{
        if(ov.label&&pdfLabelCount[ov.label]===1) pdfOvByLabel[ov.label]=ov;
      });
      summary.lines.forEach((l,i)=>{
        const ov=lineOverrides[i];
        if(ov&&!ov.label&&pdfLabelCount[l.label]===1) pdfOvByLabel[l.label]={...ov,label:l.label};
      });
      const pdfOvByIndex={};
      Object.entries(lineOverrides).forEach(([k,ov])=>{ pdfOvByIndex[k]=ov; });
      // Build auto and picker row pools
      const autoRowPool = order.map((origIdx,dispIdx)=>{
        const l=pdfLines[origIdx]; if(!l)return null;
        const ov=pdfOvByIndex[origIdx]||pdfOvByLabel[l.label]||{};
        if(ov.deleted)return null;
        const price=snapPriceByLabel[l.label]!==undefined?snapPriceByLabel[l.label]:l.val;
        const desc=ov.desc&&ov.desc.trim()?ov.desc.trim():null;
        return {type:'auto',origIdx,l,price,desc,dispIdx};
      }).filter(Boolean);
      const pickerRowPool=(pickerLines||[]).map((pl,pli)=>({type:'picker',pl,pli,id:pl.id||pl.label}));
      // Use unifiedOrder if available — matches sidebar exactly
      let allRows;
      if(unifiedOrder&&unifiedOrder.length===(autoRowPool.length+pickerRowPool.length)){
        // Consume rows as matched (see sidebar comment) so duplicate-labeled
        // picker entries can't resolve to the same source row twice.
        const claimedAuto=new Set();
        const claimedPicker=new Set();
        allRows=unifiedOrder.map(u=>{
          if(u.type==='auto'){
            const r=autoRowPool.find(r=>r.origIdx===u.origIdx && !claimedAuto.has(r.origIdx));
            if(r) claimedAuto.add(r.origIdx);
            return r;
          }
          const r=pickerRowPool.find(r=>
            (r.pl.id||r.pl.label)===(u.id||u.label) && !claimedPicker.has(r.pli));
          if(r) claimedPicker.add(r.pli);
          return r;
        }).filter(Boolean);
        if(allRows.length!==autoRowPool.length+pickerRowPool.length)
          allRows=null; // fallback if any mismatch
      }
      if(!allRows){
        // No unifiedOrder — same order as sidebar: auto lines then picker lines
        // Both groups preserve their internal order (lineOrder / pickerLines array)
        allRows=[...autoRowPool,...pickerRowPool];
      }
      allRows.forEach((row, allIdx) => {
        const bg = allIdx%2===0 ? [255,255,255] : [247,248,250];
        if(row.type==='auto'){
          const {l, price, desc} = row;
          const rowH = desc ? 26 : 14;
          if(y + rowH + 2 > PH-52){ drawFooter(); doc.addPage(); pageNum++; y=54; drawTblHdr(); }
          doc.setFillColor(...bg); doc.rect(ML, y, TW, rowH, 'F');
          setF('normal', 9, DARK);
          doc.text('1', ML+cQty/2, y+10, {align:'center'});
          if(l.code){ setF('normal',8,MUTED); doc.text(String(l.code), ML+cQty+4, y+10); }
          setF('normal', 9, DARK); doc.text(l.label, ML+cQty+cCode+4, y+10);
          if(desc){
            setF('italic', 7.5, [130,130,130]);
            const dw = doc.splitTextToSize(desc, cDesc-10);
            doc.text(dw, ML+cQty+cCode+4, y+19);
          }
          setF('bold', 9, DARK); doc.text(money(price), PW-MR-4, y+10, {align:'right'});
          y += rowH;
        } else {
          const {pl} = row;
          const desc = pl.desc&&pl.desc.trim() ? pl.desc.trim() : null;
          const rowH = desc ? 26 : 14;
          if(y + rowH + 2 > PH-52){ drawFooter(); doc.addPage(); pageNum++; y=54; drawTblHdr(); }
          doc.setFillColor(...bg); doc.rect(ML, y, TW, rowH, 'F');
          setF('normal', 9, DARK);
          doc.text('1', ML+cQty/2, y+10, {align:'center'});
          if(pl.code){ setF('normal',8,MUTED); doc.text(String(pl.code), ML+cQty+4, y+10); }
          setF('normal', 9, DARK);
          const labelLines = doc.splitTextToSize(pl.label||'', cDesc-10);
          doc.text(labelLines, ML+cQty+cCode+4, y+10);
          if(desc){
            setF('italic', 7.5, [130,130,130]);
            const dw = doc.splitTextToSize(desc, cDesc-10);
            doc.text(dw, ML+cQty+cCode+4, y+19);
          }
          setF('bold', 9, DARK); doc.text(money(pl.price||0), PW-MR-4, y+10, {align:'right'});
          y += rowH;
        }
      });

      // Total row
      checkY(28);
      y += 4;
      doc.setDrawColor(...RED); doc.setLineWidth(1); doc.line(ML, y, PW-MR, y); y += 1;
      doc.setFillColor(245,245,245); doc.rect(ML, y, TW, 20, 'F');
      setF('bold', 11, DARK);
      doc.text('TOTAL', ML+cQty+cCode+4, y+14);
      const pickerTotal = (pickerLines||[]).reduce((a,l)=>a+(l.price||0),0);
      const total = pickerTotal + summary.lines.reduce((a,l,idx)=>{
        const ov=lineOverrides[idx]||{};
        if(ov.deleted)return a;
        return a+(ov.price!==undefined?sf2(ov.price):l.val);
      },0);
      setF('bold', 11, DARK);
      doc.text(money(total), PW-MR-4, y+14, {align:'right'});
      y += 26;

      // ── TERMS & CONDITIONS — force new page ──────────────────────────────
      drawFooter();
      doc.addPage();
      y = 54;

      // T&C header bar
      doc.setFillColor(...RED); doc.rect(ML,y-2,TW,24,'F');
      setF('bold',13,[255,255,255]); doc.text('NOTES',ML+10,y+13); y+=32;

      const TERMS = [
        "All work to be performed during normal business hours unless specifically noted on this quote.",
        "Customer is to supply all installation hardware, cables, hoses, mating connections for power or fluid, electrical/resistive and dummy loads, and specialized monitoring equipment/peripheral equipment unless other arrangements with NU Laboratories, Inc. have been made. No functional testing shall be performed by NU Laboratories or its personnel unless specifically addressed in our quotation.",
        "All equipment, including the UUT, support equipment, test fixtures, mounting brackets, etc. are to be delivered to NU Laboratories no later than (5) business days prior to the scheduled testing start date.",
        "Return shipping arrangements are to be provided prior to the start of testing. If not, storage charges will apply beginning (5) business days after testing is completed.",
        "If applicable, all import and export documentation is to be provided by the customer.",
        "Out-of-scope work, including additional efforts and standby charges are to be determined at NU Laboratories' discretion and will be quoted separately.",
        "This quote does not guarantee a specific testing schedule, nor does it represent a fixed number of testing days. Scheduling will be secured with the receipt of a purchase order and/or test procedure approval.",
        "Testing duration may be affected by factors such as equipment malfunctions or failures, delays in the delivery of customer-supplied equipment, or other unforeseen issues. Such circumstances may result in additional charges.",
        "Delays caused by NU Laboratories--including, but not limited to, the unavailability of test equipment or personnel--will not result in charges to the customer. However, such delays will not entitle the customer to any discounts, refunds, or price reductions.",
        "The provided quote is based on a pass scenario and does not account for any additional time required due to test item malfunctions or failures. Should the customer's representative request a retest or engineering evaluation, a separate quote will be issued.",
        "Any requested lead times are estimated and may be subject to change.",
        "This quote is based on a total purchase and is good for a period of 90 days.",
        "All mounting hardware is assumed to be supplied by the customer. If NU Laboratories is asked to supply mounting hardware, it is assumed to be SAE Grade 5. Any other material hardware will be quoted separately and specifically noted within the quote. If no notes pertaining to the type of hardware are present on the quote, the quote reflects Grade 5 hardware. All fixturing provided by NU Laboratories is assumed to be A36 Steel. All other hardware and fixture requirements will be quoted separately if not detailed in this quote.",
      ];
      TERMS.forEach((t,i) => {
        const w = doc.splitTextToSize(t, TW-20);
        const blockH = w.length*11+5;
        checkY(blockH+3);
        doc.setFillColor(...LIGHT); doc.circle(ML+7, y+3, 5, 'F');
        setF('bold',7,MUTED); doc.text(String(i+1), ML+7, y+6, {align:'center'});
        setF('normal', 8, DARK); doc.text(w, ML+18, y+6);
        y += blockH;
      });
      y += 10;

      // ── GOVERNMENT SOURCE INSPECTION ─────────────────────────────────────
      checkY(70);
      doc.setFillColor(...LIGHT); doc.rect(ML,y-2,TW,18,'F');
      doc.setFillColor(...RED); doc.rect(ML,y-2,3,18,'F');
      setF('bold',9,RED); doc.text('GOVERNMENT SOURCE INSPECTION',ML+10,y+10); y+=26;
      setF('normal', 9, DARK);
      doc.text('If Government Source Inspection is required:', ML, y); y += 14;
      [['Navy Nuclear','Naseer Murray -- naseer.t.murray.civ@mail.mil'],
       ['Non-Nuclear','Tyson Rounsaville, QAR -- tyson.rounsaville.civ@mail.mil -- T: 973-891-3850  F: 973-446-4236'],
      ].forEach(([k,v]) => {
        checkY(18);
        setF('bold',9,DARK); const kw=doc.getTextWidth('* '+k+': ');
        doc.text('* '+k+': ', ML+4, y);
        setF('normal',9,DARK);
        const vw=doc.splitTextToSize(v, TW-kw-10);
        doc.text(vw, ML+4+kw, y); y += vw.length*12+6;
      });
      y += 12;

      // ── Closing paragraphs ───────────────────────────────────────────────
      const closingParas = [
        'This is a line item quote. Please have your purchase order reflect each line item and our quote number. Please send the signed Terms and Conditions page and Purchase Orders to Fax: 908-713-9001 or e-mail: sales@nulabs.com, attention Jordan McAdoo.',
        'We appreciate this opportunity to quote on your testing requirements. In the event that we receive a purchase order for the above testing, please acknowledge the enclosed terms and conditions and return with your order. Should you have further questions, please feel free to contact us.',
      ];
      setF('normal', 9, DARK);
      closingParas.forEach(t => {
        const w = doc.splitTextToSize(t, TW);
        checkY(w.length*12+10);
        doc.text(w, ML, y); y += w.length*12+10;
      });

      // ── Signature block ──────────────────────────────────────────────────
      checkY(90); y += 16;
      setF('normal', 8.5, MUTED); doc.text('Submitted by:', ML, y); y += 6;
      // Real signature image — aspect ratio ~1330/630 ≈ 2.1:1, render at 140pt wide
      try { doc.addImage(JORDAN_SIG_PDF,'PNG',ML,y,140,66); }
      catch(e) { setF('italic',18,DARK); doc.text('Jordan McAdoo',ML,y+40); }
      y += 70;
      setF('bold', 9, DARK); doc.text('Jordan McAdoo', ML, y); y += 13;
      setF('normal', 8.5, MUTED); doc.text('Sales Manager, NU Laboratories, Inc.', ML, y);

    }} // end if(!budgetOnly)

    // ── BUDGET PDF ────────────────────────────────────────────────────────
    if(budgetOnly&&budget.on&&budget.rows.length>0){
      // Logo
      try { doc.addImage(NU_LOGO_PDF, 'PNG', ML, y, 180, 40); }
      catch(e) { setF('bold', 14, RED); doc.text('NU LABORATORIES', ML, y+28); }
      // Address top-right
      setF('normal', 8.5, DARK);
      ['312 Old Allerton Road','Annandale, NJ 08801-3206',
       'Tel: 908-713-9300 | Fax: 908-713-9001','sales@nulabs.com']
        .forEach((l,i) => doc.text(l, PW-MR, y+14+i*11, {align:'right'}));
      y += 54;
      doc.setDrawColor(...RED); doc.setLineWidth(1.5);
      doc.line(ML, y, PW-MR, y);
      y += 16;
      // Title
      setF('bold', 16, RED); doc.text('BUDGET MATERIALS', ML, y); y += 4;
      setF('normal', 9, MUTED); doc.text('Date: '+(qi.revDate||qi.date||''), PW-MR, y-10, {align:'right'});
      if(qi.opp){ setF('normal',9,DARK); doc.text('Opportunity: ',ML,y+6); setF('bold',9,DARK); doc.text(qi.opp,ML+55,y+6); y+=20; }
      else{ y+=14; }
      // Internal notes
      const bNotes=(budget.notes||'').trim();
      if(bNotes){
        checkY(20); setF('bold',8.5,DARK); doc.text('Internal Notes:',ML,y); y+=11;
        setF('normal',8.5,[80,80,80]);
        bNotes.split('\n').forEach(line=>{if(!line.trim()){y+=4;return;}const w=doc.splitTextToSize(line,TW-6);checkY(w.length*11+2);doc.text(w,ML+4,y);y+=w.length*11+2;});
        y+=8;
      }
      y += 6;
      const mp=sf2(budget.markup||25)/100;
      const hardTot=budget.rows.reduce((s,r)=>s+sf2(r.qty||1)*sf2(r.unitCost||0),0);
      doc.setFillColor(50,50,50); doc.rect(ML,y,TW,16,'F');
      setF('bold',8.5,[255,255,255]);
      const bDesc=TW*0.44,bQty=TW*0.08,bUC=TW*0.16,bHC=TW*0.16,bMU=TW*0.16;
      let bx=ML;
      doc.text('Part / Description',bx+4,y+11);bx+=bDesc;
      doc.text('Qty',bx+bQty/2,y+11,{align:'center'});bx+=bQty;
      doc.text('Unit Cost',bx+4,y+11);bx+=bUC;
      doc.text('Hard Cost',bx+4,y+11);bx+=bHC;
      doc.text('w/ Markup',bx+4,y+11);
      y+=16;
      budget.rows.forEach((r,idx)=>{
        checkY(14);
        doc.setFillColor(...(idx%2===0?[255,255,255]:[247,248,250]));
        doc.rect(ML,y,TW,14,'F');
        setF('normal',8.5,DARK);
        bx=ML;
        const hardCost=sf2(r.qty||1)*sf2(r.unitCost||0);
        const markedUp=Math.round(hardCost*(1+mp));
        const dw=doc.splitTextToSize(r.desc||'',bDesc-8);
        doc.text(dw,bx+4,y+10);bx+=bDesc;
        doc.text(String(r.qty||'1'),bx+bQty/2,y+10,{align:'center'});bx+=bQty;
        doc.text('$'+sf2(r.unitCost||0).toLocaleString(),bx+4,y+10);bx+=bUC;
        setF('bold',8.5,DARK);doc.text('$'+Math.round(hardCost).toLocaleString(),bx+4,y+10);bx+=bHC;
        setF('bold',8.5,RED);doc.text('$'+markedUp.toLocaleString(),bx+4,y+10);
        y+=Math.max(14,dw.length*11+3);
      });
      checkY(18);
      doc.setFillColor(232,236,240);doc.rect(ML,y,TW,16,'F');
      doc.setDrawColor(...RED);doc.setLineWidth(0.5);doc.line(ML,y,PW-MR,y);
      setF('bold',8.5,DARK);
      bx=ML+bDesc+bQty;
      doc.text('Markup: '+Math.round(sf2(budget.markup||25))+'%',bx+4,y+11);
      bx+=bUC;
      doc.text('$'+Math.round(hardTot).toLocaleString(),bx+4,y+11);
      bx+=bHC;
      setF('bold',8.5,RED);doc.text('$'+Math.round(hardTot*(1+mp)).toLocaleString(),bx+4,y+11);
      y+=22;
    }

    // footers on all pages
    const tp = doc.internal.getNumberOfPages();
    for(let p=1;p<=tp;p++){ doc.setPage(p); drawFooter(); }

    const fname=((qi.opp)||'Quote')+(budgetOnly?' Budget':'')+'.pdf';
    await savePdfAs(doc, fname);
  };


  return(
    <div style={{height:"100vh",background:C.bg,fontFamily:"Segoe UI,system-ui,sans-serif",color:C.text,display:"flex",flexDirection:"column",fontSize:13}}>

      {/* ── Header ── */}
      <div style={{background:C.accent,flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
        <div style={{padding:"9px 18px",display:"flex",alignItems:"center",gap:10}}>
        <div style={{background:"#fff",borderRadius:20,padding:"4px 12px",display:"flex",alignItems:"center",justifyContent:"center",height:36}}>
                  <img src="data:image/png;base64,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" alt="NU Laboratories" style={{height:28,width:"auto",objectFit:"contain"}}/>
                </div>
          <div style={{fontWeight:700,fontSize:13,letterSpacing:1,color:"rgba(255,255,255,0.5)",marginLeft:4}}>NUFORCE</div>
          <div style={{flex:1}}/>
          <button onClick={()=>{window.location.href="https://workspace.nulabs.com";}}
            title="Open NUWorkspace"
            style={{background:"none",border:"1px solid rgba(255,255,255,0.25)",
              borderRadius:6,padding:"5px 12px",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:600,
              marginRight:6}}>
            ← NUWorkspace
          </button>
          <button onClick={()=>navigateTo(true)}
            title="Go to dashboard"
            style={{background:showDashboard?"rgba(255,255,255,0.2)":"none",border:"1px solid rgba(255,255,255,0.25)",
              borderRadius:6,padding:"5px 12px",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:600}}>
            📋 Dashboard
          </button>
          <QuoteSearch onLoad={q=>{handleLoad(q);navigateTo(false);}}/>

          {!showDashboard&&<button onClick={handleClone} title="Clone this quote"
            style={{background:"#2e6da4",border:"none",borderRadius:7,padding:"7px 14px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:.5}}>
            CLONE
          </button>}

          {!showDashboard&&<button onClick={handleSave}
            style={{background:C.red,border:"none",borderRadius:7,padding:"7px 16px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:.5}}>
            SAVE
          </button>}


          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)"}}/>
          {currentUser&&<div style={{fontSize:10,color:"rgba(255,255,255,0.55)"}}>{currentUser}</div>}
          {currentQuoteId&&<button onClick={handleDeleteQuote} title="Delete this quote"
            style={{background:"none",border:"1px solid rgba(255,100,100,0.4)",borderRadius:6,padding:"5px 8px",
              color:"rgba(255,160,160,0.8)",fontSize:11,cursor:"pointer"}}>
            🗑
          </button>}
          {onLogout&&<button onClick={onLogout}
            style={{background:"none",border:"1px solid rgba(255,255,255,0.25)",borderRadius:6,padding:"5px 10px",
              color:"rgba(255,255,255,0.6)",fontSize:11,cursor:"pointer"}}>
            Sign out
          </button>}
        </div>
        {/* Row 2: approval bar — hidden on dashboard */}
        {!showDashboard&&(
          <div style={{background:"rgba(0,0,0,0.18)",padding:"5px 18px",display:"flex",alignItems:"center",gap:8,borderTop:"1px solid rgba(255,255,255,0.07)"}}>
            {approval.status!=="none"&&(
              <div style={{borderRadius:5,padding:"3px 10px",fontWeight:700,fontSize:11,letterSpacing:.5,flexShrink:0,
                background:approval.status==="pending"?"#b7791f":approval.status==="approved"?"#1e8449":"#c0392b",color:"#fff"}}>
                {approval.status==="pending"&&"PENDING APPROVAL"}
                {approval.status==="approved"&&"APPROVED"}
                {approval.status==="rejected"&&"REJECTED"}
              </div>
            )}
            {approval.status!=="none"&&(approval.history||[]).length>0&&(
              <button onClick={()=>setShowApprovalHistory(true)}
                title="View approval history"
                style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                  borderRadius:5,padding:"3px 10px",color:"#fff",fontSize:11,cursor:"pointer",fontWeight:600}}>
                📋 History
              </button>
            )}
            {(approval.status==="none"||approval.status==="rejected"||(approval.status==="approved"&&!locked))&&(
              <button onClick={()=>setShowApprovalModal(true)}
                style={{background:"#6d28d9",border:"none",borderRadius:6,padding:"4px 12px",
                  color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",letterSpacing:.5}}>
                📋 {approval.status==="approved"&&!locked?"RE-SUBMIT":"SUBMIT"}
              </button>
            )}
            {qi.stage==="Closed Won"&&wonApproval.status==="none"&&!wonInfo?.wonDate&&!wonInfo?.poNum&&(
              <button onClick={()=>{
                if(window.confirm("Submit this quote for Closed Won approval?\n\nThis will lock the quote and send it to the approval queue."))
                  handleSubmitWonApproval();
              }}
                style={{background:"#1e8449",border:"none",borderRadius:6,padding:"4px 12px",
                  color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",letterSpacing:.5}}>
                🏆 SUBMIT WON
              </button>
            )}
            {qi.stage==="Closed Won"&&wonApproval.status==="pending_won"&&(
              <div style={{background:"#b7791f",borderRadius:5,padding:"3px 10px",
                fontSize:11,fontWeight:700,color:"#fff",letterSpacing:.5}}>
                🏆 WON PENDING
              </div>
            )}
            {qi.stage==="Closed Won"&&wonApproval.status==="won_approved"&&(
              <div style={{background:"#1e8449",borderRadius:5,padding:"3px 10px",
                fontSize:11,fontWeight:700,color:"#fff",letterSpacing:.5}}>
                ✅ WON APPROVED
              </div>
            )}
            {isApprover&&approval.status==="pending"&&(
              <>
                <button onClick={handleApproverUnlock}
                  style={{background:"#b7791f",border:"none",borderRadius:6,padding:"4px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  ✏️ EDIT
                </button>
                <button onClick={handleApprove}
                  style={{background:"#1e8449",border:"none",borderRadius:6,padding:"4px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  ✅ APPROVE
                </button>
                <button onClick={handleReject}
                  style={{background:"#c0392b",border:"none",borderRadius:6,padding:"4px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  ❌ REJECT
                </button>
              </>
            )}
            <div style={{flex:1}}/>
            {!showDashboard&&currentQuoteId&&(
              <CopyEmailButton qi={qi} ti={ti} emis={emis} pqs={pqs} dcms={dcms} showToast={showToast}/>
            )}
            {!showDashboard&&currentQuoteId&&(
              <button onClick={()=>setShowChatter(c=>!c)}
                style={{background:showChatter?"rgba(26,82,118,0.9)":"rgba(255,255,255,0.12)",
                  border:"1px solid rgba(255,255,255,0.2)",borderRadius:5,padding:"3px 10px",
                  color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:5}}>
                💬 CHATTER{chatterEntries.length>0&&<span style={{background:"rgba(255,255,255,0.25)",borderRadius:10,padding:"1px 6px",fontSize:10}}>{chatterEntries.length}</span>}
              </button>
            )}
            {!showDashboard&&currentQuoteId&&(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {quoteSentAt&&(
                  <span style={{background:"rgba(30,132,73,0.85)",borderRadius:5,
                    padding:"3px 8px",color:"#fff",fontSize:10,fontWeight:700,
                    letterSpacing:.3,whiteSpace:"nowrap"}}>
                    ✓ Sent {new Date(quoteSentAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </span>
                )}
                <button onClick={()=>setShowSendConfirm(true)}
                  style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                    borderRadius:5,padding:"3px 10px",color:"#fff",fontWeight:700,fontSize:11,
                    cursor:"pointer"}}>
                  ✉️ Send
                </button>
                {/* Sent history icon — opens a modal listing every send event for this quote */}
                <button onClick={async()=>{
                    try {
                      const data = await restFetch("GET",
                        `follow_ups?select=id,sent_at,sent_by,voided&quote_id=eq.${encodeURIComponent(currentQuoteId)}&sent_by=neq.salesforce_import&order=sent_at.desc`);
                      setSentHistory(data||[]);
                      setShowSentHistory(true);
                    } catch(e) {
                      console.warn("[SENT-HISTORY] failed:", e?.message||e);
                      showToast("Error loading sent history","error",4000);
                    }
                  }}
                  title="View sent history"
                  style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                    borderRadius:5,padding:"3px 8px",color:"#fff",fontWeight:700,fontSize:11,
                    cursor:"pointer",lineHeight:1}}>
                  🕐
                </button>
              </div>
            )}

            {/* ── Send confirmation popup ── */}
            {showSendConfirm && !showDashboard && currentQuoteId && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,
                display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
                onClick={()=>{ if(!sentBusy) setShowSendConfirm(false); }}>
                <div onClick={e=>e.stopPropagation()}
                  style={{background:"#fff",borderRadius:12,padding:24,maxWidth:420,width:"100%",
                    boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#1a2332",marginBottom:8}}>
                    Mark as Sent?
                  </div>
                  <div style={{fontSize:13,color:"#6b7a8d",marginBottom:20,lineHeight:1.5}}>
                    Mark <b>{qi.opp||"this quote"}</b> as sent? This records a send event and (when linked to email) will send the quote.
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <button onClick={()=>{ if(!sentBusy) setShowSendConfirm(false); }}
                      disabled={sentBusy}
                      style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"8px 16px",fontSize:12,cursor:sentBusy?"not-allowed":"pointer",
                        color:"#1a2332",fontWeight:600,opacity:sentBusy?0.6:1}}>
                      Cancel
                    </button>
                    <button onClick={async()=>{
                        setSentBusy(true);
                        try {
                          const rows = await restFetch("POST", "follow_ups?select=sent_at",
                            {body:{
                              quote_id:currentQuoteId,
                              opportunity:qi.opp,
                              customer:qi.account,
                              sent_by:currentUser,
                            }, returnRepresentation:true});
                          const data = (rows||[])[0];
                          setQuoteSentAt(data?.sent_at || new Date().toISOString());
                          setShowSendConfirm(false);
                          showToast("✉️ Marked as sent — will appear in Follow-ups in 30 days","success",4000);
                        } catch(e){
                          console.warn("[SEND-MARK] failed:",e?.message||e);
                          showToast("Error marking as sent: " + (e?.message||e),"error",5000);
                        } finally {
                          setSentBusy(false);
                        }
                      }}
                      disabled={sentBusy}
                      style={{background:"#1e8449",border:"none",borderRadius:6,padding:"8px 16px",
                        fontSize:12,cursor:sentBusy?"not-allowed":"pointer",color:"#fff",fontWeight:700,
                        opacity:sentBusy?0.6:1}}>
                      {sentBusy?"Working...":"Confirm Send"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Sent history modal ── */}
            {showSentHistory && !showDashboard && currentQuoteId && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,
                display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
                onClick={()=>setShowSentHistory(false)}>
                <div onClick={e=>e.stopPropagation()}
                  style={{background:"#fff",borderRadius:12,padding:24,maxWidth:500,width:"100%",
                    maxHeight:"80vh",overflow:"auto",boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#1a2332"}}>
                      Sent History — {qi.opp||"Quote"}
                    </div>
                    <button onClick={()=>setShowSentHistory(false)}
                      style={{background:"transparent",border:"none",fontSize:18,color:"#9aa5b1",
                        cursor:"pointer",padding:"0 4px",lineHeight:1}}>×</button>
                  </div>
                  {sentHistory.length===0?(
                    <div style={{padding:"20px",textAlign:"center",color:"#9aa5b1",fontSize:13}}>
                      No send events recorded for this quote yet.
                    </div>
                  ):(
                    <div>
                      {sentHistory.map(ev=>{
                        const isVoided = !!ev.voided;
                        const dateColor = isVoided ? "#9aa5b1" : "#1a2332";
                        const byColor = isVoided ? "#b0b7c0" : "#6b7a8d";
                        return (
                          <div key={ev.id} style={{display:"flex",alignItems:"center",gap:12,
                            padding:"10px 0",borderBottom:"1px solid #f0f2f5"}}>
                            <div style={{fontSize:12,color:dateColor,minWidth:140,fontWeight:600,
                              textDecoration:isVoided?"line-through":"none"}}>
                              {new Date(ev.sent_at).toLocaleDateString("en-US",
                                {month:"short",day:"numeric",year:"numeric"})}
                              <span style={{color:"#9aa5b1",fontWeight:400,marginLeft:6}}>
                                {new Date(ev.sent_at).toLocaleTimeString("en-US",
                                  {hour:"numeric",minute:"2-digit"})}
                              </span>
                            </div>
                            <div style={{flex:1,fontSize:12,color:byColor,
                              textDecoration:isVoided?"line-through":"none"}}>
                              by {ev.sent_by||"(unknown)"}
                            </div>
                            {isVoided && (
                              <div style={{fontSize:9,fontWeight:700,color:"#b91c1c",
                                background:"#fef2f2",border:"1px solid #fecaca",borderRadius:4,
                                padding:"2px 6px",letterSpacing:.5}}>
                                VOIDED
                              </div>
                            )}
                            {isApprover && (
                              isVoided ? (
                                <button onClick={async()=>{
                                    setVoidBusy(true);
                                    try {
                                      await restFetch("PATCH",
                                        `follow_ups?id=eq.${encodeURIComponent(ev.id)}`,
                                        {body:{voided:false}});
                                      const newHistory = sentHistory.map(r=>
                                        r.id===ev.id ? {...r,voided:false} : r);
                                      setSentHistory(newHistory);
                                      // Recompute "last sent" — restoring may bring a
                                      // newer date back into play.
                                      const latestNonVoided = newHistory.find(r => !r.voided);
                                      setQuoteSentAt(latestNonVoided ? latestNonVoided.sent_at : null);
                                    } catch(e) {
                                      console.warn("[VOID] unvoid failed:", e?.message||e);
                                      showToast("Failed to restore","error",4000);
                                    }
                                    setVoidBusy(false);
                                  }}
                                  disabled={voidBusy}
                                  style={{background:"none",border:"1px solid #d0d7de",
                                    borderRadius:5,padding:"3px 8px",fontSize:10,
                                    color:"#6b7a8d",cursor:voidBusy?"default":"pointer",
                                    fontWeight:600}}>
                                  Restore
                                </button>
                              ) : (
                                <button onClick={()=>setVoidConfirmId(ev.id)}
                                  disabled={voidBusy}
                                  style={{background:"none",border:"1px solid #d0d7de",
                                    borderRadius:5,padding:"3px 8px",fontSize:10,
                                    color:"#b91c1c",cursor:voidBusy?"default":"pointer",
                                    fontWeight:600}}>
                                  Void
                                </button>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Void confirmation popup ── */}
            {voidConfirmId && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,
                display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
                onClick={()=>{ if(!voidBusy) setVoidConfirmId(null); }}>
                <div onClick={e=>e.stopPropagation()}
                  style={{background:"#fff",borderRadius:12,padding:24,maxWidth:420,width:"100%",
                    boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#1a2332",marginBottom:8}}>
                    Void this send event?
                  </div>
                  <div style={{fontSize:13,color:"#6b7a8d",marginBottom:20,lineHeight:1.5}}>
                    Marks this send as voided. It stays in the history (struck-through) but no
                    longer triggers follow-ups or counts toward whether this quote has been sent.
                    You can restore it later if needed.
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                    <button onClick={()=>setVoidConfirmId(null)} disabled={voidBusy}
                      style={{background:"#fff",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"7px 16px",fontSize:12,cursor:voidBusy?"default":"pointer",
                        color:"#6b7a8d"}}>
                      Cancel
                    </button>
                    <button onClick={async()=>{
                        const targetId = voidConfirmId;
                        setVoidBusy(true);
                        try {
                          await restFetch("PATCH",
                            `follow_ups?id=eq.${encodeURIComponent(targetId)}`,
                            {body:{voided:true}});
                          // Update local history state
                          const newHistory = sentHistory.map(r=>
                            r.id===targetId ? {...r,voided:true} : r);
                          setSentHistory(newHistory);
                          // Recompute the "last sent" indicator. If there's still a
                          // non-voided send, use its date; otherwise clear the badge.
                          // sentHistory is sorted desc by sent_at, so first non-voided
                          // entry is the new latest send.
                          const latestNonVoided = newHistory.find(r => !r.voided);
                          setQuoteSentAt(latestNonVoided ? latestNonVoided.sent_at : null);
                          showToast("Send event voided","info",2500);
                        } catch(e) {
                          console.warn("[VOID] failed:", e?.message||e);
                          showToast("Void failed — try again","error",4000);
                        }
                        setVoidBusy(false);
                        setVoidConfirmId(null);
                      }} disabled={voidBusy}
                      style={{background:"#b91c1c",border:"none",borderRadius:6,
                        padding:"7px 16px",fontSize:12,fontWeight:600,
                        cursor:voidBusy?"default":"pointer",color:"#fff"}}>
                      {voidBusy?"Voiding…":"Void"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Flag button ── */}
            {!showDashboard&&currentQuoteId&&(
              <div style={{position:"relative"}}>
                <button onClick={()=>{setShowFlagPopover(v=>!v);}}
                  style={{background:quoteFlag?"rgba(185,28,28,0.85)":"rgba(255,255,255,0.12)",
                    border:"1px solid rgba(255,255,255,0.2)",borderRadius:5,padding:"3px 10px",
                    color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  🚩 {quoteFlag?"FLAGGED":"Flag"}
                </button>
                {showFlagPopover&&(
                  <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:500,
                    background:"#fff",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",
                    border:"1px solid #e8ecf0",padding:"14px 16px",minWidth:260}}>
                    <div onClick={()=>setShowFlagPopover(false)} style={{position:"fixed",inset:0,zIndex:-1}}/>
                    <div style={{fontSize:11,fontWeight:700,color:"#9aa5b1",letterSpacing:.8,marginBottom:8}}>
                      {quoteFlag?"REMOVE FLAG":"FLAG THIS QUOTE"}
                    </div>
                    {quoteFlag?(
                      <div>
                        <div style={{fontSize:11,color:"#4a5568",marginBottom:4}}>
                          Flagged by {quoteFlag.flagged_by} on {new Date(quoteFlag.flagged_at).toLocaleDateString()}
                        </div>
                        {quoteFlag.note&&<div style={{fontSize:11,color:"#6b7a8d",fontStyle:"italic",marginBottom:10}}>"{quoteFlag.note}"</div>}
                        <button onClick={handleFlag} disabled={flagLoading}
                          style={{width:"100%",background:"#b91c1c",border:"none",borderRadius:6,
                            padding:"7px 0",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                          {flagLoading?"Removing…":"✕ Remove Flag"}
                        </button>
                      </div>
                    ):(
                      <div>
                        <textarea
                          value={flagNote}
                          onChange={e=>setFlagNote(e.target.value)}
                          placeholder="Add a note (optional)..."
                          rows={2}
                          style={{width:"100%",fontSize:11,borderRadius:6,border:"1px solid #d0d7de",
                            padding:"6px 8px",resize:"none",fontFamily:"inherit",marginBottom:8,
                            boxSizing:"border-box"}}
                        />
                        <button onClick={handleFlag} disabled={flagLoading}
                          style={{width:"100%",background:"#b91c1c",border:"none",borderRadius:6,
                            padding:"7px 0",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                          {flagLoading?"Flagging…":"🚩 Flag This Quote"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!showDashboard&&currentQuoteId&&(
              <div style={{position:"relative"}}>
                <button onClick={()=>{
                    setShowFollowUpPopover(v=>!v);
                    // Default date = today
                    if(!followUpDate)setFollowUpDate(new Date().toISOString().slice(0,10));
                  }}
                  style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                    borderRadius:5,padding:"3px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  📌 Follow Up
                </button>
                {showFollowUpPopover&&(
                  <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:500,
                    background:"#fff",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",
                    border:"1px solid #e8ecf0",padding:"14px 16px",minWidth:220}}>
                    {/* Click outside to close */}
                    <div onClick={()=>setShowFollowUpPopover(false)}
                      style={{position:"fixed",inset:0,zIndex:-1}}/>
                    <div style={{fontSize:11,fontWeight:700,color:"#9aa5b1",letterSpacing:.8,marginBottom:10}}>
                      ADD TO FOLLOW-UPS
                    </div>
                    {/* Right now option */}
                    <button onClick={async()=>{
                        const today=new Date().toISOString().slice(0,10);
                        const followupAt=new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
                        try {
                          await restFetch("POST", "follow_ups", {body:{
                            quote_id:currentQuoteId,
                            opportunity:qi.opp,
                            customer:qi.account,
                            sent_by:currentUser,
                            sent_at:new Date(Date.now()-30*24*60*60*1000-1000).toISOString(), // 30 days ago = shows immediately
                            followup_again_at:null,
                          }});
                          setShowFollowUpPopover(false);
                          showToast("📌 Added to follow-ups now","success",3000);
                        } catch(e) {
                          console.warn("[FOLLOW-UP-NOW] failed:", e?.message||e);
                          setShowFollowUpPopover(false);
                          showToast("Error adding follow-up: "+(e?.message||e),"error",4000);
                        }
                      }}
                      style={{width:"100%",background:"#1a5276",border:"none",borderRadius:7,
                        padding:"8px 12px",color:"#fff",fontWeight:700,fontSize:12,
                        cursor:"pointer",marginBottom:8,textAlign:"left"}}>
                      ⚡ Follow up right now
                    </button>
                    {/* Scheduled option */}
                    <div style={{fontSize:11,color:"#6b7a8d",marginBottom:6,fontWeight:600}}>
                      — or schedule for a date —
                    </div>
                    <input type="date" value={followUpDate}
                      onChange={e=>setFollowUpDate(e.target.value)}
                      min={new Date().toISOString().slice(0,10)}
                      style={{width:"100%",border:"1px solid #d0d7de",borderRadius:6,
                        padding:"6px 8px",fontSize:12,fontFamily:"inherit",
                        boxSizing:"border-box",marginBottom:8}}/>
                    <button onClick={async()=>{
                        if(!followUpDate){showToast("Pick a date first","info");return;}
                        // Set sent_at far enough back that it won't show until followup_again_at
                        try {
                          await restFetch("POST", "follow_ups", {body:{
                            quote_id:currentQuoteId,
                            opportunity:qi.opp,
                            customer:qi.account,
                            sent_by:currentUser,
                            sent_at:new Date(Date.now()-31*24*60*60*1000).toISOString(), // already 31d old
                            followed_up:true,  // hide from list initially
                            followed_up_at:new Date().toISOString(),
                            followed_up_by:currentUser,
                            followup_again_at:followUpDate, // show on this date
                          }});
                          setShowFollowUpPopover(false);
                          showToast(`📌 Follow-up scheduled for ${new Date(followUpDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`,"success",4000);
                        } catch(e) {
                          console.warn("[FOLLOW-UP-SCHEDULE] failed:", e?.message||e);
                          setShowFollowUpPopover(false);
                          showToast("Error scheduling follow-up: "+(e?.message||e),"error",4000);
                        }
                      }}
                      disabled={!followUpDate}
                      style={{width:"100%",background:followUpDate?"#1e8449":"#ccc",border:"none",
                        borderRadius:7,padding:"8px 12px",color:"#fff",fontWeight:700,
                        fontSize:12,cursor:followUpDate?"pointer":"not-allowed",textAlign:"left"}}>
                      📅 Schedule for this date
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={()=>{ const pendingLock=approval.status==="pending"; if(!pendingLock||isApprover) setLocked(l=>!l); }}
              title={approval.status==="pending"&&!isApprover?"Only owners can unlock a quote pending approval":""}
              style={{background:locked?"rgba(183,121,31,0.85)":"rgba(45,106,79,0.85)",border:"none",borderRadius:5,padding:"3px 10px",
                color:"#fff",fontWeight:700,fontSize:11,
                cursor:approval.status==="pending"&&!isApprover?"not-allowed":"pointer",
                display:"flex",alignItems:"center",gap:4,
                opacity:approval.status==="pending"&&!isApprover?0.5:1}}>
              {locked?"🔒 LOCKED":"🔓 UNLOCKED"}
            </button>
          </div>
        )}
      </div>

      {/* ── Body: left scroll + right sticky summary ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {showDashboard?(
          <Dashboard onEnterQuote={()=>{handleNewQuote(true);navigateTo(false);}} onLoadQuote={q=>{handleLoad(q);navigateTo(false);}} onNewQuoteForAccount={name=>{handleNewQuote(true);setQi(q=>({...q,account:name}));navigateTo(false);}} currentUser={currentUser} isApprover={isApprover} isFollowUpUser={isFollowUpUser} pendingQuotes={pendingQuotes} onQueueDecision={handleQueueDecision} needsRefresh={dashboardNeedsRefresh} onRefreshComplete={()=>setDashboardNeedsRefresh(false)}/>
        ):(
        <>{/* ── Left: scrollable form column ── */}
        <div style={{flex:1,overflowY:"auto",background:C.bg,padding:14,position:"relative"}}>



          {/* ── Approval submission modal ── */}
          {showApprovalModal&&(
            <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setShowApprovalModal(false);}}>
              <div style={{background:"#fff",borderRadius:14,padding:28,width:440,boxShadow:"0 8px 40px rgba(0,0,0,0.25)"}}>
                <div style={{fontWeight:700,fontSize:15,color:"#1a2332",marginBottom:6}}>Submit Quote for Approval</div>
                <div style={{fontSize:12,color:"#6b7a8d",marginBottom:16,lineHeight:1.6}}>
                  This will <b>lock the quote</b> and notify the approvers. They will be able to approve, reject, or make changes before approving.
                </div>
                <div style={{background:"#f0f2f5",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12}}>
                  <div style={{color:"#6b7a8d",marginBottom:4,fontWeight:600}}>QUOTE DETAILS</div>
                  <div><b>Opportunity:</b> {qi.opp||"(none)"}</div>
                  <div><b>RFQ:</b> {qi.rfq||"(none)"}</div>
                  <div><b>Total:</b> {money(displayTotal)}</div>
                  <div style={{marginTop:6,color:"#6b7a8d",fontSize:11}}>Notifying: Jordan McAdoo, Ragen McAdoo, Russ McAdoo</div>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setShowApprovalModal(false)}
                    style={{background:"#e8ecf0",border:"none",borderRadius:7,padding:"8px 18px",fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332"}}>
                    Cancel
                  </button>
                  <button onClick={handleSubmitApproval}
                    style={{background:"#6d28d9",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,fontSize:12,cursor:"pointer",color:"#fff"}}>
                    Submit for Approval
                  </button>
                </div>
              </div>
            </div>
          )}


          {/* ── Approval History Modal ── */}
          {showApprovalHistory&&(
            <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setShowApprovalHistory(false);}}>
              <div style={{background:"#fff",borderRadius:14,width:480,maxWidth:"95vw",maxHeight:"75vh",
                boxShadow:"0 8px 40px rgba(0,0,0,0.3)",display:"flex",flexDirection:"column"}}>

                {/* Header */}
                <div style={{padding:"18px 24px",borderBottom:"1px solid #e8ecf0",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:15,color:"#1a2332"}}>📋 Approval History</div>
                    <div style={{fontSize:11,color:"#6b7a8d",marginTop:2}}>
                      {qi.opp||"(no opportunity #)"}
                    </div>
                  </div>
                  <button onClick={()=>setShowApprovalHistory(false)}
                    style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7a8d",lineHeight:1}}>×</button>
                </div>

                {/* Timeline */}
                <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
                  {(approval.history||[]).length===0?(
                    <div style={{textAlign:"center",color:"#6b7a8d",fontSize:13,padding:20}}>No history recorded.</div>
                  ):(
                    <div style={{position:"relative"}}>
                      {/* Vertical line */}
                      <div style={{position:"absolute",left:14,top:8,bottom:8,width:2,background:"#e8ecf0"}}/>
                      {(approval.history||[]).map((evt,i)=>{
                        const isLast=i===(approval.history.length-1);
                        const color=evt.event==="approved"?"#1e8449":evt.event==="rejected"?"#c0392b":"#6d28d9";
                        const icon=evt.event==="approved"?"✅":evt.event==="rejected"?"❌":"📤";
                        const label=evt.event==="approved"?"Approved":evt.event==="rejected"?"Rejected":"Submitted for Approval";
                        const dt=evt.at?new Date(evt.at):null;
                        const dateStr=dt?dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
                        const timeStr=dt?dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}):"";
                        return(
                          <div key={i} style={{display:"flex",gap:16,marginBottom:i<(approval.history.length-1)?20:0,position:"relative"}}>
                            {/* Dot */}
                            <div style={{width:30,height:30,borderRadius:"50%",background:color,
                              display:"flex",alignItems:"center",justifyContent:"center",
                              fontSize:14,flexShrink:0,zIndex:1,boxShadow:"0 0 0 3px #fff"}}>
                              {icon}
                            </div>
                            {/* Content */}
                            <div style={{flex:1,paddingTop:4}}>
                              <div style={{fontWeight:700,fontSize:13,color:color,marginBottom:2}}>{label}</div>
                              <div style={{fontSize:12,color:"#1a2332",marginBottom:2}}>
                                <b>{evt.by||"Unknown"}</b>
                              </div>
                              <div style={{fontSize:11,color:"#6b7a8d"}}>
                                {dateStr}{timeStr?` at ${timeStr}`:""}
                              </div>
                              {evt.comments&&(
                                <div style={{marginTop:6,background:"#f8f9fb",borderRadius:6,padding:"6px 10px",
                                  fontSize:11,color:"#1a2332",borderLeft:"3px solid "+color}}>
                                  {evt.comments}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{padding:"12px 24px",borderTop:"1px solid #e8ecf0",textAlign:"right"}}>
                  <button onClick={()=>setShowApprovalHistory(false)}
                    style={{background:"#e8ecf0",border:"none",borderRadius:7,padding:"7px 20px",
                      fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332"}}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* ── Fab Guide Modal ── */}
          {showFabGuide&&(
            <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setShowFabGuide(false);}}>
              <div style={{background:"#fff",borderRadius:14,width:640,maxWidth:"96vw",maxHeight:"88vh",
                boxShadow:"0 8px 40px rgba(0,0,0,0.3)",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"16px 22px",borderBottom:"1px solid #e8ecf0",display:"flex",alignItems:"center"}}>
                  <div style={{flex:1,fontWeight:700,fontSize:15,color:"#1a2332"}}>Estimated fab times per test</div>
                  <button onClick={()=>setShowFabGuide(false)}
                    style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7a8d",lineHeight:1}}>×</button>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
                  {[
                    {hdr:"Medium weight shock",rows:[
                      ["Standard","4 holes","Up to 8 hrs"],
                      ["Standard","8 holes","Up to 12 hrs"],
                      ["Standard","16 holes","16 hrs"],
                      ["Standard",">16 holes",">16 hrs"],
                      ["Bookend (in stock)","Up to 12\" valves","8 – 12 hrs"],
                      ["Bookend (in stock)",">12\" valves",">12 hrs"],
                    ]},
                    {hdr:"Lightweight shock",rows:[
                      ["Standard","4 holes","4 hrs"],
                      ["Standard","6 – 8 holes","6 hrs"],
                      ["Standard","8+ holes","8 hrs"],
                      ["Bookend (in stock)","Any","8 hrs or less"],
                    ]},
                    {hdr:"Vibration — with MWS (use MWS rules)",rows:[
                      ["Standard","4 holes","Up to 8 hrs"],
                      ["Standard","8 holes","Up to 12 hrs"],
                      ["Standard","16 holes","16 hrs"],
                      ["Standard",">16 holes",">16 hrs"],
                      ["Bookend (in stock)","Up to 12\" valves","8 – 12 hrs"],
                      ["Bookend (in stock)",">12\" valves",">12 hrs"],
                    ]},
                    {hdr:"Vibration — with LWS or standalone <250 lbs (use LWS rules)",rows:[
                      ["Standard","4 holes","4 hrs"],
                      ["Standard","6 – 8 holes","6 hrs"],
                      ["Standard","8+ holes","8 hrs"],
                      ["Bookend (in stock)","Any","8 hrs or less"],
                    ]},
                    {hdr:"Vibration — standalone >250 lbs (use MWS rules)",rows:[
                      ["Standard","4 holes","Up to 8 hrs"],
                      ["Standard","8 holes","Up to 12 hrs"],
                      ["Standard","16 holes","16 hrs"],
                      ["Standard",">16 holes",">16 hrs"],
                    ]},
                    {hdr:"AB / SB noise — <250 lbs (use LWS rules)",rows:[
                      ["Standard","4 holes","4 hrs"],
                      ["Standard","6 – 8 holes","6 hrs"],
                      ["Standard","8+ holes","8 hrs"],
                    ]},
                    {hdr:"AB / SB noise — >250 lbs (use MWS rules)",rows:[
                      ["Standard","4 holes","Up to 8 hrs"],
                      ["Standard","8 holes","Up to 12 hrs"],
                      ["Standard","16 holes","16 hrs"],
                      ["Standard",">16 holes",">16 hrs"],
                    ]},
                    {hdr:"HFV / shock (other)",rows:[
                      ["Standard","4 holes","4 hrs"],
                      ["Standard","6 – 8 holes","6 hrs"],
                      ["Standard","8+ holes","8 hrs"],
                    ]},
                  ].map((section,si)=>(
                    <div key={si} style={{marginBottom:12}}>
                      <div style={{background:"#e8f0fb",padding:"4px 10px",fontSize:11,fontWeight:700,
                        color:"#1a5276",borderRadius:4,marginBottom:0}}>
                        {section.hdr}
                      </div>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                        <tbody>
                          {section.rows.map((row,ri)=>(
                            <tr key={ri} style={{background:ri%2===0?"#fff":"#f8f9fb"}}>
                              <td style={{padding:"4px 10px",borderBottom:"1px solid #f0f2f5",color:"#6b7a8d",width:"30%"}}>{row[0]}</td>
                              <td style={{padding:"4px 10px",borderBottom:"1px solid #f0f2f5",width:"35%"}}>{row[1]}</td>
                              <td style={{padding:"4px 10px",borderBottom:"1px solid #f0f2f5",fontWeight:600,width:"35%"}}>{row[2]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <div style={{fontSize:10,color:"#6b7a8d",padding:"6px 4px"}}>
                    All estimates assume standard materials and normal geometry. Review with engineering for unusual cases.
                  </div>
                </div>
                <div style={{padding:"10px 22px",borderTop:"1px solid #e8ecf0",textAlign:"right"}}>
                  <button onClick={()=>setShowFabGuide(false)}
                    style={{background:"#e8ecf0",border:"none",borderRadius:7,padding:"7px 20px",
                      fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332"}}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* ── Clone modal — enter new opportunity # ── */}
          {showCloneModal&&(
            <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget){setShowCloneModal(false);setCloneOppInput("");}}}>
              <div style={{background:"#fff",borderRadius:14,padding:28,width:380,boxShadow:"0 8px 40px rgba(0,0,0,0.25)"}}>
                <div style={{fontWeight:700,fontSize:15,color:"#1a2332",marginBottom:6}}>Clone Quote</div>
                <div style={{fontSize:12,color:"#6b7a8d",marginBottom:16,lineHeight:1.6}}>
                  All test details will be copied. Enter the new opportunity number to continue.
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:9,color:"#6b7a8d",fontWeight:700,marginBottom:4}}>NEW OPPORTUNITY #</div>
                  <input
                    autoFocus
                    value={cloneOppInput}
                    onChange={e=>setCloneOppInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter")doClone(cloneOppInput);}}
                    placeholder="e.g. 2025-0042"
                    style={{width:"100%",fontSize:13,borderRadius:7,border:"1px solid #d0d7de",padding:"8px 10px",outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>{setShowCloneModal(false);setCloneOppInput("");}}
                    style={{background:"#e8ecf0",border:"none",borderRadius:7,padding:"8px 18px",fontWeight:600,fontSize:12,cursor:"pointer",color:"#1a2332"}}>
                    Cancel
                  </button>
                  <button onClick={()=>doClone(cloneOppInput)}
                    style={{background:"#2e6da4",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,fontSize:12,cursor:"pointer",color:"#fff"}}>
                    Clone
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* ── Won Details modal ── */}
          {showWonModal&&(
            <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setShowWonModal(false);}}>
              <div style={{background:"#fff",borderRadius:14,padding:28,width:380,boxShadow:"0 8px 40px rgba(0,0,0,0.25)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:18}}>🏆</span>
                    <div style={{fontWeight:700,fontSize:15,color:"#145a32"}}>Closed Won Details</div>
                  </div>
                  <button onClick={()=>setWonLocked(l=>!l)}
                    title={wonLocked?"Unlock to edit":"Lock to prevent changes"}
                    style={{background:wonLocked?"#b7791f":"#2d6a4f",border:"none",borderRadius:6,
                      padding:"4px 10px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                    {wonLocked?"🔒 Locked":"🔓 Unlocked"}
                  </button>
                </div>
                <div style={{fontSize:11,color:"#6b7a8d",marginBottom:18,lineHeight:1.5}}>
                  Internal use only — this information is not included in the quote PDF.
                </div>
                {wonLocked&&(
                  <div style={{background:"rgba(183,121,31,0.1)",border:"1px solid #b7791f",borderRadius:7,
                    padding:"7px 12px",marginBottom:14,fontSize:11,color:"#7b4f12",fontWeight:600}}>
                    🔒 Fields are locked — click Unlocked to make changes
                  </div>
                )}
                {[
                  ["Won Date","wonDate","e.g. 3/18/2026"],
                  ["Job #","jobNum","e.g. J-2025-042"],
                  ["PO #","poNum","e.g. PO-98765"],
                ].map(([label,key,placeholder])=>{
                  const isPending=key==="wonDate"&&wonDatePending;
                  return(
                    <div key={key} style={{marginBottom:14}}>
                      <div style={{fontSize:9,color:"#6b7a8d",fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                        <span>{label}</span>
                        {isPending&&(
                          <span style={{fontSize:9,fontWeight:700,letterSpacing:.4,color:"#7b4f12",
                            background:"#fef3c7",border:"1px solid #b7791f",borderRadius:4,padding:"1px 6px"}}>
                            ⚠ PENDING CONFIRMATION
                          </span>
                        )}
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"stretch"}}>
                        <input
                          value={wonInfo[key]||""}
                          onChange={e=>!wonLocked&&setWonInfo({...wonInfo,[key]:e.target.value})}
                          readOnly={wonLocked}
                          placeholder={placeholder}
                          style={{flex:1,fontSize:12,borderRadius:7,
                            border:"1px solid "+(isPending?"#b7791f":"#d0d7de"),
                            padding:"7px 10px",outline:"none",fontFamily:"inherit",boxSizing:"border-box",
                            background:wonLocked?"#f0f2f5":isPending?"#fffbeb":"#fff",
                            color:wonLocked?"#6b7a8d":"#1a2332",cursor:wonLocked?"not-allowed":"text"}}/>
                        {isPending&&!wonLocked&&(
                          <button onClick={()=>setWonDatePending(false)}
                            title="Confirm the Won Date — unlocks Save"
                            style={{background:"#b7791f",color:"#fff",border:"none",borderRadius:7,
                              padding:"0 12px",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:.3,whiteSpace:"nowrap"}}>
                            ✓ Confirm Date
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  {(() => {
                    const curJob = (wonInfo?.jobNum||"").trim();
                    // Open in Workspace when we have a link already, OR when the Job #
                    // is one that was already persisted on this quote (project presumably
                    // exists). A freshly-typed Job # (differs from loaded) means first-time
                    // creation, so Create Project stays primary.
                    const showOpen = !!workspaceProjectId || (curJob && curJob === loadedJobNum);
                    return showOpen ? (
                      <button onClick={handleOpenInWorkspace} disabled={workspaceBusy}
                        style={{background:workspaceBusy?"#9aa5b1":"#1a5276",border:"none",borderRadius:7,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#fff",display:"flex",alignItems:"center",gap:5,flex:1,justifyContent:"center"}}>
                        {workspaceBusy ? "Opening..." : "Open in Workspace ↗"}
                      </button>
                    ) : (
                      <button onClick={handleCreateProject} disabled={workspaceBusy}
                        style={{background:workspaceBusy?"#9aa5b1":"#1a5276",border:"none",borderRadius:7,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#fff",display:"flex",alignItems:"center",gap:5,flex:1}}>
                        {workspaceBusy ? "Working..." : "🏗️ Create Project"}
                      </button>
                    );
                  })()}
                  <button onClick={handleAddToExistingLookup}
                    disabled={workspaceBusy || !!workspaceProjectId}
                    style={{background:(workspaceBusy||workspaceProjectId)?"#9aa5b1":"#6c3483",border:"none",borderRadius:7,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:(workspaceBusy||workspaceProjectId)?"not-allowed":"pointer",color:"#fff",display:"flex",alignItems:"center",gap:5,flex:1}}>
                    ➕ Add to Existing
                  </button>
                  <button onClick={()=>{
                      setWonLocked(true);
                      setShowWonModal(false);
                      const isHistoricallyWon = !!(wonInfo?.wonDate||wonInfo?.poNum);
                      if((!wonApproval||wonApproval.status==="none"||!wonApproval.status)&&!isHistoricallyWon){
                        // Fresh win: no prior approval and no historical win data — submit for approval
                        handleSubmitWonApproval(qi.stage);
                      } else {
                        // Historically won (e.g. SF import) OR already through approval — just save
                        handleSave();
                      }
                    }}
                    style={{background:"#1e8449",border:"none",borderRadius:7,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:"pointer",color:"#fff",flex:1}}>
                    Save &amp; Close
                  </button>
                </div>
                {showAppendConfirm && (
                  <div style={{marginTop:10,background:"#faf5ff",border:"1px solid #7c3aed",borderRadius:7,padding:"12px 14px",fontSize:12,color:"#4c1d95"}}>
                    <div style={{fontWeight:700,marginBottom:6}}>
                      Found project: <span style={{color:"#1a2332"}}>{showAppendConfirm.project_name}</span>
                    </div>
                    <div style={{marginBottom:4}}>
                      Client: <strong>{showAppendConfirm.client_company || "—"}</strong>
                    </div>
                    <div style={{marginBottom:10}}>
                      Existing tasks: <strong>{showAppendConfirm.existing_task_count ?? "?"}</strong>
                    </div>
                    <div style={{marginBottom:10}}>
                      This will add <strong>{showAppendConfirm.new_task_count} task{showAppendConfirm.new_task_count===1?"":"s"}</strong> and <strong>{showAppendConfirm.new_expense_count} expense{showAppendConfirm.new_expense_count===1?"":"s"}</strong> from this quote.
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={handleAddToExistingConfirm} disabled={workspaceBusy}
                        style={{background:workspaceBusy?"#9aa5b1":"#6c3483",border:"none",borderRadius:6,padding:"6px 14px",fontWeight:700,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#fff"}}>
                        {workspaceBusy ? "Adding..." : "Confirm — Add Items"}
                      </button>
                      <button onClick={()=>setShowAppendConfirm(null)} disabled={workspaceBusy}
                        style={{background:"#fff",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 14px",fontWeight:600,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#374151"}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {currentQuoteId && !showClearLinkConfirm && (
                  <div style={{marginTop:10,textAlign:"right"}}>
                    <button onClick={()=>setShowClearLinkConfirm(true)}
                      style={{background:"none",border:"none",color:"#9aa5b1",fontSize:10,cursor:"pointer",textDecoration:"underline",padding:0}}>
                      Clear workspace link
                    </button>
                  </div>
                )}
                {showClearLinkConfirm && (
                  <div style={{marginTop:10,background:"#fef9c3",border:"1px solid #ca8a04",borderRadius:7,padding:"12px 14px",fontSize:12,color:"#713f12"}}>
                    <div style={{fontWeight:700,marginBottom:6}}>Clear workspace link?</div>
                    <div style={{marginBottom:10}}>
                      This unlinks the quote from the workspace project. The workspace project itself will NOT be deleted — if you want it gone, handle that in workspace separately. After clearing, the Create Project / Add to Existing buttons will be re-enabled.
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={handleClearWorkspaceLink} disabled={workspaceBusy}
                        style={{background:workspaceBusy?"#9aa5b1":"#ca8a04",border:"none",borderRadius:6,padding:"6px 14px",fontWeight:700,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#fff"}}>
                        {workspaceBusy ? "Clearing..." : "Yes, unlink"}
                      </button>
                      <button onClick={()=>setShowClearLinkConfirm(false)} disabled={workspaceBusy}
                        style={{background:"#fff",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 14px",fontWeight:600,fontSize:12,cursor:workspaceBusy?"not-allowed":"pointer",color:"#374151"}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {isApprover&&approval.status==="pending"&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(109,40,217,0.08)",
              border:"1px solid #6d28d9",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:15}}>📋</span>
                <span style={{fontSize:12,color:"#4c1d95",fontWeight:700}}>
                  Pending Quote Approval — submitted by {approval.submittedBy} on {approval.submittedAt?new Date(approval.submittedAt).toLocaleDateString():""} 
                </span>
              </div>
              <div style={{fontSize:11,color:"#6b7a8d",marginBottom:6}}>
                Add comments (optional) before approving or rejecting:
              </div>
              <textarea value={approvalComments} onChange={e=>setApprovalComments(e.target.value)}
                placeholder="Comments for the submitter..."
                rows={2}
                style={{width:"100%",fontSize:11,borderRadius:6,border:"1px solid #d0d7de",padding:"6px 8px",resize:"vertical",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
            </div>
          )}
          {isApprover&&wonApproval.status==="pending_won"&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(30,132,73,0.08)",
              border:"1px solid #1e8449",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:15}}>🏆</span>
                <span style={{fontSize:12,color:"#145a32",fontWeight:700}}>
                  Pending Closed Won Approval — submitted by {wonApproval.submittedBy} on {wonApproval.submittedAt?new Date(wonApproval.submittedAt).toLocaleDateString():""}
                </span>
              </div>
              <div style={{fontSize:11,color:"#6b7a8d",marginBottom:6}}>
                Add comments (optional) before approving or rejecting:
              </div>
              <textarea value={approvalComments} onChange={e=>setApprovalComments(e.target.value)}
                placeholder="Comments for the submitter..."
                rows={2}
                style={{width:"100%",fontSize:11,borderRadius:6,border:"1px solid #d0d7de",padding:"6px 8px",resize:"vertical",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={()=>handleWonReject(approvalComments)}
                  style={{background:"#c0392b",border:"none",borderRadius:6,padding:"5px 14px",fontWeight:700,fontSize:11,cursor:"pointer",color:"#fff"}}>
                  ❌ REJECT WON
                </button>
                <button onClick={()=>handleWonApprove(approvalComments)}
                  style={{background:"#1e8449",border:"none",borderRadius:6,padding:"5px 14px",fontWeight:700,fontSize:11,cursor:"pointer",color:"#fff"}}>
                  ✅ APPROVE WON
                </button>
              </div>
            </div>
          )}
          {/* ── Approval result banner ── */}
          {approval.status==="approved"&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(30,132,73,0.1)",
              border:"1px solid #1e8449",borderRadius:8,padding:"8px 14px",marginBottom:10,
              display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>✅</span>
              <span style={{fontSize:12,color:"#145a32",fontWeight:600}}>
                Approved by {approval.decidedBy} on {approval.decidedAt?new Date(approval.decidedAt).toLocaleDateString():""}
                {approval.comments&&" — "+approval.comments}
              </span>
            </div>
          )}
          {approval.status==="rejected"&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(192,57,43,0.08)",
              border:"1px solid #c0392b",borderRadius:8,padding:"8px 14px",marginBottom:10,
              display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>❌</span>
              <span style={{fontSize:12,color:"#922b21",fontWeight:600}}>
                Rejected by {approval.decidedBy} on {approval.decidedAt?new Date(approval.decidedAt).toLocaleDateString():""}
                {approval.comments&&" — "+approval.comments}
              </span>
            </div>
          )}
          {locked&&approval.status==="none"&&!isSalesforce&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(183,121,31,0.12)",
              border:"1px solid #b7791f",borderRadius:8,padding:"8px 14px",marginBottom:10,
              display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>🔒</span>
              <span style={{fontSize:12,color:"#7b4f12",fontWeight:600}}>
                Form is locked — click UNLOCKED in the header to edit
              </span>
            </div>
          )}
          {isSalesforce&&(
            <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(26,82,118,0.08)",
              border:"1px solid #1a5276",borderRadius:8,padding:"8px 14px",marginBottom:10,
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>📥</span>
                <span style={{fontSize:12,color:"#1a5276",fontWeight:600}}>
                  Imported from Salesforce — locked by default. Click UNLOCKED in the header to edit.
                </span>
              </div>
            </div>
          )}

          {/* ── Edit toggle — outside locked wrapper so always clickable ── */}
          {currentQuoteId&&!locked&&(
            <div style={{display:"flex",justifyContent:"flex-start",marginBottom:8}}>
              {isDirty
                ? <button onClick={()=>setIsDirty(false)} title="Lock quote"
                    style={{fontSize:13,background:"#b7791f",color:"#fff",border:"none",
                      borderRadius:7,padding:"7px 18px",fontWeight:700,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:6,letterSpacing:.3}}>
                    ✏️ EDITING — click to lock
                  </button>
                : <button onClick={()=>setIsDirty(true)} title="Edit this quote"
                    style={{fontSize:13,background:"#276749",color:"#fff",border:"none",
                      borderRadius:7,padding:"7px 18px",fontWeight:700,cursor:"pointer",
                      display:"flex",alignItems:"center",gap:6,letterSpacing:.3}}>
                    🔒 EDIT
                  </button>
              }
            </div>
          )}

          <div style={{
            pointerEvents:(locked||(currentQuoteId&&!isDirty))?"none":"auto",
            opacity:(locked||(currentQuoteId&&!isDirty))?0.65:1,
            transition:"opacity 0.2s"}}>

            {/* ── Row 1: Quote Info | Test Item Description ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>

              {/* Quote Info */}
              <div style={{...card}}>
                <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:8}}>QUOTE INFORMATION</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                  <div>
                    <ClientContactPicker qi={qi} setQi={setQi} resetKey={currentQuoteId} onAccountEdited={()=>{accountEditedRef.current=true;}}/>
                    {/* RFQ / PO */}
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>RFQ / PO</div>
                      <input value={qi.rfq||""} onChange={e=>setQi({...qi,rfq:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Bill To</div>
                      <input value={qi.billTo||""} onChange={e=>setQi({...qi,billTo:e.target.value})}
                        placeholder="Street address" style={{...inp,width:"100%",marginBottom:3,color:qi.billTo?C.text:C.muted}}/>
                      <input value={qi.billToCity||""} onChange={e=>setQi({...qi,billToCity:e.target.value})}
                        placeholder="City, State, Zip" style={{...inp,width:"100%",color:qi.billToCity?C.text:C.muted}}/>
                    </div>
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Type</div>
                      <select value={qi.type||"New Business"} onChange={e=>setQi({...qi,type:e.target.value})} style={{...sel,width:"100%"}}>
                        {["New Business","Existing Business"].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    {[["Opportunity #","opp"],["Prepared By","prepby"]].map(([l,k])=>(
                      <div key={k} style={{marginBottom:6}}>
                        <div style={{fontSize:9,color:C.dim,marginBottom:2}}>{l}</div>
                        <input value={qi[k]||""} onChange={e=>setQi({...qi,[k]:e.target.value})} style={{...inp,width:"100%"}}/>
                      </div>
                    ))}
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span>Quote Revision</span>
                        <span onClick={openRevHistory}
                          style={{fontSize:9,color:C.accent,cursor:"pointer",textDecoration:"underline"}}>
                          View History
                        </span>
                      </div>
                      <input value={qi.rev||""} onChange={e=>setQi({...qi,rev:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Related Opps</div>
                      <input value={qi.relatedOpps||""} onChange={e=>setQi({...qi,relatedOpps:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                    <div style={{marginBottom:6,pointerEvents:"auto",opacity:1}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Stage</div>
                      <select value={qi.stage} onChange={e=>{
                        const s=e.target.value;
                        const wasNotWon=qi.stage!=="Closed Won";
                        setQi({...qi,stage:s});
                        // On transition TO Closed Won: refresh wonDate to today and require confirmation
                        if(s==="Closed Won"&&wasNotWon){
                          setWonInfo(w=>({...w,wonDate:new Date().toLocaleDateString("en-US")}));
                          setWonDatePending(true);
                        }
                        // Prompt to submit for won approval when changing to Closed Won
                        if(s==="Closed Won"&&wonApproval.status==="none"){
                          setTimeout(()=>{
                            const submit=window.confirm("Submit this quote for Closed Won approval?\n\nClick OK to submit, or Cancel to set the stage without submitting.");
                            if(submit)handleSubmitWonApproval(s);
                            else{
                              // Block silent save when wonDate is pending confirmation
                              if(wasNotWon){
                                showToast("Stage set to Closed Won — confirm Won Date and save manually","warn",5000);
                                return;
                              }
                              const q={id:currentQuoteId||undefined,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
                                qi:{...qi,stage:s},ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
                              saveQuoteToSupabase(q,autoSpecs,autoNotes).then(newId=>{
                                if(newId){setCurrentQuoteId(newId);showToast("Saved — "+(qi.opp||"Untitled"),"success");}
                                else showToast("Save failed — check your connection","error",5000);
                              });
                            }
                          },50);
                        }
                      }} style={{...sel,width:"100%"}}>
                        {["Proposal/Price Quote","Budgetary","Closed Won","Closed Lost","Other"].map(o=><option key={o}>{o}</option>)}
                      </select>
                      {qi.stage==="Closed Won"&&(
                        <button onClick={()=>setShowWonModal(true)}
                          style={{marginTop:5,width:"100%",background:"#1e8449",border:"none",borderRadius:6,
                            padding:"5px 0",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",letterSpacing:.3}}>
                          🏆 Won Details
                        </button>
                      )}
                    </div>
                    <div style={{marginBottom:6}}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Modified Date</div>
                      <input value={qi.date||""} onChange={e=>setQi({...qi,date:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                  </div>
                </div>
                {/* Related Contacts — additional contacts beyond the primary one above */}
                <RelatedContactsField qi={qi} setQi={setQi}/>
              </div>

              {/* Test Item Description */}
              <div style={{...card}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2}}>TEST ITEM DESCRIPTION</div>
                  {qi.stage==="Closed Won"&&(
                    <button onClick={()=>setShowWonModal(true)}
                      style={{background:"#1e8449",border:"none",borderRadius:6,padding:"3px 10px",
                        color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer",letterSpacing:.3,display:"flex",alignItems:"center",gap:4,
                        pointerEvents:"auto",opacity:1}}>
                      🏆 {wonInfo.jobNum?("Job #"+wonInfo.jobNum):"Won Details"}
                    </button>
                  )}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
                  {[["Item","item"],["Qty","qty"],["Model No.","model"],["Drawing No.","drawing"]].map(([l,k])=>(
                    <div key={k}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>{l}</div>
                      <input value={ti[k]||""} onChange={e=>setTi({...ti,[k]:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>L x W x H (in)</div>
                    <div style={{display:"flex",gap:3}}>
                      {[["dimL","L"],["dimW","W"],["dimH","H"]].map(([k,lbl])=>(
                        <input key={k} value={ti[k]||""} onChange={e=>setTi({...ti,[k]:e.target.value})}
                          placeholder={lbl} style={{...inp,width:"100%"}}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Weight (lbs)</div>
                    <input value={ti.wt||""} onChange={e=>setTi({...ti,wt:e.target.value})} style={{...inp,width:"100%"}}/>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Voltage</div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input value={ti.volt||""} onChange={e=>setTi({...ti,volt:e.target.value})} style={{...inp,width:"100%"}}/>
                      {["AC","DC"].map(t=>(
                        <label key={t} style={{display:"flex",alignItems:"center",gap:3,cursor:"pointer",flexShrink:0}}>
                          <input type="checkbox" checked={(ti.pwrType||"AC")===t}
                            onChange={()=>setTi({...ti,pwrType:t})}
                            style={{accentColor:C.red,width:11,height:11}}/>
                          <span style={{fontSize:10,color:(ti.pwrType||"AC")===t?C.red:C.muted,fontWeight:(ti.pwrType||"AC")===t?700:400}}>{t}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {[["Phase","phase"],["Hz","hz"],["Inrush (A)","inrush"],["Op. Amps","amps"]].map(([l,k])=>(
                    <div key={k}>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>{l}</div>
                      <input value={ti[k]||""} onChange={e=>setTi({...ti,[k]:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:6}}>
                  <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Loads</div>
                  <input
                    value={ti.loads!=null?ti.loads:(qi.account?"All electrical and/or resistive loads will be provided by "+qi.account+" unless otherwise discussed.":"")}
                    onChange={e=>setTi({...ti,loads:e.target.value})}
                    placeholder={qi.account?"Auto: uses Account name — clear to override":"Enter load details"}
                    style={{...inp,width:"100%"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Mounting</div>
                    <input value={ti.mounting||""} onChange={e=>setTi({...ti,mounting:e.target.value})} style={{...inp,width:"100%"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Pressure/Flow</div>
                    <input value={ti.pressureFlow||""} onChange={e=>setTi({...ti,pressureFlow:e.target.value})} style={{...inp,width:"100%"}}/>
                  </div>
                </div>
                <div style={{background:C.panel,borderRadius:7,padding:"6px 10px",marginBottom:8}}>
                  <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:1,marginBottom:6}}>REGULATORY</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                    {[["GSI","gsi",["Unknown","Yes","No"]],["Cust. Witness","witness",["Unknown","Yes","No"]],["Doc Restriction","docRestriction",["None","ITAR","CUI/Other","NOFORN","Dist Statement B/C/D/E"]]].map(([l,k,opts])=>(
                      <div key={k}>
                        <div style={{fontSize:9,color:C.dim,marginBottom:2}}>{l}</div>
                        <select value={ti[k]||opts[0]} onChange={e=>setTi({...ti,[k]:e.target.value})} style={{...sel,width:"100%"}}>
                          {opts.map(o=><option key={o}>{o}</option>)}
                        </select>
                      </div>
                    ))}
                    <div>
                      <div style={{fontSize:9,color:C.dim,marginBottom:2}}>DPAS Rating</div>
                      <input value={ti.dpas||""} onChange={e=>setTi({...ti,dpas:e.target.value})} style={{...inp,width:"100%"}}/>
                    </div>
                  </div>
                </div>
              </div>
            </div>{/* end Row 1 */}

            {/* ── Row 2: Setup Details | Budget + Subcontracting ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>

              {/* Setup Details */}
              <div style={{...card}}>
                <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:8}}>SETUP DETAILS</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}>Tech Rate ($/hr)</div>
                    <Inp value={setup.techRate} onChange={v=>setSetup({...setup,techRate:v})} width={70} right/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2,display:"flex",alignItems:"center",gap:5}}>
                      Fab &amp; Mod Hours
                      <button onClick={()=>setShowFabGuide(true)}
                        title="Estimated fab times per test"
                        style={{background:"none",border:"1px solid "+C.border,borderRadius:"50%",width:14,height:14,
                          padding:0,cursor:"pointer",fontSize:8,color:C.muted,lineHeight:"12px",display:"flex",
                          alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        ?
                      </button>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <Inp value={setup.fabHours} onChange={v=>setSetup({...setup,fabHours:v})} width={60} right/>
                      <span style={{fontSize:10,color:C.muted}}>{"= $"+Math.round(sf(setup.fabHours,4)*sf(setup.techRate,175)).toLocaleString()}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}># Holes (drilling)</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <Inp value={setup.holes} onChange={v=>setSetup({...setup,holes:v})} width={60} right/>
                      <span style={{fontSize:10,color:C.muted}}>{"= $"+Math.round(sf(setup.holes,0)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1)).toLocaleString()}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.dim,marginBottom:2}}># Cables (EMI)</div>
                    <Inp value={setup.cables} onChange={v=>setSetup({...setup,cables:v})} width={60} right/>
                  </div>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",marginBottom:8}}>
                  <input type="checkbox" checked={setup.drillTap}
                    onChange={e=>setSetup({...setup,drillTap:e.target.checked})}
                    style={{accentColor:C.red,width:14,height:14}}/>
                  <span style={{fontSize:11,color:setup.drillTap?C.red:C.muted,fontWeight:setup.drillTap?600:400}}>
                    Drill &amp; Tap (x1.5 on drilling cost)
                  </span>
                </label>
                {(sf(setup.holes,0)>0||sf(setup.fabHours,0)>4)&&(
                  <div style={{fontSize:10,color:C.muted,padding:"5px 8px",background:C.panel,borderRadius:5,lineHeight:1.7}}>
                    {sf(setup.holes,0)>0&&<div>{"Drilling: "}{setup.holes}{" hole(s) x 30 min @ $"}{sf(setup.techRate,175).toLocaleString()}{"/hr"}{setup.drillTap?" x 1.5 (D&T)":""}{" = "}<b>{"$"}{Math.round(sf(setup.holes,0)*0.5*sf(setup.techRate,175)*(setup.drillTap?1.5:1)).toLocaleString()}</b></div>}
                    {sf(setup.fabHours,0)>0&&<div>{"Fab & Mod: "}{setup.fabHours}{" hr(s) x $"}{sf(setup.techRate,175).toLocaleString()}{"/hr = "}<b>{"$"}{Math.round(sf(setup.fabHours,0)*sf(setup.techRate,175)).toLocaleString()}</b></div>}
                  </div>
                )}
                {anyOn&&<div style={{marginTop:8}}><PRow label="Tear Down Override (0=auto)" val={td} onChange={setTd}/></div>}
              </div>

              {/* Budget + Subcontracting stacked */}
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <BudgetSection budget={budget} setBudget={setBudget}/>
                <div style={{...card}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:sub.on?8:0}}>
                    <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2}}>SUBCONTRACTING</div>
                    <Toggle small checked={sub.on||false} onChange={v=>setSub({...sub,on:v})} label=""/>
                  </div>
                  {sub.on&&(
                    <div>
                      {sub.rows.map((r,i)=>(
                        <div key={i} style={{background:C.panel,borderRadius:7,padding:"7px 10px",marginBottom:5}}>
                          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:9,color:"#2563eb",background:"#dbeafe",borderRadius:4,padding:"2px 5px",fontWeight:700,flexShrink:0}}>98</span>
                            <Inp value={r.desc} onChange={v=>setSub({...sub,rows:sub.rows.map((x,j)=>j===i?{...x,desc:v}:x)})} width={160}/>
                            <span style={{fontSize:11,color:C.muted}}>$</span>
                            <Inp value={r.price} onChange={v=>setSub({...sub,rows:sub.rows.map((x,j)=>j===i?{...x,price:v}:x)})} width={80} right/>
                            <button onClick={()=>setSub({...sub,rows:sub.rows.filter((_,j)=>j!==i)})}
                              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:14}}>✕</button>
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:9,color:C.dim,flexShrink:0}}>Identifier:</span>
                            <Inp value={r.identifier||""} onChange={v=>setSub({...sub,rows:sub.rows.map((x,j)=>j===i?{...x,identifier:v}:x)})}
                              width={240} placeholder="Vendor / part / description"/>
                          </div>
                        </div>
                      ))}
                      <button onClick={()=>setSub({...sub,rows:[...sub.rows,{desc:"Subcontract Item",price:"0",identifier:""}]})}
                        style={{background:"none",border:"1px dashed "+C.border,borderRadius:7,color:C.muted,padding:"5px 12px",cursor:"pointer",fontSize:11,width:"100%"}}>
                        + Add Subcontract Row
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>{/* end Row 2 */}

            {/* ── Row 3: Specifications & Notes (stacked) ── */}
            <div style={{...card,marginBottom:10,display:"flex",flexDirection:"column",gap:12}}>
              {/* Specifications */}
              <div>
                <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:3}}>SPECIFICATIONS</div>
                <div style={{fontSize:9,color:C.dim,marginBottom:4}}>Auto-generated from enabled tests. Shown on quote PDF. Edit to override.</div>
                <textarea
                  ref={tiSpecsRef}
                  value={ti.tiSpecs||""}
                  onChange={e=>{userEditedSpecs.current=true;setTi({...ti,tiSpecs:e.target.value})}}
                  placeholder="Enable test sections to auto-generate scope text, or type here..."
                  style={{...inp,width:"100%",fontSize:11,lineHeight:1.6,minHeight:88,overflow:"auto"}}/>
                {userEditedSpecs.current&&autoSpecs&&(
                  <button onClick={()=>{userEditedSpecs.current=false;setTi({...ti,tiSpecs:""});insertedAutoSpecs.current="";}}
                    style={{fontSize:9,color:C.dim,background:"none",border:"none",cursor:"pointer",padding:"2px 0",marginTop:2,display:"block"}}>
                    ↺ Reset to auto-generated
                  </button>
                )}
                {!userEditedSpecs.current&&autoSpecs&&(
                  <div style={{fontSize:9,color:C.green,marginTop:2}}>✓ Auto-generated specs active</div>
                )}
              </div>
              {/* Notes to customer */}
              <div>
                <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:3}}>NOTES</div>
                <div style={{fontSize:9,color:C.dim,marginBottom:4}}>Customer-facing notes. Shown on quote PDF. Auto-populates based on selected tests.</div>
                <textarea
                  ref={tiNotesRef}
                  value={ti.tiNotes||""}
                  onChange={e=>{userEditedNotes.current=true;setTi({...ti,tiNotes:e.target.value})}}
                  placeholder="Notes will auto-populate based on selected tests..."
                  style={{...inp,width:"100%",fontSize:11,lineHeight:1.6,minHeight:88,overflow:"auto"}}/>
                {ti.tiNotes&&ti.tiNotes!==autoNotes&&(
                  <button onClick={()=>{userEditedNotes.current=false;setTi({...ti,tiNotes:""});insertedAutoNotes.current="";}}
                    style={{fontSize:9,color:C.dim,background:"none",border:"none",cursor:"pointer",padding:"2px 0",marginTop:2}}>
                    ↺ Reset to auto-generated
                  </button>
                )}
              </div>
            </div>

            {/* ── Row 4: Quote Summary — always interactive ── */}
            <div style={{...card,marginBottom:10,pointerEvents:"auto",position:"relative"}}>
              <div style={{fontSize:9,color:C.accent,fontWeight:700,letterSpacing:2,marginBottom:6}}>QUOTE SUMMARY</div>

              <div style={{pointerEvents:"auto",position:"relative"}}>
              {(isDirty||(currentQuoteId&&!locked))&&(
                <button onClick={()=>setShowProductPicker(true)}
                  style={{marginBottom:8,background:"#1a2332",border:"none",borderRadius:7,
                    padding:"6px 14px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",
                    display:"flex",alignItems:"center",gap:6,letterSpacing:.3}}>
                  + Add Line Items
                </button>
              )}
              </div>


              {qi.opp&&<div style={{fontSize:13,color:C.red,fontWeight:600,marginBottom:2,display:"flex",alignItems:"center",gap:6}}>
                {qi.opp}

              </div>}
              {(qi.billTo||qi.account)&&<div style={{fontSize:11,color:C.muted,marginBottom:4}}>{qi.billTo||qi.account}</div>}
              {qi.rfq&&<div style={{fontSize:10,color:C.dim,marginBottom:10}}>{"RFQ: "}{qi.rfq}</div>}
              {summary.lines.length===0&&pickerLines.length===0?(
                <div style={{color:C.border,fontSize:12,textAlign:"center",marginTop:30,marginBottom:30,lineHeight:1.8}}>
                  Click "+ Add Line Items" to build your quote
                </div>
              ):(
                <>
                  {/* Column headers */}
                  <div style={{display:"grid",gridTemplateColumns:"14px 36px 1fr 130px 80px 20px",gap:4,alignItems:"center",
                    borderBottom:"2px solid "+C.border,paddingBottom:4,marginBottom:4}}>
                    <span/>
                    <span style={{fontSize:9,color:C.dim,fontWeight:700}}>CODE</span>
                    <span style={{fontSize:9,color:C.dim,fontWeight:700}}>DESCRIPTION / NOTE</span>
                    <span style={{fontSize:9,color:C.dim,fontWeight:700}}></span>
                    <span style={{fontSize:9,color:C.dim,fontWeight:700,textAlign:"right"}}>AMOUNT</span>
                    <span/>
                  </div>
                  {(()=>{
                    const displayLines=summary.lines;
                    const autoOrder=lineOrder&&lineOrder.length===displayLines.length?lineOrder:displayLines.map((_,i)=>i);
                    const sidebarOvByIndex={};
                    const labelCount={};
                    Object.entries(lineOverrides).forEach(([k,ov])=>{ sidebarOvByIndex[k]=ov; });
                    displayLines.forEach(l=>{ labelCount[l.label]=(labelCount[l.label]||0)+1; });
                    const sidebarOvByLabel={};
                    Object.entries(lineOverrides).forEach(([k,ov])=>{
                      if(ov.label&&labelCount[ov.label]===1)sidebarOvByLabel[ov.label]=ov;
                    });
                    const autoRows=autoOrder.map((origIdx,dispIdx)=>{
                      const l=displayLines[origIdx];
                      if(!l)return null;
                      const ov=sidebarOvByIndex[origIdx]||sidebarOvByLabel[l.label]||{};
                      if(ov.deleted)return null;
                      return {type:"auto",origIdx,dispIdx,l,ov};
                    }).filter(Boolean);
                    const pickerRows=pickerLines.map((pl,pli)=>({type:"picker",pli,pl}));
                    // Build allRows: use unifiedOrder if set, else default auto-then-picker
                    let allRows;
                    if(unifiedOrder&&unifiedOrder.length===(autoRows.length+pickerRows.length)){
                      // Consume rows as they're matched so duplicates can't resolve to the
                      // same source row twice. This prevented the "edit-one-syncs-the-other"
                      // bug when an old unifiedOrder (with label-only identity for legacy
                      // entries) tried to claim five picker lines all sharing one label.
                      const claimedAuto=new Set();
                      const claimedPicker=new Set();
                      allRows=unifiedOrder.map(u=>{
                        if(u.type==='auto'){
                          const r=autoRows.find(r=>r.origIdx===u.origIdx && !claimedAuto.has(r.origIdx));
                          if(r) claimedAuto.add(r.origIdx);
                          return r;
                        }
                        const r=pickerRows.find(r=>
                          (r.pl.id||r.pl.label)===(u.id||u.label) && !claimedPicker.has(r.pli));
                        if(r) claimedPicker.add(r.pli);
                        return r;
                      }).filter(Boolean);
                      // Fall back if any row not found (e.g. line was deleted) OR if the
                      // unifiedOrder couldn't claim all the source rows (stale order from
                      // a quote whose lines were re-added under different ids).
                      if(allRows.length!==autoRows.length+pickerRows.length)
                        allRows=[...autoRows,...pickerRows];
                    } else {
                      allRows=[...autoRows,...pickerRows];
                    }
                    return allRows.map((row,uIdx)=>{
                      const isDragging=dragIdx===uIdx;
                      const isHover=!isDragging&&dragIdx!==null&&uIdx===pickerDragIdx;
                      const bg=isDragging?"#f0f4ff":isHover?"#e8f4fd":uIdx%2===0?"transparent":C.panel+"66";
                      const rowStyle={display:"grid",gridTemplateColumns:"14px 36px 1fr 130px 80px 20px",
                        gap:4,alignItems:"center",borderBottom:"1px solid "+C.border,
                        padding:"5px 0",background:bg,cursor:"grab",opacity:isDragging?0.5:1};
                      const onDS=e=>{
                        e.dataTransfer.effectAllowed="move";
                        dragFromRef.current=uIdx;
                        setDragIdx(uIdx);
                        setPickerDragIdx(null);
                      };
                      const onDO=e=>{
                        e.preventDefault();
                        e.dataTransfer.dropEffect="move";
                        dragToRef.current=uIdx;
                        setPickerDragIdx(uIdx);
                      };
                      const onDE=e=>{
                        const from=dragFromRef.current;
                        const to=dragToRef.current;
                        setDragIdx(null);
                        setPickerDragIdx(null);
                        dragFromRef.current=null;
                        dragToRef.current=null;
                        if(from===null||from===undefined||to===null||to===undefined||to===from){setIsDirty(true);return;}
                        // Use allRows from THIS render — indices are correct for this render
                        // Store identity keys (not indices) so future renders can match
                        const snap=[...allRows];
                        const [moved]=snap.splice(from,1);
                        const insertAt=from<to?to-1:to;
                        snap.splice(insertAt,0,moved);
                        // Store as identity keys: auto rows by origIdx, picker rows by id
                        const newUnifiedKeys=snap.map(r=>
                          r.type==='auto'
                            ?{type:'auto',origIdx:r.origIdx}
                            :{type:'picker',id:r.pl.id||r.pl.label}
                        );
                        setUnifiedOrder(newUnifiedKeys);
                        const newAutoOrder=snap.filter(r=>r.type==='auto').map(r=>r.origIdx);
                        const newPicker=snap.filter(r=>r.type==='picker').map(r=>r.pl);
                        if(newAutoOrder.length>0)setLineOrder(newAutoOrder);
                        setPickerLines(newPicker);
                        setIsDirty(true);
                      };
                      if(row.type==="auto"){
                        const {origIdx,l,ov}=row;
                        const dispPrice=ov.price!==undefined?ov.price:String(l.val);
                        const dispDesc=ov.desc!==undefined?ov.desc:"";
                        return(
                          <div key={"a"+origIdx} draggable onDragStart={onDS} onDragOver={onDO} onDragEnd={onDE} style={rowStyle}>
                            <span style={{fontSize:10,color:C.dim,cursor:"grab",userSelect:"none",textAlign:"center"}}>⠿</span>
                            <span style={{fontSize:9,color:"#6b7a8d",background:C.panel,borderRadius:3,padding:"2px 4px",fontFamily:"monospace",textAlign:"center",border:"1px solid "+C.border}}>{l.code||"—"}</span>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:11,color:C.text,fontWeight:500,lineHeight:1.3}}>{l.label}</div>
                              <input value={dispDesc}
                                onChange={e=>setLineOverrides({...lineOverrides,[origIdx]:{...ov,desc:e.target.value||undefined,label:l.label}})}
                                placeholder="+ line item description (optional)"
                                style={{width:"100%",fontSize:9,color:C.muted,background:"transparent",border:"none",outline:"none",padding:"1px 0",marginTop:1,fontStyle:dispDesc?"normal":"italic",boxSizing:"border-box"}}/>
                            </div>
                            <span/>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}>
                              <span style={{fontSize:10,color:C.muted}}>$</span>
                              <input value={dispPrice}
                                onChange={e=>setLineOverrides({...lineOverrides,[origIdx]:{...ov,price:e.target.value,label:l.label}})}
                                style={{width:68,fontSize:12,fontWeight:700,color:C.text,fontFamily:"monospace",background:"transparent",border:"none",borderBottom:"1px solid "+C.border,outline:"none",textAlign:"right",padding:"1px 2px"}}/>
                            </div>
                            <button onClick={()=>setLineOverrides({...lineOverrides,[origIdx]:{...ov,deleted:true,label:l.label}})}
                              style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,padding:0,lineHeight:1,textAlign:"center"}} title="Remove line">✕</button>
                          </div>
                        );
                      } else {
                        const {pl,pli}=row;
                        return(
                          <div key={"p"+pli} draggable onDragStart={onDS} onDragOver={onDO} onDragEnd={onDE} style={rowStyle}>
                            <span style={{fontSize:10,color:C.dim,cursor:"grab",userSelect:"none",textAlign:"center"}}>⠿</span>
                            <span style={{fontSize:9,color:"#6b7a8d",background:C.panel,borderRadius:3,padding:"2px 4px",fontFamily:"monospace",textAlign:"center",border:"1px solid "+C.border}}>{pl.code||"—"}</span>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:11,color:C.text,fontWeight:500,lineHeight:1.3}}>{pl.label}</div>
                              <input value={pl.desc||""}
                                onChange={e=>setPickerLines(prev=>prev.map((l,i)=>i===pli?{...l,desc:e.target.value}:l))}
                                placeholder="+ line item description (optional)"
                                style={{width:"100%",fontSize:9,color:C.muted,background:"transparent",border:"none",outline:"none",padding:"1px 0",marginTop:1,fontStyle:pl.desc?"normal":"italic",boxSizing:"border-box"}}/>
                            </div>
                            <span/>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}>
                              <span style={{fontSize:10,color:C.muted}}>$</span>
                              <input value={String(pl.price||0)}
                                onChange={e=>setPickerLines(prev=>prev.map((l,i)=>i===pli?{...l,price:parseFloat(e.target.value)||0}:l))}
                                style={{width:68,fontSize:12,fontWeight:700,color:C.text,fontFamily:"monospace",background:"transparent",border:"none",borderBottom:"1px solid "+C.border,outline:"none",textAlign:"right",padding:"1px 2px"}}/>
                            </div>
                            <button onClick={()=>{
                              const plToRemove=pl;
                              setPickerLines(prev=>prev.filter((_,i)=>i!==pli));
                              setUnifiedOrder(prev=>prev?prev.filter(u=>!(u.type==='picker'&&(u.id||u.label)===(plToRemove.id||plToRemove.label))):null);
                            }}
                              style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,padding:0,lineHeight:1,textAlign:"center"}} title="Remove line">✕</button>
                          </div>
                        );
                      }
                    });
                  })()}
                  {(Object.values(lineOverrides).some(o=>o.deleted)||lineOrder)&&(
                    <div style={{display:"flex",gap:10,marginTop:4}}>
                      {Object.values(lineOverrides).some(o=>o.deleted)&&(
                        <button onClick={()=>setLineOverrides({})}
                          style={{fontSize:9,color:C.dim,background:"none",border:"none",cursor:"pointer",padding:0}}>
                          ↺ Restore deleted lines
                        </button>
                      )}
                      {lineOrder&&(
                        <button onClick={()=>setLineOrder(null)}
                          style={{fontSize:9,color:C.dim,background:"none",border:"none",cursor:"pointer",padding:0}}>
                          ↺ Reset order
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{marginTop:10,padding:"8px 0",borderTop:"2px solid "+C.red,
                    display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                    <span style={{fontWeight:700,fontSize:13,color:C.text}}>TOTAL</span>
                    <span style={{fontWeight:700,fontSize:16,color:C.red,fontFamily:"monospace"}}>
                      {money(summary.lines.reduce((a,l,idx)=>{
                        const ov=lineOverrides[idx]||{};
                        if(ov.deleted)return a;
                        return a+(ov.price!==undefined?sf(ov.price):l.val);
                      },0)+(pickerLines||[]).reduce((a,l)=>a+(l.price||0),0))}
                    </span>
                  </div>
                  <div style={{pointerEvents:"auto",opacity:1}}>
                  <button onClick={exportPDF}
                    style={{width:"100%",marginTop:8,background:C.red,border:"none",borderRadius:8,
                      padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                    EXPORT QUOTE PDF
                  </button>
                  {budget.on&&budget.rows.length>0&&(
                    <button onClick={exportBudgetPDF}
                      style={{width:"100%",marginTop:6,background:C.accent,border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      EXPORT BUDGET PDF
                    </button>
                  )}
                  {dcms.some(s=>s.on)&&(
                    <button onClick={exportDcMagPDF}
                      style={{width:"100%",marginTop:6,background:"#166534",border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      DC MAGNETICS — TEST SPECIFICATIONS
                    </button>
                  )}
                  {pqs.some(s=>s.on&&Object.entries(s.rows||{}).some(([k,v])=>v&&k.startsWith('B')))&&(
                    <button onClick={exportPq300bPDF}
                      style={{width:"100%",marginTop:6,background:"#1a5276",border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      PQ 300B — TEST SPECIFICATIONS
                    </button>
                  )}
                  {pqs.some(s=>s.on&&Object.entries(s.rows||{}).some(([k,v])=>v&&!k.startsWith('B')))&&(
                    <button onClick={exportPq300Part1PDF}
                      style={{width:"100%",marginTop:6,background:"#154360",border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      PQ 300 PART 1 — TEST SPECIFICATIONS
                    </button>
                  )}
                  {emis.some(s=>s.on&&Object.values(s.tests||{}).some(v=>v)&&(s.revs?.['Rev F']||!s.revs?.['Rev G']))&&(
                    <button onClick={exportEmi461fPDF}
                      style={{width:"100%",marginTop:6,background:"#4a1942",border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      461F — TEST SPECIFICATIONS
                    </button>
                  )}
                  {emis.some(s=>s.on&&Object.values(s.tests||{}).some(v=>v)&&(s.revs?.['Rev G']||!s.revs?.['Rev F']))&&(
                    <button onClick={exportEmi461gPDF}
                      style={{width:"100%",marginTop:6,background:"#1a3a4a",border:"none",borderRadius:8,
                        padding:"9px 0",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:1}}>
                      461G — TEST SPECIFICATIONS
                    </button>
                  )}

                  {/* Spec Builder — unified launcher with popup menu */}
                  <div style={{marginTop:10,position:"relative"}}>
                    <button onClick={()=>setSpecBuilderMenuOpen(v=>!v)}
                      title="Open the Test Spec Builder — choose source"
                      style={{width:"100%",background:"#2f855a",border:"none",borderRadius:6,
                        padding:"6px 0",color:"#fff",fontWeight:600,fontSize:10,cursor:"pointer",letterSpacing:.5}}>
                      Spec Builder ↗
                    </button>
                    {specBuilderMenuOpen && (
                      <>
                        {/* Backdrop to dismiss menu on outside click */}
                        <div onClick={()=>setSpecBuilderMenuOpen(false)}
                          style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:50}}/>
                        <div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,
                          background:"#fff",border:"1px solid #d0d7de",borderRadius:6,
                          boxShadow:"0 4px 14px rgba(0,0,0,0.12)",zIndex:51,overflow:"hidden"}}>
                          <button onClick={()=>{setSpecBuilderMenuOpen(false);openClassicSpecBuilder();}}
                            title="Open a blank Test Spec Builder in a new tab"
                            style={{width:"100%",background:"#fff",border:"none",borderBottom:"1px solid #e5e9ef",
                              padding:"8px 10px",color:"#1a2332",fontWeight:500,fontSize:11,cursor:"pointer",
                              textAlign:"left",letterSpacing:.2}}
                            onMouseEnter={e=>e.currentTarget.style.background="#f5f7fa"}
                            onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                            Classic Spec Builder
                            <div style={{fontSize:9,color:"#6b7a8d",marginTop:1}}>Blank form</div>
                          </button>
                          <button onClick={()=>{setSpecBuilderMenuOpen(false);openSpecBuilderFromQuote();}}
                            title="Pre-fill from this quote's selected tests in the pricing calculator"
                            style={{width:"100%",background:"#fff",border:"none",borderBottom:"1px solid #e5e9ef",
                              padding:"8px 10px",color:"#1a2332",fontWeight:500,fontSize:11,cursor:"pointer",
                              textAlign:"left",letterSpacing:.2}}
                            onMouseEnter={e=>e.currentTarget.style.background="#f5f7fa"}
                            onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                            Spec Builder from NUForce
                            <div style={{fontSize:9,color:"#6b7a8d",marginTop:1}}>Pre-filled from pricing calculator</div>
                          </button>
                          <button onClick={()=>{setSpecBuilderMenuOpen(false);openSpecBuilderFromCrr();}}
                            title={crrWorkup ? "Pre-fill from the CRR workup for this quote"
                                             : "No CRR workup found for this quote yet"}
                            disabled={!crrWorkup || crrWorkup === false}
                            style={{width:"100%",background:"#fff",border:"none",
                              padding:"8px 10px",
                              color: (crrWorkup && crrWorkup !== false) ? "#1a2332" : "#9aa5b1",
                              fontWeight:500,fontSize:11,
                              cursor:(crrWorkup && crrWorkup !== false) ? "pointer" : "not-allowed",
                              textAlign:"left",letterSpacing:.2,
                              display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}
                            onMouseEnter={e=>{if(crrWorkup && crrWorkup!==false) e.currentTarget.style.background="#f5f7fa";}}
                            onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                            <div>
                              Spec Builder from CRR
                              <div style={{fontSize:9,color:"#6b7a8d",marginTop:1}}>
                                {(crrWorkup && crrWorkup !== false)
                                  ? "Pre-filled from CRR workup"
                                  : "No CRR workup found for this quote"}
                              </div>
                            </div>
                            {(crrWorkup && crrWorkup !== false) && (
                              <span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",
                                background:"#22c55e",flexShrink:0}}/>
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  </div>{/* end pointerEvents:auto buttons wrapper */}
                </>
              )}
            </div>{/* end Row 4 */}

            {/* ── Pricing & Instrumentation Calculators ── */}
            <PricingCalculator setup={setup} ti={ti}
              onExportEmiF={exportCalcEmi461fPDF}
              onExportEmiG={exportCalcEmi461gPDF}
              onExportPq300b={exportCalcPq300bPDF_calc}
              onExportPq300p1={exportCalcPq300Part1PDF_calc}
              calcStatesRef={pricingCalcStateRef}
              crrWorkup={crrWorkup}
              onRefreshCrr={()=>{setCrrWorkup(null);setCrrRefreshTick(t=>t+1);}}/>

            {/* ── Row 5+: Test sections ── */}
            <div>




            <Section title="CUSTOM LINE ITEMS" enabled={custom.on} onToggle={v=>setCustom(v?{...custom,on:true}:{on:false,rows:[]})}>
              <CustomForm s={custom} set={setCustom}/>
            </Section>

            {/* Advanced Mode — auto-calc test sections */}
            <div style={{marginBottom:8,border:"1px solid #e0e4ea",borderRadius:10,overflow:"hidden"}}>
              <div style={{background:"#f8f9fb",padding:"10px 14px",display:"flex",alignItems:"center",
                justifyContent:"space-between",cursor:"pointer",borderBottom:advancedModeOpen?"1px solid #e0e4ea":"none"}}
                onClick={()=>setAdvancedModeOpen(v=>!v)}>
                <div>
                  <span style={{fontSize:12,fontWeight:700,color:"#1a2332",letterSpacing:.2}}>Advanced Mode</span>
                  <span style={{fontSize:10,color:"#9aa5b1",marginLeft:8}}>— auto-calculating test forms</span>
                </div>
                <span style={{fontSize:12,color:"#9aa5b1"}}>{advancedModeOpen?"▲":"▼"}</span>
              </div>
              {advancedModeOpen&&(
                <div style={{padding:"8px 0"}}>
                  <MultiSection title="VIBRATION  (MIL-STD-167)" instances={vibs}
                    onAdd={mkAdder(vibs,setVibs,newVib)}
                    onRemove={mkRemover(vibs,setVibs)}
                    onUpdate={mkUpdater(vibs,setVibs)}
                    newInstance={newVib}
                    Form={VibForm} formProps={setupProps}/>

                  <MultiSection title="SHOCK TESTING  (MIL-STD-901)" instances={shocks}
                    onAdd={mkAdder(shocks,setShocks,newShock)}
                    onRemove={mkRemover(shocks,setShocks)}
                    onUpdate={mkUpdater(shocks,setShocks)}
                    newInstance={newShock}
                    Form={ShockForm} formProps={{vibSetup,ti,...setupProps}}/>

                  <Section title="INSTRUMENTATION" enabled={inst.on} onToggle={v=>setInst(v?{...inst,on:true}:{on:false,items:{}})}>
                    <InstForm s={inst} set={setInst}/>
                  </Section>

                  <MultiSection title="NOISE SUSCEPTIBILITY  (MIL-STD-810)" instances={noises}
                    onAdd={mkAdder(noises,setNoises,newNoise)}
                    onRemove={mkRemover(noises,setNoises)}
                    onUpdate={mkUpdater(noises,setNoises)}
                    newInstance={newNoise}
                    Form={NoiseForm} formProps={{ti,...setupProps}}/>

                  <MultiSection title="ENVIRONMENTAL TESTING" instances={envs}
                    onAdd={mkAdder(envs,setEnvs,newEnv)}
                    onRemove={mkRemover(envs,setEnvs)}
                    onUpdate={mkUpdater(envs,setEnvs)}
                    newInstance={newEnv}
                    Form={EnvForm} formProps={{}}/>

                  <MultiSection title="HIGH FREQUENCY VIBRATION" instances={hfvs}
                    onAdd={mkAdder(hfvs,setHfvs,newHfv)}
                    onRemove={mkRemover(hfvs,setHfvs)}
                    onUpdate={mkUpdater(hfvs,setHfvs)}
                    newInstance={newHfv}
                    Form={HfvForm} formProps={setupProps}/>

                  <MultiSection title="SHOCK (OTHER)" instances={shos}
                    onAdd={mkAdder(shos,setShos,newSho)}
                    onRemove={mkRemover(shos,setShos)}
                    onUpdate={mkUpdater(shos,setShos)}
                    newInstance={newSho}
                    Form={ShoForm} formProps={setupProps}/>

            <MultiSection title="EMI TESTING  (MIL-STD-461)" tag="SHIFTS" instances={emis}
              onAdd={mkAdder(emis,setEmis,newEmi)}
              onRemove={mkRemover(emis,setEmis)}
              onUpdate={mkUpdater(emis,setEmis)}
              newInstance={newEmi}
              Form={EmiForm} formProps={{ti}}/>

            <MultiSection title="POWER QUALITY  (MIL-STD-1399)" tag="SHIFTS" instances={pqs}
              onAdd={mkAdder(pqs,setPqs,newPq)}
              onRemove={mkRemover(pqs,setPqs)}
              onUpdate={mkUpdater(pqs,setPqs)}
              newInstance={newPq}
              Form={PqForm} formProps={{ti}}/>

            <MultiSection title="DC MAGNETICS" tag="SHIFTS" instances={dcms}
              onAdd={mkAdder(dcms,setDcms,newDcm)}
              onRemove={mkRemover(dcms,setDcms)}
              onUpdate={mkUpdater(dcms,setDcms)}
              newInstance={newDcm}
              Form={DcmForm} formProps={{}}/>

                  <MultiSection title="AIRBORNE NOISE" instances={abs}
                    onAdd={mkAdder(abs,setAbs,newAb)}
                    onRemove={mkRemover(abs,setAbs)}
                    onUpdate={mkUpdater(abs,setAbs)}
                    newInstance={newAb}
                    Form={AbForm} formProps={setupProps}/>

                  <MultiSection title="STRUCTUREBORNE NOISE" instances={sbs}
                    onAdd={mkAdder(sbs,setSbs,newSb)}
                    onRemove={mkRemover(sbs,setSbs)}
                    onUpdate={mkUpdater(sbs,setSbs)}
                    newInstance={newSb}
                    Form={SbForm} formProps={setupProps}/>
                </div>
              )}
            </div>


          </div>{/* end pointer-events wrapper */}
            </div>{/* end test sections lock wrapper */}


        </div>{/* end left scroll column */}

      </>)}{/* end dashboard/form conditional */}
      </div>{/* end body flex row */}

      {/* ── Product Picker Modal ── */}
      {showProductPicker&&(
        <ProductPicker
          onAdd={handleProductPickerAdd}
          onClose={()=>setShowProductPicker(false)}
          setup={setup}
          ti={ti}
          vibs={vibs}
          hfvs={hfvs}
          summary={summary}
        />
      )}

      {/* ── Revision History Modal ── */}
      {showRevHistory&&(
        <div onClick={()=>setShowRevHistory(false)}
          style={{position:"fixed",inset:0,background:"rgba(26,35,50,0.55)",zIndex:1200,
            display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#fff",borderRadius:12,boxShadow:"0 8px 40px rgba(0,0,0,0.2)",
              width:"100%",maxWidth:1200,height:"calc(100vh - 48px)",
              display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Header */}
            <div style={{padding:"14px 20px",borderBottom:"1px solid #e8ecf0",
              display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#1a2332",letterSpacing:.3}}>
                  REVISION HISTORY — {qi.opp||"(unsaved)"}
                </div>
                <div style={{fontSize:10,color:"#9aa5b1",marginTop:2}}>
                  {revHistoryList.length} revision{revHistoryList.length!==1?"s":""} found
                </div>
              </div>
              <button onClick={()=>setShowRevHistory(false)}
                style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9aa5b1",padding:"0 4px",lineHeight:1}}>×</button>
            </div>
            {/* Body */}
            <div style={{display:"flex",flex:1,minHeight:0}}>
              {/* Left: revision list */}
              <div style={{width:240,borderRight:"1px solid #e8ecf0",overflow:"auto"}}>
                {revHistoryLoading?(
                  <div style={{padding:16,fontSize:11,color:"#9aa5b1",textAlign:"center"}}>Loading…</div>
                ):revHistoryList.length===0?(
                  <div style={{padding:16,fontSize:11,color:"#9aa5b1",textAlign:"center",fontStyle:"italic"}}>
                    No revisions found.
                  </div>
                ):revHistoryList.map((r,i)=>{
                  const isFrom=r.id===revCompareFromId, isTo=r.id===revCompareToId;
                  const lbl=r.revision?`Rev ${r.revision}`:"Original";
                  const dt=new Date(r.updated_at||r.created_at).toLocaleDateString();
                  return(
                    <div key={r.id} style={{padding:"10px 14px",borderBottom:"1px solid #f0f2f5",
                      background:isTo?"#dbeafe":isFrom?"#fef3c7":"#fff"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#1a2332"}}>{lbl}{i===0&&" (latest)"}</div>
                      <div style={{fontSize:10,color:"#6b7a8d",marginTop:2}}>{dt}</div>
                      <div style={{fontSize:11,color:"#1a5276",marginTop:2,fontWeight:600}}>{money(r.total||0)}</div>
                      <div style={{display:"flex",gap:4,marginTop:6}}>
                        <button onClick={()=>setRevCompareFromId(r.id)}
                          style={{flex:1,fontSize:9,padding:"3px 6px",borderRadius:4,
                            border:"1px solid "+(isFrom?"#b7791f":"#d0d7de"),
                            background:isFrom?"#fef3c7":"#fff",color:isFrom?"#7b4f12":"#6b7a8d",cursor:"pointer"}}>
                          {isFrom?"From ✓":"Set From"}
                        </button>
                        <button onClick={()=>setRevCompareToId(r.id)}
                          style={{flex:1,fontSize:9,padding:"3px 6px",borderRadius:4,
                            border:"1px solid "+(isTo?"#1d4ed8":"#d0d7de"),
                            background:isTo?"#dbeafe":"#fff",color:isTo?"#1e40af":"#6b7a8d",cursor:"pointer"}}>
                          {isTo?"To ✓":"Set To"}
                        </button>
                      </div>
                      {isApprover&&i>0&&(
                        <button onClick={()=>{
                          if(!confirm(`Load ${lbl} into the editor as a draft? You'll need to save to commit it as a new revision.`))return;
                          if(r.data)handleLoad({...r.data,id:currentQuoteId});
                          setShowRevHistory(false);
                          showToast(`Loaded ${lbl} — review and save as new revision`,"success");
                        }}
                          style={{width:"100%",marginTop:4,fontSize:9,padding:"3px 6px",borderRadius:4,
                            border:"1px solid #f5b7b1",background:"#fff",color:"#c0392b",cursor:"pointer",fontWeight:600}}>
                          Load this revision
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Right: diff view */}
              <div style={{flex:1,padding:20,overflow:"auto"}}>
                {(()=>{
                  if(revHistoryLoading)return null;
                  const fromRow=revHistoryList.find(r=>r.id===revCompareFromId);
                  const toRow=revHistoryList.find(r=>r.id===revCompareToId);
                  if(!toRow)return <div style={{color:"#9aa5b1",fontSize:12,fontStyle:"italic",textAlign:"center",marginTop:40}}>Pick a "To" revision on the left to see changes.</div>;
                  if(!fromRow)return <div style={{color:"#9aa5b1",fontSize:12,fontStyle:"italic",textAlign:"center",marginTop:40}}>This is the only revision — nothing to compare against.</div>;
                  // ── Build diff ──
                  const fromQ=fromRow.data||{}, toQ=toRow.data||{};
                  const fromLbl=fromRow.revision?`Rev ${fromRow.revision}`:"Original";
                  const toLbl=toRow.revision?`Rev ${toRow.revision}`:"Original";
                  // Metadata fields to compare
                  const META=[
                    ["Opportunity","qi.opp"],
                    ["Customer","qi.account"],
                    ["RFQ","qi.rfq"],
                    ["Stage","qi.stage"],
                    ["Type","qi.type"],
                    ["Contact","qi.contact"],
                    ["Email","qi.email"],
                    ["Test Item","ti.item"],
                    ["Drawing","ti.drawing"],
                    ["Size L","ti.dimL"],
                    ["Size W","ti.dimW"],
                    ["Size H","ti.dimH"],
                    ["Weight","ti.wt"],
                    ["Voltage","ti.volt"],
                    ["Phase","ti.phase"],
                    ["Hz","ti.hz"],
                    ["Amps","ti.amps"],
                  ];
                  const get=(o,p)=>{const parts=p.split(".");let v=o;for(const k of parts){v=v?.[k];if(v===undefined)break;}return v??"";};
                  const metaChanges=META.map(([lbl,p])=>({lbl,from:String(get(fromQ,p)||""),to:String(get(toQ,p)||"")})).filter(c=>c.from!==c.to);
                  // Specs/Notes
                  const fromSpecs=(fromQ.ti?.tiSpecs||"").trim(), toSpecs=(toQ.ti?.tiSpecs||"").trim();
                  const fromNotes=(fromQ.ti?.tiNotes||"").trim(), toNotes=(toQ.ti?.tiNotes||"").trim();
                  // Line items — combine BOTH sources the quote total is built from:
                  // the auto-calc lines (snapshot if frozen, else live summary) AND
                  // pickerLines (the current standard for manually-added items). The
                  // old diff only read summary/snapshot, so quotes whose items live in
                  // pickerLines showed a total change with no line detail.
                  const linesOf=q=>{
                    const auto=(q.snapshot?.lines||q.summary?.lines||[])
                      .map(l=>({label:l.label||"",val:sf(l.val,0),code:l.code||""}));
                    const picker=(q.pickerLines||[])
                      .map(l=>({label:l.label||"",val:sf(l.price,0),code:l.code||""}))
                      .filter(l=>l.label||l.val);
                    return [...auto,...picker];
                  };
                  const fromLines=linesOf(fromQ), toLines=linesOf(toQ);
                  // Index by label+code, keeping duplicates so nothing is silently
                  // dropped (two lines with the same name are paired positionally).
                  const indexLines=lines=>{
                    const m=new Map();
                    lines.forEach(l=>{
                      const k=(l.label||"")+" "+(l.code||"");
                      if(!m.has(k))m.set(k,[]);
                      m.get(k).push(l);
                    });
                    return m;
                  };
                  const fromIdx=indexLines(fromLines), toIdx=indexLines(toLines);
                  const allKeys=new Set([...fromIdx.keys(),...toIdx.keys()]);
                  const lineChanges=[];
                  for(const k of allKeys){
                    const fArr=fromIdx.get(k)||[], tArr=toIdx.get(k)||[];
                    const n=Math.max(fArr.length,tArr.length);
                    for(let i=0;i<n;i++){
                      const f=fArr[i], t=tArr[i];
                      const label=(t&&t.label)||(f&&f.label)||"";
                      if(!f&&t)lineChanges.push({type:"added",label,toVal:t.val});
                      else if(f&&!t)lineChanges.push({type:"removed",label,fromVal:f.val});
                      else if(f&&t&&f.val!==t.val)lineChanges.push({type:"changed",label,fromVal:f.val,toVal:t.val});
                    }
                  }
                  lineChanges.sort((a,b)=>{
                    const rank={removed:0,changed:1,added:2};
                    return (rank[a.type]-rank[b.type])||a.label.localeCompare(b.label);
                  });
                  const totalDiff=(toQ.total||0)-(fromQ.total||0);
                  const allClean=metaChanges.length===0&&fromSpecs===toSpecs&&fromNotes===toNotes&&lineChanges.length===0&&totalDiff===0;
                  // ── Render ──
                  return(
                    <div>
                      <div style={{padding:"8px 12px",background:"#f8f9fb",borderRadius:6,marginBottom:14,
                        display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:11,color:"#6b7a8d"}}>
                          Comparing <strong style={{color:"#7b4f12"}}>{fromLbl}</strong> → <strong style={{color:"#1e40af"}}>{toLbl}</strong>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:totalDiff>0?"#15803d":totalDiff<0?"#c0392b":"#6b7a8d"}}>
                          {money(fromRow.total||0)} → {money(toRow.total||0)}
                          {totalDiff!==0&&<span style={{marginLeft:8,fontSize:11}}>({totalDiff>0?"+":""}{money(totalDiff)})</span>}
                        </div>
                      </div>
                      {allClean&&(
                        <div style={{padding:30,textAlign:"center",color:"#9aa5b1",fontSize:12,fontStyle:"italic"}}>
                          No differences detected between these revisions.
                        </div>
                      )}
                      {metaChanges.length>0&&(
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:6}}>METADATA CHANGES</div>
                          {metaChanges.map((c,i)=>(
                            <div key={i} style={{fontSize:11,padding:"4px 8px",background:"#fef3c7",borderRadius:4,marginBottom:3}}>
                              <strong style={{color:"#7b4f12"}}>{c.lbl}:</strong>
                              <span style={{color:"#c0392b",textDecoration:"line-through",marginLeft:6}}>{c.from||"(empty)"}</span>
                              <span style={{color:"#15803d",marginLeft:6}}>→ {c.to||"(empty)"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {lineChanges.length>0&&(
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:6}}>LINE ITEM CHANGES</div>
                          {lineChanges.map((c,i)=>(
                            <div key={i} style={{fontSize:11,padding:"5px 10px",borderRadius:4,marginBottom:3,
                              background:c.type==="added"?"#f0fdf4":c.type==="removed"?"#fdf3f2":"#fef3c7",
                              borderLeft:"3px solid "+(c.type==="added"?"#15803d":c.type==="removed"?"#c0392b":"#b7791f")}}>
                              <span style={{fontWeight:700,color:c.type==="added"?"#15803d":c.type==="removed"?"#c0392b":"#7b4f12",marginRight:6}}>
                                {c.type==="added"?"+ ADDED":c.type==="removed"?"- REMOVED":"~ CHANGED"}
                              </span>
                              <span style={{color:"#1a2332"}}>{c.label}</span>
                              <span style={{float:"right",fontFamily:"monospace",color:"#6b7a8d"}}>
                                {c.type==="changed"?
                                  (<><span style={{color:"#c0392b",textDecoration:"line-through"}}>{money(c.fromVal)}</span> → <span style={{color:"#15803d"}}>{money(c.toVal)}</span></>):
                                  c.type==="added"?money(c.toVal):money(c.fromVal)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {fromSpecs!==toSpecs&&(
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:6}}>SPECIFICATIONS CHANGED</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            <div style={{padding:8,background:"#fdf3f2",borderLeft:"3px solid #c0392b",borderRadius:4,fontSize:10,whiteSpace:"pre-wrap"}}>
                              <div style={{fontSize:9,fontWeight:700,color:"#c0392b",marginBottom:4}}>{fromLbl}</div>
                              {fromSpecs||"(empty)"}
                            </div>
                            <div style={{padding:8,background:"#f0fdf4",borderLeft:"3px solid #15803d",borderRadius:4,fontSize:10,whiteSpace:"pre-wrap"}}>
                              <div style={{fontSize:9,fontWeight:700,color:"#15803d",marginBottom:4}}>{toLbl}</div>
                              {toSpecs||"(empty)"}
                            </div>
                          </div>
                        </div>
                      )}
                      {fromNotes!==toNotes&&(
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#9aa5b1",marginBottom:6}}>NOTES CHANGED</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            <div style={{padding:8,background:"#fdf3f2",borderLeft:"3px solid #c0392b",borderRadius:4,fontSize:10,whiteSpace:"pre-wrap"}}>
                              <div style={{fontSize:9,fontWeight:700,color:"#c0392b",marginBottom:4}}>{fromLbl}</div>
                              {fromNotes||"(empty)"}
                            </div>
                            <div style={{padding:8,background:"#f0fdf4",borderLeft:"3px solid #15803d",borderRadius:4,fontSize:10,whiteSpace:"pre-wrap"}}>
                              <div style={{fontSize:9,fontWeight:700,color:"#15803d",marginBottom:4}}>{toLbl}</div>
                              {toNotes||"(empty)"}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Chatter panel ── */}
      {showChatter&&<div onClick={()=>setShowChatter(false)} style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,0.25)"}}/>}
      <div style={{position:"fixed",top:0,right:showChatter?0:-440,width:420,bottom:0,zIndex:1150,
        background:"#fff",boxShadow:"-4px 0 24px rgba(0,0,0,0.15)",transition:"right 0.3s ease",
        display:"flex",flexDirection:"column",fontFamily:"Segoe UI,system-ui,sans-serif"}}>
        {/* Header */}
        <div style={{background:"#1a5276",padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:"#fff",letterSpacing:.5}}>💬 Chatter</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",marginTop:2}}>{qi?.opp||"(no opportunity)"} · {chatterEntries.length} entr{chatterEntries.length===1?"y":"ies"}</div>
          </div>
          <button onClick={()=>setShowChatter(false)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:6,color:"#fff",fontSize:16,cursor:"pointer",padding:"4px 10px",fontWeight:700}}>✕</button>
        </div>
        {/* Entries */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
          {chatterEntries.length===0?(
            <div style={{textAlign:"center",color:"#9aa5b1",fontSize:13,padding:"40px 20px",lineHeight:1.8}}>
              No entries yet.<br/>Be the first to add a note.
            </div>
          ):(
            [...chatterEntries].reverse().map((e,i)=>(
              <div key={i} style={{background:"#f8f9fa",borderRadius:8,padding:"10px 13px",
                border:"1px solid #e8ecf0"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                  <span style={{fontSize:11,fontWeight:700,color:"#1a5276"}}>{e.by||"Unknown"}</span>
                  <span style={{fontSize:10,color:"#9aa5b1"}}>
                    {e.at?new Date(e.at).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):""}
                  </span>
                </div>
                <div style={{fontSize:12,color:"#1a2332",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{e.msg}</div>
              </div>
            ))
          )}
        </div>
        {/* Input */}
        <div style={{padding:"12px 16px",borderTop:"1px solid #e8ecf0",flexShrink:0,background:"#f8f9fa"}}>
          {!currentQuoteId&&(
            <div style={{fontSize:11,color:"#b7791f",marginBottom:8,background:"#fffbeb",borderRadius:6,padding:"6px 10px",border:"1px solid #f6d860"}}>
              ⚠️ Save the quote first before adding chatter.
            </div>
          )}
          <textarea
            value={chatterInput}
            onChange={e=>setChatterInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))document.getElementById("chatter-post-btn")?.click();}}
            placeholder="Add a note, update, or question… (Ctrl+Enter to post)"
            rows={3}
            style={{width:"100%",fontSize:12,borderRadius:7,border:"1px solid #d0d7de",padding:"8px 10px",
              resize:"none",fontFamily:"inherit",boxSizing:"border-box",outline:"none",lineHeight:1.6}}
          />
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
            <button id="chatter-post-btn"
              disabled={!chatterInput.trim()||!currentQuoteId||chatterSaving}
              onClick={async()=>{
                if(!chatterInput.trim()||!currentQuoteId)return;
                setChatterSaving(true);
                const entry={by:currentUser,at:new Date().toISOString(),msg:chatterInput.trim()};
                const updated=[...chatterEntries,entry];
                setChatterEntries(updated);
                setChatterInput("");
                // Save immediately so chatter persists without requiring manual SAVE
                const q={id:currentQuoteId,opp:qi.opp,customer:qi.account,rfq:qi.rfq,total:displayTotal,
                  qi,ti,vibs,shocks,noises,envs,hfvs,shos,dcms,pqs,emis,abs,sbs,inst,ot,custom,budget,coc,sub,td,setup,globalPR,notes,splitProcReport,modalAnalysis,fixtureDrawing,inStockModal,wonInfo,approval,wonApproval,chatterEntries:updated,summary,lineOrder,lineOverrides,pickerLines,unifiedOrder,workspace_project_id:workspaceProjectId};
                await saveQuoteToSupabase(q,autoSpecs,autoNotes);
                setChatterSaving(false);
              }}
              style={{background:!chatterInput.trim()||!currentQuoteId?"#e8ecf0":"#1a5276",
                border:"none",borderRadius:7,padding:"7px 20px",fontWeight:700,fontSize:12,
                cursor:!chatterInput.trim()||!currentQuoteId?"default":"pointer",
                color:!chatterInput.trim()||!currentQuoteId?"#9aa5b1":"#fff",
                display:"flex",alignItems:"center",gap:6}}>
              {chatterSaving?"Saving…":"💬 Post"}
            </button>
          </div>
        </div>
      </div>

      {toast&&(
        <div style={{
          position:"fixed",bottom:24,right:24,zIndex:9999,
          background:toast.type==="error"?"#c0392b":toast.type==="info"?"#1a5276":"#1e8449",
          color:"#fff",borderRadius:10,padding:"12px 20px",
          boxShadow:"0 4px 20px rgba(0,0,0,0.25)",
          fontSize:13,fontWeight:600,
          display:"flex",alignItems:"center",gap:10,
          animation:"fadeInUp 0.2s ease",
          maxWidth:340,
        }}>
          <span>{toast.type==="error"?"⚠️":toast.type==="info"?"ℹ️":"✓"}</span>
          <span>{toast.msg}</span>
          <button onClick={()=>setToast(null)}
            style={{background:"none",border:"none",color:"rgba(255,255,255,0.7)",
              cursor:"pointer",fontSize:16,padding:0,marginLeft:4,lineHeight:1}}>
            ×
          </button>
        </div>
      )}

      {/* ── Reminders slide-out panel ── */}
      {openQuotesPanel&&(
        <div onClick={()=>setOpenQuotesPanel(false)}
          style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,0.25)"}}/>
      )}
      <div
        onClick={()=>{if(!openQuotesPanel){setOpenQuotesPanel(true);loadOpenQuotes();}else setOpenQuotesPanel(false);}}
        style={{position:"fixed",left:openQuotesPanel?380:0,top:"50%",transform:"translateY(-50%)",zIndex:1200,background:"#1a5276",color:"#fff",borderRadius:"0 6px 6px 0",padding:"8px 5px",cursor:"pointer",transition:"left 0.3s ease",writingMode:"vertical-rl",textOrientation:"mixed",fontSize:9,fontWeight:700,letterSpacing:1,boxShadow:"2px 0 8px rgba(0,0,0,0.2)",userSelect:"none",display:"flex",alignItems:"center",gap:4}}>
        <span style={{fontSize:11}}>📂</span>
        <span>REMINDERS</span>
      </div>
      <div style={{position:"fixed",left:openQuotesPanel?0:-400,top:0,bottom:0,width:380,background:"#ffffff",zIndex:1150,boxShadow:"4px 0 24px rgba(0,0,0,0.18)",transition:"left 0.3s ease",display:"flex",flexDirection:"column",fontFamily:"Segoe UI,system-ui,sans-serif"}}>
        <div style={{background:"#1a5276",padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:"#fff",letterSpacing:.5}}>📌 Reminders</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",marginTop:2}}>Click an opportunity number to load</div>
          </div>
          <button onClick={()=>setOpenQuotesPanel(false)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:6,color:"#fff",fontSize:16,cursor:"pointer",padding:"4px 10px",fontWeight:700}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 28px",gap:4,padding:"8px 12px",background:"#e8ecf0",borderBottom:"2px solid #d0d7de",flexShrink:0}}>
          {["Opportunity #","Account","Description",""].map((h,i)=>(
            <div key={i} style={{fontSize:9,color:"#9aa5b1",fontWeight:700,letterSpacing:.8}}>{h}</div>
          ))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"8px 12px"}}>
          {openQuotesLoading&&<div style={{textAlign:"center",color:"#9aa5b1",fontSize:12,padding:20}}>Loading…</div>}
          {!openQuotesLoading&&openQuotesList.length===0&&(
            <div style={{textAlign:"center",color:"#9aa5b1",fontSize:12,padding:30,lineHeight:1.8}}>No reminders yet.<br/>Click + Add Row to get started.</div>
          )}
          {openQuotesList.map(row=>(
            <div key={row.id}
              draggable
              onDragStart={()=>handleOpenQuoteDragStart(row.id)}
              onDragOver={e=>{e.preventDefault();setDragOverId(row.id);}}
              onDragLeave={()=>setDragOverId(null)}
              onDrop={()=>handleOpenQuoteDrop(row.id)}
              style={{marginBottom:8,background:dragOverId===row.id?"#d0e8f7":"#e8ecf0",borderRadius:7,padding:"8px 10px",
                border:"1px solid "+(dragOverId===row.id?"#1a5276":"#d0d7de"),
                cursor:"grab",transition:"background 0.15s,border 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{color:"#b0b8c4",fontSize:13,cursor:"grab",flexShrink:0}}>⠿</span>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 28px",gap:4,flex:1,alignItems:"center"}}>
                  <input value={row.account||""} onChange={e=>updateOpenQuoteRow(row.id,"account",e.target.value)} placeholder="Account" style={{background:"#f8f9fa",border:"1px solid #d0d7de",borderRadius:6,padding:"4px 8px",fontSize:11,outline:"none",fontFamily:"inherit",boxSizing:"border-box",width:"100%"}}/>
                  <input value={row.description||""} onChange={e=>updateOpenQuoteRow(row.id,"description",e.target.value)} placeholder="Brief description" style={{background:"#f8f9fa",border:"1px solid #d0d7de",borderRadius:6,padding:"4px 8px",fontSize:11,outline:"none",fontFamily:"inherit",boxSizing:"border-box",width:"100%"}}/>
                  <button onClick={()=>deleteOpenQuoteRow(row.id)} style={{background:"none",border:"none",color:"#9aa5b1",cursor:"pointer",fontSize:13,padding:0,textAlign:"center"}} title="Remove row">✕</button>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,paddingLeft:19}}>
                <span
                  onClick={()=>handleOpenQuoteClick(row)}
                  title={row.opportunity?"Load quote: "+row.opportunity:"Enter an opportunity number first"}
                  style={{fontSize:12,fontWeight:700,color:row.opportunity?"#1a5276":"#9aa5b1",cursor:row.opportunity?"pointer":"default",textDecoration:row.opportunity?"underline":"none",flex:"0 0 auto",minWidth:0}}>
                  {row.opportunity||"—"}
                </span>
                <input value={row.opportunity||""} onChange={e=>updateOpenQuoteRow(row.id,"opportunity",e.target.value)} placeholder="Opportunity #" style={{background:"#f8f9fa",border:"1px solid #d0d7de",borderRadius:6,padding:"4px 8px",fontSize:11,outline:"none",fontFamily:"inherit",boxSizing:"border-box",flex:1}}/>
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"10px 12px",borderTop:"1px solid #d0d7de",flexShrink:0}}>
          <button onClick={addOpenQuoteRow} style={{width:"100%",background:"none",border:"1px dashed #d0d7de",borderRadius:7,color:"#1a5276",padding:"8px 0",cursor:"pointer",fontSize:12,fontWeight:600}}>+ Add Row</button>
        </div>
      </div>

    </div>
  );
}
