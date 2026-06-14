# 博客项目代码完全掌握指南

> 生成日期: 2026-06-10 | 代码行数: ~5360 | 文件数: 16

---

## 第1章 项目架构全景图

### 1.1 三层架构图

```
┌─────────────────────────────────────────────────────────┐
│                        浏览器                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ BLOG.html │  │personal. │  │library.  │               │
│  │ + main.js │  │html+ js  │  │html+ js  │               │
│  └────┬──────┘  └────┬─────┘  └────┬─────┘               │
│       │              │              │                     │
│       └──────────────┼──────────────┘                     │
│                      │ fetch() + JWT (Authorization头)    │
│                      │ JSON                                │
└──────────────────────┼───────────────────────────────────┘
                       │  HTTP (端口 8000)
┌──────────────────────┼───────────────────────────────────┐
│                 FastAPI (Python)                          │
│  ┌─────────────┐  ┌────────────┐  ┌────────────────┐    │
│  │ auth.py     │  │ main.py    │  │ StaticFiles     │    │
│  │ JWT签发/验证 │  │ REST API   │  │ (HTML/JS/CSS)  │    │
│  └─────────────┘  └─────┬──────┘  └────────────────┘    │
│                         │ SQLAlchemy ORM                   │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────┐
│  ┌──────────────────────┴───────────────────────────┐    │
│  │                  SQLite                            │    │
│  │  blog.db (users, posts, comments, likes,          │    │
│  │           personal_posts, resources...)           │    │
│  │  uploads/ (用户上传的文件)                          │    │
│  └──────────────────────────────────────────────────┘    │
│                      数据层                                 │
└──────────────────────────────────────────────────────────┘
```

### 1.2 项目目录树

```
my-project/
├── backend/                    ← Python 后端 (5 文件, ~550 行)
│   ├── main.py                 ← 🎯 核心: 30+ API 路由 + 业务逻辑 (~950行)
│   ├── auth.py                 ← JWT 签发与验证 (55行)
│   ├── database.py             ← SQLite 连接 + SQLAlchemy 引擎 (22行)
│   ├── models.py               ← 7 张数据表的 ORM 模型 (102行)
│   └── schemas.py              ← Pydantic 请求/响应结构体 (57行)
│
├── frontend/                   ← 前端 (7 文件, ~3200 行)
│   ├── BLOG.html               ← 博客主页 HTML 结构 (190行)
│   ├── main.js                 ← 博客主页交互逻辑 (~960行)
│   ├── personal.html           ← 个人主页 HTML (165行)
│   ├── personal.js             ← 个人主页交互 (~600行)
│   ├── library.html            ← 资源库 HTML (208行)
│   ├── library.js              ← 资源库交互 (~505行)
│   └── style.css               ← 全局样式 + markdown渲染 + 暗色主题 (~1195行)
│
├── Dockerfile                  ← Docker 镜像构建指令 (30行)
├── docker-compose.yml          ← 容器编排配置 (15行)
├── deploy.py                   ← 部署脚本 (100行)
├── requirements.txt            ← Python 依赖清单 (8行)
├── .env                        ← 环境变量 BLOG_OWNER_USERNAME
└── .gitignore                  ← Git 忽略规则
```

### 1.3 技术栈及选型理由

| 层级 | 技术 | 为什么选它 | 替代方案（没选的） |
|------|------|-----------|-------------------|
| 后端框架 | **FastAPI** | 带自动API文档(/docs)、类型安全、异步支持、学习曲线平缓 | Flask（太基础）、Django（太重） |
| 数据库 | **SQLite** | 零配置、单文件存储、不需要单独安装、适合小项目 | MySQL/PostgreSQL（需额外服务） |
| ORM | **SQLAlchemy** | Python 最成熟的 ORM，FastAPI 原生集成 | 手写 SQL（不安全） |
| 前端 | **原生 JS** | 先理解底层，再学框架。项目规模小不需要 React | React/Vue（杀鸡用牛刀） |
| 鉴权 | **JWT** | 无状态、自带签名和过期、行业标准 | Session（需要服务端存储） |
| 部署 | **Docker** | 环境一致、"在我电脑能跑=在服务器也能跑" | 手动装环境（费时费力） |
| Markdown | **marked.js** | 轻量(~40KB)、零配置、最流行的JS Markdown库 | showdown、remark |
| 数学公式 | **KaTeX** | 比MathJax快10倍、LaTeX语法 | MathJax（更全但更慢） |

