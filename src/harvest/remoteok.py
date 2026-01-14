from __future__ import annotations
import requests
from typing import List
from .sources import JobPosting

def harvest_remoteok()->List[JobPosting]:
    url='https://remoteok.com/api'; out=[]
    try:
        r=requests.get(url,timeout=20,headers={'User-Agent':'job-butler/1.0'}); data=r.json()
    except Exception as e:
        print(f'[remoteok] error: {e}'); return out
    if not isinstance(data,list): return out
    for d in data:
        if not isinstance(d,dict): continue
        title=d.get('position') or d.get('title');
        if not title: continue
        company=d.get('company',''); location=d.get('location','Remote'); url2 = d.get("apply_url") or d.get("url") or f"https://remoteok.com/remote-jobs/{d.get('slug') or d.get('id')}"
        posted=str(d.get('epoch') or d.get('date') or ''); jd=(d.get('description') or '')[:10000]
        ext = d.get("id") or d.get("slug")
        out.append(JobPosting(source='remoteok',company=company,title=title,location=location,url=url2,external_id=str(ext) if ext is not None else None,posted_at=posted,jd_text=jd))
    return out
