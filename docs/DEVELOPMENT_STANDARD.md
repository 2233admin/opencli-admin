# opencli-admin 开发规范 (Ponytail 风格)

> 基于 [Ponytail](https://github.com/DietrichGebert/ponytail) 理念
> 核心理念：写必要的代码，不写多余的代码

---

## 1. Ponytail 法则

在写代码之前，停在第一层满足的地方：

```
1. 这个需要存在吗？     → 否：跳过
2. 标准库能做吗？       → 是：用它
3. 平台原生特性？       → 是：用它
4. 已安装的依赖？       → 是：用它
5. 一行能搞定？         → 一行搞定
6. 最后才写：最小可用的代码
```

### 永不动刀子的地方
- 信任边界验证
- 数据丢失处理
- 安全性
- 可访问性

---

## 2. 代码风格

### 2.1 优先用原生

```typescript
// ❌ 过度工程
import { useState, useEffect } from 'react'
const [count, setCount] = useState(0)
useEffect(() => {
  const interval = setInterval(() => setCount(c => c + 1), 1000)
  return () => clearInterval(interval)
}, [])

// ✅ Ponytail 风格
<progress value={progress} max={100} />
```

### 2.2 优先用标准库

```typescript
// ❌ 引入日期库
import dayjs from 'dayjs'
const formatted = dayjs(date).format('YYYY-MM-DD')

// ✅ 标准库
const formatted = new Date(date).toISOString().split('T')[0]
```

### 2.3 优先用一行

```typescript
// ❌ 过度拆分
const getStatusColor = (status: string) => {
  switch (status) {
    case 'success': return 'green'
    case 'failed': return 'red'
    case 'pending': return 'yellow'
    default: return 'gray'
  }
}

// ✅ 一行搞定
const getStatusColor = (s: string) => ({ success: 'green', failed: 'red', pending: 'yellow' }[s] ?? 'gray')
```

### 2.4 优先用已安装的依赖

```typescript
// ❌ 引入新依赖
import { useLocalStorage } from 'usehooks-ts'
const [value, setValue] = useLocalStorage('key', defaultValue)

// ✅ 用已有的
// packages/web/src/hooks/useLocalStorage.ts 已有，直接用
import { useLocalStorage } from '@/hooks/useLocalStorage'
```

---

## 3. React 组件规范

### 3.1 优先用 HTML 原生

```tsx
// ❌ 过度组件
<Button onClick={handleClick} variant="primary">
  提交
</Button>

// ✅ Ponytail 风格
<button className="btn-primary" onClick={handleClick}>
  提交
</button>
```

### 3.2 组件拆分原则

**拆分条件**（满足任一）：
- 超过 50 行
- 有独立的测试用例
- 被复用 3 次以上
- 有独立的业务逻辑

**不拆分**：
- 只是为了"看起来干净"
- 没有复用的单页组件
- 过度抽象的配置对象

### 3.3 State 管理

```tsx
// ❌ 过度使用 useState/useReducer
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
const [data, setData] = useState<Data | null>(null)

// ✅ 用 TanStack Query，内置 loading/error/data
const { data, isLoading, error } = useQuery({
  queryKey: ['sources'],
  queryFn: fetchSources,
})
```

---

## 4. API 设计规范

### 4.1 端点设计

```typescript
// ❌ REST 过度设计
GET /api/v1/sources/{id}/config/tags
POST /api/v1/sources/{id}/config/tags/batch
DELETE /api/v1/sources/{id}/config/tags/{tagId}

// ✅ Ponytail 风格
GET    /api/v1/sources/:id/tags
POST   /api/v1/sources/:id/tags
DELETE /api/v1/sources/:id/tags/:tagId
```

### 4.2 响应格式

```typescript
// ❌ 过度包装
{
  "success": true,
  "data": { ... },
  "meta": { ... },
  "links": { ... },
  "error": null
}

// ✅ 只在需要时包装
// 单条数据直接返回
{ "id": "123", "name": "..." }
// 列表才加 meta
{ "data": [...], "meta": { "total": 100 } }
```

---

## 5. 文件结构

### 5.1 目录扁平化

```
// ❌ 过度嵌套
src/features/sources/components/forms/inputs/NameInput.tsx

// ✅ Ponytail 风格
src/components/features/NameInput.tsx
```

### 5.2 单文件原则

- 单个文件不超过 200 行
- 超过 200 行才拆分
- 拆分时按功能分，不按类型分

```tsx
// ❌ 按类型分
components/
├── Button.tsx
├── Input.tsx
├── Modal.tsx

// ✅ Ponytail 风格：按功能分
components/features/
├── SourceCard.tsx      // 包含 Button, Input 等
├── SourceForm.tsx       // 包含表单逻辑
```

---

## 6. 测试规范

### 6.1 测试必要代码

**必须测试**：
- 业务逻辑
- API 路由
- 数据转换
- 错误处理

**不测试**：
- React 组件（E2E 覆盖）
- 简单的 getter/setter
- 第三方库封装

### 6.2 测试复杂度

```typescript
// ❌ 测试过度
test('SourceForm 渲染正确的 Input 数量', () => {
  render(<SourceForm />)
  expect(screen.getAllByRole('textbox')).toHaveLength(5)
})

// ✅ Ponytail 风格
test('SourceForm 提交正确数据', async () => {
  const onSubmit = vi.fn()
  render(<SourceForm onSubmit={onSubmit} />)
  await userEvent.click(screen.getByRole('button', { name: /submit/i }))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    name: expect.any(String)
  }))
})
```

---

## 7. Git Commit 规范

### 7.1 Commit 信息

```bash
# ❌ 冗长
git commit -m "feat: add functionality to handle user data processing and validation"

# ✅ Ponytail 风格
git commit -m "feat(sources): add validation"
```

### 7.2 Commit 类型

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `chore` | 杂项（依赖更新等） |
| `docs` | 文档 |
| `refactor` | 重构 |
| `test` | 测试 |

### 7.3 规则

- 每行不超过 72 字符
- 不写 "and"
- 动词开头

---

## 8. 依赖管理

### 8.1 新增依赖检查

```bash
# 添加前问：
1. 标准库能做吗？
2. 已有的依赖能做吗？
3. 这个真的需要吗？
```

### 8.2 依赖检查清单

| 问题 | 答案 | 动作 |
|------|------|------|
| 标准库能做吗？ | 是 | 不添加 |
| 已安装的依赖能做吗？ | 是 | 不添加 |
| 没有这个库功能能用吗？ | 否 | 确认后添加 |
| 功能会被复用吗？ | 是 | 添加 |

---

## 9. 代码审查清单

### 9.1 Ponytail 检查

- [ ] 这行代码需要吗？
- [ ] 标准库能做吗？
- [ ] 平台原生特性有吗？
- [ ] 一行能搞定吗？
- [ ] 超过 50 行了吗？（考虑拆分）

### 9.2 安全检查

- [ ] 输入验证了吗？
- [ ] 错误处理了吗？
- [ ] 敏感信息泄露了吗？

### 9.3 性能检查

- [ ] 有 N+1 查询吗？
- [ ] 有不必要的重渲染吗？
- [ ] 有内存泄漏风险吗？

---

## 10. 反模式

### ❌ 过度工程

```typescript
// 不要：创建工厂类来创建简单的对象
class SourceFactory {
  static create(config: SourceConfig): Source {
    return new Source(config)
  }
}

// 不要：为简单的对象创建接口
interface ISource {
  id: string
  name: string
  type: SourceType
}

// ✅ 直接写
const source: Source = { id, name, type }
```

### ❌ 过度抽象

```typescript
// 不要：抽象出 BaseService
class BaseService<T> {
  async findAll(): Promise<T[]>
  async findById(id: string): Promise<T | null>
  async create(data: Partial<T>): Promise<T>
  async update(id: string, data: Partial<T>): Promise<T>
  async delete(id: string): Promise<void>
}

// ✅ Ponytail：直接写需要的方法
async function getSources(): Promise<Source[]> { ... }
async function createSource(data: SourceInput): Promise<Source> { ... }
```

### ❌ 过度类型

```typescript
// 不要：给所有东西都加类型
type SourceDTO = {
  readonly id: string
  readonly name: string
  readonly type: SourceType
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly config: Readonly<SourceConfig>
}

// ✅ Ponytail：类型推断够用时不用显式标注
const source = { id, name, type } // TypeScript 推断
```

---

## 11. 参考

- [Ponytail](https://github.com/DietrichGebert/ponytail) - 懒惰开发理念
- [YAGNI](https://en.wikipedia.org/wiki/You_aren%27t_gonna_need_it) - 不写未来可能用到的代码
- [KISS](https://en.wikipedia.org/wiki/KISS_principle) - 保持简单
