from bs4 import BeautifulSoup
from dataclasses import dataclass, asdict
from typing import List, Dict

@dataclass
class ParsedJob:
    source: str; company: str; title: str; location: str; url: str; external_id: str|None; posted_at: str|None; jd_text: str; salary: str|None=None; tags: str|None=None; visa: str|None=None

def parse_naukri_email_html(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, 'lxml'); jobs: List[ParsedJob] = []
    for a in soup.select('a'):
        href = (a.get('href') or ''); text = a.get_text(' ', strip=True)
        if 'naukri.com' in href and any(k in text.lower() for k in ['analyst','analytics','data','ml','manager']):
            title = text[:160]; jobs.append(ParsedJob(source='naukri_email', company='Company', title=title, location='', url=href, external_id=None, posted_at=None, jd_text=title))
    return [asdict(j) for j in jobs]
