# CLAUDE.md — 个人博客系统

## 项目概述

这是 **Ltto 的个人博客**，一个全栈 Web 应用。包含博客文章、个人主页、资源库、中药识别四大模块。

- **博主**: Ltto123（通过 `.env` 的 `BLOG_OWNER_USERNAME` 配置）
- **数据库**: SQLite（`blog.db`，项目根目录）
- **Python**: 3.14

---

## 技术栈

| 层 | 技术 |
|---|------|
| 后端框架 | FastAPI 0.136 |
| ORM | SQLAlchemy 2.0 |
| 鉴权 | JWT（python-jose + HS256） |
| 密码加密 | bcrypt |
| 数据库 | SQLite（单文件 `blog.db`） |
| 前端 | 原生 HTML/CSS/JS（无框架） |
| 前端库 | KaTeX（数学公式）、marked.js（Markdown 渲染） |
| AI 模型 | PyTorch + torchvision（中药识别，ResNet50/EfficientNet-B3/MobileNetV3-Large） |
| 容器化 | Docker + docker-compose |

---

## 项目结构

```
/
├── backend/
│   ├── main.py          # FastAPI 主入口，所有 API 路由
│   ├── models.py        # SQLAlchemy ORM 模型（10 张表）
│   ├── schemas.py       # Pydantic 请求/响应 Schema
│   ├── database.py      # 数据库引擎 & Session 依赖注入
│   ├── auth.py          # JWT 签发、验证、get_current_user 依赖
│   ├── herb_routes.py   # 中药识别 API 路由
│   ├── herb_model.py    # 中药识别 PyTorch 模型推理
│   └── herb_model_data/ # 训练好的模型权重文件
├── frontend/
│   ├── BLOG.html        # 博客首页
│   ├── personal.html    # 个人主页
│   ├── library.html     # 资源库
│   ├── HERB.html        # 中药识别页
│   ├── common.js        # 公共 JS（鉴权、API 请求封装）
│   ├── main.js          # 博客页 JS
│   ├── personal.js      # 个人主页 JS
│   ├── library.js       # 资源库 JS
│   ├── herb.js          # 中药识别页 JS
│   ├── style.css        # 全局样式（CSS 变量化）
│   └── favicon.svg      # 网站图标
├── uploads/             # 用户上传文件（按 YYYYMM 分目录）
├── blog.db              # SQLite 数据库文件
├── .env                 # 环境变量（BLOG_OWNER_USERNAME）
├── Dockerfile           # 生产环境镜像
├── docker-compose.yml   # 一键部署
├── deploy.py            # 部署脚本（Fabric）
├── requirements.txt     # Python 依赖
└── openspec/            # OpenSpec 规范文档
```

---

## 数据库表结构（10 张表）

| 表名 | 模型类 | 用途 |
|------|--------|------|
| `users` | UserModel | 用户账号 |
| `posts` | PostModel | 博客文章 |
| `likes` | LikeModel | 文章点赞（post_id + user_id 唯一） |
| `comments` | CommentModel | 文章评论 |
| `personal_posts` | PersonalPostModel | 个人主页动态（含 image_urls/file_urls JSON） |
| `personal_likes` | PersonalLikeModel | 个人动态点赞 |
| `personal_comments` | PersonalCommentModel | 个人动态评论 |
| `resources` | ResourceModel | 资源库文件 |
| `resource_stars` | ResourceStarModel | 资源收藏 |
| `herb_records` | （herb_routes 中） | 中药识别记录 |

---

## 启动方式

### 本地开发

