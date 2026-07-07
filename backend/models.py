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


# ── 不背单词 Vocab Models ──


class VocabSetModel(Base):
    __tablename__ = "vocab_sets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    word_count = Column(Integer, default=0)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)


class VocabWordModel(Base):
    __tablename__ = "vocab_words"

    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(Integer, ForeignKey("vocab_sets.id", ondelete="CASCADE"), nullable=False, index=True)
    word = Column(String(100), nullable=False)
    pos = Column(String(30), nullable=True)
    def_en = Column(Text, nullable=True)
    def_zh = Column(Text, nullable=True)
    example_en = Column(Text, nullable=True)
    example_zh = Column(Text, nullable=True)
    is_phrase = Column(Integer, default=0)  # 0=word, 1=phrase
    sort_order = Column(Integer, default=0)


class VocabProgressModel(Base):
    __tablename__ = "vocab_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    word_id = Column(Integer, ForeignKey("vocab_words.id", ondelete="CASCADE"), nullable=False, index=True)
    stage = Column(Integer, default=0)  # 0=needs review, 1=mastered
    correct_count = Column(Integer, default=0)
    wrong_count = Column(Integer, default=0)
    spelling_passed = Column(Integer, default=0)  # 0/1
    last_reviewed = Column(Integer, default=0)  # unix timestamp ms

    __table_args__ = (UniqueConstraint("user_id", "word_id", name="uq_user_word_progress"),)
