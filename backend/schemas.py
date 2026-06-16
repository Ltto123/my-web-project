from pydantic import BaseModel, Field
from typing import Any, List, Optional


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


class CommentCreateSchema(BaseModel):
    content: str = Field(..., min_length=1, max_length=500, description="评论内容")


class PersonalPostCreateSchema(BaseModel):
    content: str = Field(..., min_length=1, description="个人内容正文")
    image_urls: Optional[List[str]] = Field(None, description="图片 URL 列表")
    file_urls: Optional[List[str]] = Field(None, description="文件 URL 列表")


class ResourceCreateSchema(BaseModel):
    title: str = Field(..., min_length=1, max_length=150, description="资源标题")
    description: Optional[str] = Field(None, description="资源描述")
    category: str = Field(..., description="分类")
    file_url: str = Field(..., description="文件 URL")
    file_name: str = Field(..., description="文件名")


class PersonalCommentCreateSchema(BaseModel):
    content: str = Field(..., min_length=1, max_length=500, description="评论内容")


class StarToggleSchema(BaseModel):
    pass  # 保留占位，兼容其他可能的引用
