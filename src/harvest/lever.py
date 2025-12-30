from __future__ import annotations
import requests
from typing import List
from .sources import JobPosting

def harvest_lever(companies: list[str])->List[JobPosting]:
    out=[]
    for comp in companies:
        comp=comp.strip();
        if not comp: continue
        url=f'https://api.lever.co/v0/postings/{comp}?mode=json'
        try:
            r=requests.get(url,timeout=20)
            if r.status_code!=200: print(f'[lever] {comp} status {r.status_code}'); continue
            data=r.json() or []
        except Exception as e:
            print(f'[lever] {comp} error: {e}'); continue
        for j in data:
            location=(j.get('categories') or {}).get('location','')
            url2=j.get('hostedUrl','') or j.get('applyUrl','')
            jd=(j.get('descriptionPlain') or '')
            out.append(JobPosting(source=f'lever:{comp}',company=comp,title=j.get('text',''),location=location,url=url2,external_id=str(j.get('id','')),posted_at=str(j.get('createdAt','')),jd_text=jd))
    return out
