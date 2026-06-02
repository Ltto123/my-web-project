from datetime import datetime, timezone

from pathlib import Path

from typing import Optional



from fastapi import FastAPI, Depends, Query

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

    if dt is None:

        return None

    if dt.tzinfo is None:

        dt = dt.replace(tzinfo=timezone.utc)

    return dt.isoformat()





def hash_password(password: str) -> str:

    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")





def verify_password(password: str, password_hash: str) -> bool:

    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))





def _get_like_count(db: Session, post_id: int) -> int:

    return db.query(models.LikeModel).filter(models.LikeModel.post_id == post_id).count()





def _get_comment_count(db: Session, post_id: int) -> int:

    return db.query(models.CommentModel).filter(models.CommentModel.post_id == post_id).count()





def _user_liked_post(db: Session, post_id: int, user_id: Optional[int]) -> bool:

    if not user_id:

        return False

    return (

        db.query(models.LikeModel)

        .filter(

            models.LikeModel.post_id == post_id,

            models.LikeModel.user_id == user_id,

        )

        .first()

        is not None

    )





def _serialize_post(db: Session, post: models.PostModel, user_id: Optional[int] = None) -> dict:

    like_count = _get_like_count(db, post.id)

    return {

        "id": post.id,

        "title": post.title,

        "content": post.content,

        "author": post.author,

        "created_at": _utc_iso(post.created_at),

        "like_count": like_count,

        "comment_count": _get_comment_count(db, post.id),

        "liked": _user_liked_post(db, post.id, user_id),

        "is_hot": like_count >= 1,

    }





def _serialize_comment(comment: models.CommentModel) -> dict:

    return {

        "id": comment.id,

        "author": comment.author,

        "content": comment.content,

        "created_at": _utc_iso(comment.created_at),

    }





app = FastAPI(title="Blog System API")



app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],

)





@app.post("/api/v1/auth/register", response_model=schemas.HttpResponseSchema)

def register_user(payload: schemas.UserRegisterSchema, db: Session = Depends(get_db)):

    existing_user = db.query(models.UserModel).filter(

        models.UserModel.username == payload.username

    ).first()



    if existing_user:

        return schemas.HttpResponseSchema(code=10002, msg="用户名已被注册", data=None)



    new_user = models.UserModel(

        username=payload.username,

        email=f"{payload.username}@local",

        password_hash=hash_password(payload.password),

    )

    db.add(new_user)

    db.commit()

    db.refresh(new_user)

    return schemas.HttpResponseSchema(code=0, msg="注册成功", data={"user_id": new_user.id})





@app.post("/api/v1/auth/login", response_model=schemas.HttpResponseSchema)

def login_user(payload: schemas.UserLoginSchema, db: Session = Depends(get_db)):

    user = db.query(models.UserModel).filter(models.UserModel.username == payload.username).first()

    if not user:

        return schemas.HttpResponseSchema(code=10003, msg="用户不存在", data=None)



    if not verify_password(payload.password, user.password_hash):

        return schemas.HttpResponseSchema(code=10004, msg="密码错误", data=None)



    return schemas.HttpResponseSchema(

        code=0,

        msg="登录成功",

        data={"user_id": user.id, "username": user.username},

    )





@app.get("/api/v1/posts", response_model=schemas.HttpResponseSchema)

def get_all_posts(

    user_id: Optional[int] = Query(None),

    db: Session = Depends(get_db),

):

    raw_posts = db.query(models.PostModel).order_by(models.PostModel.id.desc()).all()

    serialized_posts = [_serialize_post(db, post, user_id) for post in raw_posts]

    return schemas.HttpResponseSchema(code=0, msg="success", data=serialized_posts)





@app.get("/api/v1/posts/{post_id}", response_model=schemas.HttpResponseSchema)

def get_post_detail(

    post_id: int,

    user_id: Optional[int] = Query(None),

    db: Session = Depends(get_db),

):

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)

    return schemas.HttpResponseSchema(code=0, msg="success", data=_serialize_post(db, post, user_id))





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





@app.delete("/api/v1/posts/{post_id}", response_model=schemas.HttpResponseSchema)

def delete_post(post_id: int, db: Session = Depends(get_db)):

    post_target = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post_target:

        return schemas.HttpResponseSchema(code=404, msg="Post not found", data=None)



    db.query(models.LikeModel).filter(models.LikeModel.post_id == post_id).delete()

    db.query(models.CommentModel).filter(models.CommentModel.post_id == post_id).delete()

    db.delete(post_target)

    db.commit()

    return schemas.HttpResponseSchema(code=0, msg="Post deleted successfully", data=None)





@app.post("/api/v1/posts/{post_id}/like", response_model=schemas.HttpResponseSchema)

def toggle_post_like(

    post_id: int,

    payload: schemas.LikeToggleSchema,

    db: Session = Depends(get_db),

):

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)



    user = db.query(models.UserModel).filter(models.UserModel.id == payload.user_id).first()

    if not user:

        return schemas.HttpResponseSchema(code=10005, msg="用户不存在", data=None)



    existing_like = (

        db.query(models.LikeModel)

        .filter(

            models.LikeModel.post_id == post_id,

            models.LikeModel.user_id == payload.user_id,

        )

        .first()

    )



    if existing_like:

        db.delete(existing_like)

        liked = False

    else:

        db.add(

            models.LikeModel(

                post_id=post_id,

                user_id=payload.user_id,

                created_at=datetime.now(timezone.utc),

            )

        )

        liked = True



    db.commit()

    like_count = _get_like_count(db, post_id)

    return schemas.HttpResponseSchema(

        code=0,

        msg="success",

        data={"like_count": like_count, "liked": liked, "is_hot": like_count >= 6},

    )





@app.get("/api/v1/posts/{post_id}/comments", response_model=schemas.HttpResponseSchema)

def get_post_comments(post_id: int, db: Session = Depends(get_db)):

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)



    comments = (

        db.query(models.CommentModel)

        .filter(models.CommentModel.post_id == post_id)

        .order_by(models.CommentModel.id.asc())

        .all()

    )

    return schemas.HttpResponseSchema(

        code=0,

        msg="success",

        data=[_serialize_comment(comment) for comment in comments],

    )





@app.post("/api/v1/posts/{post_id}/comments", response_model=schemas.HttpResponseSchema)

def create_post_comment(

    post_id: int,

    payload: schemas.CommentCreateSchema,

    db: Session = Depends(get_db),

):

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)



    user = db.query(models.UserModel).filter(models.UserModel.id == payload.user_id).first()

    if not user:

        return schemas.HttpResponseSchema(code=10005, msg="用户不存在", data=None)



    new_comment = models.CommentModel(

        post_id=post_id,

        user_id=payload.user_id,

        author=user.username,

        content=payload.content.strip(),

        created_at=datetime.now(timezone.utc),

    )

    db.add(new_comment)

    db.commit()

    db.refresh(new_comment)

    return schemas.HttpResponseSchema(

        code=0,

        msg="评论成功",

        data=_serialize_comment(new_comment),

    )





@app.get("/api/v1/health")

def health_check():

    return {"code": 0, "msg": "success", "data": "healthy"}





@app.get("/")

def serve_blog():

    return FileResponse(FRONTEND_DIR / "BLOG.html")





app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")


