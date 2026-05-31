from sqlalchemy import Column, Integer, String, Text
from backend.database import Base  # 🌟 引入刚刚洗干净的始祖基类

# 1. 声明用户数据表模型（DAO 层实体）
class UserModel(Base):
    __tablename__ = "users"  # 焊死在 SQLite 硬盘里的真实表名

    id = Column(Integer, primary_key=True, index=True)  # 主键身份证，自动递增且建立极速索引
    username = Column(String(50), unique=True, nullable=False, index=True)  # 用户名唯一，建立索引加速登录查询
    email = Column(String(100), unique=True, nullable=False, index=True)  # 邮箱唯一，海关严查
    password_hash = Column(String(255), nullable=False)  # 绝对不存明文！专门存放加盐打散后的安全乱码


# 2. 声明博客文章数据表模型（DAO 层实体）
class PostModel(Base):
    __tablename__ = "posts"  # 焊死在 SQLite 硬盘里的真实表名

    id = Column(Integer, primary_key=True, index=True)  # 文章唯一数字身份证
    title = Column(String(150), nullable=False)  # 文章标题，最大 150 字
    content = Column(Text, nullable=False)  # 文章正文，Text 代表超长文本列
    author = Column(String(50), nullable=False)  # 作者署名，直接对应你前端的 "张三"、"李四" 文本