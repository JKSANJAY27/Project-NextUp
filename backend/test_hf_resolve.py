import requests
import json

url = "https://dns.google/resolve"
params = {"name": "api-inference.huggingface.co", "type": "A"}

try:
    res = requests.get(url, params=params, timeout=5)
    print(f"Status Code: {res.status_code}")
    data = res.json()
    print("Google DNS response:")
    print(json.dumps(data, indent=2))
    
    ips = [ans["data"] for ans in data.get("Answer", []) if ans.get("type") == 1]
    print(f"Extracted IPs: {ips}")
except Exception as e:
    print(f"Error calling Google DoH: {str(e)}")