```bash
# 1. 激活虚拟环境
source .venv/Scripts/activate   # Windows Git Bash
# 或 .venv\Scripts\activate     # Windows CMD

# 2. 启动服务器
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Docker 部署

```bash
docker-compose up -d
```

### 发布

```powershell
.\publish.ps1
```

---

## API 规范

- **前缀**: `/api/v1/`
- **统一响应格式**:
  ```json
  { "code": 0, "msg": "success", "data": ... }
  ```
  - `code=0` 成功，其他为错误码
- **鉴权**: `Authorization: Bearer <token>` Header
- **匿名访问**: 不带 token 时可以浏览，但点赞/评论/上传需要登录

### 主要端点

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/v1/posts` | 文章列表（支持 `?search=`） | 可选 |
| GET | `/api/v1/posts/{id}` | 文章详情 | 可选 |
| POST | `/api/v1/posts` | 创建文章 | 无需 |
| DELETE | `/api/v1/posts/{id}` | 删除文章 | 博主/作者 |
| POST | `/api/v1/posts/{id}/like` | 切换点赞 | 必须 |
| GET/POST | `/api/v1/posts/{id}/comments` | 评论列表/发表 | 列表无需/发表必须 |
| GET/POST/DELETE | `/api/v1/personal` | 个人动态 CRUD | 仅博主可写 |
| GET/POST/DELETE | `/api/v1/resources` | 资源库 CRUD | 仅博主可写 |
| POST | `/api/v1/resources/{id}/star` | 切换收藏 | 必须 |
| POST | `/api/v1/upload` | 文件上传（限 1000MB） | 仅博主 |
| POST | `/api/v1/herb/predict` | 中药图片识别 | 可选 |
| GET | `/api/v1/herb/models` | 可用 AI 模型列表 | 无 |
| GET | `/api/v1/herb/classes` | 可识别中药列表 | 无 |
| GET | `/api/v1/site-config` | 站点配置 | 无 |
| GET | `/api/v1/health` | 健康检查 | 无 |

### 前端页面路由

| 路径 | 文件 | 用途 |
|------|------|------|
| `/` | BLOG.html | 博客首页 |
| `/personal` | personal.html | 个人主页 |
| `/library` | library.html | 资源库 |
| `/herb` | HERB.html | 中药识别 |

**注意**: 前端静态文件在 `main.py` 最底部通过 `app.mount("/", StaticFiles(...))` 挂载，所以新增前端文件不需要改路由。但 HTML 页面本身在 `@app.get("/xxx")` 中显式返回 `FileResponse`。

---

## 鉴权逻辑

- `get_current_user()` 从 `Authorization: Bearer <token>` 解析用户
- token 内包含 `sub`（user_id）和 `exp`（24 小时过期）
- 未带 token → 返回 `None`（匿名用户可浏览）
- 路由中用 `Optional[models.UserModel] = Depends(get_current_user)` 接收
- `_is_blog_owner(user)` 通过比对 `user.username == BLOG_OWNER_USERNAME` 判断博主权限

---

## 编码约定

- **Python**: 函数用蛇形命名 `snake_case`，注释用中文
- **前端 CSS**: 使用 CSS 变量（定义在 `:root`），变量名以 `--` 开头
- **前端 JS**: 原生 JS，通过 `common.js` 抽取公共逻辑（`getToken()`, `apiGet()`, `apiPost()`, `apiDelete()`, `showLoginModal()` 等）
- **API 函数**: 放在每个页面对应的 JS 文件中
- **文件格式**: CRLF（Windows 项目）
- **数据库迁移**: 不依赖 Alembic，直接在代码里通过 `_ensure_xxx_column()` 函数做增量迁移

---

## 重要约定

1. **不改数据库结构时先考虑**：直接用 `_ensure_xxx_column()` 模式在 `main.py` 顶部增量添加列
2. **前端路径用相对路径**：CSS/JS 引用如 `href="style.css"` 不带斜杠
3. **上传文件存储**：`uploads/YYYYMM/uuid.ext` 格式
4. **中药模型的三个选项**：ResNet50、EfficientNet-B3、MobileNetV3-Large，默认用 MobileNetV3-Large
5. **博主权限**：删除任意文章、发布个人动态、上传资源/文件
6. **普通用户**：只能删自己的文章，可以点赞/评论/收藏
