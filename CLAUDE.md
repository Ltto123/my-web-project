# CLAUDE.md — 个人博客系统

## 项目概述

这是 **Ltto 的个人博客**，一个全栈 Web 应用。包含博客文章、个人主页、资源库、中药识别、不背单词五大模块。

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
│   ├── herb_model_data/ # 训练好的模型权重文件
│   ├── vocab_ai.py      # 不背单词 — DeepSeek AI 单词解析与补全
│   └── vocab_routes.py  # 不背单词 API 路由（词集CRUD/学习进度）
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
│   ├── VOCAB.html        # 不背单词页
│   ├── vocab.js          # 不背单词 JS（卡片学习/拼写测试）
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

## 数据库表结构（13 张表）

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
| `vocab_sets` | VocabSetModel | 不背单词 — 单词集 |
| `vocab_words` | VocabWordModel | 不背单词 — 单词（含释义/例句/词性） |
| `vocab_progress` | VocabProgressModel | 不背单词 — 用户学习进度（stage/correct/wrong/spelling） |

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
| GET | `/api/v1/vocab/sets` | 单词集列表 | 可选 |
| GET | `/api/v1/vocab/sets/{id}` | 单词集详情（含所有单词） | 无 |
| POST | `/api/v1/vocab/sets/upload` | 上传单词文件（AI解析） | 必须 |
| DELETE | `/api/v1/vocab/sets/{id}` | 删除单词集 | 上传者/博主 |
| GET | `/api/v1/vocab/progress/{set_id}` | 获取学习进度 | 必须 |
| POST | `/api/v1/vocab/progress` | 更新单词进度 | 必须 |
| POST | `/api/v1/vocab/progress/spell` | 标记拼写通过 | 必须 |
| POST | `/api/v1/vocab/progress/reset/{set_id}` | 重置学习进度 | 必须 |
| GET | `/api/v1/site-config` | 站点配置 | 无 |
| GET | `/api/v1/health` | 健康检查 | 无 |

### 前端页面路由

| 路径 | 文件 | 用途 |
|------|------|------|
| `/` | BLOG.html | 博客首页 |
| `/personal` | personal.html | 个人主页 |
| `/library` | library.html | 资源库 |
| `/herb` | HERB.html | 中药识别 |
| `/vocab` | VOCAB.html | 不背单词 |

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

---

## 新功能上线前测试协议

**每个新功能开发完成后，必须在云服务器上跑端到端测试，然后清理测试数据。**

### 测试流程

1. **在服务器上注册一个测试用户**（`test_<feature>_runner`）
2. **登录获取 token**
3. **构造测试数据**（如单词文件、图片等），调 API 完成核心链路
4. **验证返回结果**是否正确、完整
5. **清理所有测试痕迹**：
   - 通过 API 删除测试创建的业务数据
   - 通过 SSH 直连 SQLite 删除测试用户：
     ```bash
     ssh root@106.14.218.12 "cd /opt/blog && /opt/blog/.venv/bin/python -c \"
     import sqlite3; conn = sqlite3.connect('blog.db'); c = conn.cursor()
     c.execute('DELETE FROM <related_table> WHERE user_id=X')
     c.execute('DELETE FROM users WHERE id=X')
     conn.commit(); conn.close()
     \""
     ```
6. **清理本地临时文件**（`/tmp/test_*`）

### 部署前检查

- [ ] 本地 Python 语法检查通过（所有 `.py` 文件 `py_compile`）
- [ ] `requirements.txt` 已更新（如有新依赖）
- [ ] 服务器依赖已安装（`pip install` 新包）
- [ ] 服务器 `.env` 已补全新增的环境变量
- [ ] `docker-compose.yml` 已更新（如有新环境变量/卷挂载）
- [ ] 新页面已注册到 `main.py` 的 `@app.get()` 路由
- [ ] 所有 HTML 页面的导航栏和页脚包含新页面的入口链接
- [ ] 端到端测试已通过并清理完毕

