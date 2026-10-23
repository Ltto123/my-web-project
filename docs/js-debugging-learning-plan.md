# JavaScript 调试能力 —— 一步步学习指导

> 前置能力：已完成 HTML/CSS 调试教学（阶段 0-4）

---

## 总体路线

```
阶段 0: Console 面板入门      (30 min)  → JS 版的「样式面板」——看懂输出和报错
阶段 1: 追踪一次点击          (60 min)  → 用 herb.js 追踪"点击按钮 → 执行函数"全过程
阶段 2: 看懂 API 调用         (60 min)  → Network 面板 + fetch/await 模式
阶段 3: 断点调试              (60 min)  → 在代码里冻结时间，逐行看变量变化
阶段 4: 实战修 bug            (90 min)  → 独立定位并修复 real bug，全工具验证
```

总计约 5 小时，建议分 3-5 次完成。

---

## 阶段 0：Console 面板入门——JS 世界的"样式面板"

**目标**：打开 Console 面板，看懂 `console.log` 输出和错误信息，知道怎么在 Console 里执行 JS。

### 我会带着你做的练习

**第 1 步：打开 Console**

3 种方式：
- 按 `F12`，然后点「**控制台**」（Console）标签
- 按 `Ctrl+Shift+J` 直接打开 Console
- 「元素」面板底部通常也有一个 Console 抽屉（按 `Esc` 切换）

**第 2 步：认识 Console 里的内容类型**

打开博客首页 `http://127.0.0.1:8000/`，看 Console 里的输出：

| 类型 | 图标 | 含义 | 例子 |
|------|------|------|------|
| `console.log` | 无/蓝圈 | 开发者主动打的日志 | `页面已加载` |
| 错误 ❌ | 红叉 | JS 运行出错，代码停了 | `Uncaught TypeError: ...` |
| 警告 ⚠️ | 黄三角 | 不致命但建议改 | `deprecated API` |

**第 3 步：把 Console 当计算器**

在 Console 底部输入框（`>` 提示符）直接输入 JS 代码：

```js
1 + 2           // → 3
"hello".toUpperCase()  // → "HELLO"
document.title  // → 当前页面标题
```

**第 4 步：用 `console.log` 探查页面状态**

```js
console.log(currentUser)     // 当前登录用户是谁？
console.log(blogPosts)       // 博客文章列表（仅 BLOG 页面有效）
console.log(API_BASE)        // API 地址是什么？
```

**练习任务**：
1. 在博客首页 Console 里输入 `blogPosts`，看到什么？
2. 在中药识别页输入 `API_BASE`，输出是什么？
3. 故意打错一个变量名（如 `blagPosts`），看报错长什么样

**验收标准**：能区分 `console.log` 输出、报错、警告三类信息。

---

## 阶段 1：追踪一次点击——从按钮到函数

**目标**：在中药识别页（herb.js，项目里最简单的 JS 文件），追踪"点击预测按钮"的完整执行路径。

### 为什么从 herb.js 开始？

你的 5 个页面都遵循同一个模板（`init()` → 加载配置 → 绑定事件 → 加载数据）。herb.js 只有 178 行，是最简版本，搞懂它 = 搞懂所有页面的骨架。

### 知识铺垫：JS 代码是怎么"跑"起来的？

```
① 页面加载 → <script src="herb.js"> 被执行
② init() 函数跑起来 → 绑定事件监听器
③ 用户点击按钮 → 浏览器找到对应的监听器函数 → 执行它
④ 函数里发起网络请求 → 等服务器响应 → 更新页面

关键点：第 ③ 步之前，JS 是"静止"的。事件 = 触发机关。
```

### 我会带着你做的练习

**练习 1：看 `init()` 函数——一切开始的地方**

打开 `frontend/herb.js`，找到最底部的 `init()` 函数（第 165 行）。逐行读：

