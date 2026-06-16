"""
中药图片识别 - 多模型加载与推理
支持：ResNet50 / EfficientNet-B3 / MobileNetV3-Large，懒加载策略
"""
import io
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torchvision import transforms, models
from PIL import Image

MODEL_DIR = Path(__file__).resolve().parent / "herb_model_data"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"  # fallback metrics
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 内置模型指标（从 herb_project 同步）
MODEL_METRICS = {
    "ResNet50":            {"accuracy": 91.67, "precision": 91.80, "recall": 91.67, "f1": 91.49, "roc_auc": 99.73},
    "EfficientNet-B3":    {"accuracy": 93.67, "precision": 93.81, "recall": 93.67, "f1": 93.60, "roc_auc": 99.55},
    "MobileNetV3-Large":  {"accuracy": 94.33, "precision": 94.61, "recall": 94.33, "f1": 94.32, "roc_auc": 99.79},
}

# 模块级懒加载单例
_models_cache = {}
_class_names = None
_transform = None


def _get_transform():
    """图片预处理管线，创建一次后缓存"""
    global _transform
    if _transform is None:
        _transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    return _transform


def get_class_names():
    """读取 20 种中药类别名称"""
    global _class_names
    if _class_names is None:
        with open(MODEL_DIR / "classes.json", "r", encoding="utf-8") as f:
            _class_names = json.load(f)
    return _class_names


def get_available_models():
    """返回可用模型列表及指标"""
    models_list = []
    for name in ["MobileNetV3-Large", "EfficientNet-B3", "ResNet50"]:
        model_path = MODEL_DIR / f"{name}.pth"
        metrics = MODEL_METRICS.get(name, {})
        models_list.append({
            "name": name,
            "available": model_path.exists(),
            "file_size_mb": round(model_path.stat().st_size / 1024 / 1024, 1) if model_path.exists() else 0,
            "metrics": {k: round(v, 2) for k, v in metrics.items()},
        })
    return models_list


def _build_model_architecture(name: str, num_classes: int):
    """为指定模型构建正确的分类头架构"""
    if name == "ResNet50":
        model = models.resnet50(weights=None)
        model.fc = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(2048, num_classes),
        )
    elif name == "EfficientNet-B3":
        model = models.efficientnet_b3(weights=None)
        model.classifier[1] = nn.Linear(1536, num_classes)
    elif name == "MobileNetV3-Large":
        model = models.mobilenet_v3_large(weights=None)
        model.classifier[3] = nn.Linear(1280, num_classes)
    else:
        raise ValueError(f"不支持的模型: {name}，可选: ResNet50, EfficientNet-B3, MobileNetV3-Large")
    return model


def load_model(name: str = "MobileNetV3-Large"):
    """加载指定模型并缓存"""
    if name in _models_cache:
        return _models_cache[name]

    class_names = get_class_names()
    num_classes = len(class_names)

    model = _build_model_architecture(name, num_classes)

    model_path = MODEL_DIR / f"{name}.pth"
    if not model_path.exists():
        raise FileNotFoundError(f"模型文件不存在: {model_path}")

    state = torch.load(model_path, map_location=DEVICE)
    model.load_state_dict(state, strict=False)
    model.to(DEVICE)
    model.eval()

    _models_cache[name] = model
    return model


def predict(image_bytes: bytes, model_name: str = "MobileNetV3-Large") -> dict:
    """
    对单张图片进行中药识别

    Args:
        image_bytes: 图片文件的原始字节数据
        model_name: 模型名称 (ResNet50 / EfficientNet-B3 / MobileNetV3-Large)

    Returns:
        dict: {
            "prediction": "枸杞",
            "confidence": 94.3,
            "model_used": "MobileNetV3-Large",
            "top3": [
                {"rank": 1, "class": "枸杞", "confidence": 94.3},
                ...
            ]
        }
    """
    model = load_model(model_name)
    transform = _get_transform()
    class_names = get_class_names()

    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise ValueError("无法解析图片，请确认文件为有效图片格式")

    x = transform(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(x)
        probs = torch.softmax(logits, dim=1).squeeze().cpu().numpy()

    # Top-3（带排名）
    top3_idx = np.argsort(probs)[::-1][:3]
    top3 = [
        {
            "rank": i + 1,
            "class": class_names[idx],
            "confidence": round(float(probs[idx]) * 100, 1),
        }
        for i, idx in enumerate(top3_idx)
    ]

    return {
        "prediction": class_names[top3_idx[0]],
        "confidence": round(float(probs[top3_idx[0]]) * 100, 1),
        "model_used": model_name,
        "top3": top3,
    }
