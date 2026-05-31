from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 1. 实例化后端的最高指挥官 app 对象
app = FastAPI(title="个人博客系统后台-毛坯版")

# 2. 配置跨域安全中间件 (CORS)
# 底层的道理：浏览器非常严格，默认不允许本地的 HTML 网页直接用 fetch 访问 Python 端口。
# 我们必须在这里开辟无障碍海关通道，允许前端跨域访问，否则前端 fetch 时会直接报 CORS 拦截错误！
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # 允许所有前端域名访问
    allow_credentials=True,
    allow_methods=["*"],       # 允许 GET, POST 等所有 HTTP 动词
    allow_headers=["*"],       # 允许请求携带任何 Headers 头
)

# 3. 编写第一个测试毛坯路由（GET 动词）
@app.get("/api/v1/health")
def health_check():
    # 🌟 严格对齐内训规范的统一响应结构：code, msg, data 
    return {
        "code": 0,
        "msg": "success",
        "data": "轰鸣成功！后端的毛坯大本营已经顺利在网络大门口站岗！"
    }
