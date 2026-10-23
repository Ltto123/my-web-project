from pydantic import BaseModel, Field, field_validator
from typing import Any, List, Optional


class HttpResponseSchema(BaseModel):
    code: int
    msg: str
    data: Optional[Any] = None


class PasswordInputSchema(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def validate_password_bytes(cls, value: str) -> str:
        # bcrypt 的上限按 UTF-8 字节计算，中文密码也必须在这里检查。
        if len(value.encode("utf-8")) > 72:
            raise ValueError("密码的 UTF-8 长度不能超过 72 字节")
        return value


class UserRegisterSchema(PasswordInputSchema):
    username: str = Field(..., min_length=3, max_length=20, description="用户名")
    password: str = Field(..., min_length=6, description="明文密码")


class UserLoginSchema(PasswordInputSchema):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="明文密码")


class PostCreateSchema(BaseModel):
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章正文")
    author: Optional[str] = Field(None, description="兼容旧客户端，服务端以登录用户为作者")


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


# ── 不背单词 Vocab Schemas ──


class VocabWordOut(BaseModel):
    id: int
    word: str
    pos: Optional[str] = None
    def_en: Optional[str] = None
    def_zh: Optional[str] = None
    example_en: Optional[str] = None
    example_zh: Optional[str] = None
    is_phrase: int = 0
    sort_order: int = 0


class VocabSetOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    word_count: int = 0
    user_id: Optional[int] = None
    created_at: Optional[str] = None


class VocabSetDetailOut(VocabSetOut):
    words: List[VocabWordOut] = []


class VocabProgressOut(BaseModel):
    word_id: int
    stage: int = 0
    correct_count: int = 0
    wrong_count: int = 0
    spelling_passed: int = 0


class VocabProgressUpdate(BaseModel):
    word_id: int = Field(..., gt=0)
    stage: int = Field(0, ge=0, le=1)
    correct_count: int = Field(0, ge=0, le=2147483647)
    wrong_count: int = Field(0, ge=0, le=2147483647)


class VocabSpellUpdate(BaseModel):
    word_id: int = Field(..., gt=0)
