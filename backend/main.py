from datetime import datetime, timezone

from typing import Optional

import json

import os

from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import uuid

from fastapi import FastAPI, Depends, Query, UploadFile, File

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import FileResponse

from fastapi.staticfiles import StaticFiles

from sqlalchemy import inspect, text

from sqlalchemy.orm import Session

import bcrypt



from backend.database import engine, Base, get_db
from backend.auth import create_access_token, get_current_user
from backend.herb_routes import router as herb_router

import backend.models as models

import backend.schemas as schemas



FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)



Base.metadata.create_all(bind=engine)





def _ensure_posts_created_at_column():

    inspector = inspect(engine)

    if "posts" not in inspector.get_table_names():

        return

    column_names = [col["name"] for col in inspector.get_columns("posts")]

    if "created_at" not in column_names:

        with engine.begin() as conn:

            conn.execute(text("ALTER TABLE posts ADD COLUMN created_at DATETIME"))


def _ensure_personal_posts_media_columns():

    inspector = inspect(engine)

    if "personal_posts" not in inspector.get_table_names():

        return

    column_names = [col["name"] for col in inspector.get_columns("personal_posts")]

    if "image_urls" not in column_names:

        with engine.begin() as conn:

            conn.execute(text("ALTER TABLE personal_posts ADD COLUMN image_urls TEXT"))

    if "file_urls" not in column_names:

        with engine.begin() as conn:

            conn.execute(text("ALTER TABLE personal_posts ADD COLUMN file_urls TEXT"))





_ensure_posts_created_at_column()

_ensure_personal_posts_media_columns()





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





def _serialize_comment(comment) -> dict:

    return {

        "id": comment.id,

        "author": comment.author,

        "content": comment.content,

        "created_at": _utc_iso(comment.created_at),

    }





BLOG_OWNER_USERNAME = os.getenv("BLOG_OWNER_USERNAME", "").strip()

if not BLOG_OWNER_USERNAME:
    print("⚠ 警告：未设置 BLOG_OWNER_USERNAME 环境变量，无人拥有博主权限")


def _is_blog_owner(user: Optional[models.UserModel]) -> bool:
    """判断当前登录用户是否为博主"""
    if not BLOG_OWNER_USERNAME or not user:
        return False
    return user.username == BLOG_OWNER_USERNAME


app = FastAPI(title="Blog System API")

# 注册中药识别路由（必须在静态文件挂载之前）
app.include_router(herb_router)



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



    token = create_access_token(user.id)
    return schemas.HttpResponseSchema(
        code=0,
        msg="登录成功",
        data={"token": token, "user_id": user.id, "username": user.username},
    )





@app.get("/api/v1/posts", response_model=schemas.HttpResponseSchema)

def get_all_posts(

    current_user: Optional[models.UserModel] = Depends(get_current_user),

    search: Optional[str] = Query(None, description="搜索文章标题或内容"),

    db: Session = Depends(get_db),

):
    user_id = current_user.id if current_user else None
    query = db.query(models.PostModel).order_by(models.PostModel.id.desc())

    # 搜索功能：对标题和内容做模糊匹配
    if search and (keyword := search.strip()):
        # 转义 LIKE 通配符，防止用户输入的 % 和 _ 被误解析
        safe_keyword = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(
            models.PostModel.title.contains(safe_keyword, escape="\\") |
            models.PostModel.content.contains(safe_keyword, escape="\\")
        )

    raw_posts = query.all()

    serialized_posts = [_serialize_post(db, post, user_id) for post in raw_posts]

    return schemas.HttpResponseSchema(code=0, msg="success", data=serialized_posts)





@app.get("/api/v1/posts/{post_id}", response_model=schemas.HttpResponseSchema)

def get_post_detail(

    post_id: int,

    current_user: Optional[models.UserModel] = Depends(get_current_user),

    db: Session = Depends(get_db),

):
    user_id = current_user.id if current_user else None

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

