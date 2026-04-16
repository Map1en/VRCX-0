# VRCX-0

> A personal fork of VRCX, rebuilt with a modern stack and a different direction.

---

## English

### About

**VRCX-0** is a personal fork of VRCX.

I started contributing to VRCX in late 2024 and remained active until April 2026, working on a large portion of its development, including multiple frontend iterations.

As of April 2026, I am no longer part of the original project.
VRCX-0 is where I continue the work — independently, and with a different set of priorities.

---

### Why VRCX-0?

This project is not just a continuation, but a rethinking.

VRCX-0 is being rebuilt with **Tauri + React**, moving away from the previous CEF-based architecture.

This allows:

* Lower memory usage
* Smaller binary size
* Better performance
* Improved accessibility (a11y)
* Full keyboard navigation support
* A more modern and maintainable ecosystem

---

### Differences from VRCX

* Rewritten with Tauri + React
* Reduced resource usage
* Different UI/UX direction
* Independent roadmap and decisions

---

### Philosophy

VRCX-0 focuses on clarity, performance, and practical usability.

Instead of simply adding more features, the goal is to refine core workflows and make the app feel faster, more predictable, and easier to use.

---

### Platform Support

Currently, due to the ongoing major refactor, **only Windows is supported**.

Support for **Linux and macOS is planned** and will be added gradually as the project stabilizes.

---

### Quick Start

#### Prerequisites

Make sure you have the following installed:

* **Node.js** (LTS recommended)
* **Rust** (latest stable via rustup)

---

#### Run

```bash id="9n1z9h"
# clone
git clone https://github.com/Map1en/VRCX-0

cd VRCX-0

# install
npm install

# run (dev)
npm run tauri dev
```

---

### Data Migration

VRCX-0 will **automatically migrate your existing VRCX database and configuration** on first run.

* Your original VRCX data remains untouched
* No manual setup required
* You can start using it immediately

---

### Current Status

This project is actively evolving.

Core functionality is in place, and the application is usable, but there are still areas being refined and improved over time.

---

### Support

If you're interested in the direction of VRCX-0:

* ⭐ Star the repo
* 👀 Follow updates
* 🧪 Try it and share feedback

---

## 中文

### 项目说明

**VRCX-0** 是 VRCX 的一个个人分支项目。

我从 2024 年末开始参与 VRCX 的开发，并持续到 2026 年 4 月，期间参与并主导了大量功能开发和前端重构。

从 2026 年 4 月起，我已不再参与原项目。
VRCX-0 是我独立继续开发的版本，会按照新的思路推进。

---

### 为什么做 VRCX-0？

这不是简单延续，而是一次重构方向。

项目正在迁移到 **Tauri + React**，替代原有的 CEF 架构，从而带来：

* 更低的内存占用
* 更小的程序体积
* 更好的性能表现
* 更完善的无障碍支持（a11y）
* 完整的键盘操作支持
* 更现代、可维护性更强的生态

---

### 与 VRCX 的区别

* 基于 Tauri + React 重写
* 更低资源占用
* 不同的 UI / 交互方向
* 独立的开发路线

---

### 设计理念

VRCX-0 更关注清晰、性能和实际使用体验。

相比单纯堆功能，我更倾向于优化核心流程，让整体使用更流畅、更可控。

---

### 平台支持

目前由于处于大规模重构阶段，**暂时仅支持 Windows**。

后续会逐步添加 **Linux 和 macOS 支持**。

---

### 快速开始

#### 前置环境

请先安装以下环境：

* **Node.js**（建议 LTS 版本）
* **Rust**（通过 rustup 安装最新稳定版）

---

#### 运行项目

```bash id="p3m0rk"
# 克隆项目
git clone https://github.com/Map1en/VRCX-0

cd VRCX-0

# 安装依赖
npm install

# 启动开发环境
npm run tauri dev
```

---

### 数据迁移

VRCX-0 在首次运行时会**自动迁移原有 VRCX 的数据库和配置**：

* 不会影响原有 VRCX 数据
* 无需手动配置
* 启动即可使用

---

### 当前状态

项目仍在持续开发中。

整体已经可用，但仍有一些细节在逐步优化和完善。

---

### 支持与关注

如果你对这个方向感兴趣：

* ⭐ 点个 Star
* 👀 关注更新
* 🧪 试用并反馈

---
