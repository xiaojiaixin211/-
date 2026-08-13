import json,random,hashlib
random.seed(12345)
users={}
for i in range(1,101):
    uname=f"haida{str(i).zfill(3)}"
    up=random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')+random.choice('abcdefghijklmnopqrstuvwxyz')+str(random.randint(100000,999999)).zfill(6)
    h=hashlib.sha256(up.encode('utf-8')).hexdigest()
    users[uname]={'passwordHash':h,'credits':10}
print('{')
for k,v in users.items():
    print(f'  "{k}": {{ passwordHash: "{v["passwordHash"]}", credits: {v["credits"]} }},')
print('}')
