import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('app/ai-toolkit/page.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

print("updateCopilotAnswer in src:", 'updateCopilotAnswer' in src)
print("handleGenerateTailoredResume in src:", 'handleGenerateTailoredResume' in src)

# Let's print exactly where they are
for m in re.finditer(r'updateCopilotAnswer', src):
    start = max(0, m.start() - 100)
    end = min(len(src), m.end() + 200)
    print("MATCH CONTEXT:")
    print(repr(src[start:end]))
