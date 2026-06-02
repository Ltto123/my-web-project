from pydantic import BaseModel, Field, EmailStr
from typing import Any, Optional

# ==========================================================================
# 1. 工业级规范：统一响应结构 DTO
# ==========================================================================
class HttpResponseSchema(BaseModel):
    code: int           # 业务状态码：0代表成功，非0代表业务失败
    msg: str            # 给前端弹窗用的文字信息
    data: Optional[Any] = None  # 核心业务货品（若失败则为 null）

# ==========================================================================
# 2. 入关验证 DTO：规范用户点击“注册”时，前端必须快递过来什么数据
# ==========================================================================
class UserRegisterSchema(BaseModel):
    username: str = Field(..., min_length=3, max_length=20, description="用户名")
    email: EmailStr = Field(..., description="注册邮箱")
    password: str = Field(..., min_length=6, description="明文密码")

# ==========================================================================
# 3. 入关验证 DTO：规范前端点击“立即发布文章”时，必须快递过来什么
# ==========================================================================
class PostCreateSchema(BaseModel):
    title: str = Field(..., description="文章标题")
    content: str = Field(..., description="文章正文")
    author: str = Field(..., description="作者署名")