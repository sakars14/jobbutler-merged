from __future__ import annotations
import requests
from typing import List
from .sources import JobPosting

def harvest_greenhouse(boards: list[str])->List[JobPosting]:
    out=[]
    for board in boards:
        board=board.strip()
        if not board: continue
        url=f'https://boards-api.greenhouse.io/v1/boards/{board}/jobs'
        try:
            r=requests.get(url,timeout=20)
            if r.status_code!=200: print(f'[greenhouse] {board} status {r.status_code}'); continue
            data=r.json() or {}
        except Exception as e:
            print(f'[greenhouse] {board} error: {e}'); continue
        for j in data.get('jobs',[]):
            out.append(JobPosting(source=f'greenhouse:{board}',company=board,title=j.get('title',''),location=(j.get('location') or {}).get('name',''),url=j.get('absolute_url',''),external_id=str(j.get('id','')),posted_at=j.get('updated_at',''),jd_text=j.get('content','') or ''))
    return out
