from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
import bcrypt
from backend.database import engine, Base, get_db
import backend.models as models
import backend.schemas as schemas

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frotend"

Base.metadata.create_all(bind=engine)


def _ensure_posts_created_at_column():
    inspector = inspect(engine)
    if "posts" not in inspector.get_table_names():
        return
    column_names = [col["name"] for col in inspector.get_columns("posts")]
    if "created_at" not in column_names:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE posts ADD COLUMN created_at DATETIME"))


_ensure_posts_created_at_column()


def _utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """库里的 naive 时间按 UTC 存，返回带时区的 ISO 供前端正确换算本地时间。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


app = FastAPI(title="Blog System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

import bcrypt


def hash_password(password: str) -> str:    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))

@app.post("/api/v1/auth/register", response_model=schemas.HttpResponseSchema)
def register_user(payload: schemas.UserRegisterSchema, db: Session = Depends(get_db)):
    existing_user = db.query(models.UserModel).filter(
        models.UserModel.username == payload.username
    ).first()

    if existing_user:
        return schemas.HttpResponseSchema(code=10002, msg="用户名已被注册", data=None)

    safe_password_hash = hash_password(payload.password)
    new_user = models.UserModel(
        username=payload.username,
        email=f"{payload.username}@local",
        password_hash=safe_password_hash,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return schemas.HttpResponseSchema(code=0, msg="注册成功", data={"user_id": new_user.id})


@app.post("/api/v1/auth/login", response_model=schemas.HttpResponseSchema)
def login_user(payload: schemas.UserLoginSchema, db: Session = Depends(get_db)):
    # 1. 顺着用户名搜寻用户
    user = db.query(models.UserModel).filter(models.UserModel.username == payload.username).first()
    if not user:
        return schemas.HttpResponseSchema(code=10003, msg="用户不存在", data=None)
        
    # 2. 验证明文密码与数据库哈希密码是否匹配
    is_password_correct = verify_password(payload.password, user.password_hash)
    if not is_password_correct:
        return schemas.HttpResponseSchema(code=10004, msg="密码错误", data=None)
        
    # 3. 验证通过，返回标准的成功响应并附带用户信息
    return schemas.HttpResponseSchema(
        code=0, 
        msg="登录成功", 
        data={"user_id": user.id, "username": user.username}
    )

@app.get("/api/v1/posts", response_model=schemas.HttpResponseSchema)
def get_all_posts(db: Session = Depends(get_db)):
    raw_posts = db.query(models.PostModel).all()
    
    # 手动序列化 ORM 对象，防止 Pydantic 触发 500 转换错误
    serialized_posts = [
        {
            "id": post.id,
            "title": post.title,
            "content": post.content,
            "author": post.author,
            "created_at": _utc_iso(post.created_at),
        } for post in raw_posts
    ]
    return schemas.HttpResponseSchema(code=0, msg="success", data=serialized_posts)

@app.post("/api/v1/posts", response_model=schemas.HttpResponseSchema)
def create_new_post(payload: schemas.PostCreateSchema, db: Session = Depends(get_db)):
    new_post = models.PostModel(
        title=payload.title,
        content=payload.content,
        author=payload.author,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_post)
    db.commit()
    db.refresh(new_post)
    return schemas.HttpResponseSchema(code=0, msg="Post created successfully", data=None)

# 新增：定点删除博文接口
@app.delete("/api/v1/posts/{post_id}", response_model=schemas.HttpResponseSchema)
def delete_post(post_id: int, db: Session = Depends(get_db)):
    post_target = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()
    if not post_target:
        return schemas.HttpResponseSchema(code=404, msg="Post not found", data=None)
        
    db.delete(post_target)
    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="Post deleted successfully", data=None)

@app.get("/api/v1/health")
def health_check():
    return {"code": 0, "msg": "success", "data": "healthy"}


@app.get("/")
def serve_blog():
    return FileResponse(FRONTEND_DIR / "BLOG.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