```js
async function init() {
  loadUserSession();            // 1. 读 localStorage 恢复登录状态
  initAuthInteractions();       // 2. 绑定登录弹窗事件
  initThemeToggle();            // 3. 绑定主题切换按钮
  await loadSiteConfig();       // 4. 从服务器拉站点配置
  updateAuthUI();               // 5. 更新导航栏（显示/隐藏登录按钮）
  initFilePreview();            // 6. 绑定拖拽/选择图片事件
  initPasteSupport();           // 7. 绑定粘贴图片事件
  document.querySelector("#predict-btn")?.addEventListener("click", handlePredict);
                                // 8. 绑定"开始识别"按钮
  await renderClassGrid();      // 9. 加载中药分类标签
}
```

关键一行：`document.querySelector("#predict-btn")?.addEventListener("click", handlePredict)`

翻译成人话：**找到 id 为 `predict-btn` 的按钮，告诉浏览器"当它被点击时，执行 `handlePredict` 函数"**。

**练习 2：追踪 `handlePredict` 的完整流程**

打开 herb.js 第 105-130 行，跟着注释走：

```js
async function handlePredict() {
  // ① 获取用户选的文件
  const fileInput = document.querySelector("#herb-file");
  const file = fileInput?.files[0];
  
  // ② 没选文件 → 弹提示，直接 return（后面的代码不执行）
  if (!file) { showToast("请先选择一张中药图片"); return; }
  
  // ③ 文件大于 10MB → 弹提示，return
  if (file.size > 10 * 1024 * 1024) { showToast("图片大小不能超过 10MB"); return; }
  
  // ④ 显示加载动画
  loadingArea?.classList.remove("hidden");
  
  // ⑤ 组装表单数据（图片 + 模型名）
  const formData = new FormData();
  formData.append("file", file);
  
  // ⑥ 发网络请求 → 等服务器返回结果
  const resp = await fetch(`${API_BASE}/api/v1/herb/predict`, { method: "POST", body: formData });
  const result = await resp.json();
  
  // ⑦ 隐藏加载动画，显示结果
  if (result.code === 0) { renderResult(result.data); }  // 成功
  else showToast("识别失败");                             // 失败
}
```

**练习 3：在 VS Code 里加 `console.log` 看执行过程**

在 herb.js 的 `handlePredict` 函数里加日志：

```js
async function handlePredict() {
  console.log("=== handlePredict 被调用了 ===");
  const fileInput = document.querySelector("#herb-file");
  const file = fileInput?.files[0];
  console.log("文件:", file);  // 打印文件对象
  // ... 其余不变
}
```

保存 → 刷新页面 → 选一张中药图片 → 点「开始识别」→ 看 Console 里输出。

**练习 4：理解 `?.`（可选链）**

你的项目里大量使用 `?.`：
```js
document.querySelector("#predict-btn")?.addEventListener(...)
//                                    ↑
//                       如果 #predict-btn 不存在，什么都不做，不报错
```

等价于：
```js
const btn = document.querySelector("#predict-btn");
if (btn) { btn.addEventListener(...); }
```

**验收标准**：指着 herb.js 的 `handlePredict` 函数，能说出"这个函数从第几行开始，第一步做什么，await 在哪行等服务器"。

---

## 阶段 2：看懂 API 调用——Network 面板 + fetch 模式

**目标**：用 Network 面板看到"请求发出去 → 服务器返回数据"的全过程，理解 JSON 数据格式。

### 知识铺垫

项目中所有 API 调用都遵循同一个模式：

```js
const resp = await fetch("http://xxx/api/v1/xxx", { ... });   // ① 发送请求
const result = await resp.json();                                // ② 解析 JSON
if (result.code === 0) { /* 用 result.data */ }                // ③ 检查是否成功
else { /* 显示 result.msg */ }                                 // ④ 失败处理
```

`{ code: 0, msg: "success", data: ... }` 是你项目的统一响应格式。

### 我会带着你做的练习

**练习 1：打开 Network 面板，看一次请求**

1. F12 → 点「**网络**」（Network）标签
2. 点左上角的「清除」按钮（🚫）清空历史
3. 在中药识别页选一张图片，点「开始识别」
4. 观察 Network 面板出现一条新记录 `predict`
5. **点击那条记录** → 右侧出现详情：
   - 「**标头**」（Headers）：请求 URL、方法（POST）
   - 「**预览**」（Preview）/「**响应**」（Response）：服务器返回的 JSON 数据
   - 看看 `result.code`、`result.data.prediction` 的值