### 1.4 数据流总览

```
用户操作
   ↓
前端 JS: fetch(URL, {headers, body})
   ↓ (HTTP 请求, JSON 格式)
FastAPI: @app.post("/api/v1/xxx")
   ↓
main.py 路由函数
   ↓  (通过 Depends 注入)
auth.py: get_current_user()  ← 从 Authorization 头解析 JWT
   ↓
main.py: db.query(Model).filter(...)   ← SQLAlchemy ORM 操作
   ↓
SQLAlchemy → sqlite3 → blog.db 文件
   ↓ (返回结果)
main.py: return HttpResponseSchema(code=0, data=...)
   ↓ (HTTP 响应, JSON 格式)
前端 JS: result.json() → 更新 DOM
```

---

## 第2章 请求旅程一：登录 → 发帖 → 渲染

### 2.1 登录链路

**前端 (`frontend/main.js`)**

1. 用户点「登录」→ `initAuthInteractions()` 注册的点击事件 (line 498)
2. `openAuthModal("login")` 移除 `.hidden` 类，弹窗显示
3. 填用户名密码 → 表单 submit 事件触发
4. `loginUser(username, password)` (line 306) → `fetch POST /api/v1/auth/login`
5. 后端返回 `{token, user_id, username}` → `saveUserSession(result.data)` (line 124)
6. 存入 localStorage: `{"token":"eyJ...", "user_id":1, "username":"Ltto123"}`
7. `closeAuthModal()` + `updateAuthUI()` → 隐藏登录按钮，显示"欢迎，Ltto123"

**后端 (`backend/main.py`)**

1. `login_user()` (line 307) 接收 `UserLoginSchema`
2. 查数据库: `db.query(UserModel).filter(username==payload.username).first()`
3. 验密码: `bcrypt.checkpw(password_input, stored_hash)` (line 317)
4. 签发 JWT: `create_access_token(user.id)` → 调用 `backend/auth.py`
5. 返回: `{token, user_id, username}`

**JWT 签发 (`backend/auth.py`)**
1. `create_access_token(user_id)` (line 22)
2. 构造 payload: `{"sub": "1", "exp": 当前时间+24小时}`
3. `jwt.encode(payload, SECRET_KEY, HS256)` → 生成三段式 token

### 2.2 发帖链路

**前端 (`frontend/main.js`)**

1. 用户在 `<textarea>` 写 Markdown 文本
2. 工具栏按钮 (`markdown-toolbar`) 插入语法标记: `**粗体**`, ` ```代码``` `, `$公式$`
3. 点「立即发布」→ form submit 事件 (line 631)
4. 收集: `title`, `content`, `author`(自动填当前用户名)
5. `fetch POST /api/v1/posts`, headers 带 `Authorization: Bearer <token>`
6. 成功后 `e.target.reset()` 清空表单 → `loadPostsFromServer()` 刷新列表

**后端 (`backend/main.py`)**

1. `create_new_post()` (line 395) 接收 `PostCreateSchema`
2. `new_post = PostModel(title, content, author, created_at=now)`
3. `db.add(new_post)` + `db.commit()` → 写入 `posts` 表

### 2.3 渲染链路

**前端 (`frontend/main.js`)**

1. `loadPostsFromServer()` (line 330): `fetch GET /api/v1/posts`
2. `renderBlogGrid()` (line 360): 遍历 `blogPosts` 数组，生成 HTML 卡片
3. 卡片预览: `plainTextSummary(post.content)` → 调用 `renderMarkdown()` 再 strip 标签，取前200字
4. 点卡片 → `openDetailModal(postId)` (line 752)
5. 详情正文: `renderMarkdown(post.content)` 六步处理:

```
Step 1: 保护代码块 ```...``` → 占位符 @@CODEBLOCK{N}@@
Step 2: 保护块级 LaTeX $$...$$ → 占位符 @@LATEX{N}@@  
Step 3: 保护行内 LaTeX $...$   → 占位符 @@LATEX{N}@@
Step 4: marked.parse() → Markdown → HTML
Step 5: katex.renderToString() → LaTeX 占位符 → 数学公式
Step 6: 还原代码块 → <pre><code>...
```

### 2.4 关键文件+行号速查