def delete_post(
    post_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    post_target = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post_target:

        return schemas.HttpResponseSchema(code=404, msg="Post not found", data=None)

    # 权限检查：必须登录
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user

    # 允许删除的条件：博主（可删所有人）或 作者本人
    if not _is_blog_owner(user) and user.username != post_target.author:
        return schemas.HttpResponseSchema(code=403, msg="无权删除他人文章", data=None)

    db.query(models.LikeModel).filter(models.LikeModel.post_id == post_id).delete()

    db.query(models.CommentModel).filter(models.CommentModel.post_id == post_id).delete()

    db.delete(post_target)

    db.commit()

    return schemas.HttpResponseSchema(code=0, msg="Post deleted successfully", data=None)





@app.post("/api/v1/posts/{post_id}/like", response_model=schemas.HttpResponseSchema)

def toggle_post_like(

    post_id: int,

    current_user: Optional[models.UserModel] = Depends(get_current_user),

    db: Session = Depends(get_db),

):

    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)

    existing_like = (

        db.query(models.LikeModel)

        .filter(

            models.LikeModel.post_id == post_id,

            models.LikeModel.user_id == current_user.id,

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

                user_id=current_user.id,

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

    current_user: Optional[models.UserModel] = Depends(get_current_user),

    db: Session = Depends(get_db),

):

    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    post = db.query(models.PostModel).filter(models.PostModel.id == post_id).first()

    if not post:

        return schemas.HttpResponseSchema(code=404, msg="文章不存在", data=None)

    new_comment = models.CommentModel(

        post_id=post_id,

        user_id=current_user.id,

        author=current_user.username,

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





def _parse_json_urls(raw: Optional[str]) -> list:
    """将 JSON 字符串安全解析为列表"""
    if not raw or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _serialize_personal_post(post: models.PersonalPostModel, db: Session, user_id: Optional[int] = None) -> dict:
    like_count = db.query(models.PersonalLikeModel).filter(
        models.PersonalLikeModel.personal_post_id == post.id).count()
    comment_count = db.query(models.PersonalCommentModel).filter(
        models.PersonalCommentModel.personal_post_id == post.id).count()
    liked = False
    if user_id:
        liked = db.query(models.PersonalLikeModel).filter(
            models.PersonalLikeModel.personal_post_id == post.id,
            models.PersonalLikeModel.user_id == user_id,
        ).first() is not None
    return {
        "id": post.id,
        "content": post.content,
        "image_urls": _parse_json_urls(post.image_urls),
        "file_urls": _parse_json_urls(post.file_urls),
        "author": post.author,
        "created_at": _utc_iso(post.created_at),
        "like_count": like_count,
        "comment_count": comment_count,
        "liked": liked,
    }


@app.get("/api/v1/personal", response_model=schemas.HttpResponseSchema)
def get_personal_posts(
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id if current_user else None
    posts = (
        db.query(models.PersonalPostModel)
        .order_by(models.PersonalPostModel.id.desc())
        .all()
    )
    return schemas.HttpResponseSchema(
        code=0,
        msg="success",
        data=[_serialize_personal_post(p, db, user_id) for p in posts],
    )


@app.post("/api/v1/personal", response_model=schemas.HttpResponseSchema)
def create_personal_post(
    payload: schemas.PersonalPostCreateSchema,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user

    if not _is_blog_owner(user):
        return schemas.HttpResponseSchema(code=403, msg="仅博主可发布个人内容", data=None)

    content = payload.content.strip()
    if not content:
        return schemas.HttpResponseSchema(code=400, msg="内容不能为空", data=None)

    image_urls_json = json.dumps(payload.image_urls) if payload.image_urls else None
    file_urls_json = json.dumps(payload.file_urls) if payload.file_urls else None

    new_post = models.PersonalPostModel(
        content=content,
        image_urls=image_urls_json,
        file_urls=file_urls_json,
        author=user.username,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_post)
    db.commit()
    db.refresh(new_post)
    return schemas.HttpResponseSchema(
        code=0,
        msg="发布成功",
        data=_serialize_personal_post(new_post, db, user.id),
    )


@app.delete("/api/v1/personal/{post_id}", response_model=schemas.HttpResponseSchema)
def delete_personal_post(
    post_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user

    if not _is_blog_owner(user):
        return schemas.HttpResponseSchema(code=403, msg="仅博主可删除个人内容", data=None)

    post = db.query(models.PersonalPostModel).filter(models.PersonalPostModel.id == post_id).first()
    if not post:
        return schemas.HttpResponseSchema(code=404, msg="内容不存在", data=None)

    db.delete(post)
    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="删除成功", data=None)


@app.post("/api/v1/personal/{post_id}/like", response_model=schemas.HttpResponseSchema)
def toggle_personal_like(
    post_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = db.query(models.PersonalPostModel).filter(models.PersonalPostModel.id == post_id).first()
    if not post:
        return schemas.HttpResponseSchema(code=404, msg="内容不存在", data=None)
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    existing = db.query(models.PersonalLikeModel).filter(
        models.PersonalLikeModel.personal_post_id == post_id,
        models.PersonalLikeModel.user_id == current_user.id,
    ).first()
    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(models.PersonalLikeModel(
            personal_post_id=post_id,
            user_id=current_user.id,
            created_at=datetime.now(timezone.utc),
        ))
        liked = True
    db.commit()
    like_count = db.query(models.PersonalLikeModel).filter(
        models.PersonalLikeModel.personal_post_id == post_id).count()
    return schemas.HttpResponseSchema(code=0, msg="success", data={"like_count": like_count, "liked": liked})


@app.get("/api/v1/personal/{post_id}/comments", response_model=schemas.HttpResponseSchema)
def get_personal_comments(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.PersonalPostModel).filter(models.PersonalPostModel.id == post_id).first()
    if not post:
        return schemas.HttpResponseSchema(code=404, msg="内容不存在", data=None)
    comments = db.query(models.PersonalCommentModel).filter(
        models.PersonalCommentModel.personal_post_id == post_id
    ).order_by(models.PersonalCommentModel.id.asc()).all()
    return schemas.HttpResponseSchema(code=0, msg="success", data=[_serialize_comment(c) for c in comments])


@app.post("/api/v1/personal/{post_id}/comments", response_model=schemas.HttpResponseSchema)
def create_personal_comment(
    post_id: int,
    payload: schemas.PersonalCommentCreateSchema,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = db.query(models.PersonalPostModel).filter(models.PersonalPostModel.id == post_id).first()
    if not post:
        return schemas.HttpResponseSchema(code=404, msg="内容不存在", data=None)
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user
    comment = models.PersonalCommentModel(
        personal_post_id=post_id,
        user_id=current_user.id,
        author=user.username,
        content=payload.content.strip(),
        created_at=datetime.now(timezone.utc),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return schemas.HttpResponseSchema(code=0, msg="评论成功", data=_serialize_comment(comment))


@app.post("/api/v1/upload", response_model=schemas.HttpResponseSchema)
async def upload_file(
    file: UploadFile = File(...),
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 鉴权
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user
    if not _is_blog_owner(user):
        return schemas.HttpResponseSchema(code=403, msg="仅博主可上传文件", data=None)

    # 校验文件名
    if not file.filename or not file.filename.strip():
        return schemas.HttpResponseSchema(code=400, msg="请选择有效的文件", data=None)

    # 校验文件大小（1000MB）
    MAX_SIZE = 1000 * 1024 * 1024
    try:
        contents = await file.read()
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=f"读取文件失败: {e}", data=None)

    if len(contents) > MAX_SIZE:
        return schemas.HttpResponseSchema(code=400, msg="文件大小超过限制（1000MB）", data=None)

    # 生成存储路径：uploads/YYYYMM/uuid.ext
    try:
        month_dir = datetime.now(timezone.utc).strftime("%Y%m")
        dest_dir = UPLOADS_DIR / month_dir
        dest_dir.mkdir(parents=True, exist_ok=True)

        ext = Path(file.filename).suffix if file.filename else ""
        safe_name = f"{uuid.uuid4().hex}{ext}"
        dest_path = dest_dir / safe_name

        with open(dest_path, "wb") as f:
            f.write(contents)
    except OSError as e:
        return schemas.HttpResponseSchema(code=500, msg=f"文件写入失败（磁盘满或权限不足）: {e}", data=None)
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=f"保存文件失败: {e}", data=None)

    url = f"/uploads/{month_dir}/{safe_name}"
    return schemas.HttpResponseSchema(code=0, msg="上传成功", data={"url": url, "filename": file.filename})


VALID_RESOURCE_CATEGORIES = {"PPT", "课件", "学习笔记", "电子书", "其他"}


def _serialize_resource(resource: models.ResourceModel, db: Session, user_id: Optional[int] = None) -> dict:
    star_count = db.query(models.ResourceStarModel).filter(
        models.ResourceStarModel.resource_id == resource.id).count()
    starred = False
    if user_id:
        starred = db.query(models.ResourceStarModel).filter(
            models.ResourceStarModel.resource_id == resource.id,
            models.ResourceStarModel.user_id == user_id,
        ).first() is not None
    return {
        "id": resource.id,
        "title": resource.title,
        "description": resource.description or "",
        "file_url": resource.file_url,
        "file_name": resource.file_name,
        "category": resource.category,
        "author": resource.author,
        "created_at": _utc_iso(resource.created_at),
        "star_count": star_count,
        "starred": starred,
    }


@app.get("/api/v1/resources", response_model=schemas.HttpResponseSchema)
def get_resources(
    category: Optional[str] = Query(None),
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.id if current_user else None
    query = db.query(models.ResourceModel).order_by(models.ResourceModel.id.desc())
    if category and category.strip():
        query = query.filter(models.ResourceModel.category == category.strip())
    resources = query.all()
    return schemas.HttpResponseSchema(
        code=0,
        msg="success",
        data=[_serialize_resource(r, db, user_id) for r in resources],
    )


@app.post("/api/v1/resources", response_model=schemas.HttpResponseSchema)
def create_resource(
    payload: schemas.ResourceCreateSchema,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user
    if not _is_blog_owner(user):
        return schemas.HttpResponseSchema(code=403, msg="仅博主可上传资源", data=None)

    category = payload.category.strip()
    if category not in VALID_RESOURCE_CATEGORIES:
        return schemas.HttpResponseSchema(code=400, msg=f"无效分类，可选：{', '.join(sorted(VALID_RESOURCE_CATEGORIES))}", data=None)

    resource = models.ResourceModel(
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        file_url=payload.file_url.strip(),
        file_name=payload.file_name.strip(),
        category=category,
        author=user.username,
        created_at=datetime.now(timezone.utc),
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return schemas.HttpResponseSchema(code=0, msg="上传成功", data=_serialize_resource(resource, db, user.id))


@app.delete("/api/v1/resources/{resource_id}", response_model=schemas.HttpResponseSchema)
def delete_resource(
    resource_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    user = current_user
    if not _is_blog_owner(user):
        return schemas.HttpResponseSchema(code=403, msg="仅博主可删除资源", data=None)
    resource = db.query(models.ResourceModel).filter(models.ResourceModel.id == resource_id).first()
    if not resource:
        return schemas.HttpResponseSchema(code=404, msg="资源不存在", data=None)
    db.delete(resource)
    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="删除成功", data=None)


@app.post("/api/v1/resources/{resource_id}/star", response_model=schemas.HttpResponseSchema)
def toggle_resource_star(
    resource_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = db.query(models.ResourceModel).filter(models.ResourceModel.id == resource_id).first()
    if not resource:
        return schemas.HttpResponseSchema(code=404, msg="资源不存在", data=None)
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)
    existing = db.query(models.ResourceStarModel).filter(
        models.ResourceStarModel.resource_id == resource_id,
        models.ResourceStarModel.user_id == current_user.id,
    ).first()
    if existing:
        db.delete(existing)
        starred = False
    else:
        db.add(models.ResourceStarModel(
            resource_id=resource_id,
            user_id=current_user.id,
            created_at=datetime.now(timezone.utc),
        ))
        starred = True
    db.commit()
    star_count = db.query(models.ResourceStarModel).filter(
        models.ResourceStarModel.resource_id == resource_id).count()
    return schemas.HttpResponseSchema(code=0, msg="success", data={"star_count": star_count, "starred": starred})


@app.get("/api/v1/site-config")
def site_config():
    return schemas.HttpResponseSchema(
        code=0,
        msg="success",
        data={"owner_username": BLOG_OWNER_USERNAME or None},
    )


@app.get("/api/v1/health")

def health_check():

    return {"code": 0, "msg": "success", "data": "healthy"}





@app.get("/")

def serve_blog():

    return FileResponse(FRONTEND_DIR / "BLOG.html")


@app.get("/personal")
def serve_personal():
    return FileResponse(FRONTEND_DIR / "personal.html")


@app.get("/library")
def serve_library():
    return FileResponse(FRONTEND_DIR / "library.html")


@app.get("/herb")
def serve_herb():
    return FileResponse(FRONTEND_DIR / "HERB.html")


app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")


