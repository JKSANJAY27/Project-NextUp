import re

with open(r'D:\NextupAI\Project-NextUp\backend\app\api\companies.py', 'r', encoding='utf-8') as f:
    text = f.read()

jd_func_match = re.search(r'def process_jd_background.*?(?=    elif import_type == "jd":)', text, re.DOTALL)
jd_func = jd_func_match.group(0)
text = text.replace(jd_func, '')

shortlist_func_match = re.search(r'def process_shortlist_background.*?(?=    elif import_type == "shortlist":)', text, re.DOTALL)
shortlist_func = shortlist_func_match.group(0)
text = text.replace(shortlist_func, '')

import_idx = text.find('@router.post("/import")')
text = text[:import_idx] + jd_func + "\n" + shortlist_func + "\n" + text[import_idx:]

with open(r'D:\NextupAI\Project-NextUp\backend\app\api\companies.py', 'w', encoding='utf-8') as f:
    f.write(text)
