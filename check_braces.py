with open("frontend/app/ai-toolkit/page.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

brace_count = 0
for idx, line in enumerate(lines, 1):
    # Strip comments
    line_no_comments = line.split("//")[0]
    
    # We also want to strip block comments if possible, but let's just count braces
    # simple counting first
    opens = line_no_comments.count("{")
    closes = line_no_comments.count("}")
    
    old_count = brace_count
    brace_count += opens - closes
    
    if idx >= 79 and idx <= 720:
        if old_count > 0 and brace_count == 0:
            print(f"Line {idx} closes the block: {line.strip()}")