| 步骤 | 文件 | 函数/位置 | 行号 |
|------|------|----------|------|
| 页面初始化 | frontend/main.js | `init()` | ~960 |
| 登录按钮 | frontend/main.js | `initAuthInteractions()` | 498 |
| 登录请求 | frontend/main.js | `loginUser()` | 306 |
| 登录处理 | backend/main.py | `login_user()` | 307 |
| JWT 签发 | backend/auth.py | `create_access_token()` | 22 |
| 发帖请求 | frontend/main.js | form submit | 631 |
| 发帖处理 | backend/main.py | `create_new_post()` | 395 |
| 文章列表 | frontend/main.js | `loadPostsFromServer()` | 330 |
| 卡片渲染 | frontend/main.js | `renderBlogGrid()` | 360 |
| Markdown渲染 | frontend/main.js | `renderMarkdown()` | 31 |
| 详情弹窗 | frontend/main.js | `openDetailModal()` | 752 |

---

## 第3章 请求旅程二：上传 → 预览 → 下载

### 3.1 上传链路

**前端 (`frontend/library.js`)**

1. 用户选文件 → `<input type="file">` → `submitResource()` (line 278)
2. `uploadResourceFile(file)` (line 284): 构造 `FormData`, `fetch POST /api/v1/upload`
   - 请求头: `Authorization: Bearer <token>` (不含 Content-Type——浏览器自动设 multipart)
3. 获得文件 URL 后 → `fetch POST /api/v1/resources` (line 288)
   - body: `{title, description, category, file_url, file_name}`
4. 成功后 `loadResources()` 刷新列表

**后端 (`backend/main.py`)**

1. `upload_file()` (line 829): 验 JWT → 校验文件大小(≤1000MB) → 生成 `uploads/YYYYMM/uuid.ext` → 存盘 → 返回 URL
2. `create_resource()` (line 907): 验 JWT → 验博主权限 → 写入 `resources` 表

### 3.2 预览链路

**前端 (`frontend/library.js`)**

1. 点击资源卡片 → `openResourcePreview(resource)` (line 230)
2. `isPreviewableType(filename)` 根据扩展名分类:

| 文件扩展名 | 预览方式 |
|-----------|---------|
| `.pdf` | `<iframe>` 浏览器原生 PDF 阅读器 |
| `.jpg .png .gif .webp` | `<img>` 标签直接展示 |
| `.txt .md .json .csv` | `fetch` 异步加载文本 → `<pre>` 显示 |
| `.html .htm` | `<iframe>` 内嵌 |
| 其他 (docx, pptx, zip...) | 显示"不支持在线预览" + 下载按钮 |

3. 弹窗底部始终有 `📥 下载文件` 链接

### 3.3 关键文件+行号

| 步骤 | 文件 | 函数 | 行号 |
|------|------|------|------|
| 上传表单 | frontend/library.js | `submitResource()` | 278 |
| 文件上传 | frontend/library.js | `uploadResourceFile()` | 284 |
| 后端上传 | backend/main.py | `upload_file()` | 829 |
| 后端创建资源 | backend/main.py | `create_resource()` | 907 |
| 预览弹窗 | frontend/library.js | `openResourcePreview()` | 230 |
| 文件类型判断 | frontend/library.js | `isPreviewableType()` | 105 |
| 分类筛选栏 | frontend/library.js | `initCategoryBar()` | 250 |
| 星标收藏 | frontend/library.js | `toggleResourceStar()` | 440 |

---

## 第4章 请求旅程三：JWT 鉴权全链路

### 4.1 Token 结构拆解

JWT 是三段 Base64 串，用 `.` 隔开：

```
eyJhbGciOiJIUzI1NiJ9          ← Header:  {"alg":"HS256","typ":"JWT"}
.                              ← 点分隔符
eyJzdWIiOiIxIiwiZXhwIjoxNzQ5  ← Payload: {"sub":"1","exp":1749600000}
.                              ← 点分隔符
签名哈希                        ← Signature: HMACSHA256(Header+"."+Payload, 密钥)
```

| 段 | 内容 | 谁看得见 | 能被改吗 |
|----|------|---------|---------|
| Header | 加密算法类型 | 任何人（Base64 可解码） | 改了签名就对不上 |
| Payload | user_id + 过期时间 | 任何人（Base64 可解码） | 同上 |
| Signature | 头+负载的哈希 | 只有服务端能验证 | 不知道密钥算不出来 |

