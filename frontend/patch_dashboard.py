import os

path = r"d:\NextupAI\Project-NextUp\frontend\app\dashboard\page.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Insert redirect
import_react = 'const activeTab = searchParams.get("tab") || "action-center";'
redirect_code = """const activeTab = searchParams.get("tab") || "action-center";

  useEffect(() => {
    if (activeTab === "tracking") {
      router.replace("/tracking");
    }
  }, [activeTab, router]);"""

if redirect_code not in content:
    content = content.replace(import_react, redirect_code, 1)

# 2. Delete ACTIVE TRACKING TAB
start_marker = "{/* ==================== 3. ACTIVE TRACKING TAB ==================== */}"
end_marker = "{/* ==================== 4. MY APPLICATIONS TAB ==================== */}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + content[end_idx:]

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patched successfully")
