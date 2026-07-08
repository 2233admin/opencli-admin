# Ponytail Style Guide for opencli-admin

> Read this before writing any code.

## The Ladder

Before writing code, stop at the first rung that satisfies:

1. **Does this need to exist?** → No: skip it
2. **Stdlib?** → Use it
3. **Native platform feature?** → Use it
4. **Installed dependency?** → Use it
5. **One line?** → One line
6. **Only then: minimum that works**

## Never Cut

- Trust-boundary validation
- Data-loss handling
- Security
- Accessibility

## Code Rules

### Prefer Native

```tsx
// ❌ over-engineer
<input type="text" onChange={handleChange} />
useEffect(() => { fetchData() }, [])

// ✅ ponytail
<input type="date">
```

### Prefer Stdlib

```tsx
// ❌ dayjs
dayjs().format('YYYY-MM-DD')

// ✅ stdlib
new Date().toISOString().split('T')[0]
```

### Prefer One Line

```tsx
// ❌ 50 lines for a status color
switch(status) { case 'active': return 'green' }

// ✅ one line
const color = { active: 'green', inactive: 'red' }[status] ?? 'gray'
```

### Prefer Installed

```tsx
// ❌ install new package
import { useLocalStorage } from 'usehooks-ts'

// ✅ use what's already in package.json
import { useLocalStorage } from '@/hooks'
```

## File Rules

- Max 200 lines per file
- Split only when necessary (test, reused 3x, >200 lines)
- Flat directory structure
- Group by feature, not by type

## Import Rules

Order:
1. Node built-ins (`path`, `fs`)
2. External packages
3. Internal packages (`@opencli/shared`)
4. Relative imports (`./`, `../`)

## Type Rules

- Infer when obvious
- Explicit when crossing boundaries (API, props)
- Don't type everything

## API Rules

- One endpoint per resource concern
- Don't over-wrap responses
- Add metadata only when list pagination needs it

## Commit Rules

- Verb first, under 72 chars
- No "and"
- feat/fix/chore/docs/refactor/test

## Dependency Rules

Before adding `npm install`:

1. Stdlib works?
2. Already installed?
3. Really needed?
4. Will it be reused?

---

*Less code. More ship.*
