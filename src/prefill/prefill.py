from __future__ import annotations
import json, yaml
from pathlib import Path

def render_template(obj, profile):
    if isinstance(obj, dict): return {k: render_template(v, profile) for k,v in obj.items()}
    if isinstance(obj, list): return [render_template(x, profile) for x in obj]
    if isinstance(obj, str):
        out=obj.replace('{{profile.name}}', profile.get('name',''))
        out=out.replace('{{profile.contact.email}}', profile.get('contact',{}).get('email',''))
        out=out.replace('{{profile.contact.phone}}', profile.get('contact',{}).get('phone',''))
        out=out.replace('{{profile.visa.needs_sponsorship_outside_india}}', str(profile.get('visa',{}).get('needs_sponsorship_outside_india','')))
        return out
    return obj

def build_prefill_map(system_root: Path, profile, ats: str):
    fm = yaml.safe_load((system_root / 'src' / 'prefill' / 'field_maps.yaml').read_text())
    if ats not in fm: raise KeyError(f"No mapping for ATS '{ats}'")
    return render_template(fm[ats], profile)
