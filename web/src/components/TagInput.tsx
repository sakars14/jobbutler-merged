import { useState } from "react";

export default function TagInput({
  label, placeholder, value, onChange, suggestions=[]
}: {
  label: string;
  placeholder?: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}) {
  const [entry, setEntry] = useState("");
  const add = (v: string) => {
    const val = v.trim();
    if (!val) return;
    if (!value.includes(val)) onChange([...value, val]);
    setEntry("");
  };
  const remove = (t: string) => onChange(value.filter(x => x !== t));

  return (
    <div style={{marginBottom:16}}>
      <div style={{fontWeight:600, marginBottom:6}}>{label}</div>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:6}}>
        {value.map(v=>(
          <span key={v} style={{border:"1px solid #ddd", borderRadius:16, padding:"4px 10px"}}>
            {v} <button onClick={()=>remove(v)} style={{marginLeft:6, border:"none", background:"transparent", cursor:"pointer"}}>×</button>
          </span>
        ))}
      </div>
      <div style={{display:"flex", gap:8}}>
        <input
          value={entry}
          onChange={e=>setEntry(e.target.value)}
          onKeyDown={e=>{ if (e.key==="Enter") add(entry) }}
          placeholder={placeholder || "Add and press Enter"}
          style={{flex:1}}
        />
        <button className="dash-pill tag-add" onClick={()=>add(entry)}>Add</button>
      </div>
      {suggestions.length>0 && (
        <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:8}}>
          {suggestions.map(s=>(
            <button key={s} className="tag-suggestion" onClick={()=>add(s)} style={{border:"1px solid #eee", borderRadius:12, padding:"4px 8px", background:"#fafafa"}}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