**练习 2：看不同页面的请求**

| 页面 | 操作 | Network 里出现的请求 |
|------|------|---------------------|
| 博客首页 | 刷新页面 | `posts?page=1` |
| 个人主页 | 点 ❤️ 点赞 | `personal/{id}/like` (POST) |
| 资源库 | 点 ⭐ 收藏 | `resources/{id}/star` (POST) |
| 不背单词 | 上传文件 | `vocab/sets/upload` (POST) |

每个都点进去看看 Request 和 Response。

**练习 3：理解 async/await——为什么不是"从上到下瞬间执行"**

```js
async function loadData() {
  console.log("开始加载");                       // 立刻执行
  const resp = await fetch("http://xxx/api");   // ⏸️ 在这里暂停，等网络返回
  console.log("加载完成", resp);                // 网络回来后执行
}
```

`await` = "我要等这个，回来后继续往下走"。你项目中但凡看到 `await`，都是**在等网络/等服务器**。

**练习 4：在 Console 里手动发一次请求**

在博客首页的 Console 里粘贴并回车：

```js
const r = await fetch(`${API_BASE}/api/v1/posts?page=1`);
const result = await r.json();
console.log("文章数量:", result.data.total || result.data.length);
```

你会看到和页面加载时一样的数据——**Console 可以手动模拟任何请求**。

**验收标准**：打开任意页面，能说出它在 Network 面板里产生了哪几条请求、每条请求的 URL 和返回的 JSON 大概长什么样。

---

## 阶段 3：断点调试——冻结时间，逐行看代码

**目标**：在 Sources 面板里设置断点，暂停代码执行，逐行查看变量值。

### 知识铺垫

`console.log` 能看"某刻的变量值"。断点更强大：**你可以在任意一行让代码暂停，然后一行一行手动往前走，同时看所有变量在每一步的实时值。**

### 我会带着你做的练习

**练习 1：在 `handlePredict` 里设第一个断点**

1. F12 → 点「**源代码**」（Sources）标签
2. 左侧文件树找到 `frontend/herb.js` → 点击打开
3. 找到 `handlePredict` 函数第一行（`const fileInput = ...`，第 106 行）
4. **点那一行左边的行号** → 出现蓝色箭头标记 🔵，这就是断点
5. 去页面上传一张图片，点「开始识别」
6. 代码在断点处暂停！页面变灰，右侧出现调试面板

**练习 2：认识调试面板的按钮**

| 按钮 | 快捷键 | 作用 |
|------|--------|------|
| ▶ 继续 | `F8` | 运行到下一个断点（或结束） |
| ⤵ 逐过程 | `F10` | 执行当前行，不进入函数内部 |
| ⬇ 逐语句 | `F11` | 进入当前行的函数内部 |
| ⬆ 跳出 | `Shift+F11` | 跳出当前函数 |

**练习 3：一步一步走 `handlePredict`**

在断点处暂停后，按 `F10` 一次走一行，同时观察右侧面板：

- 「**作用域**」（Scope）→ 本地变量：`file`、`fileInput` 的当前值
- 鼠标**悬停**在代码里的变量名上 → 弹出实时值
- 每按一次 `F10`，走到下一行，变量值跟着变

走到 `await fetch(...)` 那行时按 `F10` → 代码会"卡"一下（等网络）→ 然后 `resp` 和 `result` 变量出现。

**练习 4：在 Console 里"偷看"当前变量**

暂停时，切换到 Console 标签，直接输入变量名：
```js
file          // → 当前选的文件对象
file.name     // → 文件名
modelName     // → 选中的模型名
```

**断点 + Console 是 JS 调试的终极武器**: 暂停 → Console 看变量 → 继续 → 再暂停。

**验收标准**：能在任意 JS 函数第一行设断点，用 `F10` 走完整个函数，在 Scope 面板或 Console 里看到每步的变量值。

---

## 阶段 4：实战修 bug——你的「JavaScript 毕业设计」

**目标**：独立使用 Console + Sources + Network 定位并修复真实的交互 bug。

### Bug 场景

我会在 `main.js` 里故意引入一个 bug（比如改错变量名、漏掉 `await`、写错选择器），让你独立定位。