### 部署命令

```bash
# 全量部署（前端 + 后端）
bash deploy.sh -a

# 仅前端
bash deploy.sh

# 仅后端（会重启服务）
bash deploy.sh -b
```

**服务器**: `root@106.14.218.12`，SSH key: `~/.ssh/id_ed25519`

### 部署节奏

1. **先在本地完成所有开发和测试**，确认功能正常
2. **做完一项改动后，主动问用户是否需要远程部署**，不要自动部署
3. 用户确认后再执行 `bash deploy.sh` 命令
4. 例外：用户明确说"部署"或"deploy"时可以直接执行

### 校对规则

- 当用户说「校对」或「检查」时，**先返回内容给用户审阅**，等用户确认后再写入文件
- **不要未经确认直接写入** CLAUDE.md 或其他项目文档

---

## 开发注意事项（2026-07 复盘）

### 1. 数据权限：新功能第一步就加过滤

vocab 列表未按 `user_id` 过滤，任何登录用户可见所有数据。
- 列表接口：`WHERE user_id = current_user.id`
- 详情/状态接口：校验所有权，非本人返回 403
- 不要等"后补"，权限是功能的一部分

### 2. SQLite：显式开启 foreign_keys 和 WAL

- `PRAGMA foreign_keys=ON` — 默认 OFF，CASCADE DELETE 静默失效
- `PRAGMA journal_mode=WAL` — 默认 DELETE 模式，写锁阻塞并发读
- 已在 `models.py` 的 connect 事件中统一设置；用 `sqlite3.connect()` 的脚本需手动执行
- 测试后验证：`SELECT COUNT(*) FROM child WHERE parent_id NOT IN (SELECT id FROM parent)` 应为 0

### 3. API 调用：不依赖默认值

删除 `max_tokens=32000` 后 DeepSeek 默认 4096，130+ 词 JSON 被静默截断，无报错。
- `max_tokens`、`timeout`、`temperature` 显式传值
- 检查 `finish_reason`；`"length"` 表示输出被截断
- 变更参数后对比输出条目数；用正则先数输入中有多少条

### 4. 前端鉴权：全局事件 + 跨标签页同步

登录后 `updateAuthUI()` 只更新导航栏，页面内按钮不刷新。
- `updateAuthUI()` 末尾 `dispatchEvent(new CustomEvent("auth-changed"))`
- 各页面 `addEventListener("auth-changed", ...)` 重刷鉴权 UI
- `window.addEventListener("storage", ...)` 监听 `USER_STORAGE_KEY` 实现跨标签页同步

### 5. CSS：交互元素四态必查

全站缺 `:active`、`:focus-visible`、`:disabled`。
- 每个可交互元素：hover / active(`scale(0.97)`) / focus-visible(outline `--c-primary`) / disabled
- 颜色用 CSS 变量，禁止硬编码 `#xxxxxx`
- 写完 Tab 键遍历 + 鼠标点击验证

### 6. 并行处理：共享可变对象加锁

`ThreadPoolExecutor` + `as_completed` 中 `seen` set 需 `threading.Lock`。
- 验证：总词数 = 唯一词数（差值 >0 即去重失败）
- 先串行跑通得到正确结果，再开并行对照

### 7. 测试用真实数据

5 个捏造单词无法暴露 300+ 词截断。大英四 PDF（755 词）实测覆盖率仅 58%。
- 用用户提供的真实文件；正则计数 → 对比 AI 输出覆盖率
- 去重率 = `(总数 - 唯一数) / 总数`，>0% 即 bug

### 8. 测试清理：验证级联删除

foreign_keys 未开启导致 orphan words 残留，SQLite ID 复用后数据"复活"。
- 测试最后一步：删 set → 查 words 是否级联删除 → 删 user
- SQLite 无 AUTOINCREMENT 时 ROWID 会被复用，不依赖"ID 不会冲突"假设
