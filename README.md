# 🎬 Audio Visual Studio

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

---

<p align="center">
  <img src="https://img.shields.io/github/stars/your-repo/audio-visual-studio?style=flat&color=blue" alt="stars">
  <img src="https://img.shields.io/github/license/your-repo/audio-visual-studio" alt="license">
  <img src="https://img.shields.io/github/forks/your-repo/audio-visual-studio?style=flat" alt="forks">
</p>

---

## ✨ 什么是 Audio Visual Studio？

**一个实时视觉特效实验平台** — 用代码创造视觉艺术，探索动画、粒子、Shader 的无限可能。

> "显示器不只是显示内容，它本身就是一个可以测试的艺术品。" 

无论是**屏幕测试**、**动效分析**还是**视觉创意**，这里都能找到答案。

---

## 🚀 为什么值得参与？

| 🎯 适合谁 | 💡 能学到什么 |
|-----------|---------------|
| 前端开发者 | React 动画、性能优化、Canvas/WebGL |
| 视觉设计师 | 代码驱动的艺术、实时视觉反馈 |
| 创意工程师 | 粒子系统、Shader、GLSL 基础 |
| 学生/爱好者 | 从零构建酷炫项目的完整流程 |

### 🎮 好玩的特性

- **5+ 视觉模块**：每个模块都是独立的小实验
- **键盘操控**：像玩游戏一样控制视觉效果
- **全屏展示**：投屏、展览、屏幕测试全能搞定
- **极简交互**：鼠标靠近底部呼出导航，不干扰视觉

---

## 🎨 项目预览

| 模块 | 功能 | 场景 |
|------|------|------|
| **STUDIO** | 动态 Logo 展示 | 品牌展示、首屏动画 |
| **GRID** | 颜色网格 + 校准工具 | 屏幕测试、白平衡、均匀性 |
| **BIG** | 全屏动态字体波浪 | 海报设计、排版动画 |
| **SCROLL** | 滚动模糊测试 | 响应速度分析、GTG 测试 |
| **RAIN** | 粒子雨滴模拟 | 视觉放松、Shader 学习 |

---

## 🕹️ 全局控制

### 键盘快捷键

| 按键 | 功能 |
|------|------|
| `P` | 开启/暂停自动轮播 |
| `空格` | 切换到下一个模块 |
| `F` | 进入/退出全屏 |

### 导航栏
鼠标靠近屏幕底部边缘即可呼出导航栏，显示当前模块和播放状态。

---

## 📖 模块详解

### 1. STUDIO — 品牌展示

**开屏模块**，展示 Studio Logo 动态效果。

| 功能 | 说明 |
|------|------|
| Fluid Shader | 流体模拟动画 |
| 动画效果 | 持续循环的品牌展示 |

---

### 2. GRID — 屏幕测试专家 🎯

**显示器校准必备工具**，专业级屏幕测试一站式搞定。

| 功能 | 说明 |
|------|------|
| 自动变阵 | 每 5 秒随机切换网格大小 (1×1 到 N×N) |
| 色域切换 | Display-P3 / sRGB 自由切换 |
| BFI 测试 | 黑帧插入，测试运动模糊 |
| 白平衡校准 | R/G/B 偏移微调 |
| 均匀性测试 | 7 级灰阶面板检查 |
| 位深测试 | 渐变可视化，检测抖动 |

> 🎯 **一句话**：有了它，显示器什么问题都无处遁形。

---

### 3. BIG — 动态字体 🎨

**全屏动态排版**，把字体变成艺术品。

| 功能 | 说明 |
|------|------|
| 随机字母 | 随机展示大写字母 + 旋转 |
| 波浪效果 | 正弦波纹穿越整个视口 |
| 反色模式 | 黑白反转 |
| 描边模式 | 空心字体效果 |
| 字重调节 | 100-900 随心调 |
| 校准标尺 | 几何畸变与边框校准 |

> 💡 **玩法**：调节波浪参数，创造独特的视觉签名。

---

### 4. SCROLL — 滚动模糊测试 📱

**滚动流畅度分析**，测试高刷屏真实表现。

| 功能 | 说明 |
|------|------|
| 滚动动画 | 连续水平滚动文字 |
| 反色模式 | 黑白/彩色切换 |
| 波浪边缘 | 文字边缘波动效果 |
| 追逐模式 | 模拟相机追踪，GTG 响应测试 |

> 📱 **用途**：检验手机/显示器滚动是否"跟手"。

---

### 5. RAIN 🌧️

**粒子模拟实验**，物理驱动的雨滴效果。

| 功能 | 说明 |
|------|------|
| 粒子系统 | 基于物理的雨滴模拟 |
| 速度控制 | 调节下落速度 |
| 密度控制 | 调节雨滴数量 (10-10000+) |
| 网格叠加 | 显示参考网格 |
| 浅色模式 | 切换明亮背景 |
| 双主题 | 默认 / 水蓝色主题 |

> 🌧️ **用途**：解压神器 + 粒子系统学习范本。

---

## 🛠️ 技术栈

<p>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Framer--Motion-0055FF?style=flat&logo=framer" alt="Framer Motion">
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css" alt="Tailwind">
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/Canvas-JS-000000?style=flat" alt="Canvas">
</p>

- **React 19** — 现代前端框架
- **Framer Motion** — 声明式动画
- **Tailwind CSS** — 原子化 CSS
- **Canvas API** — 粒子系统、图形渲染
- **Vite** — 极速构建

---

## 🏃‍♂️ 快速开始

```bash
# 克隆项目
git clone https://github.com/your-repo/audio-visual-studio.git
cd audio-visual-studio

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:5173 开始体验！

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！以下是几种参与方式：

### 🎯 贡献方向

| 方向 | 说明 |
|------|------|
| 🐛 Bug 修复 | 找问题、修 bug |
| ✨ 新功能 | 添加新的视觉模块 |
| 🎨 视觉优化 | 动画、配色、动效提升 |
| 📚 文档 | 完善 README、注释 |
| 🧪 测试 | 添加测试用例 |

### 📝 提交规范

```bash
# 创建分支
git checkout -b feature/your-feature

# 提交更改
git commit -m "feat: 添加 xxx 功能"

# 推送
git push origin main
```

### 💬 交流方式

- 📧 提交 Issue 讨论新想法
- 💡 Pull Request 展示你的创意
- 🐦 关注项目更新

---

## 📄 许可证

MIT License — 自由使用，开心就好 🎉

---

<p align="center">
  <strong>让每一块屏幕都成为艺术Canvas</strong><br>
  Made with ❤️ by creative developers
</p>
