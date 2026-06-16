"""
中药识别 API 路由
"""
from fastapi import APIRouter, UploadFile, File, Form, Depends
from typing import Optional

from backend.auth import get_current_user
from backend.herb_model import predict, get_class_names, get_available_models
import backend.models as models
import backend.schemas as schemas

router = APIRouter(prefix="/api/v1/herb", tags=["herb"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
VALID_MODELS = {"ResNet50", "EfficientNet-B3", "MobileNetV3-Large"}


@router.post("/predict", response_model=schemas.HttpResponseSchema)
async def predict_herb(
    file: UploadFile = File(...),
    model: str = Form("MobileNetV3-Large"),
    current_user: Optional[models.UserModel] = Depends(get_current_user),
):
    """上传中药图片进行识别（无需登录），可选择模型"""
    # 校验模型名称
    if model not in VALID_MODELS:
        return schemas.HttpResponseSchema(
            code=400,
            msg=f"无效的模型名称，可选: {', '.join(sorted(VALID_MODELS))}",
            data=None,
        )

    # 校验文件是否为空
    contents = await file.read()
    if not contents:
        return schemas.HttpResponseSchema(code=400, msg="请上传图片文件", data=None)

    # 校验文件大小
    if len(contents) > MAX_FILE_SIZE:
        return schemas.HttpResponseSchema(code=400, msg="图片大小不能超过 10MB", data=None)

    # 校验是否为图片格式
    if file.content_type and not file.content_type.startswith("image/"):
        return schemas.HttpResponseSchema(code=400, msg="请上传有效的图片文件", data=None)

    # 调用模型推理
    try:
        result = predict(contents, model_name=model)
    except ValueError as e:
        return schemas.HttpResponseSchema(code=400, msg=str(e), data=None)
    except FileNotFoundError as e:
        return schemas.HttpResponseSchema(code=500, msg=f"模型加载失败: {e}", data=None)
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=f"识别失败: {e}", data=None)

    return schemas.HttpResponseSchema(code=0, msg="识别成功", data=result)


@router.get("/models", response_model=schemas.HttpResponseSchema)
def list_models():
    """获取可用模型列表及其性能指标"""
    try:
        models_info = get_available_models()
        return schemas.HttpResponseSchema(code=0, msg="success", data=models_info)
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=str(e), data=None)


@router.get("/classes", response_model=schemas.HttpResponseSchema)
def get_herb_classes():
    """获取支持识别的中药种类列表"""
    try:
        classes = get_class_names()
        return schemas.HttpResponseSchema(code=0, msg="success", data=classes)
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=str(e), data=None)