### 4.2 签发流程 — `create_access_token()`

```python
# backend/auth.py line 22-28
def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=24)  # 24小时后过期
    payload = {
        "sub": str(user_id),   # sub = subject, JWT 标准字段
        "exp": expire,         # exp = expiration, 过期时间戳
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

**逐行解释**：
1. `expire = datetime.now(...) + timedelta(hours=24)` — 计算 24 小时后的过期时间
2. `"sub": str(user_id)` — 把用户 ID 塞进 token。`sub` 是 JWT 标准字段名（subject）
3. `"exp": expire` — 设置过期时间戳。服务端验 token 时检查是否超时
4. `jwt.encode(payload, SECRET_KEY, HS256)` — 用密钥签名，生成三段式 token

### 4.3 验证流程 — `get_current_user()`

```python
# backend/auth.py line 31-55
def get_current_user(
    authorization: Optional[str] = Header(None),  # 从请求头提取
    db: Session = Depends(get_db),
) -> Optional[models.UserModel]:
    if not authorization:
        return None                              # 没带 token → 未登录

    parts = authorization.split()                # "Bearer eyJ..." → ["Bearer", "eyJ..."]
    if len(parts) != 2 or parts[0] != "bearer":
        return None                              # 格式不对 → 拒绝

    token = parts[1]                             # 提取 token 部分
    user_id = decode_access_token(token)         # 验证签名 + 过期
    if user_id is None:
        return None                              # token 无效 → 拒绝

    return db.query(UserModel).filter(id==user_id).first()  # 返回用户对象
```

**调用链**：
1. FastAPI 自动从 HTTP Header 提取 `Authorization`
2. `decode_access_token()` 用 `jwt.decode(token, SECRET_KEY)` 验证签名
3. 如果签名不对或过期 → 返回 None
4. 否则用解出的 `user_id` 查数据库，返回 `UserModel` 对象
5. 路由函数拿到 `current_user` 后直接使用

### 4.4 改前 vs 改后对比

| 维度 | 改前（裸奔） | 改后（JWT） |
|------|------------|-----------|
| 身份传递 | `?user_id=1` 在 URL 里 | `Authorization: Bearer <token>` 在请求头 |
| 防伪能力 | 无。F12 改 localStorage 即可冒充 | token 有签名，改了就失效 |
| 过期机制 | 无。永远有效 | 24 小时后自动过期 |
| URL 安全性 | ID 暴露在地址栏和浏览器历史 | URL 干净，不泄露身份信息 |
| 服务端验证 | 客户端说啥信啥 | 独立验签名，不依赖客户端 |

---

## 第5章 验收 Q&A 清单

### 5.1 架构与选型类

**Q1: 为什么选原生 JS 而不是 React/Vue？**
> 答: 先理解浏览器底层如何工作（DOM 操作、事件委托、模板字符串），再学框架。项目前端逻辑不复杂（4 页 CRUD + 主题切换），React 的组件化和状态管理在这个规模是过度设计。但我知道 React 的优势：虚拟 DOM、组件复用、生态丰富，后续扩展会考虑迁移。

**Q2: 为什么用 SQLite 而不是 MySQL？**
> 答: SQLite 零配置、单文件存储（blog.db）、不需要单独安装数据库服务、适合单机小项目。FastAPI 启动时自动建表。如果将来并发量增大，只需改 `database.py` 的连接字符串就能切换到 MySQL。
> 代码位置: `backend/database.py` line 5-9

**Q3: 为什么用 FastAPI？**
> 答: 自动生成 OpenAPI 文档（`/docs`）、类型安全的 Pydantic 模型、原生异步支持、比 Flask 更现代。适合前后端分离的 REST API。
> 代码位置: `backend/main.py` line 244 `app = FastAPI()`

**Q4: 前端后端怎么通信的？**
> 答: REST API，前端 `fetch()` 发 HTTP 请求，后端返回 JSON。通信格式统一：`{code, msg, data}`。带了 JWT 的请求在 `Authorization` 头里传 token。
> 代码位置: `frontend/main.js` 的 `getAuthHeaders()` 和 `backend/schemas.py` 的 `HttpResponseSchema`

### 5.2 鉴权与安全类

**Q5: JWT 的原理是什么？**
> 答: 三段 Base64：Header(算法) + Payload(user_id+过期) + Signature(前两段的哈希签名)。服务端签发时用密钥签名，验证时用同一密钥验签名。改了任何一段签名就对不上。
> 代码位置: `backend/auth.py` 全部 55 行

**Q6: 密码怎么存的？明文吗？**
> 答: 不是。用 bcrypt 哈希存储。`hash_password()` 做单向加密，`verify_password()` 比对新输入和存储的哈希。即使数据库泄露，攻击者也解不出原始密码。
> 代码位置: `backend/main.py` line 122-133

**Q7: 权限怎么分级的？**
> 答: 三级——匿名（只能看）、普通用户（可发帖删自己文章）、博主（删所有人文章+发个人动态+上传资源）。前端按钮根据 `canDeletePost()` 显示/隐藏，后端每个接口都做二次校验。
> 代码位置: 前端 `frontend/main.js` 的 `canDeletePost()` line 154 | 后端 `backend/main.py` 的 `delete_post()` line 444

### 5.3 渲染与前端类

**Q8: Markdown 怎么渲染的？**
> 答: 六步流水线：保护代码块→保护块级 LaTeX→保护行内 LaTeX→marked.parse 转 HTML→KaTeX 还原数学公式→还原代码块。先保护敏感内容的思路是避免 marked 把 `$` 或 ````` 解析坏。
> 代码位置: `frontend/main.js` 的 `renderMarkdown()` line 31-96

