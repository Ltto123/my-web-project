# JavaScript 调试技能包（阶段 0-4 全总结）

> 学习完成时间：2026-07-28

---

## 一、JS 代码是怎么跑起来的

```
① 页面加载 → <script src="xxx.js"> 被浏览器执行
② init() 跑起来 → 绑定事件监听器（注册"等什么触发"）
③ 用户操作（点击/输入/拖拽） → 浏览器找到对应的监听器 → 执行函数
④ 函数发网络请求 → await 等服务器 → 拿到数据 → 更新页面

关键：第 ③ 步之前，JS 是"静止"的。事件 = 触发机关。
```

| 概念 | 一句话 |
|------|--------|
| `function xxx() { }` | 只是"菜谱"，写了不执行 |
| `init()` | "现在按菜谱做菜"，菜谱要先写好 |
| `?.` 可选链 | 安全锁——元素存在就继续，不存在就停，不报错 |

---

## 二、三面板速查

### Console 面板（`Ctrl+Shift+J`）

| 能力 | 例子 |
|------|------|
| 当计算器 | `1 + 2` → `3` |
| 读页面状态 | `currentUser`, `blogPosts`, `API_BASE` |
| 发请求 | `await fetch(...)` |
| 看报错 | 红色 `ReferenceError: xxx is not defined` |

### Network 面板

| 能力 | 操作 |
|------|------|
| 查看请求 URL 和方法 | 点记录 → 「标头」标签 |
| 查看服务器返回的数据 | 点记录 → 「预览」标签 |
| 只看 API 请求 | 点顶部 **Fetch/XHR** 过滤按钮 |
| 清空历史 | 点 🚫 |

### Sources 面板（断点）

| 能力 | 操作 |
|------|------|
| 设断点 | 点行号 → 出现标记 |
| 删断点 | 再点一次行号 |
| 继续执行 | `F8` |
| 逐行（不进函数） | `F10` |
| 逐行（进函数） | `F11` |
| 看变量值 | 右侧「作用域」面板 / 悬停 / Console 输入 |

---

## 三、addEventListener 拆解

```js
document.querySelector("#predict-btn")?.addEventListener("click", handlePredict);
```

| 零件 | 含义 |
|------|------|
| `document` | 整个页面，JS 世界的入口 |
| `.querySelector("#xxx")` | 按 CSS 选择器找元素（`#`=id，`.`=class） |
| `?.` | 找到了继续，没找到停 |
| `.addEventListener("事件", 函数)` | 绑定：当事件发生时，执行函数 |

注意：函数名后面**不加 `()`**——加了会立即执行，不是等点击才执行。

---

## 四、fetch + await 模式（项目 API 调用模板）

```js
const resp = await fetch(`${API_BASE}/api/v1/xxx`, {
  method: "POST",
  headers: getAuthHeaders(),
  body: JSON.stringify({ ... }),
});
const result = await resp.json();
if (result.code === 0) { /* 用 result.data */ }
else { showToast(result.msg); }
```

| 步骤 | 含义 |
|------|------|
| `fetch(url, config)` | 发请求（Network 面板出现记录）|
| `await` | 堵门，等服务器回复 |
| `resp.json()` | 把回复从文本变成 JS 对象 |
| `result.code === 0` | 项目约定：0 = 成功 |

---

## 五、标准调试 7 步流（JS 版）

```
① Ctrl+Shift+J → 打开 Console，看有没有红色报错
② Network 面板 → 清空 → 点 Fetch/XHR → 看请求返回了什么
③ VS Code Ctrl+Shift+F → 搜索相关函数名 / 选择器 → 定位代码
④ Sources 面板 → 在怀疑的函数第一行设断点（点行号）
⑤ 触发操作 → 代码暂停 → F10 逐行走
⑥ Console 里输入变量名 → 对比预期值 vs 实际值
⑦ 锁定问题 → VS Code 改 → 保存 → 刷新验证
```

---

## 六、关键概念速记

| 概念 | 一句话 |
|------|--------|
| 事件 | JS 的触发机关（`click`, `submit`, `keydown`） |
| `console.log` | 在代码路上放监控摄像头 |
| 断点 | 冻结时间，让代码在任意一行暂停 |
| `await` | 堵门等网络，后面的代码先别跑 |
| `result.code === 0` | 项目 API 的统一"成功"信号 |
| 作用域面板 | 断点时看所有变量的实时值 |
| `undefined` | 这个变量/属性不存在 |
| `ReferenceError` | 变量根本没定义 |

---

## 七、学会了就能

- [x] Console 里探查页面状态，看懂报错信息
- [x] 追踪一次点击的完整链路：按钮 → 函数 → 请求 → 渲染
- [x] Network 面板看任何 API 请求的 Request 和 Response
- [x] 设断点 → F10 逐行走 → Scope/Console 看变量
- [x] 独立定位 bug：Console + Network + 断点 + 对比变量
- [x] 修 bug 后刷新验证
