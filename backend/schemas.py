from pydantic import BaseModel, Field
from typing import Any, Optional


class HttpResponseSchema(BaseModel):
    code: int
    msg: str
    data: Optional[Any] = None


class UserRegisterSchema(BaseModel):
    username: str = Field(..., min_length=3, max_length=20, description="用户名")
    password: str = Field(..., min_length=6, description="明文密码")


class UserLoginSchema(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="明文密码")


class PostCreateSchema(BaseModel):
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章正文")
    author: str = Field(..., description="作者署名")


class LikeToggleSchema(BaseModel):
    user_id: int = Field(..., description="当前登录用户 ID")


class CommentCreateSchema(BaseModel):
    user_id: int = Field(..., description="当前登录用户 ID")
    content: str = Field(..., min_length=1, max_length=500, description="评论内容")
