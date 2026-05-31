from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 🌟 核心高光动作：引入数据库引擎和蓝图花名册
from backend.database import engine, Base
import backend.models as models

# 🌟 轰鸣运转：让 ORM 检查硬盘。如果发现 blog.db 里没有对应的表，当场自动建表！
Base.metadata.create_all(bind=engine)

# 1. 实例化后端的最高指挥官 app 对象
app = FastAPI(title="个人博客系统后台-精装版")

# 2. 配置跨域安全中间件 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. 编写第一个测试毛坯路由（GET 动词）
@app.get("/api/v1/health")
def health_check():
    return {
        "code": 0,
        "msg": "success",
        "data": "数据库自动建表完成！后端的毛坯大本营已经顺利在网络大门口站岗！"
    }