"""
JWT 鉴权模块：签发 token、验证 token、依赖注入获取当前用户
"""
import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from fastapi import Depends, Header
from sqlalchemy.orm import Session
from typing import Optional

from backend.database import get_db
from backend import models

# 密钥：生产环境通过环境变量设置，开发环境用默认值
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "blog-dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


def create_access_token(user_id: int) -> str:
    """
    登录成功后调用，签发 JWT token。
    token 里装了 user_id 和过期时间，用密钥签名防篡改。
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),  # sub = subject，标准 JWT 字段
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    """
    验证 token 签名和过期时间，返回 user_id。
    如果 token 无效或过期，返回 None。
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", 0))
        return user_id if user_id > 0 else None
    except JWTError:
        return None


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[models.UserModel]:
    """
    FastAPI 依赖注入函数。
    从请求头 Authorization: Bearer <token> 中解析出当前用户。
    如果没有带 token 或 token 无效，返回 None（允许匿名访问）。
    """
    if not authorization:
        return None

    # 格式："Bearer eyJhbGciOi..."
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token = parts[1]
    user_id = decode_access_token(token)
    if user_id is None:
        return None

    return db.query(models.UserModel).filter(models.UserModel.id == user_id).first()
