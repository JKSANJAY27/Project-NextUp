import requests
import json

url = "https://1.1.1.1/dns-query"
headers = {"accept": "application/dns-json"}
params = {"name": "api-inference.huggingface.co", "type": "A"}

try:
    res = requests.get(url, headers=headers, params=params, timeout=5)
    print(f"Status Code: {res.status_code}")
    data = res.json()
    print("Cloudflare DNS response:")
    print(json.dumps(data, indent=2))
    
    ips = [ans["data"] for ans in data.get("Answer", []) if ans.get("type") == 1]
    print(f"Extracted IPs: {ips}")
except Exception as e:
    print(f"Error calling Cloudflare DoH: {str(e)}")
