import requests
from datetime import datetime

url = "https://www.baidu.com"
print(f"Time: {datetime.now().isoformat()}")

resp = requests.get(url, timeout=10)
print(f"Status: {resp.status_code}, Time: {resp.elapsed.total_seconds():.3f}s")
print("Done.")
