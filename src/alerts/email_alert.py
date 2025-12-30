import os, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
load_dotenv()

def send_alert(jobs:list[dict], top:int=10):
    host=os.getenv('EMAIL_HOST'); port=int(os.getenv('EMAIL_PORT','587'))
    user=os.getenv('EMAIL_USER'); pwd=os.getenv('EMAIL_PASS')
    from_addr=os.getenv('EMAIL_FROM','Job Butler <alerts@example.com>'); to_addr=os.getenv('EMAIL_TO')
    if not all([host,port,user,pwd,to_addr]):
        print('Email settings missing; skipping send.'); return
    rows=''
    for i,j in enumerate(jobs[:top],1):
        rows+=f"<p><b>{i}. {j.get('title','')} — {j.get('company','')}</b><br/>{j.get('location','')} | score: {j.get('_score')}<br/><a href='{j.get('url','')}'>Open</a></p>"
    html=f"<h2>Job Butler — Top Matches</h2>{rows or '<p>No jobs found.</p>'}"
    msg=MIMEMultipart('alternative'); msg['Subject']='Job Butler: top matches'; msg['From']=from_addr; msg['To']=to_addr
    msg.attach(MIMEText(html,'html'))
    with smtplib.SMTP(host, port) as s:
        s.starttls(); s.login(user, pwd); s.sendmail(from_addr, [to_addr], msg.as_string()); print(f'Alert sent to {to_addr}')