典型 bug 类型（对应你项目里真实可能出现的）：
- 点了按钮没反应 → 事件没绑定上（选择器写错 / 元素还没加载）
- API 请求发了但页面没更新 → 忘记了 `renderXxx()` 或 `result.code` 检查写反了
- 数据更新了但展示不对 → `innerHTML` 拼错了字段名

### 调试流程（以后每次修 JS bug 照着做）

```
① 复现 bug → 确认"什么操作触发了问题"
② Network 面板 → 看请求发出去了吗？返回了什么？
③ Console 面板 → 有没有红色报错？报错信息说什么？
④ Sources 面板 → 在相关函数第一行设断点
⑤ F10 逐行走 → 看变量值在哪一步跟预期不一样
⑥ VS Code → 修复代码 → Ctrl+S
⑦ 刷新验证 → 确认 bug 消失
```

### 验收

我会随机往 `main.js` 注入一个 bug，给你描述"预期行为 vs 实际行为"，你来定位并修复，全程不需要问我。

---

## 标准调试 7 步流（JS 版）

```
① Ctrl+Shift+J → 打开 Console，先看有没有红色报错
② Network 面板 → 清空 → 操作触发 bug → 看有没有新请求、返回了什么
③ 搜索相关函数名 → VS Code Ctrl+Shift+F 全局搜关键词
④ Sources 面板 → 在怀疑的函数第一行设断点
⑤ 触发操作 → 代码暂停 → F10 逐行走
⑥ Scope 面板 / Console → 看变量值在哪步出问题
⑦ 修复 → 保存 → Ctrl+Shift+F5 验证
```

---

## JS 工具速查

### Console 面板

| 操作 | 快捷键/方式 |
|------|------------|
| 打开 Console | `F12` → 控制台 或 `Ctrl+Shift+J` |
| 清空 Console | `Ctrl+L` 或点左上角 🚫 |
| 看报错位置 | 点报错信息右边的文件名链接 → 跳转到 Sources |

### Sources 面板（断点）

| 操作 | 快捷键 |
|------|--------|
| 设断点 | 点行号 |
| 继续执行 | `F8` |
| 逐行（不进函数） | `F10` |
| 逐行（进函数） | `F11` |
| 跳出函数 | `Shift+F11` |
| 搜索文件 | `Ctrl+P` |

### Network 面板

| 操作 | 作用 |
|------|------|
| 点一条记录 | 看 Request URL、Method、Status Code |
| 「响应」标签 | 看服务器返回的原始 JSON |
| 「预览」标签 | 格式化后的 JSON（更易读） |
| 过滤 XHR/Fetch | 只看 API 请求，不看图片/CSS |

---

## 项目 JS 文件速查

| 文件 | 行数 | 核心内容 | 教学阶段 |
|------|------|---------|---------|
| `common.js` | 541 | 公共函数、认证、主题、上传 | 贯穿全阶段 |
| `herb.js` | 178 ⭐ | 中药识别、图片拖拽、预测 | **阶段 1-3 主战场** |
| `personal.js` | 219 | 个人主页、点赞评论、图片灯箱 | 阶段 2-4 |
| `main.js` | 313 | 博客首页、翻页、文章详情弹窗 | 阶段 2-4 |
| `library.js` | 325 | 资源库、分类筛选、文件预览 | 阶段 2-4 |
| `vocab.js` | 654 ⭐⭐ | 单词学习三种模式、AI 轮询 | 进阶阅读 |

---

## 学习进度追踪表

| 阶段 | 内容 | 状态 | 日期 |
|------|------|------|------|
| 0 | Console 面板 + console.log + 报错阅读 | ✅ | 2026-07-28 |
| 1 | herb.js 追踪点击 → 看懂 init/事件/函数调用 | ✅ | 2026-07-28 |
| 2 | Network 面板 + fetch/await 模式 + async 理解 | ✅ | 2026-07-28 |
| 3 | Sources 断点 + F10/F11 + Scope 看变量 | ✅ | 2026-07-28 |
| 4 | 毕业设计：独立修 bug + 7 步流全工具验证 | ✅ | 2026-07-28 |

**完成线**：阶段 4 独立定位并修复 bug，全程不需要提示。
