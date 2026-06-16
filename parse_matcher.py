import re
import sys
import os

TXT_PATH = r"d:\Sanjay\B.Tech CSE\nextup\srbhr-resume-matcher-8a5edab282632443 (1).txt"

def get_file_map():
    file_map = []
    current_file = None
    current_start = None
    
    with open(TXT_PATH, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
        
    for idx, line in enumerate(lines, 1):
        if line.startswith("FILE: "):
            if current_file:
                file_map.append({
                    "path": current_file,
                    "start": current_start,
                    "end": idx - 2  # subtract 2 to omit the separator line before the next file
                })
            current_file = line.strip().split("FILE: ")[1]
            current_start = idx + 1
            
    if current_file:
        file_map.append({
            "path": current_file,
            "start": current_start,
            "end": len(lines)
        })
        
    return file_map, lines

def list_files():
    file_map, _ = get_file_map()
    print(f"Total files in dump: {len(file_map)}")
    for i, item in enumerate(file_map):
        print(f"[{i}] {item['path']} (Lines {item['start']}-{item['end']})")

def extract_file(index_or_path, target_path=None):
    file_map, lines = get_file_map()
    selected = None
    
    # Check if index
    try:
        idx = int(index_or_path)
        if 0 <= idx < len(file_map):
            selected = file_map[idx]
    except ValueError:
        # Search by path suffix or exact path
        for item in file_map:
            if item['path'] == index_or_path or item['path'].endswith(index_or_path):
                selected = item
                break
                
    if not selected:
        print(f"File '{index_or_path}' not found.")
        return
        
    print(f"Extracting {selected['path']} (Lines {selected['start']}-{selected['end']})...")
    content_lines = lines[selected['start']-1:selected['end']]
    content = "".join(content_lines)
    
    if target_path:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Successfully wrote to {target_path}")
    else:
        print("--- Content Begin ---")
        print(content)
        print("--- Content End ---")

if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass # sys.stdout might not support reconfigure in some environments
        
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python parse_matcher.py list")
        print("  python parse_matcher.py view <index_or_path_substring>")
        print("  python parse_matcher.py extract <index_or_path_substring> <target_path>")
    else:
        cmd = sys.argv[1]
        if cmd == 'list':
            list_files()
        elif cmd == 'view' and len(sys.argv) >= 3:
            extract_file(sys.argv[2])
        elif cmd == 'extract' and len(sys.argv) >= 4:
            extract_file(sys.argv[2], sys.argv[3])
        else:
            print("Invalid arguments.")