**Q9: 暗色主题怎么做的？**
> 答: CSS 变量 + `body.dark-theme` 类切换。主题状态存 localStorage。点击按钮切换 `body.classList.toggle("dark-theme")`，所有颜色自动跟随 CSS 中 `.dark-theme` 下的覆写规则。
> 代码位置: `frontend/main.js` 的 `initInteractions()` 中 theme 部分 (~line 640) | `frontend/style.css` 中 `.dark-theme` 选择器

**Q10: 评论和点赞怎么做到不刷新页面就更新的？**
> 答: 前端发 AJAX 请求（fetch），后端返回最新数据，前端用 `result.data` 更新 DOM。没有用 WebSocket——用户量小，HTTP 请求足够。
> 代码位置: `frontend/main.js` 的 like 处理 (line 770) 和 comment 处理 (line 830)

### 5.4 部署与运维类

**Q11: Docker 怎么用的？**
> 答: `Dockerfile` 定义镜像构建步骤（FROM python → COPY 代码 → pip install → CMD uvicorn）。`docker-compose.yml` 配端口映射和卷挂载（blog.db、uploads 不会随容器删除而丢失）。`docker compose up -d --build` 一键启动。
> 代码位置: `Dockerfile` (30行) + `docker-compose.yml` (15行)

**Q12: deploy.py 做了什么？**
> 答: 五步：① 打包项目(纯Python tar) ② SFTP 上传到腾讯云 ③ 服务器上解压 ④ 容器里 `pip install` 换清华源 ⑤ Docker 重建镜像并重启容器。
> 代码位置: `deploy.py` (100行)

**Q13: 安全组是什么？**
> 答: 云服务器的外部防火墙。默认只开 22 端口(SSH)。部署时手动在腾讯云控制台加了一条规则：放行 TCP 8000 端口对所有 IP。不放行的话公网永远访问不到你的博客。

### 5.5 数据库类

**Q14: SQLAlchemy ORM 是什么，怎么用的？**
> 答: ORM = 把数据库表映射成 Python 类。`UserModel` 类 = `users` 表，一行记录 = 一个对象。操作数据库不需要写 SQL：`db.query(UserModel).filter(...).first()` 代替 `SELECT * FROM users WHERE ...`。
> 代码位置: `backend/models.py` (定义) | `backend/database.py` (连接)

**Q15: 有哪些数据表？**
> 答: 7 张表。users(用户)、posts(博客文章)、comments(博客评论)、likes(博客点赞)、personal_posts(个人动态)、personal_comments/personal_likes(个人页评论区)、resources(资源库)、resource_stars(资源收藏)。
> 代码位置: `backend/models.py`

---

## 第6章 文件速查表

### 6.1 后端文件

