#!/usr/bin/env python3
"""
生成 Cube API 的 JWT Token，用于 Postman 等调试。
运行后复制输出的 token 到 Postman Authorization → Bearer Token。
"""
import time
import jwt

API_SECRET = "032dcfacaccab8449281b8c6351ec58844c1179630392a34d2adc40aa420b061"
TTL_SECONDS = 3600

payload = {
    "iat": int(time.time()),
    "exp": int(time.time()) + TTL_SECONDS,
}
token = jwt.encode(payload, API_SECRET, algorithm="HS256")
if isinstance(token, bytes):
    token = token.decode("utf-8")

print("复制下面整行到 Postman → Authorization → Bearer Token：\n")
print(token)
print(f"\n有效期 {TTL_SECONDS} 秒，过期后重新运行此脚本。")
