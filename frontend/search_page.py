import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('app/ai-toolkit/page.tsx', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        # find functions and state variables
        if 'const [' in line and 'useState' in line:
            print(f"Line {i:04d}: {line.strip()}")
        elif 'function ' in line and not line.strip().startswith('//'):
            print(f"Line {i:04d}: {line.strip()}")
        elif 'const ' in line and '=>' in line and '(' in line and not line.strip().startswith('//'):
            if 'async' in line or 'handle' in line:
                print(f"Line {i:04d}: {line.strip()}")
