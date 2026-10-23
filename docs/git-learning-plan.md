# Git 工作流 —— 一步步学习指导

> 前置能力：已完成 HTML/CSS 调试 + JS 调试教学

---

## 总体路线

```
阶段 0: 看懂状态        (30 min)  → git status / log / diff，知道"现在什么情况"
阶段 1: 提交修改        (45 min)  → add → commit，把教学期间的改动正式存档
阶段 2: 分支操作        (45 min)  → 开分支做实验，好了合并，不好就扔
阶段 3: 回滚与撤销      (45 min)  → 改坏了怎么救，三大后悔药
阶段 4: 远程同步        (30 min)  → push/pull，本地改完推到服务器
```

总计约 3 小时，一次搞完。

---

## 阶段 0：看懂状态——git 的"仪表盘"

**目标**：运行 `git status` / `git log` / `git diff` 能说出每一条在告诉你什么。

### 知识铺垫

Git 跟踪文件分四个区域：

```
工作目录          暂存区           本地仓库          远程仓库
(你改的文件)  →  (git add)  →  (git commit)  →  (git push)
   ↑                              ↓
   └──── git checkout / reset ────┘
```

### 练习

**练习 1：`git status` 三色解读**

运行 `git status`，输出分三组：

| 颜色 | 标记 | 含义 | 
|------|------|------|
| 红色 | `modified:` | 改了但没 add |
| 绿色 | 无 | add 了但没 commit |
| 红色 | `??` | Git 不认识的陌生文件 |

**练习 2：`git log --oneline` 看历史**

跟 Console 里看 `blogPosts` 数组一样——这是你的 commit 历史。每次 `git commit` 就生成一条。

**练习 3：`git diff` 看具体改动**

运行 `git diff 文件名`，看到的内容格式：绿色 `+` 开头是你新增的行，红色 `-` 开头是你删掉的行。

**验收**: 每次打开终端先跑 `git status`，养成习惯。

---

## 阶段 1：提交修改——把改动存档

**目标**：`git add` → `git commit`，把修改文件有选择地提交。

### 练习

**练习 1：`.gitignore` 加规则**

先让 Git 忽略不需要跟踪的文件（如 SQLite WAL 临时文件），这样它们就不会出现在 `git status` 里。

**练习 2：`git add <文件名>` 逐个添加**

不要 `git add .` 一把梭——逐个 add，养成"看清楚了再放进去"的习惯。

**练习 3：`git commit -m "..."` 写好提交信息**

提交信息格式：
```
type(scope): 简短描述
```

常用 type：`feat`(新功能)、`fix`(修 bug)、`docs`(文档)、`refactor`(重构)、`chore`(杂项)

**练习 4：`git status` 验证**

commit 后 `git status` 应该显示 `nothing to commit, working tree clean`。

---

## 阶段 2：分支操作——安全地做实验

**目标**：开分支做实验 → 好了合并 → 不好就扔掉，主分支不受影响。

### 知识铺垫

```
main:  ●─●─●─●  （稳定版本）
            └─●─●  experiment（实验分支，搞砸了扔掉就行）
```

### 练习

**练习 1：`git branch 分支名` 创建分支**

**练习 2：`git switch 分支名` 切换分支**

注意文件内容变化——分支之间是隔离的。

**练习 3：在实验分支上改点东西**

随便改一个文件，add → commit。

**练习 4：`git log --oneline --all --graph` 看图**

你会看到两个分支分叉。

**练习 5：切回 main，再看看文件**

实验分支的改动**消失了**——这就是分支隔离。

**练习 6：`git merge` 合并**

把实验分支的改动合并回 main。

**练习 7：`git branch -d 分支名` 删除分支**

用完就删，保持分支列表干净。

---

## 阶段 3：回滚与撤销——三大后悔药

**目标**：改错了知道怎么救回来。

### 三张后悔药

| 情况 | 命令 | 效果 |
|------|------|------|
| "我改了一个文件，还没 add，想放弃修改" | `git checkout -- 文件名` | 恢复到上次 commit 的状态 |
| "我 add 了但还没 commit，想撤回暂存" | `git reset HEAD 文件名` | 从暂存区退回工作目录 |
| "我 commit 了但后悔了" | `git reset --soft HEAD~1` | 撤销最近一次 commit，改动回到暂存区 |

### 练习

**练习 1：模拟"改坏了想撤销"**

故意改坏一个文件 → `git checkout --` 恢复。

**练习 2：模拟"commit 了但信息写错了"**

commit 故意写错信息 → `git reset --soft HEAD~1` → 重新 commit。

**练习 3：看 `git reflog`**

Git 的"后悔药的后悔药"——即使 reset 了也能找回来。

---

## 阶段 4：远程同步——推到服务器

**目标**：`git push` 把本地 commit 同步到 GitHub。

### 练习

**练习 1：`git push origin main`**

**练习 2：在 GitHub 上验证**

**练习 3：`git pull`**

从远程拉取更新。

---

## Git 命令速查

### 看状态
| 命令 | 作用 |
|------|------|
| `git status` | 现在什么情况？改了哪些文件？ |
| `git log --oneline` | 最近都提交了什么？ |
| `git log --oneline --all --graph` | 所有分支的树状图 |
| `git diff` | 具体改了哪几行？ |
| `git diff 文件名` | 只看指定文件的改动 |
| `git reflog` | 所有 HEAD 移动记录（终极后悔药） |

### 提交
| 命令 | 作用 |
|------|------|
| `git add 文件名` | 把文件放进暂存区 |
| `git add .` | 把当前目录所有改动放进暂存区 |
| `git commit -m "信息"` | 把暂存区变成一次 commit |

### 分支
| 命令 | 作用 |
|------|------|
| `git branch` | 列出本地分支 |
| `git branch 名字` | 创建新分支 |
| `git switch 名字` | 切换到某个分支 |
| `git switch -c 名字` | 创建并切换 |
| `git merge 名字` | 把指定分支合并到当前分支 |
| `git branch -d 名字` | 删除分支 |

### 撤销
| 命令 | 作用 |
|------|------|
| `git checkout -- 文件名` | 放弃工作目录的修改（未 add 时） |
| `git reset HEAD 文件名` | 从暂存区退回（已 add 时） |
| `git reset --soft HEAD~1` | 撤销最近一次 commit |
| `git reset --hard HEAD~1` | 撤销 commit 并丢弃改动（⚠️ 不可逆） |

### 远程
| 命令 | 作用 |
|------|------|
| `git push origin main` | 推送到远程 |
| `git pull` | 从远程拉取更新 |
| `git remote -v` | 查看远程仓库地址 |

---

## 三条铁律

1. **commit 之前先 `git status`** — 看清楚即将提交什么
2. **不确定时先开分支** — 在分支上随便搞，搞坏了切回 main 就行
3. **`--hard` 是最后手段** — 先用 `--soft`，不行再看 `reflog`，`--hard` 是核按钮

---

## 学习进度追踪表

| 阶段 | 内容 | 状态 | 日期 |
|------|------|------|------|
| 0 | git status/log/diff 看懂状态 | ⬜ | |
| 1 | add → commit 正式提交 | ⬜ | |
| 2 | branch/switch/merge 分支操作 | ⬜ | |
| 3 | reset/checkout/reflog 后悔药 | ⬜ | |
| 4 | push/pull/remote 远程同步 | ⬜ | |

**完成线**：能用分支做实验，知道三种后悔情况各自用什么命令救回来。
