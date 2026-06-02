from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.database import engine, Base, get_db
import backend.models as models
import backend.schemas as schemas

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Blog System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

@app.post("/api/v1/auth/register", response_model=schemas.HttpResponseSchema)
def register_user(payload: schemas.UserRegisterSchema, db: Session = Depends(get_db)):
    existing_user = db.query(models.UserModel).filter(
        (models.UserModel.username == payload.username) | 
        (models.UserModel.email == payload.email)
    ).first()
    
    if existing_user:
        return schemas.HttpResponseSchema(code=10002, msg="Username or email already registered", data=None)
    
    safe_password_hash = pwd_context.hash(payload.password)
    new_user = models.UserModel(
        username=payload.username,
        email=payload.email,
        password_hash=safe_password_hash
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return schemas.HttpResponseSchema(code=0, msg="Registration successful", data={"user_id": new_user.id})

@app.get("/api/v1/posts", response_model=schemas.HttpResponseSchema)
def get_all_posts(db: Session = Depends(get_db)):
    raw_posts = db.query(models.PostModel).all()
    
    # 手动序列化 ORM 对象，防止 Pydantic 触发 500 转换错误
    serialized_posts = [
        {
            "id": post.id,
            "title": post.title,
            "content": post.content,
            "author": post.author
        } for post in raw_posts
    ]
    return schemas.HttpResponseSchema(code=0, msg="success", data=serialized_posts)

@app.post("/api/v1/posts", response_model=schemas.HttpResponseSchema)
def create_new_post(payload: schemas.PostCreateSchema, db: Session = Depends(get_db)):
    new_post = models.PostModel(
        title=payload.title,
        content=payload.content,
        author=payload.author
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