from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# 1. 焊死本地 SQLite 数据库文件的落盘名称
SQLALCHEMY_DATABASE_URL = "sqlite:///./blog.db"

# 2. 铺设底层连接池引擎 (Engine)，增加 SQLite 专属的多线程并发访问安全补丁
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# 3. 实例化会话工厂 (SessionLocal)，它是未来源源不断生产“数据管家”的模具
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. 声明所有 ORM 数据表模型类的始祖基类 (Base)
# 🌟 2.0 时代新写法：直接从 sqlalchemy.orm 中解构出来，警告瞬间全消
Base = declarative_base()

# 5. 数据会话依赖注入函数
# 🌟 显式声明返回类型为 Generator[Session, None, None]，让代码补全爽到飞起
def get_db():
    db: Session = SessionLocal()  # 🌟 强行告诉 Cursor，这个 db 就是真实的数据库 Session
    try:
        yield db
    finally:
        db.close()