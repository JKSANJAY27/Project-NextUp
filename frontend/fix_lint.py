import os
import re

path = r"d:\NextupAI\Project-NextUp\frontend\app\dashboard\page.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Remove 'Pin' from lucide-react import
content = re.sub(r'\bPin,\s*', '', content)

# Remove KANBAN_COLUMNS definition
content = re.sub(r'const KANBAN_COLUMNS = \[\s*\{ id: "Applied"[\s\S]*?\];', '', content)

# Remove draggedOverColumn state
content = re.sub(r'const \[draggedOverColumn, setDraggedOverColumn\] = useState<string \| null>\(null\);\s*', '', content)

# Remove focusMode state
content = re.sub(r'const \[focusMode, setFocusMode\] = useState\(false\);\s*', '', content)

# Remove drag and drop handlers
content = re.sub(r'const handleDragStart = [\s\S]*?};\s*(?=const handleDragOver)', '', content)
content = re.sub(r'const handleDragOver = [\s\S]*?};\s*(?=const handleDragLeave)', '', content)
content = re.sub(r'const handleDragLeave = [\s\S]*?};\s*(?=const handleDrop)', '', content)
content = re.sub(r'const handleDrop = [\s\S]*?};\s*', '', content)

# Try to remove unused app variable inside dashboard/page.tsx if present
content = re.sub(r'const app = applications\[c\.id\];\s*', '', content)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Fix tracking/page.tsx
tracking_path = r"d:\NextupAI\Project-NextUp\frontend\app\tracking\page.tsx"
with open(tracking_path, "r", encoding="utf-8") as f:
    tracking_content = f.read()

tracking_content = tracking_content.replace("(resApps.data || []).forEach((record: Record<string, unknown>) => {", "(resApps.data || []).forEach((record: Application) => {")
# Just in case we didn't apply the first time properly or it was partially reverted
tracking_content = tracking_content.replace("(resApps.data || []).forEach((record: any) => {", "(resApps.data || []).forEach((record: Application) => {")

with open(tracking_path, "w", encoding="utf-8") as f:
    f.write(tracking_content)

print("Fixed")