| 文件 | 行数 | 职责 | 关键函数 |
|------|------|------|----------|
| `backend/auth.py` | 55 | JWT 签发与验证 | `create_access_token()` (line 22), `decode_access_token()` (line 31), `get_current_user()` (line 35) |
| `backend/database.py` | 22 | 数据库连接 | `engine` (line 8), `SessionLocal` (line 13), `Base` (line 17), `get_db()` (line 21) |
| `backend/models.py` | 102 | 7张表的ORM模型 | `UserModel`, `PostModel`, `CommentModel`, `LikeModel`, `PersonalPostModel`, `ResourceModel`, `ResourceStarModel` |
| `backend/schemas.py` | 57 | Pydantic 数据结构 | `HttpResponseSchema`, `UserLoginSchema`, `PostCreateSchema`, `LikeToggleSchema`, `CommentCreateSchema` 等 |
| `backend/main.py` | ~950 | 30+ API路由 + 业务逻辑 | `login_user()` (307), `delete_post()` (424), `get_all_posts()` (338), `create_resource()` (907), `upload_file()` (829), `renderMarkdown` 使用的后端不涉及 |

### 6.2 前端文件

| 文件 | 行数 | 职责 | 关键函数 |
|------|------|------|----------|
| `frontend/BLOG.html` | 190 | 博客主页结构 | 发布表单(line 39), 搜索栏(line 97), 登录弹窗(line 117) |
| `frontend/main.js` | ~960 | 博客主页交互 | `renderMarkdown()` (31), `loadPostsFromServer()` (330), `renderBlogGrid()` (360), `openDetailModal()` (752), `initAuthInteractions()` (498), `init()` (960) |
| `frontend/personal.html` | 165 | 个人主页结构 | 发布表单(line 35), 图片/文件上传(line 61-69) |
| `frontend/personal.js` | ~600 | 个人主页交互 | `loadPersonalPosts()` (156), `uploadFile()` (238), `togglePersonalLike()` (394), `openPersonalDetail()` (438) |
| `frontend/library.html` | 208 | 资源库结构 | 上传表单(line 64), 分类筛选栏(line 109) |
| `frontend/library.js` | 505 | 资源库交互 | `openResourcePreview()` (230), `isPreviewableType()` (105), `submitResource()` (278), `toggleResourceStar()` (440) |
| `frontend/style.css` | 1195 | 全局样式 | 暗色主题 (body.dark-theme), Markdown 渲染样式 (.markdown-body), 预览弹窗样式 (.preview-*), 工具栏样式 (.markdown-toolbar) |

### 6.3 部署文件

| 文件 | 行数 | 职责 | 关键内容 |
|------|------|------|----------|
| `Dockerfile` | 30 | 镜像构建指令 | FROM python:3.12-slim, COPY frontend/ backend/, RUN pip install, CMD uvicorn |
| `docker-compose.yml` | 15 | 容器编排 | ports 8000:8000, volumes blog.db+uploads, restart unless-stopped |
| `deploy.py` | 100 | 一键部署 | 纯Python打包→SFTP上传→重建镜像→重启容器 |

### 6.4 配置文件

| 文件 | 职责 |
|------|------|
| `requirements.txt` | Python 依赖: fastapi, uvicorn, sqlalchemy, bcrypt, python-jose, python-dotenv, python-multipart, pydantic |
| `.env` | 环境变量: `BLOG_OWNER_USERNAME=Ltto123` (博主用户名) |
| `.gitignore` | 排除 .venv, .git, blog.db, uploads, openspec, deploy.py, project.tar.gz 等 |

---

## 附录：快速自查清单

验收前对着这个表过一遍，每条能说 30 秒就算过关：

- [ ] 能用笔画出三层架构图（浏览器 → FastAPI → SQLite）
- [ ] 能说出 16 个文件的职责，不看目录
- [ ] 能口述登录流程（前端按钮 → fetch → 后端 hash 验证 → JWT 返回 → 前端存 token）
- [ ] 能解释 renderMarkdown 的六步处理
- [ ] 能说出 JWT 三段结构，每段是什么
- [ ] 能对比 JWT 和之前的明文 user_id 方式
- [ ] 能说出三种文件类型的预览方式（PDF/图片/文本）
- [ ] 能解释 Docker 的两层缓存策略（pip 装包层 vs 代码层）
- [ ] 能说出权限三级分级（匿名/普通/博主）
- [ ] 能解释 deploy.py 的五步流程
