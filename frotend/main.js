let safeStorage = window.localStorage;
let blogPosts = [];

// 从后端拉取全量文章数据
async function loadPostsFromServer() {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/v1/posts");
    const result = await response.json();
    if (result.code === 0) {
      blogPosts = result.data;
      renderBlogGrid();
    } else {
      alert("Error fetching posts: " + result.msg);
    }
  } catch (e) {
    console.error("API connection failed:", e);
  }
}

// 动态渲染卡片列表
function renderBlogGrid() {
  const gridContainer = document.querySelector("#blog-grid");
  if (!gridContainer) return;

  if (blogPosts.length === 0) {
    gridContainer.innerHTML = `<div style="text-align:center;color:#94a3b8;grid-column:1/-1;padding:40px;">📭 暂无文章</div>`;
    return;
  }

  let snowballHtml = "";
  for (const post of blogPosts) {
    snowballHtml += `
            <article class="blog-card" data-id="${post.id}">
                <h2>${post.title}</h2>
                <div class="card-meta">
                    <span>📅 Persistent Data</span>
                    <span>✍️ Author: ${post.author}</span>
                </div>
                <p class="card-content">${post.content}</p>
                <button class="delete-card-btn" data-id="${post.id}">🗑️ 删除博文</button>
            </article>
        `;
  }
  gridContainer.innerHTML = snowballHtml;
}

function initInteractions() {
  // 主题切换功能
  const themeBtn = document.querySelector("#theme-btn");
  if (safeStorage.getItem("dark_mode_active") === "true") {
    document.body.classList.add("dark-theme");
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      document.body.classList.toggle("dark-theme");
      safeStorage.setItem(
        "dark_mode_active",
        document.body.classList.contains("dark-theme"),
      );
    });
  }

  // 事件委托：分流处理卡片点击（详情）与删除按钮点击
  const gridContainer = document.querySelector("#blog-grid");
  if (gridContainer) {
    gridContainer.addEventListener("click", async (e) => {
      // 分流 1：触发删除业务
      if (e.target.classList.contains("delete-card-btn")) {
        e.stopPropagation();
        const targetId = e.target.getAttribute("data-id");

        if (!confirm("确定要永久删除这篇文章吗？")) return;

        try {
          const response = await fetch(
            `http://127.0.0.1:8000/api/v1/posts/${targetId}`,
            {
              method: "DELETE",
            },
          );
          const result = await response.json();
          if (result.code === 0) {
            await loadPostsFromServer();
          } else {
            alert("Delete failed: " + result.msg);
          }
        } catch (err) {
          alert("Network error, delete command failed.");
        }
        return;
      }

      // 分流 2：触发详情弹窗业务
      const clickedCard = e.target.closest(".blog-card");
      if (clickedCard) {
        const postId = parseInt(clickedCard.getAttribute("data-id"), 10);
        const matchedPost = blogPosts.find((p) => p.id === postId);
        if (matchedPost) {
          openDetailModal(matchedPost);
        }
      }
    });
  }

  // 文章提交表单控制
  const postForm = document.querySelector("#post-form");
  if (postForm) {
    postForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const titleValue = document.querySelector("#post-title").value;
      const authorValue = document.querySelector("#post-author").value;
      const contentValue = document.querySelector("#post-content").value;

      try {
        const response = await fetch("http://127.0.0.1:8000/api/v1/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            author: authorValue,
            content: contentValue,
          }),
        });
        const result = await response.json();
        if (result.code === 0) {
          await loadPostsFromServer();
          postForm.reset();
        } else {
          alert("Publish failed: " + result.msg);
        }
      } catch (error) {
        alert("Server unreachable.");
      }
    });
  }
}

// 动态创建并挂载详情模态弹窗
function openDetailModal(post) {
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "custom-modal-overlay";

  modalOverlay.innerHTML = `
        <div class="custom-modal-content">
            <span class="custom-modal-close">×</span>
            <h1 class="modal-title">${post.title}</h1>
            <div class="modal-meta">✍️ Author: ${post.author}  |  🛡️ ID: ${post.id}</div>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <div class="modal-body-text">${post.content.replace(/\n/g, "<br>")}</div>
        </div>
    `;

  document.body.appendChild(modalOverlay);

  const closeBtn = modalOverlay.querySelector(".custom-modal-close");
  closeBtn.addEventListener("click", () => modalOverlay.remove());
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) modalOverlay.remove();
  });
}

// 初始化启动
loadPostsFromServer();
initInteractions();
