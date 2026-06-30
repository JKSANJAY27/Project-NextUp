with open('d:/Sanjay/B.Tech CSE/nextup/backend/app/api/companies.py', 'r') as f:
    lines = f.readlines()

new_lines = []
jd_bg = []
sl_bg = []

in_jd = False
in_sl = False

for line in lines:
    if line.startswith('def process_jd_background('):
        in_jd = True
    elif line.startswith('def process_shortlist_background('):
        in_sl = True
        
    if in_jd:
        jd_bg.append(line)
        if line.strip() == 'db.close()':
            in_jd = False
    elif in_sl:
        sl_bg.append(line)
        if line.strip() == 'db.close()':
            in_sl = False
    else:
        new_lines.append(line)

idx = 0
for i, line in enumerate(new_lines):
    if line.startswith('@router.post("/import")'):
        idx = i
        break

final_lines = new_lines[:idx] + jd_bg + ['\n'] + sl_bg + ['\n'] + new_lines[idx:]

with open('d:/Sanjay/B.Tech CSE/nextup/backend/app/api/companies.py', 'w') as f:
    f.writelines(final_lines)
print('Done!')
