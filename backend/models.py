from datetime import datetime, timezone

from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# ── 数据库连接 ──
SQLALCHEMY_DATABASE_URL = "sqlite:///./blog.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI 依赖注入：每个请求获取一个数据库会话"""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── ORM 模型 ──


class UserModel(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)


class PostModel(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    content = Column(Text, nullable=False)
    author = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class LikeModel(Base):
    __tablename__ = "likes"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)

    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_user_like"),)


class CommentModel(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class PersonalPostModel(Base):
    __tablename__ = "personal_posts"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    image_urls = Column(Text, nullable=True)
    file_urls = Column(Text, nullable=True)
    author = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class ResourceModel(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    file_url = Column(Text, nullable=False)
    file_name = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False)
    author = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class PersonalLikeModel(Base):
    __tablename__ = "personal_likes"

    id = Column(Integer, primary_key=True, index=True)
    personal_post_id = Column(Integer, ForeignKey("personal_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)

    __table_args__ = (UniqueConstraint("personal_post_id", "user_id", name="uq_personal_post_user_like"),)


class PersonalCommentModel(Base):
    __tablename__ = "personal_comments"

    id = Column(Integer, primary_key=True, index=True)
    personal_post_id = Column(Integer, ForeignKey("personal_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class ResourceStarModel(Base):
    __tablename__ = "resource_stars"

    id = Column(Integer, primary_key=True, index=True)
    resource_id = Column(Integer, ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)

    __table_args__ = (UniqueConstraint("resource_id", "user_id", name="uq_resource_user_star"),)
